import { useMemo } from 'react';
import { buildCalendarMonth } from '@/domain/calendarEvent/calendarDate';
import type { CalendarEvent } from '@/domain/calendarEvent/schema';
import type { Holiday } from '@/domain/holiday/schema';

interface MonthCalendarProps {
  month: string;
  today: string;
  selectedDate?: string;
  events: CalendarEvent[];
  /** DB 공휴일 목록. 날짜 셀에 이름과 빨간 숫자로 표시한다. */
  holidays?: Holiday[];
  /** 날짜를 선택했을 때(좌측 패널 연동). */
  onSelectDate: (date: string) => void;
  /** 그 날짜로 새 일정을 등록한다(칸 우상단 +). */
  onAddOn: (date: string) => void;
  onSelectEvent: (event: CalendarEvent) => void;
  /** 칩에 붙일 소유자 이름(팀 일정). null이면 안 붙인다 — 내 일정에 내 이름을 붙일 이유는 없다. */
  ownerNameOf?: (event: CalendarEvent) => string | null;
  /** 흐리게 그릴 칩 — 가림 처리된 남의 비공개 일정. 시간대만 보이고 열리지 않는다. */
  isMutedChip?: (event: CalendarEvent) => boolean;
}

const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일'];

function eventLabel(event: CalendarEvent): string {
  return event.allDay ? event.title : `${event.startTime} ${event.title}`;
}

