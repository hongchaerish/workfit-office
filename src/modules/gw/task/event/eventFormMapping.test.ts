import assert from 'node:assert/strict';
import test from 'node:test';
import type { CalendarEvent } from '@/domain/calendarEvent/schema';
import type { OutsideWork } from '@/domain/outsideWork/schema';
import { fromOutsideWork } from '@/domain/outsideWork/view';
import type { Reservation } from '@/domain/reservation/schema';
import type { User } from '@/domain/user/schema';
import type { DayEntry } from '@/domain/workPlan/dayEntries';
import type { WorkPlanItem } from '@/domain/workPlan/item';
import {
  applyAllDayToggle,
  applyDateChange,
  applyRangeChange,
  applySubType,
  outsideLengthLabel,
  recentDestinations,
  roomDayBlocks,
  initialCreateState,
  initialStateFromEntry,
  linkedRoomState,
  switchKind,
  toItemDraft,
  toMeetingDraft,
  toOutsideDraft,
  validateItemDraft,
  validateMeetingDraft,
  validateOutsideDraft,
  meetingPurpose,
  type EventFormState,
  type EventKind,
} from './eventFormMapping';

const D = '2026-10-21';
const NOW = '2026-10-20T00:00:00.000Z';
const ME = 'U011';
const OTHER = { id: 'U012', name: '김철수' } as User;
const SELF = { id: ME, name: '홍길동' } as User;

const createState = (patch: Partial<EventFormState> = {}): EventFormState => ({
  ...initialCreateState({ mode: 'create', date: D, owner: SELF, allowed: ['ITEM', 'MEETING', 'OUTSIDE', 'TRIP'] }, ME, 'WT-0001'),
  ...patch,
});

const POLICY = { workStartTime: '09:00', workEndTime: '18:00' };

const entryBase = { key: 'k', allDay: false, startTime: '09:00', endTime: '10:00', title: 't', tag: null, roomStatus: null } as const;

// ── 처음 상태 ─────────────────────────────────

test('본인 칸 새 일정은 일반 항목, 첫 일반 태그로 시작한다', () => {
  const s = createState();
  assert.equal(s.kind, 'ITEM');
  assert.equal(s.tagId, 'WT-0001');
  assert.equal(s.date, D);
  assert.equal(s.endDate, D);
  assert.equal(s.range, null);
  assert.deepEqual(s.attendeeIds, []);
  assert.equal(s.visibility, 'COMPANY');
});

test('남의 칸 새 일정은 회의, 참석자에 칸 주인이 들어간다', () => {
  const s = initialCreateState({ mode: 'create', date: D, owner: OTHER, allowed: ['MEETING'] }, ME, 'WT-0001');
  assert.equal(s.kind, 'MEETING');
  assert.deepEqual(s.attendeeIds, ['U012']);
  assert.equal(s.allDay, false);
});

test('일반이 없으면 허용 목록 첫 값으로 시작하고, 외근은 세부 구분 기본값', () => {
  const s = initialCreateState({ mode: 'create', date: D, owner: SELF, allowed: ['OUTSIDE', 'TRIP'] }, ME, '');
  assert.equal(s.kind, 'OUTSIDE');
  assert.equal(s.subType, '종일 외근');
  assert.equal(s.allDay, true);
});

test('새 일정에 처음 시간 구간을 주면 그 시간으로 시작한다(종일 아님)', () => {
  const s = initialCreateState(
    { mode: 'create', date: D, owner: SELF, allowed: ['ITEM', 'MEETING', 'OUTSIDE', 'TRIP'], initialRange: { start: 540, end: 570 } },
    ME,
    'WT-0001',
  );
  assert.deepEqual(s.range, { start: 540, end: 570 });
  assert.equal(s.allDay, false);
  const meeting = initialCreateState(
    { mode: 'create', date: D, owner: OTHER, allowed: ['MEETING'], initialRange: { start: 600, end: 630 } },
    ME,
    'WT-0001',
  );
  assert.deepEqual(meeting.range, { start: 600, end: 630 });
  assert.equal(meeting.allDay, false);
});

