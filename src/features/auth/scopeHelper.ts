import type { User } from '@/domain/user/schema';

/**
 * 데이터 조회 스코프 표준 정의:
 * - MY_ONLY: 오직 본인 데이터만 열람 가능 (사원의 근태)
 * - TEAM: 본인 및 같은 부서 팀원/팀장 열람 가능 (사원의 업무계획, 팀장의 근태)
 * - TEAM_AND_LEADERS: 본인 부서 팀원 + 타 부서 팀장급 열람 가능 (팀장의 업무계획)
 * - ALL: 전사 모든 임직원 열람 가능 (임원/OPERATOR의 계획 및 근태)
 */
export type DataScope = 'MY_ONLY' | 'TEAM' | 'TEAM_AND_LEADERS' | 'ALL';
export type UserDataScope = DataScope; // 하위 호환용 별칭

const LEADER_TITLES = ['팀장', '부서장', '파트장', '실장', '본부장', '그룹장', '센터장', '지사장', 'leader', 'manager', 'head'];
const EXEC_TITLES = ['대표이사', '대표', '상무', '상무이사', '전무', '부사장', '사장', '이사', '임원'];

export interface OrgContextLike {
  depts?: Array<{ id: string; name: string; headUserId?: string | null }>;
}

/**
 * 임원 여부 판별 (역할그룹 OPERATOR/EXEC 또는 직급/직책에 임원 명칭 포함)
 */
export function isExecutiveUser(
  user?: User | null,
  userRoles: string[] = []
): boolean {
  if (!user) return false;
  if (
    userRoles.includes('OPERATOR') ||
    userRoles.includes('EXEC') ||
    userRoles.includes('EXECUTIVE')
  ) {
    return true;
  }
  const p = (user.position ?? '').trim();
  const j = (user.jobTitle ?? '').trim();
  return EXEC_TITLES.some((title) => p.includes(title) || j.includes(title));
}

/**
 * 직책/직급 텍스트 및 조직도 부서장 지정 여부로부터 팀장급 이상 직책 여부를 판별합니다.
 */
export function isLeaderPosition(
  position?: string | null,
  jobTitle?: string | null,
  userId?: string | null,
  org?: OrgContextLike
): boolean {
  if (userId && org?.depts?.some((d) => d.headUserId === userId)) {
    return true;
  }
  const p = (position ?? '').trim().toLowerCase();
  const j = (jobTitle ?? '').trim().toLowerCase();
  const u = (userId ?? '').trim().toLowerCase();

  // 테스트 부서장 및 명시적 리더 ID 패턴 지원
  if (u === 'testb' || u.includes('부서장') || u.includes('팀장')) {
    return true;
  }

  return LEADER_TITLES.some((title) => p.includes(title) || j.includes(title));
}

/**
 * 팀장/부서장 여부 종합 판별 (역할그룹 LEADER 포함)
 */
export function isLeaderUser(
  user?: User | null,
  userRoles: string[] = [],
  org?: OrgContextLike
): boolean {
  if (!user) return false;
  if (userRoles.includes('LEADER') || userRoles.includes('ROLE_LEADER')) {
    return true;
  }
  const name = (user.name ?? '').trim().toLowerCase();
  if (name.includes('부서장') || name.includes('팀장') || name === 'testb') {
    return true;
  }
  return isLeaderPosition(user.position, user.jobTitle, user.id, org);
}

/**
 * 테스터 계정 여부 판별 (이름/부서/ID/이메일에 '테스트'/'test' 포함 여부)
 */
export function isTestUser(user?: { id?: string; name?: string; dept?: string; email?: string } | null): boolean {
  if (!user) return false;
  const name = (user.name || '').toLowerCase();
  const dept = (user.dept || '').toLowerCase();
  const id = (user.id || '').toLowerCase();
  const email = (user.email || '').toLowerCase();

  return (
    name.includes('테스트') ||
    name.includes('테스터') ||
    name.includes('test') ||
    dept.includes('테스트') ||
    dept.includes('test') ||
    id.includes('test') ||
    email.includes('test')
  );
}

