import type { CommutePolicy } from '@/domain/commutePolicy/schema';
import { isValidCalendarDate } from '@/domain/calendarEvent/calendarDate';
import { MEETING_DEFAULT_VISIBILITY } from '@/domain/calendarEvent/meeting';
import { calendarEventSchema, type CalendarEventDraft, type CalendarVisibility } from '@/domain/calendarEvent/schema';
import { OUTSIDE_WORK_SUBTYPES, outsideWorkSchema, type OutsideWorkDraft } from '@/domain/outsideWork/schema';
import type { OutsideScheduleView } from '@/domain/outsideWork/view';
import type { Reservation } from '@/domain/reservation/schema';
import { RESOURCE_UTC_OFFSET } from '@/domain/reservation/time';
import type { User } from '@/domain/user/schema';
import type { DayEntry } from '@/domain/workPlan/dayEntries';
import { workPlanItemSchema, type WorkPlanItemDraft } from '@/domain/workPlan/item';
import { DAY_END, toHHmm, toMinutes, type MinuteRange } from '@/domain/workPlan/timeGrid';
import type { TimeGridBlock } from './TimeGrid';

/*
  업무계획 일정 창의 순수 변환 — 창 상태 ↔ 저장 초안. 훅(useWorkPlanEventForm)은 이것만 써서
  상태를 만들고 저장 직전에 초안으로 바꾼다. 검증은 각 저장소 스키마를 그대로 써서 첫 오류 문구만 돌려준다.
*/

export type EventKind = 'ITEM' | 'MEETING' | 'OUTSIDE' | 'TRIP';

export type EventTarget =
  // 남의 칸이면 allowed = ['MEETING']. initialRange = 처음 시간 구간(주면 종일 아님으로 시작)
  | { mode: 'create'; date: string; owner: User; allowed: EventKind[]; initialRange?: MinuteRange }
  | { mode: 'edit'; entry: DayEntry } // ITEM·MEETING·OUTSIDE(본인 등록)
  | { mode: 'view'; entry: DayEntry };

export interface EventFormState {
  kind: EventKind;
  tagId: string;
  title: string;
  date: string;
  endDate: string;
  allDay: boolean;
  range: MinuteRange | null;
  /** 업무만 — 종료 미정(시작만 저장). range 는 시간표에 그릴 30분 자리 */
  openEnd: boolean;
  memo: string;
  attendeeIds: string[];
  visibility: CalendarVisibility;
  locationMode: 'text' | 'room';
  locationText: string;
  roomId: string | null;
  subType: string;
  destination: string;
  purpose: string;
  companionIds: string[];
  transportation: string;
  contact: string;
}

const isOutsideKind = (kind: EventKind): kind is 'OUTSIDE' | 'TRIP' => kind === 'OUTSIDE' || kind === 'TRIP';

/** 종료 미정 항목을 시간표에 그릴 자리 — 시작부터 30분 */
export function openRangeOf(startTime: string): MinuteRange {
  const start = toMinutes(startTime);
  return { start, end: Math.min(start + 30, DAY_END) };
}

function rangeOf(startTime: string | null | undefined, endTime: string | null | undefined): MinuteRange | null {
  if (!startTime || !endTime) return null;
  return { start: toMinutes(startTime), end: toMinutes(endTime) };
}

function blankState(date: string): EventFormState {
  return {
    kind: 'ITEM',
    tagId: '',
    title: '',
    date,
    endDate: date,
    allDay: false,
    range: null,
    openEnd: false,
    memo: '',
    attendeeIds: [],
    visibility: MEETING_DEFAULT_VISIBILITY,
    locationMode: 'text',
    locationText: '',
    roomId: null,
    subType: '',
    destination: '',
    purpose: '',
    companionIds: [],
    transportation: '',
    contact: '',
  };
}

/** 새 일정 — 일반이 허용되면 일반(첫 일반 태그), 아니면 허용 목록 첫 값. 남의 칸이면 칸 주인을 참석자로. */
export function initialCreateState(
  target: Extract<EventTarget, { mode: 'create' }>,
  actorId: string,
  firstTagId: string,
): EventFormState {
  const kind: EventKind = target.allowed.includes('ITEM') ? 'ITEM' : target.allowed[0] ?? 'ITEM';
  const base = blankState(target.date);
  const start: EventFormState = {
    ...base,
    kind,
    tagId: firstTagId,
    allDay: isOutsideKind(kind),
    subType: isOutsideKind(kind) ? OUTSIDE_WORK_SUBTYPES[kind][0] : '',
    attendeeIds: target.owner.id !== actorId ? [target.owner.id] : [],
  };
  return target.initialRange ? applyRangeChange(start, { ...target.initialRange }) : start;
}

