import type { RoleGroup } from '@/domain/roleGroup/schema';
import type { AuthAssignment, AuthRole } from './types';
import type { AuthzOrg } from './engine';

/**
 * 옛 권한(화면 × 보기·작성·수정·삭제 표, 이름·플래그 판정)을 새 역할·지정으로 옮기는 규칙.
 * 옛 데이터는 읽기만 한다.
 */

type Act = 'access' | 'create' | 'update' | 'delete';
type LegacyRow = Partial<Record<Act, string[]>>;

/** 화면 × 작업 → 새 권한 */
export const LEGACY_MAP: Record<string, LegacyRow> = {
  S_GW_APPROVAL: { access: ['approval.use'] },
  S_GW_COMMUTE: { access: ['commute.self'] },
  S_GW_LEAVE: { access: ['commute.self'] },
  S_GW_COMMUTE_ADMIN: { access: ['commute.view'], update: ['commute.manage'] },
  S_GW_BOARD: { access: ['board.use'], update: ['board.manage'], delete: ['board.manage'] },
  S_GW_CALENDAR: { access: ['calendar.use'] },
  S_GW_MAIL: {},
  S_GW_TASK: { access: ['workplan.use'], create: ['project.create'] },
  S_GW_WORK_PLAN: { access: ['workplan.use'] },
  S_GW_WORK_PLAN_ADMIN: { update: ['workplan.manage'] },
  S_GW_RESOURCE: { access: ['resource.use'], update: ['resource.manage'] },
  S_GW_SURVEY: { access: ['survey.use'], create: ['survey.manage'] },
  S_GW_EMPLOYEE: { access: ['org.view'] },
  S_GW_ORGCHART: { access: ['org.view'] },
  S_GW_GALLERY: { access: ['gallery.use'] },
  S_EXEC_DASH: {},
  // 인사 정보(퇴직 처리 등)는 예전에 사용자 관리 권한으로 하던 일 — 함께 옮긴다
  S_BASE_USER: { access: ['admin.user.view', 'admin.people.view'], create: ['admin.user.manage', 'admin.people.manage'], update: ['admin.user.manage', 'admin.people.manage'], delete: ['admin.user.manage', 'admin.people.manage'] },
  S_BASE_DEPT: { access: ['admin.org.view'], create: ['admin.org.manage'], update: ['admin.org.manage'], delete: ['admin.org.manage'] },
  S_BASE_POSITION: { access: ['admin.position.view'], create: ['admin.position.manage'], update: ['admin.position.manage'], delete: ['admin.position.manage'] },
  S_BASE_HOLIDAY: { access: ['admin.holiday.view'], create: ['admin.holiday.manage'], update: ['admin.holiday.manage'], delete: ['admin.holiday.manage'] },
  S_BASE_CODE: { access: ['admin.code.view'], create: ['admin.code.manage'], update: ['admin.code.manage'], delete: ['admin.code.manage'] },
  S_BASE_APFORM: { access: ['admin.approval.form.view'], create: ['admin.approval.form.manage'], update: ['admin.approval.form.manage'], delete: ['admin.approval.form.manage'] },
  S_BASE_APPROC: { access: ['admin.approval.process.view'], create: ['admin.approval.process.manage'], update: ['admin.approval.process.manage'], delete: ['admin.approval.process.manage'] },
  S_BASE_APMON: { access: ['admin.approval.monitor'] },
  S_SYS_AUTH: {},
  S_SYS_BACKUP: {},
  S_SYS_LOG: { access: ['admin.log.view'] },
  S_SYS_COMPANY: { access: ['admin.company.view'], create: ['admin.company.manage'], update: ['admin.company.manage'], delete: ['admin.company.manage'] },
  S_SYS_IF: { access: ['admin.interface.view'], create: ['admin.interface.manage'], update: ['admin.interface.manage'], delete: ['admin.interface.manage'] },
  S_BIZ_VENDOR: { access: ['biz.vendor.view'], create: ['biz.vendor.manage'], update: ['biz.vendor.manage'], delete: ['biz.vendor.manage'] },
  S_BIZ_PROJECT: { access: ['biz.project.view'], update: ['biz.project.manage'] },
  S_BIZ_PO: { access: ['biz.po.view'], update: ['biz.po.manage'] },
  S_BIZ_PURCHASE: { access: ['biz.purchase.view'], update: ['biz.purchase.manage'] },
};

