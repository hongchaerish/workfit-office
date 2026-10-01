import type { CalendarEvent, CalendarVisibility } from './schema';

/**
 * 회의 규칙 — "회의 1건 = 캘린더 일정 1건 + 참석자".
 * (docs/업무계획_회의등록_구현계획서.md)
 *
 * - 회의는 전사에 보이되(기본 COMPANY), 알림은 관계자에게만 간다.
 *   생성 알림 = 참석자, 10분 전 리마인더 = 주최자 + 참석자. 전 직원 발송은 없다.
 * - 같은 회의를 또 만들려 하면 비슷한 회의를 찾아 "참석자로 합류"를 제안한다.
 *   자동으로 합치지는 않는다 — 판정이 틀릴 수 있으니 고르는 건 사람이다.
 *
 * ⚠ appwrite/functions/calendar-reminder 도 같은 리마인더 대상 규칙을 쓴다. 바꾸면 함께 바꿀 것.
 */

export const MEETING_DEFAULT_VISIBILITY: CalendarVisibility = 'COMPANY';

export const isMeeting = (event: Pick<CalendarEvent, 'eventType'>): boolean => event.eventType === 'MEETING';

/** 제목 비교용 — [회의]/[미팅] 접두, 이모지, 공백·기호를 걷어 내고 소문자로. */
export function normalizeMeetingTitle(title: string): string {
  return title
    .replace(/\[(회의|미팅)\]/g, '')
    .replace(/[\p{Extended_Pictographic}️]/gu, '')
    .replace(/[\s\p{P}\p{S}]/gu, '')
    .toLowerCase();
}

function isSimilarTitle(a: string, b: string): boolean {
  const na = normalizeMeetingTitle(a);
  const nb = normalizeMeetingTitle(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // 한 글자짜리는 포함 관계로 엮이기 쉬워서 일치할 때만 같다고 본다.
  if (na.length < 2 || nb.length < 2) return false;
  return na.includes(nb) || nb.includes(na);
}

type TimeRange = Pick<CalendarEvent, 'allDay' | 'startTime' | 'endTime'>;

function timesOverlap(a: TimeRange, b: TimeRange): boolean {
  if (a.allDay || b.allDay || !a.startTime || !a.endTime || !b.startTime || !b.endTime) return true;
  return a.startTime < b.endTime && b.startTime < a.endTime;
}

export interface MeetingProbe extends TimeRange {
  date: string;
  title: string;
}

/** 같은 날, 시간이 겹치고, 제목이 비슷한 회의. `excludeId`는 수정 중인 자기 자신. */
export function findSimilarMeetings(events: CalendarEvent[], probe: MeetingProbe, excludeId?: string): CalendarEvent[] {
  return events.filter(
    (e) =>
      isMeeting(e) &&
      e.id !== excludeId &&
      e.date === probe.date &&
      timesOverlap(e, probe) &&
      isSimilarTitle(e.title, probe.title),
  );
}

/** 참석자로 합류할 수 있는가 — 회의이고, 주최자도 기존 참석자도 아닐 때. */
export function canJoinMeeting(userId: string, event: CalendarEvent): boolean {
  return isMeeting(event) && event.ownerUserId !== userId && !event.attendeeUserIds.includes(userId);
}

const unique = (ids: string[]) => [...new Set(ids)];

/** 회의 생성(초대) 알림 대상 — 참석자만. 주최자 본인은 받지 않는다. */
export function meetingNotifyTargets(event: Pick<CalendarEvent, 'ownerUserId' | 'attendeeUserIds'>): string[] {
  return unique(event.attendeeUserIds).filter((id) => id !== event.ownerUserId);
}

/** 10분 전 리마인더 대상 — 주최자 + 참석자. */
export function meetingReminderTargets(event: Pick<CalendarEvent, 'ownerUserId' | 'attendeeUserIds'>): string[] {
  return unique([event.ownerUserId, ...event.attendeeUserIds]);
}
