import { useState, useMemo, useRef, useEffect, useLayoutEffect, Fragment } from 'react';
import type { User } from '@/domain/user/schema';
import type { WorkPlan } from '@/domain/workPlan/schema';
import {
  parseWorkPlanItems,
  calculatePlanProgress,
} from '@/domain/workPlan/engine';
import {
  buildCalendarMonth,
  moveCalendarMonth,
} from '@/domain/calendarEvent/calendarDate';
import { useAllWorkPlans } from '@/features/workPlan/useWorkPlans';
import { useAllApprovals } from '@/features/gw/useApprovals';
import { extractApprovedSchedules, isDateInSchedule } from '@/domain/approvalDoc/scheduleEngine';
import { useCalendarEvents } from '@/features/calendar/useCalendarEvents';
import { isOfficialCalendarEvent } from '@/domain/calendarEvent/engine';
import { extractTimeFromText, isWorkPlanDerivedEvent } from '@/domain/workPlan/workPlanCalendarBridge';
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Check,
  Calendar as CalendarIcon,
  Settings,
  LocateFixed,
} from 'lucide-react';

const WEEKDAYS_KO_MON = ['월', '화', '수', '목', '금', '토', '일'];

interface DayInfo {
  dateStr: string;
  dayNum: number;
  monthNum: number;
  weekdayKo: string;
  dayOfWeek: number;
  isSat: boolean;
  isSun: boolean;
  isToday: boolean;
  inCurrentMonth: boolean;
}

interface WeekBlock {
  weekNum: number;
  label: string;
  hasToday: boolean;
  days: DayInfo[];
}

interface WorkPlanTeamMonthlyMatrixProps {
  actor: User;
  todayStr: string;
  members: User[];
  deptId?: string | null;
  activeEditing?: { date: string; userId: string } | null;
  editingContent?: string;
  onEditingContentChange?: (val: string | ((prev: string) => string)) => void;
  onSaveEditing?: () => void;
  onCancelEditing?: () => void;
  onOpenEditor: (date: string, plan?: WorkPlan, targetUser?: User) => void;
  onOpenConfig?: () => void;
  onToggleItem?: (plan: WorkPlan, itemIdx: number) => void;
}

