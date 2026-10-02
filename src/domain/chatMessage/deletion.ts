import type { ChatMessage } from './schema';

/**
 * 메시지 삭제(모두에게서) 규칙 — 웹·PWA 공용 단일 경계.
 *
 * - **보낸 사람 본인만**, 보낸 지 **24시간 이내**, 일반·사진·파일 메시지만 지울 수 있다.
 * - 관리자 권한 삭제는 없다(결정: 2026-10-02). 꼭 필요하면 관리자가 DB에서 직접 처리한다.
 * - 메시지 문서는 남기고 내용만 지운다 — 대화 순서·답장 연결·미읽음 수가 유지되고,
 *   이 컬렉션을 함께 읽는 예전 클라이언트(Flutter 앱)에도 안내 문구로 보인다.
 *
 * ⚠️ 이 경계는 앱(화면·저장 로직) 수준이다. `chatMessages` 컬렉션은 Appwrite 권한이 열려 있어
 * API로 직접 쓰는 것까지 막지는 못한다(서버 강제는 별도 과제).
 */

export const DELETE_WINDOW_MS = 24 * 60 * 60 * 1000;
export const DELETED_MESSAGE_TEXT = '삭제된 메시지입니다.';

const DELETABLE_TYPES: ReadonlyArray<ChatMessage['type']> = ['text', 'image', 'file'];

export type DeleteDeniedReason = 'NOT_SENDER' | 'EXPIRED' | 'NOT_DELETABLE' | 'ALREADY_DELETED';

export const DELETE_DENIED_MESSAGE: Record<DeleteDeniedReason, string> = {
  NOT_SENDER: '내가 보낸 메시지만 삭제할 수 있습니다.',
  EXPIRED: '보낸 지 24시간이 지난 메시지는 삭제할 수 없습니다.',
  NOT_DELETABLE: '안내·알림 메시지는 삭제할 수 없습니다.',
  ALREADY_DELETED: '이미 삭제된 메시지입니다.',
};

export const isDeletedMessage = (m: Pick<ChatMessage, 'deletedAt'>) => Boolean(m.deletedAt);

export function canDeleteMessage(
  message: ChatMessage,
  actorId: string,
  now: Date,
): { allowed: true } | { allowed: false; reason: DeleteDeniedReason } {
  if (isDeletedMessage(message)) return { allowed: false, reason: 'ALREADY_DELETED' };
  if (!DELETABLE_TYPES.includes(message.type)) return { allowed: false, reason: 'NOT_DELETABLE' };
  if (!actorId || message.senderId !== actorId) return { allowed: false, reason: 'NOT_SENDER' };
  const sent = new Date(message.at).getTime();
  if (Number.isNaN(sent) || now.getTime() - sent > DELETE_WINDOW_MS) return { allowed: false, reason: 'EXPIRED' };
  return { allowed: true };
}

/** 삭제된 모습 — 내용·첨부·답장 인용·반응을 지우고 삭제자·시각을 남긴다. */
export function applyDeletion(message: ChatMessage, actor: { id: string; name: string }, now: Date): ChatMessage {
  return {
    ...message,
    type: 'text',
    text: DELETED_MESSAGE_TEXT,
    attachment: null,
    replyTo: null,
    reactions: {},
    isEdited: false,
    deletedAt: now.toISOString(),
    deletedBy: actor.id,
    deletedByName: actor.name,
  };
}

/** 지운 메시지를 인용한 답장들 — 미리보기 문구를 지운 버전만 돌려준다(바뀐 것만). */
export function scrubReplyPreviews(messages: ChatMessage[], deletedId: string): ChatMessage[] {
  return messages
    .filter((m) => m.replyTo?.id === deletedId && m.replyTo.text !== DELETED_MESSAGE_TEXT)
    .map((m) => ({ ...m, replyTo: { ...m.replyTo!, text: DELETED_MESSAGE_TEXT } }));
}
