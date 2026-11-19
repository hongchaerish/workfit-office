import { CircleHelp, Search, X } from 'lucide-react';
import { useAuthz } from '@/features/authz/useAuthz';
import { useMemo, useState, useEffect } from 'react';
import { useCreateWorkPlanItem, useRemoveWorkPlanItem, useUpdateWorkPlanItem } from '@/features/workPlan/useWorkPlanItems';
import { movedDraft, pastedDraft, type WorkPlanItem } from '@/domain/workPlan/item';
import { useLunchRange } from '@/features/workPlan/useLunchRange';
import { chairToCommittee, isChairAccount } from './components/teamWeekGroups';
import { useRosterOrder } from '@/features/user/useRosterOrder';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/app/auth/AuthProvider';
import { usePermission } from '@/features/auth/usePermission';
import { resolveWorkPlanScope, canViewWorkPlan } from '@/features/auth/scopeHelper';
import { calendarToday, isValidCalendarDate } from '@/domain/calendarEvent/calendarDate';
import type { User } from '@/domain/user/schema';
import { useUsers } from '@/features/user/useUsers';
import { useOrgTree } from '@/features/gw/useOrgTree';
import {
  useCreateWorkPlan,
  useRemoveWorkPlan,
  useSaveWorkPlanMemo,
  useUpdateWorkPlan,
} from '@/features/workPlan/useWorkPlans';
import type { CalendarEvent } from '@/domain/calendarEvent/schema';
import type { DayEntry, MemoPlanRef } from '@/domain/workPlan/dayEntries';
import { monthGridDates, useDayEntryIndex } from '@/features/workPlan/useDayEntryIndex';
import CalendarEventModal from '@/modules/gw/calendar/CalendarEventModal';
import { WorkPlanEventModal } from './event/WorkPlanEventModal';
import type { EventTarget } from './event/eventFormMapping';
import { createTarget, routeEntry } from './event/entryRouting';
import { WorkPlanTeamMonthlyMatrix } from './components/WorkPlanTeamMonthlyMatrix';
import { WorkPlanTeamWeekTable } from './components/WorkPlanTeamWeekTable';
import { WorkPlanCellPopover } from './components/WorkPlanCellPopover';
import { WorkPlanPersonWeekDrawer } from './components/WorkPlanPersonWeekDrawer';
import { useCreateRoom } from '@/features/chat/useChatRooms';
import { openDirectChat } from '@/features/chat/openDirectChat';
import { WorkPlanDayPanel } from './components/WorkPlanDayPanel';
import { WorkPlanMyWeek, mondayOf } from './components/WorkPlanMyWeek';
import { toHHmm, type MinuteRange } from '@/domain/workPlan/timeGrid';
import { firstFreeStart } from '@/domain/workPlan/freeSlots';
import { busyRangeOf, recentItemTitles } from './components/dayDetail';
import type { EventKind } from './event/useWorkPlanEventForm';
import { WorkPlanCompanyScheduleModal } from './components/WorkPlanCompanyScheduleModal';
import { GwHead } from '@/modules/gw/_gw';
import { OutsideWorkDetailModal } from '@/modules/gw/outsideWork/OutsideWorkDetailModal';
import type { OutsideScheduleView } from '@/domain/outsideWork/view';
import { resolveDeptId } from '@/domain/department/engine';
import { useDepartments } from '@/features/department/useDepartments';


/** 보기 — 주간(기본, 전원 한 주) / 월간 표 / 내 주간 시간표 */
type WorkPlanView = 'teamWeek' | 'team' | 'week';
const VIEW_OPTIONS: Array<{ id: WorkPlanView; label: string }> = [
  { id: 'teamWeek', label: '주간' },
  { id: 'team', label: '월간' },
  { id: 'week', label: '내 주간' },
];
/** 고른 보기·밀도를 이 브라우저에 기억한다(없거나 막혀 있으면 기본값) */
const VIEW_STORAGE_KEY = 'workPlan.view';
/** 고른 부서(모바일과 같은 값) */
const DEPT_STORAGE_KEY = 'workPlan.dept';
/** 첫 사용 안내를 닫았는지 */
const GUIDE_STORAGE_KEY = 'workPlan.guideSeen';
function readStoredText(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function readStored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = window.localStorage.getItem(key);
    return allowed.includes(v as T) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeStored(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // 저장이 막혀 있어도 이번 화면에서는 바뀐다
  }
}
/** 저장 알림 토스트가 떠 있는 시간(ms) */
const NOTICE_MS = 3000;
/** 되돌리기가 붙은 알림이 떠 있는 시간(ms) */
const UNDO_MS = 4000;

