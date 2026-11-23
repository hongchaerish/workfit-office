import type { RoleGroup } from '@/domain/roleGroup/schema';
import { isMasterAccount } from '@/domain/user/masterAccount';
import { masterGrants } from './engine';
import { resolveUserRoles } from '@/domain/roleGroup/roleResolver';
import { isExecutiveUser, isLeaderUser } from './legacyRules';
import type { User } from '@/domain/user/schema';
import { PERMISSION_BY_KEY, SUPER_ADMIN_PERMISSIONS, expandPermissions } from './permissions';
import { userDeptIds, type AuthzOrg, type AuthzResult, type Grant } from './engine';
import { LEGACY_MAP, RULE_PERMISSIONS } from './legacy';

/**
 * 옛 판정을 새 권한 키로 옮겨 계산한다 — 새 체계로 옮기기 전(authRoles 가 비었을 때)의 동작과,
 * 옮길 때 옛·새 비교표에 쓴다. 옛 판정 코드(useSecurityContext·scopeHelper)와 같은 규칙.
 */

export interface LegacyOrg extends AuthzOrg {
  positions: { id: string; name: string; rank: number; isExecutiveRole?: boolean; isLeaderRole?: boolean; isDeptHead?: boolean }[];
}

export type LegacyUser = Pick<User, 'id' | 'name' | 'dept' | 'position'> & {
  empNo?: string;
  jobTitle?: string;
  status?: string;
  role?: string;
  deptId?: string;
  assignments?: { deptId: string; role?: string }[];
};

export interface LegacyFlags {
  superAdmin: boolean;
  exec: boolean;
  execCommute: boolean;
  leader: boolean;
  operator: boolean;
  /** 운영자 그룹·운영자 계정으로 운영자인 경우(최고 관리자라서 운영자인 경우 제외) */
  operatorExplicit: boolean;
}

export const LEGACY_SUPER_VIA = '최고 관리자(예전 방식)';
const EXEC_KEYWORDS = ['대표이사', '대표', '상무', '상무이사', '전무', '부사장', '사장', '이사', '위원장', '부위원장'];
const LEADER_KEYWORDS = ['팀장', '부서장', '파트장', '실장', '본부장', '그룹장', '센터장', '지사장', 'leader', 'manager', 'head'];

export function legacyFlags(user: LegacyUser, groups: RoleGroup[], org: LegacyOrg): { flags: LegacyFlags; myGroups: RoleGroup[] } {
  const myGroups = resolveUserRoles(user, groups, org);
  const roles = myGroups.map((g) => g.code.replace(/^ROLE_/, '').toUpperCase());
  const superAdmin = myGroups.some((g) => (g.code === 'ADMIN' || g.code === 'ROLE_ADMIN') && g.use) || user.role === 'admin';
  const posDef = org.positions.find((p) => p.name === user.position);
  const pos = (user.position || '').trim();
  const title = (user.jobTitle || '').trim();

  // useSecurityContext.isExecutive
  let execSC = roles.includes('EXEC') || roles.includes('EXECUTIVE') || roles.includes('OPERATOR');
  if (!execSC) execSC = posDef && typeof posDef.isExecutiveRole === 'boolean' ? posDef.isExecutiveRole : EXEC_KEYWORDS.some((k) => pos.includes(k) || title.includes(k));
  // scopeHelper.isExecutiveUser (근태 조회 범위)
  const execCommute = isExecutiveUser(user as User, roles);

  // useSecurityContext.isLeader ∪ scopeHelper.isLeaderUser
  const heads = org.depts.some((d) => d.headUserId === user.id) || (user.assignments ?? []).some((a) => a.role === 'HEAD');
  const lc = (s: string) => s.toLowerCase();
  const leaderSC =
    roles.includes('LEADER') ||
    heads ||
    Boolean(posDef && (posDef.isLeaderRole || posDef.isDeptHead)) ||
    lc(user.name || '').includes('부서장') ||
    lc(user.name || '').includes('팀장') ||
    LEADER_KEYWORDS.some((k) => lc(pos).includes(k) || lc(title).includes(k));
  const leader = leaderSC || isLeaderUser(user as User, roles, org);

  const operatorExplicit = roles.includes('OPERATOR') || user.role === 'operator';
  const operator = superAdmin || operatorExplicit || user.role === 'admin';
  return { flags: { superAdmin, exec: execSC, execCommute, leader, operator, operatorExplicit }, myGroups };
}

export function legacyGrants(user: LegacyUser | null | undefined, groups: RoleGroup[], org: LegacyOrg): AuthzResult & { flags: LegacyFlags } {
  const grants = new Map<string, Grant>();
  const empty: LegacyFlags = { superAdmin: false, exec: false, execCommute: false, leader: false, operator: false, operatorExplicit: false };
  // 마스터 계정(admin) — 옛 권한표에서도 모든 권한, 전사 현황까지
  if (isMasterAccount(user)) return { ...masterGrants(), flags: { ...empty, superAdmin: true, exec: true, execCommute: true } };
  if (!user || user.status === '미사용') return { grants, roles: [], isSuperAdmin: false, flags: empty };
  const { flags, myGroups } = legacyFlags(user, groups, org);

  const add = (keys: Iterable<string>, via: string, scope: { all: boolean; deptIds?: Set<string>; label: string } = { all: true, label: '전사' }) => {
    for (const key of expandPermissions(keys)) {
      const scoped = PERMISSION_BY_KEY.get(key)?.scoped === true;
      const g = grants.get(key) ?? { all: false, deptIds: new Set<string>(), via: [] };
      if (!scoped || scope.all) g.all = true;
      else for (const id of scope.deptIds ?? []) g.deptIds.add(id);
      g.via.push({ roleId: '', roleName: via, reason: '', scope: scoped ? scope.label : '' });
      grants.set(key, g);
    }
  };

  // 권한표(그룹별 화면 × 작업)
  for (const g of myGroups) {
    const keys: string[] = [];
    for (const [screen, f] of Object.entries(g.menuPermissions ?? {})) {
      const row = LEGACY_MAP[screen];
      if (!row || !f) continue;
      for (const act of ['access', 'create', 'update', 'delete'] as const) if ((f as Record<string, boolean>)[act]) keys.push(...(row[act] ?? []));
    }
    // 관리자 그룹의 권한표는 최고 관리자 몫으로 본다
    add(keys, /^(ROLE_)?ADMIN$/i.test(g.code) ? LEGACY_SUPER_VIA : g.name || g.code);
  }
  // 최고 관리자 — 모든 메뉴·기능(새 체계와 같다)
  if (flags.superAdmin) add([...SUPER_ADMIN_PERMISSIONS], LEGACY_SUPER_VIA);
  if (flags.exec) add(RULE_PERMISSIONS.exec.filter((k) => k !== 'commute.view'), '임원 판정');
  if (flags.operator) add(RULE_PERMISSIONS.operator, flags.operatorExplicit ? '운영자 판정' : LEGACY_SUPER_VIA);
  if (flags.execCommute) add(['commute.view'], '임원 판정');
  else if (flags.leader) add(['commute.view'], '부서장 판정', { all: false, deptIds: userDeptIds(user, org), label: '본인 소속 부서' });

  return { grants, roles: [], isSuperAdmin: flags.superAdmin, flags };
}
