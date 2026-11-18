import { useMemo } from 'react';
import { calendarToday } from '@/domain/calendarEvent/calendarDate';
import type { User } from '@/domain/user/schema';
import { sourceIdOf, type DayCell, type DayEntry } from '@/domain/workPlan/dayEntries';
import { firstFreeStart } from '@/domain/workPlan/freeSlots';
import { toHHmm, type MinuteRange } from '@/domain/workPlan/timeGrid';
import { busyRangeOf } from '../components/dayDetail';
import { LINE_TONE_CLASS } from '../components/EntryLine';
import type { LineTone } from '../components/entryKind';
import type { EventForm } from './EventFields';
import type { EventTarget } from './useWorkPlanEventForm';

/* 일정 창 도움 — 내 일정 겹침, 참석자 바쁨, 참석자 모두 가능한 시간, 팀원 화면 미리보기 */

/** 모두 가능한 시간 버튼 수 */
const MAX_FITS = 4;

const overlaps = (a: MinuteRange, b: MinuteRange) => a.start < b.end && b.start < a.end;

export interface EventConflicts {
  /** 고른 시간과 겹치는 내 일정 */
  mine: DayEntry | null;
  /** 고른 시간에 다른 일정이 있는 참석자 */
  busyNames: string[];
  /** 회의·참석자 있음·아무도 안 바쁨 */
  allFree: boolean;
  /** 참석자 모두 비는 시작 시각(분) */
  fits: number[];
  /** 그 사람이 고른 시간에 바쁜가 — 참석자 검색에 '이 시간 바쁨' */
  busyAt: (userId: string) => boolean;
}

/** 겹침 계산 — 고치는 일정 자신은 뺀다 */
export function useEventConflicts(form: EventForm, target: EventTarget, ownerId: string, actorId: string, users: User[], cellOf: (userId: string, date: string) => DayCell): EventConflicts {
  const { state } = form;
  const editingId = target.mode === 'create' ? null : sourceIdOf(target.entry);
  return useMemo(() => {
    const entriesOf = (userId: string) => cellOf(userId, state.date).entries.filter((e) => sourceIdOf(e) !== editingId);
    const busyOf = (userId: string) => entriesOf(userId).map(busyRangeOf).filter((r): r is MinuteRange => r !== null);
    const range = !state.allDay && state.range ? state.range : null;
    const busyAt = (userId: string) => (range ? busyOf(userId).some((r) => overlaps(r, range)) : false);

    const mine = range ? entriesOf(ownerId).find((e) => {
      const r = busyRangeOf(e);
      return r !== null && overlaps(r, range);
    }) ?? null : null;

    const isMeeting = state.kind === 'MEETING';
    const attendees = isMeeting ? state.attendeeIds.filter((id) => id !== ownerId) : [];
    const busyNames = attendees.filter(busyAt).map((id) => users.find((u) => u.id === id)?.name ?? '').filter(Boolean);
    const allFree = isMeeting && attendees.length > 0 && range !== null && busyNames.length === 0 && !mine;

    const fits: number[] = [];
    if (isMeeting && attendees.length > 0) {
      const lists = [...new Set([ownerId, actorId, ...attendees])].map(busyOf);
      const length = range ? range.end - range.start : 60;
      const today = calendarToday();
      const now = new Date();
      let notBefore = state.date === today ? now.getHours() * 60 + now.getMinutes() : undefined;
      while (fits.length < MAX_FITS) {
        const t = firstFreeStart(lists, length, notBefore === undefined ? {} : { notBefore });
        if (t === null) break;
        fits.push(t);
        notBefore = t + length;
      }
    }
    return { mine, busyNames, allFree, fits, busyAt };
  }, [cellOf, state.date, state.allDay, state.range, state.kind, state.attendeeIds, editingId, ownerId, actorId, users]);
}

const KIND_TONE: Record<string, LineTone> = { ITEM: 'item', MEETING: 'meeting', OUTSIDE: 'outside', TRIP: 'outside' };

/** 왼쪽 맨 아래 — 안내 상자 + 팀원 화면 미리보기 */
export function EventAssist({ form, conflicts }: { form: EventForm; conflicts: EventConflicts }) {
  const { state } = form;
  const isOutside = state.kind === 'OUTSIDE' || state.kind === 'TRIP';
  const time = state.allDay || !state.range ? (isOutside ? '종일' : '미정') : toHHmm(state.range.start);
  const title = isOutside
    ? `${state.kind === 'TRIP' ? '출장' : '외근'} · ${state.destination.trim() || '행선지'}`
    : state.title.trim() || (state.kind === 'MEETING' ? '회의 제목' : '제목');

  return (
    <div className="mt-4 space-y-2.5">
      {conflicts.mine && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          내 일정 「{conflicts.mine.title}」({conflicts.mine.startTime ?? '종일'})와 시간이 겹쳐요. 그래도 저장할 수 있어요.
        </p>
      )}
      {conflicts.busyNames.length > 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          {conflicts.busyNames.join(', ')} 님이 이 시간에 다른 일정이 있어요. 오른쪽에서 모두 가능한 시간을 골라 보세요.
        </p>
      )}
      {conflicts.allFree && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-[12px] text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">참석자 모두 이 시간에 비어 있어요.</p>
      )}
      <div className="border-t border-dashed border-border pt-2.5">
        <div className="mb-1 text-[11px] text-ink3">팀원 화면에는 이렇게 보여요</div>
        <div className={`flex items-center gap-1 border-l-2 pl-1.5 text-[11.5px] ${LINE_TONE_CLASS[KIND_TONE[state.kind] ?? 'item']}`}>
          <span className="w-[2.8em] shrink-0 text-[10.5px] tabular-nums text-ink3">{time}</span>
          <span className="truncate">{title}</span>
        </div>
      </div>
    </div>
  );
}
