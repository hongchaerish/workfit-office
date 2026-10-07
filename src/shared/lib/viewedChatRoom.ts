// 화면 인스턴스별로 관리해 숨겨진 탭·중복 패널의 정리가 다른 화면 상태를 지우지 않는다.
const viewedRooms = new Map<symbol, string>();

/** 표시된 대화 화면의 수명 동안만 방을 등록한다. DB 읽음 상태와는 별개다. */
export function registerViewedChatRoom(roomId: string): () => void {
  const instance = Symbol();
  if (roomId) viewedRooms.set(instance, roomId);
  return () => { viewedRooms.delete(instance); };
}

/** 해당 방을 실제 보고 있을 때만 OS 팝업을 생략한다. 수신 시점의 상태를 사용한다. */
export function shouldSuppressChatPopup(roomId?: string): boolean {
  return Boolean(
    roomId && typeof document !== 'undefined' &&
    document.visibilityState === 'visible' && document.hasFocus() &&
    [...viewedRooms.values()].includes(roomId),
  );
}
