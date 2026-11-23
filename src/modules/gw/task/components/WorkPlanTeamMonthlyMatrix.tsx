import { useState, useMemo, useRef, useEffect, Fragment, type ReactNode } from 'react';
import type { User } from '@/domain/user/schema';
import type { WorkPlan } from '@/domain/workPlan/schema';
import type { WorkPlanItem } from '@/domain/workPlan/item';
import {
  buildCalendarMonth,
  moveCalendarMonth,
} from '@/domain/calendarEvent/calendarDate';
import type { OutsideScheduleView } from '@/domain/outsideWork/view';
import { layoutWeekBars, type WeekBar } from '@/domain/outsideWork/weekBars';
import { canMoveEntry, hasPlannedDay, type DayCell, type DayEntry, type MemoPlanRef } from '@/domain/workPlan/dayEntries';
import { WORK_PLAN_MEMO_MAX, toggleMemoTask } from '@/domain/workPlan/memo';
import { WorkPlanMemoEditor } from './memo/WorkPlanMemoEditor';
import { WorkPlanMemoView } from './memo/WorkPlanMemoView';
import { chipLook, timeOf, timeRangeOf } from './entryChipLook';
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Check,
  Calendar as CalendarIcon,
  Settings,
  LocateFixed,
  StickyNote,
  Repeat,
  PanelRightOpen,
} from 'lucide-react';

import { useHolidays } from '@/features/holiday/useHolidays';
import { KOREA_STANDARD_HOLIDAYS } from '@/domain/holiday/koreaHolidays';
import { BirthdayMark } from '@/features/birthday/BirthdayProvider';

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

/** 오늘 열은 하늘색 세로선으로 위아래를 이어서, 아래쪽 행에서도 오늘 칸을 바로 찾게 한다 */
const dayColBorderClass = (isToday: boolean) =>
  isToday ? 'border-x-2 border-sky-200/80 dark:border-sky-800/70' : 'border-r border-border last:border-r-0';

/** 본표와 상단 고정 날짜 머리행이 같은 열 너비를 쓰도록 공유한다 */
const MATRIX_COLGROUP = (
  <colgroup>
    <col style={{ width: '95px' }} />
    {Array.from({ length: 7 }, (_, i) => (
      <col key={i} style={{ width: 'calc((100% - 95px) / 7)' }} />
    ))}
  </colgroup>
);

interface WorkPlanTeamMonthlyMatrixProps {
  actor: User;
  todayStr: string;
  members: User[];
  /** 칸 더블클릭·[+] → 그 날짜·그 사람으로 새 일정. 없으면(사용 중이 아닌 계정) 진입점도 없다. */
  onCreate?: (date: string, member: User) => void;
  /** 칩·여러 날 막대 클릭 */
  onOpenEntry: (entry: DayEntry) => void;
  /** 내 일반 업무를 끌어서 다른 날로 옮긴다. 없으면(사용 중이 아닌 계정) 끌 수 없다 */
  onMoveItem?: (item: WorkPlanItem, date: string) => void;
  /** 내 칸 메모 저장. 없으면(사용 중이 아닌 계정) 메모는 보기만. 실패하면 이유를 담아 throw */
  onSaveMemo?: (date: string, memoPlan: MemoPlanRef | null, text: string) => Promise<void>;
  /** 보고 있는 달(YYYY-MM) — 화면이 들고 칸 조립 범위로도 쓴다 */
  month: string;
  onMonthChange: (month: string) => void;
  /** 화면이 만든 칸 조회([[useDayEntryIndex]]) — 표는 받아서 그리기만 한다 */
  cellOf: (userId: string, date: string) => DayCell;
  /** 예전 글 원본 — 전사 공통 일정 줄에 쓴다 */
  workPlans: WorkPlan[];
  onOpenCompanySchedule?: (date: string, existingText?: string, planId?: string) => void;
  onOpenConfig?: () => void;
  /** 상단 고정 바 우측에 놓일 부서 필터·검색 */
  filters?: ReactNode;
  /** 날짜 머리 누르기 → 하루 상세 팝업 */
  onOpenDay?: (date: string) => void;
  /** 하루 상세에 열린 날짜 — 머리에 표시 */
  selectedDate?: string | null;
  /** 주 보기 — 주어지면 그 월요일이 든 한 주만 그리고 상단 바는 주 이동 */
  weekStart?: string | null;
  onWeekChange?: (monday: string) => void;
  /** 상단 바 맨 앞에 놓일 보기 전환 */
  viewSwitch?: ReactNode;
}

/** 칸 안 글 크기 */
const LOOK = { chip: 'text-[11px] py-[3px]', time: 'text-[10px]', memo: 'text-[11.5px]', mark: 10, bar: 'text-[10.5px]' } as const;
type DensityLook = typeof LOOK;