/** 지금 시각(분) — 상세 창의 '지금'·빈 시간에 쓴다 */
const minuteOfNow = () => {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
};

export default function WorkPlanScreen() {
  const { user: authenticatedUser } = useAuth();
  const { userRoles } = usePermission();
  // 태그 관리 수정 — 최고관리자·'팀·전사 업무 종합 현황' 수정 권한자 전용
  const { can: canAuthz } = useAuthz();
  const canManageWorkPlan = canAuthz('workplan.manage');
  const org = useOrgTree();
  const usersQuery = useUsers();
  // 실제 회사 운영 원칙: 퇴사자(status === '미사용' 또는 resignedAt)는 업무계획 로스터/부서원/일정에서 100% 원천 배제
  // 업무계획 한정: 위원장(대표이사 계정)은 기술경영전략위원회 소속으로 — 부서 필터·주간·월간이 모두 따른다
  const users = useMemo(() => {
    return chairToCommittee((usersQuery.data ?? []).filter((u) => u.status === '사용' && !u.resignedAt), isChairAccount);
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

  /** 업무계획 일정 창 — 새 일정·수정·보기 공용. key는 대상이 바뀔 때마다 새로 띄우기 위한 것. */
  const [eventModal, setEventModal] = useState<{ key: number; target: EventTarget } | null>(null);
  /** 회의 외 캘린더 일정(사내행사 등) 상세 */
  const [calendarEvent, setCalendarEvent] = useState<CalendarEvent | null>(null);
  /** 결재 완료 외근·출장과 동행 외근 상세 — 수정은 등록 본인이 일정 창으로 */
  const [outsideDetail, setOutsideDetail] = useState<{ view: OutsideScheduleView; entry: DayEntry } | null>(null);
  /** 화면 아래 알림 — 되돌리기가 붙을 수 있다 */
  const [notice, setNotice] = useState<{ text: string; undo?: () => void } | null>(null);
  const notify = (text: string) => setNotice(text ? { text } : null);
  const updateItem = useUpdateWorkPlanItem();
  const createItem = useCreateWorkPlanItem();
  const removeItem = useRemoveWorkPlanItem();
  const createRoom = useCreateRoom();
  // 저장 알림은 화면 아래 토스트 — 잠깐 보였다 사라진다
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), notice.undo ? UNDO_MS : NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);
  /** 지금 시각(분) — 1분마다 */
  const [nowMinute, setNowMinute] = useState(minuteOfNow);
  useEffect(() => {
    const timer = window.setInterval(() => setNowMinute(minuteOfNow()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

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

  // ── 부서 및 검색 필터 ──
  const [deptFilter, setDeptFilterState] = useState<string>(() => readStoredText(DEPT_STORAGE_KEY) || 'all');
  const setDeptFilter = (value: string) => {
    setDeptFilterState(value);
    writeStored(DEPT_STORAGE_KEY, value);
  };
  /** 첫 사용 안내 — 한 번 닫으면 다시 뜨지 않는다 */
  const [guideOpen, setGuideOpen] = useState(() => !readStoredText(GUIDE_STORAGE_KEY));
  const closeGuide = () => {
    setGuideOpen(false);
    writeStored(GUIDE_STORAGE_KEY, '1');
  };
  /** 상단 바 오른쪽 ? — 언제든 도움말을 켜고 끈다 */
  const toggleGuide = () => (guideOpen ? closeGuide() : setGuideOpen(true));
  const [searchKeyword, setSearchKeyword] = useState<string>('');

  const create = useCreateWorkPlan();
  const update = useUpdateWorkPlan();
  const remove = useRemoveWorkPlan();
  const saveMemo = useSaveWorkPlanMemo();

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


  /** 고유 부서 목록 (소속 인원이 1명 이상 있는 부서만 자동 표시 & 조직도 배치순 정렬) */
  const departments = useMemo(() => {
    const memberCountByDept = new Map<string, number>();

    // A. 본직 인원 카운트
    roster.forEach((u) => {
      memberCountByDept.set(u.dept, (memberCountByDept.get(u.dept) ?? 0) + 1);
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
  }, [roster, deptOrderMap]);

  /** 부서 및 검색어 필터가 적용된 최종 열람 인원 — 겸직자는 본직 부서로만 */
  const scopedMembers = useMemo(() => {
    if (!actor) return [];

    const kw = searchKeyword.trim().toLowerCase();

    // 1. 특정 부서 필터 선택 시 — 본직 소속자만(겸직은 업무계획에 본직으로만 나온다). 기억해 둔 부서가 없어졌으면 전체
    if (deptFilter !== 'all' && departments.includes(deptFilter)) {
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

      const sorted = matchedUsers.sort(compareRoster);

      return sorted.filter((u) => {
        if (!kw) return true;
        return u.name.toLowerCase().includes(kw) || u.dept.toLowerCase().includes(kw);
      });
    }

    // 2. 전체(all) 필터
    return roster.filter((user) => !kw || user.name.toLowerCase().includes(kw) || user.dept.toLowerCase().includes(kw));
  }, [users, roster, deptFilter, searchKeyword, actor, compareRoster, departments]);

  // 겸직자도 본직 부서에만 — 주간 표는 걸러진 인원 그대로
  const weekTableMembers = scopedMembers;

  /** 칸 옆 상세 창 — 누른 칸 */
  const [cellPopover, setCellPopover] = useState<{ member: User; date: string; anchor: HTMLElement } | null>(null);
  /** 이름을 누르면 여는 한 주 서랍 */
  const [personDrawer, setPersonDrawer] = useState<User | null>(null);

  const [view, setViewState] = useState<WorkPlanView>(() => readStored(VIEW_STORAGE_KEY, ['teamWeek', 'team', 'week'], 'teamWeek'));
  const setView = (next: WorkPlanView) => {
    setViewState(next);
    // 보기를 바꾸면 맨 위부터 — 이전 보기의 스크롤 위치로 들어가지 않게
    window.scrollTo({ top: 0 });
    writeStored(VIEW_STORAGE_KEY, next);
  };
  /** 주간·내 주간이 보고 있는 주의 월요일 */
  const [weekStart, setWeekStart] = useState(() => mondayOf(initialDate ?? today));
  /** 주간 표가 보고 있는 월~일 */
  const teamWeekDates = useMemo(
    () => Array.from({ length: 7 }, (_, i) => {
      const [y, m, d] = weekStart.split('-').map(Number);
      return new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10);
    }),
    [weekStart],
  );
  /** 하루 상세 팝업의 날짜(닫혀 있으면 null) */
  const [panelDate, setPanelDate] = useState<string | null>(null);

  /** 보고 있는 달 — 칸 조립(표·일정 창 시간표 공용)을 여기서 한 번 하고 표에 내려 준다 */
  const [month, setMonth] = useState(() => (initialDate ?? today).slice(0, 7));
  // 주 보기는 그 주 월요일이 든 달 화면 범위(그 주 7일이 모두 든다)
  const weekView = view === 'week' || view === 'teamWeek';
  const dataMonth = weekView ? weekStart.slice(0, 7) : month;
  const monthDates = useMemo(() => {
    const base = monthGridDates(dataMonth);
    // 하루 상세 팝업에서 다른 달로 넘어가도 그날 칸이 있게 그 달 범위를 더한다
    if (!panelDate || base.includes(panelDate)) return base;
    return [...new Set([...base, ...monthGridDates(panelDate.slice(0, 7))])].sort();
  }, [dataMonth, panelDate]);
  const { cellOf, workPlans } = useDayEntryIndex({ actor, deptId, members: scopedMembers, dates: monthDates });

  const actorActive = actor?.status === '사용';

  const openEventModal = (target: EventTarget) => {
    setEventModal((prev) => ({ key: (prev?.key ?? 0) + 1, target }));
  };

  /**
   * 칸 누르기·[+] — 시간을 주지 않으면 그날 첫 빈 1시간(회의면 참석자 모두 비는 때, 오늘이면 지금 이후).
   * 빈 때가 없으면 예전 기본값(오늘이면 지금 다음 30분, 아니면 09:00~09:30). 주간 시간표는 누른 시각(range).
   */
  const lunch = useLunchRange();
  const handleCreateWith = (date: string, member: User, opts: { range?: MinuteRange; kind?: EventKind; attendeeIds?: string[] } = {}) => {
    if (!actor) return;
    const base = createTarget(date, member, actor, today, new Date());
    const people = [member.id, ...(opts.attendeeIds ?? [])];
    const busy = (id: string) => cellOf(id, date).entries.map(busyRangeOf).filter((r): r is MinuteRange => r !== null);
    const free = opts.range ? null : firstFreeStart([...new Set(people)].map(busy), 60, { lunch }); // 오늘이어도 하루의 첫 빈 시각(지금 이후로 밀지 않는다 — 오전·오후 초반 업무를 적기 쉽게)
    const range = opts.range ?? (free !== null ? { start: free, end: free + 60 } : undefined);
    openEventModal({
      ...base,
      ...(range ? { initialRange: range } : {}),
      ...(opts.kind ? { initialKind: opts.kind } : {}),
      ...(opts.attendeeIds ? { initialAttendeeIds: opts.attendeeIds } : {}),
    });
  };
  const handleCreate = (date: string, member: User, range?: MinuteRange) => handleCreateWith(date, member, { range });

  /** 최근 적은 내 업무 제목 — 보고 있는 범위에서 최근 날짜부터 */
  const recentTitles = useMemo(() => {
    if (!actor) return [];
    const entries = [...monthDates].filter((d) => d <= today).reverse().flatMap((d) => [...cellOf(actor.id, d).entries].reverse());
    return recentItemTitles(entries);
  }, [actor, monthDates, cellOf, today]);

  /** 복사한 내 업무 — 있는 동안 주간 표의 내 칸을 누르면 그날에 같은 일을 만든다(여러 날 연달아 가능, Esc·취소로 끝) */
  const [clipboard, setClipboard] = useState<WorkPlanItem | null>(null);
  useEffect(() => {
    if (!clipboard) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) setClipboard(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [clipboard]);
  const handlePaste = (date: string, startMinute?: number) => {
    if (!actor || !clipboard) return;
    const who = { userId: actor.id, active: actorActive };
    createItem.mutate(
      { actor: who, ownerUserId: actor.id, draft: pastedDraft(clipboard, date, startMinute) },
      {
        onSuccess: (created) =>
          setNotice({
            text: `${Number(date.slice(5, 7))}월 ${Number(date.slice(8))}일에 "${clipboard.title}"을(를) 붙여넣었어요`,
            undo: () =>
              removeItem.mutate(
                { actor: who, id: created.id },
                { onSuccess: () => notify('되돌렸어요.'), onError: (e) => notify(e instanceof Error ? e.message : '되돌리지 못했습니다.') },
              ),
          }),
        onError: (e) => notify(e instanceof Error ? e.message : '붙여넣지 못했습니다.'),
      },
    );
  };

  /** 상세 창에서 내 일반 업무 바로 지우기 — 4초 동안 되돌리기(같은 내용으로 다시 만든다) */
  const handleRemoveItem = (item: WorkPlanItem) => {
    if (!actor) return;
    const who = { userId: actor.id, active: actorActive };
    removeItem.mutate(
      { actor: who, id: item.id },
      {
        onSuccess: () =>
          setNotice({
            text: `"${item.title}" 일정을 지웠어요`,
            undo: () =>
              createItem.mutate(
                { actor: who, ownerUserId: item.ownerUserId, draft: movedDraft(item, item.date) },
                { onSuccess: () => notify('되돌렸어요.'), onError: (e) => notify(e instanceof Error ? e.message : '되돌리지 못했습니다.') },
              ),
          }),
        onError: (e) => notify(e instanceof Error ? e.message : '지우지 못했습니다.'),
      },
    );
  };

  /** 메신저 1:1 대화 — 글이 있으면 입력창에 미리 채운다 */
  const handleMessage = (member: User, text?: string) => {
    if (!actor) return;
    openDirectChat({ me: actor, other: member, text, createRoom: (i) => createRoom.mutateAsync(i) }).catch((e) =>
      notify(`대화방을 열지 못했습니다: ${e instanceof Error ? e.message : String(e)}`),
    );
  };

  /** 내 칸 메모 저장 — 비우면 지우고, 있으면 고치고, 없으면 만든다 */
  const handleSaveMemo = async (date: string, memoPlan: MemoPlanRef | null, text: string) => {
    if (!actor) return;
    await saveMemo.mutateAsync({ actor: { userId: actor.id, active: actorActive }, ownerUserId: actor.id, date, memoPlan, text });
  };

  /** 내 일반 업무를 옮긴다 — 날짜와, 시간표에서 옮겼다면 시각만 바뀐다 */
  /** 끌어 놓기 — 그냥 놓으면 이동, Ctrl 을 누른 채 놓으면 복사(날짜·시각만 놓은 자리로). 둘 다 되돌리기 */
  const handleMoveItem = (item: WorkPlanItem, date: string, range?: MinuteRange, copy = false) => {
    if (!actor) return;
    const who = { userId: actor.id, active: actorActive };
    const when = `${Number(date.slice(5, 7))}월 ${Number(date.slice(8))}일${range ? ` ${toHHmm(range.start)}` : ''}`;
    const undoDone = { onSuccess: () => notify('되돌렸어요.'), onError: (e: unknown) => notify(e instanceof Error ? e.message : '되돌리지 못했습니다.') };
    if (copy) {
      createItem.mutate(
        { actor: who, ownerUserId: actor.id, draft: movedDraft(item, date, range) },
        {
          onSuccess: (created) =>
            setNotice({ text: `${when}에 "${item.title}"을(를) 복사했어요`, undo: () => removeItem.mutate({ actor: who, id: created.id }, undoDone) }),
          onError: (e) => notify(e instanceof Error ? e.message : '복사하지 못했습니다.'),
        },
      );
      return;
    }
    updateItem.mutate(
      { actor: who, id: item.id, draft: movedDraft(item, date, range) },
      {
        onSuccess: () =>
          setNotice({
            text: `${when}(으)로 옮겼어요`,
            // 원래 날짜·시각 그대로 되돌린다
            undo: () => updateItem.mutate({ actor: who, id: item.id, draft: movedDraft(item, item.date) }, undoDone),
          }),
        onError: (e) => notify(e instanceof Error ? e.message : '옮기지 못했습니다.'),
      },
    );
  };

  /** 칩 클릭 — 수정·보기 일정 창, 결재·동행 외근 상세, 회의 외 캘린더 일정 창([[entryRouting]]) */
  const handleOpenEntry = (entry: DayEntry) => {
    if (!actor) return;
    const route = routeEntry(entry, actor, actorActive);
    if (!route) return;
    if ('sheet' in route) openEventModal(route.sheet);
    else if ('calendar' in route) setCalendarEvent(route.calendar);
    else setOutsideDetail(route.outside);
  };

  const loading = usersQuery.isLoading;

  // 보기 전환 — 각 보기의 상단 바 맨 앞에 놓인다
  const viewSwitch = (
    <div className="inline-flex rounded-lg bg-panel-alt p-0.5" role="radiogroup" aria-label="보기">
      {VIEW_OPTIONS.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={view === option.id}
          onClick={() => setView(option.id)}
          className={`rounded-md px-2.5 py-1 text-[11.5px] font-semibold transition-colors ${
            view === option.id ? 'bg-panel text-ink shadow-sm' : 'text-ink3 hover:text-ink'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );

  const helpButton = (
    <button
      type="button"
      onClick={toggleGuide}
      aria-label={guideOpen ? '도움말 닫기' : '도움말'}
      aria-pressed={guideOpen}
      title={guideOpen ? '도움말 닫기' : '도움말'}
      className={`grid h-7 w-7 shrink-0 place-items-center rounded-md transition-colors hover:bg-panel-alt ${guideOpen ? 'bg-panel-alt text-teal' : 'text-ink3 hover:text-ink'}`}
    >
      <CircleHelp size={16} />
    </button>
  );

  // 부서 필터·검색 — 주간·월간 표 상단 고정 바에 놓인다
  const filters = (
    <>
      <select
        value={deptFilter}
        onChange={(e) => setDeptFilter(e.target.value)}
        title="부서 필터"
        className="h-7 rounded-md border border-transparent bg-panel-alt px-2 text-[11.5px] font-medium text-ink2 outline-none hover:text-ink focus:border-border focus:bg-panel"
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
          className="h-7 w-full rounded-md border border-transparent bg-panel-alt pl-7 pr-7 text-[11.5px] text-ink placeholder:text-ink3 outline-none focus:border-border focus:bg-panel"
        />
        <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink3" />
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
      {helpButton}
    </>
  );

  if (loading) return <div className="grid min-h-[calc(60vh/var(--font-scale,1))] place-items-center text-[12px] font-semibold text-ink3">불러오는 중…</div>;
  if (!actor) return <div className="grid min-h-[calc(60vh/var(--font-scale,1))] place-items-center text-[12px] font-semibold text-ink3">사용자 정보를 불러올 수 없습니다.</div>;

  return (
    <div className="mx-auto w-full max-w-[1500px] px-4 py-5 sm:px-6 sm:py-6 space-y-4">
      <GwHead
        icon="🗓️"
        name="업무계획"
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

      {/* 사용 안내 — 처음 한 번 저절로, 그 뒤엔 상단 바 오른쪽 ? 로 켜고 끈다 */}
      {guideOpen && (
        <div role="complementary" aria-label="업무계획 사용법" className="fixed bottom-6 right-6 z-30 w-[300px] rounded-xl border border-border bg-panel p-4 shadow-xl">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[13px] font-extrabold text-ink">업무계획 사용법</h3>
            <button type="button" onClick={closeGuide} aria-label="도움말 닫기" className="rounded p-0.5 text-ink3 hover:text-ink">
              <X size={14} />
            </button>
          </div>
          <ul className="space-y-1.5 text-[12px] leading-relaxed text-ink2">
            <li><b className="text-ink">칸</b> 누르기 — 그날 일정</li>
            <li><b className="text-ink">내 칸 +</b> — 새 일정</li>
            <li><b className="text-ink">이름</b> 누르기 — 그 사람의 한 주</li>
            <li><b className="text-ink">끌어 놓기</b> — 이동, <b className="text-ink">Ctrl</b>+끌기 — 복사</li>
            <li><b className="text-ink">복사</b> 후 내 칸 누르기 — 붙여넣기</li>
            <li><span className="font-semibold text-orange-700 dark:text-orange-300">주황 이름</span> — 이번 주 미작성</li>
          </ul>
        </div>
      )}

      {/* 저장 알림 — 왼쪽 아래 토스트(화면을 밀지 않는다). 가운데에 두면 그날 상세 창 아래 버튼을 가린다 — 왼쪽은 부서·이름 칸이라 상세 창이 열리지 않는다 */}
      <div aria-live="polite" className="pointer-events-none fixed bottom-6 left-6 z-[60] flex max-w-[calc(100vw-3rem)] flex-col items-start gap-2">
        {clipboard && (
          <div className="pointer-events-auto flex items-center gap-3 rounded-lg border border-teal/40 bg-panel px-4 py-2 text-[12px] font-semibold text-ink shadow-lg">
            <span className="max-w-[22rem] truncate">"{clipboard.title}" 복사함 — 붙여넣을 {view === 'week' ? '날짜나 시간' : '내 칸'}을 누르세요</span>
            <button type="button" onClick={() => setClipboard(null)} className="text-ink3 hover:text-ink">
              그만 (Esc)
            </button>
          </div>
        )}
        {notice && (
          <div className="pointer-events-auto flex max-w-[26rem] items-center gap-3 rounded-lg bg-ink px-4 py-2 text-[12px] font-semibold text-panel shadow-lg">
            <span className="min-w-0 truncate">{notice.text}</span>
            {notice.undo && (
              <button
                type="button"
                onClick={() => {
                  const undo = notice.undo;
                  setNotice(null);
                  undo?.();
                }}
                className="shrink-0 text-sky-300 hover:text-sky-200"
              >
                되돌리기
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── 메인 뷰: 주간 / 월간 / 내 주간 ── */}
      {view === 'week' && (
        <WorkPlanMyWeek
          viewSwitch={viewSwitch}
          helpButton={helpButton}
          actor={actor}
          weekStart={weekStart}
          onWeekChange={setWeekStart}
          cellOf={cellOf}
          onOpenEntry={handleOpenEntry}
          onCreate={actorActive ? handleCreate : undefined}
          onMoveItem={actorActive ? handleMoveItem : undefined}
          onPaste={clipboard && actorActive ? handlePaste : undefined}
        />
      )}
      {view === 'teamWeek' && (
        <WorkPlanTeamWeekTable
          actor={actor}
          todayStr={today}
          weekStart={weekStart}
          onWeekChange={setWeekStart}
          members={weekTableMembers}
          cellOf={cellOf}
          workPlans={workPlans}
          viewSwitch={viewSwitch}
          filters={filters}
          forceOpen={deptFilter !== 'all' || searchKeyword.trim() !== ''}
          onOpenCompanySchedule={(date, content, planId) => setCompanyScheduleModal({ isOpen: true, date, content, planId })}
          onOpenCell={(member, date, anchor) => setCellPopover({ member, date, anchor })}
          onOpenPerson={setPersonDrawer}
          onCreate={actorActive ? handleCreate : undefined}
          onMoveItem={actorActive ? handleMoveItem : undefined}
          selected={cellPopover ? { userId: cellPopover.member.id, date: cellPopover.date } : null}
          onOpenDay={(date) => {
            setCellPopover(null);
            setPanelDate(date);
          }}
          onPaste={clipboard && actorActive ? handlePaste : undefined}
          onSaveMemo={actorActive ? handleSaveMemo : undefined}
        />
      )}
      {view === 'team' && (
      <WorkPlanTeamMonthlyMatrix
        viewSwitch={viewSwitch}
        weekStart={null}
        onWeekChange={setWeekStart}
        actor={actor}
        todayStr={initialDate ?? today}
        members={scopedMembers}
        month={month}
        onMonthChange={setMonth}
        cellOf={cellOf}
        workPlans={workPlans}
        onCreate={actorActive ? handleCreate : undefined}
        onPaste={clipboard && actorActive ? handlePaste : undefined}
        onOpenEntry={handleOpenEntry}
        onMoveItem={actorActive ? handleMoveItem : undefined}
        onSaveMemo={actorActive ? handleSaveMemo : undefined}
        // 부서 필터·검색 — 상단 고정 바에 함께 놓인다
        filters={filters}
        onOpenCompanySchedule={(date, content, planId) =>
          setCompanyScheduleModal({ isOpen: true, date, content, planId })
        }
        onOpenDay={setPanelDate}
        selectedDate={panelDate}
      />
      )}

      {/* 칸 옆 그날 상세 — 주간 표에서 칸을 누르면 */}
      {view === 'teamWeek' && cellPopover && (
        <WorkPlanCellPopover
          actor={actor}
          member={cellPopover.member}
          date={cellPopover.date}
          anchor={cellPopover.anchor}
          today={today}
          nowMinute={nowMinute}
          cellOf={cellOf}
          weekDates={teamWeekDates}
          onDateChange={(date) => setCellPopover((prev) => (prev ? { ...prev, date } : prev))}
          onClose={() => setCellPopover(null)}
          onOpenEntry={handleOpenEntry}
          onCreate={actorActive ? handleCreateWith : undefined}
          onRemoveItem={actorActive ? handleRemoveItem : undefined}
          onCopyItem={actorActive ? setClipboard : undefined}
          onSaveMemo={actorActive ? handleSaveMemo : undefined}
          onOpenWeek={(member) => {
            setCellPopover(null);
            setPersonDrawer(member);
          }}
          onMessage={handleMessage}
        />
      )}
      {view === 'teamWeek' && personDrawer && (
        <WorkPlanPersonWeekDrawer
          member={personDrawer}
          weekDates={teamWeekDates}
          today={today}
          cellOf={cellOf}
          onClose={() => setPersonDrawer(null)}
          onOpenEntry={handleOpenEntry}
        />
      )}

      {/* 하루 상세 팝업 — 주간·월간에서 날짜 머리나 남의 칸을 누르면 */}
      {panelDate && view !== 'week' && (
        <WorkPlanDayPanel
          date={panelDate}
          today={today}
          actor={actor}
          members={scopedMembers}
          cellOf={cellOf}
          onDateChange={setPanelDate}
          onClose={() => setPanelDate(null)}
          onOpenEntry={handleOpenEntry}
          onCreate={actorActive ? handleCreate : undefined}
        />
      )}

      {/* 업무계획 일정 창 — 일반·회의·외근·출장 */}
      {eventModal && (
        <WorkPlanEventModal
          key={eventModal.key}
          target={eventModal.target}
          actor={actor}
          deptId={deptId}
          users={users}
          cellOf={cellOf}
          onClose={() => setEventModal(null)}
          onSaved={notify}
          recentTitles={recentTitles}
          canEditTags={canManageWorkPlan}
          onCopyItem={actorActive ? setClipboard : undefined}
          onSavedAndNext={(date) => handleCreate(date, actor)}
        />
      )}

      {/* 회의 외 캘린더 일정(사내행사 등) — 캘린더 일정 창 그대로 */}
      {calendarEvent && (
        <CalendarEventModal
          actor={calendarActor}
          initialDate={calendarEvent.date}
          event={calendarEvent}
          myProjects={[]}
          deptName={actor.dept || null}
          ownerName={
            calendarEvent.ownerUserId !== actor.id
              ? users.find((u) => u.id === calendarEvent.ownerUserId)?.name ?? null
              : null
          }
          onClose={() => setCalendarEvent(null)}
          onSaved={() => {
            setCalendarEvent(null);
            notify('일정을 저장했습니다.');
          }}
          onRemoved={() => {
            setCalendarEvent(null);
            notify('일정을 삭제했습니다.');
          }}
        />
      )}

      {outsideDetail && (
        <OutsideWorkDetailModal
          view={outsideDetail.view}
          viewer={{ userId: actor.id, active: actorActive, dept: actor.dept }}
          users={users}
          onClose={() => setOutsideDetail(null)}
          // 등록 본인만 수정 버튼이 보인다 — 동행 칸에서 열었어도 본인 칸 기준으로 일정 창을 연다
          onEdit={() => openEventModal({ mode: 'edit', entry: { ...outsideDetail.entry, companionOf: undefined } })}
        />
      )}


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
              notify('전사 주요 일정을 삭제했습니다.');
            }
            return;
          }
          if (planId) {
            await update.mutateAsync({ actor: actorParam, id: planId, draft: { date, content } });
          } else {
            await create.mutateAsync({ actor: actorParam, draft: { date, content, ownerUserId: '__COMPANY__' } });
          }
          notify('전사 주요 일정을 저장했습니다.');
        }}
        onDelete={async (planId, _date) => {
          if (!actor) return;
          await remove.mutateAsync({ actor: { userId: actor.id, active: actor.status === '사용' }, id: planId });
          notify('전사 주요 일정을 삭제했습니다.');
        }}
      />
    </div>
  );
}
