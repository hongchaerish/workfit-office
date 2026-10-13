import assert from 'node:assert/strict';
import test from 'node:test';
import type { CommuteRecord } from './schema';
import { describeCommuteRecord, leaveChip, scheduleChip } from './statusDisplay';

const rec = (over: Partial<CommuteRecord>): CommuteRecord => ({
  empId: 1,
  date: '2026-09-17',
  inAt: null,
  outAt: null,
  basicMin: 0,
  overMin: 0,
  nightMin: 0,
  lateMin: 0,
  totalMin: 0,
  status: 'normal',
  ...over,
});

const shorts = (r: CommuteRecord) => describeCommuteRecord(r).map((c) => c.short);

test('휴가 종류 표기: 연차·반차·반반차는 고정 표기, 그 외는 휴가 이름', () => {
  assert.deepEqual(leaveChip('연차'), { kind: 'annual', short: '연차', label: '연차' });
  assert.deepEqual(leaveChip('오전반차'), { kind: 'half', short: '반차', label: '오전반차' });
  assert.deepEqual(leaveChip('반반차', null, 'PM1'), { kind: 'quarter', short: '반반', label: '반반차 (오후 1)' });
  assert.deepEqual(leaveChip('대체휴무'), { kind: 'leave', short: '대체휴무', label: '대체휴무' });
});

test('반차 + 지각은 두 배지를 함께 낸다', () => {
  assert.deepEqual(shorts(rec({ status: 'late', lateMin: 12, leaveName: '오전반차' })), ['반차', '지각']);
});

test('외근·출장은 표시가 빠지지 않는다', () => {
  assert.deepEqual(shorts(rec({ status: 'outside', outsideName: '오전 외근' })), ['외근']);
  assert.equal(describeCommuteRecord(rec({ status: 'outside', outsideName: '오전 외근' }))[0].label, '오전 외근');
  assert.deepEqual(shorts(rec({ status: 'trip' })), ['출장']);
  assert.deepEqual(shorts(rec({ status: 'outside', leaveName: '오후반차' })), ['반차', '외근']);
});

test('휴일근무는 휴근, 주말·공휴일(승인 없는 출근 포함)은 배지 없음', () => {
  assert.deepEqual(shorts(rec({ status: 'holiday_work' })), ['휴근']);
  assert.deepEqual(shorts(rec({ status: 'off', holidayName: '개천절' })), []);
  assert.deepEqual(shorts(rec({ status: 'off', holidayName: '주말 휴무', inAt: '2026-09-19T09:00:00' })), []);
});

test('휴가인데 출근한 날은 휴가 배지, 미기록은 미체크', () => {
  assert.deepEqual(shorts(rec({ status: 'normal', leaveName: '연차' })), ['연차']);
  assert.deepEqual(shorts(rec({ status: 'normal' })), ['정상']);
  assert.equal(describeCommuteRecord(rec({ status: 'missing_out' }))[0].label, '퇴근 미기록');
});

test('결재 일정 칩', () => {
  assert.equal(scheduleChip({ category: 'LEAVE', leaveType: '오후반차' }).label, '오후반차');
  assert.equal(scheduleChip({ category: 'OUTSIDE', subType: '종일 외근' }).kind, 'outside');
  assert.equal(scheduleChip({ category: 'TRIP', subType: '해외출장' }).label, '해외출장');
});
