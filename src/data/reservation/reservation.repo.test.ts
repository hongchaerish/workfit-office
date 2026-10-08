import assert from 'node:assert/strict';
import test from 'node:test';
import { reservationRepo } from './reservation.repo';
import { resourceRepo } from '@/data/resource/resource.repo';
import { ReservationError } from '@/domain/reservation/engine';
import { RESOURCE_UTC_OFFSET, resourceDateKey } from '@/domain/reservation/time';
import type { ReservationRequest } from '@/domain/reservation/schema';
import { userSchema, type User } from '@/domain/user/schema';
import { USER_SEED } from '@/data/seeds/user.seed';

function actor(id: string): User {
  const row = USER_SEED.find((user) => user.id === id);
  if (!row) throw new Error(`테스트 사용자를 찾을 수 없습니다: ${id}`);
  return userSchema.parse(row);
}

function futureWindow(days: number, startTime: string, endTime: string): [string, string] {
  const today = resourceDateKey(new Date());
  const target = new Date(`${today}T00:00:00${RESOURCE_UTC_OFFSET}`);
  target.setUTCDate(target.getUTCDate() + days);
  const date = resourceDateKey(target);
  return [
    new Date(`${date}T${startTime}:00${RESOURCE_UTC_OFFSET}`).toISOString(),
    new Date(`${date}T${endTime}:00${RESOURCE_UTC_OFFSET}`).toISOString(),
  ];
}

function request(
  resourceId: string,
  window: [string, string],
  options: { quantity?: number; attendeeCount?: number | null; title?: string } = {},
): ReservationRequest {
  return {
    resourceId,
    requesterDeptId: 'D230',
    title: options.title ?? '예약 흐름 테스트',
    purpose: '자원예약 충돌과 반환 검증',
    startAt: window[0],
    endAt: window[1],
    quantity: options.quantity ?? 1,
    attendeeCount: options.attendeeCount ?? null,
    attendeeUserIds: [],
  };
}

const requester = actor('U010');
const otherRequester = actor('U012');
const vehicleManager = actor('U009');

test('즉시예약은 충돌을 막고 취소 후 같은 시간을 반환한다', async () => {
  const window = futureWindow(20, '09:00', '10:00');
  const input = request('RES-0002', window, { attendeeCount: 4, title: '소회의실 즉시예약' });

  const created = await reservationRepo.create(requester, input);
  assert.equal(created.status, 'CONFIRMED');
  await assert.rejects(
    () => reservationRepo.create(otherRequester, input),
    (error) => error instanceof ReservationError && error.code === 'CONFLICT',
  );

  const cancelled = await reservationRepo.cancel(requester, created.id, '일정 변경');
  assert.equal(cancelled.status, 'CANCELLED');
  const retried = await reservationRepo.create(otherRequester, input);
  assert.equal(retried.status, 'CONFIRMED');
});

test('승인대기 예약도 시간을 점유하고 반려 후 반환한다', async () => {
  const window = futureWindow(21, '09:00', '11:00');
  const input = request('RES-0003', window, { title: '법인차량 승인예약' });

  const pending = await reservationRepo.create(requester, input);
  assert.equal(pending.status, 'PENDING');
  await assert.rejects(
    () => reservationRepo.create(otherRequester, input),
    (error) => error instanceof ReservationError && error.code === 'CONFLICT',
  );

  const rejected = await reservationRepo.reject(vehicleManager, pending.id, '차량 점검 예정');
  assert.equal(rejected.status, 'REJECTED');
  const retried = await reservationRepo.create(otherRequester, input);
  assert.equal(retried.status, 'PENDING');
});

test('수량형 예약은 합계 초과를 막고 취소 후 수량을 반환한다', async () => {
  const window = futureWindow(22, '09:00', '11:00');
  const fourLaptops = request('RES-0005', window, { quantity: 4, title: '노트북 4대 대여' });
  const twoLaptops = request('RES-0005', window, { quantity: 2, title: '노트북 2대 대여' });

  const pending = await reservationRepo.create(requester, fourLaptops);
  assert.equal(pending.status, 'PENDING');
  await assert.rejects(
    () => reservationRepo.create(otherRequester, twoLaptops),
    (error) => error instanceof ReservationError && error.code === 'CONFLICT',
  );

  await reservationRepo.cancel(requester, pending.id, '교육 일정 취소');
  const retried = await reservationRepo.create(otherRequester, {
    ...twoLaptops,
    quantity: 5,
    title: '노트북 전체 대여',
  });
  assert.equal(retried.status, 'PENDING');
  assert.equal(retried.quantity, 5);
});

test('관리자는 담당 자원이 아니어도 승인·반려하고 남의 예약을 취소한다', async () => {
  const admin = otherRequester; // 차량 담당자가 아닌 일반 사용자 — 관리자 여부는 호출 측(usePermission)이 넘긴다.
  const first = await reservationRepo.create(requester, request('RES-0003', futureWindow(22, '09:00', '10:00'), { title: '관리자 승인' }));
  await assert.rejects(
    () => reservationRepo.approve(admin, first.id),
    (error) => error instanceof ReservationError && error.code === 'FORBIDDEN',
  );
  const approved = await reservationRepo.approve(admin, first.id, true);
  assert.equal(approved.status, 'CONFIRMED');

  await assert.rejects(
    () => reservationRepo.cancel(admin, approved.id, '관리자 취소'),
    (error) => error instanceof ReservationError && error.code === 'FORBIDDEN',
  );
  const cancelled = await reservationRepo.cancel(admin, approved.id, '관리자 취소', true);
  assert.equal(cancelled.status, 'CANCELLED');

  const second = await reservationRepo.create(requester, request('RES-0003', futureWindow(22, '11:00', '12:00'), { title: '관리자 반려' }));
  const rejected = await reservationRepo.reject(admin, second.id, '관리자 반려', true);
  assert.equal(rejected.status, 'REJECTED');
});

