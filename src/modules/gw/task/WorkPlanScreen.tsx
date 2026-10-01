import { useMemo, useState, useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/app/auth/AuthProvider';
import { usePermission } from '@/features/auth/usePermission';
import { resolveWorkPlanScope, canViewWorkPlan, isLeaderPosition, isTestUser } from '@/features/auth/scopeHelper';
import { calendarToday, isValidCalendarDate } from '@/domain/calendarEvent/calendarDate';
import type { WorkPlan } from '@/domain/workPlan/schema';
import type { User } from '@/domain/user/schema';
import { useUsers } from '@/features/user/useUsers';
import { useOrgTree } from '@/features/gw/useOrgTree';
import {
  useCreateWorkPlan,
  useRemoveWorkPlan,
  useUpdateWorkPlan,
} from '@/features/workPlan/useWorkPlans';
import { cleanupWorkPlanCalendarEvents } from '@/domain/workPlan/workPlanCalendarBridge';
import { toggleWorkPlanItem, getEditableContent, mergeCheckedMeta } from '@/domain/workPlan/engine';
import { WorkPlanOfficeRibbonToolbar } from './components/WorkPlanOfficeRibbonToolbar';
import { WorkPlanTeamMonthlyMatrix } from './components/WorkPlanTeamMonthlyMatrix';
import { WorkPlanConfigModal } from './components/WorkPlanConfigModal';
import { WorkPlanCompanyScheduleModal } from './components/WorkPlanCompanyScheduleModal';
import { GwHead } from '@/modules/gw/_gw';
import { Calendar } from 'lucide-react';
import { resolveDeptId } from '@/domain/department/engine';
import { useDepartments } from '@/features/department/useDepartments';
import { useCalendarEvents } from '@/features/calendar/useCalendarEvents';
import { useDepartmentMembers } from '@/features/departmentMember/useDepartmentMembers';

const WEEKDAY_NAMES_SUN0 = ['일', '월', '화', '수', '목', '금', '토'];

function dayTitle(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const weekday = WEEKDAY_NAMES_SUN0[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${year}년 ${month}월 ${day}일 (${weekday})`;
}

/**
 * 로스터 제외 대상 — 테스터 계정 철저 격리:
 * - 테스터 로그인 시: 무슨 일이 있어도 본인 외 모든 사용자 로스터 제외
 * - 일반 사용자 로그인 시: 모든 테스터 계정 로스터 제외
 */
const isExcludedFromRoster = (user: User, actor?: User | null) => {
  if (actor && user.id === actor.id) return false;

  // 접속자(actor)가 테스터이면 본인 외 모든 사용자를 무조건 제외
  if (isTestUser(actor)) return true;

  // 일반 사용자가 접속한 경우 테스터 계정을 무조건 제외
  if (isTestUser(user)) return true;

  return false;
};

export default function WorkPlanScreen() {
  const { user: authenticatedUser } = useAuth();
  const { userRoles } = usePermission();
  const org = useOrgTree();
  const usersQuery = useUsers();
  // 실제 회사 운영 원칙: 퇴사자(status === '미사용' 또는 resignedAt)는 업무계획 로스터/부서원/일정에서 100% 원천 배제
  const users = useMemo(() => {
    return (usersQuery.data ?? []).filter((u) => u.status === '사용' && !u.resignedAt);
  }, [usersQuery.data]);
  const [demoUserId, setDemoUserId] = useState('U009');
  const actor = authenticatedUser
    ?? users.find((user) => user.id === demoUserId)
    ?? users.find((user) => user.status === '사용')
    ?? null;

  const actorScope = useMemo(() => resolveWorkPlanScope(actor, userRoles, org), [actor, userRoles, org]);

  const [searchParams, setSearchParams] = useSearchParams();
  const today = calendarToday();
  const linkedDate = searchParams.get('date');
  const initialDate = linkedDate && isValidCalendarDate(linkedDate) ? linkedDate : null;

  useEffect(() => {
    if (searchParams.has('date')) {
      setSearchParams((prev) => { prev.delete('date'); return prev; }, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const [editingTarget, setEditingTarget] = useState<{ date: string; plan?: WorkPlan; targetUser?: User } | null>(null);
  const [editingContent, setEditingContent] = useState<string>('');
  const [isSavingPlan, setIsSavingPlan] = useState<boolean>(false);
  const [conflictError, setConflictError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [isConfigOpen, setIsConfigOpen] = useState(false);

  // 전사 공통 중요 일정 모달 상태
  const [companyScheduleModal, setCompanyScheduleModal] = useState<{
    isOpen: boolean;
    date: string;
    content?: string;
    planId?: string;
  }>({ isOpen: false, date: '' });

  const departmentsQuery = useDepartments();
  const deptId = useMemo(
    () => resolveDeptId(departmentsQuery.data ?? [], actor?.dept),
    [departmentsQuery.data, actor],
  );

  const calendarActor = useMemo(
    () => ({ userId: actor?.id ?? '__anonymous__', deptId, active: actor?.status === '사용' }),
    [actor, deptId],
  );
  const userEventsQuery = useCalendarEvents(calendarActor, undefined, Boolean(actor));
  const userEvents = userEventsQuery.data ?? [];

  const editingDateEvents = useMemo(() => {
    if (!editingTarget) return [];
    return userEvents.filter((ev) => ev.date === editingTarget.date);
  }, [userEvents, editingTarget]);

  // ── 부서 및 검색 필터 ──
  const [deptFilter, setDeptFilter] = useState<string>('all');
  const [searchKeyword, setSearchKeyword] = useState<string>('');

  const create = useCreateWorkPlan();
  const update = useUpdateWorkPlan();
  const remove = useRemoveWorkPlan();

/**
 * 직책 서열 가중치 도출 (1순위: 위원장/대표이사 -> 2순위: 부위원장 -> 3순위: 상무/손승원/본부장/임원)
 */
function getJobTitleRank(jobTitle?: string, position?: string, name?: string): number {
  const title = (jobTitle || '').trim();
  const pos = (position || '').trim();
  const n = (name || '').trim();

  // 1순위: 위원장, 대표이사, 대표 (단, 부위원장 제외)
  if (
    n === '위원장' ||
    pos === '위원장' ||
    title === '위원장' ||
    ((n.includes('대표') || pos.includes('대표') || title.includes('대표') || title.includes('위원장')) &&
      !n.includes('부위원') && !pos.includes('부위원') && !title.includes('부위원'))
  ) {
    return 1;
  }

  // 2순위: 부위원장
  if (n.includes('부위원') || pos.includes('부위원') || title.includes('부위원')) {
    return 2;
  }

  // 3순위: 상무, 손승원, 본부장, 임원, 상무이사, 전무, 부사장, 이사
  if (
    n.includes('손승원') ||
    pos.includes('상무') ||
    title.includes('상무') ||
    pos.includes('전무') ||
    title.includes('전무') ||
    pos.includes('부사장') ||
    title.includes('부사장') ||
    title.includes('본부장') ||
    title.includes('임원') ||
    pos.includes('이사')
  ) {
    return 3;
  }

  // 4순위: 센터장, 소장, 실장
  if (title.includes('센터장') || title.includes('소장') || title.includes('실장')) {
    return 4;
  }
  // 5순위: 팀장, 부서장
  if (title.includes('팀장') || title.includes('부서장')) {
    return 5;
  }
  // 6순위: 부팀장, 파트장, 그룹장, 차석
  if (title.includes('부팀장') || title.includes('파트장') || title.includes('그룹장')) {
    return 6;
  }
  // 7순위: 일반 팀원 / 매니저 / 연구원
  return 10;
}

/**
 * 업무계획 사용자 정렬 헬퍼
 * 0순위: 최고위 임원급 (1: 위원장/대표이사 -> 2: 부위원장 -> 3: 상무/손승원) — 부서 무관 항상 최상위
 * 1순위: 부서순 (DB 배치순서 order)
 * 2순위: 직책순 (센터장/소장 > 팀장 > 부팀장 > 팀원)
 * 3순위: 직급순 (상무 > 이사 > 부장 > 차장 > 과장 > 대리 > 사원)
 * 4순위: 이름 가나다순
 */
function sortWorkPlanUsers(
  a: User,
  b: User,
  deptOrderMap: Map<string, number>,
  rankOf: (pos: string) => number,
): number {
  // 0순위: 위원장(1) -> 부위원장(2) -> 상무(3)는 부서 순서와 무관하게 항상 최상위
  const execRankA = getJobTitleRank(a.jobTitle, a.position, a.name);
  const execRankB = getJobTitleRank(b.jobTitle, b.position, b.name);
  const isExecA = execRankA <= 3;
  const isExecB = execRankB <= 3;
  if (isExecA !== isExecB) return isExecA ? -1 : 1;
  // 최고위급 내부 서열 비교 (1: 위원장 -> 2: 부위원장 -> 3: 상무)
  if (isExecA && isExecB && execRankA !== execRankB) return execRankA - execRankB;

  // 1순위: 부서순 (조직도 배치순 order)
  const orderA = deptOrderMap.get(a.dept) ?? 9999;
  const orderB = deptOrderMap.get(b.dept) ?? 9999;
  if (orderA !== orderB) return orderA - orderB;
  if (a.dept !== b.dept) return a.dept.localeCompare(b.dept, 'ko');

  // 2순위: 직책순
  if (execRankA !== execRankB) return execRankA - execRankB;

  // 3순위: 직급순
  const rankA = rankOf(a.position);
  const rankB = rankOf(b.position);
  if (rankA !== rankB) return rankA - rankB;

  // 4순위: 이름 가나다순
  return a.name.localeCompare(b.name, 'ko');
}

  /** 부서별 조직도 정렬 순서 맵 */
  const deptOrderMap = useMemo(() => {
    const map = new Map<string, number>();
    org.depts.forEach((d, idx) => {
      map.set(d.name, d.order ?? (1000 + idx));
    });
    return map;
  }, [org.depts]);

  /** 권한 스코프(개인/팀장/전사) 적용 + 재직 + 대표/테스트 제외 인원 정렬 (1:부서순, 2:직책순, 3:직급순) */
  const roster = useMemo(() => {
    if (!actor) return [];
    return users
      .filter((user) => user.status === '사용' && !isExcludedFromRoster(user, actor))
      .filter((user) => canViewWorkPlan(actor, user, actorScope, org))
      .sort((a, b) => sortWorkPlanUsers(a, b, deptOrderMap, org.rankOf));
  }, [users, actor, actorScope, deptOrderMap, org]);

  const { data: departmentMembers = [] } = useDepartmentMembers();

  /** 고유 부서 목록 (소속 인원이 1명 이상 있는 부서만 자동 표시 & 조직도 배치순 정렬) */
  const departments = useMemo(() => {
    // 테스터 계정인 경우 본인 부서 외 어떤 부서도 표시하지 않음
    if (isTestUser(actor)) {
      return actor?.dept ? [actor.dept] : [];
    }

    const memberCountByDept = new Map<string, number>();

    // A. 본직 인원 카운트
    roster.forEach((u) => {
      memberCountByDept.set(u.dept, (memberCountByDept.get(u.dept) ?? 0) + 1);
    });

    // B. 겸직 인원 카운트
    departmentMembers.forEach((dm) => {
      if (dm.deptName && !dm.deptName.includes('테스트')) {
        const baseUser = users.find((u) => u.id === dm.userId && u.status === '사용');
        if (baseUser) {
          memberCountByDept.set(dm.deptName, (memberCountByDept.get(dm.deptName) ?? 0) + 1);
        }
      }
    });

    // 소속 인원이 없는(0명) 부서는 자동으로 숨김처리
    const activeDepts = Array.from(memberCountByDept.keys()).filter((deptName) => {
      return (memberCountByDept.get(deptName) ?? 0) > 0;
    });

    return activeDepts.sort((a, b) => {
      const orderA = deptOrderMap.get(a) ?? 9999;
      const orderB = deptOrderMap.get(b) ?? 9999;
      return orderA - orderB || a.localeCompare(b, 'ko');
    });
  }, [roster, departmentMembers, users, deptOrderMap, actor]);

  /** 부서 및 검색어 필터가 적용된 최종 열람 인원 (본직 + 겸직 부서 동시 지원) */
  const scopedMembers = useMemo(() => {
    if (!actor) return [];

    // [원칙] 테스터는 무슨 일이 있어도 본인 외에는 업무계획에 표시되지 않음
    if (isTestUser(actor)) {
      const kw = searchKeyword.trim().toLowerCase();
      if (!kw) return [actor];
      return (actor.name.toLowerCase().includes(kw) || actor.dept.toLowerCase().includes(kw)) ? [actor] : [];
    }

    const kw = searchKeyword.trim().toLowerCase();

    // 1. 특정 부서 필터 선택 시 (본직 소속자 + 해당 부서 겸직자 모두 취합)
    if (deptFilter !== 'all' && deptFilter !== 'leaders') {
      const matchedUsers: User[] = [];
      const seenUserIds = new Set<string>();

      // A. 해당 부서가 본직인 사용자
      // (기술경영전략위원회 등 위원회 부서 선택 시에는 대표이사도 위원장으로서 To-Do 집계에 포함!)
      users
        .filter((u) => u.status === '사용')
        .filter((u) => {
          if (deptFilter.includes('위원회') && (u.position.includes('대표') || u.name.includes('대표'))) {
            return true; // 위원회 뷰에서는 대표이사 포함
          }
          return !isExcludedFromRoster(u, actor);
        })
        .filter((u) => u.dept === deptFilter)
        .forEach((u) => {
          matchedUsers.push(u);
          seenUserIds.add(u.id);
        });

      // B. 해당 부서에 '겸직(departmentMembers)'으로 소속된 사용자 (손승원 상무, 대표이사 등)
      departmentMembers
        .filter(
          (dm) =>
            !dm.isPrimary &&
            (dm.deptName === deptFilter || org.depts.find((d) => d.id === dm.deptId)?.name === deptFilter),
        )
        .forEach((dm) => {
          if (seenUserIds.has(dm.userId)) return;
          const baseUser = users.find((u) => u.id === dm.userId);
          if (!baseUser || baseUser.status !== '사용') return;

          // 겸직 소속 인원 추가 (겸직 플래그 및 해당 부서 직책 반영)
          matchedUsers.push({
            ...baseUser,
            dept: deptFilter,
            jobTitle: dm.jobTitle || baseUser.jobTitle,
            isConcurrent: true,
          } as User & { isConcurrent: boolean });
          seenUserIds.add(dm.userId);
        });

      // 부서 내 서열 정렬 (0순위: 위원장(1) -> 부위원장(2) -> 상무(3) 등 최고위 최상위 > 1:직책순 > 2:직급순 > 3:이름순)
      const sorted = matchedUsers.sort((a, b) => {
        const titleRankA = getJobTitleRank(a.jobTitle, a.position, a.name);
        const titleRankB = getJobTitleRank(b.jobTitle, b.position, b.name);
        // 최고위급(rank<=3: 위원장 1, 부위원장 2, 상무 3)은 비임원보다 무조건 앞
        const isExecA = titleRankA <= 3;
        const isExecB = titleRankB <= 3;
        if (isExecA !== isExecB) return isExecA ? -1 : 1;
        if (titleRankA !== titleRankB) return titleRankA - titleRankB;

        const rankA = org.rankOf(a.position);
        const rankB = org.rankOf(b.position);
        if (rankA !== rankB) return rankA - rankB;

        return a.name.localeCompare(b.name, 'ko');
      });

      return sorted.filter((u) => {
        if (!kw) return true;
        return u.name.toLowerCase().includes(kw) || u.dept.toLowerCase().includes(kw);
      });
    }

    // 2. 전체(all) 또는 팀장(leaders) 필터
    return roster.filter((user) => {
      let matchesDept = true;
      if (deptFilter === 'leaders') {
        matchesDept = user.dept !== actor?.dept && isLeaderPosition(user.position, user.jobTitle, user.id, org);
      }
      const matchesName = !kw || user.name.toLowerCase().includes(kw) || user.dept.toLowerCase().includes(kw);
      return matchesDept && matchesName;
    });
  }, [users, roster, deptFilter, searchKeyword, departmentMembers, org, actor]);

  const savePlan = useCallback(
    async (
      date: string,
      content: string,
      existingPlanId?: string,
      targetUser?: User,
      expectedUpdatedAt?: string,
    ) => {
      if (!actor) return;
      const actorParam = { userId: actor.id, active: actor.status === '사용' };
      const ownerId = targetUser?.id || actor.id;

      if (!content.trim()) {
        if (existingPlanId) {
          await removePlan(existingPlanId, date, ownerId);
        }
        return;
      }

      await (existingPlanId
        ? update.mutateAsync({
            actor: actorParam,
            id: existingPlanId,
            draft: { date, content },
            expectedUpdatedAt,
          })
        : create.mutateAsync({
            actor: actorParam,
            draft: { date, content, ownerUserId: ownerId },
          }));
      setNotice('업무계획을 저장했습니다.');
    },
    [actor, create, update],
  );

  const removePlan = useCallback(
    async (planId: string, date?: string, targetUserId?: string) => {
      if (!actor) return;
      const ownerId = targetUserId || actor.id;
      await cleanupWorkPlanCalendarEvents(
        { userId: ownerId, active: true, deptId },
        planId,
        date,
      );
      await remove.mutateAsync({ actor: { userId: actor.id, active: actor.status === '사용' }, id: planId });
      setNotice('업무계획을 삭제했습니다.');
    },
    [actor, remove, deptId],
  );

  const handleToggleItem = useCallback(
    async (plan: WorkPlan, itemIdx: number) => {
      // 진행도 체크는 오직 본인의 업무계획만 가능
      if (!actor || plan.ownerUserId !== actor.id) return;
      const nextContent = toggleWorkPlanItem(plan.content, itemIdx);
      const targetUser = users.find((u) => u.id === plan.ownerUserId);
      await savePlan(plan.date, nextContent, plan.id, targetUser, plan.updatedAt);
    },
    [actor?.id, users, savePlan],
  );

  const loading = usersQuery.isLoading;

  if (loading) return <div className="grid min-h-[60vh] place-items-center text-[12px] font-semibold text-ink3">불러오는 중…</div>;
  if (!actor) return <div className="grid min-h-[60vh] place-items-center text-[12px] font-semibold text-ink3">사용자 정보를 불러올 수 없습니다.</div>;

  return (
    <div className="mx-auto w-full max-w-[1500px] px-4 py-5 sm:px-6 sm:py-6 space-y-4">
      <GwHead
        icon="🗓️"
        name="업무계획"
        desc="팀 주간 종합 계획: 전 팀원의 한 주간 업무 계획(To-Do)을 종합 조회하고, 요일별 업무 등록 및 진행 상황을 공유합니다."
        right={
          <div className="flex items-center gap-2">
            {!authenticatedUser && (
              <select
                value={actor.id}
                onChange={(event) => setDemoUserId(event.target.value)}
                title="사용자 선택"
                className="h-9 rounded-lg border border-amber/30 bg-amber-soft/30 px-3 text-[10.5px] font-bold text-ink outline-none"
              >
                {users.filter((user) => user.status === '사용').map((user) => (
                  <option key={user.id} value={user.id}>{user.name}</option>
                ))}
              </select>
            )}
          </div>
        }
      />

      {notice && (
        <div aria-live="polite" className="rounded-lg border border-teal/20 bg-teal-soft/25 px-3 py-2 text-[10.5px] font-semibold text-teal">
          {notice}
        </div>
      )}

      {/* ── 다차원 필터링 툴바 ── */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-border bg-panel px-3.5 py-2.5 shadow-xs">
        <div className="flex flex-wrap items-center gap-2">
          {/* 부서 필터 드롭다운 (권한 스코프별 제어) */}
          <select
            value={deptFilter}
            onChange={(e) => setDeptFilter(e.target.value)}
            className="h-8 rounded-lg border border-border bg-panel-alt/50 px-2.5 text-[11px] font-bold text-ink outline-none focus:border-teal/50"
          >
            {actorScope === 'TEAM' ? (
              <option value="all">우리 팀 · {actor?.dept || '소속 부서'} ({roster.length}명)</option>
            ) : actorScope === 'TEAM_AND_LEADERS' ? (
              <>
                <option value="all">전체 ({roster.length}명)</option>
                {actor?.dept && (
                  <option value={actor.dept}>
                    우리 팀 · {actor.dept} ({roster.filter((u) => u.dept === actor.dept).length}명)
                  </option>
                )}
                <option value="leaders">
                  타 부서 팀장 모아보기 ({roster.filter((u) => u.dept !== actor?.dept && isLeaderPosition(u.position, u.jobTitle, u.id, org)).length}명)
                </option>
              </>
            ) : (
              <>
                <option value="all">전체 부서 ({roster.length}명)</option>
                {departments.map((d) => (
                  <option key={d} value={d}>
                    {d} ({roster.filter((u) => u.dept === d).length}명)
                  </option>
                ))}
              </>
            )}
          </select>

          {/* 권한 스코프 뱃지 안내 */}
          <div className="text-[10.5px] font-semibold text-ink3 rounded-md bg-panel-alt/50 px-2 py-1 border border-border">
            {actorScope === 'TEAM' && `열람 범위: ${actor.dept || '우리 팀'} (팀원 및 팀장)`}
            {actorScope === 'TEAM_AND_LEADERS' && `열람 범위: ${actor.dept || '우리 팀'} 및 타 부서 팀장`}
            {actorScope === 'ALL' && '열람 범위: 전사 임직원'}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* 월간 종합 계획표 배지 */}
          <div className="flex items-center gap-1.5 rounded-lg border border-teal/20 bg-teal-soft/10 px-3 py-1.5 text-[11px] font-bold text-teal shadow-2xs">
            <Calendar size={13} />
            <span>월간 계획표</span>
          </div>

          {/* 이름 또는 부서 실시간 검색창 */}
          <div className="relative min-w-[150px] flex-1 sm:max-w-[200px]">
            <input
              type="text"
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              placeholder="이름 또는 부서 검색..."
              className="h-8 w-full rounded-lg border border-border bg-panel-alt/40 pl-7 pr-7 text-[11px] text-ink placeholder:text-ink3 outline-none focus:border-teal/50 focus:bg-panel"
            />
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] text-ink3">🔍</span>
            {searchKeyword && (
              <button
                type="button"
                onClick={() => setSearchKeyword('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[12px] text-ink3 hover:text-ink"
              >
                ✕
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── 엑셀/스프레드시트 상단 오피스 리본 메뉴 툴바 ── */}
      {editingTarget && (
        <WorkPlanOfficeRibbonToolbar
          dateTitle={
            editingTarget.targetUser && editingTarget.targetUser.id !== actor.id
              ? `${editingTarget.targetUser.name}(${editingTarget.targetUser.position || '팀원'}) · ${dayTitle(editingTarget.date)}`
              : dayTitle(editingTarget.date)
          }
          targetUser={editingTarget.targetUser}
          actor={actor}
          content={editingContent}
          onContentChange={setEditingContent}
          todayEvents={editingDateEvents}
          isSaving={isSavingPlan}
          conflictError={conflictError}
          onSave={async (forceOverwrite) => {
            if (!editingTarget) return;
            setIsSavingPlan(true);
            setConflictError(null);
            try {
              if (!editingContent.trim()) {
                if (editingTarget.plan) {
                  await removePlan(editingTarget.plan.id, editingTarget.date, editingTarget.targetUser?.id);
                } else {
                  await savePlan(
                    editingTarget.date,
                    '',
                    undefined,
                    editingTarget.targetUser,
                    undefined,
                  );
                }
              } else {
                await savePlan(
                  editingTarget.date,
                  editingContent.trim(),
                  editingTarget.plan?.id,
                  editingTarget.targetUser,
                  forceOverwrite ? undefined : editingTarget.plan?.updatedAt,
                );
              }
              setEditingTarget(null);
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : '';
              if (
                msg.includes('먼저 수정') ||
                msg.includes('먼저 등록') ||
                (err as { code?: string })?.code === 'CONFLICT'
              ) {
                setConflictError(
                  msg || '다른 사용자가 방금 이 계획을 먼저 수정했습니다. 작성 중인 내용을 안전하게 보존했습니다.',
                );
              } else {
                alert(msg || '저장 중 오류가 발생했습니다.');
              }
            } finally {
              setIsSavingPlan(false);
            }
          }}
          onDelete={
            editingTarget.plan
              ? async () => {
                  if (!window.confirm('이 날짜의 업무계획을 삭제하시겠습니까? (연동된 캘린더 일정도 함께 정리됩니다)')) return;
                  setIsSavingPlan(true);
                  try {
                    await removePlan(editingTarget.plan!.id, editingTarget.date, editingTarget.targetUser?.id);
                    setEditingTarget(null);
                  } finally {
                    setIsSavingPlan(false);
                  }
                }
              : undefined
          }
          onClose={() => setEditingTarget(null)}
        />
      )}

      {/* ── 메인 뷰: 월간 종합 뷰 (엑셀 셀 직접 입력 지원) ── */}
      <WorkPlanTeamMonthlyMatrix
        actor={actor}
        todayStr={initialDate ?? today}
        members={scopedMembers}
        deptId={deptId}
        activeEditing={
          editingTarget
            ? { date: editingTarget.date, userId: editingTarget.targetUser?.id ?? actor.id }
            : null
        }
        editingContent={editingContent}
        onEditingContentChange={setEditingContent}
        onSaveEditing={async () => {
          if (!editingTarget) return;
          const currentTarget = editingTarget;
          const contentToSave = editingContent;
          setIsSavingPlan(true);
          setConflictError(null);
          try {
            if (!contentToSave.trim()) {
              if (currentTarget.plan) {
                await removePlan(currentTarget.plan.id, currentTarget.date, currentTarget.targetUser?.id);
              }
            } else {
              // 준수 텍스트 + 기존 체크 메타 병합하여 저장 (편집 중 케크 상태 보존)
              const mergedContent = currentTarget.plan
                ? mergeCheckedMeta(contentToSave.trim(), currentTarget.plan.content)
                : contentToSave.trim();
              await savePlan(
                currentTarget.date,
                mergedContent,
                currentTarget.plan?.id,
                currentTarget.targetUser,
                currentTarget.plan?.updatedAt,
              );
            }
            // 저장 완료 후, 사용자가 다른 셀을 이미 클릭해 편집 대상이 변경되었으면 닫지 않음
            setEditingTarget((prev) =>
              prev?.date === currentTarget.date && prev?.targetUser?.id === currentTarget.targetUser?.id
                ? null
                : prev,
            );
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : '';
            if (
              msg.includes('먼저 수정') ||
              msg.includes('먼저 등록') ||
              (err as { code?: string })?.code === 'CONFLICT'
            ) {
              setConflictError(
                msg || '다른 사용자가 방금 이 계획을 먼저 수정했습니다. 작성 중인 내용을 안전하게 보존했습니다.',
              );
            } else {
              alert(msg || '저장 중 오류가 발생했습니다.');
            }
          } finally {
            setIsSavingPlan(false);
          }
        }}
        onCancelEditing={() => setEditingTarget(null)}
        onOpenEditor={(date, plan, member) => {
          setEditingTarget({ date, plan, targetUser: member });
          // __c__: 완료 메타 줄은 textarea에 노출되지 않도록 제거
          setEditingContent(plan ? getEditableContent(plan.content) : '');
          setConflictError(null);
        }}
        onOpenConfig={() => setIsConfigOpen(true)}
        onToggleItem={handleToggleItem}
        onOpenCompanySchedule={(date, content, planId) =>
          setCompanyScheduleModal({ isOpen: true, date, content, planId })
        }
      />

      {/* 루틴 템플릿 및 태그 관리 모달 */}
      <WorkPlanConfigModal
        isOpen={isConfigOpen}
        onClose={() => setIsConfigOpen(false)}
      />

      {/* 전사 공통 중요 일정 등록/수정 모달 */}
      <WorkPlanCompanyScheduleModal
        isOpen={companyScheduleModal.isOpen}
        date={companyScheduleModal.date}
        initialContent={companyScheduleModal.content}
        planId={companyScheduleModal.planId}
        onClose={() => setCompanyScheduleModal((prev) => ({ ...prev, isOpen: false }))}
        onSave={async (date, content, planId) => {
          if (!actor) return;
          const actorParam = { userId: actor.id, active: actor.status === '사용' };
          if (!content.trim()) {
            if (planId) {
              await remove.mutateAsync({ actor: actorParam, id: planId });
              setNotice('전사 주요 일정을 삭제했습니다.');
            }
            return;
          }
          if (planId) {
            await update.mutateAsync({ actor: actorParam, id: planId, draft: { date, content } });
          } else {
            await create.mutateAsync({ actor: actorParam, draft: { date, content, ownerUserId: '__COMPANY__' } });
          }
          setNotice('전사 주요 일정을 저장했습니다.');
        }}
        onDelete={async (planId, _date) => {
          if (!actor) return;
          await remove.mutateAsync({ actor: { userId: actor.id, active: actor.status === '사용' }, id: planId });
          setNotice('전사 주요 일정을 삭제했습니다.');
        }}
      />
    </div>
  );
}
