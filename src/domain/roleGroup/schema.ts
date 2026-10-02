import { z } from 'zod';

/**
 * 역할그룹(RoleGroup) 도메인 스키마 — 엔터프라이즈 RBAC 권한그룹 + 전사 메뉴/액션 권한 매트릭스.
 * ([[데이터_모델_설계서.md]] roleGroups)
 */

/** 레거시 호환용 상수 */
export const PERM_MENUS = [
  '시스템관리', '사용자관리', '그룹권한관리', '공통코드정보',
  '품목정보', '설비정보', '불량항목정보', '접속이력관리',
] as const;
export const PERM_COLS = ['보기', '조회', '신규', '저장', '삭제'] as const;

export const memberSchema = z.object({ name: z.string(), code: z.string() });

/** 화면 카테고리 정의 */
export const PERM_CATEGORIES = [
  { id: 'GW', name: '그룹웨어 모듈' },
  { id: 'EXEC', name: '경영 & 운영 현황' },
  { id: 'BASE', name: '기준 정보 & 결재 관리' },
  { id: 'SYS', name: '시스템 관리 & 보안 감사' },
  { id: 'SALES', name: '영업 & 수주 관리' },
] as const;

export type PermCategoryId = (typeof PERM_CATEGORIES)[number]['id'];

/** 권한 제어 대상 전체 페이지 정의 */
export interface SystemScreenDef {
  id: string;
  name: string;
  url: string;
  category: PermCategoryId;
  desc?: string;
  supportedActions?: ('access' | 'create' | 'update' | 'delete')[];
}

