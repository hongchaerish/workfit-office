import { userRepo } from '@/data/user/user.repo';
import { authRepo } from '@/data/auth/auth.repo';
import { systemLogRepo } from '@/data/systemLog/systemLog.repo';
import type { User } from '@/domain/user/schema';

/**
 * MES ↔ WorkFit 그룹웨어 단발성 SSO API 연동 키.
 * 환경 변수 VITE_MES_SSO_API_KEY 로 재정의 가능하며,
 * 상대측(MES 개발팀)과 동일한 키를 공유합니다.
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
 * 서명 검증 및 사용자 자동 로그인 처리
 * URL: .../exec?from=mes&view=groupware&user=admin&ts=1727598000&sig=...
 */
export async function verifyAndAuthenticateMesSso(apiKey: string = DEFAULT_MES_SSO_API_KEY): Promise<User | null> {
  if (typeof window === 'undefined') return null;

  const urlParams = new URLSearchParams(window.location.search);
  const from = urlParams.get('from');
  const userParam = urlParams.get('user');
  const tsParam = urlParams.get('ts');
  const sigParam = urlParams.get('sig');

  // MES 연동 파라미터가 없으면 패스
  if (from !== 'mes' || !userParam || !tsParam || !sigParam) {
    return null;
  }

  // 1. 타임스탬프 유효기간 검증 (5분 = 300,000ms 허용, 서버 간 시계 오차 감안)
  const rawTs = Number(tsParam);
  if (isNaN(rawTs) || rawTs <= 0) {
    console.warn('[MES-SSO] 유효하지 않은 타임스탬프 형식입니다:', tsParam);
    return null;
  }

  // 10자리(초 단위) 또는 13자리(밀리초 단위) 유연 대응
  const tsMillis = tsParam.length <= 10 ? rawTs * 1000 : rawTs;
  const now = Date.now();
  const MAX_TOLERANCE_MS = 5 * 60 * 1000; // 5분

  if (Math.abs(now - tsMillis) > MAX_TOLERANCE_MS) {
    console.warn('[MES-SSO] 타임스탬프가 만료되었습니다. 현재:', now, '전달:', tsMillis);
    return null;
  }

  // 2. SHA-256 서명 검증: sha256("${user}:${ts}:${apiKey}")
  const rawData = `${userParam}:${tsParam}:${apiKey}`;
  const expectedSig = await sha256Hex(rawData);

  if (expectedSig !== sigParam.toLowerCase()) {
    console.warn('[MES-SSO] 서명 검증에 실패하였습니다.');
    return null;
  }

  // 3. 사용자 매칭 (사번 empNo, 이메일 email, ID id 순차 대조)
  const users = await userRepo.list();
  const matchedUser = users.find(
    (u) =>
      u.status === '사용' &&
      (u.empNo === userParam || u.email.toLowerCase() === userParam.toLowerCase() || u.id === userParam)
  );

  if (!matchedUser) {
    console.warn('[MES-SSO] 일치하는 활성 사용자를 찾을 수 없습니다:', userParam);
    return null;
  }

  // 4. 세션 저장 및 통계 기록
  localStorage.setItem('mes.auth.uid', matchedUser.id);
  void authRepo.touchLastLogin(matchedUser.id);
  void systemLogRepo.recordLogin(matchedUser, 'Web');

  // 5. URL에서 보안 파라미터(ts, sig) 제거하여 주소창 깔끔하게 유지 (view, from 은 유지)
  urlParams.delete('ts');
  urlParams.delete('sig');
  const remaining = urlParams.toString();
  const cleanUrl = window.location.pathname + (remaining ? `?${remaining}` : '') + window.location.hash;
  window.history.replaceState(null, '', cleanUrl);

  return matchedUser;
}
