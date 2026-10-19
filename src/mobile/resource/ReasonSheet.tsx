import { useRef, useState } from 'react';
import type { Reservation } from '@/domain/reservation/schema';
import { formatResourceDateTime } from '@/modules/gw/resource/resourceDate';
import { ErrorBox, Sheet, labelClass, secondaryButton, dangerButton } from './shared';

interface ReasonSheetProps {
  /** 'cancel' = 본인 예약 취소, 'reject' = 담당자 반려. 사유는 상대방에게 전달된다. */
  kind: 'cancel' | 'reject';
  reservation: Reservation;
  onClose: () => void;
  /** 실패하면 던진다 — 창이 오류를 보여주고 열려 있는다. 닫기는 성공한 쪽(부모)이 한다. */
  onSubmit: (reason: string) => Promise<void>;
}

const TEXT = {
  cancel: { title: '예약 취소', label: '취소 사유', placeholder: '예약을 취소하는 사유를 입력하세요.', confirm: '예약 취소', busy: '취소 중…' },
  reject: { title: '예약 반려', label: '반려 사유', placeholder: '신청자에게 전달됩니다.', confirm: '반려', busy: '반려 중…' },
} as const;

/** 취소·반려 사유 입력. 저장 계층이 빈 사유를 거부하므로 비어 있으면 확정 버튼을 잠근다. */
export default function ReasonSheet({ kind, reservation, onClose, onSubmit }: ReasonSheetProps) {
  const text = TEXT[kind];
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = reason.trim();
    if (submitting.current || !trimmed) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      await onSubmit(trimmed);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `${text.title}에 실패했습니다. 다시 시도해 주세요.`);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  const formId = `mobile-reservation-${kind}-form`;
  return (
    <Sheet
      raised
      title={text.title}
      titleId={`mobile-reservation-${kind}-title`}
      onClose={onClose}
      closeDisabled={busy}
      footer={(
        <>
          <button type="button" disabled={busy} onClick={onClose} className={secondaryButton}>닫기</button>
          <button type="submit" form={formId} disabled={busy || !reason.trim()} className={dangerButton}>{busy ? text.busy : text.confirm}</button>
        </>
      )}
    >
      <form id={formId} onSubmit={submit} className="space-y-3 p-4">
        <div className="rounded-xl bg-panel-alt p-3 text-[12px] text-ink2">
          <p className="break-words font-bold">{reservation.title} · {reservation.resourceNameSnapshot}</p>
          <p className="mt-1">{formatResourceDateTime(reservation.startAt)} ~ {formatResourceDateTime(reservation.endAt)}</p>
        </div>
        {error && <ErrorBox>{error}</ErrorBox>}
        <label className={labelClass} htmlFor={`mobile-reservation-${kind}-reason`}>{text.label}</label>
        <textarea
          id={`mobile-reservation-${kind}-reason`}
          autoFocus
          rows={3}
          value={reason}
          disabled={busy}
          onChange={(e) => setReason(e.target.value)}
          placeholder={text.placeholder}
          className="w-full rounded-xl border border-border bg-panel p-3 text-[13px] text-ink outline-none focus:border-teal disabled:opacity-50"
        />
      </form>
    </Sheet>
  );
}
