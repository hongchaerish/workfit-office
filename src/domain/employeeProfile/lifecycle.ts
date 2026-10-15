import type { EmploymentStatus } from './schema';
import type { UserStatus } from '@/domain/user/schema';

/**
 * 인사(인명관리)와 계정(사용자 관리)의 경계 — 2026-10-15 결정.
 *
 * - 재직 상태(재직·휴직·퇴직)는 인명관리가, 계정 상태(사용·잠금·미사용)는 사용자 관리가 정한다.
 * - 인명관리 저장은 **재직 상태가 바뀔 때만** 계정 상태를 맞춘다. 그대로면 사용자 관리에서 정한
 *   계정 상태(예: 잠금)를 덮지 않는다.
 * - 퇴직은 일반 저장이 아니라 퇴직 처리 절차(`retireEmployee`)로만 한다 — 계정 비활성화·퇴사일·
 *   상급자 재연결·푸시 토큰 제거를 함께 해야 해서다.
 */
export function accountStatusOnTransition(
  previous: EmploymentStatus | undefined,
  next: EmploymentStatus,
): UserStatus | null {
  if (next === 'RETIRED' && previous !== 'RETIRED') {
    throw new Error('퇴직은 인명관리의 [퇴직 처리]로 진행하세요.');
  }
  if (previous === undefined || previous === next) return null;
  return next === 'LEAVE' ? '잠금' : next === 'ACTIVE' ? '사용' : null;
}
