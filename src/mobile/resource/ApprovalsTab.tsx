import type { Reservation } from '@/domain/reservation/schema';
import type { Resource } from '@/domain/resource/schema';
import type { User } from '@/domain/user/schema';
import { formatResourceDateTime } from '@/modules/gw/resource/resourceDate';
import { EmptyBox, dangerOutlineButton, primaryButton } from './shared';

interface ApprovalsTabProps {
  isAdmin: boolean;
  /** 내가 승인할 수 있는 승인 대기 예약 (시작 시각 순, 날짜 무관). */
  pending: Reservation[];
  resources: Resource[];
  users: User[];
  onOpenReservation: (reservation: Reservation) => void;
  onApprove: (reservation: Reservation) => void;
  onReject: (reservation: Reservation) => void;
  /** 승인 처리 중인 예약 id — 처리 중에는 모든 버튼을 잠근다. */
  approvingId: string | null;
}

/** 승인 관리 — 웹 '승인 관리' 탭과 같은 범위(관리자=전체 자원, 그 외=내 담당 자원). */
export default function ApprovalsTab({ isAdmin, pending, resources, users, onOpenReservation, onApprove, onReject, approvingId }: ApprovalsTabProps) {
  const busy = approvingId !== null;
  return (
    <div className="space-y-3">
      <p className="text-[11.5px] text-ink3">{isAdmin ? '전체 자원의 승인 요청입니다.' : '내가 담당하는 자원의 승인 요청입니다.'} 시작 시간이 지난 요청은 처리할 수 없습니다.</p>
      {pending.length === 0 ? (
        <EmptyBox>처리할 승인 요청이 없습니다.</EmptyBox>
      ) : (
        pending.map((r) => {
          const requester = users.find((u) => u.id === r.requesterUserId);
          const resource = resources.find((item) => item.id === r.resourceId);
          return (
            <article key={r.id} className="rounded-2xl border border-border/80 bg-white p-3.5 text-[12px] shadow-2xs">
              <button type="button" aria-label={`${r.title} 예약 상세 보기`} onClick={() => onOpenReservation(r)} className="block w-full text-left">
                <p className="break-words text-[13px] font-bold text-ink">{r.title}</p>
                <p className="mt-1 font-semibold text-ink2">{r.resourceNameSnapshot}{r.quantity > 1 || resource?.bookingMode === 'QUANTITY' ? ` · ${r.quantity}${resource?.unitCode ?? '개'}` : ''}</p>
                <p className="mt-0.5 font-mono text-[11.5px] text-ink2">{formatResourceDateTime(r.startAt)} ~ {formatResourceDateTime(r.endAt)}</p>
                <p className="mt-0.5 text-[11px] text-ink3">신청 {requester?.name ?? r.requesterUserId}{requester?.dept ? ` · ${requester.dept}` : ''}</p>
                <p className="mt-1.5 line-clamp-2 break-words rounded-lg bg-panel-alt/60 px-2.5 py-1.5 text-[11.5px] text-ink2">{r.purpose}</p>
              </button>
              <div className="mt-2.5 flex gap-2">
                <button type="button" aria-label={`${r.title} 예약 반려`} disabled={busy} onClick={() => onReject(r)} className={dangerOutlineButton}>반려</button>
                <button type="button" aria-label={`${r.title} 예약 승인`} disabled={busy} onClick={() => onApprove(r)} className={primaryButton}>
                  {approvingId === r.id ? '승인 중…' : '승인'}
                </button>
              </div>
            </article>
          );
        })
      )}
    </div>
  );
}
