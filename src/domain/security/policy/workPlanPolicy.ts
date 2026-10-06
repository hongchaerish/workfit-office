import type { DataScope, SecurityContext } from '../types';

/**
 * 업무계획(To-Do / 실적) 도메인 접근 정책 (WorkPlanPolicy)
 * 
 * [원칙] 2026-10-06부터 직책·직급·권한별 차등 없이 누구나 전사 업무계획을 본다.
 */
export const workPlanPolicy = {
  /**
   * 업무계획 종합 현황 메뉴 접근 권한 판정
   * - 기본 직책 규칙: 팀장(isLeader) 또는 임원(isExecutive)은 자동으로 메뉴 열림 (권한그룹 생성 불필요)
   * - 커스텀 확장 규칙: 일반 사원이라도 그룹권한관리에서 체크된 경우(예: 추후 신설될 인사팀 등) 열림
   */
  canAccessWorkPlanAdmin(context: SecurityContext): boolean {
    // 2026-10-06: 보기 권한 전사 통일 — 사용 중인 계정이면 누구나 연다.
    return Boolean(context.user);
  },

  /**
   * 업무계획 데이터 조회 스코프 — 직책·직급·권한과 무관하게 전사(ALL). (2026-10-06)
   */
  getScope(context: SecurityContext): DataScope {
    return context.user ? 'ALL' : 'TEAM';
  },

  /**
   * 팀원 업무계획 모니터링 관리 권한 여부
   */
  canManageTeamWorkPlan(context: SecurityContext): boolean {
    return this.canAccessWorkPlanAdmin(context);
  },

  /**
   * 특정 사용자의 업무계획을 열람할 수 있는지 여부
   */
  canViewUser(
    context: SecurityContext,
    targetUser: { id: string; dept?: string | null; position?: string | null; isLeader?: boolean }
  ): boolean {
    if (!context.user) return false;
    if (context.userId === targetUser.id) return true;

    const scope = this.getScope(context);
    if (scope === 'ALL') return true;

    // 소속 부서원인 경우
    if (context.organization.isSameDept(targetUser.dept)) return true;

    // TEAM_AND_LEADERS 스코프인 경우 타 부서 팀장급도 열람 가능
    if (scope === 'TEAM_AND_LEADERS' && targetUser.isLeader) {
      return true;
    }

    return false;
  },
};