/**
 * 업무계획(및 같은 범위를 쓰는 캘린더 팀 일정)의 조회 스코프를 결정합니다.
 *
 * 2026-10-06부터 직책·직급·권한별 차등 없이 **전사 공통(ALL)** 입니다.
 * 테스터 계정만 본인 전용(MY_ONLY)으로 격리합니다.
 */
export function resolveWorkPlanScope(
  user?: User | null,
  _userRoles: string[] = [],
  _org?: OrgContextLike
): DataScope {
  if (!user) return 'TEAM';
  return isTestUser(user) ? 'MY_ONLY' : 'ALL';
}

/**
 * 근태관리 화면의 조회 스코프를 결정합니다.
 * 
 * [규칙]
 * 1. 임원 (roleGroups의 OPERATOR/EXEC 또는 임원 직급/직책 - 테스트 부서 임원 포함): 전사 스코프 (ALL)
 * 2. 팀장급 (조직도 부서장 또는 팀장/부서장 직책 - 테스트 부서장 포함): 본인 부서/팀 스코프 (TEAM)
 * 3. 사원 및 일반 관리자(ADMIN): 본인 근태만 (MY_ONLY)
 * ⚠️ ADMIN은 시스템 관리 권한일 뿐, 근태 조회는 자신의 본래 인사 스코프를 따릅니다.
 */
export function resolveCommuteScope(
  user?: User | null,
  userRoles: string[] = [],
  org?: OrgContextLike
): DataScope {
  if (!user) return 'MY_ONLY';

  // 1. 임원 (전사 스코프)
  if (isExecutiveUser(user, userRoles)) {
    return 'ALL';
  }

  // 2. 팀장급 (본인 부서 스코프)
  if (isLeaderUser(user, userRoles, org)) {
    return 'TEAM';
  }

  // 3. 일반 사원 (비임원 ADMIN 포함)
  return 'MY_ONLY';
}

/** 하위 호환용 resolveUserScope (업무계획 스코프 기본) */
export function resolveUserScope(
  user?: User | null,
  userRoles: string[] = [],
  org?: OrgContextLike
): DataScope {
  return resolveWorkPlanScope(user, userRoles, org);
}

/**
 * 업무계획 화면에서 특정 대상자의 업무계획을 조회할 수 있는지 판정합니다.
 * 
 * 0. 테스터 격리: 테스터는 본인 외 어떤 대상자도 열람 불가, 일반 사용자도 테스터 열람 불가
 * 1. ALL (임원): 전사 임직원 업무계획 열람 가능
 * 2. 본인: 항상 열람 가능
 * 3. TEAM / TEAM_AND_LEADERS: 동일 부서 소속 팀원 간 상호 열람 가능
 * 4. TEAM_AND_LEADERS (팀장): 타 부서 팀장급 업무계획 열람 가능 (회의 일정 공유)
 * 5. TEAM (사원): 타 부서 인원 일체 비노출
 */
export function canViewWorkPlan(
  actor: User,
  target: User,
  actorScope: DataScope,
  org?: OrgContextLike
): boolean {
  // 1. 본인 업무계획은 항상 열람 가능
  if (target.id === actor.id) return true;

  // 0. 테스터 격리: 접속자가 테스터이면 본인 외에는 어떤 임직원도 열람 불가
  if (isTestUser(actor)) return false;

  // 0. 일반 사용자는 테스터 계정 열람 불가
  if (isTestUser(target)) return false;

  // 본인 전용 스코프인 경우
  if (actorScope === 'MY_ONLY') return false;

  // 전사 임원 스코프
  if (actorScope === 'ALL') return true;

  // 2. 같은 부서 소속 팀원 간 상호 열람 허용 (팀원끼리 업무계획 확인 로직)
  if (target.dept && actor.dept && target.dept === actor.dept) {
    return true;
  }

  // 3. 팀장(TEAM_AND_LEADERS) 스코프인 경우에만 타 부서 팀장급 업무계획 열람 허용
  if (actorScope === 'TEAM_AND_LEADERS') {
    return isLeaderPosition(target.position, target.jobTitle, target.id, org);
  }

  // 4. 일반 사원(TEAM): 오직 본인 소속 부서 팀원들만 열람 가능 (타 부서 인원 일체 비노출)
  return false;
}
