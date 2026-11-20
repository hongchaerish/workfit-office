import type { ChatMessage } from '@/domain/chatMessage/schema';
import { compareChatMessages } from '@/domain/chatMessage/order';

/**
 * 실시간 신호로 받은 메시지 변경을 화면의 방 메시지 목록에 바로 반영한다 — 방 전체를 다시 받지 않는다.
 * (chatRealtime.ts 가 쓴다. 순수 함수라 따로 시험한다)
 */
export type LiveChange = { roomId: string; message: ChatMessage } | { roomId: string; removedId: string };

/** 보내는 중에 화면에 먼저 붙여 둔 내 메시지(outboxRunner) — 저장된 진짜 메시지가 오면 빠진다. */
const isOptimistic = (m: ChatMessage) => m.id.includes('-optimistic-');

/**
 * from: 화면에 받아 둔 가장 오래된 메시지 시각(나눠 받기) — 그보다 오래된 메시지가 바뀐 신호는 목록에 끼워 넣지 않는다.
 * 끼워 넣으면 받지 않은 구간 사이에 메시지 하나만 덩그러니 보인다.
 */
export function applyLiveChange(list: ChatMessage[], change: LiveChange, from?: string | null): ChatMessage[] {
  if ('removedId' in change) return list.filter((m) => m.id !== change.removedId);
  const next = change.message;
  const at = list.findIndex((m) => m.id === next.id);
  if (at >= 0) return list.map((m, i) => (i === at ? next : m));
  if (from && next.at < from) return list;
  // 먼저 붙여 둔 것 중 같은 사람·같은 글의 가장 앞 하나만 뺀다 — 같은 말을 빠르게 두 번 보내도 하나로 줄지 않게
  const pendingAt = list.findIndex((m) => isOptimistic(m) && m.senderId === next.senderId && m.text === next.text);
  const rest = pendingAt >= 0 ? list.filter((_, i) => i !== pendingAt) : list;
  // 새 메시지는 거의 항상 맨 끝 — 그 자리에 끼워 넣고, 아니면 순서대로 찾는다
  let i = rest.length;
  while (i > 0 && compareChatMessages(rest[i - 1], next) > 0) i--;
  return [...rest.slice(0, i), next, ...rest.slice(i)];
}

/** 시각(ms)이 붙은 변경 기록 */
export interface TimedChange {
  at: number;
  change: LiveChange;
}

/**
 * 서버에서 방 메시지를 받는 동안 들어온 변경을 받은 목록에 다시 얹는다.
 * 받기 시작한 뒤의 변경은 받은 목록에 없을 수 있어서, 이게 없으면 받기가 끝나는 순간 방금 붙인 메시지가 사라진다.
 */
export function replayChanges(list: ChatMessage[], log: readonly TimedChange[], roomId: string, since: number, from?: string | null): ChatMessage[] {
  let out = list;
  for (const e of log) if (e.at >= since && e.change.roomId === roomId) out = applyLiveChange(out, e.change, from);
  return out;
}

/**
 * 더 받은 메시지(위로 올려 받은 옛 메시지 등)를 화면 목록에 합친다. 이미 있는 메시지는 화면 것을 둔다
 * (실시간으로 고쳐진 최신 상태라서). 결과는 시간 순서.
 */
export function mergeMessages(list: ChatMessage[], more: ChatMessage[]): ChatMessage[] {
  const have = new Set(list.map((m) => m.id));
  const added = more.filter((m) => !have.has(m.id));
  return added.length ? [...list, ...added].sort(compareChatMessages) : list;
}
