/**
 * 업무계획 월간표의 여러 날 외근·출장 막대 배치 — 한 사람의 한 주(7칸) 단위.
 *
 * 하루짜리는 지금처럼 칸 안의 칩으로 그리고, 이틀 이상 일정만 칸을 가로지르는 막대로 그린다.
 * 겹치는 막대는 줄(lane)을 나눠 쌓고, 안 겹치면 같은 줄을 다시 쓴다.
 */
export interface SpanItem {
  key: string;
  startDate: string;
  endDate: string;
}

export interface WeekBar {
  key: string;
  /** 위에서부터 몇 번째 줄 */
  lane: number;
  /** 이번 주에서 시작하는 칸(0=첫 칸) */
  startIndex: number;
  /** 이번 주에서 차지하는 칸 수 */
  span: number;
  /** 지난주부터 이어짐 */
  continuesBefore: boolean;
  /** 다음 주로 이어짐 */
  continuesAfter: boolean;
}

export function layoutWeekBars(items: readonly SpanItem[], weekDates: readonly string[]): WeekBar[] {
  if (weekDates.length === 0) return [];
  const first = weekDates[0];
  const last = weekDates[weekDates.length - 1];
  const segments = items
    .filter((item) => item.startDate < item.endDate && item.startDate <= last && item.endDate >= first)
    .map((item) => {
      const from = item.startDate < first ? first : item.startDate;
      const to = item.endDate > last ? last : item.endDate;
      const startIndex = weekDates.indexOf(from);
      const endIndex = weekDates.indexOf(to);
      return { item, startIndex, span: endIndex - startIndex + 1 };
    })
    .filter((segment) => segment.startIndex >= 0 && segment.span >= 1)
    .sort((a, b) => a.startIndex - b.startIndex || b.span - a.span || a.item.key.localeCompare(b.item.key));

  const laneEnds: number[] = []; // 줄마다 마지막으로 차지한 칸
  return segments.map(({ item, startIndex, span }) => {
    let lane = laneEnds.findIndex((end) => end < startIndex);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = startIndex + span - 1;
    return {
      key: item.key,
      lane,
      startIndex,
      span,
      continuesBefore: item.startDate < first,
      continuesAfter: item.endDate > last,
    };
  });
}