/** 셀 내부에서 세로 스크롤 없이 늘어난 칸 그대로 보여주는 인라인 에디터 */
function InlineCellTextarea({
  value,
  onChange,
  onBlur,
  onSave,
  onCancel,
}: {
  value: string;
  onChange: (val: string) => void;
  onBlur: () => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // 글자가 늘어나거나 줄어들 때 세로 스크롤바 없이 칸 전체 높이를 동적으로 정확히 확장
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${Math.max(65, el.scrollHeight)}px`;
    }
  }, [value]);

  return (
    <div className="w-full">
      <textarea
        ref={textareaRef}
        autoFocus
        rows={1}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        onClick={(e) => {
          e.stopPropagation();
        }}
        onBlur={(e) => {
          // 상단 리본 메뉴 영역을 조작 중인 경우 닫지 않고 유지
          const nextTarget = e.relatedTarget as HTMLElement | null;
          if (nextTarget && nextTarget.closest('[data-workplan-ribbon="true"]')) {
            return;
          }
          const activeEl = document.activeElement as HTMLElement | null;
          if (activeEl && activeEl.closest('[data-workplan-ribbon="true"]')) {
            return;
          }
          onBlur();
        }}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            onSave();
            return;
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
            return;
          }
        }}
        placeholder=""
        style={{
          overflow: 'hidden',
          overflowY: 'hidden',
          resize: 'none',
          display: 'block',
        }}
        className="w-full rounded border border-blue-500 bg-white dark:bg-panel p-1.5 text-[10px] leading-relaxed text-ink outline-none font-sans focus:ring-1 focus:ring-blue-500 shadow-2xs"
      />
    </div>
  );
}

export function WorkPlanTeamMonthlyMatrix({
  actor,
  todayStr,
  members,
  deptId,
  activeEditing,
  editingContent = '',
  onEditingContentChange,
  onSaveEditing,
  onCancelEditing,
  onOpenEditor,
  onOpenConfig,
  onToggleItem,
}: WorkPlanTeamMonthlyMatrixProps) {
  // 현재 조회 중인 월 (YYYY-MM)
  const [currentMonth, setCurrentMonth] = useState<string>(() => todayStr.slice(0, 7));
  const currentWeekRef = useRef<HTMLTableRowElement>(null);

  // 1. 달력 월간 셀을 바탕으로 일주일(월~일 7일) 단위 주차(WeekBlock) 목록 생성
  const weeks = useMemo(() => {
    let cells: { date: string; inCurrentMonth: boolean }[] = [];
    try {
      cells = buildCalendarMonth(currentMonth);
    } catch {
      cells = [];
    }

    const list: WeekBlock[] = [];
    for (let i = 0; i < cells.length; i += 7) {
      const chunk = cells.slice(i, i + 7);
      // 이번 달 날짜가 하루라도 포함된 주차만 포함
      const hasCurrentMonth = chunk.some((c) => c.inCurrentMonth);
      if (!hasCurrentMonth) continue;

      const first = chunk[0];
      const last = chunk[6];
      const weekNum = Math.floor(i / 7) + 1;
      const fM = Number(first.date.slice(5, 7));
      const fD = Number(first.date.slice(8));
      const lM = Number(last.date.slice(5, 7));
      const lD = Number(last.date.slice(8));
      const label = `${weekNum}주차 (${fM}월 ${fD}일 ~ ${lM}월 ${lD}일)`;
      const hasToday = chunk.some((c) => c.date === todayStr);

      const days: DayInfo[] = chunk.map((c, colIdx) => {
        const [y, m, d] = c.date.split('-').map(Number);
        const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0(일) ~ 6(토)
        return {
          dateStr: c.date,
          dayNum: d,
          monthNum: m,
          weekdayKo: WEEKDAYS_KO_MON[colIdx],
          dayOfWeek: dow,
          isSat: dow === 6,
          isSun: dow === 0,
          isToday: c.date === todayStr,
          inCurrentMonth: c.inCurrentMonth,
        };
      });

      list.push({
        weekNum,
        label,
        hasToday,
        days,
      });
    }

    return list;
  }, [currentMonth, todayStr]);

  // 전체 날짜 목록 (데이터 쿼리용)
  const allDays = useMemo(() => weeks.flatMap((w) => w.days), [weeks]);
  const monthStartDate = allDays[0]?.dateStr ?? `${currentMonth}-01`;
  const monthEndDate = allDays[allDays.length - 1]?.dateStr ?? `${currentMonth}-31`;

  // 2. 월간 전체 사용자 업무계획 조회
  const monthlyPlansQuery = useAllWorkPlans({ from: monthStartDate, to: monthEndDate }, true);

  // (userId -> (date -> WorkPlan)) 맵 생성
  const plansByUserAndDate = useMemo(() => {
    const userMap = new Map<string, Map<string, WorkPlan>>();
    (monthlyPlansQuery.data ?? []).forEach((plan) => {
      if (!userMap.has(plan.ownerUserId)) {
        userMap.set(plan.ownerUserId, new Map());
      }
      userMap.get(plan.ownerUserId)!.set(plan.date, plan);
    });
    return userMap;
  }, [monthlyPlansQuery.data]);

  // 3. 전자결재 승인 일정 및 회의 캘린더 일정 투영
  const approvalsQuery = useAllApprovals();
  const calendarActor = useMemo(
    () => ({ userId: actor.id, active: actor.status === '사용', deptId }),
    [actor.id, actor.status, deptId],
  );
  const calendarEventsQuery = useCalendarEvents(calendarActor, { from: monthStartDate, to: monthEndDate });

  // (userId -> (date -> ProjectedScheduleItem[]))
  const projectedSchedulesMap = useMemo(() => {
    const map = new Map<
      string,
      Map<
        string,
        Array<{
          id: string;
          title: string;
          type: 'LEAVE' | 'OUTSIDE' | 'TRIP' | 'CALENDAR';
          label: string;
          badgeClass: string;
          timeStr?: string;
        }>
      >
    >();

    // 전자결재 승인 일정 (외근, 출장, 휴가)
    const approvedSchedules = extractApprovedSchedules(approvalsQuery.data ?? []);
    for (const s of approvedSchedules) {
      if (!map.has(s.drafterId)) map.set(s.drafterId, new Map());
      const userDateMap = map.get(s.drafterId)!;

      for (const d of allDays) {
        const dStr = d.dateStr;
        if (isDateInSchedule(dStr, s)) {
          if (!userDateMap.has(dStr)) userDateMap.set(dStr, []);
          const label =
            s.category === 'LEAVE'
              ? `[휴가] ${s.leaveType || '휴가'}`
              : s.category === 'OUTSIDE'
              ? `[외근] ${s.subType || '외근'}${s.destination ? ` (${s.destination})` : ''}`
              : `[출장] ${s.subType || '출장'}${s.destination ? ` (${s.destination})` : ''}`;

          const badgeClass =
            s.category === 'LEAVE'
              ? 'bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-400'
              : s.category === 'OUTSIDE'
              ? 'bg-blue-500/15 text-blue-700 border-blue-500/30 dark:text-blue-400'
              : 'bg-indigo-500/15 text-indigo-700 border-indigo-500/30 dark:text-indigo-400';

          userDateMap.get(dStr)!.push({
            id: `appr-${s.docId}-${dStr}`,
            title: s.docTitle,
            type: s.category,
            label,
            badgeClass,
            timeStr: s.startTime && s.endTime ? `${s.startTime}~${s.endTime}` : undefined,
          });
        }
      }
    }

    // 캘린더 공인 일정 (회의·미팅 등)
    // ⚠️ 업무계획에서 파생되어 캘린더로 동기화된 이벤트는 하단 업무 To-Do 목록에 이미 존재하므로 상단 칩에서 제외하여 중복 방지
    const officialCalEvents = (calendarEventsQuery.data ?? []).filter(
      (ev) => isOfficialCalendarEvent(ev) && !isWorkPlanDerivedEvent(ev),
    );
    for (const ev of officialCalEvents) {
      const targetUserIds = ev.attendeeUserIds && ev.attendeeUserIds.length > 0
        ? [ev.ownerUserId, ...ev.attendeeUserIds]
        : [ev.ownerUserId];

      const timeStr = ev.allDay
        ? undefined
        : ev.startTime && ev.endTime
        ? `${ev.startTime}~${ev.endTime}`
        : ev.startTime || undefined;

      for (const uId of targetUserIds) {
        if (!map.has(uId)) map.set(uId, new Map());
        const userDateMap = map.get(uId)!;
        if (!userDateMap.has(ev.date)) userDateMap.set(ev.date, []);

        // [회의] [회의] 중복 방지: 이미 [회의] 또는 [미팅] 접두사가 있으면 정규화
        const cleanEvTitle = ev.title.replace(/^\[(회의|미팅)\]\s*/, '').trim();
        const label = `[회의] ${cleanEvTitle}`;
        const badgeClass = 'bg-purple-500/15 text-purple-700 border-purple-500/30 dark:text-purple-400';

        userDateMap.get(ev.date)!.push({
          id: `cal-${ev.id}`,
          title: ev.title,
          type: 'CALENDAR',
          label,
          badgeClass,
          timeStr,
        });
      }
    }

    return map;
  }, [approvalsQuery.data, calendarEventsQuery.data, allDays]);

  // 이번 주차 위치로 부드럽게 스크롤
  const scrollToCurrentWeek = () => {
    if (currentWeekRef.current) {
      currentWeekRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  useEffect(() => {
    if (currentMonth === todayStr.slice(0, 7)) {
      setTimeout(scrollToCurrentWeek, 250);
    }
  }, [currentMonth, todayStr]);

  const handlePrevMonth = () => {
    setCurrentMonth((prev) => moveCalendarMonth(prev, -1));
  };

  const handleNextMonth = () => {
    setCurrentMonth((prev) => moveCalendarMonth(prev, 1));
  };

  const handleThisMonth = () => {
    setCurrentMonth(todayStr.slice(0, 7));
  };

  const [yearNum, monthNum] = currentMonth.split('-').map(Number);

  return (
    <div className="space-y-4">
      {/* ── 월간 상단 툴바 ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-panel p-3 shadow-xs">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handlePrevMonth}
              aria-label="이전 달"
              className="grid h-8 w-8 place-items-center rounded-lg border border-border text-ink2 hover:bg-panel-alt transition-colors cursor-pointer"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              onClick={handleThisMonth}
              className="rounded-lg border border-border bg-panel px-3 py-1.5 text-[11.5px] font-bold text-ink hover:bg-panel-alt transition-colors shadow-2xs cursor-pointer"
            >
              이번 달
            </button>
            <button
              type="button"
              onClick={handleNextMonth}
              aria-label="다음 달"
              className="grid h-8 w-8 place-items-center rounded-lg border border-border text-ink2 hover:bg-panel-alt transition-colors cursor-pointer"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          <h2 className="ml-1 text-[14px] font-extrabold text-ink flex items-center gap-1.5">
            <CalendarIcon size={16} className="text-teal" />
            <span>{yearNum}년 {monthNum}월 업무계획</span>
          </h2>

          <span className="text-[11px] font-semibold text-ink3 ml-2">
            ({members.length}명 조회 · 총 {weeks.length}주차)
          </span>

          {currentMonth === todayStr.slice(0, 7) && (
            <button
              type="button"
              onClick={scrollToCurrentWeek}
              className="ml-2 flex items-center gap-1 rounded-lg border border-teal/40 bg-teal-soft/20 px-2.5 py-1 text-[11px] font-bold text-teal hover:bg-teal-soft/40 transition-colors shadow-2xs cursor-pointer"
            >
              <LocateFixed size={12} />
              <span>이번 주차로 이동</span>
            </button>
          )}
        </div>

        {/* 액션 버튼 */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              const myTodayPlan = plansByUserAndDate.get(actor.id)?.get(todayStr);
              onOpenEditor(todayStr, myTodayPlan);
            }}
            className="flex items-center gap-1.5 rounded-xl border border-border/80 bg-white dark:bg-panel px-3 py-1.5 text-[11.5px] font-semibold text-ink hover:bg-slate-50 dark:hover:bg-panel-alt transition-colors shadow-2xs cursor-pointer"
          >
            <Plus size={13} className="text-ink2" />
            <span>오늘 업무 작성</span>
          </button>
          {onOpenConfig && (
            <button
              type="button"
              onClick={onOpenConfig}
              className="flex items-center gap-1 rounded-xl border border-border bg-panel px-3 py-1.5 text-[11.5px] font-bold text-ink hover:bg-panel-alt transition-colors shadow-2xs cursor-pointer"
            >
              <Settings size={12} className="text-ink3" />
              <span>설정</span>
            </button>
          )}
        </div>
      </div>

      {/* ── 일주일 단위로 끊어서 아래로 이어지는 단일 통합 매트릭스 표 (가로너비 일치 & 일체형 엑셀 뷰) ── */}
      <div className="overflow-x-auto rounded-xl border border-border bg-panel shadow-xs scrollbar-thin">
        <table className="w-full min-w-[980px] table-fixed border-collapse text-left text-[11px] select-text">
          <colgroup>
            <col style={{ width: '95px' }} />
            <col style={{ width: 'calc((100% - 95px) / 7)' }} />
            <col style={{ width: 'calc((100% - 95px) / 7)' }} />
            <col style={{ width: 'calc((100% - 95px) / 7)' }} />
            <col style={{ width: 'calc((100% - 95px) / 7)' }} />
            <col style={{ width: 'calc((100% - 95px) / 7)' }} />
            <col style={{ width: 'calc((100% - 95px) / 7)' }} />
            <col style={{ width: 'calc((100% - 95px) / 7)' }} />
          </colgroup>

          <tbody>
            {weeks.map((week, wIdx) => {
              return (
                <Fragment key={week.weekNum}>
                  {/* 주차 구분 날짜 헤더 행 (주차 정보 + 7개 요일 날짜) */}
                  <tr
                    ref={week.hasToday ? currentWeekRef : undefined}
                    className={`border-b border-border ${wIdx > 0 ? 'border-t-2 border-t-border' : ''} ${
                      week.hasToday ? 'bg-teal-soft/20' : 'bg-panel-alt/75'
                    }`}
                  >
                    {/* 주차 성명 열 헤더 */}
                    <th className="border-r border-border p-2 text-center text-[11px] font-bold text-ink bg-panel-alt/80">
                      <div className="flex flex-col items-center justify-center gap-0.5">
                        <span className="text-[11.5px] font-extrabold text-ink flex items-center gap-1">
                          <span>{week.weekNum}주차</span>
                        </span>
                        {week.hasToday ? (
                          <span className="rounded bg-teal px-1.5 py-0.2 text-[8px] font-bold text-white shadow-2xs">
                            이번 주
                          </span>
                        ) : (
                          <span className="text-[9px] text-ink3 font-medium">
                            {week.days[0].monthNum}/{week.days[0].dayNum}~{week.days[6].monthNum}/{week.days[6].dayNum}
                          </span>
                        )}
                      </div>
                    </th>

                    {/* 월 ~ 일 (7개 요일 열 헤더) */}
                    {week.days.map((d) => {
                      const isOtherMonth = !d.inCurrentMonth;
                      const targetMonth = d.dateStr.slice(0, 7);

                      // 토요일: 연한 파랑, 일요일: 연한 살구/주황 (사용자 이미지 싱크로율 100%)
                      const headerBg = d.isSat
                        ? 'bg-blue-100/75 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300'
                        : d.isSun
                        ? 'bg-orange-100/75 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300'
                        : d.isToday
                        ? 'bg-teal-50 dark:bg-teal-950/30 text-teal font-extrabold'
                        : 'bg-panel-alt/60 text-ink';

                      return (
                        <th
                          key={d.dateStr}
                          onClick={() => {
                            if (isOtherMonth) {
                              setCurrentMonth(targetMonth);
                            }
                          }}
                          className={`border-r border-border p-1.5 text-center last:border-r-0 transition-all ${headerBg} ${
                            isOtherMonth
                              ? 'opacity-40 hover:opacity-100 hover:bg-teal-soft/30 hover:text-teal cursor-pointer'
                              : ''
                          }`}
                        >
                          <div className="flex items-center justify-center gap-1">
                            <span className="text-[12px] font-extrabold">{d.dayNum}</span>
                            <span className="text-[10px] opacity-80">({d.weekdayKo})</span>
                            {isOtherMonth && (
                              <span className="text-[8.5px] font-semibold text-teal opacity-90">
                                ({d.monthNum}월)
                              </span>
                            )}
                            {d.isToday && (
                              <span className="rounded bg-teal px-1 py-0.2 text-[8px] font-bold text-white shadow-2xs">
                                오늘
                              </span>
                            )}
                          </div>
                        </th>
                      );
                    })}
                  </tr>

                  {/* 해당 주차의 임직원 업무 행 목록 */}
                  {members.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-6 text-center text-ink3">
                        조회된 임직원이 없습니다.
                      </td>
                    </tr>
                  ) : (
                    members.map((member) => {
                      const isMe = member.id === actor.id;
                      const userPlans = plansByUserAndDate.get(member.id);

                      return (
                        <tr
                          key={`${week.weekNum}-${member.id}`}
                          className="border-b border-border/60 hover:bg-panel-alt/10 transition-colors last:border-b-0"
                        >
                          {/* 좌측 성명 열 */}
                          <td className="border-r border-border bg-panel p-2.5 align-top text-center shadow-2xs">
                            <div className="flex flex-col items-center justify-center py-1">
                              <div className="flex items-center gap-1">
                                <span className={`text-[12px] font-bold ${isMe ? 'text-teal' : 'text-ink'}`}>
                                  {member.name}
                                </span>
                                {isMe && (
                                  <span className="rounded bg-teal-soft/50 px-1 py-0.2 text-[8px] font-bold text-teal">
                                    나
                                  </span>
                                )}
                              </div>
                              <span className="text-[9px] text-ink3 truncate max-w-[80px] mt-0.5">
                                {member.position || member.jobTitle || member.dept}
                              </span>
                            </div>
                          </td>

                          {/* 7일치 셀 (월~일) */}
                          {week.days.map((d) => {
                            const dayStr = d.dateStr;
                            const plan = userPlans?.get(dayStr);
                            const parsed = plan ? parseWorkPlanItems(plan.content) : [];
                            const prog = plan ? calculatePlanProgress(plan.content) : null;
                            const userProjectedDateMap = projectedSchedulesMap.get(member.id);
                            const projectedItems = userProjectedDateMap?.get(dayStr) ?? [];

                            // 3단계 시각적 위계:
                            // tier 1: 오늘 내 일정 (흰색 배경 + 잉크 글씨)
                            // tier 2: 다른 날 내 일정 (기본 연한 톤)
                            // tier 3: 다른 사람들의 일정 (연하고 은은한 톤)
                            const editTier = isMe && d.isToday ? 1 : isMe ? 2 : 3;

                            const isEditingThisCell =
                              Boolean(activeEditing && activeEditing.date === dayStr && activeEditing.userId === member.id);

                            // 토요일: 연파랑, 일요일: 연살구, 오늘: 깨끗한 흰색
                            const cellBgClass = isEditingThisCell
                              ? 'bg-blue-50/60 dark:bg-blue-950/20'
                              : editTier === 1
                              ? 'bg-white dark:bg-panel shadow-2xs border-l-2 border-r-2 border-teal/40 dark:border-teal/50'
                              : d.isSat
                              ? 'bg-blue-50/40 dark:bg-blue-950/20'
                              : d.isSun
                              ? 'bg-orange-50/40 dark:bg-orange-950/20'
                              : editTier === 2
                              ? 'bg-panel/10 hover:bg-panel/40'
                              : d.isToday
                              ? 'bg-teal-50/20 dark:bg-teal-950/15'
                              : 'bg-transparent hover:bg-panel-alt/20';

                            return (
                              <td
                                key={dayStr}
                                onClick={() => {
                                  if (!isEditingThisCell) {
                                    if (!d.inCurrentMonth) {
                                      setCurrentMonth(d.dateStr.slice(0, 7));
                                    }
                                    onOpenEditor(dayStr, plan, member);
                                  }
                                }}
                                className={`p-2 align-top border-r border-border last:border-r-0 transition-colors min-h-[85px] relative cursor-pointer ${cellBgClass} ${
                                  !d.inCurrentMonth ? 'opacity-50' : ''
                                }`}
                              >
                                {/* 1) 결재 일정 및 회의 투영 칩 */}
                                {projectedItems.length > 0 && (
                                  <div className="space-y-1 mb-1.5 pb-1 border-b border-border/40">
                                    {projectedItems.map((pItem) => (
                                      <div
                                        key={pItem.id}
                                        className={`flex items-center justify-between gap-1 rounded px-1.5 py-0.5 text-[9px] font-bold border shadow-2xs ${pItem.badgeClass}`}
                                        title={`${pItem.label} (${pItem.timeStr || '종일'})`}
                                      >
                                        <span className="truncate">{pItem.label}</span>
                                        {pItem.timeStr && (
                                          <span className="text-[8px] opacity-80 shrink-0 font-normal">
                                            {pItem.timeStr}
                                          </span>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                )}

                                {/* 2) 업무 계획 영역: 칸 안에서 직접 심플하게 작성 (세로 스크롤 없이 늘어난 칸 그대로 보임, 다른 칸 클릭 시 자동 저장) */}
                                {isEditingThisCell ? (
                                  <InlineCellTextarea
                                    value={editingContent}
                                    onChange={(val) => onEditingContentChange?.(val)}
                                    onBlur={() => onSaveEditing?.()}
                                    onSave={() => onSaveEditing?.()}
                                    onCancel={() => onCancelEditing?.()}
                                  />
                                ) : parsed.length > 0 ? (
                                  <div className="space-y-1 min-h-[48px] group/cell relative">
                                    <div className="space-y-0.5">
                                      {parsed.map((item, itemIdx) => {
                                        if (!item.text && !item.tag) return null;
                                        const { startTime, endTime, cleanText } = extractTimeFromText(item.text);

                                        return (
                                          <div
                                            key={itemIdx}
                                            className={`text-[10px] leading-tight flex items-start gap-1 py-0.5 ${
                                              item.completed
                                                ? 'line-through text-ink3 opacity-70'
                                                : editTier === 1
                                                ? 'text-ink font-semibold'
                                                : editTier === 3
                                                ? 'text-ink2/90'
                                                : 'text-ink'
                                            }`}
                                          >
                                            {/* 본인만 체크 가능한 상호작용 체크박스 (타인은 읽기 전용) */}
                                            <button
                                              type="button"
                                              disabled={!isMe}
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                if (!isMe) return;
                                                if (plan) {
                                                  onToggleItem?.(plan, itemIdx);
                                                }
                                              }}
                                              className={`shrink-0 mt-0.5 h-3.5 w-3.5 rounded border flex items-center justify-center transition-all ${
                                                !isMe
                                                  ? 'cursor-default opacity-60 ' +
                                                    (item.completed
                                                      ? 'border-teal/60 bg-teal/60 text-white'
                                                      : 'border-border/60 bg-panel/30')
                                                  : item.completed
                                                  ? 'border-teal bg-teal text-white shadow-2xs cursor-pointer'
                                                  : 'border-border/90 bg-white dark:bg-panel hover:border-teal hover:bg-teal-soft/10 cursor-pointer'
                                              }`}
                                              title={
                                                !isMe
                                                  ? '진행도 체크는 본인만 가능합니다'
                                                  : item.completed
                                                  ? '미완료로 변경'
                                                  : '완료로 표시 (가로줄)'
                                              }
                                            >
                                              {item.completed && <Check size={10} strokeWidth={3} />}
                                            </button>

                                            <div className="min-w-0 flex-1 break-words">
                                              {/* 회의/미팅 태그 */}
                                              {(item.tag === '회의' || item.tag === '미팅') && (
                                                <span className="mr-1 rounded bg-purple-500/10 px-1 py-0.2 text-[8px] font-bold text-purple-700 border border-purple-500/25 dark:text-purple-300">
                                                  회의
                                                </span>
                                              )}
                                              {startTime && (
                                                <span className="mr-1 text-[8.5px] font-bold text-blue-600 dark:text-blue-400">
                                                  ({startTime}
                                                  {endTime ? `~${endTime}` : ''})
                                                </span>
                                              )}
                                              <span>{(cleanText || item.text).replace(/^\[(회의|미팅)\]\s*/, '')}</span>
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>

                                    {/* 하단 진행률만 유지 */}
                                    {prog && (
                                      <div className="flex items-center justify-between pt-1 border-t border-border/30 text-[8.5px]">
                                        <span className="text-ink3 font-medium">
                                          {prog.completed}/{prog.total} ({prog.percent}%)
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  /* 빈 셀: 버튼 없이 칸을 클릭하면 즉시 작성 시작 */
                                  <div className="min-h-[50px] w-full" />
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
