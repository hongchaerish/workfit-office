import assert from 'node:assert/strict';
import test from 'node:test';
import { nextRoleDraft } from './roleDraft';

const role = (id: string, permissions: string[]) => ({ id, permissions });

test('다른 역할을 고르면 그 역할로 바꾼다', () => {
  const a = role('A', ['x']), b = role('B', ['y']);
  assert.equal(nextRoleDraft(a, b, a), b);
});

test('고치던 내용이 없으면 서버에서 새로 온 같은 역할을 그대로 따른다', () => {
  const old = role('A', ['x']), fresh = role('A', ['x', 'z']);
  assert.equal(nextRoleDraft(old, fresh, { ...old }), fresh);
});

test('저장 안 한 수정이 있으면 같은 역할이 다시 와도(다른 관리자 저장·실시간 신호) 덮어쓰지 않는다', () => {
  const old = role('A', ['x']), fresh = role('A', ['x']);
  const editing = role('A', ['x', 'mine']);
  assert.equal(nextRoleDraft(old, fresh, editing), editing);
});

test('선택이 사라지면 비운다', () => {
  assert.equal(nextRoleDraft(role('A', []), null, role('A', ['m'])), null);
});
