import assert from 'node:assert/strict';
import test from 'node:test';
import { outsideWorkSchema } from './schema';

const now = new Date().toISOString();
const base = {
  id: 'OW-20261020-0001', ownerUserId: 'U010', category: 'OUTSIDE', subType: '시간 외근',
  startDate: '2026-10-20', endDate: '2026-10-20', allDay: false, startTime: '13:00', endTime: '17:00',
  destination: 'OO전자', createdAt: now, updatedAt: now,
};

test('정상 입력은 기본값을 채워 통과한다', () => {
  const parsed = outsideWorkSchema.parse(base);
  assert.deepEqual(parsed.companionUserIds, []);
  assert.equal(parsed.purpose, '');
});

test('장소는 필수다', () => {
  assert.equal(outsideWorkSchema.safeParse({ ...base, destination: ' ' }).success, false);
});

test('종료일이 시작일보다 빠르면 거부한다', () => {
  assert.equal(outsideWorkSchema.safeParse({ ...base, endDate: '2026-10-19' }).success, false);
});

test('시간 지정 시 종료가 시작보다 늦어야 한다', () => {
  assert.equal(outsideWorkSchema.safeParse({ ...base, endTime: '12:00' }).success, false);
});

test('구분에 맞지 않는 세부 구분은 거부한다', () => {
  assert.equal(outsideWorkSchema.safeParse({ ...base, subType: '국내출장' }).success, false);
});
