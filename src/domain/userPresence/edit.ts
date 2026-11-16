import type { UserPresenceStatus } from './schema';
import type { StoredPresence } from './resolve';

export interface PresenceEdit {
  /** 지금 화면에 보이는 상태(자동 상태일 수 있음) */
  shownStatus: UserPresenceStatus | undefined;
  /** 저장된 내 상태 — 메시지는 본인이 쓴 것만 들어 있다 */
  stored: StoredPresence;
  status: UserPresenceStatus;
  /** 없으면 상태만 바꾸고 본인 메시지는 그대로 둔다 */
  message?: string;
  nowIso: string;
}

/**
 * 메뉴에서 상태·메시지를 바꿀 때 저장할 값.
 * 화면 메시지는 휴가·외근·출장 이름일 수 있어 저장에 쓰지 않는다 — 쓰면 기간이 끝나도 남는다.
 * 지금 보이는 상태를 그대로 넘기면 메시지만 바꾼다(회의중 등 자동 상태를 직접 설정으로 굳히지 않는다).
 */
export function presencePatch({ shownStatus, stored, status, message, nowIso }: PresenceEdit): Partial<StoredPresence> {
  if (shownStatus === status && message !== undefined) return { message: message.trim() };
  return { status, message: message !== undefined ? message.trim() : stored.message, updatedAt: nowIso };
}
