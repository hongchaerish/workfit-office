import { lunchRangeOf } from '@/domain/workPlan/freeSlots';
import type { MinuteRange } from '@/domain/workPlan/timeGrid';
import { useCommutePolicy } from '@/features/commute/useCommutePolicy';

/** 시스템 점심시간(근태 정책의 휴게 시각) — 업무계획 시간표 빗금·빈 시간 계산이 같이 쓴다 */
export function useLunchRange(): MinuteRange {
  const { policy } = useCommutePolicy();
  return lunchRangeOf(policy);
}
