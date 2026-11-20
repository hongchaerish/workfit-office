import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addItem, dropItem, type OutboxItem } from './chatOutbox';

const item = (id: string, status: OutboxItem['status'] = 'sending'): OutboxItem => ({
  id,
  roomId: 'r1',
  senderId: 'u1',
  senderName: '나',
  replyTo: null,
  payload: { kind: 'text', text: id },
  text: id,
  images: [],
  fileNames: [],
  status,
});

test('보낸 차례대로 쌓인다', () => {
  const list = addItem(addItem([], item('a')), item('b'));
  assert.deepEqual(list.map((x) => x.id), ['a', 'b']);
});

test('같은 메시지를 다시 넣으면 하나만 남고 상태가 바뀐다(실패 → 재전송)', () => {
  const failed = addItem([item('a')], item('a', 'failed'));
  assert.equal(failed.length, 1);
  assert.equal(failed[0].status, 'failed');
  const retried = addItem(failed, item('a', 'sending'));
  assert.deepEqual(retried.map((x) => [x.id, x.status]), [['a', 'sending']]);
});

test('지우면 그 메시지만 빠진다', () => {
  const list = dropItem([item('a'), item('b')], 'a');
  assert.deepEqual(list.map((x) => x.id), ['b']);
});
