import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { useRosterOrder } from '@/features/user/useRosterOrder';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/app/auth/AuthProvider';
import { usePermission } from '@/features/auth/usePermission';
import { resolveWorkPlanScope, canViewWorkPlan } from '@/features/auth/scopeHelper';
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
import { toggleWorkPlanItem, mergeCheckedMeta } from '@/domain/workPlan/engine';
import { toEditableText } from '@/domain/workPlan/richText';
import type { Editor } from '@tiptap/react';
import type { CalendarEvent } from '@/domain/calendarEvent/schema';
import CalendarEventModal from '@/modules/gw/calendar/CalendarEventModal';
import { WorkPlanOfficeRibbonToolbar } from './components/WorkPlanOfficeRibbonToolbar';
import { WorkPlanTeamMonthlyMatrix } from './components/WorkPlanTeamMonthlyMatrix';
import { WorkPlanConfigModal } from './components/WorkPlanConfigModal';
import { RosterOrderModal } from './components/RosterOrderModal';
import { WorkPlanCompanyScheduleModal } from './components/WorkPlanCompanyScheduleModal';
import { GwHead } from '@/modules/gw/_gw';
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

export default function WorkPlanScreen() {
  const { user: authenticatedUser } = useAuth();
  const { userRoles, isSuperAdmin, canAction } = usePermission();
  // 전 직원 정렬 순서 편집 — 최고관리자·'팀·전사 업무 종합 현황' 수정 권한자 전용(전사 공통 설정)
  const canEditRosterOrder = isSuperAdmin || canAction('S_GW_WORK_PLAN_ADMIN', 'update');
  const [isOrderOpen, setIsOrderOpen] = useState(false);
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
  /** 칸 편집기(Tiptap) — 리본 서식 버튼이 명령을 보낸다. */
  const [cellEditor, setCellEditor] = useState<Editor | null>(null);
  /** 같은 칸 저장이 겹치지 않게(Ctrl+Enter 직후 blur 등) 진행 중 여부를 동기적으로 들고 있는다. */
  const savingCellRef = useRef(false);
  /** 회의 등록·상세 창 — 회의는 캘린더 일정 1건 + 참석자(업무계획 본문에 쓰지 않는다). */
  const [meetingModal, setMeetingModal] = useState<{ date: string; event?: CalendarEvent } | null>(null);
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

  /** 인원 정렬 — 관리자가 정한 순서 → 임원(권한그룹) → 부서 → 직책 → 직급 → 이름([[rosterOrder]]) */
  const { compare: compareRoster } = useRosterOrder();

  /** 부서별 조직도 정렬 순서 맵 */
  const deptOrderMap = useMemo(() => {
    const map = new Map<string, number>();
    org.depts.forEach((d, idx) => {
      map.set(d.name, d.order ?? (1000 + idx));
    });
    return map;
  }, [org.depts]);

  /** 권한 스코프(개인/팀장/전사) 적용 + 재직 인원 정렬 (1:부서순, 2:직책순, 3:직급순) */
  const roster = useMemo(() => {
    if (!actor) return [];
    return users
      .filter((user) => user.status === '사용')
      .filter((user) => canViewWorkPlan(actor, user, actorScope, org))
      .sort(compareRoster);
  }, [users, actor, actorScope, org, compareRoster]);

  const { data: departmentMembers = [] } = useDepartmentMembers();

  /** 고유 부서 목록 (소속 인원이 1명 이상 있는 부서만 자동 표시 & 조직도 배치순 정렬) */
  const departments = useMemo(() => {
    const memberCountByDept = new Map<string, number>();

    // A. 본직 인원 카운트
    roster.forEach((u) => {
      memberCountByDept.set(u.dept, (memberCountByDept.get(u.dept) ?? 0) + 1);
    });

    // B. 겸직 인원 카운트
    departmentMembers.forEach((dm) => {
      if (dm.deptName) {
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

    const kw = searchKeyword.trim().toLowerCase();

    // 1. 특정 부서 필터 선택 시 (본직 소속자 + 해당 부서 겸직자 모두 취합)
    if (deptFilter !== 'all') {
      const matchedUsers: User[] = [];
      const seenUserIds = new Set<string>();

      // A. 해당 부서가 본직인 사용자
      // (기술경영전략위원회 등 위원회 부서 선택 시에는 대표이사도 위원장으로서 To-Do 집계에 포함!)
      users
        .filter((u) => u.status === '사용')
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

      const sorted = matchedUsers.sort(compareRoster);

      return sorted.filter((u) => {
        if (!kw) return true;
        return u.name.toLowerCase().includes(kw) || u.dept.toLowerCase().includes(kw);
      });
    }

    // 2. 전체(all) 필터
    return roster.filter((user) => !kw || user.name.toLowerCase().includes(kw) || user.dept.toLowerCase().includes(kw));
  }, [users, roster, deptFilter, searchKeyword, departmentMembers, org, actor, compareRoster]);

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

  if (loading) return <div className="grid min-h-[calc(60vh/var(--font-scale,1))] place-items-center text-[12px] font-semibold text-ink3">불러오는 중…</div>;
  if (!actor) return <div className="grid min-h-[calc(60vh/var(--font-scale,1))] place-items-center text-[12px] font-semibold text-ink3">사용자 정보를 불러올 수 없습니다.</div>;

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
          if (!editingTarget || savingCellRef.current) return;
          const currentTarget = editingTarget;
          const contentToSave = editingContent;
          // 아무것도 고치지 않고 칸을 벗어났으면 저장하지 않는다 — 불필요한 갱신과 동시 수정 충돌을 줄인다.
          if (currentTarget.plan && contentToSave.trim() === toEditableText(currentTarget.plan.content).trim()) {
            setEditingTarget((prev) => (prev?.date === currentTarget.date && prev?.targetUser?.id === currentTarget.targetUser?.id ? null : prev));
            return;
          }
          savingCellRef.current = true;
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
            savingCellRef.current = false;
            setIsSavingPlan(false);
          }
        }}
        onCancelEditing={() => setEditingTarget(null)}
        onOpenEditor={(date, plan, member) => {
          setEditingTarget({ date, plan, targetUser: member });
          // 체크 메타(__c__)는 편집기에서 - [x] 표기로 풀어 보여 준다
          setEditingContent(plan ? toEditableText(plan.content) : '');
          setConflictError(null);
        }}
        onOpenConfig={() => setIsConfigOpen(true)}
        onToggleItem={handleToggleItem}
        onEditorReady={setCellEditor}
        onOpenMeeting={(event) => setMeetingModal({ date: event.date, event })}
        // 부서 필터·검색 — 상단 고정 바에 함께 놓인다
        filters={(
          <>
            <select
              value={deptFilter}
              onChange={(e) => setDeptFilter(e.target.value)}
              title="부서 필터"
              className="h-8 rounded-lg border border-border bg-panel-alt/50 px-2.5 text-[11px] font-bold text-ink outline-none focus:border-teal/50"
            >
              <option value="all">전체 부서 ({roster.length}명)</option>
              {departments.map((d) => (
                <option key={d} value={d}>
                  {d} ({roster.filter((u) => u.dept === d).length}명)
                </option>
              ))}
            </select>
            <div className="relative w-[180px]">
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
            {canEditRosterOrder && (
              <button
                type="button"
                onClick={() => setIsOrderOpen(true)}
                title="인원 정렬 순서 편집 (관리자 전용, 전사 적용)"
                className="h-8 rounded-lg border border-border bg-panel-alt/50 px-2.5 text-[11px] font-bold text-ink hover:border-teal/50"
              >
                ↕ 정렬 순서
              </button>
            )}
          </>
        )}
        // 편집 리본 — 상단 고정 바 바로 아래에 붙는다
        editingToolbar={editingTarget ? (
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
          editor={cellEditor}
          onAddMeeting={() => setMeetingModal({ date: editingTarget.date })}
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
        />
        ) : null}
        onOpenCompanySchedule={(date, content, planId) =>
          setCompanyScheduleModal({ isOpen: true, date, content, planId })
        }
      />

      {/* 회의 등록·상세 */}
      {meetingModal && (
        <CalendarEventModal
          actor={calendarActor}
          initialDate={meetingModal.date}
          event={meetingModal.event}
          initialEventType="MEETING"
          myProjects={[]}
          deptName={actor.dept || null}
          ownerName={
            meetingModal.event && meetingModal.event.ownerUserId !== actor.id
              ? users.find((u) => u.id === meetingModal.event!.ownerUserId)?.name ?? null
              : null
          }
          onClose={() => setMeetingModal(null)}
          onSaved={() => {
            setMeetingModal(null);
            setNotice('회의를 저장했습니다. 참석자 칸과 캘린더에 함께 표시됩니다.');
          }}
          onRemoved={() => {
            setMeetingModal(null);
            setNotice('회의를 삭제했습니다.');
          }}
        />
      )}

      {/* 전 직원 정렬 순서 편집(관리자 전용) */}
      <RosterOrderModal open={isOrderOpen} onClose={() => setIsOrderOpen(false)} />

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
