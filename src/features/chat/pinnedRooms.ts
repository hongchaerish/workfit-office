import { useMemo, useSyncExternalStore } from 'react';

/**
 * 채팅방 "상단 고정" — 사용자별로 브라우저(localStorage)에 둔다(숨김과 같은 방식, hiddenRooms.ts 참고).
 * 웹 메신저와 PWA 가 같은 저장 키를 써서, 같은 브라우저라면 어디서 고정해도 함께 보인다.
 * 쓸 때마다 이벤트를 쏴서 열려 있는 모든 화면이 즉시 다시 그린다.
 */
const keyOf = (me: string) => `workfit-pinned-rooms-${me}`;
/** 사용자별 키가 생기기 전의 옛 키 — 아직 사용자별 값이 없으면 이것을 읽는다 */
const LEGACY_KEY = 'workfit-pinned-rooms';
const CHANGE_EVENT = 'workfit-pinned-rooms-change';

function readRaw(me: string): string {
  try {
    return localStorage.getItem(keyOf(me)) ?? localStorage.getItem(LEGACY_KEY) ?? '[]';
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

export function readPinnedRooms(me: string): string[] {
  return parse(readRaw(me));
}

/** 고정 ↔ 해제. 고정한 순서대로 위에 쌓인다(먼저 고정한 방이 위). */
export function togglePinnedRoom(me: string, roomId: string): void {
  const ids = readPinnedRooms(me);
  const next = ids.includes(roomId) ? ids.filter((id) => id !== roomId) : [...ids, roomId];
  try {
    localStorage.setItem(keyOf(me), JSON.stringify(next));
  } catch {
    /* 저장 불가(사생활 모드 등) — 고정은 부가 기능이라 무시 */
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener('storage', onChange); // 다른 탭에서 바꾼 경우
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

/** 고정한 방 id 목록 — 어디서 고정/해제하든 즉시 갱신된다. */
export function usePinnedRooms(me: string): string[] {
  const raw = useSyncExternalStore(subscribe, () => readRaw(me));
  return useMemo(() => parse(raw), [raw]);
}

/** 고정한 방을 맨 위로(고정한 순서), 나머지는 원래 순서(최근 대화순)를 지킨다. */
export function sortPinnedFirst<T extends { id: string }>(rooms: T[], pinnedIds: string[]): T[] {
  const rank = new Map(pinnedIds.map((id, i) => [id, i]));
  return rooms
    .map((room, index) => ({ room, index }))
    .sort((a, b) => {
      const ra = rank.get(a.room.id);
      const rb = rank.get(b.room.id);
      if (ra !== undefined && rb !== undefined) return ra - rb;
      if (ra !== undefined) return -1;
      if (rb !== undefined) return 1;
      return a.index - b.index;
    })
    .map((x) => x.room);
}
