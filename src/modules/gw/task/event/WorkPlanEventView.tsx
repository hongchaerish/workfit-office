import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AlignLeft, Car, Clock, MapPin, Phone, StickyNote, Users } from 'lucide-react';
import type { DayEntry } from '@/domain/workPlan/dayEntries';
import { Button } from '@/shared/ui/Button';
import { Modal } from '@/shared/ui/Modal';
import { dateLabel, entryTimeLabel, entryViewOf, type ViewFactId } from './eventView';

const ICONS: Record<ViewFactId, ReactNode> = {
  when: <Clock size={13} />,
  place: <MapPin size={13} />,
  transport: <Car size={13} />,
  people: <Users size={13} />,
  contact: <Phone size={13} />,
  memo: <AlignLeft size={13} />,
};

/**
 * 일정 보기 — 그 사람의 그날 특수한 일정을 시간순으로 보여 주고, 누른 일정을 강조해 펼친다.
 * 다른 줄을 누르면 그 일정이 펼쳐진다. 고치는 칸은 없다(다른 사람 일정·결재로 들어온 일정 등).
 * 참석 취소·합류 같은 동작(footer)은 처음 누른 일정에만 붙는다.
 */
export function WorkPlanEventView({
  entry,
  date,
  entries,
  dayMemo,
  owner,
  nameOf,
  footer,
  busy,
  onClose,
}: {
  entry: DayEntry;
  date: string;
  entries: DayEntry[];
  dayMemo: string | null;
  owner: { id: string; name: string };
  nameOf: (id: string) => string;
  footer: ReactNode;
  busy: boolean;
  onClose: () => void;
}) {
  // 특수한 일정(회의·외근·출장·결재·캘린더)만 — 일반 업무는 상세가 필요 없다
  const special = entries.filter((e) => e.source !== 'ITEM');
  const list = special.some((e) => e.key === entry.key) ? special : [entry, ...special];
  const [selected, setSelected] = useState(entry.key);
  const selectedRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' });
  }, []);
  const opts = { ownerId: owner.id, nameOf };

  return (
    <Modal
      open
      onClose={busy ? () => {} : onClose}
      width={460}
      title={
        <span className="flex items-baseline gap-2">
          <span>{owner.name}</span>
          <span className="text-[13px] font-semibold text-ink3">{dateLabel(date)}</span>
        </span>
      }
      footer={selected === entry.key ? footer : <Button onClick={onClose}>닫기</Button>}
    >
      <ul className="flex max-h-[60vh] flex-col gap-0.5 overflow-y-auto" aria-label="그날 일정">
        {list.map((e) => {
          const on = e.key === selected;
          const view = entryViewOf(e, date, opts);
          const time = entryTimeLabel(e);
          // 펼친 내용 — 시각은 줄에 있으니 여러 날일 때만 기간을 다시 보인다
          const facts = view.facts.filter((f) => f.id !== 'when' || f.text.includes(' ~ '));
          return (
            <li
              key={e.key}
              ref={on ? selectedRef : undefined}
              className={`rounded-md border-l-2 ${on ? 'border-blue bg-blue-soft/40' : 'border-transparent'}`}
            >
              <button
                type="button"
                aria-current={on || undefined}
                onClick={() => setSelected(e.key)}
                className={`flex w-full items-baseline gap-2.5 px-2.5 py-1.5 text-left ${on ? '' : 'hover:bg-panel-alt/60'}`}
              >
                <span className="w-[84px] shrink-0 text-[12px] tabular-nums text-ink3">{time}</span>
                <span className="shrink-0 text-[11px] font-semibold text-ink3">{view.kindLabel}</span>
                <span className={`min-w-0 flex-1 truncate text-[13px] ${on ? 'font-bold text-ink' : 'text-ink2'}`}>{view.title || view.kindLabel}</span>
              </button>
              {on && facts.length > 0 && (
                <dl className="flex flex-col gap-1.5 pb-2.5 pl-[106px] pr-2.5">
                  {facts.map((f) => (
                    <div key={f.id} className="flex items-start gap-2">
                      <dt className="mt-0.5 shrink-0 text-ink3">{ICONS[f.id]}</dt>
                      <dd className={`min-w-0 text-[12.5px] ${f.id === 'memo' ? 'whitespace-pre-wrap break-words text-ink2' : 'text-ink'}`}>{f.text}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </li>
          );
        })}
      </ul>
      {dayMemo && (
        <div className="mt-3 flex items-start gap-2 border-t border-border pt-3 text-[12.5px] text-ink2">
          <StickyNote size={13} className="mt-0.5 shrink-0 text-ink3" />
          <p className="min-w-0 whitespace-pre-wrap break-words">{dayMemo}</p>
        </div>
      )}
    </Modal>
  );
}
