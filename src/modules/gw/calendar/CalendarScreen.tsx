import { useEffect, useMemo, useState, useCallback } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '@/app/auth/AuthProvider';
import { buildCalendarMonth, calendarToday, isValidCalendarDate, moveCalendarMonth } from '@/domain/calendarEvent/calendarDate';
import type { CalendarEvent, CalendarEventType } from '@/domain/calendarEvent/schema';
import { isMaskedForSupervisor, isCompanyEvent, isAttendeeEvent, isOfficialCalendarEvent } from '@/domain/calendarEvent/engine';
import { resolveDeptId } from '@/domain/department/engine';
import type { ProjectAccessContext } from '@/domain/workProject/engine';
import type { CalendarEventActor } from '@/data/calendarEvent/calendarEvent.repo';
import { useCalendarEvents, useTeamCalendarEvents } from '@/features/calendar/useCalendarEvents';
import { useDepartments } from '@/features/department/useDepartments';
import { useProjects } from '@/features/project/useProjects';
import { useUsers } from '@/features/user/useUsers';
import { usePermission } from '@/features/auth/usePermission';
import { useOrgTree } from '@/features/gw/useOrgTree';
import { resolveWorkPlanScope, isLeaderPosition } from '@/features/auth/scopeHelper';
import { useAllApprovals } from '@/features/gw/useApprovals';
import { extractApprovedSchedules } from '@/domain/approvalDoc/scheduleEngine';
import type { CalendarSupervisorScope } from '@/domain/calendarEvent/engine';
import { useDepartmentMembers } from '@/features/departmentMember/useDepartmentMembers';
import {
  useMyWorkPlans,
  useCreateWorkPlan,
  useUpdateWorkPlan,
} from '@/features/workPlan/useWorkPlans';
import {
  parseWorkPlanItems,
  calculatePlanProgress,
  toggleWorkPlanItem,
  addWorkPlanItem,
  getWorkPlanTagMeta,
} from '@/domain/workPlan/engine';
import { syncWorkPlanToCalendar } from '@/domain/workPlan/workPlanCalendarBridge';
import { useWorkPlanConfig } from '@/features/workPlan/useWorkPlanConfig';
import { GwHead } from '@/modules/gw/_gw';
import { Button } from '@/shared/ui/Button';
import CalendarEventModal from './CalendarEventModal';
import MonthCalendar from './MonthCalendar';
import { Sparkles, CheckCircle2, ListTodo, ExternalLink } from 'lucide-react';

const WEEKDAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

function monthLabel(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number);
  return `${year}년 ${monthNumber}월`;
}

