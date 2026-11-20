import assert from 'node:assert/strict';
import test from 'node:test';
import { holidayDateSet, yearsBetween } from './holidayDates';

test('holidayDateSet: DB 휴일(회사 휴일 포함)과 기본 공휴일을 합친다', () => {
  const set = holidayDateSet([{ date: '2026-12-31' }], ['2026', '2027']);
  assert.equal(set.has('2026-12-31'), true); // 회사 휴일
  assert.equal(set.has('2026-12-25'), true); // 기본 공휴일
  assert.equal(set.has('2027-03-01'), true);
});

test('holidayDateSet: DB에 그해가 일부만 있어도(신정만) 설 연휴가 빠지지 않는다', () => {
  const set = holidayDateSet([{ date: '2027-01-01' }], ['2027']);
  for (const d of ['2027-02-08', '2027-02-09']) assert.equal(set.has(d), true, d);
});

test('yearsBetween: 걸친 해', () => {
  assert.deepEqual(yearsBetween('2026-11-20', '2027-02-28'), ['2026', '2027']);
  assert.deepEqual(yearsBetween('2026-01-01', '2026-12-31'), ['2026']);
});
