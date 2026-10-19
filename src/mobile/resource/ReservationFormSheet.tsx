import { useMemo, useRef, useState } from 'react';
import { resolveDeptId } from '@/domain/department/engine';
import type { Department } from '@/domain/department/schema';
import { RESOURCE_TYPE_LABELS, type Resource } from '@/domain/resource/schema';
import type { Reservation } from '@/domain/reservation/schema';
import type { User } from '@/domain/user/schema';
import { useCreateReservation } from '@/features/resource/useReservations';
import { combineLocalDateTime, defaultReservationWindow } from '@/modules/gw/resource/resourceDate';
import { ErrorBox, Sheet, inputClass, labelClass, primaryButton, secondaryButton } from './shared';

interface ReservationFormSheetProps {
  actor: User;
  resources: Resource[];
  users: User[];
  departments: Department[];
  initialResourceId?: string;
  initialDate?: string;
  onClose: () => void;
  onCreated: (reservation: Reservation) => void;
}

/** 예약 신청 — 웹 ReservationForm과 같은 입력·저장 경로. 충돌·과거 시각 등은 저장 시 다시 검사한다. */
export default function ReservationFormSheet({ actor, resources, users, departments, initialResourceId, initialDate, onClose, onCreated }: ReservationFormSheetProps) {
  // 점검·미사용 자원은 신청 단계에서 거부되므로 선택지에 올리지 않는다.
  const bookable = useMemo(() => resources.filter((r) => r.status === 'ACTIVE'), [resources]);
  const initialResource = bookable.find((r) => r.id === initialResourceId) ?? bookable[0];
  const [initialWindow] = useState(() => defaultReservationWindow(initialDate));
  const [resourceId, setResourceId] = useState(initialResource?.id ?? '');
  const [date, setDate] = useState(initialWindow.date);
  const [start, setStart] = useState(initialWindow.start);
  const [end, setEnd] = useState(initialWindow.end);
  const [title, setTitle] = useState('');
  const [purpose, setPurpose] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [attendeeCount, setAttendeeCount] = useState(1);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  const createReservation = useCreateReservation();
  const busy = createReservation.isPending;
  const resource = bookable.find((r) => r.id === resourceId) ?? null;

  const changeResource = (nextId: string) => {
    setResourceId(nextId);
    setQuantity(1);
    setAttendeeCount(1);
    setError('');
  };

  // 날짜를 바꾸면 그 날의 기본 시간대로 맞춘다(오늘이면 지금 이후, 다른 날이면 09:00).
  const changeDate = (nextDate: string) => {
    setDate(nextDate);
    if (!nextDate) return;
    const window = defaultReservationWindow(nextDate);
    if (window.date === nextDate) {
      setStart(window.start);
      setEnd(window.end);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting.current) return;
    if (!resource) {
      setError('자원을 선택하세요.');
      return;
    }
    if (!date || !start || !end) {
      setError('날짜와 시각을 입력하세요.');
      return;
    }
    if (start >= end) {
      setError('종료 시각은 시작 시각보다 뒤여야 합니다.');
      return;
    }
    if (!title.trim()) {
      setError('예약 제목을 입력하세요.');
      return;
    }
    if (!purpose.trim()) {
      setError('사용 목적을 입력하세요.');
      return;
    }
    submitting.current = true;
    setError('');
    try {
      const row = await createReservation.mutateAsync({
        actor,
        request: {
          resourceId: resource.id,
          requesterDeptId: resolveDeptId(departments, actor.dept),
          title: title.trim(),
          purpose: purpose.trim(),
          // 입력 시각은 KST 벽시계 — combineLocalDateTime이 오프셋을 붙여 ISO로 바꾼다.
          startAt: combineLocalDateTime(date, start),
          endAt: combineLocalDateTime(date, end),
          quantity: resource.bookingMode === 'QUANTITY' ? quantity : 1,
          attendeeCount: resource.typeCode === 'ROOM' ? attendeeCount : null,
          attendeeUserIds: [],
        },
      }) as Reservation;
      onCreated(row);
    } catch (caught) {
      // 충돌·과거 시각 등 도메인 사유를 그대로 보여줘야 사용자가 고칠 수 있다.
      setError(caught instanceof Error ? caught.message : '예약 신청에 실패했습니다.');
    } finally {
      submitting.current = false;
    }
  };

  const formId = 'mobile-reservation-form';
  return (
    <Sheet
      title="자원 예약 신청"
      titleId="mobile-reservation-form-title"
      onClose={onClose}
      closeDisabled={busy}
      footer={resource ? (
        <>
          <button type="button" disabled={busy} onClick={onClose} className={secondaryButton}>취소</button>
          <button type="submit" form={formId} disabled={busy} className={primaryButton}>
            {busy ? '신청 중…' : resource.approvalMode === 'APPROVAL' ? '승인 요청' : '예약 확정'}
          </button>
        </>
      ) : undefined}
    >
      {!resource ? (
        <div className="py-14 text-center text-[12px] text-ink3">예약 가능한 자원이 없습니다.</div>
      ) : (
        <form id={formId} onSubmit={submit} className="space-y-3 p-4">
          {error && <ErrorBox>{error}</ErrorBox>}
          <label className={labelClass}>
            대상 자원
            <select value={resourceId} disabled={busy} onChange={(e) => changeResource(e.target.value)} className={inputClass}>
              {bookable.map((r) => <option key={r.id} value={r.id}>[{RESOURCE_TYPE_LABELS[r.typeCode]}] {r.name}{r.location ? ` · ${r.location}` : ''}</option>)}
            </select>
          </label>
          <p className={`rounded-xl px-3 py-2 text-[11.5px] font-semibold ${resource.approvalMode === 'APPROVAL' ? 'bg-amber-500/10 text-amber-700' : 'bg-teal-soft/20 text-teal'}`}>
            {resource.approvalMode === 'APPROVAL'
              ? `담당자(${users.find((u) => u.id === resource.managerUserId)?.name ?? '미지정'}) 승인 후 확정됩니다.`
              : '신청하면 바로 확정됩니다.'} 다른 예약과 겹치지 않으면 원하는 시간에 예약할 수 있습니다.
          </p>
          <label className={labelClass}>
            사용 날짜
            <input type="date" required value={date} disabled={busy} onChange={(e) => changeDate(e.target.value)} className={inputClass} />
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
          {resource.bookingMode === 'QUANTITY' && (
            <label className={labelClass}>
              신청 수량 (전체 {resource.totalQuantity}{resource.unitCode})
              <input type="number" inputMode="numeric" required min={1} max={resource.totalQuantity} value={quantity} disabled={busy} onChange={(e) => setQuantity(Number(e.target.value) || 1)} className={inputClass} />
            </label>
          )}
          {resource.typeCode === 'ROOM' && (
            <label className={labelClass}>
              참석 인원 (최대 {resource.capacity}명)
              <input type="number" inputMode="numeric" required min={1} max={resource.capacity ?? undefined} value={attendeeCount} disabled={busy} onChange={(e) => setAttendeeCount(Number(e.target.value) || 1)} className={inputClass} />
            </label>
          )}
          <label className={labelClass}>
            예약 제목
            <input type="text" required maxLength={100} value={title} disabled={busy} onChange={(e) => setTitle(e.target.value)} placeholder="예: 주간 기획 회의" className={inputClass} />
          </label>
          <label className={labelClass}>
            사용 목적
            <textarea required maxLength={500} rows={3} value={purpose} disabled={busy} onChange={(e) => setPurpose(e.target.value)} placeholder="사용 목적과 필요한 내용을 입력하세요." className="mt-1 w-full rounded-xl border border-border bg-panel p-3 text-[13px] font-normal text-ink outline-none focus:border-teal disabled:opacity-50" />
          </label>
        </form>
      )}
    </Sheet>
  );
}