/** 목록 모달 제목. 요일은 UTC로 뽑는다 — 달력 격자를 만드는 방식과 같아야 하루가 밀리지 않는다. */
function dayTitle(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const weekday = WEEKDAY_NAMES[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${year}년 ${month}월 ${day}일 (${weekday})`;
}

function scheduleTime(event: { allDay: boolean; startTime: string | null; endTime: string | null }): string {
  return event.allDay ? '종일' : `${event.startTime} ~ ${event.endTime}`;
}

/** 부서 필터의 "전체" 값. 실제 부서명과 충돌하지 않는 형태로 둔다. */
const ALL_DEPTS = '__ALL__';

function LocalCalendarScreen() {
  const { user: authenticatedUser, loading: authLoading } = useAuth();
  const today = calendarToday();
  const [searchParams, setSearchParams] = useSearchParams();
  /*
    알림(`/gw/calendar?date=2026-08-26`)에서 들어온 진입점. 있으면 그 달을 열고 목록
    모달도 바로 띄운다 — 없으면(직접 메뉴로 들어온 보통 경우) 오늘 달을 그대로 연다.
    쿼리는 한 번 읽은 뒤 지운다 — 남아 있으면 "오늘" 버튼을 눌러도 계속 그 날짜로
    돌아오는 것처럼 보인다.
  */
  const linkedDate = searchParams.get('date');
  const initialDate = linkedDate && isValidCalendarDate(linkedDate) ? linkedDate : null;
  const [month, setMonth] = useState((initialDate ?? today).slice(0, 7));
  /** 현재 선택된 날짜 (기본값 오늘 또는 링크 파라미터 날짜) */
  const [selectedDate, setSelectedDate] = useState<string>(initialDate ?? today);

  /*
    읽고 나면 지운다 — 안 지우면 주소창에 남아 "오늘"을 눌러도 다시 이 날짜로 보인다.
    마운트 시 1회만 확인하면 된다 — 이후 달력 안 조작(달 이동·모달 열기)은 이 쿼리와 무관하다.
  */
  useEffect(() => {
    if (searchParams.has('date')) setSearchParams((prev) => { prev.delete('date'); return prev; }, { replace: true });
  }, [searchParams, setSearchParams]);
  const [demoUserId, setDemoUserId] = useState('U009');
  const { isOperator, isExecutive, userRoles } = usePermission();
  const org = useOrgTree();
  const canManageCompanyEvent = isOperator || isExecutive;

  const [modalTarget, setModalTarget] = useState<{
    date: string;
    event?: CalendarEvent;
    initialTitle?: string;
    initialEventType?: CalendarEventType;
    initialAttendees?: string[];
  } | null>(null);
  const [notice, setNotice] = useState('');
  /** 내 일정 / 팀 일정. 열람 범위가 없으면 아래에서 내 일정으로 고정된다. */
  const [tab, setTab] = useState<'me' | 'team'>('me');
  /** 관련 일정 세부 필터 (전체, 내 일정, 참여 회의·일정, 사내행사, 부서·프로젝트) */
  const [scopeFilter, setScopeFilter] = useState<'all' | 'mine' | 'attendee' | 'company' | 'team'>('all');
  /** 팀 일정의 부서 필터. ALL_DEPTS면 범위 전체(관리자는 전 직원, 팀장은 맡은 부서 전부). */
  const [teamDeptSel, setTeamDeptSel] = useState(ALL_DEPTS);
  const usersQuery = useUsers();
  const users = (usersQuery.data ?? []).filter((u) => u.status === '사용' && !u.resignedAt);
  const actor = authenticatedUser
    ?? users.find((user) => user.id === demoUserId)
    ?? users.find((user) => user.status === '사용')
    ?? null;
  /*
    공유 판정에 쓸 소속 정보.

    `user.dept`는 부서 ID가 아니라 이름이라 부서 목록으로 옮겨야 한다(`resolveDeptId`).
    프로젝트는 **참여 중인 것만** 모은다 — `useProjects`는 전사 공개 프로젝트까지 돌려주는데,
    그것까지 넣으면 참여하지도 않은 프로젝트의 일정이 보이게 된다.
  */
  const departmentsQuery = useDepartments();
  const deptId = useMemo(
    () => resolveDeptId(departmentsQuery.data ?? [], actor?.dept),
    [departmentsQuery.data, actor],
  );

  const projectAccess = useMemo<ProjectAccessContext>(() => ({
    userId: actor?.id ?? '__anonymous__',
    deptId,
    active: actor?.status === '사용',
  }), [actor, deptId]);
  const projectsQuery = useProjects(projectAccess);
  const myProjects = useMemo(() => {
    const userId = actor?.id ?? '';
    return (projectsQuery.data ?? []).filter(
      (project) => project.ownerUserId === userId || project.memberUserIds.includes(userId),
    );
  }, [projectsQuery.data, actor]);

  const access = useMemo<CalendarEventActor>(() => ({
    userId: actor?.id ?? '__anonymous__',
    deptId,
    projectIds: myProjects.map((project) => project.id),
    active: actor?.status === '사용',
  }), [actor, deptId, myProjects]);
  /** 공유받은 일정의 주인 이름. 내 일정이면 null이라 화면이 아무것도 덧붙이지 않는다. */
  const ownerNameOf = (event?: CalendarEvent): string | null => {
    if (!event || event.ownerUserId === (actor?.id ?? '')) return null;
    return users.find((user) => user.id === event.ownerUserId)?.name ?? '다른 사용자';
  };
  /**
   * 팀 일정 전용 표기 — 이름·부서. 소유자가 나여도 항상 붙인다.
   *
   * `ownerNameOf`는 "내 일정" 탭에서 공유받은 것만 표시하려고 본인 소유는 일부러 null을
   * 준다. 팀 탭에 그대로 쓰면 본인 소유 항목만 아무 표기 없이 떠서 "이름이 안 붙는
   * 버그"처럼 보인다 — 팀 조회는 누구 것이든 항상 밝히는 게 맞아서 따로 둔다.
   */
  const teamLabelOf = (event?: CalendarEvent): string | null => {
    if (!event) return null;
    const user = users.find((row) => row.id === event.ownerUserId);
    if (!user) return '다른 사용자';
    return `${user.name} · ${user.dept}`;
  };

  /*
    업무계획과 동일한 일정 열람 권한 판정:
    - ALL (임원/운영진): 전사 임직원 일정 조회
    - TEAM_AND_LEADERS (팀장급): 본인 부서 팀원 + 타 부서 팀장급 일정 조회
    - TEAM (일반 사원): 본인 부서 팀원 및 팀장의 일정 조회 (타 부서는 비노출)
  */
  const actorScope = useMemo(() => resolveWorkPlanScope(actor, userRoles, org), [actor, userRoles, org]);

  const { data: departmentMembers = [] } = useDepartmentMembers();

  const supervisorScope = useMemo<CalendarSupervisorScope>(() => {
    if (actorScope === 'ALL') {
      return { kind: 'all' };
    }
    // 겸직하고 있는 부서 목록 (손승원 상무의 기술경영전략위원회, 경영기획팀 등)
    const concDeptNames = departmentMembers
      .filter((dm) => dm.userId === actor?.id && !dm.isPrimary)
      .map((dm) => dm.deptName);

    if (actorScope === 'TEAM_AND_LEADERS') {
      const headed = (departmentsQuery.data ?? []).filter((dept) => dept.headUserId === actor?.id).map((dept) => dept.name);
      const myDeptNames = Array.from(new Set([
        ...(headed.length > 0 ? headed : (actor?.dept ? [actor.dept] : [])),
        ...concDeptNames,
      ]));
      return { kind: 'depts', deptNames: myDeptNames };
    }
    // 일반 팀원(사원): 본인 본직 부서 및 겸직 부서 일정 열람
    const myDepts = Array.from(new Set([
      ...(actor?.dept ? [actor.dept] : []),
      ...concDeptNames,
    ]));
    return { kind: 'depts', deptNames: myDepts };
  }, [actorScope, actor, departmentsQuery.data, departmentMembers]);

  const activeTab = tab;
  const isTeam = activeTab === 'team';

  /** 팀 일정의 부서 필터 선택지. 관리자는 전 부서, 팀장은 맡은 부서만. 사원은 본인 부서 고정. */
  const teamDeptOptions = useMemo<string[]>(() => {
    if (actorScope === 'ALL') {
      return (departmentsQuery.data ?? []).map((dept) => dept.name);
    }
    if (actorScope === 'TEAM_AND_LEADERS' && supervisorScope.kind === 'depts') {
      return supervisorScope.deptNames;
    }
    return actor?.dept ? [actor.dept] : [];
  }, [actorScope, supervisorScope, departmentsQuery.data, actor?.dept]);

  /*
    부서 필터의 유효값.
  */
  const effectiveDeptSel = teamDeptSel !== ALL_DEPTS && teamDeptOptions.includes(teamDeptSel)
    ? teamDeptSel
    : (actorScope === 'TEAM' ? (actor?.dept ?? ALL_DEPTS) : ALL_DEPTS);

  /** 특정 부서에 소속된 모든 사용자 ID 목록 (본직 + 겸직 종합) */
  const getDeptUserIds = useCallback((targetDeptName: string): string[] => {
    const primaryUserIds = users.filter((u) => u.dept === targetDeptName && u.status === '사용').map((u) => u.id);
    const concurrentUserIds = departmentMembers
      .filter((dm) => !dm.isPrimary && (dm.deptName === targetDeptName || departmentsQuery.data?.find((d) => d.id === dm.deptId)?.name === targetDeptName))
      .map((dm) => dm.userId);
    return Array.from(new Set([...primaryUserIds, ...concurrentUserIds]));
  }, [users, departmentMembers, departmentsQuery.data]);

  /** 팀 일정의 소유자 목록: 업무계획의 조회 권한과 동일하게 매핑 (본직 + 겸직 지원) */
  const teamOwners = useMemo<string[] | null>(() => {
    if (!actor) return [];

    // 1. 임원: 전체 부서 선택 시 null(전 직원), 특정 부서 선택 시 해당 부서원 (겸직자 포함)
    if (actorScope === 'ALL') {
      if (effectiveDeptSel === ALL_DEPTS) return null;
      return getDeptUserIds(effectiveDeptSel);
    }

    // 2. 팀장: 전체일 때는 본인 부서원 + 타 부서 팀장급
    if (actorScope === 'TEAM_AND_LEADERS') {
      if (effectiveDeptSel !== ALL_DEPTS) {
        return getDeptUserIds(effectiveDeptSel);
      }
      const myDeptUserIds = getDeptUserIds(actor.dept);
      const leaderUserIds = users
        .filter((u) => u.status === '사용' && isLeaderPosition(u.position, u.jobTitle, u.id, org))
        .map((u) => u.id);
      return Array.from(new Set([...myDeptUserIds, ...leaderUserIds]));
    }

    // 3. 일반 사원(TEAM): 오직 본인 부서 소속 팀원들과 팀장의 일정만 조회!
    if (effectiveDeptSel !== ALL_DEPTS) {
      return getDeptUserIds(effectiveDeptSel);
    }
    return getDeptUserIds(actor.dept);
  }, [actor, actorScope, effectiveDeptSel, getDeptUserIds, users, org]);

  const cells = useMemo(() => buildCalendarMonth(month), [month]);
  const range = useMemo(() => ({ from: cells[0].date, to: cells[cells.length - 1].date }), [cells]);
  // 팀 탭이 떠 있는 동안 내 일정 쿼리는 끈다 — 둘 다 전건 로드라 한 화면에 두 번 읽을 이유가 없다.
  const eventsQuery = useCalendarEvents(access, range, !isTeam);
  const teamViewer = useMemo(
    () => ({ userId: actor?.id ?? '__anonymous__', active: actor?.status === '사용' }),
    [actor],
  );
  const teamQuery = useTeamCalendarEvents(teamViewer, teamOwners, range, isTeam && actor !== null);
  // 전자결재 승인 건(휴가·외근·출장) 캘린더 자동 연동
  const approvalsQuery = useAllApprovals();
  const scheduleEvents = useMemo<CalendarEvent[]>(() => {
    const list: CalendarEvent[] = [];
    const schedules = extractApprovedSchedules(approvalsQuery.data ?? []);
    for (const s of schedules) {
      let curr = new Date(s.startDate + 'T00:00:00');
      const last = new Date(s.endDate + 'T00:00:00');
      if (Number.isNaN(curr.getTime()) || Number.isNaN(last.getTime())) continue;

      const isLeave = s.category === 'LEAVE';
      const isTrip = s.category === 'TRIP';
      const eventType: CalendarEventType = isLeave ? 'VACATION' : 'OUTSIDE';
      const typeLabel = isLeave
        ? (s.leaveType || '휴가')
        : (s.subType || (isTrip ? '출장' : '외근'));
      const drafter = s.drafterName || '';

      // 이모지 없이 간결하고 명확한 제목
      const title = isLeave
        ? `[휴가] ${drafter} (${typeLabel})`
        : isTrip
        ? `[출장] ${drafter}${s.destination ? ` (${s.destination})` : ''}`
        : `[외근] ${drafter}${s.destination ? ` (${s.destination})` : ''}`;

      while (curr <= last) {
        const yyyy = curr.getFullYear();
        const mm = String(curr.getMonth() + 1).padStart(2, '0');
        const dd = String(curr.getDate()).padStart(2, '0');
        const dStr = `${yyyy}-${mm}-${dd}`;

        const isAllDay = !s.startTime || !s.endTime || s.startTime >= s.endTime;

        list.push({
          id: `CAL-APPR-${s.docId}-${dStr}`,
          ownerUserId: s.drafterId,
          title,
          date: dStr,
          allDay: isAllDay,
          startTime: isAllDay ? null : s.startTime!,
          endTime: isAllDay ? null : s.endTime!,
          memo: s.body ? `사유: ${s.body}` : '',
          visibility: 'COMPANY',
          eventType,
          attendeeUserIds: [],
          deptId: null,
          projectId: null,
          reminded: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });

        curr.setDate(curr.getDate() + 1);
      }
    }
    return list;
  }, [approvalsQuery.data]);

  const events = eventsQuery.data ?? [];
  /** 지금 탭이 그리는 일정. 달력 격자·날짜 모달이 같은 원천을 쓴다. (회의·미팅 및 전자결재 승인 건 중심 공인 일정만 노출) */
  const rawEvents = useMemo(() => {
    const base = isTeam ? (teamQuery.data ?? []) : events;
    return [...base, ...scheduleEvents].filter(isOfficialCalendarEvent);
  }, [isTeam, teamQuery.data, events, scheduleEvents]);

  /** 현재 사용자 기준 관련 일정 필터링 적용 */
  const visibleEvents = useMemo(() => {
    if (isTeam) return rawEvents;
    if (!actor) return [];
    return rawEvents.filter((event) => {
      if (scopeFilter === 'all') return true;
      if (scopeFilter === 'mine') return event.ownerUserId === actor.id;
      if (scopeFilter === 'attendee') return isAttendeeEvent({ userId: actor.id, deptId, projectIds: access.projectIds ?? [], active: actor.status === '사용' }, event);
      if (scopeFilter === 'company') return isCompanyEvent(event);
      if (scopeFilter === 'team') return event.visibility === 'TEAM' || event.visibility === 'PROJECT';
      return true;
    });
  }, [rawEvents, isTeam, scopeFilter, actor, deptId, access.projectIds]);

  const workActor = useMemo(
    () => ({ userId: actor?.id ?? '__anonymous__', active: actor?.status === '사용' }),
    [actor],
  );
  const myWorkPlansQuery = useMyWorkPlans(workActor, range);
  const createWorkPlan = useCreateWorkPlan();
  const updateWorkPlan = useUpdateWorkPlan();
  const { tags, tagMap } = useWorkPlanConfig();

  /** 선택한 날짜에 해당하는 상세 일정 목록 */
  const selectedDayEvents = useMemo(
    () => visibleEvents.filter((event) => event.date === selectedDate),
    [visibleEvents, selectedDate],
  );

  /** 선택한 날짜의 내 업무 계획 */
  const selectedDayWorkPlan = useMemo(
    () => (myWorkPlansQuery.data ?? []).find((plan) => plan.date === selectedDate),
    [myWorkPlansQuery.data, selectedDate],
  );

  const selectedDayTodos = useMemo(
    () => (selectedDayWorkPlan ? parseWorkPlanItems(selectedDayWorkPlan.content) : []),
    [selectedDayWorkPlan],
  );

  const selectedDayProgress = useMemo(
    () => (selectedDayWorkPlan ? calculatePlanProgress(selectedDayWorkPlan.content) : null),
    [selectedDayWorkPlan],
  );

  const handleToggleTodo = useCallback(async (idx: number) => {
    if (!selectedDayWorkPlan || !actor) return;
    const nextContent = toggleWorkPlanItem(selectedDayWorkPlan.content, idx);
    const updated = await updateWorkPlan.mutateAsync({
      actor: { userId: actor.id, active: actor.status === '사용' },
      id: selectedDayWorkPlan.id,
      draft: { date: selectedDayWorkPlan.date, content: nextContent },
    });
    if (updated) {
      await syncWorkPlanToCalendar(
        { userId: actor.id, active: actor.status === '사용', deptId },
        updated,
        true,
      );
    }
  }, [selectedDayWorkPlan, actor, updateWorkPlan, deptId]);

  const [quickTodoText, setQuickTodoText] = useState('');
  const [quickTodoTag, setQuickTodoTag] = useState('');
  const handleAddQuickTodo = useCallback(async () => {
    if (!quickTodoText.trim() || !actor) return;
    const currentContent = selectedDayWorkPlan?.content ?? '';
    const nextContent = addWorkPlanItem(currentContent, quickTodoText.trim(), quickTodoTag || undefined);
    const actorParam = { userId: actor.id, active: actor.status === '사용' };
    const updated = selectedDayWorkPlan
      ? await updateWorkPlan.mutateAsync({
          actor: actorParam,
          id: selectedDayWorkPlan.id,
          draft: { date: selectedDate, content: nextContent },
        })
      : await createWorkPlan.mutateAsync({
          actor: actorParam,
          draft: { date: selectedDate, content: nextContent },
        });

    if (updated) {
      await syncWorkPlanToCalendar(
        { userId: actor.id, active: actor.status === '사용', deptId },
        updated,
        true,
      );
    }
    setQuickTodoText('');
  }, [quickTodoText, quickTodoTag, selectedDayWorkPlan, selectedDate, actor, createWorkPlan, updateWorkPlan, deptId]);

  const loading = authLoading || usersQuery.isLoading || eventsQuery.isLoading || myWorkPlansQuery.isLoading;

  const queryError = usersQuery.error ?? eventsQuery.error;

  /** 등록·수정 모달로 넘어간다. */
  const openEventModal = (target: {
    date: string;
    event?: CalendarEvent;
    initialTitle?: string;
    initialEventType?: CalendarEventType;
    initialAttendees?: string[];
  }) => {
    setModalTarget(target);
  };

  if (loading) return <div className="grid min-h-[60vh] place-items-center text-[12px] font-semibold text-ink3">일정을 불러오는 중…</div>;
  if (queryError) return <div className="grid min-h-[60vh] place-items-center px-5 text-center text-[12px] font-semibold text-danger">일정을 불러오지 못했습니다.<br />{queryError instanceof Error ? queryError.message : ''}</div>;
  if (!actor) return <div className="grid min-h-[60vh] place-items-center text-[12px] font-semibold text-ink3">사용자 정보를 불러올 수 없습니다.</div>;

  return (
    <div className="mx-auto w-full max-w-[1500px] px-4 py-5 sm:px-6 sm:py-6">
      <GwHead
        icon="📅"
        name="일정관리"
        desc="전사·개인 일정 캘린더: 임직원의 주요 일정 및 사내 일정(외근, 휴가, 회의, 사내행사 등)을 캘린더에 배치해 한눈에 확인하고 조율합니다."
        right={(
          <div className="flex items-center gap-2">
            {!authenticatedUser && (
              <select value={actor.id} onChange={(event) => { setDemoUserId(event.target.value); setModalTarget(null); setTab('me'); setTeamDeptSel(ALL_DEPTS); }} title="사용자 선택" className="h-9 rounded-lg border border-amber/30 bg-amber-soft/30 px-3 text-[10.5px] font-bold text-ink outline-none">
                {users.filter((user) => user.status === '사용').map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
              </select>
            )}

            {/* 사내행사 등록 버튼 (운영자 / 임원만 노출) */}
            {canManageCompanyEvent && (
              <button
                type="button"
                onClick={() => openEventModal({ date: today, initialEventType: 'COMPANY_EVENT' })}
                className="flex items-center gap-1.5 rounded-lg border border-teal/40 bg-teal-soft/30 px-3 py-1.5 text-[11px] font-bold text-teal hover:bg-teal-soft/60 transition-all shadow-2xs"
                title="전사 공통 사내행사 등록 (운영자/임원 권한)"
              >
                <Sparkles size={13} className="text-teal" />
                <span>+ 사내행사 등록</span>
              </button>
            )}

            {/* 팀 일정 탭은 볼 수 있는 사람에게만 보인다 — 없는 권한을 눌러 보게 두지 않는다. */}
            {supervisorScope && (
              <div className="flex items-center gap-0.5 self-center rounded-lg border border-border bg-panel p-0.5">
                {([['me', '내 일정'], ['team', '팀 일정']] as const).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setTab(key)}
                    className={`rounded-md px-3 py-1.5 text-[11.5px] font-bold transition-colors ${activeTab === key ? 'bg-teal text-white' : 'text-ink3 hover:text-ink2'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      />

      {notice && <div aria-live="polite" className="mt-4 rounded-lg border border-teal/20 bg-teal-soft/25 px-3 py-2 text-[10.5px] font-semibold text-teal">{notice}</div>}

      {/* 2열 레이아웃: 좌측(선택한 날의 상세 일정 + 내 To-Do) / 우측(컴팩트 월간 캘린더) */}
      <div className="mt-5 flex flex-col xl:flex-row items-start gap-4">
        {/* ── 좌측 패널: 선택한 날의 상세 일정 & 내 업무계획(To-Do) ── */}
        <aside className="w-full xl:w-[350px] 2xl:w-[380px] shrink-0 space-y-3.5">
          {/* 선택일 헤더 카드 */}
          <div className="rounded-xl border border-border bg-panel p-3.5 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[14px] font-extrabold text-ink">{dayTitle(selectedDate)}</span>
                  {selectedDate === today && (
                    <span className="rounded bg-teal px-1.5 py-0.5 text-[9.5px] font-extrabold text-white">
                      오늘
                    </span>
                  )}
                </div>
                {selectedDate !== today && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedDate(today);
                      setMonth(today.slice(0, 7));
                    }}
                    className="mt-0.5 text-[10px] font-semibold text-teal hover:underline"
                  >
                    오늘 날짜로 이동
                  </button>
                )}
              </div>

              <Button
                size="sm"
                variant="primary"
                onClick={() => openEventModal({ date: selectedDate })}
              >
                + 일정 추가
              </Button>
            </div>
          </div>

          {/* 섹션 1: 선택한 날의 상세 일정 목록 */}
          <div className="rounded-xl border border-border bg-panel p-3.5 shadow-sm">
            <div className="mb-2.5 flex items-center justify-between border-b border-border/60 pb-2">
              <div className="flex items-center gap-1.5">
                <span className="text-[12.5px] font-extrabold text-ink">상세 일정</span>
                <span className="rounded-full bg-panel-alt px-1.5 py-0.2 text-[10px] font-bold text-ink3">
                  {selectedDayEvents.length}건
                </span>
              </div>
            </div>

            {selectedDayEvents.length === 0 ? (
              <div className="py-6 text-center">
                <p className="text-[11px] font-medium text-ink3">등록된 일정이 없습니다.</p>
                <button
                  type="button"
                  onClick={() => openEventModal({ date: selectedDate })}
                  className="mt-1.5 text-[10.5px] font-bold text-teal hover:underline"
                >
                  + 새 일정 등록
                </button>
              </div>
            ) : (
              <div className="space-y-1.5 max-h-[260px] overflow-y-auto pr-0.5">
                {selectedDayEvents.map((event) => {
                  const owner = isTeam ? teamLabelOf(event) : ownerNameOf(event);
                  const masked = isTeam && isMaskedForSupervisor(actor.id, event);
                  const isAppr = event.id.startsWith('CAL-APPR-');
                  const isCompany = event.eventType === 'COMPANY_EVENT';
                  const isMeeting = event.eventType === 'MEETING' || (event.attendeeUserIds && event.attendeeUserIds.length > 0);
                  const isVacation = event.eventType === 'VACATION';
                  const isTrip = event.title.includes('[출장]');
                  const isOutside = event.eventType === 'OUTSIDE' && !isTrip;

                  let badge = <span className="rounded bg-panel-alt px-1.5 py-0.5 text-[9px] font-bold text-ink3">일반</span>;
                  if (isCompany) {
                    badge = <span className="rounded bg-teal-500/15 border border-teal-500/30 px-1.5 py-0.5 text-[9px] font-bold text-teal">사내행사</span>;
                  } else if (isVacation) {
                    badge = <span className="rounded bg-amber-500/15 border border-amber-500/30 px-1.5 py-0.5 text-[9px] font-bold text-amber-600 dark:text-amber-400">휴가</span>;
                  } else if (isTrip) {
                    badge = <span className="rounded bg-indigo-500/15 border border-indigo-500/30 px-1.5 py-0.5 text-[9px] font-bold text-indigo-600 dark:text-indigo-400">출장</span>;
                  } else if (isOutside) {
                    badge = <span className="rounded bg-blue-500/15 border border-blue-500/30 px-1.5 py-0.5 text-[9px] font-bold text-blue">외근</span>;
                  } else if (isMeeting) {
                    badge = <span className="rounded bg-purple-500/15 border border-purple-500/30 px-1.5 py-0.5 text-[9px] font-bold text-purple-600 dark:text-purple-400">회의</span>;
                  }

                  const body = (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between gap-1.5">
                        <div className="flex items-center gap-1.5 min-w-0">
                          {badge}
                          <span className={`truncate text-[11.5px] font-bold ${masked ? 'text-ink3' : 'text-ink'}`}>
                            {event.title}
                          </span>
                        </div>
                        <span className="shrink-0 text-[10px] font-semibold text-teal">
                          {scheduleTime(event)}
                        </span>
                      </div>

                      {/* 전자결재 건은 제목에 이미 이름이 포함되어 있으므로 불필요한 공유 라벨 생략 */}
                      <div className="flex flex-wrap items-center gap-2 text-[10px] text-ink3">
                        {!isAppr && owner && <span>{isTeam ? owner : `공유 · ${owner}`}</span>}
                        {event.attendeeUserIds && event.attendeeUserIds.length > 0 && (
                          <span className="font-semibold text-purple-600 dark:text-purple-400">
                            참여자 {event.attendeeUserIds.length}명
                          </span>
                        )}
                      </div>

                      {event.memo && (
                        <p className="line-clamp-1 text-[10px] text-ink3/80">
                          {event.memo}
                        </p>
                      )}
                    </div>
                  );

                  if (masked) {
                    return (
                      <div key={event.id} className="rounded-lg border border-dashed border-border/70 p-2.5 bg-panel-alt/20">
                        {body}
                      </div>
                    );
                  }

                  return (
                    <button
                      type="button"
                      key={event.id}
                      onClick={() => openEventModal({ date: event.date, event })}
                      className="block w-full rounded-lg border border-border/70 p-2 text-left hover:border-teal/50 hover:bg-teal-soft/15 transition-all shadow-2xs group"
                    >
                      {body}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* 섹션 2: 내 오늘의 업무계획 (To-Do) */}
          <div className="rounded-xl border border-teal/30 bg-teal-soft/10 p-3.5 shadow-sm">
            <div className="mb-2.5 flex items-center justify-between border-b border-teal/20 pb-2">
              <div className="flex items-center gap-1.5">
                <ListTodo size={14} className="text-teal" />
                <span className="text-[12.5px] font-extrabold text-ink">내 업무계획 (To-Do)</span>
              </div>
              <Link
                to={`/gw/work-plan?date=${selectedDate}`}
                className="flex items-center gap-0.5 text-[10.5px] font-bold text-teal hover:underline"
                title="업무계획 화면으로 이동"
              >
                <span>업무계획</span>
                <ExternalLink size={10} />
              </Link>
            </div>

            {/* To-Do 진행률 게이지 */}
            {selectedDayProgress && (
              <div className="mb-2.5 flex items-center justify-between text-[10.5px]">
                <span className="text-ink3 font-medium">
                  진행률: {selectedDayProgress.completed}/{selectedDayProgress.total}건
                </span>
                <span className="font-bold text-teal">{selectedDayProgress.percent}%</span>
              </div>
            )}

            {/* 빠른 To-Do 추가 인풋 */}
            <div className="mb-2.5 flex items-center gap-1 rounded-lg border border-teal/30 bg-white dark:bg-panel p-1 shadow-2xs">
              <select
                value={quickTodoTag}
                onChange={(e) => setQuickTodoTag(e.target.value)}
                className="h-6 rounded border border-border bg-panel-alt/50 px-1 text-[10px] font-bold text-ink outline-none"
              >
                <option value="">태그</option>
                {tags.map((t) => (
                  <option key={t.tag} value={t.tag}>
                    {t.tag}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={quickTodoText}
                onChange={(e) => setQuickTodoText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleAddQuickTodo();
                }}
                placeholder="To-Do 등록 (Enter)"
                className="h-6 flex-1 min-w-0 bg-transparent px-1.5 text-[11px] text-ink outline-none placeholder:text-ink3"
              />
              <button
                type="button"
                onClick={() => void handleAddQuickTodo()}
                disabled={!quickTodoText.trim()}
                className="h-6 rounded bg-teal px-2 text-[10.5px] font-bold text-white hover:opacity-90 disabled:opacity-40 transition-opacity"
              >
                +
              </button>
            </div>

            {/* To-Do 체크리스트 항목들 */}
            {selectedDayTodos.length === 0 ? (
              <div className="py-4 text-center text-[11px] text-ink3 font-medium">
                작성된 업무계획이 없습니다.
              </div>
            ) : (
              <div className="space-y-1 max-h-[220px] overflow-y-auto pr-0.5">
                {selectedDayTodos.map((item, idx) => {
                  if (!item.text && !item.tag && !item.isChecklist) return null;
                  const tagMeta = item.tag ? getWorkPlanTagMeta(item.tag, tagMap) : null;

                  return (
                    <div
                      key={idx}
                      className="group flex items-start gap-1.5 rounded-md p-1 hover:bg-white/60 dark:hover:bg-panel-alt/60 transition-colors"
                    >
                      {item.isChecklist ? (
                        <button
                          type="button"
                          onClick={() => void handleToggleTodo(idx)}
                          className={`mt-0.5 grid h-3.5 w-3.5 shrink-0 place-items-center rounded border transition-colors ${
                            item.completed ? 'border-teal bg-teal text-white' : 'border-border bg-panel hover:border-teal'
                          }`}
                          title={item.completed ? '완료 취소' : '완료 체크'}
                        >
                          {item.completed && <CheckCircle2 size={11} />}
                        </button>
                      ) : (
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ink3" />
                      )}

                      <div className="min-w-0 flex-1 leading-snug">
                        {tagMeta && (
                          <span className={`mr-1 inline-block rounded px-1 py-0.2 text-[9px] font-bold ${tagMeta.badgeClass}`}>
                            {tagMeta.tag}
                          </span>
                        )}
                        <span
                          className={`text-[11px] break-words cursor-pointer ${
                            item.completed ? 'line-through text-ink3' : 'font-medium text-ink'
                          }`}
                          onClick={() => void handleToggleTodo(idx)}
                        >
                          {item.text}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </aside>

        {/* ── 우측 영역: 월간 컴팩트 달력 ── */}
        <div className="flex-1 min-w-0 w-full space-y-3">
          {/* 상단 월 네비게이션 & 필터 툴바 */}
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-panel p-3 shadow-sm">
            <button type="button" onClick={() => setMonth(moveCalendarMonth(month, -1))} aria-label="이전 달" className="grid h-8 w-8 place-items-center rounded-lg border border-border text-ink2 hover:bg-panel-alt">‹</button>
            <Button size="sm" onClick={() => { setMonth(today.slice(0, 7)); setSelectedDate(today); }}>오늘</Button>
            <button type="button" onClick={() => setMonth(moveCalendarMonth(month, 1))} aria-label="다음 달" className="grid h-8 w-8 place-items-center rounded-lg border border-border text-ink2 hover:bg-panel-alt">›</button>
            <h2 className="ml-1 text-[15px] font-extrabold text-ink">{monthLabel(month)}{isTeam ? ' · 팀 일정' : ''}</h2>

            {/* 내 일정 탭일 때: 관련 일정 필터 칩 */}
            {!isTeam && (
              <div className="ml-2 flex flex-wrap items-center gap-1 border-l border-border pl-2">
                {([
                  ['all', '전체 관련 일정', ''],
                  ['mine', '내 일정', ''],
                  ['attendee', '참여 회의·일정', ''],
                  ['company', '사내행사', ''],
                  ['team', '부서·프로젝트', ''],
                ] as const).map(([key, label, icon]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setScopeFilter(key)}
                    className={`flex items-center gap-1 rounded-lg px-2 py-0.5 text-[10.5px] font-bold transition-all ${
                      scopeFilter === key
                        ? 'bg-teal text-white shadow-2xs'
                        : 'bg-panel-alt/70 text-ink3 hover:bg-panel-alt hover:text-ink'
                    }`}
                  >
                    {icon && <span>{icon}</span>}
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            )}

            {isTeam && (
              <>
                {actorScope === 'ALL' ? (
                  <select
                    value={effectiveDeptSel}
                    onChange={(event) => setTeamDeptSel(event.target.value)}
                    title="부서 선택"
                    className="h-7 rounded-lg border border-border bg-panel px-2 text-[10px] font-bold text-ink outline-none"
                  >
                    <option value={ALL_DEPTS}>전체 부서</option>
                    {teamDeptOptions.map((name) => <option key={name} value={name}>{name}</option>)}
                  </select>
                ) : (
                  <span className="rounded-lg border border-teal/25 bg-teal-soft/25 px-2.5 py-1 text-[10px] font-bold text-teal">
                    {actor?.dept ?? '소속 부서'}
                  </span>
                )}
                <span className="text-[10px] font-semibold text-ink3">
                  열람 범위 ·{' '}
                  {actorScope === 'ALL'
                    ? (effectiveDeptSel === ALL_DEPTS ? '전 직원' : effectiveDeptSel)
                    : actorScope === 'TEAM_AND_LEADERS'
                      ? (effectiveDeptSel === ALL_DEPTS ? `${actor?.dept} 팀원 및 타 부서 팀장` : effectiveDeptSel)
                      : `${actor?.dept} (팀원 및 팀장)`}
                </span>
              </>
            )}
            <span className="ml-auto text-[10px] font-semibold text-ink3">
              날짜를 클릭하면 좌측에서 상세 일정과 To-Do를 확인합니다
            </span>
          </div>

          {/* 팀 조회의 로딩·오류는 격자 자리에만 그린다 */}
          {isTeam && teamQuery.isLoading ? (
            <div className="grid min-h-[40vh] place-items-center rounded-xl border border-border bg-panel text-[12px] font-semibold text-ink3">팀 일정을 불러오는 중…</div>
          ) : isTeam && teamQuery.error ? (
            <div className="grid min-h-[40vh] place-items-center gap-2 rounded-xl border border-border bg-panel px-5 text-center text-[12px] font-semibold text-danger">
              팀 일정을 불러오지 못했습니다.
              <Button onClick={() => teamQuery.refetch()}>다시 시도</Button>
            </div>
          ) : (
            <MonthCalendar
              month={month}
              today={today}
              selectedDate={selectedDate}
              events={visibleEvents}
              onSelectDate={(date) => setSelectedDate(date)}
              onAddOn={(date) => openEventModal({ date })}
              onSelectEvent={(event) => {
                if (isTeam && isMaskedForSupervisor(actor.id, event)) return;
                openEventModal({ date: event.date, event });
              }}
              ownerNameOf={isTeam ? (event) => teamLabelOf(event) : undefined}
              isMutedChip={isTeam ? (event) => isMaskedForSupervisor(actor.id, event) : undefined}
            />
          )}
        </div>
      </div>



      {modalTarget && (
        <CalendarEventModal
          key={modalTarget.event?.id ?? `new-${modalTarget.date}`}
          actor={access}
          initialDate={modalTarget.date}
          event={modalTarget.event}
          initialTitle={modalTarget.initialTitle}
          initialEventType={modalTarget.initialEventType}
          initialAttendees={modalTarget.initialAttendees}
          myProjects={myProjects}
          deptName={
            modalTarget.event?.ownerUserId
              ? (users.find((u) => u.id === modalTarget.event?.ownerUserId)?.dept ?? actor?.dept ?? null)
              : (actor?.dept ?? null)
          }
          ownerName={ownerNameOf(modalTarget.event)}
          onClose={() => setModalTarget(null)}
          onSaved={(saved) => {
            setModalTarget(null);
            setMonth(saved.date.slice(0, 7));
            setNotice(`‘${saved.title}’ 일정을 저장했습니다.`);
          }}
          onRemoved={(removed) => {
            setModalTarget(null);
            setNotice(`‘${removed.title}’ 일정을 삭제했습니다.`);
          }}
        />
      )}
    </div>
  );
}

export default function CalendarScreen() {
  return <LocalCalendarScreen />;
}
