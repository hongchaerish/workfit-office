import assert from 'node:assert/strict';
import test from 'node:test';
import { nextEmpNo, isDuplicateEmpNo } from './empNo';

const oct2026 = new Date('2026-10-15T03:00:00Z');

test('올해 사번 중 가장 큰 순번 다음 — 2612 다음은 2613', () => {
  assert.equal(nextEmpNo(['2501', '2601', '2612', '2605'], oct2026), '2613');
});

test('사번이 아닌 아이디(영문 등)와 다른 해 사번은 순번 계산에서 뺀다', () => {
  assert.equal(nextEmpNo(['jihye.choi', 'oilking5151', 'testa', '2599', '2603'], oct2026), '2604');
});

test('올해 사번이 없으면 01부터, 해가 바뀌면 새로 시작', () => {
  assert.equal(nextEmpNo(['2501', '2502'], oct2026), '2601');
  assert.equal(nextEmpNo(['2612'], new Date('2027-01-02T00:00:00Z')), '2701');
});

test('한국 시간 기준 연도 — 12월 31일 밤(UTC로는 같은 해)도 한국 날짜로 본다', () => {
  assert.equal(nextEmpNo([], new Date('2026-12-31T16:00:00Z')), '2701');
});

test('순번이 99를 넘으면 자리를 늘린다', () => {
  assert.equal(nextEmpNo(['2699'], oct2026), '26100');
  assert.equal(nextEmpNo(['2699', '26100'], oct2026), '26101');
});

test('사번 중복 — 대소문자·앞뒤 공백 무시, 자기 자신은 제외', () => {
  const users = [{ id: 'U1', empNo: '2601' }, { id: 'U2', empNo: 'Jihye.Choi' }];
  assert.equal(isDuplicateEmpNo(users, ' 2601 '), true);
  assert.equal(isDuplicateEmpNo(users, 'jihye.choi'), true);
  assert.equal(isDuplicateEmpNo(users, '2601', 'U1'), false);
  assert.equal(isDuplicateEmpNo(users, '2613'), false);
});
