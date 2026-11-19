import type { User } from '@/domain/user/schema';
import type { DayCell, DayEntry } from '@/domain/workPlan/dayEntries';
import { Modal } from '@/shared/ui/Modal';
import { EntryLine } from './EntryLine';
import { isUnwrittenWeek } from './teamWeekGroups';

/* 한 주 보기 — 그 사람의 월~일을 가운데 창으로. 글자는 최소로: 날짜와 일정 줄만 */

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const dayLabel = (date: string) => `${Number(date.slice(8))}일 ${WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]}`;

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
  const unwritten = isUnwrittenWeek(member.id, cellOf, today, weekDates);
  const range = `${Number(weekDates[0].slice(5, 7))}/${Number(weekDates[0].slice(8))} ~ ${Number(weekDates[6].slice(5, 7))}/${Number(weekDates[6].slice(8))}`;
  return (
    <Modal
      open
      onClose={onClose}
      width={460}
      title={
        <span className="flex items-baseline gap-1.5">
          {/* 미작성은 표처럼 이름을 진한 주황으로 */}
          <span className={unwritten ? 'text-orange-700 dark:text-orange-300' : ''} title={unwritten ? '이번 주 미작성' : undefined}>
            {member.name}
          </span>
          <span className="text-[12px] font-normal text-ink3">
            {member.position || member.jobTitle} · {range}
          </span>
        </span>
      }
    >
      <div className="divide-y divide-[#eef0f3] dark:divide-border">
        {weekDates.map((date) => {
          const entries = cellOf(member.id, date).entries;
          const isToday = date === today;
          return (
            <section key={date} className="flex gap-3 py-1.5">
              <h3 className={`w-10 shrink-0 pt-px text-[11.5px] ${isToday ? 'font-semibold text-sky-700 dark:text-sky-300' : 'text-ink3'}`}>{dayLabel(date)}</h3>
              <div className="min-w-0 flex-1 space-y-0.5">
                {entries.length === 0 ? (
                  <span className="text-[11.5px] text-ink3/60">—</span>
                ) : (
                  entries.map((entry) => <EntryLine key={entry.key} entry={entry} onOpen={onOpenEntry} />)
                )}
              </div>
            </section>
          );
        })}
      </div>
    </Modal>
  );
}
