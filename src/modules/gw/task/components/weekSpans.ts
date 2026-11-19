import type { DayEntry } from '@/domain/workPlan/dayEntries';

/** 주간 표에서 여러 칸에 걸쳐 한 줄로 그릴 일정 — start·end 는 칸 번호(월=0 … 토·일=5), lane 은 위에서부터 몇 번째 줄 */
export interface WeekSpan {
  key: string;
  entry: DayEntry;
  start: number;
  end: number;
  lane: number;
}

/** 여러 날 외근·출장·휴가(결재·직접 등록) — 시작일과 끝날이 다른 것만 */
const isMultiDay = (e: DayEntry) => !!e.outside && e.outside.startDate !== e.outside.endDate;

/**
 * 한 사람의 한 주에서 여러 칸에 걸친 일정을 찾는다.
 * cols — 칸마다 그 칸의 날짜들(주말은 토·일 두 날이 한 칸). 두 칸 이상 이어질 때만 묶는다.
 */
export function weekSpans(cols: string[][], entriesOf: (date: string) => DayEntry[]): WeekSpan[] {
  const found = new Map<string, { entry: DayEntry; cols: number[] }>();
  cols.forEach((dates, c) => {
    for (const date of dates) {
      for (const entry of entriesOf(date)) {
        if (!isMultiDay(entry)) continue;
        const f = found.get(entry.key) ?? { entry, cols: [] };
        if (!f.cols.includes(c)) f.cols.push(c);
        found.set(entry.key, f);
      }
    }
  });
  // 이어진 칸끼리 묶는다(중간이 비면 따로)
  const runs: Omit<WeekSpan, 'lane'>[] = [];
  for (const [key, { entry, cols: cs }] of found) {
    cs.sort((a, b) => a - b);
    let start = cs[0];
    for (let i = 1; i <= cs.length; i++) {
      if (i < cs.length && cs[i] === cs[i - 1] + 1) continue;
      const end = cs[i - 1];
      if (end > start) runs.push({ key, entry, start, end });
      start = cs[i];
    }
  }
  runs.sort((a, b) => a.start - b.start || b.end - a.end);
  // 겹치면 아래 줄로 — 줄마다 마지막으로 쓴 칸
  const laneEnds: number[] = [];
  return runs.map((r) => {
    let lane = laneEnds.findIndex((end) => end < r.start);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = r.end;
    return { ...r, lane };
  });
}
