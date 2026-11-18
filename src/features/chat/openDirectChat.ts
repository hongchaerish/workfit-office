import type { CreateRoomInput } from '@/data/chatRoom/chatRoom.repo';
import type { RichNode } from '@/domain/chatMessage/richBody';
import type { User } from '@/domain/user/schema';
import { CHAT_DRAFT_FILL_EVENT, saveChatDraft } from './chatDrafts';

/** 다른 화면이 메신저 도크에서 대화방을 열 때 쓰는 창 이벤트 — AppShell 이 받는다 */
export const OPEN_DOCK_CHAT_EVENT = 'workfit-open-dock-chat';

/** 글 한 덩어리 → 한 문단 본문(줄바꿈은 줄바꿈으로) */
export function plainTextDoc(text: string): RichNode {
  const lines = text.split('\n');
  const content: RichNode[] = [];
  lines.forEach((line, i) => {
    if (i > 0) content.push({ type: 'hardBreak' });
    if (line) content.push({ type: 'text', text: line });
  });
  return { type: 'doc', content: [{ type: 'paragraph', content }] };
}

/**
 * 1:1 대화 열기 — 방이 없으면 만들고(있으면 저장소가 그 방을 돌려준다), 글이 있으면 입력창에 미리 채운 뒤 도크에서 연다.
 * 글은 보내지 않는다(사용자가 확인하고 보낸다).
 */
export async function openDirectChat(input: {
  me: User;
  other: User;
  text?: string;
  createRoom: (i: CreateRoomInput) => Promise<{ id: string }>;
}): Promise<void> {
  const { me, other, text, createRoom } = input;
  const room = await createRoom({ name: `${me.name}, ${other.name}`, type: 'direct', members: [me.id, other.id], createdBy: me.id });
  if (text) {
    saveChatDraft(me.id, room.id, plainTextDoc(text));
    // 그 방 입력창이 이미 열려 있으면 처음에만 임시 글을 읽으므로 다시 채우라고 알린다
    window.dispatchEvent(new CustomEvent(CHAT_DRAFT_FILL_EVENT, { detail: { me: me.id, roomId: room.id } }));
  }
  window.dispatchEvent(new CustomEvent(OPEN_DOCK_CHAT_EVENT, { detail: { roomId: room.id } }));
}
