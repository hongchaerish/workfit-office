import { useState, useMemo } from 'react';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Clock,
  Plus,
} from 'lucide-react';
import { useAuth } from '@/app/auth/AuthProvider';
import { useCalendarEvents } from '@/features/calendar/useCalendarEvents';
import { useProjects } from '@/features/project/useProjects';
import { CALENDAR_EVENT_TYPE_LABELS, type CalendarEvent } from '@/domain/calendarEvent/schema';
import { isOfficialCalendarEvent } from '@/domain/calendarEvent/engine';
import MobileCommonHeader from './MobileCommonHeader';
import CalendarEventModal from '@/modules/gw/calendar/CalendarEventModal';
import { useAllApprovals } from '@/features/gw/useApprovals';
import { useUsers } from '@/features/user/useUsers';
import { extractApprovedSchedules } from '@/domain/approvalDoc/scheduleEngine';
import { buildCalendarMonth, calendarToday, moveCalendarMonth } from '@/domain/calendarEvent/calendarDate';

const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일'];

export default function MobileCalendarScreen() {
  const { user } = useAuth();
  const me = user?.id || '';

  const todayStr = useMemo(() => calendarToday(), []);
  const [selectedDateStr, setSelectedDateStr] = useState<string>(todayStr);
  const [currentMonth, setCurrentMonth] = useState<string>(() => todayStr.slice(0, 7));

  // 일정 등록 모달 상태
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | undefined>(undefined);

  const actor = useMemo(
    () => ({
      userId: me,
      deptId: user?.dept || null,
      role: 'USER' as const,
      active: user?.status === '사용',
    }),
    [me, user?.dept, user?.status]
  );

  // 1. 캘린더 이벤트 쿼리
  const eventsQuery = useCalendarEvents(actor);
  const baseEvents = eventsQuery.data ?? [];

  // 2. 전자결재 승인 일정 (외근/출장/휴가)
  const usersQuery = useUsers();
  const users = (usersQuery.data ?? []).filter((u) => u.status === '사용' && !u.resignedAt);
  const activeUserIdSet = useMemo(() => new Set(users.map((u) => u.id)), [users]);
  const userMap = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);

  const approvalsQuery = useAllApprovals();
  const allApprovalDocs = approvalsQuery.data ?? [];

  const approvedSchedules = useMemo(() => {
    return extractApprovedSchedules(allApprovalDocs);
  }, [allApprovalDocs]);

  const approvalSyntheticEvents = useMemo<CalendarEvent[]>(() => {
    const list: CalendarEvent[] = [];
    for (const s of approvedSchedules) {
      // 퇴사 처리된 직원의 일정은 필터링
      if (s.drafterId && !activeUserIdSet.has(s.drafterId)) continue;

      let curr = new Date(s.startDate + 'T00:00:00');
      const last = new Date(s.endDate + 'T00:00:00');
      if (Number.isNaN(curr.getTime()) || Number.isNaN(last.getTime())) continue;

      const isLeave = s.category === 'LEAVE';
      const eventType: CalendarEvent['eventType'] = isLeave ? 'VACATION' : 'OUTSIDE';
      const typeLabel = isLeave ? '휴가' : (s.subType || (s.category === 'OUTSIDE' ? '외근' : '출장'));
      const prefix = isLeave ? '[휴가]' : s.category === 'OUTSIDE' ? '[외근]' : '[출장]';
      const drafterUser = userMap.get(s.drafterId);
      const drafter = s.drafterName || drafterUser?.name || '';
      const drafterWithPos = drafterUser?.position ? `${drafter} ${drafterUser.position}` : drafter;

      // 연차 프라이버시: 사유는 비공개, '부재 여부와 시간' 중심 표기 (이름과 직급 표시)
      const title = isLeave ? `[휴가] ${drafterWithPos}` : `${prefix} ${typeLabel}${s.destination ? ` (${s.destination})` : ''} - ${drafter}`;

      while (curr <= last) {
        const yyyy = curr.getFullYear();
        const mm = String(curr.getMonth() + 1).padStart(2, '0');
        const dd = String(curr.getDate()).padStart(2, '0');
        const dStr = `${yyyy}-${mm}-${dd}`;

        const isAllDay = !s.startTime || !s.endTime || s.startTime >= s.endTime;

        list.push({
          id: `approval-${s.docId}-${dStr}`,
          ownerUserId: s.drafterId,
          title,
          date: dStr,
          allDay: isAllDay,
          startTime: isAllDay ? null : s.startTime!,
          endTime: isAllDay ? null : s.endTime!,
          // 휴가 건은 개인 프라이버시 보호를 위해 사유 비공개
          memo: isLeave ? '' : `전자결재 문서: ${s.docNo}\n${s.docTitle}`,
          visibility: 'COMPANY',
          eventType,
          attendeeUserIds: [],
          deptId: null,
          projectId: null,
          reminded: false,
          createdAt: s.startDate,
          updatedAt: s.startDate,
        });

        curr.setDate(curr.getDate() + 1);
      }
    }
    return list;
  }, [approvedSchedules, activeUserIdSet, userMap]);

  const allEvents = useMemo(() => {
    return [...baseEvents, ...approvalSyntheticEvents]
      .filter(isOfficialCalendarEvent)
      .filter((event) => {
        if (event.eventType === 'COMPANY_EVENT' || event.visibility === 'COMPANY') return true;
        return activeUserIdSet.has(event.ownerUserId);
      });
  }, [baseEvents, approvalSyntheticEvents, activeUserIdSet]);

  // 날짜별 이벤트 맵 (캘린더 셀 Dot 표기용)
  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const evt of allEvents) {
      const list = map.get(evt.date) ?? [];
      list.push(evt);
      map.set(evt.date, list);
    }
    return map;
  }, [allEvents]);

  // 42개 월간 달력 셀 생성
  const monthCells = useMemo(() => {
    try {
      return buildCalendarMonth(currentMonth);
    } catch {
      return [];
    }
  }, [currentMonth]);

  // 선택된 날짜의 이벤트 목록 (시간순 정렬)
  const dayEvents = useMemo(() => {
    return allEvents
      .filter((e) => e.date === selectedDateStr)
      .sort((a, b) => {
        if (a.allDay && !b.allDay) return -1;
        if (!a.allDay && b.allDay) return 1;
        return (a.startTime || '00:00').localeCompare(b.startTime || '00:00');
      });
  }, [allEvents, selectedDateStr]);

  const projectsQuery = useProjects({
    userId: me,
    deptId: user?.dept || null,
    active: user?.status === '사용',
  });
  const myProjects = projectsQuery.data ?? [];

  // 월 이동 핸들러
  const handlePrevMonth = () => setCurrentMonth((prev) => moveCalendarMonth(prev, -1));
  const handleNextMonth = () => setCurrentMonth((prev) => moveCalendarMonth(prev, 1));
  const handleToday = () => {
    setSelectedDateStr(todayStr);
    setCurrentMonth(todayStr.slice(0, 7));
  };

  // 선택된 날짜 레이블 (예: 2026년 9월 17일 (목))
  const selectedDateLabel = useMemo(() => {
    if (!selectedDateStr) return '';
    const parts = selectedDateStr.split('-');
    if (parts.length < 3) return selectedDateStr;
    const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    const dayName = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
    return `${parts[0]}년 ${parseInt(parts[1], 10)}월 ${parseInt(parts[2], 10)}일 (${dayName})`;
  }, [selectedDateStr]);

  return (
    <div className="flex h-full flex-col select-none overflow-hidden" style={{ background: '#f2f8fc' }}>
      <MobileCommonHeader
        title="일정관리"
        subtitle={selectedDateLabel}
        rightAction={
          <button
            type="button"
            onClick={() => {
              setSelectedEvent(undefined);
              setIsModalOpen(true);
            }}
            className="flex items-center gap-1 rounded-xl bg-teal px-2.5 py-1 text-[11px] font-bold text-white shadow-xs hover:opacity-90 active:scale-95 transition-all"
          >
            <Plus size={13} />
            <span>추가</span>
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto px-3.5 py-3 space-y-3.5">
        {/* 1. 월간 캘린더 카드 */}
        <div className="rounded-2xl border border-border/80 bg-white p-3 shadow-xs space-y-2">
          {/* 달력 헤더: 월 이동 및 오늘 버튼 */}
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <span className="text-[15px] font-black text-ink">
                {currentMonth.slice(0, 4)}년 {parseInt(currentMonth.slice(5, 7), 10)}월
              </span>
              <button
                type="button"
                onClick={handleToday}
                className="rounded-lg bg-panel-alt px-2 py-0.5 text-[10.5px] font-bold text-teal hover:bg-teal hover:text-white transition-colors"
              >
                오늘
              </button>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handlePrevMonth}
                className="grid h-7 w-7 place-items-center rounded-lg hover:bg-panel-alt text-ink2 transition-colors cursor-pointer"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                type="button"
                onClick={handleNextMonth}
                className="grid h-7 w-7 place-items-center rounded-lg hover:bg-panel-alt text-ink2 transition-colors cursor-pointer"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>

          {/* 요일 헤더 */}
          <div className="grid grid-cols-7 text-center text-[11px] font-bold text-ink3 border-b border-border/40 pb-1.5 pt-0.5">
            {WEEKDAYS.map((day, idx) => (
              <span
                key={day}
                className={idx === 5 ? 'text-blue-500' : idx === 6 ? 'text-rose-500' : 'text-ink3'}
              >
                {day}
              </span>
            ))}
          </div>

          {/* 42개 일자 그리드 */}
          <div className="grid grid-cols-7 gap-y-1">
            {monthCells.map((cell) => {
              const dayNum = parseInt(cell.date.slice(8), 10);
              const isToday = cell.date === todayStr;
              const isSelected = cell.date === selectedDateStr;
              const cellEvents = eventsByDate.get(cell.date) ?? [];

              return (
                <button
                  key={cell.date}
                  type="button"
                  onClick={() => setSelectedDateStr(cell.date)}
                  className={`relative flex flex-col items-center justify-center py-1.5 rounded-xl transition-all ${
                    isSelected
                      ? 'bg-teal text-white font-bold shadow-xs'
                      : isToday
                      ? 'bg-teal-soft/30 font-bold text-teal'
                      : cell.inCurrentMonth
                      ? 'text-ink hover:bg-panel-alt'
                      : 'text-ink3/35'
                  }`}
                >
                  <span className="text-[12.5px] leading-none">{dayNum}</span>

                  {/* 일정 Dot 인디케이터 */}
                  <div className="flex items-center gap-0.5 mt-1 h-1.5">
                    {cellEvents.slice(0, 3).map((e, idx) => {
                      let dotColor = 'bg-teal';
                      if (e.eventType === 'VACATION') dotColor = 'bg-sky-400';
                      else if (e.eventType === 'OUTSIDE') dotColor = 'bg-amber-400';

                      return (
                        <span
                          key={`${e.id}-${idx}`}
                          className={`h-1 w-1 rounded-full ${isSelected ? 'bg-white' : dotColor}`}
                        />
                      );
                    })}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* 2. 선택된 날짜 아젠다 리스트 헤더 */}
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-1.5">
            <CalendarIcon size={14} className="text-teal" />
            <span className="text-[13px] font-bold text-ink">
              {selectedDateLabel}
            </span>
          </div>
          <span className="text-[11px] font-bold text-teal bg-teal/10 px-2 py-0.5 rounded-full">
            {dayEvents.length}건
          </span>
        </div>

        {/* 3. 아젠다 목록 */}
        <div className="space-y-2 pb-6">
          {dayEvents.length === 0 ? (
            <div className="py-12 text-center text-ink3 border border-dashed border-border/80 rounded-2xl bg-white/60">
              <CalendarIcon size={28} className="mx-auto mb-1.5 text-ink3/40" />
              <p className="text-[12px] font-bold text-ink">이 날짜에 등록된 일정이 없습니다.</p>
              <p className="text-[10.5px] text-ink3 mt-0.5">상단의 '+' 버튼을 눌러 새 일정을 등록해보세요.</p>
            </div>
          ) : (
            dayEvents.map((evt) => {
              const meta = CALENDAR_EVENT_TYPE_LABELS[evt.eventType] || {
                label: '일반',
                icon: '📌',
                badgeClass: 'bg-panel-alt text-ink2',
              };

              return (
                <div
                  key={evt.id}
                  onClick={() => {
                    setSelectedEvent(evt);
                    setIsModalOpen(true);
                  }}
                  className="rounded-2xl border border-border/80 bg-white p-3.5 shadow-2xs hover:border-teal/40 transition-all cursor-pointer active:scale-98 space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[14px]">{meta.icon}</span>
                      <span
                        className={`rounded px-1.5 py-0.2 text-[10px] font-bold ${meta.badgeClass}`}
                      >
                        {meta.label}
                      </span>
                      <h4 className="text-[13px] font-bold text-ink truncate max-w-[200px]">
                        {evt.title}
                      </h4>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-ink3 pt-1 border-t border-border/50">
                    <div className="flex items-center gap-1">
                      <Clock size={12} className="text-teal" />
                      <span>{evt.allDay ? '종일' : `${evt.startTime || '—'} ~ ${evt.endTime || '—'}`}</span>
                    </div>

                    {evt.memo && (
                      <span className="truncate max-w-[140px] text-ink3 text-[10.5px]">
                        {evt.memo}
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* 일정 등록/수정 모달 */}
      {isModalOpen && (
        <CalendarEventModal
          actor={actor}
          initialDate={selectedDateStr}
          event={selectedEvent}
          myProjects={myProjects}
          deptName={user?.dept || null}
          onClose={() => setIsModalOpen(false)}
          onSaved={() => {
            setIsModalOpen(false);
            eventsQuery.refetch();
          }}
          onRemoved={() => {
            setIsModalOpen(false);
            eventsQuery.refetch();
          }}
        />
      )}
    </div>
  );
}