export function legacyPermissions(menuPermissions: Record<string, Partial<Record<Act, boolean>>> | undefined): string[] {
  const out = new Set<string>();
  for (const [screen, flags] of Object.entries(menuPermissions ?? {})) {
    const row = LEGACY_MAP[screen];
    if (!row || !flags) continue;
    for (const act of ['access', 'create', 'update', 'delete'] as Act[]) {
      if (flags[act]) for (const k of row[act] ?? []) out.add(k);
    }
  }
  return [...out].sort();
}

/** 이름·플래그로 판정하던 역할의 권한 */
export const RULE_PERMISSIONS = {
  exec: ['approval.secure', 'commute.view', 'calendar.company', 'seat.manage'],
  head: ['commute.view'],
  operator: ['approval.postread.forward', 'calendar.company', 'seat.manage'],
};

let seq = 0;
export const blankAssignment = (roleId: string, p: Partial<AuthAssignment>) => blank(roleId, p);
const aid = () => `ASG-${(++seq).toString(36)}`;
const blank = (roleId: string, p: Partial<AuthAssignment>): AuthAssignment => ({
  id: aid(),
  roleId,
  targetType: 'USER',
  targetId: '',
  targetSub: false,
  positionMode: 'EQ',
  scopeType: 'ALL',
  scopeDeptIds: [],
  scopeSub: true,
  ...p,
});

function targetsOf(g: RoleGroup, roleId: string, org: AuthzOrg, users: { id: string; empNo?: string; name?: string }[]): AuthAssignment[] {
  const out: AuthAssignment[] = [];
  const userIds = new Set<string>();
  for (const id of g.userIds ?? []) {
    const u = users.find((x) => x.id === id || x.empNo === id);
    if (u) userIds.add(u.id);
  }
  for (const m of g.members ?? []) {
    const u = users.find((x) => x.id === m.code || x.empNo === m.code);
    if (u) userIds.add(u.id);
  }
  for (const id of userIds) out.push(blank(roleId, { targetType: 'USER', targetId: id }));
  for (const id of g.deptIds ?? []) if (org.depts.some((d) => d.id === id)) out.push(blank(roleId, { targetType: 'DEPT', targetId: id }));
  for (const rank of g.positionRanks ?? []) {
    for (const p of org.positions.filter((x) => x.rank === rank)) out.push(blank(roleId, { targetType: 'POSITION', targetId: p.id }));
  }
  return out;
}

/**
 * 옛 역할 그룹 + 직급 플래그 → 새 역할·지정 (미리보기·변환 공용).
 * positions 의 isExecutiveRole·isLeaderRole 은 직급 단위 지정으로 옮긴다.
 */
