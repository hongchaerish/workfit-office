import { useMemo, useState } from 'react';
import { resolveDeptId } from '@/domain/department/engine';
import type { Department } from '@/domain/department/schema';
import type { Resource } from '@/domain/resource/schema';
import { RESOURCE_TYPE_LABELS } from '@/domain/resource/schema';
import type { Reservation } from '@/domain/reservation/schema';
import type { User } from '@/domain/user/schema';
import { useCreateReservation } from '@/features/resource/useReservations';
import { combineLocalDateTime, defaultReservationWindow } from './resourceDate';
import { Button } from '@/shared/ui/Button';

interface ReservationFormProps {
  actor: User;
  resources: Resource[];
  departments: Department[];
  initialResourceId?: string;
  initialDate?: string;
  onSuccess: (reservation: Reservation) => void;
  onCancel?: () => void;
}

export default function ReservationForm({ actor, resources, departments, initialResourceId, initialDate, onSuccess, onCancel }: ReservationFormProps) {
  const availableResources = useMemo(() => resources.filter((resource) => resource.status === 'ACTIVE'), [resources]);
  const initialResource = availableResources.find((resource) => resource.id === initialResourceId) ?? availableResources[0];
  const initialWindow = initialResource ? defaultReservationWindow(initialDate) : { date: '', start: '09:00', end: '10:00' };
  const [resourceId, setResourceId] = useState(initialResource?.id ?? '');
  const [date, setDate] = useState(initialWindow.date);
  const [start, setStart] = useState(initialWindow.start);
  const [end, setEnd] = useState(initialWindow.end);
  const [title, setTitle] = useState('');
  const [purpose, setPurpose] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [attendeeCount, setAttendeeCount] = useState(1);
  const [error, setError] = useState('');
  const createReservation = useCreateReservation();

  const resource = availableResources.find((item) => item.id === resourceId) ?? null;
  const requesterDeptId = resolveDeptId(departments, actor.dept);

  const changeResource = (nextId: string) => {
    setResourceId(nextId);
    const next = availableResources.find((item) => item.id === nextId);
    if (!next) return;
    const window = defaultReservationWindow(date || initialDate);
    setDate(window.date);
    setStart(window.start);
    setEnd(window.end);
    setQuantity(1);
    setAttendeeCount(1);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!resource) return;
    setError('');
    try {
      const row = await createReservation.mutateAsync({
        actor,
        request: {
          resourceId: resource.id,
          requesterDeptId,
          title,
          purpose,
          startAt: combineLocalDateTime(date, start),
          endAt: combineLocalDateTime(date, end),
          quantity: resource.bookingMode === 'TIME_SLOT' ? 1 : quantity,
          attendeeCount: resource.typeCode === 'ROOM' ? attendeeCount : null,
          attendeeUserIds: [],
        },
      }) as Reservation;
      onSuccess(row);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '예약 신청에 실패했습니다.');
    }
  };

  if (!resource) return <div className="rounded-xl border border-dashed border-border py-12 text-center text-[12px] text-ink3">예약 가능한 자원이 없습니다.</div>;

  const inputClass = 'h-9 w-full rounded-lg border border-border bg-panel px-3 text-[11px] text-ink outline-none focus:border-teal';
  const labelClass = 'mb-1.5 block text-[10.5px] font-bold text-ink2';

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="sm:col-span-2">
          <span className={labelClass}>예약 자원</span>
          <select value={resourceId} onChange={(event) => changeResource(event.target.value)} className={inputClass}>
            {availableResources.map((item) => <option key={item.id} value={item.id}>[{RESOURCE_TYPE_LABELS[item.typeCode]}] {item.name} · {item.location}</option>)}
          </select>
        </label>
        <label>
          <span className={labelClass}>사용 날짜</span>
          <input type="date" required value={date} onChange={(event) => setDate(event.target.value)} className={inputClass} />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label>
            <span className={labelClass}>시작</span>
            <input type="time" required step={60} value={start} onChange={(event) => setStart(event.target.value)} className={inputClass} />
          </label>
          <label>
            <span className={labelClass}>종료</span>
            <input type="time" required step={60} value={end} onChange={(event) => setEnd(event.target.value)} className={inputClass} />
          </label>
        </div>
        {resource.bookingMode === 'QUANTITY' && (
          <label>
            <span className={labelClass}>신청 수량 (전체 {resource.totalQuantity}{resource.unitCode})</span>
            <input type="number" required min={1} max={resource.totalQuantity} value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} className={inputClass} />
          </label>
        )}
        {resource.typeCode === 'ROOM' && (
          <label>
            <span className={labelClass}>참석 인원 (최대 {resource.capacity}명)</span>
            <input type="number" required min={1} max={resource.capacity ?? undefined} value={attendeeCount} onChange={(event) => setAttendeeCount(Number(event.target.value))} className={inputClass} />
          </label>
        )}
        <label className="sm:col-span-2">
          <span className={labelClass}>예약 제목</span>
          <input required maxLength={100} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="예: 주간 프로젝트 회의" className={inputClass} />
        </label>
        <label className="sm:col-span-2">
          <span className={labelClass}>사용 목적</span>
          <textarea required maxLength={500} rows={3} value={purpose} onChange={(event) => setPurpose(event.target.value)} placeholder="사용 목적과 필요한 내용을 입력하세요." className="w-full resize-none rounded-lg border border-border bg-panel px-3 py-2.5 text-[11px] text-ink outline-none focus:border-teal" />
        </label>
      </div>

      <div className="rounded-lg border border-teal/20 bg-teal-soft/25 p-3 text-[10.5px] leading-relaxed text-ink2">
        <strong className="text-teal">{resource.approvalMode === 'INSTANT' ? '즉시 확정' : '담당자 승인 필요'}</strong>
        <span className="mx-1.5 text-border-hi">·</span>다른 예약과 겹치지 않으면 원하는 시간에 예약할 수 있습니다
      </div>

      {error && <div className="rounded-lg border border-red-500/20 bg-red-500/8 px-3 py-2.5 text-[11px] font-semibold text-red-500">{error}</div>}

      <div className="flex justify-end gap-2 border-t border-border pt-4">
        {onCancel && <Button onClick={onCancel}>취소</Button>}
        <Button type="submit" disabled={createReservation.isPending} variant="primary">
          {createReservation.isPending ? '확인 중…' : resource.approvalMode === 'INSTANT' ? '예약 확정' : '승인 요청'}
        </Button>
      </div>
    </form>
  );
}
