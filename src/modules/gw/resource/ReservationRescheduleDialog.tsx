import { useState } from 'react';
import { Button } from '@/shared/ui/Button';
import { Modal } from '@/shared/ui/Modal';
import type { Reservation } from '@/domain/reservation/schema';
import type { Resource } from '@/domain/resource/schema';
import { planReschedule, type RescheduleInput } from '@/domain/reservation/engine';
import { combineLocalDateTime, formatResourceDateTime, formatResourceTime, toDateInput } from './resourceDate';

interface ReservationRescheduleDialogProps {
  reservation: Reservation;
  resource: Resource;
  onClose: () => void;
  /** 실패하면 던진다 — 모달이 오류를 보여주고 열려 있는다. 닫기는 성공한 쪽(부모)이 한다. */
  onSubmit: (next: RescheduleInput) => Promise<void>;
}

/**
 * 예약 시간 변경 모달.
 *
 * 승인형 자원은 시간을 바꾸면 재승인을 받는다. 단, 확정 예약을 기존 시간 범위 안으로 줄이면
 * 승인을 유지한다 — 저장 전에 어느 쪽인지 미리 보여준다(판정은 저장 계층이 다시 한다).
 */
export default function ReservationRescheduleDialog({ reservation, resource, onClose, onSubmit }: ReservationRescheduleDialogProps) {
  const [date, setDate] = useState(() => toDateInput(new Date(reservation.startAt)));
  const [start, setStart] = useState(() => formatResourceTime(reservation.startAt));
  const [end, setEnd] = useState(() => formatResourceTime(reservation.endAt));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const next: RescheduleInput | null = date && start && end
    ? { startAt: combineLocalDateTime(date, start), endAt: combineLocalDateTime(date, end) }
    : null;
  const unchanged = !next || (next.startAt === reservation.startAt && next.endAt === reservation.endAt);
  const plan = next && !unchanged ? planReschedule(resource, reservation, next) : null;

  const submit = async () => {
    if (!next) return;
    setError('');
    setBusy(true);
    try {
      await onSubmit(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '예약 변경에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const inputClass = 'h-9 w-full rounded-lg border border-border bg-panel px-3 text-[11px] text-ink outline-none focus:border-teal';
  const labelClass = 'mb-1 block text-[10px] font-bold text-ink3';

  return (
    <Modal
      open
      onClose={onClose}
      title="예약 시간 변경"
      width={460}
      footer={
        <div className="flex w-full items-center justify-end gap-1.5">
          <Button onClick={onClose}>닫기</Button>
          <Button variant="primary" disabled={busy || unchanged} onClick={() => void submit()}>
            {busy ? '처리 중…' : plan?.status === 'PENDING' ? '변경 후 재승인 요청' : '변경'}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        {error && <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2.5 text-[11px] font-semibold text-red-500">{error}</div>}

        <div className="rounded-lg border border-border bg-panel-alt/30 px-3 py-2.5 text-[10.5px] font-semibold text-ink2">
          {reservation.title} · {reservation.resourceNameSnapshot}
          <div className="mt-0.5 font-normal text-ink3">현재 {formatResourceDateTime(reservation.startAt)} ~ {formatResourceTime(reservation.endAt)}</div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <label>
            <span className={labelClass}>날짜</span>
            <input type="date" required value={date} onChange={(event) => setDate(event.target.value)} className={inputClass} />
          </label>
          <label>
            <span className={labelClass}>시작</span>
            <input type="time" required step={resource.slotMinutes * 60} value={start} onChange={(event) => setStart(event.target.value)} className={inputClass} />
          </label>
          <label>
            <span className={labelClass}>종료</span>
            <input type="time" required step={resource.slotMinutes * 60} value={end} onChange={(event) => setEnd(event.target.value)} className={inputClass} />
          </label>
        </div>

        <div className="text-[10px] text-ink3">{resource.slotMinutes}분 단위 · 운영 {resource.availableFrom}~{resource.availableTo} · 최대 {resource.maxDurationMinutes}분</div>

        {plan && resource.approvalMode === 'APPROVAL' && (
          <div className={`rounded-lg px-3 py-2.5 text-[10.5px] font-semibold ${plan.keepsApproval ? 'bg-teal-soft/25 text-teal' : 'bg-amber-soft/30 text-amber'}`}>
            {plan.keepsApproval
              ? '기존 시간 범위 안의 변경이라 승인이 유지됩니다.'
              : '승인형 자원이라 변경 후 담당자 재승인이 필요합니다. 승인 전까지 승인 대기 상태가 됩니다.'}
          </div>
        )}
      </div>
    </Modal>
  );
}