/** 'YYYY-MM-DD' 에 일수를 더한다(UTC) */
const plusDays = (date: string, days: number) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

/** 그 날이 든 주의 월요일 */
const mondayOfDate = (date: string) => plusDays(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7));

export function WorkPlanTeamMonthlyMatrix({
  actor,
  todayStr,
  members: allMembers,
  month,
  onMonthChange,
  cellOf,
  workPlans: monthlyPlans,
  onCreate,
  onOpenEntry,
  onMoveItem,
  onSaveMemo,
  onOpenCompanySchedule,
  onOpenConfig,
  filters,
  onOpenDay,
  selectedDate,
  weekStart = null,
  onWeekChange,
  viewSwitch,
}: WorkPlanTeamMonthlyMatrixProps) {
  const look = LOOK;
  /** 끌고 있는 내 업무와, 놓으려는 내 칸의 날짜 */
  const [draggedItem, setDraggedItem] = useState<WorkPlanItem | null>(null);
  const [dropDate, setDropDate] = useState<string | null>(null);
  const endDrag = () => {
    setDraggedItem(null);
    setDropDate(null);
  };
  // 내 행은 주마다 맨 위에
  const members = useMemo(() => {
    const me = allMembers.find((m) => m.id === actor.id);
    return me ? [me, ...allMembers.filter((m) => m.id !== actor.id)] : allMembers;
  }, [allMembers, actor.id]);
  // 현재 조회 중인 월 (YYYY-MM)
  // 주 보기는 그 주 월요일이 든 달에서 그 주를 찾는다 — 화면의 달(month)과 상관없이
  const currentMonth = weekStart ? weekStart.slice(0, 7) : month;
  const setCurrentMonth = (next: string | ((prev: string) => string)) =>
    onMonthChange(typeof next === 'function' ? next(month) : next);
  const currentWeekRef = useRef<HTMLTableRowElement | null>(null);
  /** 이번 주차에서 로그인한 사용자의 행. 업무계획 대상이 아니면 비어 있다. */
  const myCurrentWeekRowRef = useRef<HTMLTableRowElement>(null);
  /** 고정 상단 바와 주차 머리행 — 스크롤 위치의 주차를 상단 바에 표시하는 데 쓴다 */
  const stickyBarRef = useRef<HTMLDivElement>(null);
  const weekHeaderRefs = useRef(new Map<number, HTMLTableRowElement>());
  const [visibleWeekNum, setVisibleWeekNum] = useState<number | null>(null);
  /** 본표 가로 스크롤 영역 — 상단 고정 날짜 머리행의 가로 위치를 맞추는 데 쓴다 */
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const stickyWeekScrollRef = useRef<HTMLDivElement | null>(null);

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
        // 주 보기는 달 경계를 넘는 날도 흐리게 하지 않는다
        days: weekStart ? days.map((day) => ({ ...day, inCurrentMonth: true })) : days,
      });
    }

    return weekStart ? list.filter((w) => w.days[0].dateStr === weekStart) : list;
  }, [currentMonth, todayStr, holidayMap, weekStart]);

  // 2. 칸 목록은 화면이 만들어 내려 준다(cellOf) — 같은 범위는 monthGridDates(month)
  // 전사 공통 중요 일정 맵 (__COMPANY__)
  const companyPlansMap = useMemo(() => {
    const map = new Map<string, WorkPlan>();
    for (const plan of monthlyPlans) {
      if (plan.ownerUserId === '__COMPANY__') map.set(plan.date, plan);
    }
    return map;
  }, [monthlyPlans]);

  /**
   * 한 사람의 한 주에서 여러 날에 걸친 외근·출장 — 칸을 가로지르는 막대로 그린다.
   * 하루짜리는 칸 안의 칩으로 둔다.
   */
  const weekBarsOf = (userId: string, weekDates: string[]) => {
    const views = new Map<string, OutsideScheduleView>();
    const sample = new Map<string, DayEntry>();
    for (const date of weekDates) {
      for (const entry of cellOf(userId, date).entries) {
        const view = entry.outside;
        if (view && view.startDate < view.endDate && !views.has(view.key)) {
          views.set(view.key, view);
          sample.set(view.key, entry);
        }
      }
    }
    const bars = layoutWeekBars([...views.values()], weekDates);
    return { bars, entryOf: (key: string) => sample.get(key)!, keys: new Set(views.keys()) };
  };

  // 이번 주차로 부드럽게 스크롤 — 내 행이 있으면 내 입력칸, 없으면 주차 머리행
  const scrollToCurrentWeek = () => {
    if (myCurrentWeekRowRef.current) {
      myCurrentWeekRowRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else if (currentWeekRef.current) {
      currentWeekRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const hasMembers = members.length > 0;
  useEffect(() => {
    if (!weekStart && currentMonth === todayStr.slice(0, 7)) {
      const timer = setTimeout(scrollToCurrentWeek, 250);
      return () => clearTimeout(timer);
    }
  }, [currentMonth, todayStr, hasMembers, weekStart]);

  useEffect(() => {
    const update = () => {
      const barBottom = stickyBarRef.current?.getBoundingClientRect().bottom ?? 0;
      let current: number | null = null;
      weekHeaderRefs.current.forEach((row, weekNum) => {
        if (row.getBoundingClientRect().top <= barBottom + 8 && (current === null || weekNum > current)) current = weekNum;
      });
      // 표 끝을 지나 스크롤했으면 고정 날짜 머리행을 내린다
      const tableBottom = tableScrollRef.current?.getBoundingClientRect().bottom ?? Infinity;
      if (tableBottom <= barBottom + 48) current = null;
      setVisibleWeekNum(current);
    };
    update();
    // 스크롤 컨테이너가 화면 레이아웃에 따라 달라서 캡처 단계에서 모든 스크롤을 받는다
    document.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      document.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [currentMonth]);

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
  const stickyWeek = visibleWeekNum !== null ? weeks.find((w) => w.weekNum === visibleWeekNum) : undefined;

  /**
   * 주차 날짜 머리행의 칸들 (주차 이름 + 월~일) — 본표와 상단 고정 머리행이 함께 쓴다.
   * 한 줄: '요일 날짜'. 오늘은 날짜를 청록 원으로, 토요일 파랑·일요일·공휴일 빨강 글(공휴일 이름은 옆에), 다른 달은 'M/D' 흐리게.
   */
  const renderWeekHeaderCells = (week: WeekBlock) => (
    <>
      <th
        title={`${week.days[0].monthNum}/${week.days[0].dayNum}~${week.days[6].monthNum}/${week.days[6].dayNum}`}
        className={`border-r border-border px-2 py-1 text-center text-[11.5px] font-extrabold ${week.hasToday ? 'text-sky-700 dark:text-sky-300' : 'text-ink2'}`}
      >
        {week.weekNum}주차
      </th>

      {week.days.map((d) => {
        const isOtherMonth = !d.inCurrentMonth;
        const targetMonth = d.dateStr.slice(0, 7);
        const tone = d.isRedDay ? 'text-rose-600 dark:text-rose-400' : d.isSat ? 'text-blue-600 dark:text-blue-400' : 'text-ink';
        const tint = d.isToday
          ? 'bg-sky-50 dark:bg-sky-950/30'
          : d.isRedDay
          ? 'bg-rose-50/70 dark:bg-rose-950/20'
          : d.isSat
          ? 'bg-blue-50/70 dark:bg-blue-950/20'
          : '';

        return (
          <th
            key={d.dateStr}
            onClick={() => {
              if (onOpenDay) onOpenDay(d.dateStr);
              else if (isOtherMonth) setCurrentMonth(targetMonth);
            }}
            title={onOpenDay ? `${d.holidayName ? `${d.holidayName} · ` : ''}하루 상세 보기` : d.holidayName}
            className={`group/head ${dayColBorderClass(d.isToday)} px-1.5 py-1 transition-colors ${tint} ${tone} ${
              isOtherMonth ? 'opacity-45 hover:opacity-100' : ''
            } ${onOpenDay || isOtherMonth ? 'cursor-pointer hover:bg-panel-alt' : ''} ${
              selectedDate === d.dateStr ? 'shadow-[inset_0_-2px_0_0] shadow-teal' : ''
            }`}
          >
            <div className="flex min-w-0 items-center justify-center gap-1 leading-none">
              <span className={`text-[10.5px] ${d.isToday ? 'font-extrabold text-sky-700 dark:text-sky-300' : 'font-semibold opacity-75'}`}>{d.weekdayKo}</span>
              {d.isToday ? (
                <span className="grid h-[1.6em] min-w-[1.6em] place-items-center rounded-full bg-sky-600 px-1 text-[12px] font-extrabold tabular-nums text-white" aria-label="오늘">
                  {d.dayNum}
                </span>
              ) : (
                <span className="text-[12.5px] font-extrabold tabular-nums">
                  {isOtherMonth ? `${d.monthNum}/${d.dayNum}` : d.dayNum}
                </span>
              )}
              {d.holidayName && <span className="min-w-0 truncate text-[9.5px] font-bold">{d.holidayName}</span>}
              {/* 누르면 하루 상세가 열린다는 표시 — 마우스를 올렸을 때만 */}
              {onOpenDay && (
                <PanelRightOpen size={11} className="shrink-0 text-ink3 opacity-0 transition-opacity group-hover/head:opacity-100" aria-hidden />
              )}
            </div>
          </th>
        );
      })}
    </>
  );

  const weekHeaderRowClass = (week: WeekBlock) => (week.hasToday ? 'bg-teal-soft/15' : 'bg-panel-alt/60');

  return (
    <div className="space-y-4">
      {/* ── 월간 상단 툴바 (스크롤해도 상단 고정) ── */}
      <div ref={stickyBarRef} className="sticky top-[var(--shell-top)] z-40">
      <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-panel px-2.5 py-1.5 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          {viewSwitch}
          {weekStart && onWeekChange ? (
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => onWeekChange(plusDays(weekStart, -7))} aria-label="지난주" className="grid h-8 w-8 place-items-center rounded-lg border border-border text-ink2 hover:bg-panel-alt transition-colors cursor-pointer">
                <ChevronLeft size={16} />
              </button>
              <button type="button" onClick={() => onWeekChange(mondayOfDate(todayStr))} className="rounded-lg border border-border bg-panel px-3 py-1.5 text-[11.5px] font-bold text-ink hover:bg-panel-alt transition-colors shadow-2xs cursor-pointer">
                이번 주
              </button>
              <button type="button" onClick={() => onWeekChange(plusDays(weekStart, 7))} aria-label="다음 주" className="grid h-8 w-8 place-items-center rounded-lg border border-border text-ink2 hover:bg-panel-alt transition-colors cursor-pointer">
                <ChevronRight size={16} />
              </button>
            </div>
          ) : (
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
          )}

          <h2 className="ml-1 text-[14px] font-extrabold text-ink flex items-center gap-1.5">
            <CalendarIcon size={16} className="text-teal" />
            {weekStart && weeks[0] ? (
              <span>
                {weeks[0].days[0].monthNum}월 {weeks[0].weekNum}주차
                <span className="ml-1.5 text-[12px] font-semibold text-ink3">
                  {weeks[0].days[0].monthNum}/{weeks[0].days[0].dayNum} ~ {weeks[0].days[6].monthNum}/{weeks[0].days[6].dayNum}
                </span>
              </span>
            ) : (
              <span>{yearNum}년 {monthNum}월</span>
            )}
          </h2>

          {!weekStart && currentMonth === todayStr.slice(0, 7) && (
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

        {/* 필터·검색 및 액션 버튼 */}
        <div className="flex flex-wrap items-center gap-1.5">
          {filters}
          {onOpenConfig && (
            <button
              type="button"
              onClick={onOpenConfig}
              className="flex items-center gap-1 rounded-xl border border-border bg-panel px-3 py-1.5 text-[11.5px] font-bold text-ink hover:bg-panel-alt transition-colors shadow-2xs cursor-pointer"
            >
              <Settings size={12} className="text-ink3" />
              <span>태그 관리</span>
            </button>
          )}
        </div>
      </div>

      </div>

      {/* 스크롤 중인 주차의 날짜·요일 머리행 — 아래쪽 사람 행에서도 날짜가 보이도록 상단 바 아래에 붙인다.
          본표는 가로 스크롤 래퍼 안에 있어 머리행에 sticky를 걸 수 없으므로 같은 열 구성으로 따로 그린다. */}
      {stickyWeek && (
        <div
          ref={(el) => {
            stickyWeekScrollRef.current = el;
            if (el && tableScrollRef.current) el.scrollLeft = tableScrollRef.current.scrollLeft;
          }}
          className="absolute inset-x-0 top-full mt-1 overflow-hidden rounded-lg border border-border bg-panel shadow-md"
        >
          <table className="w-full min-w-[980px] table-fixed border-collapse text-left text-[11px]">
            {MATRIX_COLGROUP}
            <thead>
              <tr className={weekHeaderRowClass(stickyWeek)}>{renderWeekHeaderCells(stickyWeek)}</tr>
            </thead>
          </table>
        </div>
      )}
      </div>

      {/* ── 일주일 단위로 끊어서 아래로 이어지는 단일 통합 매트릭스 표 (가로너비 일치 & 일체형 엑셀 뷰) ── */}
      <div
        ref={tableScrollRef}
        onScroll={(e) => {
          if (stickyWeekScrollRef.current) stickyWeekScrollRef.current.scrollLeft = e.currentTarget.scrollLeft;
        }}
        className="overflow-x-auto rounded-xl border border-border bg-panel shadow-xs scrollbar-thin [contain:inline-size]"
      >
        <table className="w-full min-w-[980px] table-fixed border-collapse text-left text-[11px] select-text">
          {MATRIX_COLGROUP}

          <tbody>
            {weeks.map((week, wIdx) => {
              return (
                <Fragment key={week.weekNum}>
                  {/* 주차 구분 날짜 헤더 행 (주차 정보 + 7개 요일 날짜) */}
                  <tr
                    ref={(row) => {
                      if (row) weekHeaderRefs.current.set(week.weekNum, row);
                      else weekHeaderRefs.current.delete(week.weekNum);
                      if (week.hasToday) currentWeekRef.current = row;
                    }}
                    className={`border-b border-border ${wIdx > 0 ? 'border-t-2 border-t-border' : ''} ${weekHeaderRowClass(week)}`}
                  >
                    {renderWeekHeaderCells(week)}
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
                          className={`p-1.5 align-top ${dayColBorderClass(d.isToday)} cursor-pointer transition-colors group relative ${
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
                              <span className="text-[9px] font-medium text-rose-400 dark:text-rose-300 truncate" title={holidayName}>
                                {holidayName}
                              </span>
                            )}
                            {/* 전사 주요 일정 내용 */}
                            {content ? (
                              <div className="whitespace-pre-line text-[10px] font-bold text-rose-600 dark:text-rose-400 break-words leading-tight">
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
                      const weekDates = week.days.map((day) => day.dateStr);
                      const { bars: weekBars, entryOf, keys: barKeys } = weekBarsOf(member.id, weekDates);
                      const barLanes = weekBars.reduce((max, bar) => Math.max(max, bar.lane + 1), 0);
                      // 계획 미작성 — 지나지 않은 주에서 평일(월~금)에 업무·메모·회의·외근·휴가가 하나도 없으면
                      const unwritten =
                        week.days[6].dateStr >= todayStr &&
                        week.days.slice(0, 5).every((day) => !hasPlannedDay(cellOf(member.id, day.dateStr)));
                      return (
                        <Fragment key={`${week.weekNum}-${member.id}`}>
                        <tr
                          ref={week.hasToday && isMe ? myCurrentWeekRowRef : undefined}
                          className={`border-b transition-colors last:border-b-0 ${isMe ? 'border-sky-200/80 dark:border-sky-900' : 'border-border/60 hover:bg-panel-alt/10'}`}
                        >
                          {/* 좌측 성명 열 — 내 행은 옅은 하늘 바탕 */}
                          <td className={`border-r border-border p-2.5 align-top text-center shadow-2xs ${isMe ? 'bg-sky-50 dark:bg-sky-950/30' : 'bg-panel'}`}>
                            <div className="flex flex-col items-center justify-center py-1">
                              <div className="flex items-center gap-1">
                                <span className={`text-[12px] font-bold ${isMe ? 'text-teal' : 'text-ink'}`}>
                                  {/* 업무계획 한정: 대표이사 이름/직책은 '위원장'으로 표시 */}
                                  {member.name === '대표이사' || member.position === '대표이사' || member.jobTitle === '대표이사'
                                    ? '위원장'
                                    : member.name}
                                </span>
                                <BirthdayMark userId={member.id} />
                                {isMe && (
                                  <span className="rounded bg-teal-soft/50 px-1 py-0.2 text-[8px] font-bold text-teal">
                                    나
                                  </span>
                                )}
                              </div>
                              {unwritten && (
                                <span className="mt-0.5 rounded bg-amber-soft px-1 py-px text-[9px] font-bold text-amber" title="이번 주 평일에 업무·메모·회의·외근·휴가가 없습니다">
                                  미작성
                                </span>
                              )}
                              <span className="text-[9px] text-ink3 truncate max-w-[80px] mt-0.5">
                                {/* 업무계획 한정: 대표이사 서브라벨을 '위원회'로 표시 */}
                                {member.name === '대표이사' || member.position === '대표이사' || member.jobTitle === '대표이사'
                                  ? '위원회'
                                  : (member.position || member.jobTitle || member.dept)}
                              </span>
                            </div>
                          </td>

                          {/* 7일치 셀 (월~일) */}
                          {week.days.map((d, dayIndex) => {
                            const dayStr = d.dateStr;
                            const cell = cellOf(member.id, dayStr);
                            // 여러 날 외근·출장은 막대로 그리므로 칸 칩에서 뺀다
                            const entries = cell.entries.filter((entry) => !(entry.outside && barKeys.has(entry.outside.key)));

                            // 강조는 '오늘'(열 테두리) 하나 — 내 행은 테두리 대신 옅은 하늘 바탕, 주말·공휴일은 옅은 바탕
                            const cellBgClass = isMe
                              ? 'bg-sky-50/60 dark:bg-sky-950/20'
                              : d.isRedDay
                              ? 'bg-rose-50/30 dark:bg-rose-950/15'
                              : d.isSat
                              ? 'bg-blue-50/40 dark:bg-blue-950/20'
                              : 'bg-transparent hover:bg-panel-alt/20';
                            const cellBorderClass = dayColBorderClass(d.isToday);
                            // 내 칸을 누르면 새 일정, 남의 칸을 누르면 그날 상세(팝업)
                            const onCellClick = isMe
                              ? onCreate ? () => onCreate(dayStr, member) : undefined
                              : onOpenDay ? () => onOpenDay(dayStr) : undefined;
                            // 끌고 있는 업무는 내 칸에만 놓을 수 있다
                            const droppable = isMe && draggedItem !== null;

                            return (
                              <td
                                key={dayStr}
                                onDragOver={droppable ? (e) => {
                                  e.preventDefault();
                                  e.dataTransfer.dropEffect = 'move';
                                  if (dropDate !== dayStr) setDropDate(dayStr);
                                } : undefined}
                                onDrop={droppable ? (e) => {
                                  e.preventDefault();
                                  if (draggedItem.date !== dayStr) onMoveItem?.(draggedItem, dayStr);
                                  endDrag();
                                } : undefined}
                                // 위(일정) 칸 누르기 — 내 칸은 일정 창, 남의 칸은 하루 상세. 아래 메모 칸은 CellMemo 가 받는다
                                onClick={onCellClick}
                                // h-px: 칸 안 div 가 행 높이를 꽉 채우게(h-full) — 줄이 늘면 위 일정 칸만 늘고 메모 칸은 바닥에 그대로
                                className={`group/day h-px p-2 align-top ${cellBorderClass} transition-colors relative ${cellBgClass} ${
                                  onCellClick ? 'cursor-pointer' : ''
                                } ${!d.inCurrentMonth ? 'opacity-50' : ''} ${droppable && dropDate === dayStr ? 'ring-2 ring-inset ring-teal' : ''}`}
                              >
                                {onCreate && (
                                  <button
                                    type="button"
                                    aria-label={`${member.name} ${d.monthNum}월 ${d.dayNum}일 일정 추가`}
                                    title="일정 추가"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onCreate(dayStr, member);
                                    }}
                                    className="absolute right-1 top-1 z-20 grid h-5 w-5 place-items-center rounded border border-border bg-panel text-ink2 opacity-0 shadow-2xs transition-opacity hover:border-teal/50 hover:text-teal focus:opacity-100 group-hover/day:opacity-100"
                                  >
                                    <Plus size={12} />
                                  </button>
                                )}
                                {/* 0) 여러 날 외근·출장 막대 — 시작 칸에서 그려 옆 칸으로 가로지른다. 모든 칸이 같은 높이를 비워 둔다 */}
                                {weekBars.filter((bar) => bar.startIndex === dayIndex).map((bar) => (
                                  <OutsideSpanBar
                                    key={bar.key}
                                    bar={bar}
                                    entry={entryOf(bar.key)}
                                    onOpen={onOpenEntry}
                                    look={look}
                                  />
                                ))}
                                <div className="flex h-full min-h-[85px] flex-col">
                                  {/* 1) 위 칸: 일정 — 여러 날 막대 자리 + 칩(종일 먼저, 시작 시각 순). 남는 높이는 여기가 가진다 */}
                                  {barLanes > 0 && <div className="shrink-0" style={{ height: barLanes * SPAN_LANE_HEIGHT }} aria-hidden />}
                                  <div className="min-h-[36px] flex-1 space-y-1">
                                    {entries.map((entry) => {
                                      const chip = <EntryChip entry={entry} onOpen={onOpenEntry} look={look} />;
                                      const item = entry.item;
                                      if (!onMoveItem || !item || !canMoveEntry(entry, actor.id)) return <Fragment key={entry.key}>{chip}</Fragment>;
                                      return (
                                        <div
                                          key={entry.key}
                                          draggable
                                          onDragStart={(e) => {
                                            e.dataTransfer.effectAllowed = 'move';
                                            e.dataTransfer.setData('text/plain', item.title);
                                            setDraggedItem(item);
                                          }}
                                          onDragEnd={endDrag}
                                          className={draggedItem?.id === item.id ? 'opacity-50' : ''}
                                        >
                                          {chip}
                                        </div>
                                      );
                                    })}
                                  </div>
                                  {/* 2) 아래 칸: 메모 — 바닥에 붙고 높이는 늘 같다. 내 칸은 눌러서 바로 고친다 */}
                                  <CellMemo
                                    key={`${cell.memoPlan?.id ?? 'new'}|${cell.memo ?? ''}`}
                                    text={cell.memo}
                                    label={`${member.name} ${d.monthNum}월 ${d.dayNum}일 메모`}
                                    onSave={isMe && onSaveMemo ? (text) => onSaveMemo(dayStr, cell.memoPlan, text) : undefined}
                                    look={look}
                                  />
                                </div>
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

/** 여러 날 막대 한 줄의 높이(px) — 칸마다 이만큼 위를 비워 막대가 글과 겹치지 않게 한다 */
const SPAN_LANE_HEIGHT = 20;
/** 칸 안쪽 여백(p-2)과 같은 값 */
const CELL_PADDING = 8;

/** 칸 항목 칩 — `종일`/`HH:mm` + `[태그]` + 제목. 누르면 일정 창(또는 결재 상세). 결재 휴가는 상세가 없어 누르지 않는다. */
function EntryChip({ entry, onOpen, look }: { entry: DayEntry; onOpen: (entry: DayEntry) => void; look: DensityLook }) {
  const { label, badgeClass, dotClass, hint } = chipLook(entry);
  const openable = !(entry.source === 'APPROVAL' && !entry.outside);
  const body = (
    <>
      {/* 시각 칸 폭·숫자 폭 고정 — 11:00 처럼 좁은 숫자도 점·제목 열이 맞게 */}
      <span className={`w-[2.8em] shrink-0 ${look.time} font-normal tabular-nums opacity-80`}>{timeOf(entry)}</span>
      {/* 작은 원은 확대 배율에서 픽셀 반올림으로 찌그러진다 — 크게 그려 축소(변형은 반올림하지 않는다) */}
      {dotClass && <span className={`-mx-0.5 h-2 w-2 shrink-0 scale-50 rounded-full ${dotClass}`} aria-hidden />}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {entry.roomStatus === 'PENDING' && (
        <span className="shrink-0 rounded bg-amber-soft px-1 text-[8px] font-bold text-amber">대기</span>
      )}
      {entry.roomStatus === 'REJECTED' && (
        <span className="shrink-0 rounded bg-danger/10 px-1 text-[8px] font-bold text-danger">회의실 반려</span>
      )}
      {entry.outside?.source === 'APPROVAL' && (
        <Check size={look.mark} strokeWidth={3} className="shrink-0 opacity-40" aria-label="결재 완료" />
      )}
      {entry.item?.routine && <Repeat size={look.mark} strokeWidth={3} className="shrink-0 opacity-40" aria-label="반복" />}
    </>
  );
  const chipClass = `flex w-full items-center gap-1 rounded border px-1.5 text-left ${look.chip} font-bold shadow-2xs ${badgeClass}`;
  if (!openable) {
    return (
      // 누를 상세가 없는 칩 — 칸 누르기(새 일정 창)로 넘기지 않는다
      <div title={timeRangeOf(entry) ? `${hint} (${timeRangeOf(entry)})` : hint} className={chipClass} onClick={(e) => e.stopPropagation()}>
        {body}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpen(entry);
      }}
      title={timeRangeOf(entry) ? `${hint} (${timeRangeOf(entry)})` : hint}
      className={`${chipClass} cursor-pointer hover:brightness-95`}
    >
      {body}
    </button>
  );
}

/**
 * 칸 아래쪽 메모 칸 — 서식 없는 글. 기본 높이는 같고, 글이 길면 그만큼 늘어난다(칸·행도 같이). 점선 위는 일정, 아래는 메모.
 * `onSave`가 있으면(내 칸) 메모 칸을 눌러 그 자리에서 고친다. 칸 밖을 누르거나 Ctrl+Enter = 저장, Esc = 취소.
 */
function CellMemo({
  text,
  label,
  onSave,
  look,
}: {
  text: string | null;
  label: string;
  onSave?: (text: string) => Promise<void>;
  look: DensityLook;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const startEdit = () => {
    if (!onSave || draft !== null) return;
    setError('');
    setDraft(text ?? '');
  };

  const finish = async () => {
    if (draft === null || saving || !onSave) return;
    if (draft.trim() === (text ?? '').trim()) {
      setDraft(null);
      return;
    }
    if (draft.length > WORK_PLAN_MEMO_MAX) {
      setError(`메모는 ${WORK_PLAN_MEMO_MAX.toLocaleString()}자까지 쓸 수 있습니다(서식 포함).`);
      return;
    }
    setSaving(true);
    try {
      await onSave(draft);
      setDraft(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '메모를 저장하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  };

  // 칸에서 체크박스 누르기 — 고치기 창을 열지 않고 바로 저장
  const toggleTask = async (taskIndex: number) => {
    if (!onSave || !text || saving) return;
    setSaving(true);
    setError('');
    try {
      await onSave(toggleMemoTask(text, taskIndex));
    } catch (e) {
      setError(e instanceof Error ? e.message : '메모를 저장하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role={onSave && draft === null ? 'button' : undefined}
      tabIndex={onSave && draft === null ? 0 : undefined}
      aria-label={onSave && draft === null ? `${label} ${text ? '고치기' : '쓰기'}` : undefined}
      title={onSave && draft === null ? '눌러서 메모 쓰기' : undefined}
      // 내 칸 메모 칸 누르기는 메모 고치기 — 칸 누르기(새 일정 창)로 넘기지 않는다
      onClick={
        onSave
          ? (e) => {
              e.stopPropagation();
              startEdit();
            }
          : undefined
      }
      onKeyDown={
        onSave && draft === null
          ? (e) => {
              if (e.key === 'Enter') startEdit();
            }
          : undefined
      }
      // 기본 높이(두 줄)는 늘 같고 글이 길면 늘어난다 — 옆 칸 때문에 행이 늘 때는 위 일정 칸이 늘어난다(shrink-0)
      // 옅은 바탕으로 위 일정 칸과 구분한다
      className={`-mx-1 mt-1.5 min-h-[2.5rem] shrink-0 rounded border-t border-dashed border-border bg-panel-alt/50 px-1 pt-1 ${
        onSave && draft === null ? 'cursor-text hover:bg-panel-alt' : ''
      }`}
    >
      {draft !== null ? (
        <>
          {/* 서식 메모 편집기 — 위에 서식 버튼이 뜬다. 칸 밖을 누르거나 Ctrl+Enter = 저장, Esc = 취소 */}
          <WorkPlanMemoEditor
            label={label}
            value={draft}
            disabled={saving}
            onChange={setDraft}
            onBlur={() => void finish()}
            onSave={() => void finish()}
            onCancel={() => {
              setError('');
              setDraft(null);
            }}
            className={`min-h-[3.5rem] rounded border border-sky-300 bg-panel px-1.5 py-1 ${look.memo} leading-relaxed text-ink focus-within:border-sky-400 dark:border-sky-700`}
          />
          {error && <div role="alert" className="mt-0.5 text-[9px] font-semibold text-danger">{error}</div>}
        </>
      ) : text ? (
        <WorkPlanMemoView
          memo={text}
          onToggle={onSave ? (i) => void toggleTask(i) : undefined}
          className={`${look.memo} leading-relaxed text-ink2 ${saving ? 'opacity-60' : ''}`}
        />
      ) : (
        onSave && (
          // 비어 있는 내 메모 칸 — 흐린 '메모' 글자를 늘 보인다
          <span className={`flex items-center gap-1 ${look.memo} text-ink3/60`}>
            <StickyNote size={look.mark + 1} />
            메모
          </span>
        )
      )}
    </div>
  );
}

/** 여러 날 외근·출장 막대 — 결재 완료 건은 끝에 옅은 체크, 누르면 상세. */
function OutsideSpanBar({ bar, entry, onOpen, look }: { bar: WeekBar; entry: DayEntry; onOpen: (entry: DayEntry) => void; look: DensityLook }) {
  const { label, badgeClass } = chipLook(entry);
  const view = entry.outside;
  const range = view ? `${view.startDate.slice(5).replace('-', '/')}~${view.endDate.slice(5).replace('-', '/')}` : '';
  const time = !entry.allDay && entry.startTime && entry.endTime ? `${entry.startTime}~${entry.endTime}` : '';
  return (
    <div
      role="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpen(entry);
      }}
      title={`${label} (${range}${time ? ` · ${time}` : ''})`}
      className={`absolute z-10 flex items-center justify-between gap-1 border px-1.5 ${look.bar} font-bold shadow-2xs cursor-pointer hover:brightness-95 ${badgeClass} ${
        bar.continuesBefore ? 'rounded-l-none border-l-0' : 'rounded-l'
      } ${bar.continuesAfter ? 'rounded-r-none border-r-0' : 'rounded-r'}`}
      style={{
        top: CELL_PADDING + bar.lane * SPAN_LANE_HEIGHT,
        left: bar.continuesBefore ? 0 : CELL_PADDING / 2,
        width: `calc(${bar.span * 100}% + ${bar.span - 1}px - ${(bar.continuesBefore ? 0 : CELL_PADDING / 2) + (bar.continuesAfter ? 0 : CELL_PADDING / 2)}px)`,
        height: SPAN_LANE_HEIGHT - 3,
      }}
    >
      <span className="truncate">{bar.continuesBefore ? '◂ ' : ''}{label}</span>
      <span className="flex shrink-0 items-center gap-1">
        <span className="text-[8px] font-normal opacity-80">{range}{bar.continuesAfter ? ' ▸' : ''}</span>
        {view?.source === 'APPROVAL' && <Check size={8} strokeWidth={3} className="opacity-40" aria-label="결재 완료" />}
      </span>
    </div>
  );
}
