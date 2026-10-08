import { useEffect, useMemo, useState } from 'react';
import { RESERVATION_CLOSED_STATUSES, type Reservation, type ReservationStatus } from '@/domain/reservation/schema';
import type { Resource } from '@/domain/resource/schema';
import type { User } from '@/domain/user/schema';
import { useCancelReservation, useRescheduleReservation } from '@/features/resource/useReservations';
import { ReservationStatusBadge } from './ResourceBadges';
import ReservationReasonDialog from './ReservationReasonDialog';
import ReservationRescheduleDialog from './ReservationRescheduleDialog';
import { formatResourceDateTime } from './resourceDate';
import { Button } from '@/shared/ui/Button';

interface MyReservationsProps {
  actor: User;
  reservations: Reservation[];
  resources: Resource[];
  selectedReservationId?: string | null;
  onSelectReservation: (reservation: Reservation) => void;
}

type Filter = 'UPCOMING' | 'PENDING' | 'HISTORY' | 'ALL';

const filterForReservation = (reservation?: Reservation): Filter => reservation?.status === 'PENDING'
  ? 'PENDING'
  : reservation && RESERVATION_CLOSED_STATUSES.includes(reservation.status) ? 'HISTORY' : 'UPCOMING';

export default function MyReservations({ actor, reservations, resources, selectedReservationId, onSelectReservation }: MyReservationsProps) {
  const selectedReservation = reservations.find((row) => row.id === selectedReservationId && row.requesterUserId === actor.id);
  const [filter, setFilter] = useState<Filter>(() => filterForReservation(selectedReservation));
  const [cancelTarget, setCancelTarget] = useState<Reservation | null>(null);
  const [rescheduleTarget, setRescheduleTarget] = useState<Reservation | null>(null);
  const [notice, setNotice] = useState('');
  const cancelReservation = useCancelReservation();
  const rescheduleReservation = useRescheduleReservation();
  const rescheduleResource = rescheduleTarget ? resources.find((item) => item.id === rescheduleTarget.resourceId) : undefined;
  const mine = useMemo(() => reservations.filter((row) => row.requesterUserId === actor.id), [actor.id, reservations]);

  useEffect(() => {
    if (selectedReservation) setFilter(filterForReservation(selectedReservation));
  }, [selectedReservation]);

  const rows = useMemo(() => mine.filter((row) => {
    if (filter === 'UPCOMING') return row.status === 'CONFIRMED';
    if (filter === 'PENDING') return row.status === 'PENDING';
    if (filter === 'HISTORY') return RESERVATION_CLOSED_STATUSES.includes(row.status);
    return true;
  }).sort((a, b) => b.startAt.localeCompare(a.startAt)), [filter, mine]);

  const counts: Record<Filter, number> = {
    UPCOMING: mine.filter((row) => row.status === 'CONFIRMED').length,
    PENDING: mine.filter((row) => row.status === 'PENDING').length,
    HISTORY: mine.filter((row) => RESERVATION_CLOSED_STATUSES.includes(row.status)).length,
    ALL: mine.length,
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {([
          ['UPCOMING', '예정'], ['PENDING', '승인 대기'], ['HISTORY', '지난 예약'], ['ALL', '전체'],
        ] as Array<[Filter, string]>).map(([value, label]) => (
          <button key={value} type="button" onClick={() => setFilter(value)} className={`rounded-lg border px-3 py-2 text-[10.5px] font-bold ${filter === value ? 'border-teal bg-teal-soft/30 text-teal' : 'border-border bg-panel text-ink3 hover:bg-panel-alt'}`}>
            {label} <span className="ml-1 opacity-70">{counts[value]}</span>
          </button>
        ))}
      </div>

      {notice && <div className="rounded-lg border border-teal/20 bg-teal-soft/25 px-3 py-2.5 text-[11px] font-semibold text-teal">{notice}</div>}

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-panel py-16 text-center text-[12px] text-ink3">해당 예약이 없습니다.</div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-panel shadow-sm">
          <div className="divide-y divide-border">
            {rows.map((row) => {
              const resource = resources.find((item) => item.id === row.resourceId);
              const cancellable = row.status === 'PENDING' || row.status === 'CONFIRMED';
              const reason = row.rejectionReason ?? row.cancelReason;
              return (
                <div key={row.id} className={`flex flex-col gap-3 p-4 hover:bg-panel-alt/25 sm:flex-row sm:items-center ${row.id === selectedReservationId ? 'bg-teal-soft/20 ring-1 ring-inset ring-teal/25' : ''}`}>
                  <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-teal-soft/35 text-xl">{resource?.typeCode === 'VEHICLE' ? '🚙' : resource?.typeCode === 'ROOM' ? '🏢' : resource?.typeCode === 'SUPPLY' ? '💻' : '📽️'}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-[12px] font-bold text-ink">{row.title}</span>
                      <ReservationStatusBadge status={row.status as ReservationStatus} />
                    </div>
                    <div className="mt-1 text-[10.5px] text-ink3">
                      {row.resourceNameSnapshot} · {formatResourceDateTime(row.startAt)} ~ {formatResourceDateTime(row.endAt)}
                      {row.quantity > 1 && ` · ${row.quantity}${resource?.unitCode ?? '개'}`}
                    </div>
                    <div className="mt-1 truncate text-[10px] text-ink2">{row.purpose}</div>
                    {reason && <div className="mt-1.5 rounded-md bg-red-500/8 px-2 py-1 text-[9.5px] text-red-500">사유: {reason}</div>}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-[9px] font-mono text-ink3">{row.id}</span>
                    <Button onClick={() => onSelectReservation(row)} size="sm">상세</Button>
                    {cancellable && resource && (
                      <Button onClick={() => { setNotice(''); setRescheduleTarget(row); }} size="sm">시간 변경</Button>
                    )}
                    {cancellable && (
                      <Button disabled={cancelReservation.isPending} onClick={() => setCancelTarget(row)} variant="danger" size="sm">예약 취소</Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {rescheduleTarget && rescheduleResource && (
        <ReservationRescheduleDialog
          reservation={rescheduleTarget}
          resource={rescheduleResource}
          onClose={() => setRescheduleTarget(null)}
          onSubmit={async (next) => {
            const updated = await rescheduleReservation.mutateAsync({ actor, id: rescheduleTarget.id, next });
            setRescheduleTarget(null);
            setNotice(updated.status === 'PENDING' ? '예약 시간을 변경했습니다. 담당자 재승인을 기다립니다.' : '예약 시간을 변경했습니다.');
          }}
        />
      )}
      {cancelTarget && (
        <ReservationReasonDialog
          title="예약 취소"
          description={`${cancelTarget.title} · ${cancelTarget.resourceNameSnapshot} · ${formatResourceDateTime(cancelTarget.startAt)} ~ ${formatResourceDateTime(cancelTarget.endAt)}`}
          label="취소 사유"
          confirmLabel="예약 취소"
          onClose={() => setCancelTarget(null)}
          onSubmit={async (reason) => {
            await cancelReservation.mutateAsync({ actor, id: cancelTarget.id, reason });
            setCancelTarget(null);
          }}
        />
      )}
    </div>
  );
}
