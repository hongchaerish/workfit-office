/**
 * 역할 편집 칸에 무엇을 둘까 — 역할 목록을 다시 받을 때(저장·실시간 신호) 저장 안 한 수정을 지우지 않는다.
 * 다른 역할을 고르면 바꾸고, 같은 역할이면 고치던 내용이 없을 때만 새로 온 값을 따른다.
 */
export function nextRoleDraft<T extends { id: string }>(prevSelected: T | null, selected: T | null, draft: T | null): T | null {
  if (!selected) return null;
  if (prevSelected?.id !== selected.id) return selected;
  return JSON.stringify(draft) === JSON.stringify(prevSelected) ? selected : draft;
}
