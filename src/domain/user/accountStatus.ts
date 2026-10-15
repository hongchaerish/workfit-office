import type { UserStatus } from './schema';

/**
 * 계정 상태를 누가 바꾸는가 — 2026-10-15 결정.
 * - 사용·잠금: 사용자 관리(잠금은 재직 상태와 무관한 일시 차단. 인명관리에서 휴직이면 자동 잠금).
 * - 미사용: 퇴직. 인명관리 [퇴직 처리]로만 들어가고, 사용자 관리에서는 들어가지도 빠져나오지도 못한다
 *   (재직자를 미사용으로 막거나, 퇴직자를 다시 로그인하게 만드는 일을 막는다).
 */
export const ACCOUNT_EDITABLE_STATUSES = ['사용', '잠금'] as const satisfies readonly UserStatus[];

/** 사용자 관리 저장 전 확인. previous 가 없으면 새 계정. */
export function assertAccountStatusEdit(previous: UserStatus | undefined, next: UserStatus): void {
  if (previous === '미사용') {
    if (next !== '미사용') throw new Error('퇴직(미사용) 계정은 사용자 관리에서 상태를 바꿀 수 없습니다.');
    return;
  }
  if (next === '미사용') {
    throw new Error('미사용(퇴직)은 인명관리의 [퇴직 처리]로만 바꿀 수 있습니다.');
  }
}
