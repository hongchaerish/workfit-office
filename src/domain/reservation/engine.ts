import type { User } from '@/domain/user/schema';
import type { Resource } from '@/domain/resource/schema';
import type { Reservation, ReservationRequest, ReservationStatus } from './schema';
import { reservationRequestSchema } from './schema';
import { resourceDateKey, resourceMinuteOfDay } from './time';

export type ReservationErrorCode =
  | 'INVALID_INPUT'
  | 'RESOURCE_UNAVAILABLE'
  | 'PAST_TIME'
  | 'ADVANCE_LIMIT'
  | 'CROSS_DAY'
  | 'SLOT_MISMATCH'
  | 'OUTSIDE_HOURS'
  | 'DURATION'
  | 'CAPACITY'
  | 'QUANTITY'
  | 'CONFLICT'
  | 'FORBIDDEN'
  | 'INVALID_STATUS'
  | 'CANCEL_DEADLINE';

export class ReservationError extends Error {
  constructor(public readonly code: ReservationErrorCode, message: string) {
    super(message);
    this.name = 'ReservationError';
  }
}

const OCCUPYING_STATUSES: ReservationStatus[] = ['PENDING', 'CONFIRMED'];

const parseTime = (value: string) => {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
};

const occupiedInterval = (startAt: string, endAt: string, resource: Resource) => ({
  start: new Date(startAt).getTime() - resource.bufferBeforeMinutes * 60_000,
  end: new Date(endAt).getTime() + resource.bufferAfterMinutes * 60_000,
});

const intervalsOverlap = (left: { start: number; end: number }, right: { start: number; end: number }) =>
  left.start < right.end && right.start < left.end;

export function validateReservationRequest(
  resource: Resource,
  raw: ReservationRequest,
  existing: Reservation[],
  now = new Date(),
): ReservationRequest {
  const parsed = reservationRequestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ReservationError('INVALID_INPUT', parsed.error.issues[0]?.message ?? '예약 정보를 확인하세요.');
  }
  const input = parsed.data;
  if (resource.status !== 'ACTIVE') {
    throw new ReservationError('RESOURCE_UNAVAILABLE', '현재 예약할 수 없는 자원입니다.');
  }

  const start = new Date(input.startAt);
  const end = new Date(input.endAt);
  if (start.getTime() >= end.getTime()) {
    throw new ReservationError('INVALID_INPUT', '종료시간은 시작시간보다 늦어야 합니다.');
  }
  if (start.getTime() <= now.getTime()) {
    throw new ReservationError('PAST_TIME', '과거 시간은 예약할 수 없습니다.');
  }
  const lastBookableDate = new Date(now);
  lastBookableDate.setUTCDate(lastBookableDate.getUTCDate() + resource.maxAdvanceDays);
  if (resourceDateKey(start) > resourceDateKey(lastBookableDate)) {
    throw new ReservationError('ADVANCE_LIMIT', `최대 ${resource.maxAdvanceDays}일 전까지만 예약할 수 있습니다.`);
  }
  if (resourceDateKey(start) !== resourceDateKey(end)) {
    throw new ReservationError('CROSS_DAY', '1차 버전에서는 날짜를 넘기는 예약을 지원하지 않습니다.');
  }

  const startMinute = resourceMinuteOfDay(start);
  const endMinute = resourceMinuteOfDay(end);
  const openMinute = parseTime(resource.availableFrom);
  if (start.getUTCSeconds() !== 0 || start.getUTCMilliseconds() !== 0 || end.getUTCSeconds() !== 0 || end.getUTCMilliseconds() !== 0) {
    throw new ReservationError('SLOT_MISMATCH', '예약 시간은 분 단위로 선택하세요.');
  }
  if ((startMinute - openMinute) % resource.slotMinutes !== 0 || (endMinute - openMinute) % resource.slotMinutes !== 0) {
    throw new ReservationError('SLOT_MISMATCH', `${resource.slotMinutes}분 단위로 시간을 선택하세요.`);
  }
  if (startMinute < openMinute || endMinute > parseTime(resource.availableTo)) {
    throw new ReservationError('OUTSIDE_HOURS', `운영시간 ${resource.availableFrom}~${resource.availableTo} 안에서 예약하세요.`);
  }

  const durationMinutes = (end.getTime() - start.getTime()) / 60_000;
  if (durationMinutes < resource.minDurationMinutes || durationMinutes > resource.maxDurationMinutes) {
    throw new ReservationError(
      'DURATION',
      `이용시간은 ${resource.minDurationMinutes}~${resource.maxDurationMinutes}분이어야 합니다.`,
    );
  }

  if (resource.bookingMode === 'TIME_SLOT' && input.quantity !== 1) {
    throw new ReservationError('QUANTITY', '시간형 자원의 예약 수량은 1입니다.');
  }
  if (resource.bookingMode === 'QUANTITY' && input.quantity > resource.totalQuantity) {
    throw new ReservationError('QUANTITY', `최대 ${resource.totalQuantity}${resource.unitCode}까지 신청할 수 있습니다.`);
  }
  if (resource.typeCode === 'ROOM' && input.attendeeCount == null) {
    throw new ReservationError('CAPACITY', '회의실 참석 인원을 입력하세요.');
  }
  if (resource.typeCode === 'ROOM' && resource.capacity && input.attendeeCount && input.attendeeCount > resource.capacity) {
    throw new ReservationError('CAPACITY', `수용 인원 ${resource.capacity}명을 초과했습니다.`);
  }

  assertNoConflict(resource, input, existing);
  return input;
}

