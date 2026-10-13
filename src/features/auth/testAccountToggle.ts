import { useSyncExternalStore } from 'react';

/**
 * 최고관리자 상단 '테스트 계정 표시' 토글 — 브라우저(localStorage)에 둔다(pinnedRooms.ts 와 같은 방식).
 * 기본값은 켜짐(토글 도입 전처럼 최고관리자에게 테스트 계정이 보인다).
 */
const KEY = 'workfit-show-test-accounts';
const CHANGE_EVENT = 'workfit-show-test-accounts-change';

function read(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setShowTestAccounts(show: boolean): void {
  try {
    localStorage.setItem(KEY, show ? 'on' : 'off');
  } catch {
    /* 저장 불가(사생활 모드 등) — 이번 화면에서만 바뀌지 않는다 */
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

export function useShowTestAccounts(): boolean {
  return useSyncExternalStore(subscribe, read);
}
