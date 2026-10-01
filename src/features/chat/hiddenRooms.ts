import { useMemo, useSyncExternalStore } from 'react';

/**
 * 채팅방 "목록에서 숨기기" — 사용자별로 브라우저(localStorage)에만 둔다.
 *
 * 예전에는 화면마다 localStorage를 직접 읽고 썼다. 방을 열 때 숨김을 풀어도 목록 쪽은
 * 그 사실을 모른 채 캐시된 결과를 계속 보여 줘서, 숨긴 방에 [＋]로 다시 들어갔다가
 * 메시지 없이 나오면 새로고침 전까지 목록에 안 나타났다. 읽기·쓰기를 여기로 모으고,
 * 쓸 때마다 이벤트를 쏴서 열려 있는 모든 화면이 즉시 다시 그리게 한다.
 */
const keyOf = (me: string) => `workfit-hidden-rooms-${me}`;
const CHANGE_EVENT = 'workfit-hidden-rooms-change';

function readRaw(me: string): string {
  try {
    return localStorage.getItem(keyOf(me)) ?? '[]';
  } catch {
    return '[]';
  }
}

function parse(raw: string): string[] {
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export function readHiddenRooms(me: string): string[] {
  return parse(readRaw(me));
}

function write(me: string, ids: string[]): void {
  try {
    localStorage.setItem(keyOf(me), JSON.stringify(ids));
  } catch {
    /* 저장 불가(사생활 모드 등) — 숨김은 부가 기능이라 무시 */
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function hideRoom(me: string, roomId: string): void {
  const ids = readHiddenRooms(me);
  if (!ids.includes(roomId)) write(me, [...ids, roomId]);
}

/** 숨김 해제. 실제로 바뀐 게 있을 때만 쓴다 — 렌더마다 불려도 이벤트가 연쇄되지 않게. */
export function unhideRooms(me: string, roomIds: string[]): void {
  const ids = readHiddenRooms(me);
  const next = ids.filter((id) => !roomIds.includes(id));
  if (next.length !== ids.length) write(me, next);
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener('storage', onChange); // 다른 탭에서 바꾼 경우
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

/** 현재 숨긴 방 id 목록 — 어디서 숨김/해제하든 즉시 갱신된다. */
export function useHiddenRooms(me: string): string[] {
  // 스냅샷은 문자열(원시값)로 받아야 매 렌더 새 배열로 인한 무한 갱신이 없다.
  const raw = useSyncExternalStore(subscribe, () => readRaw(me));
  return useMemo(() => parse(raw), [raw]);
}