test('일반 항목 수정 — 항목 값으로 채운다', () => {
  const item: WorkPlanItem = {
    id: 'WI-20261021-0001', ownerUserId: ME, date: D, allDay: false, startTime: '09:30', endTime: '11:00',
    tagId: 'WT-0002', title: '보고서', memo: '초안', createdBy: ME, createdAt: NOW, updatedAt: NOW,
  };
  const s = initialStateFromEntry({ ...entryBase, source: 'ITEM', item } as DayEntry, null);
  assert.equal(s.kind, 'ITEM');
  assert.equal(s.tagId, 'WT-0002');
  assert.deepEqual(s.range, { start: 570, end: 660 });
  assert.equal(s.title, '보고서');
  assert.equal(s.memo, '초안');
});

const meetingEvent = (patch: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: 'CAL-20261021-0001', ownerUserId: ME, title: '주간 회의', date: D, allDay: false, startTime: '14:00', endTime: '15:00',
  memo: '안건', visibility: 'COMPANY', eventType: 'MEETING', attendeeUserIds: ['U012'], deptId: null, projectId: null,
  createdAt: NOW, updatedAt: NOW, reminded: false, location: '3층 회의실', reservationId: null, ...patch,
});

test('회의 수정 — 예약 없으면 직접 적은 장소', () => {
  const s = initialStateFromEntry({ ...entryBase, source: 'MEETING', event: meetingEvent() } as DayEntry, null);
  assert.equal(s.kind, 'MEETING');
  assert.equal(s.locationMode, 'text');
  assert.equal(s.locationText, '3층 회의실');
  assert.equal(s.roomId, null);
  assert.deepEqual(s.attendeeIds, ['U012']);
  assert.deepEqual(s.range, { start: 840, end: 900 });
});

test('회의 수정 — 연결 예약이 있으면 회의실 선택', () => {
  const s = initialStateFromEntry(
    { ...entryBase, source: 'MEETING', event: meetingEvent({ reservationId: 'RSV-1', location: '대회의실' }) } as DayEntry,
    'RES-ROOM-1',
  );
  assert.equal(s.locationMode, 'room');
  assert.equal(s.roomId, 'RES-ROOM-1');
});

const outsideWork = (patch: Partial<OutsideWork> = {}): OutsideWork => ({
  id: 'OW-20261021-0001', ownerUserId: ME, category: 'TRIP', subType: '해외출장', startDate: D, endDate: '2026-10-23',
  allDay: true, startTime: null, endTime: null, destination: '도쿄', purpose: '박람회', companionUserIds: ['U012'],
  transportation: '항공', contact: '010', memo: '메모', linkedApprovalDocId: null, createdAt: NOW, updatedAt: NOW, ...patch,
});

test('외근·출장 수정 — 등록 원본으로 채운다', () => {
  const s = initialStateFromEntry({ ...entryBase, source: 'OUTSIDE', outside: fromOutsideWork(outsideWork()) } as DayEntry, null);
  assert.equal(s.kind, 'TRIP');
  assert.equal(s.subType, '해외출장');
  assert.equal(s.endDate, '2026-10-23');
  assert.equal(s.range, null);
  assert.deepEqual(s.companionIds, ['U012']);
  assert.equal(s.destination, '도쿄');
});

// ── 종류 바꾸기 ─────────────────────────────────

test('새 일정 — 허용 안 된 종류로는 못 바꾼다', () => {
  const s = initialCreateState({ mode: 'create', date: D, owner: OTHER, allowed: ['MEETING'] }, ME, 'WT-0001');
  assert.equal(switchKind(s, 'OUTSIDE', { mode: 'create', allowed: ['MEETING'] }, POLICY).kind, 'MEETING');
});

test('외근↔출장 바꾸면 세부 구분이 첫 값으로 바뀐다', () => {
  const rule = { mode: 'create' as const, allowed: ['ITEM', 'MEETING', 'OUTSIDE', 'TRIP'] as const };
  const out = switchKind(createState(), 'OUTSIDE', { ...rule, allowed: [...rule.allowed] }, POLICY);
  assert.equal(out.subType, '종일 외근');
  const trip = switchKind(out, 'TRIP', { ...rule, allowed: [...rule.allowed] }, POLICY);
  assert.equal(trip.subType, '국내출장');
});

