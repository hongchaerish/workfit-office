import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { chatMessageRepo } from '@/data/chatMessage/chatMessage.repo';
import { chatRoomRepo } from '@/data/chatRoom/chatRoom.repo';
import type { ChatMessage, ReplyPreview } from '@/domain/chatMessage/schema';
import { nowLocalIso } from '@/shared/lib/datetime';
import { CHAT_ROOMS_KEY, CHAT_UNREAD_KEY, CHAT_POLL_MS } from './useChatRooms';
import { buildAttachmentBatch } from './attachmentBatch';

/**
 * 채팅방 대화(스레드) 훅 — 메시지 조회 + 낙관적 전송 + 읽음 처리.
 * ([[data-layer-pattern]] 정본 패턴 / [[메신저_개발_계획서.md]] Phase 1)
 */
export const CHAT_THREAD_KEY = 'chatThread';

/** 방의 메시지(시간 오름차순). */
export function useChatThread(roomId?: string) {
  return useQuery({
    queryKey: [CHAT_THREAD_KEY, roomId ?? null],
    queryFn: () => chatMessageRepo.listByRoom(roomId!),
    enabled: !!roomId,
    refetchInterval: CHAT_POLL_MS,
  });
}

interface SendVars {
  text: string;
  senderId: string;
  senderName: string;
  /** 답글(인용) 원문 요약. 없으면 일반 메시지. */
  replyTo?: ReplyPreview | null;
}

/** 메시지 전송(낙관적) — 캐시에 즉시 추가 → 실패 시 롤백. 성공 시 방 목록 lastMessage 갱신. */
export function useSendMessage(roomId: string) {
  const qc = useQueryClient();
  const key = [CHAT_THREAD_KEY, roomId];

  return useMutation({
    mutationFn: async ({ text, senderId, senderName, replyTo }: SendVars) => {
      const at = nowLocalIso();
      const message: ChatMessage = {
        id: `${roomId}-${Date.now()}`,
        roomId,
        senderId,
        senderName,
        text,
        type: 'text',
        attachment: null,
        replyTo: replyTo ?? null,
        approvalPayload: null,
        at,
        readBy: [senderId],
        isEdited: false,
        reactions: {},
      };
      await chatMessageRepo.append(message);
      await chatRoomRepo.updateLastMessage(roomId, { text, at, senderId });
      return message;
    },
    onMutate: async ({ text, senderId, senderName, replyTo }) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<ChatMessage[]>(key);
      const optimistic: ChatMessage = {
        id: `${roomId}-optimistic-${Date.now()}`,
        roomId,
        senderId,
        senderName,
        text,
        type: 'text',
        attachment: null,
        replyTo: replyTo ?? null,
        approvalPayload: null,
        at: nowLocalIso(),
        readBy: [senderId],
        isEdited: false,
        reactions: {},
      };
      qc.setQueryData<ChatMessage[]>(key, [...(prev ?? []), optimistic]);
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: [CHAT_ROOMS_KEY] });
      qc.invalidateQueries({ queryKey: [CHAT_UNREAD_KEY] });
    },
  });
}

/** 메시지 수정 */
export function useEditMessage(roomId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ messageId, text }: { messageId: string; text: string }) => {
      await chatMessageRepo.updateText(messageId, text);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [CHAT_THREAD_KEY, roomId] });
    },
  });
}

/** 메시지 이모지 반응 업데이트 훅 */
export function useUpdateMessageReactions(roomId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ messageId, reactions }: { messageId: string; reactions: Record<string, string[]> }) => {
      await chatMessageRepo.updateReactions(messageId, reactions);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [CHAT_THREAD_KEY, roomId] });
    },
  });
}

/** 방 진입 시 읽음 처리 — 미읽음 배지 클리어. */
export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ roomId, userId }: { roomId: string; userId: string }) =>
      chatMessageRepo.markRead(roomId, userId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [CHAT_UNREAD_KEY] });
      qc.invalidateQueries({ queryKey: [CHAT_THREAD_KEY] });
    },
  });
}

/**
 * 첨부 여러 개 한 번에 보내기 — 업로드는 동시에, 저장은 같은 시각·증가하는 id로 차례대로.
 * 사진이 하나씩 떨어져 올라가지 않고 한 묶음(그리드)으로 보이게 한다(buildAttachmentBatch 참고).
 */
export function useSendAttachments(roomId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ files, senderId, senderName, text = '', replyTo = null }: { files: File[]; senderId: string; senderName: string; text?: string; replyTo?: ReplyPreview | null }) => {
      const attachments = await Promise.all(files.map((file) => chatMessageRepo.uploadAttachment(roomId, file)));
      const at = nowLocalIso();
      const messages = buildAttachmentBatch({ roomId, senderId, senderName, attachments, text, replyTo, at, baseTime: Date.now() });
      for (const message of messages) await chatMessageRepo.append(message);

      const last = messages[messages.length - 1];
      await chatRoomRepo.updateLastMessage(roomId, {
        text: last.text || (last.type === 'image' ? (attachments.length > 1 ? `📷 사진 ${attachments.length}장` : '📷 사진') : `📎 ${last.attachment?.name ?? '파일'}`),
        at,
        senderId,
      });
      return messages;
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: [CHAT_THREAD_KEY, roomId] });
      qc.invalidateQueries({ queryKey: [CHAT_ROOMS_KEY] });
      qc.invalidateQueries({ queryKey: [CHAT_UNREAD_KEY] });
    },
  });
}
