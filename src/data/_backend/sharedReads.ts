/**
 * 컬렉션별 '나눠 쓰는 읽기'(crudBackend 의 SHARE_MS) 버리기 — 실시간 신호로 바뀐 걸 알았을 때
 * 방금 받아 둔 옛 목록을 다시 쓰지 않게 한다.
 */
const registry = new Map<string, Set<() => void>>();

export function registerSharedRead(coll: string, forget: () => void): void {
  const set = registry.get(coll) ?? new Set();
  set.add(forget);
  registry.set(coll, set);
}

export function forgetSharedRead(coll: string): void {
  registry.get(coll)?.forEach((f) => f());
}
