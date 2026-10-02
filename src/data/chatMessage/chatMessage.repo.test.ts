import assert from 'node:assert/strict';
import test from 'node:test';
import { chatMessageSchema, type ChatMessage } from '@/domain/chatMessage/schema';
import { DELETED_MESSAGE_TEXT } from '@/domain/chatMessage/deletion';
import { chatMessageRepo } from './chatMessage.repo';

const me = { id: 'U012', name: '홍채원' };
const nowIso = () => new Date().toISOString();
const msg = (over: Partial<ChatMessage>): ChatMessage =>
  chatMessageSchema.parse({ roomId: 'room-del', senderId: me.id, senderName: me.name, text: '원문', at: nowIso(), ...over });

test('내 메시지를 삭제하면 저장된 내용이 지워지고, 그 메시지를 인용한 답장 미리보기도 지워진다', async () => {
  await chatMessageRepo.append(msg({ id: 'del-1', text: '지울 메시지' }));
  await chatMessageRepo.append(msg({ id: 'del-2', senderId: 'U011', senderName: '김승기', text: '답장', replyTo: { id: 'del-1', senderName: me.name, text: '지울 메시지' } }));

  const deleted = await chatMessageRepo.deleteMessage('del-1', me);
  assert.equal(deleted.text, DELETED_MESSAGE_TEXT);

  const rows = await chatMessageRepo.listByRoom('room-del');
  const stored = rows.find((m) => m.id === 'del-1')!;
  assert.equal(stored.text, DELETED_MESSAGE_TEXT);
  assert.equal(stored.deletedBy, me.id);
  assert.equal(rows.find((m) => m.id === 'del-2')!.replyTo?.text, DELETED_MESSAGE_TEXT);
});

test('남의 메시지는 저장 단계에서도 거부된다', async () => {
  await chatMessageRepo.append(msg({ id: 'del-3', senderId: 'U011', senderName: '김승기' }));
  await assert.rejects(chatMessageRepo.deleteMessage('del-3', me), /내가 보낸 메시지만/);
  const stored = (await chatMessageRepo.listByRoom('room-del')).find((m) => m.id === 'del-3')!;
  assert.equal(stored.text, '원문');
});

test('24시간이 지난 메시지는 저장 단계에서도 거부된다', async () => {
  await chatMessageRepo.append(msg({ id: 'del-4', at: new Date(Date.now() - 25 * 3600 * 1000).toISOString() }));
  await assert.rejects(chatMessageRepo.deleteMessage('del-4', me), /24시간/);
});
