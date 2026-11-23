import type { QueryClient } from '@tanstack/react-query';
import { chatMessageRepo } from '@/data/chatMessage/chatMessage.repo';
import type { ChatMessage } from '@/domain/chatMessage/schema';
import { nowLocalIso } from '@/shared/lib/datetime';
import { chatOutbox, shouldResume, type OutboxItem } from '@/features/chat/chatOutbox';
import { applyLiveChange } from '@/features/chat/threadCache';
import { CHAT_ROOMS_KEY, CHAT_UNREAD_KEY } from '@/features/chat/useChatRooms';
import { CHAT_THREAD_KEY, sendRichMessage, sendTextMessage } from '@/features/chat/useChatThread';

/** 지금 보내고 있는 것 — 같은 메시지를 동시에 두 번 보내지 않는다(재전송을 연달아 누르는 경우 등) */
const running = new Set<string>();

/**
 * 보관함의 메시지 1건을 보낸다 — 화면과 상관없이 끝까지 간다(방을 나가도, 입력창이 사라져도).
 * - 글만: 대화창에 바로 붙여 둔다(진짜 말풍선 모양). 실패하면 걷어 내고 '전송 실패' 말풍선으로 남긴다.
 * - 사진·파일·꾸밈: '보내는 중' 말풍선(OutboxBubbles)이 보이는 동안 올린다.
 * 다 되면 저장된 메시지를 대화창에 넣고 보관함에서 뺀다.
 * again: 처음이 아닌 보내기(이어 보내기·재전송) — 지난번에 이미 저장됐는지 먼저 본다.
 */
export function runOutboxItem(qc: QueryClient, item: OutboxItem, again = false): void {
  if (running.has(item.id)) return;
  running.add(item.id);
  chatOutbox.put({ ...item, status: 'sending' });

  const { roomId, payload } = item;
  const key = [CHAT_THREAD_KEY, roomId];
  const who = { senderId: item.senderId, senderName: item.senderName, replyTo: item.replyTo, messageId: item.messageId };
  const patchThread = (fn: (list: ChatMessage[]) => ChatMessage[]) => qc.setQueryData<ChatMessage[]>(key, (list) => (list ? fn(list) : list));

  let optimisticId: string | null = null;
  const send = async () => {
    if (again) {
      // 저장은 됐는데 마무리 전에 앱이 꺼졌거나, 다른 창이 먼저 보냈을 수 있다 — 다시 쓰면 시각·읽음·반응이 지워진다
      const saved = await chatMessageRepo.get(item.messageId);
      if (saved) return saved;
    }
    if (payload.kind === 'rich') return sendRichMessage(roomId, { draft: payload.draft, ...who });
    // 받는 중이던 목록이 방금 붙인 말풍선을 덮어쓰지 않게 — 아직 한 번도 못 받은 방은 그대로 받게 둔다
    if (qc.getQueryData(key)) await qc.cancelQueries({ queryKey: key });
    const optimistic: ChatMessage = {
      id: `${roomId}-optimistic-${Date.now()}`,
      roomId,
      senderId: item.senderId,
      senderName: item.senderName,
      text: payload.text,
      type: 'text',
      attachment: null,
      replyTo: item.replyTo,
      approvalPayload: null,
      at: nowLocalIso(),
      readBy: [item.senderId],
      isEdited: false,
      reactions: {},
    };
    optimisticId = optimistic.id;
    patchThread((list) => [...list, optimistic]);
    return sendTextMessage(roomId, { text: payload.text, ...who });
  };

  inOneTab(item.id, send)
    .then((message) => {
      // 저장된 메시지를 대화창에 바로 넣는다(먼저 붙여 둔 것은 이때 빠진다) — 사이에 빈 틈이 보이지 않게
      patchThread((list) => applyLiveChange(list, { roomId, message }));
      chatOutbox.remove(roomId, item.id);
    })
    .catch((e) => {
      console.warn('[chat] 전송 실패', e);
      patchThread((list) => list.filter((m) => m.id !== optimisticId));
      chatOutbox.put({ ...item, status: 'failed' });
    })
    .finally(() => {
      running.delete(item.id);
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: [CHAT_ROOMS_KEY] });
      void qc.invalidateQueries({ queryKey: [CHAT_UNREAD_KEY] });
    });
}

/**
 * 같은 메시지를 창 하나만 보내게 한다 — 다른 창이 보내는 중이면 끝나기를 기다렸다가, 저장됐는지부터 다시 본다.
 * (브라우저가 이 기능을 모르면 그냥 보낸다 — 메시지 id 가 같아 두 번 생기지는 않는다)
 */
function inOneTab<T>(id: string, work: () => Promise<T>): Promise<T> {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  return locks ? (locks.request(`wf-chat-outbox-${id}`, work) as Promise<T>) : work();
}

const resumed = new Set<string>();

/**
 * 앱을 열었을 때 한 번 — 기기에 남아 있던 내 메시지를 불러온다.
 * 방금 끊긴 '보내는 중'은 이어 보내고, 오래된 것은 '전송 실패'로 바꿔 사용자가 고르게 한다.
 */
export async function resumeOutbox(qc: QueryClient, userId: string): Promise<void> {
  if (resumed.has(userId)) return;
  resumed.add(userId);
  const now = Date.now();
  for (const item of await chatOutbox.load(userId)) {
    if (item.status !== 'sending') continue;
    if (shouldResume(item, now)) runOutboxItem(qc, item, true);
    else chatOutbox.put({ ...item, status: 'failed' });
  }
}
