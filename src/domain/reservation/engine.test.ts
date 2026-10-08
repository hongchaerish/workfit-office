import assert from 'node:assert/strict';
import test from 'node:test';
import { USER_SEED } from '@/data/seeds/user.seed';
import { RESOURCE_SEED } from '@/data/seeds/resource.seed';
import { reservationSchema, type Reservation } from './schema';
import { assertCancellationAllowed, deriveLifecycle, planReschedule, ReservationError } from './engine';
import { userSchema, type User } from '@/domain/user/schema';

function actor(id: string): User {
  const row = USER_SEED.find((user) => user.id === id);
  if (!row) throw new Error(`테스트 사용자를 찾을 수 없습니다: ${id}`);
  return userSchema.parse(row);
}

const vehicle = (() => {
  const found = RESOURCE_SEED.find((resource) => resource.id === 'RES-0003');
  if (!found) throw new Error('법인차량 테스트 자원을 찾을 수 없습니다.');
  return found;
})();

const now = new Date('2026-08-12T00:00:00.000Z');
const requester = actor('U010');
const otherUser = actor('U012');
const resourceManager = actor('U009');
const admin = actor('U011');

function reservation(startAt: string): Reservation {
  return reservationSchema.parse({
    id: 'RSV-20260812-9001',
    resourceId: vehicle.id,
    resourceCodeSnapshot: vehicle.code,
    resourceNameSnapshot: vehicle.name,
    requesterUserId: requester.id,
    requesterDeptId: 'D230',
    title: '취소 정책 테스트',
    purpose: '취소 마감과 권한 검증',
    startAt,
    endAt: '2026-08-12T03:00:00.000Z',
    quantity: 1,
    attendeeCount: null,
    attendeeUserIds: [],
    status: 'CONFIRMED',
    approvalModeSnapshot: 'APPROVAL',
    approverUserId: resourceManager.id,
    approvedAt: '2026-08-11T00:00:00.000Z',
    rejectedAt: null,
    rejectionReason: null,
    cancelledAt: null,
    cancelReason: null,
    version: 1,
    createdAt: '2026-08-11T00:00:00.000Z',
    updatedAt: '2026-08-11T00:00:00.000Z',
  });
}

test('신청자는 취소 마감 30분 전까지 취소할 수 있다', () => {
  assert.doesNotThrow(() => assertCancellationAllowed(
    requester,
    vehicle,
    reservation('2026-08-12T00:30:00.000Z'),
    now,
  ));
});

test('신청자는 취소 마감 29분 전부터 취소할 수 없다', () => {
  assert.throws(
    () => assertCancellationAllowed(
      requester,
      vehicle,
      reservation('2026-08-12T00:29:00.000Z'),
      now,
    ),
    (error) => error instanceof ReservationError && error.code === 'CANCEL_DEADLINE',
  );
});

test('타인과 자원 담당자는 신청자의 예약을 취소할 수 없다', () => {
  const row = reservation('2026-08-12T02:00:00.000Z');
  for (const unauthorized of [otherUser, resourceManager]) {
    assert.throws(
      () => assertCancellationAllowed(unauthorized, vehicle, row, now),
      (error) => error instanceof ReservationError && error.code === 'FORBIDDEN',
    );
  }
});

test('ADMIN은 비상 관리 권한으로 취소 마감의 제한을 받지 않는다', () => {
  assert.doesNotThrow(() => assertCancellationAllowed(
    admin,
    vehicle,
    reservation('2026-08-12T00:01:00.000Z'),
    now,
    true, // 관리자 여부는 users.roleGroup 대신 호출 측(usePermission)이 넘긴다.
  ));
});

test('시작이 지난 대기 예약은 승인 기한 만료로, 종료가 지난 확정 예약은 이용 완료로 읽힌다', () => {
  const pending = { ...reservation('2026-08-12T01:00:00.000Z'), status: 'PENDING' as const, approvedAt: null };
  assert.equal(deriveLifecycle(pending, new Date('2026-08-12T00:59:00.000Z')).status, 'PENDING');
  assert.equal(deriveLifecycle(pending, new Date('2026-08-12T01:00:00.000Z')).status, 'EXPIRED');
  const confirmed = reservation('2026-08-12T01:00:00.000Z');
  assert.equal(deriveLifecycle(confirmed, new Date('2026-08-12T02:00:00.000Z')).status, 'CONFIRMED');
  assert.equal(deriveLifecycle(confirmed, new Date('2026-08-12T03:00:00.000Z')).status, 'COMPLETED');
});

test('시간 변경: 승인형 자원은 기존 범위 안이면 승인 유지, 밖이면 재승인', () => {
  const confirmed = reservation('2026-08-12T01:00:00.000Z'); // 01:00~03:00Z
  assert.deepEqual(planReschedule(vehicle, confirmed, { startAt: '2026-08-12T01:00:00.000Z', endAt: '2026-08-12T02:00:00.000Z' }), { status: 'CONFIRMED', keepsApproval: true });
  assert.deepEqual(planReschedule(vehicle, confirmed, { startAt: '2026-08-12T00:00:00.000Z', endAt: '2026-08-12T02:00:00.000Z' }), { status: 'PENDING', keepsApproval: false });
  const pending = { ...confirmed, status: 'PENDING' as const };
  assert.deepEqual(planReschedule(vehicle, pending, { startAt: '2026-08-12T01:00:00.000Z', endAt: '2026-08-12T02:00:00.000Z' }), { status: 'PENDING', keepsApproval: false });
  assert.equal(planReschedule({ ...vehicle, approvalMode: 'INSTANT' }, pending, { startAt: '2026-08-12T05:00:00.000Z', endAt: '2026-08-12T06:00:00.000Z' }).status, 'CONFIRMED');
});
