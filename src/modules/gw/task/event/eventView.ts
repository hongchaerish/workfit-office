import { isValidCalendarDate } from '@/domain/calendarEvent/calendarDate';
import { toHHmm } from '@/domain/workPlan/timeGrid';
import type { DayEntry } from '@/domain/workPlan/dayEntries';
import { initialStateFromEntry, type EventFormState } from './eventFormMapping';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/** 'YYYY-MM-DD' → 'M월 D일 (요일)' */
export function dateLabel(date: string): string {
  if (!isValidCalendarDate(date)) return '';
  const [y, m, d] = date.split('-').map(Number);
  return `${m}월 ${d}일 (${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]})`;
}

/* 일정 보기(읽기 전용) — 편집 칸 대신 한 줄씩 보여 줄 내용. 빈 칸은 뺀다. */

export type ViewFactId = 'when' | 'place' | 'transport' | 'people' | 'contact' | 'memo';
export interface ViewFact {
  id: ViewFactId;
  text: string;
}
export interface EventView {
  kindLabel: string;
  title: string;
  facts: ViewFact[];
}

function timeText(state: EventFormState): string {
  if (state.kind !== 'MEETING' && state.allDay) return state.kind === 'ITEM' ? '시간 미정' : '종일';
  if (!state.range) return '';
  if (state.kind === 'ITEM' && state.openEnd) return `${toHHmm(state.range.start)}~`;
  return `${toHHmm(state.range.start)}~${toHHmm(state.range.end)}`;
}

export function eventViewOf(
  state: EventFormState,
  opts: { ownerId: string; nameOf: (id: string) => string; tagName?: string; place?: string },
): EventView {
  const outside = state.kind === 'OUTSIDE' || state.kind === 'TRIP';
  const kindLabel =
    state.kind === 'ITEM' ? opts.tagName || '업무' : state.kind === 'MEETING' ? '회의' : state.kind === 'TRIP' ? state.subType || '출장' : '외근';
  const purpose = state.purpose.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? '';
  const title = outside ? purpose || state.destination.trim() || kindLabel : state.title.trim();

  const range = outside && state.endDate > state.date ? `${dateLabel(state.date)} ~ ${dateLabel(state.endDate)}` : dateLabel(state.date);
  const time = timeText(state);
  const people = (outside ? state.companionIds.filter((id) => id !== opts.ownerId) : state.kind === 'MEETING' ? state.attendeeIds : [])
    .map(opts.nameOf)
    .filter(Boolean)
    .join(', ');
  const place = outside ? state.destination : state.kind === 'MEETING' ? opts.place ?? state.locationText : '';

  const facts: ViewFact[] = [
    { id: 'when', text: time ? `${range} · ${time}` : range },
    { id: 'place', text: place.trim() === title ? '' : place.trim() },
    { id: 'transport', text: outside ? state.transportation.trim() : '' },
    { id: 'people', text: people },
    { id: 'contact', text: outside ? state.contact.trim() : '' },
    { id: 'memo', text: state.memo.trim() },
  ];
  return { kindLabel, title, facts: facts.filter((f) => f.text) };
}

/** 그날 일정 줄 앞 시각 — 종일, '09:00~10:30', 시작만이면 '12:30~'. 시간 없는 업무는 빈 글 */
export function entryTimeLabel(entry: DayEntry): string {
  if (entry.allDay) return entry.source === 'ITEM' ? '' : '종일';
  if (!entry.startTime) return '';
  return `${entry.startTime}~${entry.endTime ?? ''}`;
}

/** 그날 일정 한 건의 보기 내용 — 업무·회의·외근은 입력값에서, 결재·달력 일정은 제목과 날짜만 */
export function entryViewOf(entry: DayEntry, date: string, opts: { ownerId: string; nameOf: (id: string) => string }): EventView {
  if (entry.item || entry.event || entry.outside) {
    return eventViewOf(initialStateFromEntry(entry, null), {
      ...opts,
      tagName: entry.tag?.name,
      place: entry.event?.location ?? undefined,
    });
  }
  const time = entryTimeLabel(entry);
  return {
    kindLabel: entry.source === 'APPROVAL' ? '결재' : '일정',
    title: entry.title,
    facts: [{ id: 'when', text: time ? `${dateLabel(date)} · ${time}` : dateLabel(date) }],
  };
}
