/**
 * 부서 관리 — 같은 상위 부서 안에서 한 칸 위/아래로 옮긴다.
 * 형제를 (순서, 이름)으로 줄 세워 자리를 바꾸고 1부터 다시 번호를 매긴 뒤, 값이 바뀐 부서만 돌려준다.
 * 끝에서 더 나가려 하면 빈 배열.
 */
export function moveSibling(
  depts: Array<{ id: string; parentId: string | null; order: number; name: string }>,
  id: string,
  dir: -1 | 1,
): Array<{ id: string; order: number }> {
  const target = depts.find((d) => d.id === id);
  if (!target) return [];
  const siblings = depts
    .filter((d) => (d.parentId ?? null) === (target.parentId ?? null))
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'ko'));
  const from = siblings.findIndex((d) => d.id === id);
  const to = from + dir;
  if (to < 0 || to >= siblings.length) return [];
  const next = [...siblings];
  [next[from], next[to]] = [next[to], next[from]];
  return next
    .map((d, i) => ({ id: d.id, order: i + 1, before: d.order }))
    .filter((r) => r.order !== r.before)
    .map(({ id: rid, order }) => ({ id: rid, order }));
}
