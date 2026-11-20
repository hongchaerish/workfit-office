import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultRoutineRule, newRoutineId, routineDates, routineLabel, routinePlan, routineSchema, validateRoutineRule } from './routine';

// 2026-11-02 = 월요일
test('루틴 날짜 — 매주 월·수, 시작부터 끝 날짜까지', () => {
  assert.deepEqual(routineDates('2026-11-02', { freq: 'WEEKLY', days: [1, 3], until: '2026-11-12' }), [
    '2026-11-02', '2026-11-04', '2026-11-09', '2026-11-11',
  ]);
});

test('루틴 날짜 — 평일은 주말을 건너뛰고, 시작 날짜는 규칙에 안 맞아도 넣는다', () => {
  assert.deepEqual(routineDates('2026-11-07', { freq: 'WEEKDAYS', days: [], until: '2026-11-10' }), [
    '2026-11-07', '2026-11-09', '2026-11-10',
  ]);
});

test('루틴 날짜 — 매월 31일은 31일이 없는 달을 건너뛴다', () => {
  assert.deepEqual(routineDates('2026-10-31', { freq: 'MONTHLY', days: [], until: '2027-01-31' }), [
    '2026-10-31', '2026-12-31', '2027-01-31',
  ]);
});

test('루틴 날짜 — 매일 1년은 최대 횟수에서 끊는다', () => {
  assert.equal(routineDates('2026-11-02', { freq: 'DAILY', days: [], until: '2027-11-02' }).length, 120);
});

test('루틴 규칙 확인·이름', () => {
  assert.equal(validateRoutineRule('2026-11-02', { freq: 'WEEKLY', days: [], until: '2026-12-01' }), '반복할 요일을 고르세요.');
  assert.equal(validateRoutineRule('2026-11-02', { freq: 'DAILY', days: [], until: '2026-11-01' }), '반복 끝 날짜는 시작 날짜보다 빠를 수 없습니다.');
  assert.equal(validateRoutineRule('2026-11-02', { freq: 'DAILY', days: [], until: '2027-12-01' }), '반복은 1년까지 만들 수 있습니다.');
  assert.deepEqual(defaultRoutineRule('2026-11-30'), { freq: 'WEEKLY', days: [1], until: '2027-03-02' });
  assert.equal(routineLabel('2026-11-02', { freq: 'WEEKLY', days: [0, 3, 1], until: '2027-01-31' }), '매주 월·수·일 · 1/31까지');
  assert.equal(routineLabel('2026-11-15', { freq: 'MONTHLY', days: [], until: '2027-01-31' }), '매월 15일 · 1/31까지');
});

test('루틴 id 형식', () => {
  const id = newRoutineId(1_700_000_000_000, () => 0.5);
  assert.ok(routineSchema.shape.id.safeParse(id).success, id);
});

test('루틴 날짜 — 공휴일은 빼고, 뺀 날짜를 따로 알려 준다(누른 날은 공휴일이어도 넣는다)', () => {
  const holidays = new Set(['2026-12-25', '2027-01-01']);
  const plan = routinePlan('2026-12-24', { freq: 'WEEKDAYS', days: [], until: '2027-01-04' }, holidays);
  assert.deepEqual(plan.dates, ['2026-12-24', '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-04']);
  assert.deepEqual(plan.skipped, ['2026-12-25', '2027-01-01']);
  assert.deepEqual(routineDates('2026-12-25', { freq: 'WEEKDAYS', days: [], until: '2026-12-28' }, holidays), ['2026-12-25', '2026-12-28']);
});

test('루틴 날짜 — 공휴일로 뺀 날은 최대 횟수에 세지 않는다', () => {
  const holidays = new Set(['2026-11-03']);
  assert.equal(routineDates('2026-11-02', { freq: 'DAILY', days: [], until: '2027-11-02' }, holidays).length, 120);
  assert.equal(routineDates('2026-11-02', { freq: 'DAILY', days: [], until: '2027-11-02' }, holidays).includes('2026-11-03'), false);
});
