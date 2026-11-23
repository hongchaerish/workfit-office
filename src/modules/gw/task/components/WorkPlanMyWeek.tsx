import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { calendarToday } from '@/domain/calendarEvent/calendarDate';
import type { User } from '@/domain/user/schema';
import { canMoveEntry, type DayCell, type DayEntry } from '@/domain/workPlan/dayEntries';
import type { WorkPlanItem } from '@/domain/workPlan/item';
import { DAY_END, SLOT_MINUTES, layoutColumns, moveRange, toHHmm, type MinuteRange } from '@/domain/workPlan/timeGrid';
import { weekOfMonth } from '@/domain/workPlan/weekOfMonth';
import { useHolidays } from '@/features/holiday/useHolidays';
import { TONE_CLASS, entriesToBlocks, type TimeGridBlock } from '../event/TimeGrid';
import { chipLook } from './entryChipLook';
import { shiftDate } from './WorkPlanDayPanel';

const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일'];
/** 한 시간 높이(rem) */
const HOUR_REM = 3;
/** 처음 맨 위에 올 시각(분) — 오늘 주면 지금 1시간 전 */
const INITIAL_TOP = 8 * 60;
/** 시간표를 끄는 동안 위아래 끝에 가까워지면 저절로 스크롤한다 */
const AUTO_SCROLL_EDGE = 40;
const AUTO_SCROLL_STEP = 12;
/** 이만큼(px) 움직여야 끌기로 본다 — 그보다 적으면 누르기(일정 창) */
const DRAG_THRESHOLD = 4;

/** 시간표에서 끌고 있는 내 업무 — 놓으면 date·range 로 저장한다 */
interface BlockDrag {
  block: TimeGridBlock;
  item: WorkPlanItem;
  baseDate: string;
  base: MinuteRange;
  startMinute: number;
  startX: number;
  startY: number;
  /** 실제로 끌었는가 — 끌었으면 제자리에 놓아도 일정 창을 열지 않는다 */
  moved: boolean;
  date: string;
  range: MinuteRange;
}

/** 그 날이 든 주의 월요일 */
export function mondayOf(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0(일) ~ 6(토)
  return shiftDate(date, -((dow + 6) % 7));
}

interface WorkPlanMyWeekProps {
  /** 상단 바 맨 앞에 놓일 보기 전환 */
  viewSwitch?: ReactNode;
  actor: User;
  /** 보고 있는 주의 월요일 */
  weekStart: string;
  onWeekChange: (monday: string) => void;
  cellOf: (userId: string, date: string) => DayCell;
  onOpenEntry: (entry: DayEntry) => void;
  /** 빈 시간 누르기 → 그 시각으로 새 일정. 없으면(사용 중이 아닌 계정) 누를 수 없다 */
  onCreate?: (date: string, member: User, range?: MinuteRange) => void;
  /** 내 일반 업무를 끌어서 옮긴다(range 는 시간표에서 옮겼을 때). 없으면(사용 중이 아닌 계정) 끌 수 없다 */
  onMoveItem?: (item: WorkPlanItem, date: string, range?: MinuteRange) => void;
}

/**
 * 내 주간 — 7일 × 시간 세로 시간표(구글·아웃룩 주 보기). 페이지 전체가 스크롤되고 주차·요일·종일 줄은 위에 남는다.
 * 맨 위 줄은 종일·시간 미정 일정,
 * 빈 시간을 누르면 그 30분 칸으로 새 일정(끌어 옮기면 10분 단위), 블록을 누르면 상세.
 * 내 일반 업무는 끌어서 시간·요일을 옮긴다(길이는 그대로, 놓을 때 저장, 이번 주 안에서만).
 */
