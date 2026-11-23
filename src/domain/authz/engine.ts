import { ADMIN_CONSOLE_KEY, PERMISSION_BY_KEY, SUPER_ADMIN_PERMISSIONS, expandPermissions } from './permissions';
import { SCOPE_TYPE_LABEL, type AuthAssignment, type AuthRole } from './types';
import { MASTER_ACCOUNT_NAME, isMasterAccount } from '@/domain/user/masterAccount';

/**
 * 권한 판정 엔진(순수 함수) — 사람 하나가 받은 역할·지정을 모아 권한별 결과와 범위를 낸다.
 * 최종 권한은 받은 지정 전부의 합(합집합). 막는 규칙은 없다.
 */

export interface AuthzUser {
  id: string;
  name?: string;
  dept?: string;
  position?: string;
  status?: string;
  deptId?: string;
  assignments?: { deptId: string; role?: string }[];
}

export interface AuthzOrg {
  depts: { id: string; name: string; parentId?: string | null; headUserId?: string | null }[];
  positions: { id: string; name: string; rank: number }[];
}

export interface GrantSource {
  roleId: string;
  roleName: string;
  /** 왜 이 역할을 받았나 — '개인 지정', '부서: 경영기획팀' … */
  reason: string;
  /** 범위 설명 — '전사', '본인 소속 부서' … (범위 없는 권한은 빈 값) */
  scope: string;
}

export interface Grant {
  all: boolean;
  deptIds: Set<string>;
  via: GrantSource[];
}

export interface MatchedRole {
  role: AuthRole;
  reasons: string[];
}

export interface AuthzResult {
  grants: Map<string, Grant>;
  roles: MatchedRole[];
  isSuperAdmin: boolean;
}

/** 부서와 그 아래 부서 전부 */
export function deptWithDescendants(org: AuthzOrg, deptId: string): Set<string> {
  const out = new Set<string>([deptId]);
  let added = true;
  while (added) {
    added = false;
    for (const d of org.depts) {
      if (d.parentId && out.has(d.parentId) && !out.has(d.id)) {
        out.add(d.id);
        added = true;
      }
    }
  }
  return out;
}

/** 사람이 속한 부서 — 주 소속 + 겸직 + 부서장으로 있는 부서 */
export function userDeptIds(user: AuthzUser, org: AuthzOrg): Set<string> {
  const out = new Set<string>();
  const primary = user.deptId || org.depts.find((d) => d.name === user.dept)?.id;
  if (primary) out.add(primary);
  for (const a of user.assignments ?? []) if (a.deptId) out.add(a.deptId);
  for (const d of org.depts) if (d.headUserId && d.headUserId === user.id) out.add(d.id);
  return out;
}

export function isDeptHead(user: AuthzUser, org: AuthzOrg): boolean {
  return org.depts.some((d) => d.headUserId === user.id) || (user.assignments ?? []).some((a) => a.role === 'HEAD');
}

const deptName = (org: AuthzOrg, id: string) => org.depts.find((d) => d.id === id)?.name ?? '삭제된 부서';

/** 지정이 이 사람에게 해당하면 이유를, 아니면 null */
export function matchAssignment(a: AuthAssignment, user: AuthzUser, org: AuthzOrg): string | null {
  switch (a.targetType) {
    case 'USER':
      return a.targetId === user.id ? '개인 지정' : null;
    case 'DEPT': {
      const mine = userDeptIds(user, org);
      const target = a.targetSub ? deptWithDescendants(org, a.targetId) : new Set([a.targetId]);
      for (const id of mine) if (target.has(id)) return `부서: ${deptName(org, a.targetId)}${a.targetSub ? '(하위 포함)' : ''}`;
      return null;
    }
    case 'POSITION': {
      const target = org.positions.find((p) => p.id === a.targetId);
      const mine = org.positions.find((p) => p.name === user.position);
      if (!target || !mine) return null;
      const ok = a.positionMode === 'GTE' ? mine.rank <= target.rank : mine.id === target.id;
      return ok ? `직급: ${target.name}${a.positionMode === 'GTE' ? ' 이상' : ''}` : null;
    }
    case 'DEPT_HEAD':
      return isDeptHead(user, org) ? '부서장' : null;
  }
}

