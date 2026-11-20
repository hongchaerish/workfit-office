import { useSyncExternalStore } from 'react';
import type { ReplyPreview } from '@/domain/chatMessage/schema';
import type { RichDraft } from '@/features/chat/useChatThread';

/**
 * 보내는 중이거나 전송에 실패한 내 메시지 — 대화창 맨 아래에 말풍선으로 보인다(OutboxBubbles).
 * 입력창은 [보내기]를 누르자마자 비우고, 사진·파일은 여기 담긴 채로 올라간다.
 * 실패하면 여기 남아 [재전송]·[삭제]를 고를 수 있다. 화면을 새로 열면 사라진다(파일을 브라우저에 보관하지 않는다).
 */
export interface OutboxItem {
  id: string;
  roomId: string;
  senderId: string;
  senderName: string;
  replyTo: ReplyPreview | null;
  /** 글만 보내는 메시지면 text, 꾸밈·사진·파일이 있으면 rich */
  payload: { kind: 'text'; text: string } | { kind: 'rich'; draft: RichDraft };
  /** 말풍선에 보일 글 */
  text: string;
  /** 말풍선에 보일 사진 미리보기 — 항목을 지울 때 주소를 정리한다 */
  images: { url: string; name: string }[];
  /** 말풍선에 보일 파일 이름(사진이 아닌 첨부) */
  fileNames: string[];
  status: 'sending' | 'failed';
}

/** 목록에 넣기 — 같은 id 가 있으면 바꿔 넣는다(재전송). 순수 함수라 따로 시험한다 */
export function addItem(list: readonly OutboxItem[], item: OutboxItem): OutboxItem[] {
  return [...list.filter((x) => x.id !== item.id), item];
}

export function dropItem(list: readonly OutboxItem[], id: string): OutboxItem[] {
  return list.filter((x) => x.id !== id);
}

const EMPTY: OutboxItem[] = [];
const byRoom = new Map<string, OutboxItem[]>();
const listeners = new Set<() => void>();

function setRoom(roomId: string, next: OutboxItem[]) {
  if (next.length) byRoom.set(roomId, next);
  else byRoom.delete(roomId);
  listeners.forEach((fn) => fn());
}

const roomOf = (roomId: string) => byRoom.get(roomId) ?? EMPTY;

export const chatOutbox = {
  add(item: OutboxItem) {
    setRoom(item.roomId, addItem(roomOf(item.roomId), item));
  },
  /** 항목을 빼고 사진 미리보기 주소를 정리한다 */
  remove(roomId: string, id: string) {
    const target = roomOf(roomId).find((x) => x.id === id);
    if (!target) return;
    target.images.forEach((img) => URL.revokeObjectURL(img.url));
    setRoom(roomId, dropItem(roomOf(roomId), id));
  },
};

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** 이 방에서 보내는 중·실패한 내 메시지 */
export function useChatOutbox(roomId: string): OutboxItem[] {
  return useSyncExternalStore(subscribe, () => roomOf(roomId), () => EMPTY);
}
