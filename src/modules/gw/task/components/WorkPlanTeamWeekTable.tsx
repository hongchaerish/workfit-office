import type { MinuteRange } from '@/domain/workPlan/timeGrid';
import { isCopyGesture, COPY_BADGE_CLASS } from './dragCopy';
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import type { User } from '@/domain/user/schema';
import type { WorkPlan } from '@/domain/workPlan/schema';
import type { WorkPlanItem } from '@/domain/workPlan/item';
import { canMoveEntry, type DayCell, type MemoPlanRef } from '@/domain/workPlan/dayEntries';
import { CellMemo } from './CellMemo';
import { useHolidays } from '@/features/holiday/useHolidays';
import { KOREA_STANDARD_HOLIDAYS } from '@/domain/holiday/koreaHolidays';
import { BirthdayMark } from '@/features/birthday/BirthdayProvider';
import { useRosterOrder } from '@/features/user/useRosterOrder';
import { EntryLine } from './EntryLine';
import { lineToneOf, type LineTone } from './entryKind';
import { weekSpans } from './weekSpans';
import { chairToCommittee, groupRoster, isChairAccount, isUnwrittenWeek, summarizeGroup } from './teamWeekGroups';

/* 주간 보기 — 부서별로 접히는 조용한 표. 칸 안은 C 모양 줄 글, 칸을 누르면 칸 옆 상세 창(화면이 띄운다). */

const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일'];
/** 여러 칸에 걸친 줄 하나의 높이(px) */
const SPAN_LANE = 20;
/** 걸친 줄 바탕 — 칸 경계를 덮어 한 줄로 이어 보이게, 아주 옅게 */
const SPAN_FILL: Record<LineTone, string> = {
  item: 'bg-panel',
  meeting: 'bg-panel',
  outside: 'bg-[#eef6fc] dark:bg-sky-950/40',
  leave: 'bg-[#fbf6dc] dark:bg-yellow-950/30',
};
/** 칸당 보이는 줄 수 — 넘치면 '+N건 더' */
const LINES_PER_CELL = 3;

