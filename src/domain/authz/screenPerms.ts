import { LEGACY_MAP } from './legacy';

/**
 * 화면(메뉴) × 작업 → 필요한 권한. 둘 중 하나라도 있으면 통과.
 * 옛 canAccess(url)·canAction(화면, 작업) 호출을 새 권한으로 판정할 때 쓴다.
 */
type Act = 'access' | 'create' | 'update' | 'delete';
type Row = Partial<Record<Act, string[]>>;

const pairRow = (base: string): Row => ({ access: [`${base}.view`], create: [`${base}.manage`], update: [`${base}.manage`], delete: [`${base}.manage`] });

/** 옛 권한표에 없던 화면 */
const EXTRA: Record<string, { url: string; row: Row }> = {
  S_BASE_APRULE: { url: '/base/approval-rule', row: pairRow('admin.approval.rule') },
  S_SYS_AUTH: { url: '/base/auth', row: { access: ['admin.authz'], create: ['admin.authz'], update: ['admin.authz'], delete: ['admin.authz'] } },
  S_ADM_ROLE: { url: '/base/authz/roles', row: { access: ['admin.authz'], create: ['admin.authz'], update: ['admin.authz'], delete: ['admin.authz'] } },
  S_ADM_ASSIGN: { url: '/base/authz/assign', row: { access: ['admin.authz'], create: ['admin.authz'], update: ['admin.authz'], delete: ['admin.authz'] } },
  S_ADM_PEOPLE: { url: '/base/authz/people', row: { access: ['admin.authz'] } },
  S_SYS_BACKUP: { url: '/sys/backup', row: { access: ['admin.backup'], create: ['admin.backup'], update: ['admin.backup'], delete: ['admin.backup'] } },
  /** 기업분류 — 시스템 기준정보, 공통코드와 같은 권한 */
  S_ADM_COMPANY_CLASS: { url: '/base/company-class', row: pairRow('admin.code') },
  /** 관리자 콘솔 › 구성원·조직 › 인사 정보(인사 기록·개인 신상·퇴직) */
  S_ADM_HR: { url: '/base/hr', row: pairRow('admin.people') },
  /** 관리자 콘솔 › 회사·운영 › 자원 관리(회의실·차량·비품 기준정보) */
  S_ADM_RESOURCE: { url: '/base/resource', row: pairRow('admin.resource') },
  /** 관리자 콘솔 › 근태·휴가 — 연차 관리·근무 정책 */
  S_ADM_LEAVE: { url: '/base/leave', row: pairRow('admin.leave') },
  S_ADM_COMMUTE_POLICY: { url: '/base/commute-policy', row: pairRow('admin.leave') },
  /** 관리자 콘솔 › 회사·운영 › 사업구분 — 기업분류와 같은 기준정보 권한 */
  S_ADM_BIZ_CATEGORY: { url: '/base/biz-category', row: pairRow('admin.code') },
};

/** 옛 권한표 화면의 URL (SYSTEM_SCREENS 와 같음) */
const URL_OF: Record<string, string> = {
  S_GW_APPROVAL: '/gw/approval', S_GW_COMMUTE: '/gw/commute', S_GW_COMMUTE_ADMIN: '/gw/commute/admin', S_GW_LEAVE: '/gw/leave',
  S_GW_BOARD: '/gw/board', S_GW_CALENDAR: '/gw/calendar', S_GW_MAIL: '/gw/mail', S_GW_TASK: '/gw/task', S_GW_WORK_PLAN: '/gw/work-plan',
  S_GW_WORK_PLAN_ADMIN: '/gw/work-plan/admin', S_GW_RESOURCE: '/gw/resource', S_GW_SURVEY: '/gw/survey', S_GW_EMPLOYEE: '/gw/employee',
  S_GW_ORGCHART: '/gw/orgchart', S_GW_GALLERY: '/gw/gallery', S_EXEC_DASH: '/exec', S_BASE_USER: '/base/user', S_BASE_DEPT: '/base/department',
  S_BASE_POSITION: '/base/position', S_BASE_HOLIDAY: '/base/holiday', S_BASE_CODE: '/base/code', S_BASE_APFORM: '/base/approval-form',
  S_BASE_APPROC: '/base/approval-process', S_BASE_APMON: '/base/approval-monitor', S_SYS_LOG: '/sys/log', S_SYS_COMPANY: '/sys/company',
  S_SYS_IF: '/sys/interface', S_BIZ_VENDOR: '/biz/vendor', S_BIZ_PROJECT: '/biz/project', S_BIZ_PO: '/biz/po', S_BIZ_PURCHASE: '/biz/purchase',
};

const ROWS = new Map<string, Row>();
for (const [id, row] of Object.entries(LEGACY_MAP)) {
  ROWS.set(id, row);
  if (URL_OF[id]) ROWS.set(URL_OF[id], row);
}
for (const [id, { url, row }] of Object.entries(EXTRA)) {
  ROWS.set(id, row);
  ROWS.set(url, row);
}

/** 화면 id 또는 url 의 작업에 필요한 권한. 빈 목록 = 모두에게 열림(홈 등), 모르는 화면이면 null */
export function screenActionPerms(urlOrId: string, action: Act): string[] | null {
  const row = ROWS.get(urlOrId);
  if (!row) return null;
  return row[action] ?? row.access ?? [];
}
