import type { DataScope, SecurityContext } from '../types';

/**
 * 근태·휴가 도메인 접근 정책 (CommutePolicy)
 * 
 * [원칙]
 * 1. 임원 (EXECUTIVE) 또는 인사관리자 (HR_ADMIN / OPERATOR): 전사 스코프 (ALL)
 * 2. 부서장 (isLeader / isDeptHead): 본인 소속 부서 스코프 (TEAM)
 * 3. 일반 사원: 본인 데이터 스코프 (MY_ONLY)
 * ⚠️ 시스템 설정 최고관리자(SUPER_ADMIN)라도 비임원/비인사인 경우 개인 근태 열람은 본인 스코프를 따릅니다.
 */
export const commutePolicy = {
  /**
   * 근태/휴가 관제 센터 메뉴 접근 권한 판정
   * - 기본 직책 규칙: 팀장(isLeader) 또는 임원(isExecutive)은 자동으로 메뉴 열림 (권한그룹 생성 불필요)
   * - 커스텀 확장 규칙: 일반 사원이라도 그룹권한관리에서 체크된 경우(예: 추후 신설될 인사팀 등) 열림
   */
  canAccessCommuteAdmin(context: SecurityContext): boolean {
    if (!context.user) return false;
    // ⚠️ 최고관리자(isSuperAdmin)라도 비임원/비팀장인 개발자는 전사 인사/근태 관제 자동 오픈에서 제외 (임원/팀장/인사위임자 전용)
    if (context.isExecutive) return true;
    if (context.isLeader || context.organization.isDeptHead(context.dept)) return true;
    return (
      context.canMenuAccess('S_GW_COMMUTE_ADMIN') ||
      context.canMenuAccess('/gw/commute/admin')
    );
  },

  /**
   * 근태/휴가 데이터 조회 스코프 도출
   */
  getScope(context: SecurityContext): DataScope {
    if (!context.user) return 'MY_ONLY';

    // 1. 임원 또는 HR 관리자 / 운영자 / 그룹권한관리에서 직접 관제 권한을 부여받은 비팀장(인사담당자 등) -> 전사 스코프 (ALL)
    if (
      context.isExecutive ||
      context.roles.includes('HR_ADMIN') ||
      context.roles.includes('OPERATOR') ||
      (!context.isLeader && (
        context.canMenuAccess('S_GW_COMMUTE_ADMIN') ||
        context.canMenuAccess('/gw/commute/admin')
      ))
    ) {
      return 'ALL';
    }

    // 2. 부서장 / 팀장 -> 소속 부서 스코프 (TEAM)
    if (context.isLeader || context.organization.isDeptHead(context.dept)) {
      return 'TEAM';
    }

    // 3. 일반 사원 (비임원 SUPER_ADMIN 포함) -> 본인 스코프 (MY_ONLY)
    return 'MY_ONLY';
  },

  /**
   * 전사/부서 근태 관리 권한(관제 탭 활성화 여부)
   */
  canManageCommute(context: SecurityContext): boolean {
    return this.canAccessCommuteAdmin(context);
  },

  /**
   * 근태 정책(근무제, 출퇴근 인정시간 등) 관리/수정 권한
   */
  canManagePolicy(context: SecurityContext): boolean {
    if (!context.user) return false;
    return (
      context.isSuperAdmin ||
      context.isExecutive ||
      context.roles.includes('OPERATOR') ||
      context.roles.includes('HR_ADMIN')
    );
  },

  /**
   * 특정 사원의 근태 기록을 열람할 수 있는지 여부 판정
   */
  canViewEmployee(
    context: SecurityContext,
    targetEmployee: { name?: string | null; dept?: string | null }
  ): boolean {
    if (!context.user) return false;

    // 본인 데이터는 항상 열람 가능
    const targetName = (targetEmployee.name || '').trim().replace(/\s+/g, '');
    const myName = (context.name || '').trim().replace(/\s+/g, '');
    if (targetName && targetName === myName) return true;

    const scope = this.getScope(context);
    if (scope === 'ALL') return true;
    if (scope === 'TEAM') {
      return context.organization.isSameDept(targetEmployee.dept);
    }
    return false;
  },

  /**
   * 근태 관리 제외 대상 여부 판정
   * - 인명관리의 [근태 관리 대상 ON/OFF] 스위치에 의해 결정 (isAttendanceTarget === false 인 경우 제외)
   */
  isNonAttendanceTarget(info?: {
    isAttendanceTarget?: boolean | null;
  } | null): boolean {
    if (!info) return false;
    return info.isAttendanceTarget === false;
  },
};
