/** 창 포커스마다 공용 설정을 다시 읽으면 창을 오갈 때마다 3건씩 나간다 — 마지막으로 읽은 지 1분 안이면 건너뛴다. */
export const FOCUS_REFRESH_MIN_MS = 60_000;

export function shouldRefreshOnFocus(lastAt: number, now: number): boolean {
  return now - lastAt > FOCUS_REFRESH_MIN_MS;
}
