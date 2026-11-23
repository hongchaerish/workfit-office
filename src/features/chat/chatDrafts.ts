import { useMemo, useSyncExternalStore } from 'react';
import { isEmptyRich, plainTextOfRich, type RichNode } from '@/domain/chatMessage/richBody';

/**
 * 작성 중인 메시지(임시 글) — 카카오톡처럼 창을 닫았다 열어도 입력창에 남고, 채팅방 목록에 [작성 중]으로 보인다.
 * 사용자별로 브라우저(localStorage)에 방마다 하나씩 둔다(고정 방과 같은 방식, pinnedRooms.ts 참고).
 * 아직 올리지 않은 사진·첨부 파일은 다시 열면 파일이 없으므로 보관하지 않는다.
 */
export interface ChatDraft {
  doc: RichNode;
  /** 목록 미리보기용 평문 */
  text: string;
  at: string;
}

export type ChatDrafts = Record<string, ChatDraft>;

const keyOf = (me: string) => `workfit-chat-drafts-${me}`;
const CHANGE_EVENT = 'workfit-chat-drafts-change';

function withoutImages(node: RichNode): RichNode {
  const out: RichNode = { ...node };
  if (node.content) out.content = node.content.filter((c) => c.type !== 'image').map(withoutImages);
  return out;
}

/** 방 roomId의 임시 글을 바꾼 새 목록 — 남길 글이 없으면 지운다 */
export function withDraft(drafts: ChatDrafts, roomId: string, doc: RichNode, at = new Date().toISOString()): ChatDrafts {
  const { [roomId]: _old, ...rest } = drafts;
  const kept = withoutImages(doc);
  if (isEmptyRich(kept)) return rest;
  return { ...rest, [roomId]: { doc: kept, text: plainTextOfRich(kept).trim(), at } };
}

/** 채팅방 목록에 보일 한 줄 */
export function draftPreview(draft: ChatDraft): string {
  return draft.text.replace(/\s+/g, ' ').trim();
}

function readRaw(me: string): string {
  try {
    return localStorage.getItem(keyOf(me)) ?? '{}';
  } catch {
    return '{}';
  }
}

function parse(raw: string): ChatDrafts {
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as ChatDrafts) : {};
  } catch {
    return {};
  }
}

export function readChatDraft(me: string, roomId: string): ChatDraft | undefined {
  return parse(readRaw(me))[roomId];
}

/** 입력창 내용을 보관 — 비어 있으면 지운다 */
export function saveChatDraft(me: string, roomId: string, doc: RichNode): void {
  const cur = parse(readRaw(me));
  const next = withDraft(cur, roomId, doc);
  if (JSON.stringify(cur[roomId]?.doc ?? null) === JSON.stringify(next[roomId]?.doc ?? null)) return;
  try {
    localStorage.setItem(keyOf(me), JSON.stringify(next));
  } catch {
    /* 저장 불가(사생활 모드 등) — 임시 글은 부가 기능이라 무시 */
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function clearChatDraft(me: string, roomId: string): void {
  saveChatDraft(me, roomId, { type: 'doc', content: [] });
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener('storage', onChange); // 다른 탭·창에서 바꾼 경우
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

/** 방별 임시 글 — 어디서 쓰든 즉시 갱신된다. */
export function useChatDrafts(me: string): ChatDrafts {
  const raw = useSyncExternalStore(subscribe, () => readRaw(me));
  return useMemo(() => parse(raw), [raw]);
}
