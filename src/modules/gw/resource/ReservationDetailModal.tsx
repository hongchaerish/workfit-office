import type { ReactNode } from 'react';
import type { Reservation } from '@/domain/reservation/schema';
import type { Resource } from '@/domain/resource/schema';
import type { User } from '@/domain/user/schema';
import { Modal } from '@/shared/ui/Modal';
import { Button } from '@/shared/ui/Button';
import { ReservationStatusBadge } from './ResourceBadges';
import { formatResourceFullDateTime } from './resourceDate';

interface ReservationDetailModalProps {
  reservation: Reservation;
  resource?: Resource;
  users: User[];
  showPrivateDetails: boolean;
  onClose: () => void;
  /** 취소 가능한 예약이면 부모가 넘긴다. 없으면 조회 전용. 마감 검증은 저장 계층이 한다. */
  onRequestCancel?: () => void;
  /** 시간 변경 가능한 예약이면 부모가 넘긴다(취소와 같은 권한·마감). */
  onRequestReschedule?: () => void;
  /** 승인 대기 예약의 승인권자에게만 부모가 넘긴다. 승인은 사유 없이 즉시 처리한다. */
  onApprove?: () => void;
  onRequestReject?: () => void;
  /** 승인 처리 중 — 승인·반려 버튼을 함께 잠근다. */
  approving?: boolean;
  /** 승인 실패 안내. 승인은 사유 모달이 없어 여기(모달 본문 상단)에 보여준다. */
  actionError?: string;
}

function DetailItem({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <div className="text-[9.5px] font-bold text-ink3">{label}</div>
      <div className="mt-1 text-[11px] font-semibold leading-relaxed text-ink">{children}</div>
    </div>
  );
}

export default function ReservationDetailModal({ reservation, resource, users, showPrivateDetails, onClose, onRequestCancel, onRequestReschedule, onApprove, onRequestReject, approving = false, actionError = '' }: ReservationDetailModalProps) {
  const requester = users.find((user) => user.id === reservation.requesterUserId);
  const approver = users.find((user) => user.id === reservation.approverUserId);
  const attendeeNames = reservation.attendeeUserIds
    .map((id) => users.find((user) => user.id === id)?.name ?? id)
    .join(', ');
  const showsQuantity = resource?.bookingMode === 'QUANTITY' || reservation.quantity > 1;

  return (
    <Modal
      open
      onClose={onClose}
      title={<span className="inline-flex flex-wrap items-center gap-2"><span>예약 상세</span><ReservationStatusBadge status={reservation.status} /></span>}
      width={Math.min(640, window.innerWidth - 32)}
      footer={(onRequestCancel || onRequestReschedule || onApprove || onRequestReject) && (
        <div className="flex w-full items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            {onRequestCancel && <Button variant="danger" onClick={onRequestCancel}>예약 취소</Button>}
            {onRequestReschedule && <Button onClick={onRequestReschedule}>시간 변경</Button>}
          </div>
          <div className="flex items-center gap-1.5">
            {onRequestReject && <Button variant="danger" disabled={approving} onClick={onRequestReject}>반려</Button>}
            {onApprove && <Button variant="primary" disabled={approving} onClick={onApprove}>{approving ? '처리 중…' : '승인'}</Button>}
          </div>
        </div>
      )}
    >
      <div className="space-y-5">
        {actionError && <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2.5 text-[11px] font-semibold text-red-500">{actionError}</div>}
        <div>
          <div className="text-[15px] font-extrabold leading-snug text-ink">{reservation.title}</div>
          <div className="mt-1 font-mono text-[9.5px] text-ink3">{reservation.id}</div>
        </div>

        <div className="grid gap-x-5 gap-y-4 rounded-xl border border-border bg-panel-alt/30 p-4 sm:grid-cols-2">
          <DetailItem label="자원">
            {reservation.resourceNameSnapshot} <span className="font-mono text-[9.5px] text-ink3">({reservation.resourceCodeSnapshot})</span>
          </DetailItem>
          <DetailItem label="위치">{resource?.location ?? '-'}</DetailItem>
          <DetailItem label="이용 일시" wide>{formatResourceFullDateTime(reservation.startAt)} ~ {formatResourceFullDateTime(reservation.endAt)}</DetailItem>
          <DetailItem label="신청자">{requester?.name ?? reservation.requesterUserId}</DetailItem>
          <DetailItem label="부서">{requester?.dept ?? reservation.requesterDeptId ?? '-'}</DetailItem>
          <DetailItem label="확정 방식">{reservation.approvalModeSnapshot === 'INSTANT' ? '즉시 확정' : '담당자 승인'}</DetailItem>
          {showsQuantity && <DetailItem label="신청 수량">{reservation.quantity}{resource?.unitCode ?? '개'}</DetailItem>}
          {reservation.attendeeCount != null && <DetailItem label="참석 인원">{reservation.attendeeCount}명</DetailItem>}
          {reservation.attendeeUserIds.length > 0 && showPrivateDetails && <DetailItem label="참석자" wide>{attendeeNames}</DetailItem>}
        </div>

        <div>
          <div className="text-[10px] font-bold text-ink3">사용 목적</div>
          {showPrivateDetails ? (
            <div className="mt-2 whitespace-pre-wrap rounded-lg border border-border bg-panel-alt/25 px-3 py-3 text-[11px] leading-relaxed text-ink2">{reservation.purpose}</div>
          ) : (
            <div className="mt-2 rounded-lg border border-border bg-panel-alt/25 px-3 py-3 text-[10.5px] text-ink3">사용 목적은 신청자와 해당 자원 담당자만 확인할 수 있습니다.</div>
          )}
        </div>

        {(reservation.approvedAt || reservation.rejectedAt || reservation.cancelledAt) && (
          <div className="space-y-2 border-t border-border pt-4">
            <div className="text-[10px] font-bold text-ink3">처리 이력</div>
            {reservation.approvedAt && (
              <div className="rounded-lg bg-teal-soft/25 px-3 py-2 text-[10.5px] text-teal">
                승인 · {approver?.name ?? reservation.approverUserId ?? '처리자 없음'} · {formatResourceFullDateTime(reservation.approvedAt)}
              </div>
            )}
            {reservation.rejectedAt && (
              <div className="rounded-lg bg-red-500/8 px-3 py-2 text-[10.5px] leading-relaxed text-red-500">
                반려 · {approver?.name ?? reservation.approverUserId ?? '처리자 없음'} · {formatResourceFullDateTime(reservation.rejectedAt)}
                {showPrivateDetails && reservation.rejectionReason && <div className="mt-1 font-semibold">사유: {reservation.rejectionReason}</div>}
              </div>
            )}
            {reservation.cancelledAt && (
              <div className="rounded-lg bg-ink3/8 px-3 py-2 text-[10.5px] leading-relaxed text-ink2">
                취소 · {formatResourceFullDateTime(reservation.cancelledAt)}
                {showPrivateDetails && reservation.cancelReason && <div className="mt-1 font-semibold">사유: {reservation.cancelReason}</div>}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
