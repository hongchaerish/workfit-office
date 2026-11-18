import assert from 'node:assert/strict';
import test from 'node:test';
import { firstFreeStart, freeSlots, LUNCH, lunchRangeOf } from './freeSlots';

test('freeSlots: 점심과 바쁜 시간을 빼고 30분 이상만', () => {
  assert.deepEqual(freeSlots([{ start: 540, end: 600 }, { start: 840, end: 870 }]), [
    { start: 600, end: 720 },
    { start: 780, end: 840 },
    { start: 870, end: 1080 },
  ]);
});

test('freeSlots: 20분짜리 틈은 버린다', () => {
  assert.deepEqual(freeSlots([{ start: 540, end: 700 }, { start: 780, end: 1080 }]), []);
});

test('freeSlots: notBefore 10:35 → 11:00부터', () => {
  assert.deepEqual(freeSlots([], { notBefore: 635 })[0], { start: 660, end: 720 });
});

test('freeSlots: 18시 이후 notBefore → 빈 배열', () => {
  assert.deepEqual(freeSlots([], { notBefore: 1090 }), []);
});

test('freeSlots: 겹친 바쁜 시간도 한 번에 막는다', () => {
  assert.deepEqual(freeSlots([{ start: 540, end: 660 }, { start: 600, end: 700 }], { lunch: null }), [{ start: 700, end: 1080 }]);
});

test('firstFreeStart: 두 사람 모두 비는 첫 시각', () => {
  assert.equal(firstFreeStart([[{ start: 540, end: 600 }], [{ start: 600, end: 660 }]], 60), 660);
});

test('firstFreeStart: 점심에 걸치면 건너뛴다', () => {
  assert.equal(firstFreeStart([[{ start: 540, end: 690 }]], 60), 780);
});

test('firstFreeStart: 없으면 null', () => {
  assert.equal(firstFreeStart([[{ start: 540, end: 1080 }]], 30), null);
});

test('firstFreeStart: notBefore 이후 30분 단위', () => {
  assert.equal(firstFreeStart([[]], 60, { notBefore: 635 }), 660);
});

test('lunchRangeOf: 근태 정책의 휴게(점심) 시각을 따른다', () => {
  assert.deepEqual(lunchRangeOf({ breakStartTime: '11:30', breakEndTime: '12:30' }), { start: 690, end: 750 });
});

test('lunchRangeOf: 정책이 없거나 시각이 이상하면 기본 12:00~13:00', () => {
  assert.deepEqual(lunchRangeOf(undefined), LUNCH);
  assert.deepEqual(lunchRangeOf({ breakStartTime: '13:00', breakEndTime: '12:00' }), LUNCH);
  assert.deepEqual(lunchRangeOf({ breakStartTime: '', breakEndTime: '12:00' }), LUNCH);
});
