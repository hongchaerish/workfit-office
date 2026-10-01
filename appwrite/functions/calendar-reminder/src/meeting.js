/**
 * 리마인더 대상 판정 — 웹 `src/domain/calendarEvent/meeting.ts`와 같은 규칙(바꾸면 함께 바꿀 것).
 *
 * 일정 문서에는 eventType·attendeeUserIds 속성이 없고 메모 안 `[CAL_META:{…}]`에 인코딩돼 있다
 * (src/data/calendarEvent/calendarEvent.repo.ts). 예전 함수는 이걸 읽지 않아 회의 참석자가
 * 리마인더를 못 받았다.
 */
const CAL_META_REGEX = /\[CAL_META:(\{.*?\})\]/;

export function calMetaOf(event) {
  const match = String(event?.memo ?? '').match(CAL_META_REGEX);
  if (!match) return {};
  try {
    return JSON.parse(match[1]) ?? {};
  } catch {
    return {};
  }
}

export function eventTypeOf(event) {
  const meta = calMetaOf(event);
  if (meta.eventType) return meta.eventType;
  if (event?.eventType) return event.eventType;
  const title = String(event?.title ?? '');
  if (title.includes('[회의]') || title.includes('[미팅]')) return 'MEETING';
  return 'GENERAL';
}

export function attendeesOf(event) {
  const meta = calMetaOf(event);
  const list = Array.isArray(meta.attendeeUserIds) ? meta.attendeeUserIds : Array.isArray(event?.attendeeUserIds) ? event.attendeeUserIds : [];
  return list.filter((id) => typeof id === 'string' && id);
}

/** 회의는 공개 범위와 무관하게 주최자 + 참석자만. 그 밖의 일정은 null(공개 범위 규칙으로 판정). */
export function meetingReminderTargets(event) {
  if (eventTypeOf(event) !== 'MEETING') return null;
  return [...new Set([event.ownerUserId, ...attendeesOf(event)])];
}
