import assert from 'node:assert/strict';
import test from 'node:test';
import { USER_SEED } from '@/data/seeds/user.seed';
import { RESOURCE_SEED } from '@/data/seeds/resource.seed';
import { reservationSchema, type Reservation } from './schema';
import { assertCancellationAllowed, assertRescheduleAllowed, deriveLifecycle, planReschedule, ReservationError } from './engine';
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

for (const [action, check] of [['취소', assertCancellationAllowed], ['변경', assertRescheduleAllowed]] as const) {
  test(`${action}: 기존 마감이 120분이어도 시작 직전까지 가능하다`, () => {
    for (const startAt of ['2026-08-12T01:59:00.000Z', '2026-08-12T00:01:00.000Z', '2026-08-12T00:00:01.000Z']) {
      assert.doesNotThrow(() => check(requester, { ...vehicle, cancelDeadlineMinutes: 120 }, reservation(startAt), now));
    }
  });

  test(`${action}: 시작 시각부터는 본인이 처리할 수 없다`, () => {
    for (const startAt of ['2026-08-12T00:00:00.000Z', '2026-08-11T23:59:00.000Z']) {
      assert.throws(() => check(requester, vehicle, reservation(startAt), now),
        (error) => error instanceof ReservationError && error.code === 'PAST_TIME');
    }
  });

  test(`${action}: 타인·잠금 계정과 종료 상태 예약은 계속 차단한다`, () => {
    const row = reservation('2026-08-12T00:01:00.000Z');
    for (const unauthorized of [otherUser, resourceManager, { ...requester, status: '잠금' as const }]) {
      assert.throws(() => check(unauthorized, vehicle, row, now),
        (error) => error instanceof ReservationError && error.code === 'FORBIDDEN');
    }
    for (const status of ['CANCELLED', 'COMPLETED', 'EXPIRED', 'REJECTED'] as const) {
      assert.throws(() => check(requester, vehicle, { ...row, status }, now),
        (error) => error instanceof ReservationError && error.code === 'INVALID_STATUS');
    }
  });

  test(`${action}: 기존 관리자 예외는 유지한다`, () => {
    assert.doesNotThrow(() => check(admin, vehicle, reservation('2026-08-11T23:59:00.000Z'), now, true));
  });
}

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
