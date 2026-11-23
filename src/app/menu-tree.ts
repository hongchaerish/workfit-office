import type { MenuNode } from '@/shared/types/menu';

/**
 * 메뉴 트리 (모듈 → 그룹 → 화면) — 와이어프레임 `mes layout/mes/menu-tree.js` 정본 이관.
 * 8개 모듈 / 약 40개 그룹 / 약 170개 화면. 상단 모듈 내비·좌측 사이드바·라우팅이 공유.
 */
export const MENU_TREE: MenuNode[] = [
  /* ── 홈 (로그인 후 랜딩) — 상단 '홈'을 누르면 펼침 메뉴 없이 바로 /exec ── */
  {
    id: 'M_EXEC', name: '홈', icon: 'home', order: 5, use: true, children: [
      {
        id: 'G_EXEC_DASH', name: '대시보드', icon: '▦', order: 10, use: true, children: [
          { id: 'S_EXEC_DASH', name: '홈', url: '/exec', icon: 'home', order: 10, use: true },
        ]
      },
    ]
  },


  /* ── 사업관리 — 기업 정보(도입·매입)와 사업(프로젝트)을 관리 ── */
  {
    id: 'M_BIZ', name: '사업관리', icon: '▣', order: 25, use: true, children: [
      {
        id: 'G_BIZ_PARTNER', name: '기업', icon: '▤', order: 10, use: true, children: [
          { id: 'S_BIZ_VENDOR', name: '기업 정보', url: '/biz/vendor', icon: '▤', order: 10, use: true },
        ]
      },
      {
        id: 'G_BIZ_PROJECT', name: '사업 관리', icon: '⊞', order: 20, use: true, children: [
          { id: 'S_BIZ_PROJECT', name: '사업 현황', url: '/biz/project', icon: '⊞', order: 10, use: true },
          { id: 'S_BIZ_PO', name: '발주 현황', url: '/biz/po', icon: '▦', order: 20, use: true },
          { id: 'S_BIZ_PURCHASE', name: '매입 결제 관리', url: '/biz/purchase', icon: '₩', order: 25, use: true },
        ]
      },
    ]
  },

  /* ── 영업 관리 — 숨김(2026-10-20, 사업관리로 대체). 라우트·권한 목록에서도 빠져 데이터와 연결되지 않는다 ── */
  {
    id: 'M_SALES', name: '영업 관리', icon: '₩', order: 26, use: false, children: [
      {
        id: 'G_SALES_ORDER', name: '영업수주 관리', icon: '✎', order: 10, use: false, children: [
          { id: 'S_SALES_QUOTE', name: '견적서 입력/관리', url: '/sales/quote', icon: '✎', order: 10, use: false },
          { id: 'S_SALES_SO', name: '수주/주문서 입력', url: '/sales/order', icon: '⊞', order: 20, use: false },
          { id: 'S_SALES_SOSTAT', name: '주문서 현황', url: '/sales/order-status', icon: '◷', order: 30, use: false },
        ]
      },
    ]
  },
  /* ── 퀵 도크 (그룹웨어, Widdy, 메신저) ── */
  { id: 'M_GW', name: '그룹웨어', icon: '🌐', order: 80, use: true, children: [] },
  { id: 'M_WIDDY', name: 'Widdy', icon: '✦', order: 85, use: true, children: [] },
  { id: 'M_MSG', name: '메신저', icon: '👤', order: 90, use: true, children: [] },

  /*
   * ── 관리자 콘솔(기준 정보) — 업무 화면과 따로 된 /admin 페이지에만 나온다(area: 'admin').
   * 영역별 묶음은 상용 그룹웨어 관리자 페이지처럼 구성원·권한·전자결재·회사·시스템 순. 화면 id·주소는 그대로(권한 설정 호환).
   */
  {
    id: 'M_BASE', name: '관리자 콘솔', icon: '▤', order: 20, use: true, area: 'admin', children: [
      {
        id: 'G_ADM_MEMBER', name: '구성원·조직', icon: '◫', order: 10, use: true, children: [
          { id: 'S_BASE_USER', name: '사용자 관리', url: '/base/user', icon: '◫', order: 10, use: true },
          { id: 'S_ADM_HR', name: '인사 정보', url: '/base/hr', icon: '👥', order: 15, use: true },
          { id: 'S_BASE_DEPT', name: '부서·조직 관리', url: '/base/department', icon: '▤', order: 20, use: true },
          { id: 'S_BASE_POSITION', name: '직급·직책 관리', url: '/base/position', icon: '◫', order: 30, use: true },
          // 사업관리 > 도입기업 정보로 옮김(같은 vendors 데이터). 숨김.
          { id: 'S_BASE_VENDOR', name: '거래처관리', url: '/base/vendor', icon: '◫', order: 90, use: false },
        ]
      },
      {
        id: 'G_ADM_AUTH', name: '권한', icon: '◫', order: 20, use: true, children: [
          { id: 'S_ADM_ROLE', name: '역할 관리', url: '/base/authz/roles', icon: '◫', order: 10, use: true },
          { id: 'S_ADM_ASSIGN', name: '역할 지정', url: '/base/authz/assign', icon: '◫', order: 20, use: true },
          { id: 'S_ADM_PEOPLE', name: '사람별 권한', url: '/base/authz/people', icon: '◫', order: 30, use: true },
          { id: 'S_BASE_AUTH', name: '그룹 권한 관리', url: '/base/auth', icon: '◫', order: 90, use: true },
        ]
      },
      {
        id: 'G_ADM_APPROVAL', name: '전자결재', icon: '⚖', order: 30, use: true, children: [
          { id: 'S_BASE_APFORM', name: '결재서식 관리', url: '/base/approval-form', icon: '📄', order: 10, use: true },
          { id: 'S_BASE_APRULE', name: '결재선 규칙', url: '/base/approval-rule', icon: '⚖', order: 20, use: true },
          { id: 'S_BASE_APPROC', name: '결재 프로세스 설정', url: '/base/approval-process', icon: '⚙', order: 30, use: true },
          { id: 'S_BASE_APMON', name: '결재문서 모니터링', url: '/base/approval-monitor', icon: '🔍', order: 40, use: true },
        ]
      },
      {
        id: 'G_ADM_LEAVE', name: '근태·휴가', icon: '⏱', order: 35, use: true, children: [
          { id: 'S_ADM_LEAVE', name: '연차 관리', url: '/base/leave', icon: '📅', order: 10, use: true },
          { id: 'S_ADM_COMMUTE_POLICY', name: '근무 정책', url: '/base/commute-policy', icon: '⏱', order: 20, use: true },
        ]
      },
      {
        id: 'G_ADM_COMPANY', name: '회사·운영', icon: '◎', order: 40, use: true, children: [
          { id: 'S_SYS_COMPANY', name: '회사 정보', url: '/sys/company', icon: '◎', order: 10, use: true },
          { id: 'S_BASE_HOLIDAY', name: '공휴일 관리', url: '/base/holiday', icon: '📅', order: 20, use: true },
          { id: 'S_ADM_RESOURCE', name: '자원 관리', url: '/base/resource', icon: '📦', order: 25, use: true },
          { id: 'S_BASE_CODE', name: '공통코드', url: '/base/code', icon: '⌗', order: 30, use: true },
          { id: 'S_ADM_COMPANY_CLASS', name: '기업분류', url: '/base/company-class', icon: '◫', order: 40, use: true },
          { id: 'S_ADM_BIZ_CATEGORY', name: '사업구분', url: '/base/biz-category', icon: '⌗', order: 45, use: true },
        ]
      },
      {
        id: 'G_ADM_SYSTEM', name: '시스템', icon: '⚙', order: 50, use: true, children: [
          { id: 'S_SYS_LOG', name: '로그 관리', url: '/sys/log', icon: '◷', order: 10, use: true },
          { id: 'S_SYS_BACKUP', name: '데이터 백업', url: '/sys/backup', icon: '⛁', order: 20, use: true },
          { id: 'S_SYS_IF', name: '인터페이스 관리', url: '/sys/interface', icon: '⇄', order: 30, use: true },
          { id: 'S_SYS_MENU', name: '메뉴 관리', url: '/sys/menu', icon: '▦', order: 80, use: false },
          { id: 'S_SYS_I18N', name: '다국어 관리', url: '/sys/i18n', icon: '⌗', order: 85, use: false },
          { id: 'S_SYS_ENV', name: '환경 설정', url: '/sys/env', icon: '⚙', order: 90, use: false },
        ]
      },
    ]
  }

];

/** 모듈의 첫 화면 URL (상단 내비 클릭 시 진입점). */
export function moduleEntryUrl(mod: MenuNode): string {
  return mod.children?.[0]?.children?.[0]?.url ?? '/';
}

/** 모듈의 경로 prefix (예: '/prod'). 현재 활성 모듈 판별에 사용. */
export function modulePrefix(mod: MenuNode): string {
  const first = moduleEntryUrl(mod);
  return '/' + first.split('/')[1];
}
