import type { CommutePolicy } from './schema';

const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** 휴게 시각에서 휴게 분(시작이 종료보다 늦으면 0). */
export function breakMinutesOf(start: string, end: string): number {
  return Math.max(0, minutesOf(end) - minutesOf(start));
}

/**
 * 근무·휴게 시각이 말이 되는지 — 저장 전에 확인한다. 문제가 없으면 null.
 * 시간 입력 칸은 오전·오후를 골라야 해서 '오후 11:30'처럼 잘못 고르기 쉽다.
 */
export function policyTimeError(p: Pick<CommutePolicy, 'workStartTime' | 'workEndTime' | 'breakStartTime' | 'breakEndTime'>): string | null {
  const ws = minutesOf(p.workStartTime);
  const we = minutesOf(p.workEndTime);
  const bs = minutesOf(p.breakStartTime);
  const be = minutesOf(p.breakEndTime);
  if (ws >= we) return '퇴근 시각은 출근 시각보다 늦어야 합니다. 오전·오후를 확인하세요.';
  if (bs >= be) return '휴게 종료는 휴게 시작보다 늦어야 합니다. 오전·오후를 확인하세요.';
  if (bs < ws || be > we) return '휴게 시간은 근무시간 안이어야 합니다. 오전·오후를 확인하세요.';
  return null;
}
