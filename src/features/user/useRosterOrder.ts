import { useCallback, useMemo } from 'react';
import { useOrgTree, type OrgNode } from '@/features/gw/useOrgTree';
import { useRoleGroups } from '@/features/roleGroup/useRoleGroups';
import { resolveUserRoles } from '@/domain/roleGroup/roleResolver';
import type { RoleGroup } from '@/domain/roleGroup/schema';
import { compareRoster, type RosterOrderContext, type RosterPerson } from '@/domain/user/rosterOrder';

const EXEC_GROUP_CODES = new Set(['EXEC', 'EXECUTIVE']);
const normName = (name?: string | null) => (name ?? '').replace(/\s+/g, '');

/**
 * 인원 정렬 비교 함수 — 임원(그룹권한관리 '임원' 그룹) → 부서(조직도 순서) → 직책 → 직급 → 이름.
 * 사람을 줄 세우는 화면은 `list.sort(compare)` 로 이 기준을 그대로 쓴다([[rosterOrder]]).
 * 대상 행에 사용자 ID 가 없으면(근태 CAPS 행 등) 이름으로 임원 여부를 찾는다.
 */
export function useRosterOrder() {
  const org = useOrgTree();
  const { data: groups = [] } = useRoleGroups() as { data: RoleGroup[] | undefined };

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
    for (const u of org.users) {
      const roles = resolveUserRoles(u, groups, org);
      if (roles.some((g) => EXEC_GROUP_CODES.has(g.code.replace(/^ROLE_/, '').toUpperCase()))) {
        ids.add(u.id);
        names.add(normName(u.name));
      }
    }
    return { ids, names };
  }, [org, groups]);

  const ctx = useMemo<RosterOrderContext>(
    () => ({
      isExecutive: (p) => {
        const id = (p as { id?: string }).id;
        return id ? executives.ids.has(id) : executives.names.has(normName(p.name));
      },
      deptOrder: (dept) => deptIndex.get(dept) ?? Number.MAX_SAFE_INTEGER,
      positionRank: (position) => org.rankOf(position),
    }),
    [executives, deptIndex, org],
  );

  const compare = useCallback((a: RosterPerson, b: RosterPerson) => compareRoster(a, b, ctx), [ctx]);
  return { compare, isExecutive: ctx.isExecutive };
}
