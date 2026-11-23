import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { calendarToday } from '@/domain/calendarEvent/calendarDate';
import type { DayEntry } from '@/domain/workPlan/dayEntries';
import { chipLook, timeRangeOf } from '../components/entryChipLook';
import { entryKindOf } from '../components/entryKind';
import { PERSON_TONES } from '@/shared/theme/statusColors';
import {
  DAY_END,
  durationLabel,
  hourBlockOf,
  layoutColumns,
  moveRange,
  rangeFromDrag,
  resizeEnd,
  toHHmm,
  toMinutes,
  type MinuteRange,
} from '@/domain/workPlan/timeGrid';

export interface TimeGridBlock {
  key: string;
  start: number;
  end: number;
  label: string;
  tone: 'meeting' | 'outside' | 'trip' | 'leave' | 'item' | 'room';
  /** 종료 미정 — 30분 자리로 그리고 아래를 흐리게 */
  open?: boolean;
  /** 종일·시간 미정 — 시간 칸이 아니라 맨 위 종일 줄에 칩으로 */
  allDay?: boolean;
  /** 'HH:mm~HH:mm' — 블록 둘째 줄 */
  time?: string;
  /** 일반 업무 태그 색 점 */
  dotClass?: string;
}

interface TimeGridProps {
  date: string;
  onDateChange: (date: string) => void;
  /** 남의 일정(흐리게), 'room' = 고른 회의실 예약 */
  blocks: TimeGridBlock[];
  value: MinuteRange | null;
  allDay: boolean;
  /** 고른 시간이 종료 미정(업무) */
  openEnd?: boolean;
  /** 맨 위 종일 줄 이름 — 업무는 '미정' */
  allDayLabel?: string;
  onChange: (range: MinuteRange) => void;
  mode: 'desktop' | 'touch';
}

/** 한 시간 높이(rem). 좌표 계산은 비율만 쓰므로 body zoom 과 무관하다 */
const HOUR_REM = 3;
/** 기본으로 보이는 시간 수(08:00~16:00) — 24시간 전체는 스크롤로 (밤을 넘기는 일정이 끊기지 않게) */
const VISIBLE_HOURS = 8;
/** PC 일정 창 — 화면이 낮으면 창(최대 88vh) 안에 들어가도록 시간표를 줄임 (제목·도구 막대·버튼 줄 높이를 뺀 값) */
const DESKTOP_MAX_HEIGHT = 'calc(88vh / var(--font-scale, 1) - 18rem)';
/** 마운트 시 맨 위에 올 시각(분) */
const INITIAL_TOP = 8 * 60;
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
/** 종료 미정 블록 — 아래로 갈수록 흐려져 끝이 열려 있음을 보인다 */
const OPEN_FADE_CLASS = '[mask-image:linear-gradient(to_bottom,black_45%,transparent)] border-b-0';

/** 시간표 블록 색 — 회의·외근·출장·휴가는 사람 상태 색([[statusColors]]) */
export const TONE_CLASS: Record<TimeGridBlock['tone'], string> = {
  meeting: PERSON_TONES.meeting.block,
  outside: PERSON_TONES.outside.block,
  trip: PERSON_TONES.trip.block,
  leave: PERSON_TONES.leave.block,
  item: 'border-border-hi bg-panel text-ink2',
  // 회의실 예약 — 회의 색 점선
  room: `border-dashed bg-transparent ${PERSON_TONES.meeting.text} border-purple-500`,
};

/** 그날 항목 → 시간표 블록(종일·시간 미정은 allDay). 남의 시간표면 ownerName 을 앞에 붙인다 */
export function entriesToBlocks(entries: DayEntry[], ownerName?: string): TimeGridBlock[] {
  const blocks: TimeGridBlock[] = [];
  for (const entry of entries) {
    const allDay = entry.allDay || !entry.startTime;
    const start = allDay ? 0 : toMinutes(entry.startTime!);
    // 종료 미정(업무) — 시작부터 30분 자리
    const open = !allDay && !entry.endTime;
    const end = allDay ? 0 : entry.endTime ? toMinutes(entry.endTime) : Math.min(start + 30, DAY_END);
    if (!allDay && end <= start) continue;
    const { label, dotClass } = chipLook(entry);
    const tone: TimeGridBlock['tone'] = entryKindOf(entry);
    blocks.push({
      key: ownerName ? `${ownerName}:${entry.key}` : entry.key,
      start,
      end,
      label: (ownerName ? `${ownerName} · ` : '') + label,
      tone,
      open,
      allDay,
      time: allDay ? undefined : timeRangeOf(entry),
      dotClass,
    });
  }
  return blocks;
}

