import { useMemo, useCallback } from 'react';
import { isMasterAccount } from '@/domain/user/masterAccount';
import { useAuth } from '@/app/auth/AuthProvider';
import { useOrgTree } from '@/features/gw/useOrgTree';
import { useRoleGroups } from '@/features/roleGroup/useRoleGroups';
import { SYSTEM_SCREENS, type RoleGroup, type ActionPermission } from '@/domain/roleGroup/schema';
import { resolveUserRoles } from '@/domain/roleGroup/roleResolver';
import type { SecurityContext, OrgRelationship } from '@/domain/security/types';
import { useAuthz } from '@/features/authz/useAuthz';

const EXEC_KEYWORDS = ['대표이사', '대표', '상무', '상무이사', '전무', '부사장', '사장', '이사', '위원장', '부위원장'];
const LEADER_KEYWORDS = ['팀장', '부서장', '파트장', '실장', '본부장', '그룹장', '센터장', '지사장', 'leader', 'manager', 'head'];

/**
 * 전사 통합 보안 주체 컨텍스트 훅 (useSecurityContext)
 * 
 * "SecurityContext는 '사용자가 누구인가'를 표현하고, Policy는 '그래서 볼 수 있는가'를 판정한다."
 */
export function useSecurityContext(): SecurityContext {
  const { user } = useAuth();
  const org = useOrgTree();
  const { data: groups = [] } = useRoleGroups() as { data: RoleGroup[] | undefined };
  // 새 권한 체계로 옮긴 뒤에는 화면·최고 관리자 판정을 새 체계가 맡는다
  const authz = useAuthz();

  // 1. 활성 역할 그룹 목록 해석 (SSOT: roleGroups)
  const myGroups = useMemo(() => {
    return resolveUserRoles(user, groups, org);
  }, [user, groups, org]);

  const roles = useMemo(() => {
    return myGroups.map((g) => g.code.replace(/^ROLE_/, '').toUpperCase());
  }, [myGroups]);

  // 2. 최고 관리자 판정
  const isSuperAdmin = useMemo(() => {
    if (!user) return false;
    if (isMasterAccount(user)) return true;
    if (authz.active) return authz.isSuperAdmin;
    return (
      myGroups.some((g) => (g.code === 'ADMIN' || g.code === 'ROLE_ADMIN') && g.use) ||
      (user as any).role === 'admin'
    );
  }, [user, myGroups, authz.active, authz.isSuperAdmin]);

  // 3. 직급/직책 마스터 객체 조회 (SSOT: positions)
  const userPosDef = useMemo(() => {
    if (!user?.position) return null;
    return (org.positions || []).find((p) => p.name === user.position) as any;
  }, [user?.position, org.positions]);

  // 4. 임원(EXECUTIVE) 판정 (코드화된 마스터 플래그 기반)
  // ⚠️ 최고관리자(isSuperAdmin)라도 비임원인 개발팀은 임원으로 판정하지 않음 (전사 관제 자동 노출 방지)
  const isExecutive = useMemo(() => {
    if (!user) return false;
    // 마스터 계정은 임원과 같이 전사 현황을 본다
    if (isMasterAccount(user)) return true;
    if (authz.active) return authz.can('approval.secure');

    // A. 역할 그룹에 EXEC/OPERATOR 가 포함된 경우
    if (roles.includes('EXEC') || roles.includes('EXECUTIVE') || roles.includes('OPERATOR')) {
      return true;
    }

    // B. 직급 마스터 공식 플래그 (isExecutiveRole)
    if (userPosDef && typeof userPosDef.isExecutiveRole === 'boolean') {
      return userPosDef.isExecutiveRole;
    }

    // C. 마스터 미매칭 시의 하위 호환 폴백
    const pos = (user.position || '').trim();
    const title = ((user as any).jobTitle || '').trim();
    return EXEC_KEYWORDS.some((kw) => pos.includes(kw) || title.includes(kw));
  }, [user, roles, userPosDef, authz]);

  // 5. 부서장/팀장(LEADER) 판정 및 관리 부서 목록 (겸직 assignments 포괄)
  const managedDepts = useMemo(() => {
    if (!user) return [];
    // 1) 기본 조직도 상의 부서장 매핑
    const orgHeadDepts = (org.depts || []).filter((d) => d.headUserId === user.id);
    
    // 2) 다중 소속(겸직) assignments 중 HEAD 역할 부서 추가
    const assignmentHeadDeptIds = (user.assignments || [])
      .filter((a) => a.role === 'HEAD')
      .map((a) => a.deptId);
    
    const extraDepts = (org.depts || []).filter(
      (d) => assignmentHeadDeptIds.includes(d.id) && !orgHeadDepts.some((od) => od.id === d.id)
    );

    return [...orgHeadDepts, ...extraDepts];
  }, [user, org.depts]);

  const isLeader = useMemo(() => {
    if (!user) return false;
    if (roles.includes('LEADER')) return true;
    if (managedDepts.length > 0) return true;

    // 직급 마스터 공식 플래그 (isLeaderRole / isDeptHead)
    if (userPosDef) {
      if (userPosDef.isLeaderRole === true || userPosDef.isDeptHead === true) {
        return true;
      }
    }

    // 하위 호환 폴백 (마스터 미등록 직급)
    const pos = (user.position || '').trim().toLowerCase();
    const title = ((user as any).jobTitle || '').trim().toLowerCase();
    const name = (user.name || '').trim().toLowerCase();

    if (name.includes('부서장') || name.includes('팀장')) return true;
    return LEADER_KEYWORDS.some((kw) => pos.includes(kw) || title.includes(kw));
  }, [user, roles, managedDepts, userPosDef]);

  // 6. 조직 관계(OrgRelationship) 헬퍼 (주부서 + 겸직부서 통합 지원)
  const organization: OrgRelationship = useMemo(() => {
    const userDept = (user?.dept || '').trim();
    const managedDeptNames = managedDepts.map((d) => d.name);

    // 겸직 부서 목록
    const userAllDepts = new Set<string>();
    if (userDept) userAllDepts.add(userDept);
    if (user?.assignments) {
      user.assignments.forEach((a) => {
        if (a.deptName) userAllDepts.add(a.deptName.trim());
        const d = (org.depts || []).find((od) => od.id === a.deptId);
        if (d?.name) userAllDepts.add(d.name.trim());
      });
    }

    return {
      managedDeptNames,
      isDeptHead: (targetDept?: string | null) => {
        if (!targetDept) return managedDeptNames.includes(userDept);
        const norm = targetDept.trim();
        return managedDeptNames.includes(norm) || (userAllDepts.has(norm) && isLeader);
      },
      isSameDept: (targetDept?: string | null) => {
        if (!targetDept || userAllDepts.size === 0) return false;
        return userAllDepts.has(targetDept.trim());
      },
    };
  }, [user?.dept, user?.assignments, managedDepts, isLeader, org.depts]);

  // 7. 메뉴별 접근 및 액션 권한
  const HR_ADMIN_SCREENS = useMemo(() => new Set([
    'S_GW_COMMUTE_ADMIN',
    'S_GW_WORK_PLAN_ADMIN',
    '/gw/commute/admin',
    '/gw/work-plan/admin',
  ]), []);

  const canMenuAccess = useCallback(
    (urlOrId: string): boolean => {
      if (isMasterAccount(user)) return true;
      if (!user || user.status === '미사용') return false;
      if (authz.active) return authz.canScreen(urlOrId, 'access');

      const targetScreen = SYSTEM_SCREENS.find((s) => s.id === urlOrId || s.url === urlOrId);
      const screenId = targetScreen?.id || urlOrId;
      const isHrAdmin = HR_ADMIN_SCREENS.has(screenId) || (targetScreen?.url ? HR_ADMIN_SCREENS.has(targetScreen.url) : false);

      // IT 최고관리자(isSuperAdmin)라도 전사 인사/근태 관제 메뉴는 자동 프리패스되지 않음 (임원/팀장/인사위임자 전용)
      if (isSuperAdmin && !isHrAdmin) return true;

      return myGroups.some((g) => {
        const perm = g.menuPermissions?.[screenId] ?? g.menuPermissions?.[targetScreen?.url || ''];
        return perm?.access === true;
      });
    },
    [user, isSuperAdmin, myGroups, HR_ADMIN_SCREENS, authz]
  );

  const canMenuAction = useCallback(
    (urlOrId: string, action: keyof ActionPermission): boolean => {
      if (isMasterAccount(user)) return true;
      if (!user || user.status === '미사용') return false;
      if (authz.active) return authz.canScreen(urlOrId, action);

      const targetScreen = SYSTEM_SCREENS.find((s) => s.id === urlOrId || s.url === urlOrId);
      const screenId = targetScreen?.id || urlOrId;
      const isHrAdmin = HR_ADMIN_SCREENS.has(screenId) || (targetScreen?.url ? HR_ADMIN_SCREENS.has(targetScreen.url) : false);

      if (isSuperAdmin && !isHrAdmin) return true;

      return myGroups.some((g) => {
        const perm = g.menuPermissions?.[screenId] ?? g.menuPermissions?.[targetScreen?.url || ''];
        return perm?.[action] === true;
      });
    },
    [user, isSuperAdmin, myGroups, HR_ADMIN_SCREENS, authz]
  );

  const authzCommute = authz.active ? { scope: authz.commuteScope(), canManage: authz.can('commute.manage'), deptNames: authz.commuteDeptNames } : undefined;

  return {
    authzCommute,
    user: user ?? null,
    userId: user?.id ?? '',
    name: user?.name ?? '',
    dept: user?.dept ?? '',
    position: user?.position ?? '',
    jobTitle: (user as any)?.jobTitle ?? '',
    roles,
    roleGroups: myGroups,
    isSuperAdmin,
    isExecutive,
    isLeader,
    organization,
    canMenuAccess,
    canMenuAction,
  };
}