function fromOutsideView(view: OutsideScheduleView, date: string): EventFormState {
  const self = view.self;
  if (self) {
    return {
      ...blankState(self.startDate),
      kind: self.category,
      endDate: self.endDate,
      allDay: self.allDay,
      range: self.allDay ? null : rangeOf(self.startTime, self.endTime),
      memo: self.memo,
      subType: self.subType,
      destination: self.destination,
      purpose: self.purpose,
      companionIds: [...self.companionUserIds],
      transportation: self.transportation,
      contact: self.contact,
    };
  }
  // 결재 완료 건(보기 전용) — 표시 모델에 있는 값만
  const range = rangeOf(view.startTime, view.endTime);
  return {
    ...blankState(view.startDate || date),
    kind: view.category,
    endDate: view.endDate || view.startDate || date,
    allDay: range === null,
    range,
    memo: view.memo ?? '',
    subType: view.subType,
    destination: view.destination ?? '',
    purpose: view.purpose ?? '',
    transportation: view.transportation ?? '',
    contact: view.contact ?? '',
  };
}

/**
 * 기존 칸 → 창 상태(수정·보기). `linkedRoomId` = 회의의 연결 예약이 잡은 회의실 자원 id
 * (예약을 찾았을 때만). 연결 예약이 있으면 회의실 선택으로 연다.
 */
export function initialStateFromEntry(entry: DayEntry, linkedRoomId: string | null): EventFormState {
  if (entry.item) {
    const item = entry.item;
    return {
      ...blankState(item.date),
      kind: 'ITEM',
      tagId: item.tagId,
      title: item.title,
      allDay: item.allDay,
      range: item.allDay ? null : item.startTime && !item.endTime ? openRangeOf(item.startTime) : rangeOf(item.startTime, item.endTime),
      openEnd: !item.allDay && Boolean(item.startTime) && !item.endTime,
      memo: item.memo,
    };
  }
  if (entry.event) {
    const ev = entry.event;
    const roomMode = Boolean(ev.reservationId);
    return {
      ...blankState(ev.date),
      kind: 'MEETING',
      title: ev.title,
      allDay: ev.allDay,
      range: ev.allDay ? null : rangeOf(ev.startTime, ev.endTime),
      memo: ev.memo,
      attendeeIds: [...ev.attendeeUserIds],
      visibility: ev.visibility,
      locationMode: roomMode ? 'room' : 'text',
      locationText: ev.location ?? '',
      roomId: roomMode ? linkedRoomId : null,
    };
  }
  if (entry.outside) {
    return fromOutsideView(entry.outside, entry.schedule?.startDate ?? '');
  }
  return { ...blankState(''), title: entry.title };
}

/** 외근 오전·오후를 나누는 시각 — 기존 등록 창(OutsideWorkFormModal)과 같은 값. */
const MIDDAY = '13:00';

export type SubTypePolicy = Pick<CommutePolicy, 'workStartTime' | 'workEndTime'>;

/**
 * 세부 구분을 고르면 시간을 맞춘다(기존 등록 창 pickSubType과 같은 규칙) —
 * 오전 = 근무 시작~13:00, 오후 = 13:00~근무 끝, 시간 외근 = 시간 일정(구간 유지), 그 밖(종일·출장) = 종일.
 */
export function applySubType(state: EventFormState, subType: string, policy: SubTypePolicy): EventFormState {
  if (subType === '오전 외근') {
    return { ...state, subType, allDay: false, range: { start: toMinutes(policy.workStartTime), end: toMinutes(MIDDAY) } };
  }
  if (subType === '오후 외근') {
    return { ...state, subType, allDay: false, range: { start: toMinutes(MIDDAY), end: toMinutes(policy.workEndTime) } };
  }
  if (subType === '시간 외근') return { ...state, subType, allDay: false };
  return { ...state, subType, allDay: true, range: null };
}

/**
 * 시간 바꾸기(왼쪽 시각 칸·시간표 공용) — 종일을 끄고, 외근이면 세부 구분을 '시간 외근'으로 맞춘다
 * (근태 판정이 세부 구분을 보므로 시각과 구분이 어긋나지 않게). 출장은 세부 구분에 시간이 없어 그대로.
 */
export function applyRangeChange(state: EventFormState, range: MinuteRange): EventFormState {
  if (state.kind === 'OUTSIDE') return { ...state, range, allDay: false, subType: '시간 외근', openEnd: false };
  // 시간표로 끝을 정하면 종료 미정은 풀린다
  return { ...state, range, allDay: false, openEnd: false };
}

/** 날짜 바꾸기 — 여러 날 외근·출장은 종료일이 시작일보다 앞서지 않게. 빈 값이면 그대로. */
export function applyDateChange(state: EventFormState, date: string): EventFormState {
  if (!date) return state;
  return { ...state, date, endDate: state.endDate < date ? date : state.endDate };
}