/** 'YYYY-MM-DD' 에 일수를 더한다(시간대 이동 없이 UTC 날짜 계산) */
function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function dateLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${m}월 ${d}일 (${weekday})`;
}

type Drag = { kind: 'new' | 'move' | 'resize'; startMinute: number; base: MinuteRange | null };

export function TimeGrid({ date, onDateChange, blocks, value, allDay, openEnd = false, allDayLabel = '종일', onChange, mode }: TimeGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const [, setTick] = useState(0);
  // 지금 시각 — 1분마다 다시 읽어 '지금' 시간대 칸을 옮긴다
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const nowBlock = date === calendarToday(now) ? hourBlockOf(now) : null;

  useLayoutEffect(() => {
    const el = scrollRef.current;
    // 고른 시간이 있으면 그 1시간 전부터, 없고 오늘이면 지금 1시간 전부터, 그 밖엔 08:00부터
    // 시각 글자는 줄 가운데에 걸쳐 있으므로 조금 위에서 시작해야 맨 위 시각 글자가 잘리지 않음
    const anchor = value && !allDay ? value.start : nowBlock ? nowBlock.start : null;
    const top = anchor !== null ? Math.min(Math.max(anchor - 60, 0), DAY_END - VISIBLE_HOURS * 60) : INITIAL_TOP;
    if (el) el.scrollTop = (top / DAY_END) * el.scrollHeight - 12;
  }, []);

  // 왼쪽 칸에서 시각을 바꾸면(끌기 중이 아닐 때) 고른 시간이 보이게 스크롤
  const valueStart = value && !allDay ? value.start : null;
  const valueEnd = value && !allDay ? value.end : null;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || valueStart === null || valueEnd === null || dragRef.current) return;
    const perMinute = el.scrollHeight / DAY_END;
    const top = valueStart * perMinute;
    const bottom = valueEnd * perMinute;
    if (top >= el.scrollTop && bottom <= el.scrollTop + el.clientHeight) return;
    el.scrollTop = Math.max(top - 60 * perMinute - 12, 0); // 맨 위 시각 글자가 잘리지 않게(마운트 때와 같은 여유)
  }, [valueStart, valueEnd]);

  const laid = useMemo(() => layoutColumns(blocks.filter((b) => !b.allDay)), [blocks]);
  const allDayBlocks = blocks.filter((b) => b.allDay);
  const pct = (minutes: number) => `${(minutes / DAY_END) * 100}%`;

  /** 포인터 세로 위치 → 분 (비율 계산: zoom 영향 없음) */
  const minuteAt = (clientY: number): number => {
    const rect = gridRef.current?.getBoundingClientRect();
    if (!rect || rect.height === 0) return 0;
    const ratio = (clientY - rect.top) / rect.height;
    return Math.min(Math.max(ratio * DAY_END, 0), DAY_END - 1);
  };

  const begin = (e: ReactPointerEvent, kind: Drag['kind']) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const minute = minuteAt(e.clientY);
    dragRef.current = { kind, startMinute: minute, base: value };
    if (kind === 'new' && mode === 'desktop') {
      onChange(rangeFromDrag(minute, minute));
    }
  };

  const onMove = (e: ReactPointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const minute = minuteAt(e.clientY);
    if (drag.kind === 'new') {
      if (mode === 'desktop') onChange(rangeFromDrag(drag.startMinute, minute));
    } else if (drag.kind === 'move' && drag.base) {
      onChange(moveRange(drag.base, minute - drag.startMinute));
    } else if (drag.kind === 'resize' && drag.base) {
      onChange(resizeEnd(drag.base, minute));
    }
    setTick((t) => t + 1);
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  const onGridUp = (e: ReactPointerEvent) => {
    const drag = dragRef.current;
    dragRef.current = null;
    // 터치: 스크롤로 취소되지 않고 끝난 탭만 30분 칸으로 받는다
    if (drag && drag.kind === 'new' && mode === 'touch') {
      const minute = minuteAt(e.clientY);
      onChange(rangeFromDrag(minute, minute));
    }
  };

  const hours = Array.from({ length: 24 }, (_, h) => h);

  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-panel">
      <div className="flex items-center justify-between border-b border-border bg-panel-alt px-2 py-1.5">
        <button
          type="button"
          aria-label="전날"
          className="rounded p-1 text-ink2 hover:bg-bg-deep"
          onClick={() => onDateChange(shiftDate(date, -1))}
        >
          <ChevronLeft size={16} />
        </button>
        <span className="text-sm font-semibold text-ink">{dateLabel(date)}</span>
        <button
          type="button"
          aria-label="다음날"
          className="rounded p-1 text-ink2 hover:bg-bg-deep"
          onClick={() => onDateChange(shiftDate(date, 1))}
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {/* 종일·시간 미정 줄 — 그날 종일 일정은 칩으로, 고른 일정이 종일이면 파란 칩 */}
      <div className="flex items-start gap-2 border-b border-border px-2 py-1">
        <span className="w-10 shrink-0 pt-0.5 text-right text-[11px] text-ink3">{allDayLabel}</span>
        <div className="flex min-h-4 min-w-0 flex-1 flex-col gap-0.5">
          {allDayBlocks.map((b) => (
            <div
              key={b.key}
              title={b.label}
              className={`flex items-center gap-1 truncate rounded border px-1.5 py-px text-[11px] font-semibold leading-tight ${TONE_CLASS[b.tone]}`}
            >
              {b.dotClass && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${b.dotClass}`} aria-hidden />}
              <span className="truncate">{b.label}</span>
            </div>
          ))}
          {allDay && <div className="h-4 rounded bg-blue" />}
          {!allDay && allDayBlocks.length === 0 && <div className="h-4 rounded bg-panel-alt" />}
        </div>
      </div>

      <div ref={scrollRef} className="relative overflow-y-auto"
        style={{
          height: mode === 'desktop' ? `min(${VISIBLE_HOURS * HOUR_REM}rem, ${DESKTOP_MAX_HEIGHT})` : `${VISIBLE_HOURS * HOUR_REM}rem`,
          minHeight: '12rem',
        }}>
        <div className="relative flex" style={{ height: `${24 * HOUR_REM}rem` }}>
          <div className="relative w-12 shrink-0">
            {hours.slice(1).map((h) => (
              <span
                key={h}
                className={`absolute right-1.5 -translate-y-1/2 text-[11px] ${nowBlock?.start === h * 60 ? 'font-bold text-teal' : 'text-ink3'}`}
                style={{ top: pct(h * 60) }}
              >
                {String(h).padStart(2, '0')}:00
              </span>
            ))}
          </div>

          <div
            ref={gridRef}
            className="relative flex-1 select-none border-l border-border"
            onPointerDown={(e) => begin(e, 'new')}
            onPointerMove={onMove}
            onPointerUp={onGridUp}
            onPointerCancel={endDrag}
          >
            {/* 지금 시간대(1시간) — 연하게 칠한다(오늘일 때만) */}
            {nowBlock && (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 bg-teal/[0.13]"
                style={{ top: pct(nowBlock.start), height: pct(nowBlock.end - nowBlock.start) }}
              />
            )}

            {hours.map((h) => (
              <div key={h} className="pointer-events-none absolute inset-x-0">
                <div className="absolute inset-x-0 border-t border-border" style={{ top: pct(h * 60) }} />
                <div className="absolute inset-x-0 border-t border-dashed border-border/60" style={{ top: pct(h * 60 + 30) }} />
              </div>
            ))}

            {laid.map((b) => (
              <div
                key={b.key}
                title={b.time ? `${b.label} (${b.time})` : b.label}
                className={`pointer-events-none absolute overflow-hidden rounded border px-1 py-px text-[11px] leading-tight shadow-2xs ${TONE_CLASS[b.tone]} ${b.open ? OPEN_FADE_CLASS : ''}`}
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
              </div>
            ))}

            {value && !allDay && (
              <div
                className={`absolute inset-x-1 z-10 flex flex-col rounded border border-blue bg-blue px-1.5 py-0.5 text-[11px] font-medium text-white shadow-sm ${openEnd ? OPEN_FADE_CLASS : ''}`}
                style={{
                  top: pct(value.start),
                  height: pct(value.end - value.start),
                  cursor: mode === 'desktop' ? 'grab' : undefined,
                }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  if (mode === 'desktop') begin(e, 'move');
                }}
              >
                <span className="truncate">
                  {openEnd
                    ? `${toHHmm(value.start)}~ · 종료 미정`
                    : `${toHHmm(value.start)}~${value.end >= DAY_END ? '24:00' : toHHmm(value.end)} · ${durationLabel(value)}`}
                </span>
                <div
                  className={`absolute inset-x-0 flex cursor-ns-resize items-end justify-center ${mode === 'touch' ? '-bottom-2 h-5' : 'bottom-0 h-3'}`}
                  style={{ touchAction: 'none' }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    begin(e, 'resize');
                  }}
                >
                  <span className="mb-0.5 h-0.5 w-6 rounded bg-white/80" />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
