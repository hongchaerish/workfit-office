import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatMessage } from '@/domain/chatMessage/schema';
import { imageBundleRows, isGroupedWithPrevious, processMessageBundles } from './messageBundles';

const msg = (id: string, over: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  roomId: 'R',
  senderId: 'U1',
  senderName: '홍',
  text: '',
  type: 'image',
  attachment: { url: `u/${id}`, name: `${id}.png`, size: 1, mime: 'image/png' },
  replyTo: null,
  approvalPayload: null,
  at: '2026-10-01T10:00:00',
  readBy: [],
  isEdited: false,
  reactions: {},
  ...over,
});

test('processMessageBundles: 한 번에 보낸 사진들은 한 묶음', () => {
  const items = processMessageBundles([msg('a'), msg('b'), msg('c')]);
  assert.equal(items.length, 1);
  assert.equal(items[0].type, 'image-bundle');
  assert.deepEqual(items[0].bundleMessages?.map((m) => m.id), ['a', 'b', 'c']);
});

test('processMessageBundles: 분(minute) 경계를 넘어도 60초 안에 이어 올라온 사진은 한 묶음', () => {
  const items = processMessageBundles([
    msg('a', { at: '2026-10-01T10:00:58' }),
    msg('b', { at: '2026-10-01T10:01:03' }),
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].bundleMessages?.length, 2);
});

test('processMessageBundles: 다른 사람·글자 있는 사진·1분 넘게 떨어진 사진은 묶지 않는다', () => {
  const items = processMessageBundles([
    msg('a'),
    msg('b', { senderId: 'U2' }),
    msg('c', { senderId: 'U2', text: '설명' }),
    msg('d', { senderId: 'U2', at: '2026-10-01T10:05:00' }),
  ]);
  assert.deepEqual(items.map((i) => i.type), ['message', 'message', 'message', 'message']);
});

test('imageBundleRows: 카카오톡처럼 3장씩, 1장 남으면 마지막 두 줄을 2·2로', () => {
  assert.deepEqual(imageBundleRows(2), [2]);
  assert.deepEqual(imageBundleRows(3), [3]);
  assert.deepEqual(imageBundleRows(4), [2, 2]);
  assert.deepEqual(imageBundleRows(5), [3, 2]);
  assert.deepEqual(imageBundleRows(6), [3, 3]);
  assert.deepEqual(imageBundleRows(7), [3, 2, 2]);
  assert.deepEqual(imageBundleRows(10), [3, 3, 2, 2]);
});

test('isGroupedWithPrevious: 같은 사람이 같은 분에 보낸 연속 메시지만 붙인다', () => {
  const a = msg('a', { type: 'text', attachment: null, text: '1' });
  assert.equal(isGroupedWithPrevious(a, msg('b', { type: 'text', attachment: null, text: '2' })), true);
  assert.equal(isGroupedWithPrevious(a, msg('b', { type: 'text', attachment: null, senderId: 'U2' })), false);
  assert.equal(isGroupedWithPrevious(a, msg('b', { type: 'text', attachment: null, at: '2026-10-01T10:01:00' })), false);
  assert.equal(isGroupedWithPrevious(a, msg('b', { type: 'system', attachment: null, senderId: 'U1' })), false);
  assert.equal(isGroupedWithPrevious(null, a), false);
});
