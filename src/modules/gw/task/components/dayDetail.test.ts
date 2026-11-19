import assert from 'node:assert/strict';
import test from 'node:test';
import type { DayEntry } from '@/domain/workPlan/dayEntries';
import { busyRangeOf, dayStatusOf, freeSlotsOfDay, nowLineOf, recentItemTitles, escClosesPopover } from './dayDetail';

const entry = (over: Partial<DayEntry>): DayEntry => ({
  key: over.key ?? 'k',
  source: 'ITEM',
  allDay: false,
  startTime: null,
  endTime: null,
  title: '',
  tag: null,
  roomStatus: null,
  ...over,
});

const leave = (leaveType: string, over: Partial<DayEntry> = {}) =>
  entry({
    source: 'APPROVAL',
    allDay: true,
    title: '휴가원',
    schedule: { category: 'LEAVE', leaveType, docType: '휴가', docId: 'D1', docNo: '', docTitle: '휴가원', drafterId: 'U1', startDate: '2026-11-18', endDate: '2026-11-18', days: 1 },
    ...over,
  });

const outsideAllDay = (category: 'OUTSIDE' | 'TRIP' = 'OUTSIDE') =>
  entry({ source: 'OUTSIDE', allDay: true, title: '고객사', outside: { category } as DayEntry['outside'] });

test('busyRangeOf: 종료 없는 업무는 30분', () => {
  assert.deepEqual(busyRangeOf(entry({ startTime: '10:00' })), { start: 600, end: 630 });
});
test('busyRangeOf: 종일 휴가는 하루 전체', () => {
  assert.deepEqual(busyRangeOf(leave('연차')), { start: 540, end: 1080 });
});
test('busyRangeOf: 오전반차 09:00~13:30', () => {
  assert.deepEqual(busyRangeOf(leave('오전반차')), { start: 540, end: 810 });
});
test('busyRangeOf: 오후반차 12:30~18:00', () => {
  assert.deepEqual(busyRangeOf(leave('오후반차')), { start: 750, end: 1080 });
});
test('busyRangeOf: 종일 외근은 하루 전체, 미정 업무는 막지 않는다', () => {
  assert.deepEqual(busyRangeOf(outsideAllDay()), { start: 540, end: 1080 });
  assert.equal(busyRangeOf(entry({ allDay: true, title: '집중' })), null);
});

test('dayStatusOf: 휴가가 외근보다 먼저', () => {
  assert.deepEqual(dayStatusOf([outsideAllDay(), leave('연차')]), { kind: 'leave', label: '연차' });
});
test('dayStatusOf: 아무것도 없으면 사무실', () => {
  assert.deepEqual(dayStatusOf([]), { kind: 'office' });
});
test('dayStatusOf: 출장', () => {
  assert.equal(dayStatusOf([outsideAllDay('TRIP')]).kind, 'trip');
});

test('nowLineOf: 회의 중', () => {
  const meeting = entry({ source: 'MEETING', startTime: '14:00', endTime: '15:00', title: '주간 회의' });
  assert.deepEqual(nowLineOf([meeting], 870), { tone: 'busy', text: '지금 주간 회의 중 · 15:00에 끝나요' });
});
test('nowLineOf: 비어 있음 + 다음 일정(오후반차)', () => {
  assert.deepEqual(nowLineOf([leave('오후반차')], 635), { tone: 'free', text: '지금은 비어 있어요 · 다음 일정 12:30 오후반차' });
});
test('nowLineOf: 종일 연차면 자리에 없음', () => {
  assert.deepEqual(nowLineOf([leave('연차')], 635), { tone: 'away', text: '오늘 연차로 자리에 없습니다. 급한 일은 메시지를 남겨 주세요.' });
});
test('nowLineOf: 남은 일정 없음', () => {
  assert.deepEqual(nowLineOf([entry({ startTime: '09:00', endTime: '10:00', title: 'A' })], 700), { tone: 'free', text: '지금은 비어 있어요 · 오늘 남은 일정 없음' });
});
test('nowLineOf: 외근 중', () => {
  const out = entry({ source: 'OUTSIDE', startTime: '10:00', endTime: '17:00', title: '고객사', outside: { category: 'OUTSIDE' } as DayEntry['outside'] });
  assert.deepEqual(nowLineOf([out], 635), { tone: 'outside', text: '지금 외근 · 고객사 중 · 17:00까지' });
});

test('freeSlotsOfDay: 종일 외근이면 빈 시간 없음', () => {
  assert.deepEqual(freeSlotsOfDay([outsideAllDay()], { isToday: false, nowMinute: 0 }), []);
});
test('freeSlotsOfDay: 오늘이면 지금 이후만', () => {
  assert.deepEqual(freeSlotsOfDay([], { isToday: true, nowMinute: 635 })[0], { start: 660, end: 720 });
});

test('recentItemTitles: 업무만, 같은 제목은 하나로', () => {
  const t = (title: string, source: DayEntry['source'] = 'ITEM') => entry({ title, source });
  assert.deepEqual(recentItemTitles([t('A'), t('B'), t('A'), t('회의', 'MEETING'), t('C')]), ['A', 'B', 'C']);
});

test('escClosesPopover: 그냥 Esc 는 닫고, 이미 처리했거나 글 쓰는 중이면 닫지 않는다', () => {
  assert.equal(escClosesPopover({ key: 'Escape', defaultPrevented: false, target: { tagName: 'DIV' } }), true);
  assert.equal(escClosesPopover({ key: 'Enter', defaultPrevented: false, target: null }), false);
  assert.equal(escClosesPopover({ key: 'Escape', defaultPrevented: true, target: null }), false);
  assert.equal(escClosesPopover({ key: 'Escape', defaultPrevented: false, target: { tagName: 'TEXTAREA' } }), false);
  assert.equal(escClosesPopover({ key: 'Escape', defaultPrevented: false, target: { tagName: 'INPUT' } }), false);
  assert.equal(escClosesPopover({ key: 'Escape', defaultPrevented: false, target: { tagName: 'DIV', isContentEditable: true } }), false);
});

test('escClosesPopover: 위에 상세 창(모달)이 떠 있으면 그 창만 닫히고 그날 상세는 남는다', () => {
  assert.equal(escClosesPopover({ key: 'Escape', defaultPrevented: false, target: { tagName: 'DIV' }, modalOpen: true }), false);
  assert.equal(escClosesPopover({ key: 'Escape', defaultPrevented: false, target: { tagName: 'DIV' }, modalOpen: false }), true);
});
