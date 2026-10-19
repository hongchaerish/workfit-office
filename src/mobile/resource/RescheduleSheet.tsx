import { useMemo, useRef, useState } from 'react';
import type { Reservation } from '@/domain/reservation/schema';
import type { Resource } from '@/domain/resource/schema';
import { planReschedule, type RescheduleInput } from '@/domain/reservation/engine';
import { combineLocalDateTime, formatResourceDateTime, formatResourceTime, toDateInput } from '@/modules/gw/resource/resourceDate';
import { ErrorBox, Sheet, inputClass, labelClass, primaryButton, secondaryButton } from './shared';

interface RescheduleSheetProps {
  reservation: Reservation;
  resource: Resource;
  onClose: () => void;
  /** 실패하면 던진다 — 창이 오류를 보여주고 열려 있는다. */
  onSubmit: (next: RescheduleInput) => Promise<void>;
}

/** 본인 예약 시간 변경 — 웹과 같은 저장 경로가 최신 예약 기준으로 충돌·재승인을 다시 판정한다. */
export default function RescheduleSheet({ reservation, resource, onClose, onSubmit }: RescheduleSheetProps) {
  const [date, setDate] = useState(() => toDateInput(new Date(reservation.startAt)));
  const [start, setStart] = useState(() => formatResourceTime(reservation.startAt));
  const [end, setEnd] = useState(() => formatResourceTime(reservation.endAt));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);

  const next = useMemo<RescheduleInput | null>(() => {
    if (!date || !start || !end) return null;
    try {
      return { startAt: combineLocalDateTime(date, start), endAt: combineLocalDateTime(date, end) };
    } catch {
      return null;
    }
  }, [date, start, end]);
  const unchanged = !next || (next.startAt === reservation.startAt && next.endAt === reservation.endAt);
  const plan = next && !unchanged && start < end ? planReschedule(resource, reservation, next) : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting.current) return;
    if (!next) {
      setError('변경할 날짜와 시각을 입력하세요.');
      return;
    }
    if (start >= end) {
      setError('종료 시각은 시작 시각보다 뒤여야 합니다.');
      return;
    }
    if (unchanged) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      await onSubmit(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '예약 변경에 실패했습니다. 다시 시도해 주세요.');
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  const formId = 'mobile-reservation-reschedule-form';
  return (
    <Sheet
      raised
      title="예약 시간 변경"
      titleId="mobile-reservation-reschedule-title"
      onClose={onClose}
      closeDisabled={busy}
      footer={(
        <>
          <button type="button" disabled={busy} onClick={onClose} className={secondaryButton}>닫기</button>
          <button type="submit" form={formId} disabled={busy || unchanged} className={primaryButton}>
            {busy ? '변경 중…' : plan?.status === 'PENDING' ? '변경 후 재승인 요청' : '변경'}
          </button>
        </>
      )}
    >
      <form id={formId} onSubmit={submit} className="space-y-3 p-4">
        <div className="rounded-xl bg-panel-alt p-3 text-[12px] text-ink2">
          <p className="break-words font-bold">{reservation.title} · {reservation.resourceNameSnapshot}</p>
          <p className="mt-1">현재 {formatResourceDateTime(reservation.startAt)} ~ {formatResourceDateTime(reservation.endAt)}</p>
        </div>
        {error && <ErrorBox>{error}</ErrorBox>}
        <label className={labelClass}>
          변경 날짜
          <input type="date" required value={date} disabled={busy} onChange={(e) => setDate(e.target.value)} className={inputClass} />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className={labelClass}>
            시작
            <input type="time" step={60} required value={start} disabled={busy} onChange={(e) => setStart(e.target.value)} className={inputClass} />
          </label>
          <label className={labelClass}>
            종료
            <input type="time" step={60} required value={end} disabled={busy} onChange={(e) => setEnd(e.target.value)} className={inputClass} />
          </label>
        </div>
        {plan && resource.approvalMode === 'APPROVAL' && (
          <p className={`rounded-xl p-3 text-[12px] ${plan.keepsApproval ? 'bg-teal-soft/20 text-teal' : 'bg-amber-500/10 text-amber-700'}`}>
            {plan.keepsApproval ? '기존 시간 범위 안의 변경이라 승인이 유지됩니다.' : '승인형 자원이라 변경 후 담당자 재승인이 필요합니다. 승인 전까지 승인 대기 상태가 됩니다.'}
          </p>
        )}
      </form>
    </Sheet>
  );
}
