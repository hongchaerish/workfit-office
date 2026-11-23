/**
 * 마스터 계정(admin) — 시스템이 보호하는 비상용 최고 관리자.
 * - 역할·부서와 상관없이 언제나 모든 권한(전사 범위)을 가진다. 관리자 권한에서 뺄 수 없다.
 * - 삭제·사용 중지·퇴직 처리를 할 수 없다. 비밀번호는 본인만 바꾼다.
 * - 조직도·명단·결재선 등 화면 목록에 나오지 않는다(로그인·권한 판정 목록에만 있다).
 * - 어떤 부서에도 속하지 않는다 — 인사 기록·부서 소속·부서장 지정을 만들 수 없다.
 * 평소 관리는 실명 계정에 '최고 관리자' 역할을 주어 하고, 이 계정은 잠금 복구용으로 쓴다.
 */
export const MASTER_ACCOUNT_ID = 'admin';
export const MASTER_ACCOUNT_NAME = '관리자';

export function isMasterAccount(user: { id?: string | null } | null | undefined): boolean {
  return (user?.id ?? '').toLowerCase() === MASTER_ACCOUNT_ID;
}

export const MASTER_ACCOUNT_PROTECTED_MESSAGE = '관리자(admin) 계정은 삭제하거나 사용을 멈출 수 없습니다.';

/** 저장·삭제 전 검사 — 마스터 계정을 지우거나 쓰지 못하게 바꾸려 하면 오류 */
export function assertMasterAccountKept(id: string, next?: { status?: string; resignedAt?: string | null } | 'remove'): void {
  if (!isMasterAccount({ id })) return;
  if (next === 'remove' || (next && next.status && next.status !== '사용') || (next && typeof next === 'object' && next.resignedAt)) {
    throw new Error(MASTER_ACCOUNT_PROTECTED_MESSAGE);
  }
}

export const MASTER_ACCOUNT_NO_DEPT_MESSAGE = '관리자(admin) 계정은 부서에 속할 수 없습니다.';

/** 인사 기록·부서 소속·부서장 저장 전 검사 — 마스터 계정이면 오류 */
export function assertMasterAccountNoDept(userId: string | null | undefined): void {
  if (isMasterAccount({ id: userId })) throw new Error(MASTER_ACCOUNT_NO_DEPT_MESSAGE);
}
