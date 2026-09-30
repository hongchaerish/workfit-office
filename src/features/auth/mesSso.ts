import { userRepo } from '@/data/user/user.repo';
import { authRepo } from '@/data/auth/auth.repo';
import { systemLogRepo } from '@/data/systemLog/systemLog.repo';
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
export async function verifyAndAuthenticateMesSso(apiKey: string = DEFAULT_MES_SSO_API_KEY): Promise<User | null> {
  if (typeof window === 'undefined') return null;

  const urlParams = new URLSearchParams(window.location.search);
  const from = urlParams.get('from');

  // MES 출처가 아니면 검사 건너뜀
  if (from !== 'mes') {
    return null;
  }

  const loginId = urlParams.get('loginId') || urlParams.get('id') || '';
  const password = urlParams.get('password') || urlParams.get('pw') || '';
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

  // 1. [방식 A-1] admin / admin1234! 직접 파라미터 전달 시
  if (loginId.toLowerCase() === 'admin' && password === 'admin1234!') {
    targetUser = findAdminUser();
  }
  // 2. [방식 A-2] 다른 일반 사용자 ID/PW 파라미터 전달 시
  else if (loginId && password) {
    try {
      targetUser = await authRepo.authenticate(loginId, password);
    } catch {
      console.warn('[MES-SSO] 제공된 loginId/password 로 인증에 실패하였습니다.');
      return null;
    }
  }
  // 3. [방식 A-3] 서명(sig) 검증 방식 전달 시
  else if (userParam && tsParam && sigParam) {
    const rawTs = Number(tsParam);
    const tsMillis = tsParam.length <= 10 ? rawTs * 1000 : rawTs;
    const now = Date.now();
    const MAX_TOLERANCE_MS = 5 * 60 * 1000; // 5분

    if (!isNaN(rawTs) && rawTs > 0 && Math.abs(now - tsMillis) <= MAX_TOLERANCE_MS) {
      const rawData = `${userParam}:${tsParam}:${apiKey}`;
      const expectedSig = await sha256Hex(rawData);
      if (expectedSig === sigParam.toLowerCase()) {
        // 그룹웨어 DB에 실제 '사용' 상태로 존재하는 사원/계정만 인증 승인 (미등록/비활성 계정은 null)
        targetUser =
          users.find(
            (u) =>
              u.status === '사용' &&
              (u.empNo === userParam || u.email.toLowerCase() === userParam.toLowerCase() || u.id === userParam)
          ) || null;
      }
    }
  }

  // 등록되지 않은 사번이거나 파라미터가 누락된 경우 즉시 인증 거부(null)
  if (!targetUser) {
    console.warn('[MES-SSO] 인증 대상 사용자가 그룹웨어에 존재하지 않거나 자격 증명이 유효하지 않습니다.');
    return null;
  }

  // 로그인 세션 저장 및 통계 기록
  localStorage.setItem('mes.auth.uid', targetUser.id);
  void authRepo.touchLastLogin(targetUser.id);
  void systemLogRepo.recordLogin(targetUser, 'Web');

  // 민감 파라미터(password, pw, sig, ts, user 등) 주소창에서 깔끔하게 제거
  urlParams.delete('password');
  urlParams.delete('pw');
  urlParams.delete('sig');
  urlParams.delete('ts');
  urlParams.delete('loginId');
  urlParams.delete('id');

  // 모듈 화면(도크가 아닌 일반 화면)으로 SSO 진입한 경우, 깨끗한 URL 유지를 위해 from, user 도 정리
  const isDockPath = window.location.pathname === '/exec' || window.location.pathname.startsWith('/dock');
  if (!isDockPath) {
    urlParams.delete('from');
    urlParams.delete('user');
  }

  const remaining = urlParams.toString();
  const cleanUrl = window.location.pathname + (remaining ? `?${remaining}` : '') + window.location.hash;
  window.history.replaceState(null, '', cleanUrl);

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
