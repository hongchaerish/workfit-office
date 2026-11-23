import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ReplyPreview } from '@/domain/chatMessage/schema';
import { toOutboxItem, type OutboxItem, type OutboxPayload } from '@/features/chat/chatOutbox';
import { resumeOutbox, runOutboxItem } from '@/features/chat/outboxRunner';
import type { RichDraft } from '@/features/chat/useChatThread';

interface Sender {
  senderId: string;
  senderName: string;
  replyTo: ReplyPreview | null;
}

/** 메시지 보내기 — 입력창을 기다리게 하지 않는다. 보관함에 담고 바로 보내기 시작한다(outboxRunner). */
export function useOutboxSender(roomId: string) {
  const qc = useQueryClient();
  const start = (payload: OutboxPayload, who: Sender) => {
    const now = Date.now();
    runOutboxItem(
      qc,
      toOutboxItem({
        id: `out-${now}-${Math.random().toString(36).slice(2, 8)}`,
        messageId: `${roomId}-${now}`,
        roomId,
        ...who,
        payload,
        status: 'sending',
        createdAt: now,
      }),
    );
  };
  return {
    sendText: (text: string, who: Sender) => start({ kind: 'text', text }, who),
    sendRich: (draft: RichDraft, who: Sender) => start({ kind: 'rich', draft }, who),
    /** 실패한 메시지 다시 보내기 */
    retry: (item: OutboxItem) => runOutboxItem(qc, item, true),
  };
}

/** 앱을 열었을 때 — 지난번에 다 못 보낸 내 메시지를 이어 보내거나 '전송 실패'로 보여 준다(앱 껍데기에서 한 번 부른다) */
export function useOutboxResume(userId: string | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    if (userId) void resumeOutbox(qc, userId);
  }, [qc, userId]);
}