/**
 * 같은 자원의 점유 예약(PENDING·CONFIRMED)과 시간·수량이 겹치는지 검사한다.
 *
 * 신청 검증(`validateReservationRequest`)과 승인이 함께 쓴다. 승인은 신청 시점에 이미
 * 통과한 슬롯·이용시간·사전예약 한도 같은 **신청 규칙을 다시 돌리지 않는다** — 그 사이
 * 관리자가 자원 설정을 바꾸면 이미 들어온 대기 예약이 영영 확정되지 못하기 때문이다.
 */
export function assertNoConflict(
  resource: Resource,
  input: Pick<ReservationRequest, 'startAt' | 'endAt' | 'quantity'>,
  existing: Reservation[],
): void {
  const requestedInterval = occupiedInterval(input.startAt, input.endAt, resource);
  const occupied = existing.filter(
    (row) => row.resourceId === resource.id && OCCUPYING_STATUSES.includes(row.status),
  );
  const overlapping = occupied
    .map((row) => ({ row, interval: occupiedInterval(row.startAt, row.endAt, resource) }))
    .filter(({ interval }) => intervalsOverlap(requestedInterval, interval));

  if (resource.bookingMode === 'TIME_SLOT' && overlapping.length > 0) {
    throw new ReservationError('CONFLICT', '선택한 시간에 이미 예약이 있습니다.');
  }
  if (resource.bookingMode === 'QUANTITY') {
    const checkpoints = [
      requestedInterval.start,
      ...overlapping.map(({ interval }) => interval.start).filter((time) => time >= requestedInterval.start && time < requestedInterval.end),
    ];
    const maxReserved = checkpoints.reduce((max, time) => {
      const reserved = overlapping.reduce((sum, item) =>
        item.interval.start <= time && time < item.interval.end ? sum + item.row.quantity : sum, 0);
      return Math.max(max, reserved);
    }, 0);
    if (maxReserved + input.quantity > resource.totalQuantity) {
      throw new ReservationError('CONFLICT', `선택한 시간의 최소 잔여 수량은 ${Math.max(0, resource.totalQuantity - maxReserved)}${resource.unitCode}입니다.`);
    }
  }
}

const ALLOWED_TRANSITIONS: Record<ReservationStatus, ReservationStatus[]> = {
  PENDING: ['CONFIRMED', 'REJECTED', 'CANCELLED'],
  CONFIRMED: ['CANCELLED', 'COMPLETED'],
  REJECTED: [],
  CANCELLED: [],
  COMPLETED: [],
};

export function assertReservationTransition(from: ReservationStatus, to: ReservationStatus): void {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new ReservationError('INVALID_STATUS', `${from} 상태에서는 ${to}(으)로 변경할 수 없습니다.`);
  }
}

export function canManageResources(actor: User, isAdmin = true): boolean {
  return actor.status === '사용' && isAdmin;
}

export function canApproveResource(actor: User, resource: Resource, isAdmin = false): boolean {
  return (
    actor.status === '사용' &&
    (isAdmin || resource.managerUserId === actor.id)
  );
}

export function canCancelReservation(actor: User, row: Reservation, isAdmin = false): boolean {
  return (
    actor.status === '사용' &&
    (isAdmin || row.requesterUserId === actor.id)
  );
}

export function assertCancellationAllowed(actor: User, resource: Resource, row: Reservation, now = new Date(), isAdmin = false): void {
  if (!canCancelReservation(actor, row, isAdmin)) {
    throw new ReservationError('FORBIDDEN', '본인 예약만 취소할 수 있습니다.');
  }
  if (row.status !== 'PENDING' && row.status !== 'CONFIRMED') {
    throw new ReservationError('INVALID_STATUS', '현재 상태에서는 예약을 취소할 수 없습니다.');
  }
  if (!isAdmin && new Date(row.startAt).getTime() - now.getTime() < resource.cancelDeadlineMinutes * 60_000) {
    throw new ReservationError('CANCEL_DEADLINE', `예약 시작 ${resource.cancelDeadlineMinutes}분 전까지만 취소할 수 있습니다.`);
  }
}

export function deriveCompleted(row: Reservation, now = new Date()): Reservation {
  if (row.status !== 'CONFIRMED' || new Date(row.endAt).getTime() > now.getTime()) return row;
  assertReservationTransition(row.status, 'COMPLETED');
  return { ...row, status: 'COMPLETED', version: row.version + 1, updatedAt: now.toISOString() };
}