export const SYSTEM_SCREENS: SystemScreenDef[] = [
  // 1. 그룹웨어 모듈 (13개)
  { id: 'S_GW_APPROVAL', name: '전자결재', url: '/gw/approval', category: 'GW', desc: '기안, 결재, 결재함 관리', supportedActions: ['access', 'create', 'update', 'delete'] },
  { id: 'S_GW_COMMUTE', name: '근태관리', url: '/gw/commute', category: 'GW', desc: '출퇴근 기록 및 개인 근태 현황', supportedActions: ['access', 'create', 'update'] },
  { id: 'S_GW_COMMUTE_ADMIN', name: '근태/휴가 관제 센터', url: '/gw/commute/admin', category: 'GW', desc: '전사/부서 임직원 실시간 출퇴근, 이상근태(지각) 및 연차 대장 관제', supportedActions: ['access', 'update'] },
  { id: 'S_GW_LEAVE', name: '휴가관리', url: '/gw/leave', category: 'GW', desc: '연차/휴가 신청 및 잔여일수 조회', supportedActions: ['access', 'create', 'update', 'delete'] },
  { id: 'S_GW_BOARD', name: '사내게시판', url: '/gw/board', category: 'GW', desc: '공지사항 및 전사 게시판', supportedActions: ['access', 'create', 'update', 'delete'] },
  { id: 'S_GW_CALENDAR', name: '캘린더', url: '/gw/calendar', category: 'GW', desc: '개인/부서/전사 캘린더', supportedActions: ['access', 'create', 'update', 'delete'] },
  { id: 'S_GW_MAIL', name: '사내메일', url: '/gw/mail', category: 'GW', desc: '웹메일 송수신 및 메일함', supportedActions: ['access', 'create', 'update', 'delete'] },
  { id: 'S_GW_TASK', name: '프로젝트', url: '/gw/task', category: 'GW', desc: '칸반/목록 프로젝트 배정 및 진행 관리', supportedActions: ['access', 'create', 'update', 'delete'] },
  { id: 'S_GW_WORK_PLAN', name: '내 업무계획 (To-Do)', url: '/gw/work-plan', category: 'GW', desc: '일일 업무 보고 및 개인 To-Do 계획', supportedActions: ['access', 'create', 'update', 'delete'] },
  { id: 'S_GW_WORK_PLAN_ADMIN', name: '팀·전사 업무 종합 현황', url: '/gw/work-plan/admin', category: 'GW', desc: '팀원/전사원 주간 To-Do 매트릭스 및 진척률 모니터링', supportedActions: ['access', 'update'] },
  { id: 'S_GW_RESOURCE', name: '자원예약', url: '/gw/resource', category: 'GW', desc: '회의실, 법인차량, 비품 예약', supportedActions: ['access', 'create', 'update', 'delete'] },
  { id: 'S_GW_SURVEY', name: '전자설문', url: '/gw/survey', category: 'GW', desc: '사내 설문조사 생성 및 응답', supportedActions: ['access', 'create', 'update', 'delete'] },
  { id: 'S_GW_EMPLOYEE', name: '인명관리', url: '/gw/employee', category: 'GW', desc: '임직원 연락처 및 프로필 검색', supportedActions: ['access', 'create', 'update', 'delete'] },
  { id: 'S_GW_ORGCHART', name: '조직도', url: '/gw/orgchart', category: 'GW', desc: '조직 계층도 및 부서원 조회', supportedActions: ['access'] },
  { id: 'S_GW_GALLERY', name: '회사 갤러리', url: '/gw/gallery', category: 'GW', desc: '사내 행사 및 전사 갤러리 공유', supportedActions: ['access', 'create', 'update', 'delete'] },

  // 2. 경영 현황 (1개)
  { id: 'S_EXEC_DASH', name: '경영 대시보드', url: '/exec', category: 'EXEC', desc: '경영 지표 및 전사 KPI 요약', supportedActions: ['access', 'update'] },

  // 3. 기준 정보 & 결재 관리 (8개)
  { id: 'S_BASE_USER', name: '사용자 관리', url: '/base/user', category: 'BASE', desc: '사원 등록, 계정 및 퇴사 관리', supportedActions: ['access', 'create', 'update', 'delete'] },
  { id: 'S_BASE_DEPT', name: '부서/조직 관리', url: '/base/department', category: 'BASE', desc: '부서 생성, 트리 구조 및 부서장 지정', supportedActions: ['access', 'create', 'update', 'delete'] },
  { id: 'S_BASE_POSITION', name: '직급 관리', url: '/base/position', category: 'BASE', desc: '직급 서열 및 명칭 관리', supportedActions: ['access', 'create', 'update', 'delete'] },
  { id: 'S_BASE_HOLIDAY', name: '공휴일 관리', url: '/base/holiday', category: 'BASE', desc: '법정 공휴일 및 회사 지정 휴일 등록/수정', supportedActions: ['access', 'create', 'update', 'delete'] },
  { id: 'S_BASE_VENDOR', name: '거래처 관리', url: '/base/vendor', category: 'BASE', desc: '협력업체 및 거래처 정보', supportedActions: ['access', 'create', 'update', 'delete'] },

  { id: 'S_BASE_CODE', name: '공통코드 정보', url: '/base/code', category: 'BASE', desc: '시스템 공통 코드 마스터', supportedActions: ['access', 'create', 'update', 'delete'] },
  { id: 'S_BASE_APFORM', name: '결재서식 관리', url: '/base/approval-form', category: 'BASE', desc: '전자결재 양식, 입력필드 및 룰 설정', supportedActions: ['access', 'create', 'update', 'delete'] },
  { id: 'S_BASE_APPROC', name: '결재 프로세스 설정', url: '/base/approval-process', category: 'BASE', desc: '부서합의, 전결규정 등 프로세스 옵션', supportedActions: ['access', 'create', 'update', 'delete'] },
  { id: 'S_BASE_APMON', name: '결재문서 모니터링', url: '/base/approval-monitor', category: 'BASE', desc: '전사 결재문서 전체 조회 및 감사', supportedActions: ['access', 'update'] },

  // 4. 시스템 관리 & 보안 감사 (8개)
  { id: 'S_SYS_AUTH', name: '그룹권한 관리', url: '/base/auth', category: 'SYS', desc: '역할 그룹 생성 및 메뉴/기능 권한 부여', supportedActions: ['access', 'create', 'update', 'delete'] },
  { id: 'S_SYS_MENU', name: '메뉴 관리', url: '/sys/menu', category: 'SYS', desc: '네비게이션 메뉴 구조 관리', supportedActions: ['access', 'create', 'update', 'delete'] },
  { id: 'S_SYS_LOG', name: '로그 관리', url: '/sys/log', category: 'SYS', desc: '시스템 접속 및 변경 감사 로그', supportedActions: ['access'] },
  { id: 'S_SYS_COMPANY', name: '회사 정보', url: '/sys/company', category: 'SYS', desc: '법인 정보 및 사업자 등록 정보', supportedActions: ['access', 'create', 'update', 'delete'] },
  { id: 'S_SYS_I18N', name: '다국어 관리', url: '/sys/i18n', category: 'SYS', desc: '다국어 라벨 및 언어 설정', supportedActions: ['access', 'create', 'update', 'delete'] },
  { id: 'S_SYS_ENV', name: '환경 설정', url: '/sys/env', category: 'SYS', desc: '시스템 전역 환경 변수 및 설정', supportedActions: ['access', 'update'] },
  { id: 'S_SYS_BACKUP', name: '데이터 백업', url: '/sys/backup', category: 'SYS', desc: '데이터베이스 백업 및 복원', supportedActions: ['access', 'create', 'update', 'delete'] },
  { id: 'S_SYS_IF', name: '인터페이스 관리', url: '/sys/interface', category: 'SYS', desc: '외부 시스템 연동 및 API 관리', supportedActions: ['access', 'create', 'update', 'delete'] },

  // 5. 영업 & 수주 관리 (3개)
  { id: 'S_SALES_QUOTE', name: '견적서 관리', url: '/sales/quote', category: 'SALES', desc: '영업 견적서 작성 및 관리', supportedActions: ['access', 'create', 'update', 'delete'] },
  { id: 'S_SALES_SO', name: '수주/주문서 입력', url: '/sales/order', category: 'SALES', desc: '수주 및 주문 등록 관리', supportedActions: ['access', 'create', 'update', 'delete'] },
  { id: 'S_SALES_SOSTAT', name: '주문서 현황', url: '/sales/order-status', category: 'SALES', desc: '주문서 진행 현황 및 집계', supportedActions: ['access', 'update'] },
];

