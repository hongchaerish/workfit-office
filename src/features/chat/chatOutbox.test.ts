import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RESUME_WITHIN_MS, addItem, dropItem, shouldResume } from './chatOutbox';

const item = (id: string, status: 'sending' | 'failed' = 'sending') => ({ id, status });

test('보낸 차례대로 쌓인다', () => {
  const list = addItem(addItem([], item('a')), item('b'));
  assert.deepEqual(list.map((x) => x.id), ['a', 'b']);
});

test('같은 메시지를 다시 넣으면 제자리에서 상태만 바뀐다(실패 → 재전송)', () => {
  const failed = addItem([item('a'), item('b')], item('a', 'failed'));
  assert.deepEqual(failed.map((x) => [x.id, x.status]), [['a', 'failed'], ['b', 'sending']]);
  const retried = addItem(failed, item('a', 'sending'));
  assert.deepEqual(retried.map((x) => [x.id, x.status]), [['a', 'sending'], ['b', 'sending']]);
});

test('지우면 그 메시지만 빠진다', () => {
  const list = dropItem([item('a'), item('b')], 'a');
  assert.deepEqual(list.map((x) => x.id), ['b']);
});

test('다시 열었을 때 — 방금 끊긴 보내는 중만 이어 보낸다', () => {
  const now = 1_000_000_000;
  assert.equal(shouldResume({ status: 'sending', createdAt: now - 5_000 }, now), true);
  assert.equal(shouldResume({ status: 'sending', createdAt: now - RESUME_WITHIN_MS }, now), false); // 오래됨 → 전송 실패로 보여 준다
  assert.equal(shouldResume({ status: 'failed', createdAt: now - 5_000 }, now), false); // 실패한 것은 사용자가 고른다
});
