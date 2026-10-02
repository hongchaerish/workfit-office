import type { MenuNode } from '@/shared/types/menu';

/**
 * 메뉴 트리 (모듈 → 그룹 → 화면) — 와이어프레임 `mes layout/mes/menu-tree.js` 정본 이관.
 * 8개 모듈 / 약 40개 그룹 / 약 170개 화면. 상단 모듈 내비·좌측 사이드바·라우팅이 공유.
 */
export const MENU_TREE: MenuNode[] = [
  /* ── 경영 현황 (로그인 후 랜딩, 운영 현황 통합) ── */
  {
    id: 'M_EXEC', name: '경영 현황', icon: '▦', order: 5, use: true, children: [
      {
        id: 'G_EXEC_DASH', name: '대시보드', icon: '▦', order: 10, use: true, children: [
          { id: 'S_EXEC_DASH', name: '경영 대시보드', url: '/exec', icon: '▦', order: 10, use: true },
        ]
      },
    ]
  },


  /* ── 영업 관리 ── */
  {
    id: 'M_SALES', name: '영업 관리', icon: '₩', order: 25, use: true, children: [
      {
        id: 'G_SALES_ORDER', name: '영업수주 관리', icon: '✎', order: 10, use: true, children: [
          { id: 'S_SALES_QUOTE', name: '견적서 입력/관리', url: '/sales/quote', icon: '✎', order: 10, use: true },
          { id: 'S_SALES_SO', name: '수주/주문서 입력', url: '/sales/order', icon: '⊞', order: 20, use: true },
          { id: 'S_SALES_SOSTAT', name: '주문서 현황', url: '/sales/order-status', icon: '◷', order: 30, use: true },
        ]
      },
    ]
  },
  /* ── 퀵 도크 (그룹웨어, Widdy, 메신저) ── */
  { id: 'M_GW', name: '그룹웨어', icon: '🌐', order: 80, use: true, children: [] },
  { id: 'M_WIDDY', name: 'Widdy', icon: '✦', order: 85, use: true, children: [] },
  { id: 'M_MSG', name: '메신저', icon: '👤', order: 90, use: true, children: [] },

  /* ── 기준 정보 ── */
  {
    id: 'M_BASE', name: '기준 정보', icon: '▤', order: 20, use: true, children: [
      {
        id: 'G_BASE_USER', name: '사용자/권한', icon: '◫', order: 10, use: true, children: [
          { id: 'S_BASE_USER', name: '사용자관리', url: '/base/user', icon: '◫', order: 10, use: true },
          { id: 'S_BASE_VENDOR', name: '거래처관리', url: '/base/vendor', icon: '◫', order: 20, use: true },
          { id: 'S_BASE_AUTH', name: '그룹권한관리', url: '/base/auth', icon: '◫', order: 30, use: true },
        ]
      },
      {
        id: 'G_BASE_ORG', name: '조직·결재 기준정보', icon: '◫', order: 15, use: true, children: [
          { id: 'S_BASE_DEPT', name: '부서/조직관리', url: '/base/department', icon: '▤', order: 10, use: true },
          { id: 'S_BASE_POSITION', name: '직급관리', url: '/base/position', icon: '◫', order: 20, use: true },
          { id: 'S_BASE_HOLIDAY', name: '공휴일 관리', url: '/base/holiday', icon: '📅', order: 25, use: true },
          { id: 'S_BASE_APRULE', name: '결재선 규칙관리', url: '/base/approval-rule', icon: '⚖', order: 30, use: true },
          { id: 'S_BASE_APPROC', name: '결재 프로세스 설정', url: '/base/approval-process', icon: '⚙', order: 35, use: true },
          { id: 'S_BASE_APFORM', name: '결재서식 관리', url: '/base/approval-form', icon: '📄', order: 40, use: true },
          { id: 'S_BASE_APMON', name: '결재문서 모니터링', url: '/base/approval-monitor', icon: '🔍', order: 50, use: true },

        ]
      },
      {
        id: 'G_BASE_MASTER', name: '마스터 정보', icon: '▦', order: 20, use: true, children: [
          { id: 'S_BASE_CODE', name: '공통코드정보', url: '/base/code', icon: '⌗', order: 10, use: true },
        ]
      },
      {
        id: 'G_SYS_MGMT', name: '시스템 관리', icon: '⚙', order: 40, use: true, children: [
          { id: 'S_SYS_MENU', name: '메뉴 관리', url: '/sys/menu', icon: '▦', order: 10, use: true },
          { id: 'S_SYS_LOG', name: '로그 관리', url: '/sys/log', icon: '◷', order: 20, use: true },
        ]
      },
      {
        id: 'G_SYS_GLOBAL', name: '글로벌/운영', icon: '⌗', order: 50, use: true, children: [
          { id: 'S_SYS_COMPANY', name: '회사 정보', url: '/sys/company', icon: '◎', order: 5, use: true },
          { id: 'S_SYS_I18N', name: '다국어 관리', url: '/sys/i18n', icon: '⌗', order: 10, use: true },
          { id: 'S_SYS_ENV', name: '환경 설정', url: '/sys/env', icon: '⚙', order: 30, use: true },
          { id: 'S_SYS_BACKUP', name: '데이터 백업', url: '/sys/backup', icon: '⛁', order: 40, use: true },
          { id: 'S_SYS_IF', name: '인터페이스 관리', url: '/sys/interface', icon: '⇄', order: 50, use: true },
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
