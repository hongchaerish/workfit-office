import { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { RESERVATION_CLOSED_STATUSES, type Reservation } from '@/domain/reservation/schema';
import type { Resource } from '@/domain/resource/schema';
import { useReservations } from '@/features/resource/useReservations';
import { formatResourceDateTime } from '@/modules/gw/resource/resourceDate';
import { EmptyBox, ResourceTypeIcon, StatusBadge } from './shared';

type Filter = 'UPCOMING' | 'PENDING' | 'HISTORY';

interface MyReservationsTabProps {
  currentUserId: string;
  resources: Resource[];
  onOpenReservation: (reservation: Reservation) => void;
  onReschedule: (reservation: Reservation) => void;
  onCancel: (reservation: Reservation) => void;
  busy: boolean;
}

const FILTERS: Array<[Filter, string]> = [['UPCOMING', '예정'], ['PENDING', '승인 대기'], ['HISTORY', '지난 예약']];

/** 내 예약 — 웹 '내 예약' 탭과 같은 분류. 정렬은 최근 신청 순. */
export default function MyReservationsTab({ currentUserId, resources, onOpenReservation, onReschedule, onCancel, busy }: MyReservationsTabProps) {
  const [filter, setFilter] = useState<Filter>('UPCOMING');
  const query = useReservations({ requesterUserId: currentUserId });
  const mine = useMemo(() => query.data ?? [], [query.data]);

  // 모든 분류를 최근에 신청한 순으로 — 이용 날짜 순이면 먼 날짜로 신청한 예약이 맨 위에 와 헷갈린다.
  const groups = useMemo(() => {
    const byCreated = [...mine].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return {
      UPCOMING: byCreated.filter((r) => r.status === 'CONFIRMED'),
      PENDING: byCreated.filter((r) => r.status === 'PENDING'),
      HISTORY: byCreated.filter((r) => RESERVATION_CLOSED_STATUSES.includes(r.status)),
    };
  }, [mine]);
  const rows = groups[filter];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-1.5">
        {FILTERS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            className={`rounded-xl border py-2 text-[12px] font-bold ${filter === value ? 'border-teal bg-teal text-white' : 'border-border bg-white text-ink2'}`}
          >
            {label} <span className="opacity-75">{groups[value].length}</span>
          </button>
        ))}
      </div>

      {query.isError && <p role="alert" className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-[12px] text-rose-600">내 예약을 불러오지 못했습니다.</p>}

      {query.isLoading ? (
        <EmptyBox>불러오는 중…</EmptyBox>
      ) : rows.length === 0 ? (
        <EmptyBox>{filter === 'UPCOMING' ? '예정된 예약이 없습니다.' : filter === 'PENDING' ? '승인 대기 중인 예약이 없습니다.' : '지난 예약이 없습니다.'}</EmptyBox>
      ) : (
        rows.map((r) => {
          const resource = resources.find((item) => item.id === r.resourceId);
          const active = r.status === 'PENDING' || r.status === 'CONFIRMED';
          const reason = r.status === 'REJECTED' ? r.rejectionReason : r.status === 'CANCELLED' ? r.cancelReason : null;
          return (
            <article key={r.id} className="rounded-2xl border border-border/80 bg-white shadow-2xs">
              <button type="button" aria-label={`${r.title} 예약 상세 보기`} onClick={() => onOpenReservation(r)} className="flex w-full items-start gap-2.5 p-3.5 text-left">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-panel-alt">
                  {resource ? <ResourceTypeIcon typeCode={resource.typeCode} /> : null}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <StatusBadge status={r.status} />
                    <span className="truncate text-[11px] font-semibold text-ink3">{r.resourceNameSnapshot}</span>
                  </div>
                  <p className="mt-1 break-words text-[13px] font-bold text-ink">{r.title}</p>
                  <p className="mt-0.5 font-mono text-[11.5px] text-ink2">
                    {formatResourceDateTime(r.startAt)} ~ {formatResourceDateTime(r.endAt)}
                    {r.quantity > 1 ? ` · ${r.quantity}${resource?.unitCode ?? '개'}` : ''}
                  </p>
                  <p className="mt-0.5 text-[10.5px] text-ink3">신청 {formatResourceDateTime(r.createdAt)}</p>
                  {reason && (
                    <p className="mt-1.5 break-words rounded-lg bg-rose-500/8 px-2 py-1 text-[11px] text-rose-600">
                      {r.status === 'REJECTED' ? '반려' : '취소'} 사유: {reason}
                    </p>
                  )}
                </div>
                <ChevronRight size={16} className="mt-1 shrink-0 text-ink3" />
              </button>
              {active && (
                <div className="flex gap-2 border-t border-border/60 px-3.5 py-2.5">
                  {resource && (
                    <button type="button" aria-label={`${r.title} 예약 시간 변경`} disabled={busy} onClick={() => onReschedule(r)} className="flex-1 rounded-lg border border-teal/25 py-1.5 text-[11.5px] font-bold text-teal disabled:opacity-50">시간 변경</button>
                  )}
                  <button type="button" aria-label={`${r.title} 예약 취소`} disabled={busy} onClick={() => onCancel(r)} className="flex-1 rounded-lg border border-rose-500/25 py-1.5 text-[11.5px] font-bold text-rose-600 disabled:opacity-50">예약 취소</button>
                </div>
              )}
            </article>
          );
        })
      )}
    </div>
  );
}
