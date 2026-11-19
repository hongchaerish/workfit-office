import assert from 'node:assert/strict';
import test from 'node:test';
import { initialCreateState, type EventFormState } from './eventFormMapping';
import type { DayEntry } from '@/domain/workPlan/dayEntries';
import { entryTimeLabel, entryViewOf, eventViewOf } from './eventView';

const names: Record<string, string> = { u1: '홍채원', u2: '신지웅', u3: '모란' };
const nameOf = (id: string) => names[id] ?? '';
const base = (patch: Partial<EventFormState>): EventFormState => ({ ...blank(), ...patch });
function blank(): EventFormState {
  const owner = { id: 'u1', name: '홍채원' } as never;
  return initialCreateState({ mode: 'create', date: '2026-11-17', owner, allowed: ['ITEM'] }, 'u1', '');
}

test('일정 보기 — 여러 날 출장: 목적이 제목, 기간·종일, 장소·교통수단·동행자', () => {
  const view = eventViewOf(
    base({ kind: 'TRIP', subType: '국내출장', date: '2026-11-17', endDate: '2026-11-18', allDay: true, purpose: '지사 점검', destination: '부산 지사', transportation: 'KTX·기차', companionIds: ['u1', 'u2'] }),
    { ownerId: 'u1', nameOf },
  );
  assert.equal(view.kindLabel, '국내출장');
  assert.equal(view.title, '지사 점검');
  assert.deepEqual(view.facts, [
    { id: 'when', text: '11월 17일 (화) ~ 11월 18일 (수) · 종일' },
    { id: 'place', text: '부산 지사' },
    { id: 'transport', text: 'KTX·기차' },
    { id: 'people', text: '신지웅' },
  ]);
});

test('일정 보기 — 목적이 없는 외근은 장소가 제목', () => {
  const view = eventViewOf(base({ kind: 'OUTSIDE', subType: '시간 외근', allDay: false, range: { start: 840, end: 960 }, destination: '판교 고객사' }), { ownerId: 'u1', nameOf });
  assert.equal(view.kindLabel, '외근');
  assert.equal(view.title, '판교 고객사');
  assert.deepEqual(view.facts, [{ id: 'when', text: '11월 17일 (화) · 14:00~16:00' }]);
});

test('일정 보기 — 회의: 장소·참석자·메모, 빈 칸은 뺀다', () => {
  const view = eventViewOf(
    base({ kind: 'MEETING', title: '주간 회의', range: { start: 600, end: 660 }, attendeeIds: ['u1', 'u2', 'u3'], memo: '안건 정리' }),
    { ownerId: 'u1', nameOf, place: '3층 회의실' },
  );
  assert.equal(view.kindLabel, '회의');
  assert.deepEqual(view.facts, [
    { id: 'when', text: '11월 17일 (화) · 10:00~11:00' },
    { id: 'place', text: '3층 회의실' },
    { id: 'people', text: '홍채원, 신지웅, 모란' },
    { id: 'memo', text: '안건 정리' },
  ]);
});

test('일정 보기 — 업무: 태그 이름, 시간 미정·끝 미정', () => {
  const none = eventViewOf(base({ kind: 'ITEM', title: '보고서', allDay: true }), { ownerId: 'u1', nameOf, tagName: '개발' });
  assert.equal(none.kindLabel, '개발');
  assert.deepEqual(none.facts, [{ id: 'when', text: '11월 17일 (화) · 시간 미정' }]);
  const open = eventViewOf(base({ kind: 'ITEM', title: '보고서', range: { start: 750, end: 780 }, openEnd: true }), { ownerId: 'u1', nameOf });
  assert.equal(open.kindLabel, '업무');
  assert.deepEqual(open.facts, [{ id: 'when', text: '11월 17일 (화) · 12:30~' }]);
});

const entry = (patch: Partial<DayEntry>): DayEntry =>
  ({ key: 'k', source: 'APPROVAL', allDay: false, startTime: null, endTime: null, title: '연차', tag: null, roomStatus: null, ...patch }) as DayEntry;

test('그날 일정 줄 시각 — 종일, 시작~끝, 시작만, 시간 없는 업무는 빈 글', () => {
  assert.equal(entryTimeLabel(entry({ allDay: true })), '종일');
  assert.equal(entryTimeLabel(entry({ startTime: '09:00', endTime: '10:30' })), '09:00~10:30');
  assert.equal(entryTimeLabel(entry({ startTime: '12:30' })), '12:30~');
  assert.equal(entryTimeLabel(entry({ source: 'ITEM', allDay: true })), '');
});

test('그날 일정 보기 — 결재·달력 일정은 제목과 날짜만', () => {
  const view = entryViewOf(entry({ allDay: true }), '2026-11-20', { ownerId: 'u1', nameOf });
  assert.equal(view.kindLabel, '결재');
  assert.equal(view.title, '연차');
  assert.deepEqual(view.facts, [{ id: 'when', text: '11월 20일 (금) · 종일' }]);
});
