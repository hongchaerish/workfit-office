import assert from 'node:assert/strict';
import test from 'node:test';
import { assertAccountStatusEdit, ACCOUNT_EDITABLE_STATUSES } from './accountStatus';

test('사용자 관리에서 고를 수 있는 계정 상태는 사용·잠금뿐', () => {
  assert.deepEqual([...ACCOUNT_EDITABLE_STATUSES], ['사용', '잠금']);
});

test('사용 ↔ 잠금은 자유롭게, 새 계정도 사용·잠금으로 만든다', () => {
  assert.doesNotThrow(() => assertAccountStatusEdit('사용', '잠금'));
  assert.doesNotThrow(() => assertAccountStatusEdit('잠금', '사용'));
  assert.doesNotThrow(() => assertAccountStatusEdit(undefined, '사용'));
  assert.doesNotThrow(() => assertAccountStatusEdit(undefined, '잠금'));
});

test('미사용(퇴직)으로 바꾸는 건 사용자 관리에서 못 한다 — 인명관리 퇴직 처리로만', () => {
  assert.throws(() => assertAccountStatusEdit('사용', '미사용'), /퇴직 처리/);
  assert.throws(() => assertAccountStatusEdit(undefined, '미사용'), /퇴직 처리/);
});

test('미사용(퇴직) 계정은 사용자 관리에서 다시 사용·잠금으로 돌리지 못한다 — 다른 항목 수정은 된다', () => {
  assert.throws(() => assertAccountStatusEdit('미사용', '사용'), /퇴직/);
  assert.throws(() => assertAccountStatusEdit('미사용', '잠금'), /퇴직/);
  assert.doesNotThrow(() => assertAccountStatusEdit('미사용', '미사용'));
});
