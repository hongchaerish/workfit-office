import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatMessage } from '@/domain/chatMessage/schema';
import { bubbleMessagesOf, imageBundleRows, isGroupedWithPrevious, processMessageBundles } from './messageBundles';

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

test('processMessageBundles: 한 번에 보낸 사진들은 composite-bundle로 한 묶음', () => {
  const items = processMessageBundles([msg('a'), msg('b'), msg('c')]);
  assert.equal(items.length, 1);
  assert.equal(items[0].type, 'composite-bundle');
  assert.deepEqual(items[0].bundleMessages?.map((m) => m.id), ['a', 'b', 'c']);
  assert.equal(items[0].images?.length, 3);
});

test('processMessageBundles: 분(minute) 경계를 넘어도 60초 안에 이어 올라온 사진은 한 묶음', () => {
  const items = processMessageBundles([
    msg('a', { at: '2026-10-01T10:00:58' }),
    msg('b', { at: '2026-10-01T10:01:03' }),
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].type, 'composite-bundle');
  assert.equal(items[0].bundleMessages?.length, 2);
});

test('processMessageBundles: 본문 텍스트와 사진/파일이 함께 오면 하나의 composite-bundle로 통합', () => {
  const items = processMessageBundles([
    msg('text1', { type: 'text', attachment: null, text: '테스트용입니다. 메세지, 첨부파일, 이미지가 잘 들어가나요?' }),
    msg('img1', { type: 'image', attachment: { url: 'u/img1', name: 'cat.png', size: 100, mime: 'image/png' } }),
    msg('file1', { type: 'file', attachment: { url: 'u/file1', name: 'doc.xlsx', size: 200, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } }),
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].type, 'composite-bundle');
  assert.equal(items[0].text, '테스트용입니다. 메세지, 첨부파일, 이미지가 잘 들어가나요?');
  assert.equal(items[0].images?.length, 1);
  assert.equal(items[0].files?.length, 1);
});

test('processMessageBundles: 다른 사람 또는 1분 넘게 떨어진 사진은 묶지 않는다', () => {
  const items = processMessageBundles([
    msg('a'),
    msg('b', { senderId: 'U2' }),
    msg('c', { senderId: 'U2', at: '2026-10-01T10:05:00' }),
  ]);
  assert.deepEqual(items.map((i) => i.type), ['message', 'message', 'message']);
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

test('processMessageBundles: 사진 뒤에 따로 보낸 글은 카드에 합치지 않고, 같은 글을 두 번 보내도 둘 다 보인다', () => {
  const text = (id: string, body: string, at: string) => msg(id, { type: 'text', attachment: null, text: body, at });
  const items = processMessageBundles([
    msg('p1', { at: '2026-10-01T10:00:00' }),
    text('t1', '네', '2026-10-01T10:00:10'),
    text('t2', '네', '2026-10-01T10:00:20'),
    text('t3', '회의 3시로 옮겨요', '2026-10-01T10:00:50'),
  ]);
  assert.deepEqual(items.map((i) => i.message.id), ['p1', 't1', 't2', 't3']);
  assert.deepEqual(items.map((i) => i.type), ['message', 'message', 'message', 'message']);
});

test('엔터를 따로 친 전송은 같은 초여도 별개 메시지 — 사진 하나 보내고 바로 또 사진 하나', () => {
  const at = '2026-10-08T15:00:00';
  const items = processMessageBundles([msg('R-1791440000000', { at }), msg('R-1791440000850', { at })]);
  assert.deepEqual(items.map((i) => i.type), ['message', 'message']);
});

test('엔터 한 번에 보낸 묶음(일련번호가 이어짐)은 한 카드', () => {
  const at = '2026-10-08T15:00:00';
  const items = processMessageBundles([msg('R-1000', { at }), msg('R-1001', { at }), msg('R-1002', { at, type: 'text', attachment: null, text: '설명' })]);
  assert.equal(items.length, 1);
  assert.equal(items[0].type, 'composite-bundle');
});

test('새 메시지는 60초 안에 이어 보낸 사진이라도 따로 보낸 것이면 묶지 않는다(옛 규칙은 10/2 이전만)', () => {
  const items = processMessageBundles([
    msg('R-1791440000000', { at: '2026-10-08T15:00:00' }),
    msg('R-1791440030000', { at: '2026-10-08T15:00:30' }),
  ]);
  assert.deepEqual(items.map((i) => i.type), ['message', 'message']);
});

test('말풍선을 통째로 지우면 삭제 안내는 한 줄, bubbleMessagesOf 는 말풍선 전체를 돌려준다', () => {
  const at = '2026-10-08T15:00:00';
  const del = { type: 'text' as const, attachment: null, text: '삭제된 메시지입니다.', deletedAt: '2026-10-08T06:01:00Z' };
  const items = processMessageBundles([msg('R-1000', { at, ...del }), msg('R-1001', { at, ...del }), msg('R-9000', { at: '2026-10-08T15:02:00', type: 'text', attachment: null, text: '다음' })]);
  assert.equal(items.length, 2);
  assert.equal(items[0].bundleMessages?.length, 2);
  const live = processMessageBundles([msg('R-2000', { at }), msg('R-2001', { at })]);
  assert.deepEqual(bubbleMessagesOf(live, live[0].message).map((m) => m.id), ['R-2000', 'R-2001']);
});
