import type { CalendarEvent } from '@/domain/calendarEvent/schema';
import type { OutsideScheduleView } from '@/domain/outsideWork/view';
import type { User } from '@/domain/user/schema';
import type { DayEntry } from '@/domain/workPlan/dayEntries';
import { quickDefaultRange, type MinuteRange } from '@/domain/workPlan/timeGrid';
import type { EventKind, EventTarget } from './eventFormMapping';

/* 업무계획 칸·목록에서 일정 창을 여는 규칙(PC 표·모바일 목록 공용, 순수 함수). */

/** 본인 칸은 모든 종류, 다른 사람 칸은 회의 초대만 */
export const OWN_CELL_KINDS: EventKind[] = ['ITEM', 'MEETING', 'OUTSIDE', 'TRIP'];
export const OTHER_CELL_KINDS: EventKind[] = ['MEETING'];
/** 오늘이 아닌 날의 새 일정 기본 시간 09:00~09:30 */
export const DEFAULT_CREATE_RANGE: MinuteRange = { start: 540, end: 570 };

export type EntryRoute =
  | { sheet: EventTarget }
  | { calendar: CalendarEvent }
  | { outside: { view: OutsideScheduleView; entry: DayEntry } }
  | null;

/** 새 일정 — 그 날짜·그 사람 칸. 오늘이면 지금 다음 30분, 아니면 09:00~09:30 */
export function createTarget(
  date: string,
  member: User,
  actor: User,
  today: string,
  now: Date,
): Extract<EventTarget, { mode: 'create' }> {
  return {
    mode: 'create',
    date,
    owner: member,
    allowed: member.id === actor.id ? OWN_CELL_KINDS : OTHER_CELL_KINDS,
    initialRange: date === today ? quickDefaultRange(now) : { ...DEFAULT_CREATE_RANGE },
  };
}

/**
 * 칩·항목 누르기 — 고칠 수 있는 것(내 일반 항목, 내가 주최한 회의, 내가 등록한 외근·출장)은 수정, 그 외는 보기.
 * 결재 건·동행 외근은 기존 외근 상세, 회의 외 캘린더 일정은 캘린더 일정 창. 결재 휴가는 상세가 없다(null).
 */
export function routeEntry(entry: DayEntry, actor: User, actorActive: boolean): EntryRoute {
  const mode = (canEdit: boolean): 'edit' | 'view' => (canEdit && actorActive ? 'edit' : 'view');
  switch (entry.source) {
    case 'ITEM':
      return { sheet: { mode: mode(entry.item?.ownerUserId === actor.id), entry } };
    case 'MEETING':
      return { sheet: { mode: mode(entry.event?.ownerUserId === actor.id), entry } };
    case 'CALENDAR':
      return entry.event ? { calendar: entry.event } : null;
    case 'OUTSIDE':
      if (entry.companionOf) return entry.outside ? { outside: { view: entry.outside, entry } } : null;
      return { sheet: { mode: mode(entry.outside?.self?.ownerUserId === actor.id), entry } };
    case 'APPROVAL':
      // 휴가는 사유 비공개라 상세가 없다
      return entry.outside ? { outside: { view: entry.outside, entry } } : null;
  }
}

const isOutside = (kind: EventKind) => kind === 'OUTSIDE' || kind === 'TRIP';

/** 종류 버튼을 누를 수 있나 — 새 일정은 허용 목록 안, 수정은 같은 출처 안(외근↔출장, 일반 태그끼리)만 */
export function kindEnabled(kind: EventKind, target: EventTarget, currentKind: EventKind, readOnly: boolean): boolean {
  if (readOnly) return false;
  if (target.mode === 'create') return target.allowed.includes(kind);
  return kind === currentKind || (isOutside(kind) && isOutside(currentKind));
}
