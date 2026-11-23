import type { DayEntry } from '@/domain/workPlan/dayEntries';

/* 칸 항목의 큰 갈래 — 화면 의존 없는 순수 함수(테스트에서 바로 부른다). */

/** 휴가 — 종류(연차·반차 등)가 제목에 있으므로 시각 칸은 비운다 */
export const isLeave = (entry: DayEntry) =>
  (entry.source === 'APPROVAL' && entry.schedule?.category === 'LEAVE') ||
  (entry.source === 'CALENDAR' && entry.event?.eventType === 'VACATION');

export type EntryKind = 'meeting' | 'outside' | 'trip' | 'leave' | 'item';

/** 칸 항목의 큰 갈래 — 하루 요약 숫자·걸러 보기·시간표 색이 같이 쓴다 */
export function entryKindOf(entry: DayEntry): EntryKind {
  if (isLeave(entry)) return 'leave';
  switch (entry.source) {
    case 'ITEM':
      return 'item';
    case 'MEETING':
      return 'meeting';
    case 'CALENDAR':
      return entry.event?.eventType === 'OUTSIDE' ? 'outside' : 'meeting';
    case 'OUTSIDE':
      return entry.outside?.category === 'TRIP' ? 'trip' : 'outside';
    case 'APPROVAL':
      return entry.schedule?.category === 'TRIP' ? 'trip' : 'outside';
  }
}

export const ENTRY_KIND_LABEL: Record<EntryKind, string> = {
  meeting: '회의',
  outside: '외근',
  trip: '출장',
  leave: '휴가',
  item: '업무',
};
