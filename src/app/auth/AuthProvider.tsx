import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { authRepo } from '@/data/auth/auth.repo';
import { userRepo } from '@/data/user/user.repo';
import { systemLogRepo } from '@/data/systemLog/systemLog.repo';
import { mintWiddyToken, clearWiddyToken } from '@/data/widdyChat/widdyAuth';
import type { User } from '@/domain/user/schema';
import { verifyAndAuthenticateMesSso } from '@/features/auth/mesSso';

/**
 * 인증 컨텍스트 — 자체 로그인(users 컬렉션 대조) 세션.
 * ⚠ UI 게이트일 뿐 진짜 보안이 아니다(클라 평문 대조). 진짜 인증은 후속
 *    Cloud Function custom token 으로 전환 예정. ([[firebase-backend-setup]])
 *
 * 세션은 localStorage 에 사용자 id 만 저장하고, 초기 로드 시 users 에서 복원한다.
 * (전체 User 를 저장하면 stale/평문 노출 위험 → id 만 보관)
 *
 * ⚠ 이 Provider 는 QueryProvider 바깥에 있으므로 TanStack Query 훅을 쓰지 못한다.
 *    → repo(authRepo/userRepo)를 직접 호출한다.
 */
interface AuthState {
  /** 로그인한 사용자(자체 도메인 User). 미로그인 시 null. */
  user: User | null;
  /** 세션 복원 등 초기 로딩 중. */
  loading: boolean;
  /** 자체 로그인은 항상 동작하므로 데모 통과 개념은 없음(하위호환용, 항상 false). */
  demoMode: boolean;
  /** 사번(empNo) 또는 이메일 + 비밀번호로 로그인. 실패 시 AuthError throw. */
  signIn: (loginId: string, password: string, platform?: 'Web' | 'Mobile') => Promise<void>;
  /** 로그아웃 — 세션 클리어. */
  signOutUser: () => Promise<void>;
  /** 로그인 사용자의 비밀번호 변경(현재 비번 검증 후 DB 영구화). 실패 시 AuthError throw. */
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  /** 프로필 자기 수정(이메일, 인감 URL, 서명 URL, 선택 타입, 프로필 사진). 저장 후 세션 user 상태도 최신화. */
  updateProfile: (patch: { email?: string; sealUrl?: string; signUrl?: string; signType?: 'stamp' | 'signature'; photoUrl?: string }) => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

const SESSION_KEY = 'mes.auth.uid';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // 초기 마운트 시 저장된 세션 복원 또는 MES SSO 자동 로그인
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // 1. URL에 MES SSO 파라미터가 있는 경우 서명 검증 및 자동 로그인 우선 시도
        const ssoUser = await verifyAndAuthenticateMesSso();
        if (!alive) return;
        if (ssoUser) {
          setUser(ssoUser);
          return;
        }

        // 2. 기존 로컬 세션 복원
        const uid = localStorage.getItem(SESSION_KEY);
        if (uid) {
          const users = await userRepo.list();
          // 언마운트된 경우 아무 것도 건드리지 않는다. StrictMode는 effect를 두 번 실행하는데,
          // 첫 번째 cleanup 이후 비동기가 끝났다고 세션을 지우면 정상 로그인 상태가 날아간다.
          if (!alive) return;
          const found = users.find((u) => u.id === uid && u.status === '사용');
          if (found) setUser(found);
          else localStorage.removeItem(SESSION_KEY);
        }
      } catch {
        /* 복원 실패 시 미로그인으로 처리 */
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function signIn(loginId: string, password: string, platform: 'Web' | 'Mobile' = 'Web') {
    const u = await authRepo.authenticate(loginId, password);
    localStorage.setItem(SESSION_KEY, u.id);
    setUser(u);
    void authRepo.touchLastLogin(u.id);
    void systemLogRepo.recordLogin(u, platform);
    // Widdy ACL 용 서명 토큰 발급(best-effort — 비밀번호가 있는 이 시점에만 가능).
    void mintWiddyToken(loginId, password);
  }

  async function signOutUser() {
    localStorage.removeItem(SESSION_KEY);
    clearWiddyToken();
    if (typeof window !== 'undefined') {
      const isMobile = window.location.pathname.startsWith('/m');
      const targetUrl = isMobile ? '/m' : '/';
      if (window.location.pathname !== targetUrl || window.location.search) {
        window.history.replaceState(null, '', targetUrl);
      }
    }
    setUser(null);
  }

  async function changePassword(currentPassword: string, newPassword: string) {
    if (!user) throw new Error('로그인 상태가 아닙니다.');
    
    const pwRegex = /^(?=.*[a-zA-Z])(?=.*\d)(?=.*[^a-zA-Z0-9]).{9,}$/;
    if (!pwRegex.test(newPassword)) {
      throw new Error('비밀번호는 영문자, 숫자, 특수기호가 포함된 9자 이상이어야 합니다.');
    }
    
    const updated = await authRepo.changePassword(user.id, currentPassword, newPassword);
    setUser(updated); // 세션 내 비밀번호 최신화(이후 변경 검증 정확)
  }

  async function updateProfile(patch: { email?: string; sealUrl?: string; signUrl?: string; signType?: 'stamp' | 'signature'; photoUrl?: string }) {
    if (!user) throw new Error('로그인 상태가 아닙니다.');
    const updated = await userRepo.updateProfile(user.id, patch);
    setUser(updated);
  }

  return (
    <AuthContext.Provider value={{ user, loading, demoMode: false, signIn, signOutUser, changePassword, updateProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth는 <AuthProvider> 내부에서만 사용할 수 있습니다.');
  return ctx;
}
