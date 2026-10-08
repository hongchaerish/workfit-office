import test from 'node:test';
import assert from 'node:assert/strict';
import { addSeat, assignSeat, clampPercent, moveSeat, nextSeatId, removeSeat, setSeatLabel } from './engine';
import type { Seat } from './schema';

const seat = (id: string, userId: string | null = null): Seat => ({ id, x: 10, y: 10, userId, label: '' });

test('좌표는 0~100 안으로 자르고 소수 둘째 자리까지 맞춘다', () => {
  assert.equal(clampPercent(-5), 0);
  assert.equal(clampPercent(120), 100);
  assert.equal(clampPercent(33.3333), 33.33);
  assert.equal(clampPercent(Number.NaN), 0);
});

test('새 좌석 ID는 기존 ID와 겹치지 않는다', () => {
  assert.equal(nextSeatId([]), 'S1');
  assert.equal(nextSeatId([seat('S1'), seat('S3')]), 'S4');
  assert.equal(nextSeatId([seat('S3'), seat('S2')]), 'S4');
});

test('좌석 추가·이동·삭제', () => {
  const { seats, seat: added } = addSeat([], 150, 20);
  assert.equal(added.x, 100);
  assert.equal(added.userId, null);
  const moved = moveSeat(seats, added.id, 40, 50);
  assert.deepEqual([moved[0].x, moved[0].y], [40, 50]);
  assert.equal(removeSeat(moved, added.id).length, 0);
});

test('한 사람은 한 자리에만 앉는다 — 다른 자리로 옮기면 이전 자리는 비워진다', () => {
  const seats = [seat('S1', 'U1'), seat('S2'), seat('S3', 'U2')];
  const next = assignSeat(seats, 'S2', 'U1');
  assert.equal(next.find((s) => s.id === 'S1')?.userId, null);
  assert.equal(next.find((s) => s.id === 'S2')?.userId, 'U1');
  assert.equal(next.find((s) => s.id === 'S3')?.userId, 'U2');
});

test('null 을 넣으면 그 자리만 비운다', () => {
  const next = assignSeat([seat('S1', 'U1'), seat('S2', 'U2')], 'S1', null);
  assert.deepEqual(next.map((s) => s.userId), [null, 'U2']);
});

test('좌석 이름은 30자까지만 남긴다', () => {
  const next = setSeatLabel([seat('S1')], 'S1', '가'.repeat(40));
  assert.equal(next[0].label.length, 30);
});