export default function MonthCalendar({
  month,
  today,
  selectedDate,
  events,
  holidays,
  onSelectDate,
  onAddOn,
  onSelectEvent,
  ownerNameOf,
  isMutedChip,
}: MonthCalendarProps) {
  const cells = useMemo(() => buildCalendarMonth(month), [month]);
  const eventsByDate = useMemo(() => {
    const rows = new Map<string, CalendarEvent[]>();
    events.forEach((event) => rows.set(event.date, [...(rows.get(event.date) ?? []), event]));
    return rows;
  }, [events]);

  /** 날짜 → 공휴일 이름 맵 (빠른 조회) */
  const holidayMap = useMemo(() => {
    const map = new Map<string, string>();
    (holidays ?? []).forEach((h) => map.set(h.date, h.name));
    return map;
  }, [holidays]);

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-panel shadow-sm">
      <div className="min-w-[580px]">
        <div className="grid grid-cols-7 border-b border-border bg-panel-alt/65">
          {WEEKDAYS.map((day, index) => (
            <div key={day} className={`px-1.5 py-2 text-center text-[10px] font-bold ${index === 5 ? 'text-blue' : index === 6 ? 'text-danger' : 'text-ink3'}`}>{day}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((cell, index) => {
            const rows = eventsByDate.get(cell.date) ?? [];
            const isToday = cell.date === today;
            const isSelected = cell.date === selectedDate;
            const holidayName = holidayMap.get(cell.date);
            const isHoliday = Boolean(holidayName);
            return (
              <div
                key={cell.date}
                onClick={() => onSelectDate(cell.date)}
                className={`group relative min-h-[72px] lg:min-h-[78px] cursor-pointer border-b border-r border-border p-1.5 text-left align-top transition-all ${
                  isSelected
                    ? 'ring-2 ring-teal ring-inset bg-teal-soft/20 z-10'
                    : isHoliday
                    ? 'bg-danger/[0.03] hover:bg-danger/[0.07]'
                    : 'hover:bg-panel-alt/50'
                } ${index % 7 === 6 ? 'border-r-0' : ''}`}
              >
                <div className="flex items-start justify-between gap-1">
                  <div className="flex flex-col items-start gap-0.5 min-w-0">
                    <span className={`grid h-5 w-5 place-items-center rounded-full text-[10px] font-bold transition-all ${
                      isToday
                        ? 'bg-teal text-white shadow-2xs'
                        : isSelected
                          ? 'bg-teal/20 text-teal font-extrabold'
                          : isHoliday && cell.inCurrentMonth
                            ? 'text-danger font-extrabold'
                            : cell.inCurrentMonth
                              ? 'text-ink2'
                              : 'text-ink3/45'
                    }`}>
                      {Number(cell.date.slice(-2))}
                    </span>
                    {holidayName && cell.inCurrentMonth && (
                      <span className="block max-w-[56px] truncate text-[8px] font-bold leading-tight text-danger/80" title={holidayName}>
                        {holidayName}
                      </span>
                    )}
                  </div>
                  {/*
                    등록 버튼은 평소 숨긴다 — 42칸 전부에 +가 떠 있으면 달력이 시끄럽다.
                    숨은 동안 `pointer-events-none`으로 터치 오작동까지 막되, 키보드 포커스는
                    막지 않는다(pointer-events는 포인터 입력에만 관여한다). 터치 기기에는
                    hover가 없으므로 칸을 눌러 열리는 목록의 '일정 추가'가 등록 경로가 된다.
                  */}
                  <button
                    type="button"
                    onClick={(clicked) => { clicked.stopPropagation(); onAddOn(cell.date); }}
                    aria-label={`${cell.date}에 일정 등록`}
                    title="일정 등록"
                    className="pointer-events-none grid h-5 w-5 shrink-0 place-items-center rounded text-[12px] font-bold leading-none text-ink3 opacity-0 transition hover:bg-teal-soft/60 hover:text-teal focus:pointer-events-auto focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-teal/40 group-hover:pointer-events-auto group-hover:opacity-100"
                  >
                    +
                  </button>
                </div>
                <span className="mt-0.5 block space-y-0.5">
                  {rows.slice(0, 2).map((event) => {
                    const owner = ownerNameOf?.(event) ?? null;
                    const isAppr = event.id.startsWith('CAL-APPR-');
                    const shouldPrependOwner = owner && !isAppr && !event.title.includes(owner);
                    const label = shouldPrependOwner ? `${owner} · ${eventLabel(event)}` : eventLabel(event);
                    const muted = isMutedChip?.(event) ?? false;

                    const isCompany = event.eventType === 'COMPANY_EVENT';
                    const isVacation = event.eventType === 'VACATION';
                    const isTrip = event.title.includes('[출장]');
                    const isOutside = event.eventType === 'OUTSIDE' && !isTrip;
                    const isMeeting = event.eventType === 'MEETING' || (event.attendeeUserIds && event.attendeeUserIds.length > 0);

                    let chipStyle = 'bg-blue/10 text-blue';
                    if (muted) {
                      chipStyle = 'bg-ink3/10 text-ink3';
                    } else if (isCompany) {
                      chipStyle = 'bg-teal-500/15 text-teal-700 dark:text-teal-400 font-bold border border-teal-500/30';
                    } else if (isVacation) {
                      chipStyle = 'bg-amber-500/15 text-amber-700 dark:text-amber-400 font-semibold border border-amber-500/30';
                    } else if (isTrip) {
                      chipStyle = 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-400 font-semibold border border-indigo-500/30';
                    } else if (isOutside) {
                      chipStyle = 'bg-blue-500/15 text-blue-700 dark:text-blue-400 font-semibold border border-blue-500/30';
                    } else if (isMeeting) {
                      chipStyle = 'bg-purple-500/15 text-purple-700 dark:text-purple-400 font-semibold border border-purple-500/30';
                    } else if (event.allDay) {
                      chipStyle = 'bg-teal-soft/75 text-teal';
                    }

                    return (
                      /* 일정 칩은 상세를 연다. 칸 선택까지 겹쳐 일어나지 않게 전파를 끊는다. */
                      <button
                        type="button"
                        key={event.id}
                        onClick={(clicked) => { clicked.stopPropagation(); onSelectEvent(event); }}
                        title={`${label}${event.attendeeUserIds?.length ? ` (참여자 ${event.attendeeUserIds.length}명)` : ''}`}
                        className={`block w-full truncate rounded px-1.5 py-0.5 text-left text-[9px] leading-tight focus:outline-none focus:ring-1 focus:ring-teal/40 ${chipStyle}`}
                      >
                        {label}
                      </button>
                    );
                  })}
                  {rows.length > 2 && (
                    <span className="block px-0.5 text-[7.5px] font-bold text-ink3">
                      +{rows.length - 2}개
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
