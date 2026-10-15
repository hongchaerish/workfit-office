import assert from 'node:assert/strict';
import test from 'node:test';
import { accountStatusOnTransition } from './lifecycle';

test('재직 상태가 바뀔 때만 계정 상태를 맞춘다 — 그대로면 사용자 관리에서 정한 계정 상태를 건드리지 않는다', () => {
  assert.equal(accountStatusOnTransition('ACTIVE', 'ACTIVE'), null);
  assert.equal(accountStatusOnTransition('LEAVE', 'LEAVE'), null);
  assert.equal(accountStatusOnTransition(undefined, 'ACTIVE'), null);
});

test('휴직이면 잠금, 복직이면 사용', () => {
  assert.equal(accountStatusOnTransition('ACTIVE', 'LEAVE'), '잠금');
  assert.equal(accountStatusOnTransition('LEAVE', 'ACTIVE'), '사용');
});

test('퇴직은 일반 저장으로 바꾸지 않는다 — 퇴직 처리 절차(계정 비활성화·상급자 재연결)를 따로 거친다', () => {
  assert.throws(() => accountStatusOnTransition('ACTIVE', 'RETIRED'), /퇴직 처리/);
});
