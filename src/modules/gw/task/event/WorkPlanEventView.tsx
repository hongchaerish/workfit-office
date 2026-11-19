import type { ReactNode } from 'react';
import { AlignLeft, Car, Clock, MapPin, Phone, Users } from 'lucide-react';
import type { DayEntry } from '@/domain/workPlan/dayEntries';
import { Modal } from '@/shared/ui/Modal';
import type { EventForm } from './EventFields';
import { eventViewOf, type ViewFactId } from './eventView';

const ICONS: Record<ViewFactId, ReactNode> = {
  when: <Clock size={14} />,
  place: <MapPin size={14} />,
  transport: <Car size={14} />,
  people: <Users size={14} />,
  contact: <Phone size={14} />,
  memo: <AlignLeft size={14} />,
};

/**
 * 일정 보기 — 고칠 수 없는 일정(다른 사람 일정, 결재로 들어온 외근·출장 등)은 잠긴 입력 칸 대신
 * 종류·제목과 한 줄씩의 내용만 보여 준다. 빈 내용은 줄째 뺀다.
 */
export function WorkPlanEventView({
  form,
  entry,
  owner,
  nameOf,
  footer,
  onClose,
}: {
  form: EventForm;
  entry: DayEntry | null;
  owner: { id: string; name: string };
  nameOf: (id: string) => string;
  footer: ReactNode;
  onClose: () => void;
}) {
  const view = eventViewOf(form.state, {
    ownerId: owner.id,
    nameOf,
    tagName: entry?.tag?.name,
    place: entry?.event?.location ?? undefined,
  });

  return (
    <Modal
      open
      onClose={form.saving ? () => {} : onClose}
      width={440}
      title={
        <span className="flex min-w-0 flex-col gap-1">
          <span className="flex items-center gap-1.5 text-[11.5px] font-semibold text-ink3">
            <span className="rounded bg-panel-alt px-1.5 py-0.5 text-ink2">{view.kindLabel}</span>
            {owner.name}
          </span>
          <span className="break-words text-[16px] font-bold text-ink">{view.title || view.kindLabel}</span>
        </span>
      }
      footer={footer}
    >
      <dl className="flex flex-col gap-2.5">
        {view.facts.map((fact) => (
          <div key={fact.id} className="flex items-start gap-2.5">
            <dt className="mt-0.5 shrink-0 text-ink3">{ICONS[fact.id]}</dt>
            <dd className={`min-w-0 text-[13px] text-ink ${fact.id === 'memo' ? 'whitespace-pre-wrap break-words text-ink2' : ''}`}>{fact.text}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}