export function WorkPlanMyWeek({ viewSwitch, actor, weekStart, onWeekChange, cellOf, onOpenEntry, onCreate, onMoveItem }: WorkPlanMyWeekProps) {
  /** 위에 남는 주차·요일·종일 줄 */
  const stickyRef = useRef<HTMLDivElement>(null);
  /** 처음 보일 시각 표시 — 이 자리로 페이지를 스크롤한다 */
  const startAnchorRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<BlockDrag | null>(null);
  /** 끌고 놓은 뒤 따라오는 클릭이 일정 창을 열지 않게 */
  const suppressClick = useRef(false);
  /** 종일 줄에서 끌고 있는 내 업무와 놓으려는 날짜 */
  const [untimedItem, setUntimedItem] = useState<WorkPlanItem | null>(null);
  const [untimedDrop, setUntimedDrop] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const today = calendarToday(now);
  const nowMinute = now.getHours() * 60 + now.getMinutes();

  const holidaysQuery = useHolidays();
  const holidayOf = (date: string) => holidaysQuery.data?.find((h) => h.date === date)?.name;

  const days = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const date = shiftDate(weekStart, i);
        const entries = cellOf(actor.id, date).entries;
        const blocks = entriesToBlocks(entries);
        const byKey = new Map(entries.map((e) => [e.key, e]));
        return {
          date,
          weekday: WEEKDAYS[i],
          untimed: entries.filter((e) => e.allDay || !e.startTime),
          laid: layoutColumns(blocks.filter((b) => !b.allDay)),
          entryOf: (key: string) => byKey.get(key),
        };
      }),
    [weekStart, cellOf, actor.id],
  );
  const hasToday = days.some((d) => d.date === today);

  useLayoutEffect(() => {
    const anchor = startAnchorRef.current;
    if (!anchor) return;
    const top = hasToday ? Math.max(nowMinute - 60, 0) : INITIAL_TOP;
    anchor.style.top = `${(top / DAY_END) * 100}%`;
    anchor.style.scrollMarginTop = `${(stickyRef.current?.offsetHeight ?? 0) + 8}px`;
    anchor.scrollIntoView({ block: 'start' });
    // 주가 바뀔 때만 맞춘다(1분마다 움직이지 않게)
  }, [weekStart]);

  const pct = (minutes: number) => `${(minutes / DAY_END) * 100}%`;
  const end = shiftDate(weekStart, 6);
  const w = weekOfMonth(weekStart);
  const [, sm, sd] = weekStart.split('-').map(Number);
  const [, em, ed] = end.split('-').map(Number);

  const createAt = (date: string) => (e: ReactMouseEvent<HTMLDivElement>) => {
    if (!onCreate) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.height === 0) return;
    const minute = ((e.clientY - rect.top) / rect.height) * DAY_END;
    const start = Math.min(Math.floor(minute / SLOT_MINUTES) * SLOT_MINUTES, DAY_END - SLOT_MINUTES);
    onCreate(date, actor, { start, end: start + SLOT_MINUTES });
  };

  /** 끌 수 있는 항목이면 원본을 돌려준다 */
  const movableItem = (entry: DayEntry | undefined) =>
    onMoveItem && entry?.item && canMoveEntry(entry, actor.id) ? entry.item : null;

  /** 포인터 위치 → 분. 비율로 계산해 화면 배율과 무관하다 */
  const minuteAt = (clientY: number) => {
    const rect = gridRef.current?.getBoundingClientRect();
    if (!rect || rect.height === 0) return 0;
    return Math.min(Math.max(((clientY - rect.top) / rect.height) * DAY_END, 0), DAY_END - 1);
  };
  /** 포인터 위치 → 그 주의 날짜. 첫 칸은 시각 열이다 */
  const dateAt = (clientX: number) => {
    const first = gridRef.current?.children[1]?.getBoundingClientRect();
    if (!first || first.width === 0) return weekStart;
    return shiftDate(weekStart, Math.min(Math.max(Math.floor((clientX - first.left) / first.width), 0), 6));
  };

  const beginDrag = (e: ReactPointerEvent, block: TimeGridBlock, item: WorkPlanItem, date: string) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    suppressClick.current = false;
    const base = { start: block.start, end: block.end };
    setDrag({ block, item, baseDate: date, base, startMinute: minuteAt(e.clientY), startX: e.clientX, startY: e.clientY, moved: false, date, range: base });
  };

  const moveDrag = (e: ReactPointerEvent) => {
    if (!drag) return;
    const moved = drag.moved || Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) >= DRAG_THRESHOLD;
    if (!moved) return;
    const top = stickyRef.current?.getBoundingClientRect().bottom ?? 0;
    if (e.clientY < top + AUTO_SCROLL_EDGE) window.scrollBy(0, -AUTO_SCROLL_STEP);
    else if (e.clientY > window.innerHeight - AUTO_SCROLL_EDGE) window.scrollBy(0, AUTO_SCROLL_STEP);
    setDrag({ ...drag, moved, date: dateAt(e.clientX), range: moveRange(drag.base, minuteAt(e.clientY) - drag.startMinute) });
  };

  const finishDrag = () => {
    if (!drag) return;
    setDrag(null);
    suppressClick.current = drag.moved;
    const changed = drag.date !== drag.baseDate || drag.range.start !== drag.base.start;
    if (changed) onMoveItem?.(drag.item, drag.date, drag.range);
  };

  const gridCols = 'grid grid-cols-[3.25rem_repeat(7,minmax(0,1fr))]';

  return (
    <div className="rounded-xl border border-border bg-panel shadow-xs">
      {/* 위에 남는 줄 — 조상에 overflow 를 두면 sticky 가 풀린다 */}
      <div ref={stickyRef} className="sticky top-[var(--shell-top)] z-40 rounded-t-xl bg-panel">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-2.5 py-1.5">
        {viewSwitch}
        <button type="button" aria-label="지난주" onClick={() => onWeekChange(shiftDate(weekStart, -7))} className="grid h-8 w-8 place-items-center rounded-lg border border-border text-ink2 hover:bg-panel-alt">
          <ChevronLeft size={16} />
        </button>
        <button type="button" onClick={() => onWeekChange(mondayOf(calendarToday()))} className="rounded-lg border border-border px-3 py-1.5 text-[11.5px] font-bold text-ink hover:bg-panel-alt">
          이번 주
        </button>
        <button type="button" aria-label="다음 주" onClick={() => onWeekChange(shiftDate(weekStart, 7))} className="grid h-8 w-8 place-items-center rounded-lg border border-border text-ink2 hover:bg-panel-alt">
          <ChevronRight size={16} />
        </button>
        <h2 className="ml-1 text-[14px] font-extrabold text-ink">
          {w ? `${w.month}월 ${w.week}주차` : ''}
          <span className="ml-2 text-[12px] font-semibold text-ink3">{sm}/{sd} ~ {em}/{ed}</span>
        </h2>
      </div>

      {/* 요일 머리 */}
      <div className={`${gridCols} overflow-hidden border-b border-border bg-panel-alt/60`}>
        <div />
        {days.map((d) => {
          const holiday = holidayOf(d.date);
          const red = d.weekday === '일' || Boolean(holiday);
          const tone = red ? 'text-rose-600 dark:text-rose-400' : d.weekday === '토' ? 'text-blue-600 dark:text-blue-400' : 'text-ink';
          const isToday = d.date === today;
          return (
            <div key={d.date} className={`flex min-w-0 items-center justify-center gap-1 border-l border-border px-1 py-1.5 ${tone}`}>
              <span className="text-[11px] font-semibold opacity-75">{d.weekday}</span>
              {isToday ? (
                <span className="grid h-[1.6em] min-w-[1.6em] place-items-center rounded-full bg-sky-600 px-1 text-[12px] font-extrabold tabular-nums text-white">{Number(d.date.slice(8))}</span>
              ) : (
                <span className="text-[13px] font-extrabold tabular-nums">{Number(d.date.slice(8))}</span>
              )}
              {holiday && <span className="min-w-0 truncate text-[10px] font-bold">{holiday}</span>}
            </div>
          );
        })}
      </div>

      {/* 종일·시간 미정 줄 */}
      <div className={`${gridCols} overflow-hidden border-b border-border`}>
        <div className="px-1 py-1 text-right text-[11px] text-ink3">종일</div>
        {days.map((d) => (
          <div
            key={d.date}
            onClick={onCreate ? () => onCreate(d.date, actor) : undefined}
            onDragOver={untimedItem ? (e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              if (untimedDrop !== d.date) setUntimedDrop(d.date);
            } : undefined}
            onDrop={untimedItem ? (e) => {
              e.preventDefault();
              if (untimedItem.date !== d.date) onMoveItem?.(untimedItem, d.date);
              setUntimedItem(null);
              setUntimedDrop(null);
            } : undefined}
            className={`min-h-[1.75rem] min-w-0 space-y-0.5 border-l border-border p-0.5 ${onCreate ? 'cursor-pointer' : ''} ${untimedItem && untimedDrop === d.date ? 'ring-2 ring-inset ring-teal' : ''}`}
          >
            {d.untimed.map((entry) => {
              const { label, badgeClass, dotClass } = chipLook(entry);
              const item = movableItem(entry);
              return (
                <button
                  key={entry.key}
                  type="button"
                  title={label}
                  draggable={Boolean(item)}
                  onDragStart={item ? (e) => {
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', item.title);
                    setUntimedItem(item);
                  } : undefined}
                  onDragEnd={() => {
                    setUntimedItem(null);
                    setUntimedDrop(null);
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenEntry(entry);
                  }}
                  className={`flex w-full items-center gap-1 truncate rounded border px-1.5 py-px text-left text-[11px] font-semibold ${badgeClass} ${untimedItem?.id === item?.id && item ? 'opacity-50' : ''}`}
                >
                  {dotClass && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} aria-hidden />}
                  <span className="truncate">{label}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      </div>

      {/* 시간표 */}
      <div className="overflow-hidden rounded-b-xl">
        <div
          ref={gridRef}
          className={`${gridCols} relative ${drag ? 'select-none' : ''}`}
          style={{ height: `${24 * HOUR_REM}rem` }}
          onPointerMove={moveDrag}
          onPointerUp={finishDrag}
          onPointerCancel={() => setDrag(null)}
        >
          <div className="relative">
            {Array.from({ length: 23 }, (_, i) => i + 1).map((h) => (
              <span key={h} className="absolute right-1.5 -translate-y-1/2 text-[11px] text-ink3" style={{ top: pct(h * 60) }}>
                {String(h).padStart(2, '0')}:00
              </span>
            ))}
          </div>
          {days.map((d) => {
            const isToday = d.date === today;
            return (
              <div
                key={d.date}
                onClick={createAt(d.date)}
                className={`relative border-l border-border ${isToday ? 'bg-sky-50/40 dark:bg-sky-950/15' : ''} ${onCreate ? 'cursor-pointer' : ''}`}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <div key={h} className="pointer-events-none absolute inset-x-0" style={{ top: pct(h * 60) }}>
                    <div className="border-t border-border" />
                    <div className="border-t border-dashed border-border/50" style={{ marginTop: `${HOUR_REM / 2}rem` }} />
                  </div>
                ))}
                {d.laid.map((b) => {
                  const entry = d.entryOf(b.key);
                  const item = movableItem(entry);
                  return (
                    <button
                      key={b.key}
                      type="button"
                      title={b.time ? `${b.label} (${b.time})` : b.label}
                      onPointerDown={item ? (e) => beginDrag(e, b, item, d.date) : undefined}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (suppressClick.current) {
                          suppressClick.current = false;
                          return;
                        }
                        if (entry) onOpenEntry(entry);
                      }}
                      className={`absolute overflow-hidden rounded border px-1 py-px text-left text-[11px] leading-tight shadow-2xs hover:brightness-95 ${TONE_CLASS[b.tone]} ${item ? 'cursor-grab' : ''} ${drag?.moved && drag.block.key === b.key ? 'opacity-40' : ''}`}
                      style={{
                        top: pct(b.start),
                        height: pct(b.end - b.start),
                        left: `calc(${(b.col / b.cols) * 100}% + 1px)`,
                        width: `calc(${100 / b.cols}% - 2px)`,
                      }}
                    >
                      <span className="flex items-center gap-1 font-semibold">
                        {b.dotClass && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${b.dotClass}`} aria-hidden />}
                        <span className="truncate">{b.label}</span>
                      </span>
                      {b.time && <span className="block truncate text-[10px] opacity-75">{b.time}</span>}
                    </button>
                  );
                })}
                {/* 끌고 있는 자리 미리 보기 */}
                {drag?.moved && drag.date === d.date && (
                  <div
                    aria-hidden
                    className={`pointer-events-none absolute inset-x-0.5 z-20 overflow-hidden rounded border-2 border-teal px-1 py-px text-[11px] leading-tight shadow-md ${TONE_CLASS[drag.block.tone]}`}
                    style={{ top: pct(drag.range.start), height: pct(drag.range.end - drag.range.start) }}
                  >
                    <span className="block truncate font-semibold">{drag.block.label}</span>
                    <span className="block truncate text-[10px] opacity-75">
                      {toHHmm(drag.range.start)}~{drag.block.open ? '' : drag.range.end >= DAY_END ? '24:00' : toHHmm(drag.range.end)}
                    </span>
                  </div>
                )}
                {/* 지금 시각 선 */}
                {isToday && (
                  <div aria-hidden className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-rose-500" style={{ top: pct(nowMinute) }}>
                    <span className="absolute -left-1 -top-[5px] h-2 w-2 rounded-full bg-rose-500" />
                  </div>
                )}
              </div>
            );
          })}
          <div ref={startAnchorRef} aria-hidden className="pointer-events-none absolute" />
        </div>
      </div>
    </div>
  );
}
