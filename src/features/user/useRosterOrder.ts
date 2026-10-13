import { useCallback, useMemo } from 'react';
import { useOrgTree, type OrgNode } from '@/features/gw/useOrgTree';
import { useRoleGroups } from '@/features/roleGroup/useRoleGroups';
import { resolveUserRoles } from '@/domain/roleGroup/roleResolver';
import type { RoleGroup } from '@/domain/roleGroup/schema';
import { compareRoster, type RosterOrderContext, type RosterPerson } from '@/domain/user/rosterOrder';
import { useRosterOrderSetting } from './useRosterOrderSetting';

const EXEC_GROUP_CODES = new Set(['EXEC', 'EXECUTIVE']);
const normName = (name?: string | null) => (name ?? '').replace(/\s+/g, '');

/**
 * 인원 정렬 비교 함수 — 업무계획에서 관리자가 정한 전 직원 순서 → (순서에 없으면) 임원(그룹권한관리 '임원' 그룹) → 부서(조직도 순서) → 직책 → 직급 → 이름.
 * 사람을 줄 세우는 화면은 `list.sort(compare)` 로 이 기준을 그대로 쓴다([[rosterOrder]]).
 * 대상 행에 사용자 ID 가 없으면(근태 CAPS 행 등) 이름으로 임원 여부를 찾는다.
 */
export function useRosterOrder() {
  const org = useOrgTree();
  const { data: groups = [] } = useRoleGroups() as { data: RoleGroup[] | undefined };
  const { data: manualOrder = [] } = useRosterOrderSetting();

  const deptIndex = useMemo(() => {
    const index = new Map<string, number>();
    const walk = (nodes: OrgNode[]) => {
      for (const node of nodes) {
        if (node.dept?.name && !index.has(node.dept.name)) index.set(node.dept.name, index.size);
        walk(node.children ?? []);
      }
    };
    walk(org.roots);
    return index;
  }, [org.roots]);

  const executives = useMemo(() => {
    const ids = new Set<string>();
    const names = new Set<string>();
    // 전 직원 정렬 순서(업무계획 > 정렬 순서) — 사용자 ID 없는 행(근태 CAPS 등)은 이름으로 찾는다
    const orderById = new Map(manualOrder.map((id, i) => [id, i]));
    const orderByName = new Map<string, number>();
    for (const u of org.users) {
      const roles = resolveUserRoles(u, groups, org);
      if (roles.some((g) => EXEC_GROUP_CODES.has(g.code.replace(/^ROLE_/, '').toUpperCase()))) {
        ids.add(u.id);
        names.add(normName(u.name));
      }
      const order = orderById.get(u.id);
      if (order !== undefined) orderByName.set(normName(u.name), order);
    }
    return { ids, names, orderById, orderByName };
  }, [org, groups, manualOrder]);

  const ctx = useMemo<RosterOrderContext>(
    () => ({
      isExecutive: (p) => {
        const id = (p as { id?: string }).id;
        return id ? executives.ids.has(id) : executives.names.has(normName(p.name));
      },
      deptOrder: (dept) => deptIndex.get(dept) ?? Number.MAX_SAFE_INTEGER,
      positionRank: (position) => org.rankOf(position),
      displayOrder: (p) => {
        const id = (p as { id?: string }).id;
        return id ? executives.orderById.get(id) : executives.orderByName.get(normName(p.name));
      },
    }),
    [executives, deptIndex, org],
  );

  const compare = useCallback((a: RosterPerson, b: RosterPerson) => compareRoster(a, b, ctx), [ctx]);
  return { compare, isExecutive: ctx.isExecutive };
}
