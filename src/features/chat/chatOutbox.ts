import { useMemo, useSyncExternalStore } from 'react';
import type { ReplyPreview } from '@/domain/chatMessage/schema';
import { imageIdsOfRich, plainTextOfRich } from '@/domain/chatMessage/richBody';
import { outboxDb } from '@/features/chat/outboxDb';
import type { RichDraft } from '@/features/chat/useChatThread';

/**
 * 보낼 메시지 보관함 — 보내는 중이거나 전송에 실패한 내 메시지.
 * 입력창은 [보내기]를 누르자마자 비우고, 메시지는 여기 담긴 채로 올라간다(outboxRunner).
 * - 대화창 맨 아래에 말풍선으로 보인다(OutboxBubbles). 실패하면 [재전송]·[삭제]를 고른다.
 * - 이 기기에 저장해 두므로(outboxDb) 앱을 끄거나 새로 고쳐도 남는다.
 */
export type OutboxPayload = { kind: 'text'; text: string } | { kind: 'rich'; draft: RichDraft };

/** 기기에 저장하는 내용 */
export interface OutboxRecord {
  id: string;
  /** 저장될 메시지의 id — 미리 정해 두어, 이어 보내거나 다시 보내도 같은 메시지가 두 번 생기지 않는다 */
  messageId: string;
  roomId: string;
  senderId: string;
  senderName: string;
  replyTo: ReplyPreview | null;
  payload: OutboxPayload;
  status: 'sending' | 'failed';
  /** 처음 [보내기]를 누른 시각(ms) */
  createdAt: number;
}

/** 화면에서 쓰는 모양 — 저장 내용 + 말풍선에 보일 것 */
export interface OutboxItem extends OutboxRecord {
  text: string;
  /** 사진 미리보기 — 항목을 지울 때 주소를 정리한다 */
  images: { url: string; name: string }[];
  /** 파일 이름(사진이 아닌 첨부) */
  fileNames: string[];
}

/** 저장 내용에 말풍선에 보일 것을 붙인다 — 서식 메시지는 본문에 실제로 남은 사진만 미리보기로 만든다 */
export function toOutboxItem(record: OutboxRecord): OutboxItem {
  if (record.payload.kind === 'text') return { ...record, text: record.payload.text, images: [], fileNames: [] };
  const { draft } = record.payload;
  const used = new Set(imageIdsOfRich(draft.doc));
  const imageFiles = [
    ...[...draft.pendingImages.entries()].filter(([id]) => used.has(id)).map(([, file]) => file),
    ...draft.files.filter((f) => f.type.startsWith('image/')),
  ];
  return {
    ...record,
    text: plainTextOfRich(draft.doc).replace(/\[사진\]/g, '').trim(),
    images: imageFiles.map((file) => ({ url: URL.createObjectURL(file), name: file.name })),
    fileNames: draft.files.filter((f) => !f.type.startsWith('image/')).map((f) => f.name),
  };
}

function toRecord(item: OutboxItem): OutboxRecord {
  const { id, messageId, roomId, senderId, senderName, replyTo, payload, status, createdAt } = item;
  return { id, messageId, roomId, senderId, senderName, replyTo, payload, status, createdAt };
}

/** 다시 열었을 때 이어 보낼 수 있는 시간 — 이보다 오래된 것은 저절로 보내지 않고 '전송 실패'로 보여 준다 */
export const RESUME_WITHIN_MS = 10 * 60 * 1000;

/**
 * 앱을 다시 열었을 때 '보내는 중'으로 남아 있던 메시지를 저절로 이어 보낼지.
 * 방금 끊긴 것(새로 고침 등)만 이어 보낸다 — 한참 뒤에 열었는데 옛 메시지가 말없이 나가면 안 된다.
 */
export function shouldResume(record: Pick<OutboxRecord, 'status' | 'createdAt'>, now: number): boolean {
  return record.status === 'sending' && now - record.createdAt < RESUME_WITHIN_MS;
}

/** 목록에 넣기 — 같은 id 가 있으면 그 자리에서 바꾼다(상태 변경·재전송). 순수 함수라 따로 시험한다 */
export function addItem<T extends { id: string }>(list: readonly T[], item: T): T[] {
  return list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item];
}

export function dropItem<T extends { id: string }>(list: readonly T[], id: string): T[] {
  return list.filter((x) => x.id !== id);
}

const EMPTY: OutboxItem[] = [];
const byRoom = new Map<string, OutboxItem[]>();
const listeners = new Set<() => void>();
let version = 0;

function setRoom(roomId: string, next: OutboxItem[]) {
  if (next.length) byRoom.set(roomId, next);
  else byRoom.delete(roomId);
  version++;
  listeners.forEach((fn) => fn());
}

const roomOf = (roomId: string) => byRoom.get(roomId) ?? EMPTY;

export const chatOutbox = {
  /** 넣거나 바꾼다 — 기기에도 저장한다 */
  put(item: OutboxItem) {
    setRoom(item.roomId, addItem(roomOf(item.roomId), item));
    void outboxDb.put(toRecord(item));
  },
  /** 뺀다 — 사진 미리보기 주소를 정리하고 기기에서도 지운다 */
  remove(roomId: string, id: string) {
    const target = roomOf(roomId).find((x) => x.id === id);
    if (!target) return;
    target.images.forEach((img) => URL.revokeObjectURL(img.url));
    setRoom(roomId, dropItem(roomOf(roomId), id));
    void outboxDb.remove(id);
  },
  /** 기기에 남아 있던 이 사람의 메시지를 불러온다 — 이미 화면에 있는 것은 건드리지 않는다. 새로 불러온 것만 돌려준다 */
  async load(userId: string): Promise<OutboxItem[]> {
    const records = (await outboxDb.all<OutboxRecord>()).filter((r) => r.senderId === userId).sort((a, b) => a.createdAt - b.createdAt);
    const loaded: OutboxItem[] = [];
    for (const record of records) {
      if (roomOf(record.roomId).some((x) => x.id === record.id)) continue;
      const item = toOutboxItem(record);
      loaded.push(item);
      setRoom(item.roomId, addItem(roomOf(item.roomId), item));
    }
    return loaded;
  },
};

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

const useVersion = () => useSyncExternalStore(subscribe, () => version, () => 0);

/** 이 방에서 내가 보내는 중·실패한 메시지 */
export function useChatOutbox(roomId: string, me: string): OutboxItem[] {
  const v = useVersion();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => roomOf(roomId).filter((x) => x.senderId === me), [v, roomId, me]);
}

/** 내가 보낸 메시지 중 전송에 실패한 것이 있는 방 — 방 목록에 표시한다 */
export function useFailedOutboxRooms(me: string | undefined): Set<string> {
  const v = useVersion();
  return useMemo(() => {
    const rooms = new Set<string>();
    byRoom.forEach((items, roomId) => {
      if (items.some((x) => x.senderId === me && x.status === 'failed')) rooms.add(roomId);
    });
    return rooms;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v, me]);
}
