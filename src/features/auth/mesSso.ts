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
  photoThumbUrl: '',
  resignedAt: '',
  fcmToken: '',
  fcmTokens: [],
  fcmTokensRecall: [],
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
 * MES 자동 로그인 처리 (출처: ?from=mes)
 * 1) ?from=mes&loginId=사번&password=비밀번호 — 저장된 비밀번호로 확인
 * 2) ?from=mes&user=사번&ts=...&sig=... — SHA-256 서명 검증(5분 안)
 * 출처만 있거나(?from=mes) 코드에 박힌 admin 비밀번호로는 들어올 수 없다(2026-11-23).
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
  const users = await userRepo.listIncludingTestAccounts();

  // ?from=mes 만으로 최고관리자 자동 로그인, 코드에 박힌 admin 비밀번호로 로그인하던 길은 막았다(2026-11-23 보안).
  // 1. ID/PW 전달 시 — 일반 로그인과 같이 저장된 비밀번호로 확인
  if (loginId && password && !sigParam) {
    try {
      targetUser = await authRepo.authenticate(loginId, password);
    } catch {
      return null;
    }
  }
  // 2. 서명(sig) 검증 방식 전달 시
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
          ) ?? null;
      }
    }
  }

  if (!targetUser) return null;

  // 세션 저장 및 통계 기록, Widdy 토큰 발급
  localStorage.setItem('mes.auth.uid', targetUser.id);
  void authRepo.touchLastLogin(targetUser.id);
  void systemLogRepo.recordLogin(targetUser, 'Web');
  if (password) void mintWiddyToken(targetUser.empNo || targetUser.id, password);

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