const plusDays = (date: string, days: number) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};
const mondayOfDate = (date: string) => plusDays(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7));
const md = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8))}`;

/** 업무계획 한정 — 대표이사 계정은 '위원장 / 위원회'로 */
const isChair = isChairAccount;
const displayName = (m: User) => (isChair(m) ? '위원장' : m.name);
const displayRank = (m: User) => (isChair(m) ? '위원회' : m.position || m.jobTitle || '');

export interface WorkPlanTeamWeekTableProps {
  actor: User;
  todayStr: string;
  /** 월요일 */
  weekStart: string;
  onWeekChange: (monday: string) => void;
  /** 겸직 행 포함 */
  members: User[];
  cellOf: (userId: string, date: string) => DayCell;
  workPlans: WorkPlan[];
  viewSwitch: ReactNode;
  filters: ReactNode;
  /** 부서 필터나 검색어가 있으면 모든 묶음을 편다 */
  forceOpen: boolean;
  onOpenCompanySchedule?: (date: string, text?: string, planId?: string) => void;
  onOpenCell: (member: User, date: string, anchor: HTMLElement) => void;
  onOpenPerson: (member: User) => void;
  /** 내 빈 칸 누르기 — 바로 새 일정. 없으면(사용 중이 아닌 계정) 상세 창 */
  onCreate?: (date: string, member: User) => void;
  /** 끌어 놓기 — copy 면 같은 내용으로 새로 만들고(Ctrl), 아니면 옮긴다 */
  onMoveItem?: (item: WorkPlanItem, date: string, range?: MinuteRange, copy?: boolean) => void;
  /** 상세 창이 열린 칸 */
  selected: { userId: string; date: string } | null;
  /** 날짜 머리 누르기 — 그날 모두의 일정 */
  onOpenDay?: (date: string) => void;
  /** 복사한 업무가 있으면 — 내 칸을 누르면 그날에 붙여넣는다 */
  onPaste?: (date: string) => void;
  /** 그날 메모 저장 — 없으면(사용 중이 아닌 계정) 내 칸도 보기만 */
  onSaveMemo?: (date: string, memoPlan: MemoPlanRef | null, text: string) => Promise<void>;
}

export function WorkPlanTeamWeekTable({
  actor,
  todayStr,
  weekStart,
  onWeekChange,
  members,
  cellOf,
  workPlans,
  viewSwitch,
  filters,
  forceOpen,
  onOpenCompanySchedule,
  onOpenCell,
  onOpenPerson,
  onCreate,
  onMoveItem,
  selected,
  onOpenDay,
  onPaste,
  onSaveMemo,
}: WorkPlanTeamWeekTableProps) {
  const { compare, deptOrder } = useRosterOrder();
  const weekDates = useMemo(() => Array.from({ length: 7 }, (_, i) => plusDays(weekStart, i)), [weekStart]);
  const weekdays = weekDates.slice(0, 5);
  const weekend = weekDates.slice(5);
  /** 칸마다 날짜 — 월~금 한 날씩, 토·일은 한 칸 */
  const spanCols = [...weekdays.map((d) => [d]), weekend];

  const holidaysQuery = useHolidays();
  const holidayOf = useMemo(() => {
    const map = new Map<string, string>();
    const db = holidaysQuery.data ?? [];
    if (db.length > 0) db.forEach((h) => map.set(h.date, h.name));
    else Object.values(KOREA_STANDARD_HOLIDAYS).flat().forEach((h) => map.set(h.date, h.name));
    return map;
  }, [holidaysQuery.data]);

  const companyPlanOf = useMemo(() => {
    const map = new Map<string, WorkPlan>();
    for (const p of workPlans) if (p.ownerUserId === '__COMPANY__') map.set(p.date, p);
    return map;
  }, [workPlans]);

  const groups = useMemo(
    () => groupRoster(chairToCommittee(members, isChair), { deptOrder, compare }),
    [members, deptOrder, compare],
  );

  // 접은 부서 — 처음엔 모두 펼친다(모든 사람이 보이게)
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const isOpen = (key: string) => forceOpen || !closed.has(key);
  // 줄무늬는 부서마다 새로 세지 않고 표 전체 줄 순서로 — 부서를 넘어가도 번갈아 이어진다
  const rowStart = new Map<string, number>();
  {
    let n = 0;
    for (const g of groups) {
      rowStart.set(g.key, n);
      n += !isOpen(g.key) ? 1 : g.members.length;
    }
  }
  /** 마우스 옆 안내 — 누구의 며칠인지만(글자 최소) */
  const [hover, setHover] = useState<{ name: string; date: string; x: number; y: number } | null>(null);
  const toggle = (key: string) =>
    setClosed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });


  /** '+N건 더'를 누른 칸 */
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  /** 상세 창을 연 줄 — 같은 사람이 두 줄(내 일정·부서 안)에 있어도 누른 줄만 테두리 */
  const [selectedRow, setSelectedRow] = useState<string | null>(null);
  const [dragged, setDragged] = useState<WorkPlanItem | null>(null);
  const [dropDate, setDropDate] = useState<string | null>(null);
  /** 놓으려는 칸에 Ctrl 을 누르고 있나(복사) */
  const [dropCopy, setDropCopy] = useState(false);

  // 날짜 머리를 상단 바 바로 아래에 붙인다 — 상단 바 높이를 재서 쓴다
  const barRef = useRef<HTMLDivElement>(null);
  const [barHeight, setBarHeight] = useState(0);
  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    // offsetHeight — body 글자 배율(zoom) 전 값이라 sticky top 에 그대로 쓴다
    const ro = new ResizeObserver(() => setBarHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const headRef = useRef<HTMLTableSectionElement>(null);
  const [headHeight, setHeadHeight] = useState(0);
  useEffect(() => {
    const el = headRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeadHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const first = weekDates[0];
  const last = weekDates[6];
  // 주차 — 월간 표와 같이 그 달 달력의 몇째 줄인지(1일이 든 주가 1주차)
  const firstOfMonth = `${first.slice(0, 8)}01`;
  const weekNo = Math.floor((Number(first.slice(8)) - 1 + ((new Date(`${firstOfMonth}T00:00:00Z`).getUTCDay() + 6) % 7)) / 7) + 1;

  const cellKey = (userId: string, date: string) => `${userId}|${date}`;

  /** 한 칸의 줄 글 — 3줄까지, 넘치면 '+N건 더'/'접기' */
  const renderLines = (member: User, dates: string[], key: string, skip?: Set<string>) => {
    const isMe = member.id === actor.id;
    // skip — 여러 칸에 걸쳐 한 줄로 따로 그리는 일정(출장 등)은 칸 안에서 빼고
    const rows = dates.flatMap((date) => cellOf(member.id, date).entries.filter((entry) => !skip?.has(entry.key)).map((entry) => ({ date, entry })));
    const showAll = expanded.has(key);
    const shown = showAll ? rows : rows.slice(0, LINES_PER_CELL);
    const more = rows.length - shown.length;
    return (
      <>
        <div className="space-y-px">
          {shown.map(({ date, entry }) => {
            const line = (
              <EntryLine
                entry={entry}
                wrap
                className={dates.length > 1 ? 'pl-1' : ''}
              />
            );
            const prefix = dates.length > 1 ? <span className="w-3 shrink-0 text-[9.5px] text-ink3">{WEEKDAYS[weekDates.indexOf(date)]}</span> : null;
            const item = entry.item;
            const draggable = isMe && !!onMoveItem && !!item && canMoveEntry(entry, actor.id);
            return (
              <div
                key={`${date}-${entry.key}`}
                className={`flex items-center ${draggable && dragged?.id === item!.id ? 'opacity-50' : ''}`}
                draggable={draggable || undefined}
                onDragStart={
                  draggable
                    ? (e) => {
                        e.dataTransfer.effectAllowed = 'copyMove';
                        e.dataTransfer.setData('text/plain', item!.title);
                        setDragged(item!);
                      }
                    : undefined
                }
                onDragEnd={draggable ? () => { setDragged(null); setDropDate(null); } : undefined}
              >
                {prefix}
                <div className="min-w-0 flex-1">{line}</div>
              </div>
            );
          })}
        </div>
        {(more > 0 || showAll) && rows.length > LINES_PER_CELL && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((prev) => {
                const next = new Set(prev);
                if (next.has(key)) next.delete(key);
                else next.add(key);
                return next;
              });
            }}
            className="mt-0.5 pl-2 text-[10.5px] text-ink3 hover:text-ink"
          >
            {showAll ? '접기' : `+${more}건 더`}
          </button>
        )}
      </>
    );
  };

  /** 그날 메모 — 운영과 같은 서식 메모 칸(굵게·체크 상자 등), 칸 맨 아래에 붙는다. 모든 사람 칸에 보이고, 내 칸만 눌러서 쓴다 */
  const renderMemo = (member: User, date: string) => {
    const cell = cellOf(member.id, date);
    const isMe = member.id === actor.id;
    return (
      <CellMemo
        key={`${cell.memoPlan?.id ?? 'new'}|${cell.memo ?? ''}`}
        text={cell.memo}
        label={`${displayName(member)} ${Number(date.slice(5, 7))}월 ${Number(date.slice(8))}일 메모`}
        onSave={isMe && onSaveMemo ? (text) => onSaveMemo(date, cell.memoPlan, text) : undefined}
        look={{ memo: 'text-[11px]', mark: 10 }}
      />
    );
  };

  const dayHead = (date: string, i: number) => {
    const isToday = date === todayStr;
    const holiday = holidayOf.get(date);
    return (
      <th
        key={date}
        onClick={onOpenDay ? () => onOpenDay(date) : undefined}
        title={onOpenDay ? '그날 모두의 일정 보기' : undefined}
        className={`border-b border-[#e4e8ee] px-2 py-1.5 text-left text-[11.5px] font-semibold ${isToday ? 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300' : holiday ? 'text-rose-600' : 'text-ink2'} ${onOpenDay ? 'cursor-pointer' : ''}`}
      >
        {WEEKDAYS[i]} {Number(date.slice(8))}
        {isToday && <span className="font-normal"> · 오늘</span>}
        {holiday && <span className="ml-1 text-[10px] font-normal">{holiday}</span>}
      </th>
    );
  };

  const cols = (
    <colgroup>
      <col style={{ width: 100 }} />
      <col style={{ width: 92 }} />
      {weekdays.map((d) => (
        <col key={d} />
      ))}
      <col style={{ width: 54 }} />
    </colgroup>
  );

  const tdBase = 'group/cell relative h-px border-b border-l border-[#eef0f3] px-1.5 py-1 align-top dark:border-border';

  const renderCell = (member: User, dates: string[], tint: string, rowKey: string) => {
    const date = dates[0];
    const key = `${cellKey(member.id, date)}${dates.length > 1 ? '+' : ''}`;
    const isMe = member.id === actor.id;
    const count = dates.reduce((n, d) => n + cellOf(member.id, d).entries.length, 0);
    const empty = count === 0 && !(dates.length === 1 && cellOf(member.id, date).memo);
    const isSelected = selected?.userId === member.id && dates.includes(selected.date) && selectedRow === rowKey;
    const canAdd = isMe && !!onCreate && !onPaste;
    const droppable = isMe && dragged !== null && dates.length === 1;
    // 여러 날 출장·휴가 — 시작 칸에서 한 줄로 길게 그리고, 걸친 칸은 그만큼 위를 비운다
    const col = dates.length > 1 ? 5 : weekDates.indexOf(date);
    const spans = weekSpans(spanCols, (d) => cellOf(member.id, d).entries);
    const covering = spans.filter((sp) => sp.start <= col && col <= sp.end);
    const lanes = covering.length ? Math.max(...covering.map((sp) => sp.lane)) + 1 : 0;
    const starting = spans.filter((sp) => sp.start === col);
    return (
      <td
        key={key}
        onMouseMove={(e) => {
          // body 글자 배율(zoom) — fixed 좌표도 배율로 나눈다
          const z = parseFloat(getComputedStyle(document.body).zoom) || 1;
          setHover({ name: displayName(member), date, x: e.clientX / z, y: e.clientY / z });
        }}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => {
          // 붙여넣기 중이면 내 칸에 붙여넣기(토·일 칸은 토요일), 내 빈 칸은 바로 새 일정, 나머지는 칸 옆 상세
          if (isMe && onPaste) onPaste(date);
          else if (isMe && empty && onCreate && dates.length === 1) onCreate(date, member);
          else {
            setSelectedRow(rowKey);
            onOpenCell(member, date, e.currentTarget);
          }
        }}
        onDragOver={
          droppable
            ? (e) => {
                e.preventDefault();
                const copy = isCopyGesture(e);
                e.dataTransfer.dropEffect = copy ? 'copy' : 'move';
                if (dropDate !== date) setDropDate(date);
                if (dropCopy !== copy) setDropCopy(copy);
              }
            : undefined
        }
        onDrop={
          droppable
            ? (e) => {
                e.preventDefault();
                const copy = isCopyGesture(e);
                if (dragged && (copy || dragged.date !== date)) onMoveItem?.(dragged, date, undefined, copy);
                setDragged(null);
                setDropDate(null);
              }
            : undefined
        }
        title={isMe && onPaste ? '여기에 붙여넣기' : undefined}
        className={`${tdBase} ${isMe && onPaste ? 'cursor-copy hover:!bg-teal-soft/20' : 'cursor-pointer'} ${tint} ${
          isSelected ? 'outline outline-1 -outline-offset-1 outline-sky-400/70' : ''
        } ${droppable && dropDate === date ? 'outline outline-2 -outline-offset-2 outline-teal' : ''}`}
      >
        {droppable && dropDate === date && dropCopy && <span className={COPY_BADGE_CLASS}>+ 복사</span>}
        {/* 칸 높이를 다 채우는 세로 줄 — 위는 일정, 맨 아래는 메모 */}
        <div className="flex h-full flex-col">
        {lanes > 0 && <div style={{ height: lanes * SPAN_LANE }} />}
        {starting.map((sp) => {
          const days = Math.min(sp.end, 4) - sp.start + 1;
          return (
            <div
              key={sp.key}
              className={`absolute z-[1] rounded-r ${SPAN_FILL[lineToneOf(sp.entry)]}`}
              style={{
                top: 4 + sp.lane * SPAN_LANE,
                left: 6,
                width: `calc(${days} * 100% + ${days - 1}px ${sp.end === 5 ? '+ 54px' : ''} - 12px)`,
              }}
            >
              {/* 여러 날이라 종일 표시는 빼고 제목만. 걸친 칸의 + 는 마우스를 올릴 때만 */}
              <EntryLine entry={sp.entry} hideTime />
            </div>
          );
        })}
        <div className={`min-h-[22px] ${canAdd ? 'pr-5' : ''}`}>{renderLines(member, dates, key, new Set(spans.map((sp) => sp.key)))}</div>
        {dates.length === 1 && <div className="mt-auto">{renderMemo(member, date)}</div>}
        </div>
        {canAdd && (
          <button
            type="button"
            aria-label={`${Number(date.slice(5, 7))}월 ${Number(date.slice(8))}일 일정 추가`}
            title="일정 추가"
            onClick={(e) => {
              e.stopPropagation();
              onCreate!(date, member);
            }}
            className={`absolute right-1 top-1 z-[2] grid h-[18px] w-[18px] place-items-center rounded text-ink3 transition-opacity hover:text-ink2 hover:opacity-100 group-hover/cell:opacity-80 ${lanes > 0 ? 'opacity-0' : 'opacity-50'}`}
          >
            <Plus size={13} strokeWidth={2.5} />
          </button>
        )}
      </td>
    );
  };

  /** 나 — 표에 있을 때만 맨 위에 고정 */
  const pinned = members.find((m) => m.id === actor.id) ?? null;

  /** 사람 한 줄 — lead 는 맨 앞 칸(부서 합친 칸·'내 일정'), first 는 부서 첫 줄(굵은 위 선), last 는 고정 줄(굵은 아래 선), dim 은 고정 줄과 겹치는 내 줄 */
  const personRow = (member: User, o: { key: string; zebra: boolean; lead: ReactNode; first?: boolean; last?: boolean; dim?: boolean }) => {
    const isMe = member.id === actor.id;
    const unwritten = isUnwrittenWeek(member.id, cellOf, todayStr, weekDates);
    const todayTint = (d: string) => (d === todayStr ? 'bg-sky-50/60 dark:bg-sky-950/20' : '');
    const edge = `${o.first ? 'border-t-2 border-t-[#d9dee6]' : ''} ${o.last ? 'border-b-2 border-b-[#d9dee6]' : ''}`;
    return (
      <tr
        key={o.key}
        className={`group/row ${o.zebra ? 'bg-[#f8f9fb] dark:bg-panel-alt/30' : 'bg-panel'} ${o.dim ? 'text-ink3 [&_*]:!text-ink3' : ''} hover:bg-[#fafbfc] dark:hover:bg-panel-alt/20`}
      >
        {o.lead}
        <th
          scope="row"
          onClick={() => onOpenPerson(member)}
          className={`cursor-pointer border-b border-[#eef0f3] px-2 py-1 text-left align-top font-normal dark:border-border ${edge}`}
        >
          <div className="flex items-center gap-1">
            {/* 이번 주 미작성 — 이름을 진한 주황으로(글자를 덧붙이지 않는다) */}
            <span className={`truncate text-[11.5px] ${unwritten ? 'text-orange-700 dark:text-orange-300' : 'text-ink'}`} title={unwritten ? '이번 주 미작성' : undefined}>
              {displayName(member)}
            </span>
            <BirthdayMark userId={member.id} />
            {isMe && <span className="rounded bg-teal-soft/60 px-1 text-[9px] font-bold text-teal">나</span>}
          </div>
          <div className="truncate text-[10px] leading-tight text-ink3">{displayRank(member)}</div>
        </th>
        {weekdays.map((d) => renderCell(member, [d], `${todayTint(d)} ${edge}`, o.key))}
        {renderCell(member, weekend, `${weekend.includes(todayStr) ? 'bg-sky-50/60 dark:bg-sky-950/20' : ''} ${edge}`, o.key)}
      </tr>
    );
  };

  return (
    <div className="space-y-2">
      {/* 상단 바 — 스크롤해도 위에 붙는다 */}
      <div ref={barRef} className="sticky top-[var(--shell-top)] z-40">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/70 bg-panel px-2 py-1.5">
          <div className="flex flex-wrap items-center gap-2">
            {viewSwitch}
            <span aria-hidden className="mx-0.5 h-4 w-px bg-border" />
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => onWeekChange(plusDays(weekStart, -7))} aria-label="지난주" className="grid h-7 w-7 place-items-center rounded-md text-ink3 transition-colors hover:bg-panel-alt hover:text-ink">
                <ChevronLeft size={16} />
              </button>
              <button type="button" onClick={() => onWeekChange(mondayOfDate(todayStr))} className="h-7 rounded-md px-2 text-[11.5px] font-semibold text-ink2 transition-colors hover:bg-panel-alt hover:text-ink">
                이번 주
              </button>
              <button type="button" onClick={() => onWeekChange(plusDays(weekStart, 7))} aria-label="다음 주" className="grid h-7 w-7 place-items-center rounded-md text-ink3 transition-colors hover:bg-panel-alt hover:text-ink">
                <ChevronRight size={16} />
              </button>
            </div>
            <h2 className="ml-1 text-[14px] font-bold text-ink">
              {Number(first.slice(5, 7))}월 {weekNo}주차
              <span className="ml-1.5 text-[12px] font-medium text-ink3">
                {md(first)} ~ {md(last)}
              </span>
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {filters}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 px-1">
          {!forceOpen && (
            <div className="flex items-center gap-2 text-[11px] text-ink3">
              <button type="button" onClick={() => setClosed(new Set())} className="hover:text-ink">
                모두 펼치기
              </button>
              <span aria-hidden>·</span>
              <button type="button" onClick={() => setClosed(new Set(groups.map((g) => g.key)))} className="hover:text-ink">
                모두 접기
              </button>
            </div>
          )}
      </div>

      <div className="rounded-xl border border-[#e4e8ee] bg-panel [overflow-x:clip] dark:border-border">
        <table className="w-full table-fixed border-collapse text-left">
          {cols}
          <thead ref={headRef} className="sticky z-30 bg-panel" style={{ top: `calc(var(--shell-top) + ${barHeight}px)` }}>
            <tr>
              <th className="border-b border-[#e4e8ee] px-2 py-1.5 text-[11px] font-semibold text-ink3">부서</th>
              <th className="border-b border-[#e4e8ee] px-2 py-1.5 text-[11px] font-semibold text-ink3">이름</th>
              {weekdays.map((d, i) => dayHead(d, i))}
              <th
                onClick={onOpenDay ? () => onOpenDay(weekend[0]) : undefined}
                title={onOpenDay ? '토요일 모두의 일정 보기' : undefined}
                className={`border-b border-[#e4e8ee] px-1 py-1.5 text-center text-[11px] font-semibold ${weekend.includes(todayStr) ? 'bg-sky-50 text-sky-700' : 'text-ink3'} ${onOpenDay ? 'cursor-pointer' : ''}`}
              >
                토·일
              </th>
            </tr>
          </thead>
          <tbody>
            {/* 중요 일정 — 전사 공통 */}
            <tr>
              <th colSpan={2} className="border-b border-[#e4e8ee] px-2 py-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300">중요 일정</th>
              {[...weekdays, weekend[0]].map((date, i) => {
                const dates = i === 5 ? weekend : [date];
                const plan = companyPlanOf.get(date);
                const text = dates.map((d) => companyPlanOf.get(d)?.content?.trim()).filter(Boolean).join(' · ');
                return (
                  <td
                    key={date}
                    onClick={() => onOpenCompanySchedule?.(date, plan?.content?.trim() ?? '', plan?.id)}
                    className={`group/cell cursor-pointer border-b border-l border-[#e4e8ee] px-2 py-1 align-top text-[11px] text-rose-600 dark:border-border ${dates.includes(todayStr) ? 'bg-sky-50/60 dark:bg-sky-950/20' : ''}`}
                  >
                    {text ? (
                      <span className="line-clamp-2 whitespace-pre-line">{text}</span>
                    ) : (
                      <span className="text-[10.5px] text-ink3 opacity-0 group-hover/cell:opacity-70">+ 등록</span>
                    )}
                  </td>
                );
              })}
            </tr>

            {groups.length === 0 && (
              <tr>
                <td colSpan={8} className="py-8 text-center text-[12px] text-ink3">
                  조회된 직원이 없습니다.
                </td>
              </tr>
            )}

            {/* 내 일정 — 중요 일정 바로 아래 고정 */}
            {pinned &&
              personRow(pinned, {
                key: 'pinned',
                zebra: false,
                last: true,
                lead: (
                  <th className="border-b-2 border-r border-[#d9dee6] border-r-[#eef0f3] bg-sky-50/50 px-2 py-1 text-left align-top text-[11px] font-semibold text-sky-700 dark:border-border dark:bg-sky-950/20 dark:text-sky-300">
                    내 일정
                  </th>
                ),
              })}

            {groups.map((group) => {
              const opened = isOpen(group.key);
              const sum = summarizeGroup(group.members, cellOf, todayStr, weekDates);
              const deptCell = (rowSpan: number) => (
                <th
                  rowSpan={rowSpan}
                  onClick={() => toggle(group.key)}
                  title={opened ? '부서 접기' : '부서 펼치기'}
                  className="cursor-pointer select-none border-b border-r border-t-2 border-[#d9dee6] border-r-[#eef0f3] bg-panel px-2 py-1.5 text-left align-top font-normal dark:border-border"
                >
                  {/* 긴 부서는 내려도 부서명이 날짜 머리 아래에 붙어 따라온다 */}
                  <div className="sticky" style={{ top: `calc(var(--shell-top) + ${barHeight + headHeight + 4}px)` }}>
                    <div className="flex items-start gap-0.5 text-[11.5px] font-medium leading-tight text-ink2 [word-break:keep-all] [overflow-wrap:anywhere]">
                      <span className="w-2.5 shrink-0 text-[10px] text-ink3">{opened ? '▾' : '▸'}</span>
                      <span className="min-w-0">{group.label}</span>
                    </div>
                    {opened && <div className="mt-0.5 space-y-px pl-3 text-[10px] leading-tight">
                      <div className="text-ink3">{group.members.length}명</div>
                      {sum.leave > 0 && <div className="text-[#6f630f] dark:text-yellow-300">휴가 {sum.leave}</div>}
                      {sum.outside > 0 && <div className="text-[#155f8d] dark:text-sky-300">외근·출장 {sum.outside}</div>}
                    </div>}
                  </div>
                </th>
              );
              if (!opened) {
                return (
                  <tr key={group.key} className="bg-panel-alt/40">
                    {deptCell(1)}
                    <td
                      colSpan={7}
                      onClick={() => toggle(group.key)}
                      className="cursor-pointer border-b border-t-2 border-[#d9dee6] px-2 py-1.5 align-top text-[11px] text-ink3 dark:border-border"
                    >
                      <span className="text-ink2">{group.members.length}명</span>
                      {sum.leave > 0 && <span className="ml-2 text-[#6f630f] dark:text-yellow-300">휴가 {sum.leave}</span>}
                      {sum.outside > 0 && <span className="ml-2 text-[#155f8d] dark:text-sky-300">외근·출장 {sum.outside}</span>}
                      <span className="ml-3">
                        {group.members.slice(0, 6).map((m, i) => (
                          <Fragment key={m.id}>
                            {i > 0 && ', '}
                            <span className={isUnwrittenWeek(m.id, cellOf, todayStr, weekDates) ? 'text-orange-700 dark:text-orange-300' : ''}>{displayName(m)}</span>
                          </Fragment>
                        ))}
                        {group.members.length > 6 ? ` 외 ${group.members.length - 6}명` : ''}
                      </span>
                    </td>
                  </tr>
                );
              }
              return (
                <Fragment key={group.key}>
                  {group.members.map((member, idx) =>
                    personRow(member, {
                      key: `${group.key}-${member.id}`,
                      zebra: ((rowStart.get(group.key) ?? 0) + idx) % 2 === 1,
                      lead: idx === 0 ? deptCell(group.members.length) : null,
                      first: idx === 0,
                      dim: !!pinned && member.id === actor.id,
                    }),
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 마우스 옆 안내 — 누구·며칠. 상세 창이 열려 있으면 숨긴다 */}
      {hover && !selected && (
        <div
          role="tooltip"
          className="pointer-events-none fixed z-50 rounded bg-ink/85 px-1.5 py-0.5 text-[11px] text-panel"
          style={{ left: hover.x + 12, top: hover.y + 14 }}
        >
          {hover.name} · {Number(hover.date.slice(8))}일 {WEEKDAYS[weekDates.indexOf(hover.date)] ?? ''}
        </div>
      )}
    </div>
  );
}
