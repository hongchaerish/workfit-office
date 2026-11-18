import type { MinuteRange } from './timeGrid';

/* 빈 시간 — 칸 옆 상세 창의 '비어 있는 시간', 일정 창의 첫 빈 시각·모두 가능한 시간이 같이 쓴다(분 단위). */

/** 근무 시간 9~18시 */
export const WORK_DAY: MinuteRange = { start: 540, end: 1080 };
/** 점심 기본값 12~13시 — 근태 정책이 없을 때. 빈 시간에서 뺀다 */
export const LUNCH: MinuteRange = { start: 720, end: 780 };

const toMinute = (hhmm: string | undefined) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** 시스템 점심시간 — 근태 정책의 휴게(점심) 시작·종료 시각. 없거나 이상하면 기본 12~13시 */
export function lunchRangeOf(policy: { breakStartTime?: string; breakEndTime?: string } | undefined | null): MinuteRange {
  const start = toMinute(policy?.breakStartTime);
  const end = toMinute(policy?.breakEndTime);
  return start !== null && end !== null && start < end ? { start, end } : LUNCH;
}

const STEP = 30;
const ceilTo = (minute: number, step: number) => Math.ceil(minute / step) * step;

interface FreeOptions {
  day?: MinuteRange;
  /** null 이면 점심을 빼지 않는다 */
  lunch?: MinuteRange | null;
  minLength?: number;
  /** 이 시각 이후만(30분 단위로 올림) — 오늘이면 지금 */
  notBefore?: number;
}

/** 바쁜 시간과 점심을 뺀 하루의 빈 구간 — minLength(기본 30분) 이상만 */
export function freeSlots(busy: MinuteRange[], opts: FreeOptions = {}): MinuteRange[] {
  const day = opts.day ?? WORK_DAY;
  const lunch = opts.lunch === undefined ? LUNCH : opts.lunch;
  const minLength = opts.minLength ?? STEP;
  const from = opts.notBefore === undefined ? day.start : Math.max(day.start, ceilTo(opts.notBefore, STEP));
  const blocks = [...busy, ...(lunch ? [lunch] : [])].sort((a, b) => a.start - b.start);
  const out: MinuteRange[] = [];
  let cursor = from;
  for (const b of blocks) {
    if (b.start - cursor >= minLength && b.start <= day.end) out.push({ start: cursor, end: Math.min(b.start, day.end) });
    cursor = Math.max(cursor, b.end);
  }
  if (day.end - cursor >= minLength) out.push({ start: cursor, end: day.end });
  return out.filter((r) => r.end - r.start >= minLength);
}

const overlaps = (a: MinuteRange, b: MinuteRange) => a.start < b.end && b.start < a.end;

/** 모든 목록이 함께 비는 첫 시작(분) — 점심에 걸치면 건너뛴다. 없으면 null */
export function firstFreeStart(
  busyLists: MinuteRange[][],
  length: number,
  opts: { day?: MinuteRange; lunch?: MinuteRange | null; notBefore?: number; step?: number } = {},
): number | null {
  const day = opts.day ?? WORK_DAY;
  const lunch = opts.lunch === undefined ? LUNCH : opts.lunch;
  const step = opts.step ?? STEP;
  const from = opts.notBefore === undefined ? day.start : Math.max(day.start, ceilTo(opts.notBefore, step));
  for (let t = from; t + length <= day.end; t += step) {
    const r = { start: t, end: t + length };
    if (lunch && overlaps(r, lunch)) continue;
    if (busyLists.every((list) => !list.some((b) => overlaps(r, b)))) return t;
  }
  return null;
}