/** 종일 켜고 끄기 — 외근은 '종일 외근' ↔ '시간 외근'(세부 구분 시간 규칙), 회의는 종일이 없다. */
export function applyAllDayToggle(state: EventFormState, allDay: boolean, policy: SubTypePolicy): EventFormState {
  if (state.kind === 'MEETING') return state;
  if (state.kind === 'OUTSIDE') return applySubType(state, allDay ? '종일 외근' : '시간 외근', policy);
  return { ...state, allDay };
}

const OCCUPYING_RESERVATION: readonly Reservation['status'][] = ['PENDING', 'CONFIRMED'];

/**
 * 고른 회의실의 그날 예약 → 시간표 블록(대기·확정만). 분은 회의실 시간대 기준이고 날을 넘으면 그날 안으로 자른다.
 * `ignoreReservationId` = 고치는 회의의 연결 예약(자기 자신은 겹쳐 보이지 않게).
 */
export function roomDayBlocks(
  reservations: Reservation[],
  roomId: string,
  date: string,
  ignoreReservationId: string | null,
): TimeGridBlock[] {
  const dayStart = new Date(`${date}T00:00:00${RESOURCE_UTC_OFFSET}`).getTime();
  if (Number.isNaN(dayStart)) return [];
  const blocks: TimeGridBlock[] = [];
  for (const row of reservations) {
    if (row.resourceId !== roomId || row.id === ignoreReservationId || !OCCUPYING_RESERVATION.includes(row.status)) continue;
    const start = Math.max((new Date(row.startAt).getTime() - dayStart) / 60000, 0);
    const end = Math.min((new Date(row.endAt).getTime() - dayStart) / 60000, DAY_END);
    if (!(end > start)) continue;
    blocks.push({ key: `room-${row.id}`, start, end, label: `회의실 예약 · ${row.title}`, tone: 'room' });
  }
  return blocks.sort((a, b) => a.start - b.start);
}

export const ROOM_LOADING_MESSAGE = '회의실 정보를 불러오는 중입니다. 잠시 후 다시 저장하세요.';
export const ROOM_LOAD_FAILED_MESSAGE = '회의실 정보를 불러오지 못했습니다. 다시 시도해 주세요.';

/**
 * 고치는 회의의 연결 예약 읽기 결과 → 회의실 칸. 읽는 중·읽기 실패면 회의실 모드를 지키고 저장을 막는다 —
 * 방 없이 저장하면 saveMeeting이 연결 예약을 해제해 버리기 때문. 읽었는데 없을 때만 장소 글로 연다.
 */
export function linkedRoomState(read: { status: 'pending' | 'error' | 'success'; reservation: Reservation | null }): {
  mode: 'text' | 'room';
  roomId: string | null;
  blockReason: string | null;
} {
  if (read.status === 'pending') return { mode: 'room', roomId: null, blockReason: ROOM_LOADING_MESSAGE };
  if (read.status === 'error') return { mode: 'room', roomId: null, blockReason: ROOM_LOAD_FAILED_MESSAGE };
  if (!read.reservation) return { mode: 'text', roomId: null, blockReason: null };
  return { mode: 'room', roomId: read.reservation.resourceId, blockReason: null };
}

/**
 * 종류 바꾸기. 새 일정은 허용 목록 안에서만, 수정은 같은 출처 안에서만(외근↔출장),
 * 보기는 바꾸지 않는다. 바꿀 수 없으면 같은 상태 객체를 그대로 돌려준다.
 * 외근·출장 구분이 바뀌면 세부 구분을 첫 값으로 고르고 그 시간 규칙을 따른다.
 */
export function switchKind(
  state: EventFormState,
  next: EventKind,
  rule: { mode: EventTarget['mode']; allowed: EventKind[] },
  policy: SubTypePolicy,
): EventFormState {
  if (state.kind === next || rule.mode === 'view') return state;
  if (rule.mode === 'create' && !rule.allowed.includes(next)) return state;
  if (rule.mode === 'edit' && !(isOutsideKind(state.kind) && isOutsideKind(next))) return state;
  if (isOutsideKind(next)) return applySubType({ ...state, kind: next }, OUTSIDE_WORK_SUBTYPES[next][0], policy);
  // 회의는 시각이 필수, 종료 미정은 업무만
  return { ...state, kind: next, allDay: next === 'MEETING' ? false : state.allDay, openEnd: next === 'ITEM' && state.openEnd };
}

function timesOf(state: EventFormState): { startTime: string | null; endTime: string | null } {
  if (state.allDay || !state.range) return { startTime: null, endTime: null };
  return { startTime: toHHmm(state.range.start), endTime: toHHmm(state.range.end) };
}