test('신청 후 자원 설정이 바뀌어도 대기 예약을 승인할 수 있다', async () => {
  const pending = await reservationRepo.create(requester, request('RES-0003', futureWindow(23, '13:00', '15:00'), { title: '설정 변경 후 승인' }));
  assert.equal(pending.status, 'PENDING');

  const original = await resourceRepo.get('RES-0003');
  assert.ok(original);
  const { id, createdBy: _cb, createdAt: _ca, updatedBy: _ub, updatedAt: _ua, ...draft } = original;
  // 최대 이용시간을 신청 시간(120분)보다 짧게 줄인다 — 신청 규칙 재검증이면 DURATION 으로 막혔다.
  await resourceRepo.save(vehicleManager, { ...draft, maxDurationMinutes: 60 }, id, true);
  try {
    const approved = await reservationRepo.approve(vehicleManager, pending.id);
    assert.equal(approved.status, 'CONFIRMED');
  } finally {
    await resourceRepo.save(vehicleManager, draft, id, true);
  }
});

test('승인형 자원: 확정 예약을 기존 범위 안으로 줄이면 승인 유지, 밖으로 옮기면 재승인', async () => {
  const pending = await reservationRepo.create(requester, request('RES-0003', futureWindow(24, '09:00', '12:00'), { title: '시간 변경' }));
  const confirmed = await reservationRepo.approve(vehicleManager, pending.id);
  assert.equal(confirmed.status, 'CONFIRMED');

  const shrunk = await reservationRepo.reschedule(requester, confirmed.id, { startAt: futureWindow(24, '10:00', '11:00')[0], endAt: futureWindow(24, '10:00', '11:00')[1] });
  assert.equal(shrunk.status, 'CONFIRMED');
  assert.equal(shrunk.approvedAt, confirmed.approvedAt);

  const [startAt, endAt] = futureWindow(24, '13:00', '14:00');
  const moved = await reservationRepo.reschedule(requester, confirmed.id, { startAt, endAt });
  assert.equal(moved.status, 'PENDING');
  assert.equal(moved.approvedAt, null);
  assert.equal(moved.approverUserId, 'U009');

  await assert.rejects(
    () => reservationRepo.reschedule(otherRequester, moved.id, { startAt: futureWindow(24, '15:00', '16:00')[0], endAt: futureWindow(24, '15:00', '16:00')[1] }),
    (error) => error instanceof ReservationError && error.code === 'FORBIDDEN',
  );
});

test('즉시확정 자원은 시간을 바꿔도 확정이고, 다른 예약과 겹치면 막는다', async () => {
  const first = await reservationRepo.create(requester, request('RES-0002', futureWindow(25, '09:00', '10:00'), { attendeeCount: 2, title: '변경 대상' }));
  await reservationRepo.create(otherRequester, request('RES-0002', futureWindow(25, '11:00', '12:00'), { attendeeCount: 2, title: '다른 예약' }));

  const [startAt, endAt] = futureWindow(25, '14:00', '15:00');
  const moved = await reservationRepo.reschedule(requester, first.id, { startAt, endAt });
  assert.equal(moved.status, 'CONFIRMED');

  const [clashStart, clashEnd] = futureWindow(25, '11:00', '12:00');
  await assert.rejects(
    () => reservationRepo.reschedule(requester, first.id, { startAt: clashStart, endAt: clashEnd }),
    (error) => error instanceof ReservationError && error.code === 'CONFLICT',
  );
});

test('예정 예약이 있는 자원은 삭제할 수 없고, 일괄 취소 후에는 삭제된다', async () => {
  const created = await resourceRepo.save(vehicleManager, {
    code: 'TEST-DEL', name: '삭제 테스트 장비', typeCode: 'EQUIPMENT', bookingMode: 'TIME_SLOT', location: '본사', description: '',
    capacity: null, totalQuantity: 1, unitCode: 'EA', managerUserId: null, ownerDeptId: null, approvalMode: 'INSTANT',
    slotMinutes: 30, minDurationMinutes: 30, maxDurationMinutes: 480, bufferBeforeMinutes: 0, bufferAfterMinutes: 0,
    maxAdvanceDays: 60, cancelDeadlineMinutes: 30, availableFrom: '08:00', availableTo: '20:00', status: 'ACTIVE', imageUrl: null, notes: '',
  }, undefined, true);
  await reservationRepo.create(requester, request(created.id, futureWindow(26, '09:00', '10:00'), { title: '삭제 막기' }));

  await assert.rejects(
    () => resourceRepo.delete(vehicleManager, created.id),
    (error) => error instanceof ReservationError && error.code === 'FORBIDDEN',
  );
  await assert.rejects(
    () => resourceRepo.delete(vehicleManager, created.id, true),
    (error) => error instanceof ReservationError && error.code === 'INVALID_STATUS',
  );
  assert.equal(await reservationRepo.cancelUpcomingByResource(vehicleManager, created.id, '자원 점검', true), 1);
  await resourceRepo.delete(vehicleManager, created.id, true);
  assert.equal(await resourceRepo.get(created.id), null);
});