export function convertLegacy(
  groups: RoleGroup[],
  org: Omit<AuthzOrg, 'positions'> & { positions: { id: string; name: string; rank: number; isExecutiveRole?: boolean; isLeaderRole?: boolean }[] },
  users: { id: string; empNo?: string; name?: string; role?: string }[],
): { roles: AuthRole[]; assignments: AuthAssignment[] } {
  seq = 0;
  const roles: AuthRole[] = [];
  const assignments: AuthAssignment[] = [];
  const norm = (c: string) => c.replace(/^ROLE_/, '').toUpperCase();
  const byCode = new Map(groups.map((g) => [norm(g.code), g]));

  const admin = byCode.get('ADMIN');
  roles.push({ id: 'ROLE-SUPER', name: '최고 관리자', desc: '관리자 콘솔의 모든 기능과 역할·권한 관리', permissions: [], kind: 'super', use: true, sort: 0, migratedFrom: admin?.name ?? '' });
  if (admin) assignments.push(...targetsOf(admin, 'ROLE-SUPER', org, users));
  for (const u of users) if (u.role === 'admin' && !assignments.some((a) => a.roleId === 'ROLE-SUPER' && a.targetId === u.id)) assignments.push(blank('ROLE-SUPER', { targetType: 'USER', targetId: u.id }));

  const base = byCode.get('USER');
  roles.push({ id: 'ROLE-BASE', name: '전 직원', desc: '사용 중인 모든 직원이 자동으로 받는 기본 권한', permissions: legacyPermissions(base?.menuPermissions as never).filter((k) => !k.startsWith('admin.')).sort(), kind: 'base', use: true, sort: 1, migratedFrom: base?.name ?? '' });

  const basePerms = new Set(roles[1].permissions);
  const minusBase = (keys: Iterable<string>) => [...new Set(keys)].filter((k) => !basePerms.has(k)).sort();

  // 임원 — 옛 EXEC 그룹 + 이름·플래그 판정
  const exec = byCode.get('EXEC');
  const execPerms = new Set([...RULE_PERMISSIONS.exec, ...legacyPermissions(exec?.menuPermissions as never)]);
  roles.push({ id: 'ROLE-EXEC', name: '임원', desc: '경영진 — 보안 문서·전사 근태 열람, 전사 일정·좌석 배치 관리', permissions: minusBase(execPerms), kind: 'custom', use: true, sort: 10, migratedFrom: exec?.name ?? '임원 판정 규칙' });
  if (exec) assignments.push(...targetsOf(exec, 'ROLE-EXEC', org, users));
  for (const p of org.positions.filter((x) => x.isExecutiveRole)) {
    if (!assignments.some((a) => a.roleId === 'ROLE-EXEC' && a.targetType === 'POSITION' && a.targetId === p.id)) assignments.push(blank('ROLE-EXEC', { targetType: 'POSITION', targetId: p.id }));
  }

  // 부서장 — 조직도 부서장 + 리더 직급, 본인 부서 범위
  roles.push({ id: 'ROLE-HEAD', name: '부서장', desc: '본인 부서 직원의 근태·휴가 열람', permissions: [...RULE_PERMISSIONS.head], kind: 'custom', use: true, sort: 20, migratedFrom: '부서장 판정 규칙' });
  assignments.push(blank('ROLE-HEAD', { targetType: 'DEPT_HEAD', scopeType: 'OWN_DEPT', scopeSub: false }));
  for (const p of org.positions.filter((x) => x.isLeaderRole && !x.isExecutiveRole)) assignments.push(blank('ROLE-HEAD', { targetType: 'POSITION', targetId: p.id, scopeType: 'OWN_DEPT', scopeSub: false }));

  // 운영자
  const op = byCode.get('OPERATOR');
  const opUsers = users.filter((u) => u.role === 'operator');
  if (op || opUsers.length) {
    roles.push({ id: 'ROLE-OPERATOR', name: '운영자', desc: '후열 전달, 전사 일정·좌석 배치 관리', permissions: minusBase([...RULE_PERMISSIONS.operator, ...legacyPermissions(op?.menuPermissions as never)]), kind: 'custom', use: true, sort: 30, migratedFrom: op?.name ?? '운영자 판정 규칙' });
    if (op) assignments.push(...targetsOf(op, 'ROLE-OPERATOR', org, users));
    for (const u of opUsers) assignments.push(blank('ROLE-OPERATOR', { targetType: 'USER', targetId: u.id }));
  }

  // 그 밖의 그룹 — 같은 이름의 역할
  let sort = 40;
  for (const g of groups) {
    const c = norm(g.code);
    if (['ADMIN', 'USER', 'EXEC', 'OPERATOR'].includes(c)) continue;
    const id = `ROLE-${c}`;
    roles.push({ id, name: g.name || g.code, desc: g.desc ?? '', permissions: minusBase(legacyPermissions(g.menuPermissions as never)), kind: 'custom', use: g.use, sort: sort++, migratedFrom: g.name || g.code });
    assignments.push(...targetsOf(g, id, org, users));
  }
  return { roles, assignments };
}