/** 역할 종류에 따라 실제로 쓸 수 있는 권한 */
export function effectiveRolePermissions(role: AuthRole): string[] {
  if (role.kind === 'super') return SUPER_ADMIN_PERMISSIONS;
  return role.permissions.filter((k) => {
    const def = PERMISSION_BY_KEY.get(k);
    if (!def || def.grantable === false) return false;
    if (role.kind === 'base' && def.adminConsole) return false;
    return true;
  });
}

function scopeOf(a: AuthAssignment | null, user: AuthzUser, org: AuthzOrg): { all: boolean; deptIds: Set<string>; label: string } {
  if (!a || a.scopeType === 'ALL') return { all: true, deptIds: new Set(), label: SCOPE_TYPE_LABEL.ALL };
  const base = a.scopeType === 'OWN_DEPT' ? [...userDeptIds(user, org)] : a.scopeDeptIds;
  const deptIds = new Set<string>();
  for (const id of base) for (const x of a.scopeSub ? deptWithDescendants(org, id) : [id]) deptIds.add(x);
  const label =
    a.scopeType === 'OWN_DEPT'
      ? SCOPE_TYPE_LABEL.OWN_DEPT + (a.scopeSub ? '(하위 포함)' : '')
      : a.scopeDeptIds.map((id) => deptName(org, id)).join(', ') + (a.scopeSub ? '(하위 포함)' : '');
  return { all: false, deptIds, label };
}

export function resolveGrants(user: AuthzUser | null | undefined, roles: AuthRole[], assignments: AuthAssignment[], org: AuthzOrg): AuthzResult {
  const grants = new Map<string, Grant>();
  const matched: MatchedRole[] = [];
  // 마스터 계정(admin) — 역할 지정·상태와 상관없이 언제나 모든 권한, 전사 범위
  if (isMasterAccount(user)) return masterGrants();
  if (!user || user.status === '미사용') return { grants, roles: matched, isSuperAdmin: false };

  const add = (role: AuthRole, reason: string, a: AuthAssignment | null) => {
    const sc = scopeOf(a, user, org);
    for (const key of expandPermissions(effectiveRolePermissions(role))) {
      const scoped = PERMISSION_BY_KEY.get(key)?.scoped === true;
      const g = grants.get(key) ?? { all: false, deptIds: new Set<string>(), via: [] };
      if (!scoped || sc.all) g.all = true;
      else for (const id of sc.deptIds) g.deptIds.add(id);
      g.via.push({ roleId: role.id, roleName: role.name, reason, scope: scoped ? sc.label : '' });
      grants.set(key, g);
    }
  };

  for (const role of [...roles].sort((a, b) => a.sort - b.sort)) {
    if (!role.use) continue;
    const reasons: string[] = [];
    if (role.kind === 'base') {
      reasons.push('전 직원 기본');
      add(role, '전 직원 기본', null);
    } else {
      for (const a of assignments) {
        if (a.roleId !== role.id) continue;
        const r = matchAssignment(a, user, org);
        if (!r) continue;
        reasons.push(r);
        add(role, r, a);
      }
    }
    if (reasons.length) matched.push({ role, reasons });
  }
  return { grants, roles: matched, isSuperAdmin: matched.some((m) => m.role.kind === 'super') };
}

/** 마스터 계정 권한 — 모든 권한 키를 전사 범위로 */
export function masterGrants(): AuthzResult {
  const grants = new Map<string, Grant>();
  for (const key of expandPermissions(SUPER_ADMIN_PERMISSIONS)) {
    grants.set(key, { all: true, deptIds: new Set<string>(), via: [{ roleId: '', roleName: MASTER_ACCOUNT_NAME, reason: '마스터 계정', scope: '' }] });
  }
  return { grants, roles: [], isSuperAdmin: true };
}

export const can = (r: AuthzResult, key: string) => r.grants.has(key);

export function canOnDept(r: AuthzResult, key: string, deptId: string): boolean {
  const g = r.grants.get(key);
  return Boolean(g && (g.all || g.deptIds.has(deptId)));
}

export function canOnUser(r: AuthzResult, key: string, target: AuthzUser, org: AuthzOrg): boolean {
  const g = r.grants.get(key);
  if (!g) return false;
  if (g.all) return true;
  for (const id of userDeptIds(target, org)) if (g.deptIds.has(id)) return true;
  return false;
}

/** 관리자 콘솔 출입 */
export function canUseAdminConsole(r: AuthzResult): boolean {
  return r.grants.has(ADMIN_CONSOLE_KEY);
}
