import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { User } from '@/domain/user/schema';
import type { DayCell, DayEntry } from '@/domain/workPlan/dayEntries';
import { EntryLine } from './EntryLine';
import { isUnwrittenWeek } from './teamWeekGroups';

/* 이름을 누르면 오른쪽에 그 사람의 한 주(월~일) */

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const dayLabel = (date: string) => `${Number(date.slice(5, 7))}월 ${Number(date.slice(8))}일 (${WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]})`;

export function WorkPlanPersonWeekDrawer({
  member,
  weekDates,
  today,
  cellOf,
  onClose,
  onOpenEntry,
}: {
  member: User;
  weekDates: string[];
  today: string;
  cellOf: (userId: string, date: string) => DayCell;
  onClose: () => void;
  onOpenEntry: (entry: DayEntry) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const unwritten = isUnwrittenWeek(member.id, cellOf, today, weekDates);

  return createPortal(
    <div className="fixed inset-0 z-[56]" onMouseDown={onClose}>
      <aside
        role="dialog"
        aria-label={`${member.name} 한 주 일정`}
        onMouseDown={(e) => e.stopPropagation()}
        className="absolute inset-y-0 right-0 flex w-[360px] max-w-full flex-col border-l border-border bg-panel shadow-2xl"
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-bold text-ink">
              {member.name} <span className="text-[12px] font-normal text-ink3">{member.position || member.jobTitle}</span>
            </div>
            <div className="text-[11.5px] text-ink3">
              {member.dept} · {dayLabel(weekDates[0])} ~ {dayLabel(weekDates[6])}
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="닫기" className="rounded p-1 text-ink3 hover:bg-panel-alt hover:text-ink">
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {unwritten && <p className="rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">이번 주 계획을 아직 적지 않았습니다.</p>}
          {weekDates.map((date) => {
            const entries = cellOf(member.id, date).entries;
            return (
              <section key={date}>
                <h3 className={`mb-1 text-[12px] font-semibold ${date === today ? 'text-sky-700 dark:text-sky-300' : 'text-ink2'}`}>
                  {dayLabel(date)}
                  {date === today ? ' · 오늘' : ''}
                </h3>
                {entries.length === 0 ? (
                  <p className="pl-2 text-[11.5px] text-ink3">일정 없음</p>
                ) : (
                  <div className="space-y-0.5">
                    {entries.map((entry) => (
                      <EntryLine key={entry.key} entry={entry} onOpen={onOpenEntry} />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </aside>
    </div>,
    document.body,
  );
}
