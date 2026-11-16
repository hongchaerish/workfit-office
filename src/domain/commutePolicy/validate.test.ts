import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_COMMUTE_POLICY } from './schema';
import { breakMinutesOf, policyTimeError } from './validate';

const base = { ...DEFAULT_COMMUTE_POLICY, workStartTime: '08:30', workEndTime: '17:30', breakStartTime: '12:00', breakEndTime: '13:00' };

test('정상 정책은 문제 없음', () => {
  assert.equal(policyTimeError(base), null);
});

test('휴게 시작을 오후로 잘못 고르면(23:30~12:30) 막는다', () => {
  assert.match(policyTimeError({ ...base, breakStartTime: '23:30', breakEndTime: '12:30' }) ?? '', /휴게/);
});

test('휴게가 근무시간 밖이면 막는다', () => {
  assert.match(policyTimeError({ ...base, breakStartTime: '07:00', breakEndTime: '08:00' }) ?? '', /근무시간 안/);
  assert.match(policyTimeError({ ...base, breakStartTime: '17:00', breakEndTime: '18:00' }) ?? '', /근무시간 안/);
});

test('퇴근이 출근보다 빠르면 막는다', () => {
  assert.match(policyTimeError({ ...base, workStartTime: '20:30', workEndTime: '17:30' }) ?? '', /출근/);
});

test('휴게 분은 휴게 시각에서 계산', () => {
  assert.equal(breakMinutesOf('11:30', '12:30'), 60);
  assert.equal(breakMinutesOf('12:00', '13:30'), 90);
  assert.equal(breakMinutesOf('23:30', '12:30'), 0);
});
