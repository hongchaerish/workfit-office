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

/**
 * 바뀐 번호를 차례로 저장 — 중간에 하나라도 실패하면 이미 저장한 부서를 원래 번호(before)로 되돌리고 그 오류를 다시 낸다.
 * 순서가 반쯤만 바뀐 채 남지 않게 한다(되돌리기마저 실패하면 어쩔 수 없이 남는다).
 */
export async function saveOrdersAllOrNothing(
  changes: Array<{ id: string; order: number }>,
  before: Map<string, number>,
  save: (id: string, order: number) => Promise<void>,
): Promise<void> {
  const done: string[] = [];
  try {
    for (const c of changes) {
      await save(c.id, c.order);
      done.push(c.id);
    }
  } catch (err) {
    for (const id of done.reverse()) {
      const old = before.get(id);
      if (old !== undefined) await save(id, old).catch(() => undefined);
    }
    throw err;
  }
}
