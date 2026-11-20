import { useQueryClient } from '@tanstack/react-query';
import type { ChatMessage, ReplyPreview } from '@/domain/chatMessage/schema';
import { imageIdsOfRich, plainTextOfRich } from '@/domain/chatMessage/richBody';
import { chatOutbox, type OutboxItem } from '@/features/chat/chatOutbox';
import { applyLiveChange } from '@/features/chat/threadCache';
import { CHAT_THREAD_KEY, useSendMessage, useSendRich, type RichDraft } from '@/features/chat/useChatThread';

interface Sender {
  senderId: string;
  senderName: string;
  replyTo: ReplyPreview | null;
}

const newId = () => `out-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** 서식 메시지를 '보내는 중' 말풍선으로 — 본문에 실제로 남은 사진만 미리보기로 만든다 */
function richItem(roomId: string, draft: RichDraft, who: Sender): OutboxItem {
  const used = new Set(imageIdsOfRich(draft.doc));
  const imageFiles = [
    ...[...draft.pendingImages.entries()].filter(([id]) => used.has(id)).map(([, file]) => file),
    ...draft.files.filter((f) => f.type.startsWith('image/')),
  ];
  return {
    id: newId(),
    roomId,
    ...who,
    payload: { kind: 'rich', draft },
    text: plainTextOfRich(draft.doc).replace(/\[사진\]/g, '').trim(),
    images: imageFiles.map((file) => ({ url: URL.createObjectURL(file), name: file.name })),
    fileNames: draft.files.filter((f) => !f.type.startsWith('image/')).map((f) => f.name),
    status: 'sending',
  };
}

/**
 * 메시지 보내기 — 입력창을 기다리게 하지 않는다.
 * - 글만: 대화창에 바로 붙는다(useSendMessage). 실패했을 때만 '전송 실패' 말풍선으로 남긴다.
 * - 사진·파일·꾸밈: '보내는 중' 말풍선을 붙여 두고 올린다. 다 올라가면 진짜 메시지로 바뀐다.
 * 방을 나가도 보내기는 끝까지 간다.
 */
export function useOutboxSender(roomId: string) {
  const qc = useQueryClient();
  const send = useSendMessage(roomId);
  const sendRich = useSendRich(roomId);

  const run = (item: OutboxItem) => {
    const who = { senderId: item.senderId, senderName: item.senderName, replyTo: item.replyTo };
    const failed = () => chatOutbox.add({ ...item, status: 'failed' });

    if (item.payload.kind === 'text') {
      chatOutbox.remove(roomId, item.id); // 재전송이면 실패 말풍선을 걷는다
      send.mutateAsync({ text: item.payload.text, ...who }).catch(failed);
      return;
    }
    chatOutbox.add({ ...item, status: 'sending' });
    sendRich
      .mutateAsync({ draft: item.payload.draft, ...who })
      .then((message) => {
        // 저장된 메시지를 대화창에 바로 넣고 말풍선을 걷는다 — 사이에 빈 틈이 보이지 않게
        qc.setQueryData<ChatMessage[]>([CHAT_THREAD_KEY, roomId], (list) => (list ? applyLiveChange(list, { roomId, message }) : list));
        chatOutbox.remove(roomId, item.id);
      })
      .catch(failed);
  };

  return {
    sendText: (text: string, who: Sender) =>
      run({ id: newId(), roomId, ...who, payload: { kind: 'text', text }, text, images: [], fileNames: [], status: 'sending' }),
    sendRich: (draft: RichDraft, who: Sender) => run(richItem(roomId, draft, who)),
    /** 실패한 메시지 다시 보내기 */
    retry: run,
  };
}
