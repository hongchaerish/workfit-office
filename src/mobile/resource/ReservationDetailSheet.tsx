import type { ReactNode } from 'react';
import type { Reservation } from '@/domain/reservation/schema';
import type { Resource } from '@/domain/resource/schema';
import type { User } from '@/domain/user/schema';
import { formatResourceFullDateTime } from '@/modules/gw/resource/resourceDate';
import { ErrorBox, Sheet, StatusBadge, dangerOutlineButton, primaryButton, secondaryButton } from './shared';

interface ReservationDetailSheetProps {
  reservation: Reservation;
  resource?: Resource;
  users: User[];
  /** 사용 목적·참석자·사유는 신청자와 자원 담당자(관리자 포함)에게만 보인다 — 웹 상세와 같은 기준. */
  showPrivateDetails: boolean;
  onClose: () => void;
  /** 넘기지 않으면 해당 버튼을 숨긴다. 권한·마감 검사는 저장 계층이 다시 한다. */
  onCancel?: () => void;
  onReschedule?: () => void;
  onApprove?: () => void;
  onReject?: () => void;
  approving?: boolean;
  actionError?: string;
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 py-2">
      <dt className="w-16 shrink-0 text-[11.5px] font-bold text-ink3">{label}</dt>
      <dd className="min-w-0 flex-1 break-words text-[12.5px] font-semibold text-ink">{children}</dd>
    </div>
  );
}

export default function ReservationDetailSheet({
  reservation, resource, users, showPrivateDetails, onClose, onCancel, onReschedule, onApprove, onReject, approving = false, actionError = '',
}: ReservationDetailSheetProps) {
  const requester = users.find((u) => u.id === reservation.requesterUserId);
  const approver = users.find((u) => u.id === reservation.approverUserId);
  const attendeeNames = reservation.attendeeUserIds.map((id) => users.find((u) => u.id === id)?.name ?? id).join(', ');
  const showsQuantity = resource?.bookingMode === 'QUANTITY' || reservation.quantity > 1;
  const hasOwnerActions = Boolean(onCancel || onReschedule);
  const hasApproverActions = Boolean(onApprove || onReject);

  return (
    <Sheet
      title={<span className="flex items-center gap-2">예약 상세 <StatusBadge status={reservation.status} /></span>}
      titleId="mobile-reservation-detail-title"
      onClose={onClose}
      closeDisabled={approving}
      footer={hasApproverActions ? (
        <>
          {onReject && <button type="button" disabled={approving} onClick={onReject} className={dangerOutlineButton}>반려</button>}
          {onApprove && <button type="button" disabled={approving} onClick={onApprove} className={primaryButton}>{approving ? '승인 중…' : '승인'}</button>}
        </>
      ) : hasOwnerActions ? (
        <>
          {onReschedule && <button type="button" onClick={onReschedule} className={secondaryButton}>시간 변경</button>}
          {onCancel && <button type="button" onClick={onCancel} className={dangerOutlineButton}>예약 취소</button>}
        </>
      ) : undefined}
    >
      <div className="space-y-4 p-4">
        {actionError && <ErrorBox>{actionError}</ErrorBox>}
        <p className="break-words text-[15px] font-extrabold leading-snug text-ink">{reservation.title}</p>

        <dl className="divide-y divide-border/60 rounded-xl border border-border bg-panel-alt/30 px-3">
          <Item label="자원">{reservation.resourceNameSnapshot}</Item>
          <Item label="위치">{resource?.location || '-'}</Item>
          <Item label="일시">
            {formatResourceFullDateTime(reservation.startAt)}<br />~ {formatResourceFullDateTime(reservation.endAt)}
          </Item>
          <Item label="신청자">{requester?.name ?? reservation.requesterUserId}{requester?.dept ? ` · ${requester.dept}` : ''}</Item>
          <Item label="확정 방식">{reservation.approvalModeSnapshot === 'INSTANT' ? '즉시 확정' : '담당자 승인'}</Item>
          <Item label="자원 담당">{resource?.managerUserId ? users.find((u) => u.id === resource.managerUserId)?.name ?? resource.managerUserId : '미지정'}</Item>
          {showsQuantity && <Item label="수량">{reservation.quantity}{resource?.unitCode ?? '개'}</Item>}
          {reservation.attendeeCount != null && <Item label="참석 인원">{reservation.attendeeCount}명</Item>}
          {showPrivateDetails && reservation.attendeeUserIds.length > 0 && <Item label="참석자">{attendeeNames}</Item>}
        </dl>

        <div>
          <p className="text-[11.5px] font-bold text-ink3">사용 목적</p>
          {showPrivateDetails ? (
            <p className="mt-1.5 whitespace-pre-wrap break-words rounded-xl border border-border bg-panel-alt/25 p-3 text-[12.5px] leading-relaxed text-ink2">{reservation.purpose}</p>
          ) : (
            <p className="mt-1.5 rounded-xl border border-border bg-panel-alt/25 p-3 text-[11.5px] text-ink3">사용 목적은 신청자와 해당 자원 담당자만 확인할 수 있습니다.</p>
          )}
        </div>

        {(reservation.approvedAt || reservation.rejectedAt || reservation.cancelledAt) && (
          <div className="space-y-2">
            <p className="text-[11.5px] font-bold text-ink3">처리 이력</p>
            {reservation.approvedAt && (
              <p className="rounded-xl bg-teal-soft/25 px-3 py-2 text-[12px] text-teal">
                승인 · {approver?.name ?? reservation.approverUserId ?? '처리자 없음'} · {formatResourceFullDateTime(reservation.approvedAt)}
              </p>
            )}
            {reservation.rejectedAt && (
              <div className="rounded-xl bg-rose-500/8 px-3 py-2 text-[12px] leading-relaxed text-rose-600">
                반려 · {approver?.name ?? reservation.approverUserId ?? '처리자 없음'} · {formatResourceFullDateTime(reservation.rejectedAt)}
                {showPrivateDetails && reservation.rejectionReason && <p className="mt-1 break-words font-semibold">사유: {reservation.rejectionReason}</p>}
              </div>
            )}
            {reservation.cancelledAt && (
              <div className="rounded-xl bg-ink3/8 px-3 py-2 text-[12px] leading-relaxed text-ink2">
                취소 · {formatResourceFullDateTime(reservation.cancelledAt)}
                {showPrivateDetails && reservation.cancelReason && <p className="mt-1 break-words font-semibold">사유: {reservation.cancelReason}</p>}
              </div>
            )}
          </div>
        )}
      </div>
    </Sheet>
  );
}