/** 화면별 액션 플래그 스키마 (표준 4대 CRUD: access, create, update, delete) */
export const actionPermissionSchema = z.object({
  access: z.boolean().default(false),  // 화면 메뉴 노출 및 접근 (Read)
  create: z.boolean().default(false),  // 등록/작성 (Create)
  update: z.boolean().default(false),  // 수정 (Update)
  delete: z.boolean().default(false),  // 삭제 (Delete)
});

export type ActionPermission = z.infer<typeof actionPermissionSchema>;

const jsonArray = <T>(schema: z.ZodType<T>) =>
  z.preprocess((v) => {
    if (typeof v === 'string') {
      try {
        return JSON.parse(v);
      } catch {
        return [];
      }
    }
    return v;
  }, z.array(schema).nullish().transform((v) => v ?? []));

const jsonRecord = <T>(schema: z.ZodType<T>) =>
  z.preprocess((v) => {
    if (typeof v === 'string') {
      try {
        return JSON.parse(v);
      } catch {
        return {};
      }
    }
    return v;
  }, z.record(z.string(), schema).nullish().transform((v) => v ?? {}));

/** 역할 그룹(RoleGroup) 메인 스키마 */
export const roleGroupSchema = z.object({
  id: z.string().optional(),
  code: z.string().min(1, '역할그룹코드는 필수입니다'),
  name: z.string().min(1, '역할그룹명은 필수입니다'),
  desc: z.string().nullish().transform((v) => v ?? ''),
  use: z.boolean().nullish().transform((v) => v ?? true),
  isSystem: z.boolean().nullish().transform((v) => v ?? false),

  // 대상자 바인딩 (다중 대상 - 문자열 JSON 파싱 지원)
  userIds: jsonArray(z.string()),
  deptIds: jsonArray(z.string()),
  positionRanks: jsonArray(z.number()),

  // 화면별 권한 매트릭스 (key: screenId or url)
  menuPermissions: jsonRecord(actionPermissionSchema),

  // 레거시 하위호환용 필드
  members: jsonArray(memberSchema),
  permissions: z.any().optional(),
});

export const roleMappingSchema = z.object({
  id: z.string().optional(),
  $id: z.string().optional(),
  roleCode: z.string().min(1, '역할그룹코드는 필수입니다'),
  targetType: z.preprocess(
    (v) => (typeof v === 'string' ? v.toUpperCase() : v),
    z.enum(['USER', 'DEPT', 'POSITION'])
  ),
  targetId: z.string().min(1, '대상 식별자는 필수입니다'),
  targetName: z.string().nullish().transform((v) => v ?? ''),
});

export type Member = z.infer<typeof memberSchema>;
export type RoleGroup = z.infer<typeof roleGroupSchema>;
export type RoleMapping = z.infer<typeof roleMappingSchema>;
