import { useMemo, useState } from 'react';
import { usePermission } from '@/features/auth/usePermission';
import type { Reservation } from '@/domain/reservation/schema';
import type { Resource } from '@/domain/resource/schema';
import type { User } from '@/domain/user/schema';
import { canApproveResource } from '@/domain/reservation/engine';
import { useApproveReservation, useRejectReservation } from '@/features/resource/useReservations';
import ReservationReasonDialog from './ReservationReasonDialog';
import { formatResourceDateTime } from './resourceDate';
import { Button } from '@/shared/ui/Button';

interface ReservationApprovalsProps {
  actor: User;
  reservations: Reservation[];
  resources: Resource[];
  users: User[];
  onSelectReservation: (reservation: Reservation) => void;
}

export default function ReservationApprovals({ actor, reservations, resources, users, onSelectReservation }: ReservationApprovalsProps) {
  const { isAdmin } = usePermission();
  const [error, setError] = useState('');
  const [rejectTarget, setRejectTarget] = useState<Reservation | null>(null);
  const approveReservation = useApproveReservation();
  const rejectReservation = useRejectReservation();
  const pending = useMemo(() => reservations.filter((row) => {
    if (row.status !== 'PENDING') return false;
    const resource = resources.find((item) => item.id === row.resourceId);
    return Boolean(resource && (isAdmin || canApproveResource(actor, resource)));
  }).sort((a, b) => a.startAt.localeCompare(b.startAt)), [actor, reservations, resources, isAdmin]);

  const approve = async (row: Reservation) => {
    setError('');
    try {
      await approveReservation.mutateAsync({ actor, id: row.id, isAdmin });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '승인 처리에 실패했습니다.');
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-panel p-4 shadow-sm"><div className="text-[10px] font-bold text-ink3">승인 대기</div><div className="mt-1 text-2xl font-extrabold text-amber">{pending.length}</div></div>
        <div className="rounded-xl border border-border bg-panel p-4 shadow-sm"><div className="text-[10px] font-bold text-ink3">담당 자원</div><div className="mt-1 text-2xl font-extrabold text-teal">{resources.filter((item) => isAdmin || canApproveResource(actor, item)).length}</div></div>
        <div className="rounded-xl border border-border bg-panel p-4 shadow-sm"><div className="text-[10px] font-bold text-ink3">권한 범위</div><div className="mt-2 text-[12px] font-bold text-ink">{isAdmin ? '전체 자원' : '내 담당 자원'}</div></div>
      </div>

      {error && <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2.5 text-[11px] font-semibold text-red-500">{error}</div>}

      {pending.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-panel py-16 text-center text-[12px] text-ink3">처리할 승인 요청이 없습니다.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-panel shadow-sm">
          <table className="min-w-[820px] w-full border-collapse text-left text-[11px]">
            <thead><tr className="border-b border-border bg-panel-alt/60 text-[10px] font-bold text-ink3"><th className="px-4 py-3">신청자</th><th className="px-4 py-3">자원·일시</th><th className="px-4 py-3">제목·목적</th><th className="px-4 py-3">수량</th><th className="px-4 py-3 text-right">처리</th></tr></thead>
            <tbody className="divide-y divide-border">
              {pending.map((row) => {
                const requester = users.find((user) => user.id === row.requesterUserId);
                const resource = resources.find((item) => item.id === row.resourceId);
                return (
                  <tr key={row.id} className="hover:bg-panel-alt/30">
                    <td className="px-4 py-3"><div className="font-bold text-ink">{requester?.name ?? row.requesterUserId}</div><div className="mt-0.5 text-[9.5px] text-ink3">{requester?.dept ?? '-'}</div></td>
                    <td className="px-4 py-3"><div className="font-semibold text-ink2">{row.resourceNameSnapshot}</div><div className="mt-0.5 text-[9.5px] text-ink3">{formatResourceDateTime(row.startAt)} ~ {formatResourceDateTime(row.endAt)}</div></td>
                    <td className="max-w-xs px-4 py-3"><div className="truncate font-bold text-ink">{row.title}</div><div className="mt-0.5 truncate text-[9.5px] text-ink3">{row.purpose}</div></td>
                    <td className="px-4 py-3 font-semibold text-ink2">{row.quantity}{resource?.unitCode ?? '개'}</td>
                    <td className="px-4 py-3"><div className="flex justify-end gap-2"><Button onClick={() => onSelectReservation(row)} size="sm">상세</Button><Button disabled={approveReservation.isPending || rejectReservation.isPending} onClick={() => setRejectTarget(row)} variant="danger" size="sm">반려</Button><Button disabled={approveReservation.isPending || rejectReservation.isPending} onClick={() => void approve(row)} variant="primary" size="sm">승인</Button></div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {rejectTarget && (
        <ReservationReasonDialog
          title="예약 반려"
          description={`${rejectTarget.title} · ${rejectTarget.resourceNameSnapshot} · ${formatResourceDateTime(rejectTarget.startAt)} ~ ${formatResourceDateTime(rejectTarget.endAt)}`}
          label="반려 사유"
          confirmLabel="반려"
          onClose={() => setRejectTarget(null)}
          onSubmit={async (reason) => {
            await rejectReservation.mutateAsync({ actor, id: rejectTarget.id, reason, isAdmin });
            setRejectTarget(null);
          }}
        />
      )}
    </div>
  );
}
