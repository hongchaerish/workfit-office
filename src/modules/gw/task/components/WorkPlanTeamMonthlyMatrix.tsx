import { useState, useMemo, useRef, useEffect, Fragment } from 'react';
import type { User } from '@/domain/user/schema';
import type { WorkPlan } from '@/domain/workPlan/schema';
import {
  parseWorkPlanItems,
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
import type { CalendarEvent } from '@/domain/calendarEvent/schema';
import { isWorkPlanDerivedEvent } from '@/domain/workPlan/workPlanCalendarBridge';
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Check,
  Calendar as CalendarIcon,
  Settings,
  LocateFixed,
} from 'lucide-react';

import { useHolidays } from '@/features/holiday/useHolidays';
import { KOREA_STANDARD_HOLIDAYS } from '@/domain/holiday/koreaHolidays';
import { WorkPlanInlineText } from './WorkPlanInlineText';
import { WorkPlanRichEditor } from './WorkPlanRichEditor';
import type { Editor } from '@tiptap/react';

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
  holidayName?: string;
  isRedDay: boolean;
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
  onOpenCompanySchedule?: (date: string, existingText?: string, planId?: string) => void;
  onOpenConfig?: () => void;
  onToggleItem?: (plan: WorkPlan, itemIdx: number) => void;
  /** 칸 편집기 인스턴스 전달 — 상단 리본의 서식 버튼이 쓴다. */
  onEditorReady?: (editor: Editor | null) => void;
  /** 회의 칩 클릭 → 회의 상세(주최자는 수정, 참석자는 참석 취소, 그 밖의 사람은 합류) */
  onOpenMeeting?: (event: CalendarEvent) => void;
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
  onOpenCompanySchedule,
  onOpenConfig,
  onToggleItem,
  onEditorReady,
  onOpenMeeting,
}: WorkPlanTeamMonthlyMatrixProps) {
  // 현재 조회 중인 월 (YYYY-MM)
  const [currentMonth, setCurrentMonth] = useState<string>(() => todayStr.slice(0, 7));
  const currentWeekRef = useRef<HTMLTableRowElement>(null);

  // 공휴일 데이터 조회 및 날짜별 매핑
  const holidaysQuery = useHolidays();
  const holidayMap = useMemo(() => {
    const map = new Map<string, string>();
    const dbHolidays = holidaysQuery.data ?? [];
    if (dbHolidays.length > 0) {
      // DB에 공휴일이 등록되어 있으면 DB만 사용 (삭제/수정이 반영되도록)
      dbHolidays.forEach((h) => {
        map.set(h.date, h.name);
      });
    } else {
      // DB가 완전히 비어있을 때만 하드코딩 fallback 사용
      Object.values(KOREA_STANDARD_HOLIDAYS).flat().forEach((h) => {
        map.set(h.date, h.name);
      });
    }
    return map;
  }, [holidaysQuery.data]);

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
        const holidayName = holidayMap.get(c.date);
        const isRedDay = dow === 0 || Boolean(holidayName);

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
          holidayName,
          isRedDay,
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
  }, [currentMonth, todayStr, holidayMap]);

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

  // 전사 공통 중요 일정 맵 (__COMPANY__)
  const companyPlansMap = useMemo(() => {
    return plansByUserAndDate.get('__COMPANY__') ?? new Map<string, WorkPlan>();
  }, [plansByUserAndDate]);

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
          /** 캘린더 회의 칩이면 원본 일정 */
          event?: CalendarEvent;
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
          event: ev,
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
          {onOpenConfig && (
            <button
              type="button"
              onClick={onOpenConfig}
              title="루틴 템플릿과 태그를 추가·수정·삭제합니다"
              className="flex items-center gap-1 rounded-xl border border-border bg-panel px-3 py-1.5 text-[11.5px] font-bold text-ink hover:bg-panel-alt transition-colors shadow-2xs cursor-pointer"
            >
              <Settings size={12} className="text-ink3" />
              <span>루틴 편집</span>
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

                      // 빨간날(일요일 또는 공휴일): 연한 살구/장미톤, 토요일: 연한 파랑
                      const headerBg = d.isRedDay
                        ? 'bg-rose-100/75 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 font-extrabold'
                        : d.isSat
                        ? 'bg-blue-100/75 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300'
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
                          <div className="flex flex-col items-center justify-center gap-0.5">
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
                          </div>
                        </th>
                      );
                    })}
                  </tr>

                  {/* ── 전사 공통 중요 일정 행 (사용자 요청: 모든 임직원이 작성 및 공유) ── */}
                  <tr className="border-b border-border bg-amber-50/20 dark:bg-amber-950/10">
                    <th className="border-r border-border p-1.5 text-center bg-amber-100/60 dark:bg-amber-950/40 select-none">
                      <span className="text-[10.5px] font-black text-amber-800 dark:text-amber-300 tracking-tight">
                        중요 일정
                      </span>
                    </th>

                    {week.days.map((d) => {
                      const dayStr = d.dateStr;
                      const cPlan = companyPlansMap.get(dayStr);
                      const content = cPlan?.content?.trim() || '';
                      const holidayName = d.holidayName;
                      const isRedDay = d.isRedDay;

                      return (
                        <td
                          key={dayStr}
                          onClick={() => onOpenCompanySchedule?.(dayStr, content, cPlan?.id)}
                          className={`p-1.5 align-top border-r border-border last:border-r-0 cursor-pointer transition-colors group relative ${
                            isRedDay
                              ? 'bg-rose-50/40 dark:bg-rose-950/15 hover:bg-rose-50/70 dark:hover:bg-rose-950/30'
                              : d.isSat
                              ? 'bg-blue-50/30 dark:bg-blue-950/10 hover:bg-blue-50/60 dark:hover:bg-blue-950/25'
                              : 'bg-white/60 dark:bg-panel/40 hover:bg-amber-50 dark:hover:bg-amber-950/30'
                          }`}
                          title="클릭하여 전사 주요 일정을 작성/수정합니다"
                        >
                          <div className="flex flex-col gap-0.5 min-h-[26px] justify-center">
                            {/* 공휴일: 심플한 빨간 텍스트 */}
                            {holidayName && (
                              <span className="text-[9.5px] font-semibold text-rose-500 dark:text-rose-400 truncate" title={holidayName}>
                                {holidayName}
                              </span>
                            )}
                            {/* 전사 주요 일정 내용 */}
                            {content ? (
                              <div className="text-[10px] font-semibold text-ink2 dark:text-ink2 break-words leading-tight line-clamp-2">
                                {content}
                              </div>
                            ) : !holidayName ? (
                              <div className="text-[9px] text-ink3 opacity-0 group-hover:opacity-70 transition-opacity flex items-center gap-0.5 italic">
                                <Plus size={10} className="text-ink3" />
                                <span>일정 등록</span>
                              </div>
                            ) : null}
                          </div>
                        </td>
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
                        <Fragment key={`${week.weekNum}-${member.id}`}>
                        <tr
                          className="border-b border-border/60 hover:bg-panel-alt/10 transition-colors last:border-b-0"
                        >
                          {/* 좌측 성명 열 */}
                          <td className="border-r border-border bg-panel p-2.5 align-top text-center shadow-2xs">
                            <div className="flex flex-col items-center justify-center py-1">
                              <div className="flex items-center gap-1">
                                <span className={`text-[12px] font-bold ${isMe ? 'text-teal' : 'text-ink'}`}>
                                  {/* 업무계획 한정: 대표이사 이름/직책은 '위원장'으로 표시 */}
                                  {member.name === '대표이사' || member.position === '대표이사' || member.jobTitle === '대표이사'
                                    ? '위원장'
                                    : member.name}
                                </span>
                                {isMe && (
                                  <span className="rounded bg-teal-soft/50 px-1 py-0.2 text-[8px] font-bold text-teal">
                                    나
                                  </span>
                                )}
                              </div>
                              <span className="text-[9px] text-ink3 truncate max-w-[80px] mt-0.5">
                                {/* 업무계획 한정: 대표이사 서브라벨을 '위원회'로 표시 */}
                                {member.name === '대표이사' || member.position === '대표이사' || member.jobTitle === '대표이사'
                                  ? '위원회'
                                  : (member.position || member.jobTitle || member.dept)}
                              </span>
                            </div>
                          </td>

                          {/* 7일치 셀 (월~일) */}
                          {week.days.map((d) => {
                            const dayStr = d.dateStr;
                            const plan = userPlans?.get(dayStr);
                            const parsed = plan ? parseWorkPlanItems(plan.content) : [];
                            const userProjectedDateMap = projectedSchedulesMap.get(member.id);
                            const projectedItems = userProjectedDateMap?.get(dayStr) ?? [];

                            // 3단계 시각적 위계:
                            // tier 1: 오늘 내 일정 (흰색 배경 + 잉크 글씨)
                            // tier 2: 다른 날 내 일정 (기본 연한 톤)
                            // tier 3: 다른 사람들의 일정 (연하고 은은한 톤)
                            const editTier = isMe && d.isToday ? 1 : isMe ? 2 : 3;

                            const isEditingThisCell =
                              Boolean(activeEditing && activeEditing.date === dayStr && activeEditing.userId === member.id);

                            // 토요일: 연파랑, 일요일/공휴일(빨간날): 연살구/장미, 오늘: 깨끗한 흰색
                            const cellBgClass = isEditingThisCell
                              ? 'bg-blue-50/60 dark:bg-blue-950/20'
                              : editTier === 1
                              ? 'bg-white dark:bg-panel shadow-2xs border-l-2 border-r-2 border-teal/40 dark:border-teal/50'
                              : d.isRedDay
                              ? 'bg-rose-50/30 dark:bg-rose-950/15'
                              : d.isSat
                              ? 'bg-blue-50/40 dark:bg-blue-950/20'
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
                                        role={pItem.event ? 'button' : undefined}
                                        onClick={pItem.event ? (e) => {
                                          e.stopPropagation(); // 칸 편집이 열리지 않게
                                          onOpenMeeting?.(pItem.event!);
                                        } : undefined}
                                        className={`flex items-center justify-between gap-1 rounded px-1.5 py-0.5 text-[9px] font-bold border shadow-2xs ${pItem.badgeClass} ${pItem.event ? 'cursor-pointer hover:brightness-95' : ''}`}
                                        title={pItem.event ? `${pItem.label} (${pItem.timeStr || '종일'}) — 눌러서 회의 보기` : `${pItem.label} (${pItem.timeStr || '종일'})`}
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
                                  <WorkPlanRichEditor
                                    value={editingContent}
                                    onChange={(val) => onEditingContentChange?.(val)}
                                    onBlur={() => onSaveEditing?.()}
                                    onSave={() => onSaveEditing?.()}
                                    onCancel={() => onCancelEditing?.()}
                                    onEditorReady={onEditorReady}
                                  />
                                ) : parsed.length > 0 ? (
                                  <div className="space-y-1 min-h-[48px] group/cell relative">
                                    <div className="space-y-0.5">
                                      {parsed.map((item, itemIdx) => {
                                        // 빈 줄인 경우 줄바꿈 여백 유지
                                        if (!item.text && !item.tag) {
                                          return <div key={itemIdx} className="h-1.5" />;
                                        }

                                        // 1) 체크박스 할 일 항목 (앞에 - 또는 마크다운 체크박스)
                                        if (item.isChecklist) {
                                          return (
                                            <div
                                              key={itemIdx}
                                              className={`text-[10px] leading-relaxed flex items-start gap-1 py-0.5 ${
                                                item.completed
                                                  ? 'line-through text-ink3 opacity-60'
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
                                                <WorkPlanInlineText text={item.text} />
                                              </div>
                                            </div>
                                          );
                                        }

                                        // 2) 일반 텍스트 라인 (체크박스 없이 순수 텍스트 줄바꿈)
                                        return (
                                          <div
                                            key={itemIdx}
                                            className={`text-[10px] leading-relaxed py-0.5 break-words ${
                                              editTier === 3 ? 'text-ink2/90' : 'text-ink'
                                            }`}
                                          >
                                            <WorkPlanInlineText text={item.text} />
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                ) : (
                                  /* 빈 셀: 버튼 없이 칸을 클릭하면 즉시 작성 시작 */
                                  <div className="min-h-[50px] w-full" />
                                )}
                              </td>
                            );
                          })}
                        </tr>
                        </Fragment>
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