export function toItemDraft(state: EventFormState): WorkPlanItemDraft {
  const times = timesOf(state);
  return {
    date: state.date,
    allDay: state.allDay,
    ...times,
    endTime: state.openEnd ? null : times.endTime,
    tagId: state.tagId,
    title: state.title,
    memo: state.memo,
  };
}

/**
 * 회의 초안 — 종일 없음, 참석자에서 주최자 제외. 회의실이면 장소 = 방 이름(저장 때 예약 이름으로 맞춰진다).
 * `projectId` = 고치는 회의의 기존 프로젝트(이 창엔 프로젝트 고르기가 없어 프로젝트 공유 회의는 그대로 둔다).
 */
export function toMeetingDraft(
  state: EventFormState,
  ctx: { organizerId: string; deptId: string | null; roomName: string | null; projectId: string | null },
): CalendarEventDraft {
  const { startTime, endTime } = timesOf({ ...state, allDay: false });
  return {
    title: state.title,
    date: state.date,
    allDay: false,
    startTime,
    endTime,
    memo: state.memo,
    visibility: state.visibility,
    eventType: 'MEETING',
    attendeeUserIds: [...new Set(state.attendeeIds)].filter((id) => id !== ctx.organizerId),
    deptId: state.visibility === 'TEAM' ? ctx.deptId ?? null : null,
    projectId: state.visibility === 'PROJECT' ? ctx.projectId : null,
    location: state.locationMode === 'text' ? state.locationText.trim() || null : ctx.roomName,
  };
}

/** 회의실 예약 목적 — 안건(메모), 비면 "회의". */
export function meetingPurpose(state: EventFormState): string {
  return state.memo.trim() || '회의';
}

export function toOutsideDraft(state: EventFormState, actorId: string): OutsideWorkDraft {
  const category = isOutsideKind(state.kind) ? state.kind : 'OUTSIDE';
  return {
    category,
    subType: state.subType || OUTSIDE_WORK_SUBTYPES[category][0],
    startDate: state.date,
    endDate: state.endDate && state.endDate >= state.date ? state.endDate : state.date,
    allDay: state.allDay,
    ...timesOf(state),
    destination: state.destination,
    purpose: state.purpose,
    companionUserIds: state.companionIds.filter((id) => id !== actorId),
    transportation: state.transportation,
    contact: state.contact,
    memo: state.memo,
  };
}

const firstIssue = (issues: Array<{ message: string }>): string => issues[0]?.message || '입력값을 확인하세요.';

/** 저장 전 검증 — 통과면 null, 아니면 첫 오류 문구. */
export function validateItemDraft(draft: WorkPlanItemDraft, ownerId: string, actorId: string): string | null {
  if (!draft.tagId) return '태그를 고르세요.';
  const now = new Date().toISOString();
  const parsed = workPlanItemSchema.safeParse({
    ...draft, id: 'WI-00000000-0000', ownerUserId: ownerId, createdBy: actorId, createdAt: now, updatedAt: now,
  });
  return parsed.success ? null : firstIssue(parsed.error.issues);
}

export function validateMeetingDraft(draft: CalendarEventDraft, organizerId: string): string | null {
  const now = new Date().toISOString();
  const parsed = calendarEventSchema.safeParse({
    ...draft, id: 'CAL-00000000-0000', ownerUserId: organizerId, createdAt: now, updatedAt: now, reminded: false,
  });
  return parsed.success ? null : firstIssue(parsed.error.issues);
}

export function validateOutsideDraft(draft: OutsideWorkDraft, ownerId: string): string | null {
  const now = new Date().toISOString();
  const parsed = outsideWorkSchema.safeParse({ ...draft, id: 'OW-00000000-0000', ownerUserId: ownerId, createdAt: now, updatedAt: now });
  return parsed.success ? null : firstIssue(parsed.error.issues);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** 외근·출장 기간 글 — 하루면 빈 글, 출장은 'N박 M일', 외근은 'N일' */
export function outsideLengthLabel(kind: 'OUTSIDE' | 'TRIP', startDate: string, endDate: string): string {
  if (!isValidCalendarDate(startDate) || !isValidCalendarDate(endDate)) return '';
  const days = Math.round((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / DAY_MS) + 1;
  if (days <= 1) return '';
  return kind === 'TRIP' ? `${days - 1}박 ${days}일` : `${days}일`;
}

/** 지난 행선지 추천 — 최근 일정부터, 같은 곳은 한 번만 */
export function recentDestinations(schedules: Array<{ startDate: string; destination?: string }>, limit: number): string[] {
  const seen = new Set<string>();
  const list: string[] = [];
  for (const s of [...schedules].sort((a, b) => b.startDate.localeCompare(a.startDate))) {
    const destination = (s.destination ?? '').trim();
    if (!destination || seen.has(destination)) continue;
    seen.add(destination);
    list.push(destination);
    if (list.length >= limit) break;
  }
  return list;
}
