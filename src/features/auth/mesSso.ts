import { userRepo } from '@/data/user/user.repo';
import { authRepo } from '@/data/auth/auth.repo';
import { systemLogRepo } from '@/data/systemLog/systemLog.repo';
import { mintWiddyToken } from '@/data/widdyChat/widdyAuth';
import type { User } from '@/domain/user/schema';

/**
 * MES 연동 기본 최고관리자 계정 정의 (DB에 admin 이 없을 경우 폴백)
 */
export const FALLBACK_ADMIN_USER: User = {
  id: 'admin',
  empNo: 'admin',
  name: '최고관리자',
  dept: 'IT운영팀',
  position: '이사',
  jobTitle: '시스템관리자',
  email: 'admin@workfit.kr',
  status: '사용',
  lastLogin: '-',
  managerId: null,
  password: '',
  sealUrl: '',
  signUrl: '',
  signType: 'stamp',
  photoUrl: '',
  resignedAt: '',
  fcmToken: '',
  assignments: [],
};

/**
 * MES ↔ WorkFit 그룹웨어 단발성 SSO API 연동 키.
 */
export const DEFAULT_MES_SSO_API_KEY =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_MES_SSO_API_KEY) ||
  'wf_sso_mes_sec_9a7d2b4f6e1c8a30';

/**
 * Web Crypto API 를 활용한 SHA-256 16진수 문자열 해시 계산
 */
export async function sha256Hex(message: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('').toLowerCase();
}

/**
 * MES 자동 로그인 처리 (방식 A: URL 파라미터 및 MES 출처 기반)
 * 1) ?from=mes&loginId=admin&password=admin1234!
 * 2) ?from=mes (출처만 있을 때도 admin 기본 자동로그인)
 * 3) ?from=mes&user=admin&ts=...&sig=... (SHA-256 서명 검증 방식)
 */
/**
 * MES 자동 로그인 처리 (출처: ?from=mes)
 * 1) ?from=mes (파라미터가 없거나 생략되어도 admin 기본 자동로그인)
 * 2) ?from=mes&loginId=admin&password=admin1234! (또는 amdin1234!)
 * 3) ?from=mes&loginId=사번&password=비밀번호 (일반 사용자 로그인)
 * 4) ?from=mes&user=사번&ts=...&sig=... (SHA-256 서명 검증 방식)
 */
export async function verifyAndAuthenticateMesSso(apiKey: string = DEFAULT_MES_SSO_API_KEY): Promise<User | null> {
  if (typeof window === 'undefined') return null;

  const urlParams = new URLSearchParams(window.location.search);
  const from = urlParams.get('from');

  // MES 출처가 아니면 처리하지 않음
  if (!from || from.toLowerCase() !== 'mes') {
    return null;
  }

  const loginId = (urlParams.get('loginId') || urlParams.get('id') || urlParams.get('user') || '').trim();
  const password = (urlParams.get('password') || urlParams.get('pw') || '').trim();
  const userParam = urlParams.get('user');
  const tsParam = urlParams.get('ts');
  const sigParam = urlParams.get('sig');

  let targetUser: User | null = null;
  const users = await userRepo.list();

  // 관리자 계정 탐색 (DB의 admin 또는 대표이사 U001 또는 기본 관리자)
  const findAdminUser = (): User => {
    const existing = users.find(
      (u) =>
        u.status === '사용' &&
        (u.empNo?.toLowerCase() === 'admin' || u.id?.toLowerCase() === 'admin' || u.email?.toLowerCase().startsWith('admin@'))
    );
    if (existing) return existing;
    const fallbackTop = users.find((u) => u.id === 'U001' && u.status === '사용');
    return fallbackTop || FALLBACK_ADMIN_USER;
  };

  // 1. admin 계정 요청이거나, MES에서 별도 자격증명 없이 ?from=mes 로만 진입한 경우 -> 최고관리자 자동 인증
  const isAdminRequest = loginId.toLowerCase() === 'admin';
  const isMasterPassword = password === 'admin1234!' || password === 'amdin1234!' || !password;
  const isDefaultMesEntry = !loginId && !sigParam;

  if ((isAdminRequest && isMasterPassword) || isDefaultMesEntry) {
    targetUser = findAdminUser();
  }
  // 2. 다른 일반 사용자 ID/PW 전달 시
  else if (loginId && password) {
    try {
      targetUser = await authRepo.authenticate(loginId, password);
    } catch {
      return null;
    }
  }
  // 3. 서명(sig) 검증 방식 전달 시
  else if (userParam && tsParam && sigParam) {
    const rawTs = Number(tsParam);
    const tsMillis = tsParam.length <= 10 ? rawTs * 1000 : rawTs;
    const now = Date.now();
    const MAX_TOLERANCE_MS = 5 * 60 * 1000;

    if (!isNaN(rawTs) && rawTs > 0 && Math.abs(now - tsMillis) <= MAX_TOLERANCE_MS) {
      const rawData = `${userParam}:${tsParam}:${apiKey}`;
      const expectedSig = await sha256Hex(rawData);
      if (expectedSig === sigParam.toLowerCase()) {
        targetUser =
          users.find(
            (u) =>
              u.status === '사용' &&
              (u.empNo === userParam || u.email.toLowerCase() === userParam.toLowerCase() || u.id === userParam)
          ) || (userParam.toLowerCase() === 'admin' ? findAdminUser() : null);
      }
    }
  }

  if (!targetUser) return null;

  // 세션 저장 및 통계 기록, Widdy 토큰 발급
  localStorage.setItem('mes.auth.uid', targetUser.id);
  void authRepo.touchLastLogin(targetUser.id);
  void systemLogRepo.recordLogin(targetUser, 'Web');
  void mintWiddyToken(targetUser.empNo || targetUser.id, password || 'admin1234!');

  // URL에서 민감 파라미터(password, sig 등) 정리 (화면 표시 깔끔화)
  try {
    const p = new URLSearchParams(window.location.search);
    p.delete('password');
    p.delete('pw');
    p.delete('sig');
    p.delete('ts');
    p.delete('loginId');
    p.delete('id');

    const isDock = window.location.pathname === '/exec' || window.location.pathname.startsWith('/dock');
    if (!isDock) {
      p.delete('from');
      p.delete('user');
    }
    const cleanUrl = window.location.pathname + (p.toString() ? `?${p.toString()}` : '') + window.location.hash;
    window.history.replaceState(null, '', cleanUrl);
  } catch {
    /* ignore */
  }

  return targetUser;
}

/**
 * 도크(iframe/슬라이드)에서 모듈을 새 탭으로 띄울 때 사용할 보안 SSO 런칭 URL 생성.
 * 브라우저 스토리지 격리(Storage Partitioning)를 극복하기 위해 타임스탬프와 SHA-256 서명을 전달합니다.
 */
export async function createMesSsoLaunchUrl(
  targetPath: string,
  user: User,
  apiKey: string = DEFAULT_MES_SSO_API_KEY
): Promise<string> {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const url = new URL(targetPath.startsWith('http') ? targetPath : `${origin}${targetPath}`);

  const userParam = user.empNo || user.id;
  const ts = Date.now().toString();
  const rawData = `${userParam}:${ts}:${apiKey}`;
  const sig = await sha256Hex(rawData);

  url.searchParams.set('from', 'mes');
  url.searchParams.set('user', userParam);
  url.searchParams.set('ts', ts);
  url.searchParams.set('sig', sig);

  return url.toString();
}
