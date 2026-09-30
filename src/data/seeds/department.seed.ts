import type { Department } from '@/domain/department/schema';

/**
 * 부서 시드 — Firebase 미설정 시 폴백 + 초기 seed 소스.
 * Workfit Office 실제 조직도(대표이사 → 대표이사 직속 / AX사업본부 → 산하 팀).
 * name 은 user.seed 의 dept 문자열과 정확히 일치. headUserId 는 부서장(팀장/본부장) 역할
 * 사용자로 합의·전결 라우팅에 사용. 조직도 상 '충원(공석)' 자리는 실명자 미등록으로 제외.
 */
export const DEPARTMENT_SEED: Department[] = [
  // 1. 최상위 — 대표이사
  { id: 'D100', name: '대표이사', parentId: null, headUserId: 'U001', deptType: '본사', order: 1 },
  // 2. 직속 위원회 / 팀 / 연구소 (대표이사 직속 산하)
  { id: 'D120', name: '기술경영전략위원회', parentId: 'D100', headUserId: null, deptType: '본사', order: 2 },
  { id: 'D130', name: '경영기획팀', parentId: 'D100', headUserId: null, deptType: '본사', order: 3 },
  { id: 'D250', name: '부설기술연구소', parentId: 'D100', headUserId: 'U003', deptType: '본사', order: 4 },
  // 3. AX지능화본부
  { id: 'D200', name: 'AX지능화본부', parentId: 'D100', headUserId: 'U003', deptType: '본사', order: 5 },
  // 4. AX지능화본부 산하 팀
  { id: 'D210', name: '품질심사팀', parentId: 'D200', headUserId: 'U006', deptType: '본사', order: 6 },
  { id: 'D220', name: 'AX 솔루션컨설팅팀', parentId: 'D200', headUserId: 'U008', deptType: '본사', order: 7 },
  { id: 'D230', name: 'AX PMO팀', parentId: 'D200', headUserId: 'U009', deptType: '본사', order: 8 },
  { id: 'D240', name: '데이터플랫폼 개발팀', parentId: 'D200', headUserId: 'U011', deptType: '본사', order: 9 },
];
