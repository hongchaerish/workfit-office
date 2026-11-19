import { scheduleChip } from '@/domain/commute/statusDisplay';
import type { DayEntry } from '@/domain/workPlan/dayEntries';
import { freeSlots, WORK_DAY } from '@/domain/workPlan/freeSlots';
import { toHHmm, toMinutes, type MinuteRange } from '@/domain/workPlan/timeGrid';
import { ENTRY_KIND_LABEL, entryKindOf, isLeave } from './entryKind';

/* 칸 옆 상세 창의 계산 — 바쁜 시간, 그날 상태, 오늘 '지금' 한 줄, 최근 적은 업무 제목. 화면 의존 없음. */

const MORNING_HALF: MinuteRange = { start: 540, end: 810 };
const AFTERNOON_HALF: MinuteRange = { start: 750, end: 1080 };
/** 종료 미정 업무가 막는 시간(분) */
const OPEN_END_MINUTES = 30;

/** 휴가 이름 — 결재 휴가는 종류(연차·오전반차…), 캘린더 휴가는 제목 */
function leaveLabelOf(entry: DayEntry): string {
  return entry.schedule ? scheduleChip(entry.schedule).label : entry.title;
}

/** 외근·출장 한 줄 이름 — '외근 · 고객사' */
function outsideLabelOf(entry: DayEntry): string {
  return `${ENTRY_KIND_LABEL[entryKindOf(entry)]} · ${entry.title}`;
}

/**
 * 그 항목이 막는 시간. 시각이 있으면 그대로(종료 없으면 30분), 종일 휴가·종일 외근/출장은 하루 전체,
 * 반차는 오전 09:00~13:30·오후 12:30~18:00, 종일·미정 업무는 막지 않는다(null).
 */
export function busyRangeOf(entry: DayEntry): MinuteRange | null {
  if (!entry.allDay && entry.startTime) {
    const start = toMinutes(entry.startTime);
    const end = entry.endTime ? toMinutes(entry.endTime) : start + OPEN_END_MINUTES;
    return end > start ? { start, end } : null;
  }
  if (isLeave(entry)) {
    const label = leaveLabelOf(entry);
    if (label.includes('오전')) return { ...MORNING_HALF };
    if (label.includes('오후')) return { ...AFTERNOON_HALF };
    return { ...WORK_DAY };
  }
  const kind = entryKindOf(entry);
  if (kind === 'outside' || kind === 'trip') return { ...WORK_DAY };
  return null;
}

export type DayStatus = { kind: 'office' } | { kind: 'leave'; label: string } | { kind: 'outside' | 'trip'; label: string };

/** 그날 상태 — 휴가가 외근·출장보다 먼저 */
export function dayStatusOf(entries: DayEntry[]): DayStatus {
  const leave = entries.find(isLeave);
  if (leave) return { kind: 'leave', label: leaveLabelOf(leave) };
  const out = entries.find((e) => {
    const k = entryKindOf(e);
    return k === 'outside' || k === 'trip';
  });
  if (out) {
    const kind = entryKindOf(out) as 'outside' | 'trip';
    return { kind, label: ENTRY_KIND_LABEL[kind] };
  }
  return { kind: 'office' };
}

const isFullDayAway = (entry: DayEntry) => {
  const r = busyRangeOf(entry);
  const k = entryKindOf(entry);
  return (k === 'leave' || k === 'outside' || k === 'trip') && r !== null && r.start <= WORK_DAY.start && r.end >= WORK_DAY.end;
};

/** 오늘 '지금' 한 줄(남의 칸) — 문구는 화면 설계서 4-2 그대로 */
export function nowLineOf(entries: DayEntry[], nowMinute: number): { tone: 'free' | 'busy' | 'outside' | 'away'; text: string } {
  const fullLeave = entries.find((e) => isLeave(e) && isFullDayAway(e));
  if (fullLeave) return { tone: 'away', text: `오늘 ${leaveLabelOf(fullLeave)}로 자리에 없습니다. 급한 일은 메시지를 남겨 주세요.` };
  const current = entries.find((e) => {
    const r = busyRangeOf(e);
    return r !== null && r.start <= nowMinute && nowMinute < r.end;
  });
  if (current) {
    const r = busyRangeOf(current)!;
    const kind = entryKindOf(current);
    if (kind === 'leave') return { tone: 'away', text: `지금 ${leaveLabelOf(current)} 중입니다.` };
    if (kind === 'outside' || kind === 'trip') return { tone: 'outside', text: `지금 ${outsideLabelOf(current)} 중 · ${toHHmm(r.end)}까지` };
    return { tone: 'busy', text: `지금 ${current.title} 중 · ${toHHmm(r.end)}에 끝나요` };
  }
  const next = entries
    .map((e) => ({ e, r: busyRangeOf(e) }))
    .filter((x): x is { e: DayEntry; r: MinuteRange } => x.r !== null && x.r.start > nowMinute)
    .sort((a, b) => a.r.start - b.r.start)[0];
  if (!next) return { tone: 'free', text: '지금은 비어 있어요 · 오늘 남은 일정 없음' };
  const title = isLeave(next.e) ? leaveLabelOf(next.e) : entryKindOf(next.e) === 'outside' || entryKindOf(next.e) === 'trip' ? outsideLabelOf(next.e) : next.e.title;
  return { tone: 'free', text: `지금은 비어 있어요 · 다음 일정 ${toHHmm(next.r.start)} ${title}` };
}

/** 그날 빈 시간 — 종일 휴가·종일 외근/출장이면 없음, 오늘이면 지금 이후 */
export function freeSlotsOfDay(entries: DayEntry[], opts: { isToday: boolean; nowMinute: number; lunch?: MinuteRange }): MinuteRange[] {
  if (entries.some(isFullDayAway)) return [];
  const busy = entries.map(busyRangeOf).filter((r): r is MinuteRange => r !== null);
  return freeSlots(busy, { lunch: opts.lunch, ...(opts.isToday ? { notBefore: opts.nowMinute } : {}) });
}

/** 최근 적은 업무 제목 — 일반 업무만, 같은 제목은 하나로. 입력은 최근 것부터 */
export function recentItemTitles(entriesNewestFirst: DayEntry[], limit = 5): string[] {
  const out: string[] = [];
  for (const e of entriesNewestFirst) {
    if (e.source !== 'ITEM') continue;
    const t = e.title.trim();
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= limit) break;
  }
  return out;
}

/** 상세 창을 Esc 로 닫을까 — 메모·입력칸이 먼저 처리한 Esc(취소)나 글 쓰는 중의 Esc 는 상세 창까지 닫지 않는다 */
export function escClosesPopover(e: {
  key: string;
  defaultPrevented: boolean;
  target: { tagName?: string; isContentEditable?: boolean } | null;
  /** 위에 모달(외근 상세 등)이 떠 있음 — 그 Esc 는 모달 몫 */
  modalOpen?: boolean;
}): boolean {
  if (e.key !== 'Escape' || e.defaultPrevented || e.modalOpen) return false;
  const t = e.target;
  if (!t) return true;
  if (t.isContentEditable) return false;
  return !['INPUT', 'TEXTAREA', 'SELECT'].includes((t.tagName ?? '').toUpperCase());
}