test('수정 — 회의는 다른 종류로 못 바꾸고, 외근은 출장으로 바꿀 수 있다', () => {
  const meeting = createState({ kind: 'MEETING' });
  assert.equal(switchKind(meeting, 'ITEM', { mode: 'edit', allowed: [] }, POLICY).kind, 'MEETING');
  const out = createState({ kind: 'OUTSIDE', subType: '오전 외근' });
  assert.equal(switchKind(out, 'MEETING', { mode: 'edit', allowed: [] }, POLICY).kind, 'OUTSIDE');
  const trip = switchKind(out, 'TRIP', { mode: 'edit', allowed: [] }, POLICY);
  assert.equal(trip.kind, 'TRIP');
  assert.equal(trip.subType, '국내출장');
  const item = createState();
  assert.equal(switchKind(item, 'MEETING', { mode: 'edit', allowed: [] }, POLICY).kind, 'ITEM');
});

test('보기 — 아무것도 바꾸지 않는다', () => {
  const out = createState({ kind: 'OUTSIDE' });
  assert.equal(switchKind(out, 'TRIP', { mode: 'view', allowed: [] }, POLICY), out);
});

// ── 회의 초안 ─────────────────────────────────

test('회의 초안 — 시각은 구간에서, 참석자에서 주최자 제외, 직접 적은 장소는 다듬는다', () => {
  const s = createState({
    kind: 'MEETING', title: '기획 회의', range: { start: 600, end: 690 }, attendeeIds: [ME, 'U012', 'U013'],
    locationMode: 'text', locationText: '  2층 라운지 ', memo: ' 안건 ',
  });
  const draft = toMeetingDraft(s, { organizerId: ME, deptId: 'D01', roomName: null, projectId: null });
  assert.equal(draft.allDay, false);
  assert.equal(draft.startTime, '10:00');
  assert.equal(draft.endTime, '11:30');
  assert.deepEqual(draft.attendeeUserIds, ['U012', 'U013']);
  assert.equal(draft.location, '2층 라운지');
  assert.equal(draft.eventType, 'MEETING');
  assert.equal(draft.visibility, 'COMPANY');
  assert.equal(draft.deptId, null);
  assert.equal(draft.projectId, null);
  assert.equal(meetingPurpose(s), '안건');
  assert.equal(meetingPurpose(createState({ memo: '  ' })), '회의');
  assert.equal(validateMeetingDraft(draft, ME), null);
});

test('회의 초안 — 빈 장소는 null, 회의실이면 방 이름, 부서 공유면 부서', () => {
  const blank = toMeetingDraft(createState({ kind: 'MEETING', locationText: '   ' }), { organizerId: ME, deptId: null, roomName: null, projectId: null });
  assert.equal(blank.location, null);
  const room = toMeetingDraft(
    createState({ kind: 'MEETING', locationMode: 'room', roomId: 'R1', locationText: '무시', visibility: 'TEAM' }),
    { organizerId: ME, deptId: 'D01', roomName: '대회의실', projectId: null },
  );
  assert.equal(room.location, '대회의실');
  assert.equal(room.deptId, 'D01');
});

test('회의 초안 — 24시 끝은 23:59, 시간 없으면 검증 실패', () => {
  const late = toMeetingDraft(createState({ kind: 'MEETING', title: '야간', range: { start: 1410, end: 1440 } }), { organizerId: ME, deptId: null, roomName: null, projectId: null });
  assert.equal(late.startTime, '23:30');
  assert.equal(late.endTime, '23:59');
  const noTime = toMeetingDraft(createState({ kind: 'MEETING', title: '회의' }), { organizerId: ME, deptId: null, roomName: null, projectId: null });
  assert.equal(noTime.startTime, null);
  assert.equal(validateMeetingDraft(noTime, ME), '시간 일정에는 시작·종료 시각이 필요합니다.');
  const noTitle = toMeetingDraft(createState({ kind: 'MEETING', range: { start: 600, end: 630 } }), { organizerId: ME, deptId: null, roomName: null, projectId: null });
  assert.equal(validateMeetingDraft(noTitle, ME), '일정 제목을 입력하세요.');
});

