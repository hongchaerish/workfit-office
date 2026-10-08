import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { chatMessageRepo } from '@/data/chatMessage/chatMessage.repo';
import { chatRoomRepo } from '@/data/chatRoom/chatRoom.repo';
import type { Attachment, ChatMessage, ReplyPreview } from '@/domain/chatMessage/schema';
import { RICH_BODY_MAX_CHARS, imageIdsOfRich, mentionIdsOfRich, plainTextOfRich, sanitizeRichDoc, type RichNode } from '@/domain/chatMessage/richBody';
import { notificationRepo } from '@/data/notification/notification.repo';
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

/**
 * 메시지 삭제(모두에게서) — 웹·PWA 공용. 규칙(본인·24시간·일반/사진/파일)은 repo 가
 * domain/chatMessage/deletion 으로 다시 검사한다. 지운 메시지가 방의 마지막 메시지면
 * 방 목록 미리보기 문구도 바꾼다.
 */
export function useDeleteMessage(roomId: string) {
  const qc = useQueryClient();
  return useMutation({
    /** 한 말풍선의 메시지들을 함께 지운다(사진 여러 장 등). 하나만 지울 때도 배열로 넘긴다. */
    mutationFn: async ({ messageIds, actor }: { messageIds: string[]; actor: { id: string; name: string } }) => {
      let lastDeleted: ChatMessage | null = null;
      for (const messageId of messageIds) {
        lastDeleted = await chatMessageRepo.deleteMessage(messageId, actor);
      }
      if (!lastDeleted) return;
      const room = await chatRoomRepo.get(roomId);
      const last = room?.lastMessage;
      if (last && last.at === lastDeleted.at && last.senderId === lastDeleted.senderId) {
        await chatRoomRepo.updateLastMessage(roomId, { ...last, text: lastDeleted.text });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [CHAT_THREAD_KEY, roomId] });
      qc.invalidateQueries({ queryKey: [CHAT_ROOMS_KEY] });
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

/** 서식 메시지로 보낼 내용 — 편집기 문서 + 아직 올리지 않은 사진·파일 */
export interface RichDraft {
  /** 편집기 문서(본문 속 사진은 attrs.attachmentId 를 가진다) */
  doc: RichNode;
  /** 본문 속 사진 중 아직 올리지 않은 것: attachmentId → 파일 */
  pendingImages: Map<string, File>;
  /** 본문 밖에 붙이는 파일(사진이 아닌 첨부) */
  files: File[];
  /** 수정할 때 — 이미 올라가 있는 첨부(본문에 남은 사진·파일만 유지) */
  existing?: Attachment[];
}

/** 서식 메시지 저장 준비 — 새 첨부를 올리고 본문·요약·멘션을 만든다. */
async function prepareRich(roomId: string, draft: RichDraft) {
  const doc = sanitizeRichDoc(draft.doc);
  const usedImageIds = new Set(imageIdsOfRich(doc));
  const uploadedImages = await Promise.all(
    [...draft.pendingImages.entries()]
      .filter(([id]) => usedImageIds.has(id))
      .map(async ([id, file]) => ({ ...(await chatMessageRepo.uploadAttachment(roomId, file)), id })),
  );
  const uploadedFiles = await Promise.all(
    draft.files.map(async (file) => ({
      ...(await chatMessageRepo.uploadAttachment(roomId, file)),
      id: `f-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    })),
  );
  // 수정 시: 본문에서 지운 사진은 빼고, 본문 밖 파일은 그대로 둔다
  const kept = (draft.existing ?? []).filter((a) => (a.mime.startsWith('image/') ? Boolean(a.id && usedImageIds.has(a.id)) : true));
  const attachments = [...kept, ...uploadedImages, ...uploadedFiles];
  const body = JSON.stringify(doc);
  if (body.length > RICH_BODY_MAX_CHARS) throw new Error('메시지가 너무 깁니다. 나누어 보내 주세요.');
  const summary = plainTextOfRich(doc);
  const fileNames = attachments.filter((a) => !a.mime.startsWith('image/')).map((a) => a.name);
  const text = summary || (fileNames.length ? `📎 ${fileNames.join(', ')}` : '');
  return { doc, body, text, attachments, mentions: mentionIdsOfRich(doc) };
}

/** 방 목록 미리보기 문구 — 글이 없으면 사진·파일 개수 */
function richPreview(text: string, attachments: Attachment[]): string {
  const onlyMarker = text.replace(/\[사진\]/g, '').trim() === '';
  if (text && !onlyMarker) return text;
  const images = attachments.filter((a) => a.mime.startsWith('image/')).length;
  const files = attachments.length - images;
  if (images) return images > 1 ? `📷 사진 ${images}장` : '📷 사진';
  return files ? `📎 파일 ${files}개` : text;
}

/** @멘션 알림 — 보낸 사람 본인은 빼고, 알림 실패는 전송을 막지 않는다 */
async function notifyMentions(roomId: string, mentions: string[], senderId: string, senderName: string, text: string) {
  for (const userId of mentions) {
    if (userId === senderId) continue;
    try {
      await notificationRepo.create({
        userId,
        type: '메신저',
        title: `${senderName}님이 회원님을 언급했습니다`,
        text: text.slice(0, 120),
        senderName,
        linkUrl: `/?openChat=${encodeURIComponent(roomId)}`,
      });
    } catch (e) {
      console.warn('[chat] 멘션 알림 실패', e);
    }
  }
}

/**
 * 서식 메시지 전송 (Teams 방식) — 글·서식·본문 속 사진·파일을 **메시지 1건**으로 저장한다.
 * 수정·삭제·답장·전달·반응이 모두 이 1건 단위로 동작한다.
 */
export function useSendRich(roomId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ draft, senderId, senderName, replyTo = null }: { draft: RichDraft; senderId: string; senderName: string; replyTo?: ReplyPreview | null }) => {
      const prepared = await prepareRich(roomId, draft);
      const at = nowLocalIso();
      const message: ChatMessage = {
        id: `${roomId}-${Date.now()}`,
        roomId,
        senderId,
        senderName,
        text: prepared.text,
        type: 'text',
        attachment: null,
        replyTo,
        approvalPayload: null,
        at,
        readBy: [senderId],
        isEdited: false,
        reactions: {},
        format: 'rich',
        body: prepared.body,
        attachments: prepared.attachments,
        mentions: prepared.mentions,
      };
      await chatMessageRepo.append(message);
      await chatRoomRepo.updateLastMessage(roomId, { text: richPreview(prepared.text, prepared.attachments), at, senderId });
      await notifyMentions(roomId, prepared.mentions, senderId, senderName, prepared.text);
      return message;
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: [CHAT_THREAD_KEY, roomId] });
      qc.invalidateQueries({ queryKey: [CHAT_ROOMS_KEY] });
      qc.invalidateQueries({ queryKey: [CHAT_UNREAD_KEY] });
    },
  });
}

/** 서식 메시지 수정 — 새로 멘션된 사람에게만 알린다 */
export function useEditRich(roomId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ message, draft, actorName }: { message: ChatMessage; draft: RichDraft; actorName: string }) => {
      const prepared = await prepareRich(roomId, { ...draft, existing: message.attachments ?? [] });
      const updated = await chatMessageRepo.updateRich(message.id, {
        body: prepared.body,
        text: prepared.text,
        attachments: prepared.attachments,
        mentions: prepared.mentions,
      });
      const before = new Set(message.mentions ?? []);
      await notifyMentions(roomId, prepared.mentions.filter((id) => !before.has(id)), message.senderId, actorName, prepared.text);
      return updated;
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: [CHAT_THREAD_KEY, roomId] });
      qc.invalidateQueries({ queryKey: [CHAT_ROOMS_KEY] });
    },
  });
}
