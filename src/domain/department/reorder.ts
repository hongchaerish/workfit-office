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

type DeptLike = { id: string; parentId: string | null; order: number; name: string };

/** 같은 상위 부서의 형제(나 빼고)를 (순서, 이름)으로 */
const siblingsOf = (depts: DeptLike[], parentId: string | null, exceptId?: string) =>
  depts
    .filter((d) => (d.parentId ?? null) === (parentId ?? null) && d.id !== exceptId)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'ko'));

/**
 * 저장할 부서의 순서 번호 — 새 부서이거나 상위 부서를 바꿨으면 새 상위 부서 안 맨 끝(형제 수 + 1),
 * 상위 그대로면 지금 번호를 둔다. 순서는 숫자로 직접 넣지 않고 ▲▼로만 바꾼다.
 */
export function orderOnSave(depts: DeptLike[], target: { id: string; parentId: string | null }): number {
  const current = target.id ? depts.find((d) => d.id === target.id) : undefined;
  if (current && (current.parentId ?? null) === (target.parentId ?? null)) return current.order;
  const siblings = siblingsOf(depts, target.parentId ?? null, target.id || undefined);
  return siblings.reduce((max, d) => Math.max(max, d.order), 0) + 1;
}

/** 같은 상위 부서 안을 1부터 다시 매긴다 — 겹친 번호·건너뛴 번호를 푼다. 값이 바뀐 부서만 돌려준다 */
export function renumberSiblings(depts: DeptLike[], parentId: string | null): Array<{ id: string; order: number }> {
  return siblingsOf(depts, parentId)
    .map((d, i) => ({ id: d.id, order: i + 1, before: d.order }))
    .filter((r) => r.order !== r.before)
    .map(({ id, order }) => ({ id, order }));
}

/** 같은 이름(띄어쓰기 무시)의 다른 부서 — 조직도·업무계획은 부서를 이름으로 묶어 같은 이름이면 섞인다 */
export function sameNameDept<T extends { id: string; name: string }>(depts: T[], name: string, selfId: string): T | null {
  const norm = (s: string) => s.replace(/\s+/g, '');
  return depts.find((d) => d.id !== selfId && norm(d.name) === norm(name)) ?? null;
}