// ── 외근·출장 초안 ─────────────────────────────────

test('외근 초안 — 종료일 기본은 날짜, 앞서면 날짜로, 동행자에서 본인 제외', () => {
  const s = createState({ kind: 'OUTSIDE', subType: '종일 외근', allDay: true, endDate: '', destination: '고객사', companionIds: [ME, 'U012'] });
  const draft = toOutsideDraft(s, ME);
  assert.equal(draft.category, 'OUTSIDE');
  assert.equal(draft.startDate, D);
  assert.equal(draft.endDate, D);
  assert.equal(draft.startTime, null);
  assert.deepEqual(draft.companionUserIds, ['U012']);
  assert.equal(validateOutsideDraft(draft, ME), null);
  assert.equal(toOutsideDraft(createState({ kind: 'OUTSIDE', endDate: '2026-10-19' }), ME).endDate, D);
});

test('외근 초안 — 시간 외근은 구간 시각, 행선지 없으면 검증 문구', () => {
  const s = createState({ kind: 'OUTSIDE', subType: '시간 외근', allDay: false, range: { start: 780, end: 900 }, destination: '' });
  const draft = toOutsideDraft(s, ME);
  assert.equal(draft.startTime, '13:00');
  assert.equal(draft.endTime, '15:00');
  assert.equal(validateOutsideDraft(draft, ME), '장소를 입력하세요.');
});

// ── 일반 항목 초안 ─────────────────────────────────

test('일반 항목 초안 — 종일이면 시각 없음, 시간 항목은 구간 시각', () => {
  const allDay = toItemDraft(createState({ allDay: true, range: { start: 600, end: 660 }, title: '마감', memo: 'm' }));
  assert.deepEqual(allDay, { date: D, allDay: true, startTime: null, endTime: null, tagId: 'WT-0001', title: '마감', memo: 'm' });
  const timed = toItemDraft(createState({ range: { start: 540, end: 600 }, title: '업무' }));
  assert.equal(timed.startTime, '09:00');
  assert.equal(timed.endTime, '10:00');
  assert.equal(validateItemDraft(timed, ME, ME), null);
});

test('일반 항목 검증 — 태그·제목·시간', () => {
  assert.equal(validateItemDraft(toItemDraft(createState({ tagId: '', title: 'a', range: { start: 0, end: 30 } })), ME, ME), '태그를 고르세요.');
  assert.equal(validateItemDraft(toItemDraft(createState({ range: { start: 0, end: 30 } })), ME, ME), '제목을 입력하세요.');
  assert.equal(validateItemDraft(toItemDraft(createState({ title: 'a' })), ME, ME), '시간 항목에는 시작 시각이 필요합니다.');
});

// ── 세부 구분 → 시간 ─────────────────────────────────

test('세부 구분 — 오전 외근은 근무 시작~13:00', () => {
  const s = applySubType(createState({ kind: 'OUTSIDE', allDay: true }), '오전 외근', POLICY);
  assert.equal(s.subType, '오전 외근');
  assert.equal(s.allDay, false);
  assert.deepEqual(s.range, { start: 540, end: 780 });
});

test('세부 구분 — 오후 외근은 13:00~근무 끝', () => {
  const s = applySubType(createState({ kind: 'OUTSIDE', allDay: true }), '오후 외근', POLICY);
  assert.equal(s.allDay, false);
  assert.deepEqual(s.range, { start: 780, end: 1080 });
});

test('세부 구분 — 시간 외근은 시간 일정, 구간은 그대로', () => {
  const s = applySubType(createState({ kind: 'OUTSIDE', allDay: true, range: { start: 600, end: 660 } }), '시간 외근', POLICY);
  assert.equal(s.allDay, false);
  assert.deepEqual(s.range, { start: 600, end: 660 });
});

test('세부 구분 — 종일 외근·출장은 종일, 구간 없음', () => {
  for (const sub of ['종일 외근', '국내출장', '해외출장']) {
    const s = applySubType(createState({ kind: 'OUTSIDE', allDay: false, range: { start: 600, end: 660 } }), sub, POLICY);
    assert.equal(s.allDay, true);
    assert.equal(s.range, null);
  }
});

