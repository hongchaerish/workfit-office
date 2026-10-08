import { z } from 'zod';
import { RESOURCE_APPROVAL_MODES } from '@/domain/resource/schema';

/**
 * `COMPLETED`·`EXPIRED` 는 **읽을 때 파생**하는 상태라 저장하지 않는다(Appwrite enum 에도 없다).
 * - COMPLETED: 종료 시각이 지난 확정 예약
 * - EXPIRED: 승인되지 못한 채 시작 시각이 지난 대기 예약
 */
export const RESERVATION_STATUSES = ['PENDING', 'CONFIRMED', 'REJECTED', 'CANCELLED', 'COMPLETED', 'EXPIRED'] as const;

/** 종결 상태 — 더 이상 시간을 점유하지 않고 처리할 것도 없다. 내 예약의 "지난 예약" 묶음. */
export const RESERVATION_CLOSED_STATUSES: readonly ReservationStatus[] = ['REJECTED', 'CANCELLED', 'COMPLETED', 'EXPIRED'];

export const reservationSchema = z.object({
  id: z.string().min(1),
  resourceId: z.string().min(1),
  resourceCodeSnapshot: z.string().min(1),
  resourceNameSnapshot: z.string().min(1),
  requesterUserId: z.string().min(1),
  requesterDeptId: z.string().nullable(),
  title: z.string().trim().min(1).max(100),
  purpose: z.string().trim().min(1).max(500),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  quantity: z.number().int().min(1),
  attendeeCount: z.number().int().min(1).nullable(),
  attendeeUserIds: z.array(z.string()),
  status: z.enum(RESERVATION_STATUSES),
  approvalModeSnapshot: z.enum(RESOURCE_APPROVAL_MODES),
  approverUserId: z.string().nullable(),
  approvedAt: z.string().datetime().nullable(),
  rejectedAt: z.string().datetime().nullable(),
  rejectionReason: z.string().nullable(),
  cancelledAt: z.string().datetime().nullable(),
  cancelReason: z.string().nullable(),
  version: z.number().int().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).superRefine((value, ctx) => {
  if (value.status === 'REJECTED' && (!value.rejectedAt || !value.rejectionReason?.trim())) {
    ctx.addIssue({ code: 'custom', path: ['rejectionReason'], message: '반려 예약에는 반려 일시와 사유가 필요합니다.' });
  }
  if (value.status === 'CANCELLED' && (!value.cancelledAt || !value.cancelReason?.trim())) {
    ctx.addIssue({ code: 'custom', path: ['cancelReason'], message: '취소 예약에는 취소 일시와 사유가 필요합니다.' });
  }
});

export const reservationRequestSchema = z.object({
  resourceId: z.string().min(1, '자원을 선택하세요.'),
  requesterDeptId: z.string().nullable(),
  title: z.string().trim().min(1, '예약 제목을 입력하세요.').max(100),
  purpose: z.string().trim().min(1, '사용 목적을 입력하세요.').max(500),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  quantity: z.number().int().min(1),
  attendeeCount: z.number().int().min(1).nullable(),
  attendeeUserIds: z.array(z.string()).default([]),
});

export type Reservation = z.infer<typeof reservationSchema>;
export type ReservationRequest = z.infer<typeof reservationRequestSchema>;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export const RESERVATION_STATUS_LABELS: Record<ReservationStatus, string> = {
  PENDING: '승인 대기',
  CONFIRMED: '예약 확정',
  REJECTED: '반려',
  CANCELLED: '취소',
  COMPLETED: '이용 완료',
  EXPIRED: '승인 기한 만료',
};
