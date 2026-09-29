import type { FlatScreen } from '@/shared/types/menu';

/**
 * 그룹웨어 앱 메타 — 도크 전용(menu-tree 밖) 화면의 단일 소스.
 * 탭 합성(gwScreen)·미구현 랜딩(GwComingSoon)·도크가 공유한다.
 * ([[groupware-feature]] 진입 방식 A: 각 앱 = 본문 전체화면 라우트)
 */
export interface GwAppMeta {
  name: string;
  icon: string;
  desc: string;
}

export const GW_APP_META: Record<string, GwAppMeta> = {
  orgchart: { name: '조직도', icon: '🏢', desc: '부서 계층과 사원 배치·상급자 관계를 조회합니다.' },
  approval: { name: '전자결재', icon: '🖋️', desc: '기안·품의·지출결의 등 사내 문서의 승인 과정을 온라인으로 처리합니다.' },
  leave: { name: '근태·휴가', icon: '⏱️', desc: '출퇴근 기록 및 개인 연차·휴가 잔여 조회와 신청 내역을 통합 관리합니다.' },
  calendar: { name: '캘린더', icon: '📅', desc: '전사·개인 일정 캘린더: 임직원 주요 일정 및 사내 일정(외근, 출장, 회의, 행사)을 캘린더에서 종합 확인하고 조율합니다.' },
  mail: { name: '메일', icon: '✉️', desc: '사내·외부 비즈니스 소통을 주고받는 사내 메일 시스템입니다.' },
  resource: { name: '자원예약', icon: '📦', desc: '회의실·차량·공용 장비의 사용 시간을 예약·관리합니다.' },
  survey: { name: '전자설문', icon: '📋', desc: '임직원 대상 의견 수렴·만족도 조사를 비대면으로 진행합니다.' },
  board: { name: '게시판', icon: '📌', desc: '전사 공지·경조사·사내 규정 등을 게시하고 확인합니다.' },
  community: { name: '커뮤니티', icon: '💬', desc: '동호회·소모임 등 임직원 간 자유로운 소통 공간입니다.' },
  document: { name: '문서관리', icon: '🗂️', desc: '매뉴얼·서식·산출물 등 중요 문서를 분류·보관하는 문서고입니다.' },
  employee: { name: '인명관리', icon: '👥', desc: '임직원·외부 거래처 연락처를 검색·관리하는 주소록입니다.' },
  task: { name: '프로젝트', icon: '📗', desc: '회사 전체 단위 프로젝트의 시작부터 마무리까지 유기적인 협업과 진행을 관리합니다.' },
  'work-plan': { name: '업무계획', icon: '🗓️', desc: '개인 업무 계획 & 실무 로스터: 직원별 일일 업무 계획(To-Do) 작성 및 부서별 일일 실무 진행 현황을 공유합니다.' },
  commute: { name: '근태·휴가', icon: '⏱️', desc: '출퇴근 기록 및 개인 연차·휴가 잔여 조회와 신청 내역을 통합 관리합니다.' },
  gallery: { name: '회사 갤러리', icon: '🖼️', desc: '사내 행사, 전사 이벤트 및 프로젝트 활동 기록을 공유하는 회사 갤러리입니다.' },
};

/**
 * 실제 화면이 연결된 앱 — 도크 타일 활성화와 `App.tsx` 라우트가 같은 목록을 본다.
 *
 * 여기 없는 앱은 `/gw/:app` 폴백으로 빠져 `GwComingSoon` 랜딩이 뜬다. 도크에 하드코딩된
 * 목록을 따로 두면 화면을 만들고도 회색 타일로 남는 일이 생겨 한곳에 모은다.
 */
export const GW_READY_APPS = new Set([
  'orgchart',
  'approval',
  'leave',
  'board',
  'community',
  'calendar',
  'resource',
  // 'task', // 프로젝트 - 준비중 비활성화
  'survey',
  'gallery',
  // 메일 - 준비중 비활성화
  // 'mail',
  'employee', // 인명관리 활성화
  'document', // 문서관리 활성화
  /*
    근태 — 브라우저 직접 조회(401)는 `caps-ingest` Function 경유로 해결했다(2026-08-25).

    ⚠ **운영에 내보내기 전에 두 가지가 선행돼야 한다.** 안 하면 운영에서 빈 화면이 된다.
      1) `npx tsx scripts/appwrite-provision-commute.ts --prod` — 컬렉션 5종이 아직 없다
      2) `node scripts/deploy-caps-ingest.mjs --prod` — 함수가 아직 안 올라가 있다
    그리고 에이전트가 운영으로 쏘기 시작해야(`CAPS_INGEST_SECRET` + IngestUrl 전환)
    데이터가 쌓인다. 그전까지는 열려도 0건이다.
  */
  'commute',
  // 업무계획 — workPlans 컬렉션 dev 프로비저닝 완료(2026-08-26). 운영은 아직.
  'work-plan',
  // 라우트 없이 여기 먼저 올리면 도크 타일이 켜진 채 GwComingSoon으로 떨어진다.
]);

export const isGwAppReady = (slug: string) => GW_READY_APPS.has(slug);

/** 그룹웨어 앱 라우트 여부. */
export const isGwUrl = (url: string) => url.startsWith('/gw/');

/**
 * 그룹웨어 라우트(/gw/<slug>) → 탭용 FlatScreen 합성. 미지의 slug 는 '그룹웨어'로 폴백.
 * MES 화면과 동일한 탭 모델로 다루기 위해 moduleId/group 을 'gw'로 채운다.
 */
export function gwScreen(url: string): FlatScreen | null {
  if (!isGwUrl(url)) return null;
  const slug = url.slice('/gw/'.length).split('/')[0];
  const meta = GW_APP_META[slug] ?? { name: '그룹웨어', icon: '▦', desc: '' };
  return {
    id: `gw:${slug}`,
    name: meta.name,
    url,
    icon: meta.icon,
    moduleId: 'gw',
    moduleName: '그룹웨어',
    groupId: 'gw',
    groupName: '그룹웨어',
  };
}