test('종류를 외근·출장으로 바꾸면 첫 세부 구분의 시간 규칙을 따른다', () => {
  const all = ['ITEM', 'MEETING', 'OUTSIDE', 'TRIP'] as Array<'ITEM' | 'MEETING' | 'OUTSIDE' | 'TRIP'>;
  const s = switchKind(createState({ range: { start: 600, end: 660 } }), 'OUTSIDE', { mode: 'create', allowed: all }, POLICY);
  assert.equal(s.subType, '종일 외근');
  assert.equal(s.allDay, true);
  assert.equal(s.range, null);
});

// ── 프로젝트 공유 회의 ─────────────────────────────────

test('프로젝트 공유 회의를 고쳐도 공개 범위·프로젝트를 그대로 둔다', () => {
  const ev = meetingEvent({ visibility: 'PROJECT', projectId: 'PRJ-1' });
  const s = initialStateFromEntry({ ...entryBase, source: 'MEETING', event: ev } as DayEntry, null);
  assert.equal(s.visibility, 'PROJECT');
  const draft = toMeetingDraft(s, { organizerId: ME, deptId: null, roomName: null, projectId: ev.projectId });
  assert.equal(draft.visibility, 'PROJECT');
  assert.equal(draft.projectId, 'PRJ-1');
  assert.equal(validateMeetingDraft(draft, ME), null);
  const company = toMeetingDraft({ ...s, visibility: 'COMPANY' }, { organizerId: ME, deptId: null, roomName: null, projectId: 'PRJ-1' });
  assert.equal(company.projectId, null);
});

// ── 연결 예약 읽기 결과 → 회의실 칸 ─────────────────────────────────

test('연결 예약 — 읽는 중이면 회의실 모드 유지, 저장 막음', () => {
  assert.deepEqual(linkedRoomState({ status: 'pending', reservation: null }), {
    mode: 'room', roomId: null, blockReason: '회의실 정보를 불러오는 중입니다. 잠시 후 다시 저장하세요.',
  });
});

test('연결 예약 — 읽기 실패면 회의실 모드 유지(방 해제 금지), 저장 막음', () => {
  assert.deepEqual(linkedRoomState({ status: 'error', reservation: null }), {
    mode: 'room', roomId: null, blockReason: '회의실 정보를 불러오지 못했습니다. 다시 시도해 주세요.',
  });
});

test('연결 예약 — 읽었는데 없으면 장소 글 모드', () => {
  assert.deepEqual(linkedRoomState({ status: 'success', reservation: null }), { mode: 'text', roomId: null, blockReason: null });
});

test('연결 예약 — 찾으면 그 회의실 선택', () => {
  assert.deepEqual(
    linkedRoomState({ status: 'success', reservation: { resourceId: 'R1' } as Reservation }),
    { mode: 'room', roomId: 'R1', blockReason: null },
  );
});

// ── 시간·날짜·종일 바꾸기(PC 창·모바일 시트 공용) ─────────────────────────────────

test('시간 바꾸기 — 일반·회의·출장은 종일을 끈다', () => {
  for (const kind of ['ITEM', 'MEETING', 'TRIP'] as const) {
    const s = applyRangeChange(createState({ kind, allDay: true, subType: kind === 'TRIP' ? '국내출장' : '' }), { start: 600, end: 660 });
    assert.equal(s.allDay, false);
    assert.deepEqual(s.range, { start: 600, end: 660 });
    if (kind === 'TRIP') assert.equal(s.subType, '국내출장');
  }
});

test('시간 바꾸기 — 외근은 세부 구분을 시간 외근으로 맞춘다', () => {
  for (const sub of ['종일 외근', '오전 외근', '오후 외근', '시간 외근']) {
    const s = applyRangeChange(createState({ kind: 'OUTSIDE', subType: sub, allDay: sub === '종일 외근' }), { start: 840, end: 900 });
    assert.equal(s.subType, '시간 외근');
    assert.equal(s.allDay, false);
    assert.deepEqual(s.range, { start: 840, end: 900 });
  }
});

