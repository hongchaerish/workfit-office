import assert from 'node:assert/strict';
import test from 'node:test';
import type { Attachment } from '@/domain/chatMessage/schema';
import { buildAttachmentBatch } from './attachmentBatch';
import { processMessageBundles } from './messageBundles';

const img = (n: string): Attachment => ({ url: `u/${n}`, name: `${n}.png`, size: 1, mime: 'image/png' });
const base = { roomId: 'R', senderId: 'U1', senderName: '홍', at: '2026-10-01T10:00:58', baseTime: 1000 };
const reply = { id: 'M0', senderName: '김', text: '원문' };

test('파일 한 개: 글과 답장을 그 메시지에 함께 담는다', () => {
  const [m] = buildAttachmentBatch({ ...base, attachments: [img('a')], text: '설명', replyTo: reply });
  assert.equal(m.text, '설명');
  assert.deepEqual(m.replyTo, reply);
  assert.equal(m.type, 'image');
});

test('사진 여러 장: 같은 시각·증가하는 id, 글은 사진 뒤 별도 메시지로 → 사진은 한 묶음', () => {
  const batch = buildAttachmentBatch({ ...base, attachments: [img('a'), img('b'), img('c')], text: '설명', replyTo: reply });
  assert.deepEqual(batch.map((m) => m.type), ['image', 'image', 'image', 'text']);
  assert.ok(batch.every((m) => m.at === base.at));
  assert.deepEqual(batch.map((m) => m.id), ['R-1000', 'R-1001', 'R-1002', 'R-1003']);
  assert.ok(batch.slice(0, 3).every((m) => m.text === '' && m.replyTo === null));
  assert.deepEqual(batch[3].replyTo, reply);
  // 같은 배치의 글까지 한 카드(composite-bundle)로 묶인다.
  const items = processMessageBundles(batch);
  assert.equal(items.length, 1);
  assert.equal(items[0].type, 'composite-bundle');
  assert.equal(items[0].images?.length, 3);
  assert.equal(items[0].text, '설명');
});

test('사진 여러 장 + 글 없이 답장: 답장은 첫 사진에 담아 묶음 위에 보이게', () => {
  const batch = buildAttachmentBatch({ ...base, attachments: [img('a'), img('b')], text: '', replyTo: reply });
  assert.equal(batch.length, 2);
  assert.deepEqual(batch[0].replyTo, reply);
  assert.equal(batch[1].replyTo, null);
});

test('사진이 아닌 파일은 file 타입', () => {
  const [m] = buildAttachmentBatch({ ...base, attachments: [{ url: 'u', name: 'a.pdf', size: 1, mime: 'application/pdf' }], text: '', replyTo: null });
  assert.equal(m.type, 'file');
});
