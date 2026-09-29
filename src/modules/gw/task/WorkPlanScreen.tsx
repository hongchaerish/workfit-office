import { useMemo, useState, useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/app/auth/AuthProvider';
import { usePermission } from '@/features/auth/usePermission';
import { resolveWorkPlanScope, canViewWorkPlan, isLeaderPosition } from '@/features/auth/scopeHelper';
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
import { syncWorkPlanToCalendar, cleanupWorkPlanCalendarEvents } from '@/domain/workPlan/workPlanCalendarBridge';
import { toggleWorkPlanItem, getEditableContent, mergeCheckedMeta } from '@/domain/workPlan/engine';
import { WorkPlanOfficeRibbonToolbar } from './components/WorkPlanOfficeRibbonToolbar';
import { WorkPlanTeamMonthlyMatrix } from './components/WorkPlanTeamMonthlyMatrix';
import { WorkPlanConfigModal } from './components/WorkPlanConfigModal';
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
 * 로스터 제외 대상 — 일반 운영 모드에서의 테스트 계정 처리.
 * - 대표이사 포함 모든 정규 임직원이 표시됩니다.
 * - 본인 계정은 테스터라도 항상 표시됩니다.
 * - 테스트 계정/부서로 로그인하여 시연 중일 때는 테스트 부서 인원들이 정상 표시됩니다.
 */
const isExcludedFromRoster = (user: User, actor?: User | null) => {
  if (actor && user.id === actor.id) return false;

  const isActorTest = Boolean(
    actor?.dept?.includes('테스트') ||
    actor?.name?.includes('테스트') ||
    actor?.name?.includes('테스터') ||
    actor?.id?.toLowerCase().includes('test') ||
    actor?.name?.toLowerCase().includes('test')
  );
  const isUserTest = Boolean(
    user.dept?.includes('테스트') ||
    user.name?.includes('테스트') ||
    user.name?.includes('테스터') ||
    user.id?.toLowerCase().includes('test') ||
    user.name?.toLowerCase().includes('test')
  );

  if (isActorTest && isUserTest) return false;
  return isUserTest;
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
  const [shareToCalendar, setShareToCalendar] = useState<boolean>(true);
  const [isSavingPlan, setIsSavingPlan] = useState<boolean>(false);
  const [conflictError, setConflictError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [isConfigOpen, setIsConfigOpen] = useState(false);

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

  /** 부서별 조직도 정렬 순서 맵 */
  const deptOrderMap = useMemo(() => {
    const map = new Map<string, number>();
    org.depts.forEach((d, idx) => {
      map.set(d.name, d.order ?? (1000 + idx));
    });
    return map;
  }, [org.depts]);

  /** 권한 스코프(개인/팀장/전사) 적용 + 재직 + 대표/테스트 제외 인원 정렬 */
  const roster = useMemo(() => {
    if (!actor) return [];
    return users
      .filter((user) => user.status === '사용' && !isExcludedFromRoster(user, actor))
      .filter((user) => canViewWorkPlan(actor, user, actorScope, org))
      .sort((a, b) => {
        const orderA = deptOrderMap.get(a.dept) ?? 9999;
        const orderB = deptOrderMap.get(b.dept) ?? 9999;
        if (orderA !== orderB) return orderA - orderB;
        if (a.dept !== b.dept) return a.dept.localeCompare(b.dept, 'ko');

        const rankA = org.rankOf(a.position);
        const rankB = org.rankOf(b.position);
        if (rankA !== rankB) return rankA - rankB;

        return a.name.localeCompare(b.name, 'ko');
      });
  }, [users, actor, actorScope, deptOrderMap, org]);

  const { data: departmentMembers = [] } = useDepartmentMembers();

  /** 고유 부서 목록 (조직도 공식 부서 + 로스터 부서 + 겸직 부서 종합) */
  const departments = useMemo(() => {
    const validOrgDepts = org.depts
      .filter((d) => !d.name.includes('테스트'))
      .map((d) => d.name);

    const allDeptNames = new Set<string>(validOrgDepts);
    roster.forEach((u) => allDeptNames.add(u.dept));
    departmentMembers.forEach((dm) => {
      if (dm.deptName && !dm.deptName.includes('테스트')) {
        allDeptNames.add(dm.deptName);
      }
    });

    const list = Array.from(allDeptNames).filter(Boolean);
    return list.sort((a, b) => {
      const orderA = deptOrderMap.get(a) ?? 9999;
      const orderB = deptOrderMap.get(b) ?? 9999;
      return orderA - orderB || a.localeCompare(b, 'ko');
    });
  }, [org.depts, roster, departmentMembers, deptOrderMap]);

  /** 부서 및 검색어 필터가 적용된 최종 열람 인원 (본직 + 겸직 부서 동시 지원) */
  const scopedMembers = useMemo(() => {
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

      // 부서 내 서열 정렬 (팀장/부서장/위원장 최우선 > 파트장/실장 > 직급 > 이름)
      const sorted = matchedUsers.sort((a, b) => {
        const isALeader =
          a.jobTitle?.includes('팀장') ||
          a.jobTitle?.includes('위원장') ||
          a.jobTitle?.includes('대표') ||
          a.jobTitle?.includes('소장') ||
          a.jobTitle?.includes('부서장');
        const isBLeader =
          b.jobTitle?.includes('팀장') ||
          b.jobTitle?.includes('위원장') ||
          b.jobTitle?.includes('대표') ||
          b.jobTitle?.includes('소장') ||
          b.jobTitle?.includes('부서장');
        if (isALeader && !isBLeader) return -1;
        if (!isALeader && isBLeader) return 1;

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
      shareToCalendar = true,
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

      const saved = existingPlanId
        ? await update.mutateAsync({
            actor: actorParam,
            id: existingPlanId,
            draft: { date, content },
            expectedUpdatedAt,
          })
        : await create.mutateAsync({
            actor: actorParam,
            draft: { date, content, ownerUserId: ownerId },
          });

      if (saved) {
        await syncWorkPlanToCalendar(
          { userId: ownerId, active: true, deptId },
          saved,
          shareToCalendar,
        );
      }
      setNotice('업무계획을 저장했습니다.');
    },
    [actor, create, update, deptId],
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
      await savePlan(plan.date, nextContent, plan.id, true, targetUser, plan.updatedAt);
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
          shareToCalendar={shareToCalendar}
          onShareToCalendarChange={setShareToCalendar}
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
                    shareToCalendar,
                    editingTarget.targetUser,
                    undefined,
                  );
                }
              } else {
                await savePlan(
                  editingTarget.date,
                  editingContent.trim(),
                  editingTarget.plan?.id,
                  shareToCalendar,
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
                shareToCalendar,
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
          setShareToCalendar(true);
          setConflictError(null);
        }}
        onOpenConfig={() => setIsConfigOpen(true)}
        onToggleItem={handleToggleItem}
      />

      {/* 루틴 템플릿 및 태그 관리 모달 */}
      <WorkPlanConfigModal
        isOpen={isConfigOpen}
        onClose={() => setIsConfigOpen(false)}
      />
    </div>
  );
}