test('날짜 바꾸기 — 종료일이 앞서면 같이 옮기고, 뒤면 그대로', () => {
  const later = applyDateChange(createState({ date: D, endDate: D }), '2026-10-23');
  assert.equal(later.date, '2026-10-23');
  assert.equal(later.endDate, '2026-10-23');
  const kept = applyDateChange(createState({ date: D, endDate: '2026-10-25' }), '2026-10-22');
  assert.equal(kept.endDate, '2026-10-25');
});

test('날짜 바꾸기 — 빈 값이면 그대로', () => {
  const s = createState();
  assert.equal(applyDateChange(s, ''), s);
});

test('종일 바꾸기 — 외근은 종일 외근 ↔ 시간 외근', () => {
  const on = applyAllDayToggle(createState({ kind: 'OUTSIDE', subType: '시간 외근', allDay: false, range: { start: 600, end: 660 } }), true, POLICY);
  assert.equal(on.subType, '종일 외근');
  assert.equal(on.allDay, true);
  assert.equal(on.range, null);
  const off = applyAllDayToggle(createState({ kind: 'OUTSIDE', subType: '종일 외근', allDay: true }), false, POLICY);
  assert.equal(off.subType, '시간 외근');
  assert.equal(off.allDay, false);
});

test('종일 바꾸기 — 일반·출장은 종일 값만', () => {
  const item = applyAllDayToggle(createState({ allDay: false, range: { start: 600, end: 660 } }), true, POLICY);
  assert.equal(item.allDay, true);
  assert.deepEqual(item.range, { start: 600, end: 660 });
  const trip = applyAllDayToggle(createState({ kind: 'TRIP', subType: '해외출장', allDay: true }), false, POLICY);
  assert.equal(trip.allDay, false);
  assert.equal(trip.subType, '해외출장');
});

test('종일 바꾸기 — 회의는 종일이 없다', () => {
  const s = createState({ kind: 'MEETING', allDay: false });
  assert.equal(applyAllDayToggle(s, true, POLICY), s);
});

// ── 고른 회의실의 그날 예약 → 시간표 블록 ─────────────────────────────────

const rsv = (patch: Partial<Reservation>): Reservation =>
  ({ id: 'RS-1', resourceId: 'R1', title: '주간회의', status: 'CONFIRMED', startAt: '', endAt: '', ...patch }) as Reservation;

test('회의실 블록 — 회의실 시간대(+09:00) 기준 분, 대기·확정만, 다른 방·연결 예약 제외', () => {
  const blocks = roomDayBlocks([
    rsv({ id: 'A', startAt: '2026-10-21T01:00:00.000Z', endAt: '2026-10-21T02:30:00.000Z' }), // 10:00~11:30
    rsv({ id: 'B', status: 'PENDING', startAt: '2026-10-21T05:00:00.000Z', endAt: '2026-10-21T06:00:00.000Z' }),
    rsv({ id: 'C', status: 'CANCELLED', startAt: '2026-10-21T03:00:00.000Z', endAt: '2026-10-21T04:00:00.000Z' }),
    rsv({ id: 'D', resourceId: 'R2', startAt: '2026-10-21T03:00:00.000Z', endAt: '2026-10-21T04:00:00.000Z' }),
    rsv({ id: 'E', startAt: '2026-10-21T07:00:00.000Z', endAt: '2026-10-21T08:00:00.000Z' }),
  ], 'R1', D, 'E');
  assert.deepEqual(blocks.map((b) => [b.key, b.start, b.end, b.tone]), [
    ['room-A', 600, 690, 'room'],
    ['room-B', 840, 900, 'room'],
  ]);
  assert.equal(blocks[0].label, '회의실 예약 · 주간회의');
});

