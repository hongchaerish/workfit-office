/**
 * 권한 목록 — "무엇을 할 수 있나"의 최소 단위. 화면·버튼은 이 키만 본다.
 * 역할(authRoles)은 이 키들의 묶음이고, 지정(authAssignments)이 누구에게·어느 범위로 줄지 정한다.
 * 설계: docs/superpowers/specs/2026-11-11-authz-v2-design.md
 */

export const AUTHZ_AREAS = [
  { id: 'approval', name: '전자결재' },
  { id: 'commute', name: '근태·휴가' },
  { id: 'workplan', name: '업무계획·프로젝트' },
  { id: 'comm', name: '게시판·소통' },
  { id: 'schedule', name: '일정·자원' },
  { id: 'org', name: '조직' },
  { id: 'biz', name: '사업관리' },
  { id: 'adminConsole', name: '관리자 콘솔' },
  { id: 'adminPeople', name: '관리자 · 구성원·조직' },
  { id: 'adminApproval', name: '관리자 · 전자결재' },
  { id: 'adminLeave', name: '관리자 · 근태·휴가' },
  { id: 'adminCompany', name: '관리자 · 회사·운영' },
  { id: 'adminSystem', name: '관리자 · 시스템' },
] as const;

export type AuthzAreaId = (typeof AUTHZ_AREAS)[number]['id'];

export interface PermissionDef {
  key: string;
  name: string;
  desc: string;
  area: AuthzAreaId;
  /** 조직 범위를 받는 권한 */
  scoped?: boolean;
  /** false = 최고 관리자 전용(역할에 넣을 수 없음) */
  grantable?: false;
  /** 관리자 콘솔 권한 — 전 직원 역할에는 넣을 수 없다 */
  adminConsole?: boolean;
  /** 이 권한이 있으면 따라오는 권한 */
  implies?: string[];
}

const P = (d: PermissionDef) => d;
/** 관리자 콘솔에 들어가는 권한 */
export const ADMIN_CONSOLE_KEY = 'admin.console';
/** 보기·관리 짝 — 관리는 보기를 포함한다 */
const pair = (base: string, name: string, area: AuthzAreaId, viewDesc: string, manageDesc: string, extra: Partial<PermissionDef> = {}): PermissionDef[] => [
  { key: `${base}.view`, name: `${name} 보기`, desc: viewDesc, area, ...extra },
  { key: `${base}.manage`, name: `${name} 관리`, desc: manageDesc, area, implies: [`${base}.view`], ...extra },
];

