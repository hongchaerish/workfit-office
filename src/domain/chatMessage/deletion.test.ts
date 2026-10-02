import assert from 'node:assert/strict';
import test from 'node:test';
import { chatMessageSchema, type ChatMessage } from './schema';
import { applyDeletion, canDeleteMessage, DELETED_MESSAGE_TEXT, scrubReplyPreviews } from './deletion';

const me = { id: 'U012', name: '홍채원' };
const sentAt = '2026-10-02T10:00:00+09:00';
const at = (iso: string) => new Date(iso);

const msg = (over: Partial<ChatMessage> = {}): ChatMessage =>
  chatMessageSchema.parse({ id: 'm1', roomId: 'r1', senderId: me.id, senderName: me.name, text: '안녕하세요', at: sentAt, ...over });

// ── 삭제 가능 여부 ──

test('내가 보낸 메시지는 24시간 안에 삭제할 수 있다', () => {
  assert.deepEqual(canDeleteMessage(msg(), me.id, at('2026-10-03T09:59:00+09:00')), { allowed: true });
});

test('24시간이 지나면 삭제할 수 없다', () => {
  assert.deepEqual(canDeleteMessage(msg(), me.id, at('2026-10-03T10:01:00+09:00')), { allowed: false, reason: 'EXPIRED' });
});

test('남이 보낸 메시지는 삭제할 수 없다 (관리자 포함 — 관리자 권한은 없다)', () => {
  assert.deepEqual(canDeleteMessage(msg({ senderId: 'U011' }), me.id, at(sentAt)), { allowed: false, reason: 'NOT_SENDER' });
});

test('사진·파일 메시지도 삭제할 수 있다', () => {
  const attachment = { url: 'https://x/a.png', name: 'a.png', size: 1, mime: 'image/png' };
  assert.equal(canDeleteMessage(msg({ type: 'image', attachment }), me.id, at(sentAt)).allowed, true);
  assert.equal(canDeleteMessage(msg({ type: 'file', attachment }), me.id, at(sentAt)).allowed, true);
});

test('시스템 안내와 전자결재 알림 카드는 삭제할 수 없다', () => {
  assert.deepEqual(canDeleteMessage(msg({ type: 'system' }), me.id, at(sentAt)), { allowed: false, reason: 'NOT_DELETABLE' });
  assert.deepEqual(canDeleteMessage(msg({ type: 'approval_bot' }), me.id, at(sentAt)), { allowed: false, reason: 'NOT_DELETABLE' });
});

test('이미 삭제된 메시지는 다시 삭제할 수 없다', () => {
  const deleted = applyDeletion(msg(), me, at(sentAt));
  assert.deepEqual(canDeleteMessage(deleted, me.id, at(sentAt)), { allowed: false, reason: 'ALREADY_DELETED' });
});

// ── 삭제 결과 ──

test('삭제하면 내용·첨부·답장 인용·반응을 지우고 누가 언제 지웠는지 남긴다', () => {
  const original = msg({
    type: 'image',
    attachment: { url: 'https://x/a.png', name: 'a.png', size: 1, mime: 'image/png' },
    replyTo: { id: 'm0', senderName: '김승기', text: '원문' },
    reactions: { '👍': ['U011'] },
    isEdited: true,
  });
  const d = applyDeletion(original, me, at('2026-10-02T10:05:00+09:00'));
  assert.equal(d.text, DELETED_MESSAGE_TEXT);
  assert.equal(d.type, 'text'); // 예전 클라이언트(Flutter 앱)에도 문구로 보이게
  assert.equal(d.attachment, null);
  assert.equal(d.replyTo, null);
  assert.deepEqual(d.reactions, {});
  assert.equal(d.deletedBy, me.id);
  assert.equal(d.deletedByName, me.name);
  assert.equal(d.deletedAt, new Date('2026-10-02T10:05:00+09:00').toISOString());
  // 전송 시각·보낸 사람·읽음은 그대로(대화 순서·미읽음 수 유지)
  assert.equal(d.at, original.at);
  assert.equal(d.senderId, original.senderId);
});

test('삭제된 메시지를 인용한 답장의 미리보기 문구도 지운다', () => {
  const others = [
    msg({ id: 'm2', replyTo: { id: 'm1', senderName: '홍채원', text: '안녕하세요' } }),
    msg({ id: 'm3', replyTo: { id: 'm9', senderName: '김승기', text: '다른 글' } }),
    msg({ id: 'm4' }),
  ];
  const changed = scrubReplyPreviews(others, 'm1');
  assert.deepEqual(changed.map((m) => m.id), ['m2']);
  assert.equal(changed[0].replyTo?.text, DELETED_MESSAGE_TEXT);
});