test('회의실 블록 — 날을 넘는 예약은 그날 안으로 자르고, 다른 날은 뺀다', () => {
  const blocks = roomDayBlocks([
    rsv({ id: 'X', startAt: '2026-10-20T14:00:00.000Z', endAt: '2026-10-20T16:00:00.000Z' }), // 10-20 23:00 ~ 10-21 01:00
    rsv({ id: 'Y', startAt: '2026-10-21T14:00:00.000Z', endAt: '2026-10-21T16:00:00.000Z' }), // 10-21 23:00 ~ 10-22 01:00
    rsv({ id: 'Z', startAt: '2026-10-22T01:00:00.000Z', endAt: '2026-10-22T02:00:00.000Z' }),
  ], 'R1', D, null);
  assert.deepEqual(blocks.map((b) => [b.key, b.start, b.end]), [
    ['room-X', 0, 60],
    ['room-Y', 1380, 1440],
  ]);
});

test('회의실 블록 — 날짜가 올바르지 않으면 빈 목록', () => {
  assert.deepEqual(roomDayBlocks([rsv({ startAt: '2026-10-21T01:00:00.000Z', endAt: '2026-10-21T02:00:00.000Z' })], 'R1', '', null), []);
});

test('외근·출장 기간 — 하루면 빈 글, 출장은 N박 M일, 외근은 N일', () => {
  assert.equal(outsideLengthLabel('TRIP', '2026-10-30', '2026-10-30'), '');
  assert.equal(outsideLengthLabel('TRIP', '2026-10-30', '2026-11-01'), '2박 3일');
  assert.equal(outsideLengthLabel('OUTSIDE', '2026-10-30', '2026-10-31'), '2일');
  // 종료일이 앞서거나 날짜가 틀리면 빈 글
  assert.equal(outsideLengthLabel('TRIP', '2026-10-30', '2026-10-29'), '');
  assert.equal(outsideLengthLabel('TRIP', '', '2026-10-29'), '');
});

test('지난 행선지 — 최근 것부터, 같은 곳은 한 번, 공백 제외, 최대 개수', () => {
  const list = recentDestinations(
    [
      { startDate: '2026-10-01', destination: '부산 본사' },
      { startDate: '2026-10-20', destination: '대전 공장' },
      { startDate: '2026-10-10', destination: ' 부산 본사 ' },
      { startDate: '2026-10-15', destination: '' },
      { startDate: '2026-10-05' },
    ],
    5,
  );
  assert.deepEqual(list, ['대전 공장', '부산 본사']);
  assert.equal(recentDestinations([{ startDate: '1', destination: 'a' }, { startDate: '2', destination: 'b' }], 1).length, 1);
});

test('업무 종료 미정 — 시작만 있는 항목을 열면 openEnd, 30분 자리, 저장하면 종료 없음', () => {
  const item: WorkPlanItem = {
    id: 'WI-20261021-0002', ownerUserId: ME, date: D, allDay: false, startTime: '10:00', endTime: null,
    tagId: 'WT-0001', title: '자료 정리', memo: '', createdBy: ME, createdAt: NOW, updatedAt: NOW,
  };
  const s = initialStateFromEntry({ ...entryBase, source: 'ITEM', item } as DayEntry, null);
  assert.equal(s.openEnd, true);
  assert.deepEqual(s.range, { start: 600, end: 630 });
  const draft = toItemDraft(s);
  assert.equal(draft.startTime, '10:00');
  assert.equal(draft.endTime, null);
  assert.equal(validateItemDraft(draft, ME, ME), null);
  // 종료가 있는 항목은 openEnd 아님
  assert.equal(toItemDraft(createState({ title: 'a', range: { start: 600, end: 660 } })).endTime, '11:00');
});

test('종료 미정 — 시간표로 시간을 바꾸면 풀리고, 회의로 바꾸면 풀린다', () => {
  const open = createState({ title: 'a', range: { start: 600, end: 630 }, openEnd: true });
  assert.equal(applyRangeChange(open, { start: 600, end: 690 }).openEnd, false);
  const rule = { mode: 'create' as const, allowed: ['ITEM', 'MEETING'] as EventKind[] };
  assert.equal(switchKind(open, 'MEETING', rule, POLICY).openEnd, false);
  // 종일(시간 미정)이면 openEnd 는 저장에 영향이 없다
  const allDay = toItemDraft({ ...open, allDay: true });
  assert.equal(allDay.startTime, null);
  assert.equal(allDay.endTime, null);
});