export const PERMISSIONS: PermissionDef[] = [
  // 전자결재
  P({ key: 'approval.use', name: '기안·결재', desc: '문서를 기안하고 결재함에서 결재한다', area: 'approval' }),
  P({ key: 'approval.secure', name: '보안·비공개 문서 열람', desc: '관계자가 아니어도 보안 등급·비공개 문서를 연다', area: 'approval' }),
  P({ key: 'approval.postread.forward', name: '후열 전달', desc: '결재 끝난 문서를 다른 사람에게 후열로 전달한다', area: 'approval' }),

  // 근태·휴가
  P({ key: 'commute.self', name: '내 근태·휴가', desc: '내 출퇴근 기록을 보고 휴가를 신청한다', area: 'commute' }),
  P({ key: 'commute.view', name: '다른 사람 근태·휴가 열람', desc: '범위 안 직원의 출퇴근·휴가 현황을 본다', area: 'commute', scoped: true }),
  P({ key: 'commute.manage', name: '근태 기록 정정', desc: '다른 직원의 외근 기록을 고치거나 지우고, 결재로 잡힌 외근·출장 일정을 대신 바꾼다(연차 가감은 관리자 콘솔 연차 관리)', area: 'commute', implies: ['commute.view'] }),

  // 업무계획·프로젝트
  P({ key: 'workplan.use', name: '업무계획·프로젝트', desc: '내 업무계획을 쓰고 프로젝트에 참여한다', area: 'workplan' }),
  P({ key: 'workplan.manage', name: '공용 태그 관리', desc: '업무계획에서 모두가 쓰는 공용 태그를 만들고 고친다(명단 순서는 관리자 콘솔 부서·조직 관리)', area: 'workplan' }),
  P({ key: 'project.create', name: '프로젝트 만들기', desc: '새 프로젝트를 만들고 담당자를 배정한다', area: 'workplan' }),

  // 게시판·소통
  P({ key: 'board.use', name: '게시판 읽기·쓰기', desc: '게시판 글을 읽고 쓴다', area: 'comm' }),
  P({ key: 'board.manage', name: '게시판 관리', desc: '공지를 쓰고 다른 사람 글을 고치거나 지운다', area: 'comm', implies: ['board.use'] }),
  P({ key: 'survey.use', name: '설문 응답', desc: '사내 설문에 응답한다', area: 'comm' }),
  P({ key: 'survey.manage', name: '설문 만들기', desc: '설문을 만들고 결과를 본다', area: 'comm', implies: ['survey.use'] }),
  P({ key: 'gallery.use', name: '회사 갤러리', desc: '사진을 보고 올린다', area: 'comm' }),
  P({ key: 'messenger.manage', name: '메신저 관리', desc: '다른 사람이 만든 대화방도 삭제한다', area: 'comm' }),

  // 일정·자원
  P({ key: 'calendar.use', name: '캘린더', desc: '개인·부서 일정을 쓰고 본다', area: 'schedule' }),
  P({ key: 'calendar.company', name: '전사 일정 관리', desc: '전사 일정을 등록·수정·삭제한다', area: 'schedule', implies: ['calendar.use'] }),
  P({ key: 'resource.use', name: '자원 예약', desc: '회의실·차량·비품을 예약한다', area: 'schedule' }),
  P({ key: 'resource.manage', name: '예약 관리', desc: '모든 자원의 예약을 승인·반려·취소한다(자원 등록은 관리자 콘솔 자원 관리)', area: 'schedule', implies: ['resource.use'] }),

  // 조직
  P({ key: 'org.view', name: '조직도·인명', desc: '조직도와 직원 연락처를 본다', area: 'org' }),
  P({ key: 'seat.manage', name: '좌석 배치 편집', desc: '사무실 좌석 배치도를 고친다', area: 'org', implies: ['org.view'] }),

  // 사업관리
  ...pair('biz.vendor', '기업 정보', 'biz', '기업 정보를 본다', '기업을 등록·수정한다'),
  ...pair('biz.project', '사업 현황', 'biz', '사업 목록과 진행 상황을 본다', '사업 정보를 고친다'),
  ...pair('biz.po', '발주 현황', 'biz', '결재 끝난 발주서를 본다', '발주 회신 문서를 관리한다'),
  ...pair('biz.purchase', '매입 결제 관리', 'biz', '매입 결제 목록을 본다', '구축일·확정일 등 매입 결제 정보를 고친다'),

  // 관리자 콘솔 — 들어가기. 콘솔 안에서 보이는 메뉴는 아래 관리자 권한마다 따로 준다
  P({ key: 'admin.console', name: '관리자 콘솔 접속', desc: '관리자 콘솔에 들어간다(안에서는 받은 관리자 권한의 메뉴만 보인다)', area: 'adminConsole', adminConsole: true }),

  // 관리자 · 구성원·조직
  ...pair('admin.user', '사용자', 'adminPeople', '로그인 계정 목록과 계정 정보를 본다', '로그인 계정을 등록·수정한다', { adminConsole: true }),
  ...pair('admin.people', '인사 정보', 'adminPeople', '인사 기록과 개인 신상 정보를 본다', '발령·입사일·근태 관리 대상·개인 신상을 고치고 퇴직을 처리한다', { adminConsole: true }),
  ...pair('admin.org', '부서·조직', 'adminPeople', '부서 구조를 본다', '부서를 만들고 구조와 부서장을 바꾼다', { adminConsole: true }),
  ...pair('admin.position', '직급·직책', 'adminPeople', '직급과 직책을 본다', '직급·직책을 추가하고 순서를 바꾼다', { adminConsole: true }),

  // 관리자 · 전자결재
  ...pair('admin.approval.form', '결재서식', 'adminApproval', '결재서식 목록과 설정을 본다', '서식을 만들고 고친다', { adminConsole: true }),
  ...pair('admin.approval.rule', '결재선 규칙', 'adminApproval', '자동 결재선 규칙을 본다', '규칙을 만들고 고친다', { adminConsole: true }),
  ...pair('admin.approval.process', '결재 프로세스', 'adminApproval', '결재 프로세스 설정을 본다', '프로세스 옵션을 켜고 끈다', { adminConsole: true }),
  P({ key: 'admin.approval.monitor', name: '결재문서 모니터링', desc: '전사 결재문서 진행 상황을 본다', area: 'adminApproval', adminConsole: true }),

  // 관리자 · 근태·휴가 — 현황 조회는 업무 화면(commute.view)에서, 콘솔은 조정·정책만
  ...pair('admin.leave', '연차·근무 정책', 'adminLeave', '콘솔에서 전사 연차와 근무 정책을 본다', '연차를 가감하고 근무 정책(출퇴근·휴게·지각 기준)을 고친다', { adminConsole: true }),

  // 관리자 · 회사·운영
  ...pair('admin.company', '회사 정보', 'adminCompany', '법인·사업장 정보를 본다', '회사 정보·로고·직인을 고친다', { adminConsole: true }),
  ...pair('admin.holiday', '공휴일', 'adminCompany', '공휴일 목록을 본다', '공휴일과 회사 지정 휴일을 등록한다', { adminConsole: true }),
  ...pair('admin.resource', '자원', 'adminCompany', '예약 자원 목록을 본다', '회의실·차량·비품을 등록·수정·삭제한다', { adminConsole: true }),
  ...pair('admin.code', '공통코드', 'adminCompany', '공통코드를 본다', '공통코드를 추가하고 고친다', { adminConsole: true }),

  // 관리자 · 시스템
  P({ key: 'admin.log.view', name: '로그 보기', desc: '접속 기록과 변경 기록을 본다', area: 'adminSystem', adminConsole: true }),
  ...pair('admin.interface', '인터페이스', 'adminSystem', '외부 연동 상태를 본다', '연동 설정을 고친다', { adminConsole: true }),
  P({ key: 'admin.authz', name: '역할·권한 관리', desc: '역할을 만들고 누구에게 줄지 정한다', area: 'adminSystem', adminConsole: true, grantable: false }),
  P({ key: 'admin.backup', name: '데이터 백업', desc: '백업과 복원을 실행한다', area: 'adminSystem', adminConsole: true, grantable: false }),
  P({ key: 'admin.testAccounts', name: '테스트 계정 보기 전환', desc: '화면에 테스트 계정을 보이거나 숨긴다', area: 'adminSystem', adminConsole: true, grantable: false }),
];

// 관리자 콘솔 메뉴 권한은 콘솔 접속을 함께 준다 — 메뉴 권한만 받고 콘솔에 못 들어가는 일이 없게
for (const p of PERMISSIONS) {
  if (p.adminConsole && p.key !== ADMIN_CONSOLE_KEY) p.implies = [...(p.implies ?? []), ADMIN_CONSOLE_KEY];
}

export const PERMISSION_BY_KEY = new Map(PERMISSIONS.map((p) => [p.key, p]));

/** 최고 관리자 역할이 갖는 권한 — 모든 메뉴·기능(업무 권한 포함, 전사 범위). 따로 지정할 필요가 없다 */
export const SUPER_ADMIN_PERMISSIONS = PERMISSIONS.map((p) => p.key);

/** implies 를 펼친 권한 목록 */
export function expandPermissions(keys: Iterable<string>): Set<string> {
  const out = new Set<string>();
  const stack = [...keys];
  while (stack.length) {
    const k = stack.pop()!;
    if (out.has(k)) continue;
    out.add(k);
    for (const i of PERMISSION_BY_KEY.get(k)?.implies ?? []) stack.push(i);
  }
  return out;
}
