import assert from 'node:assert/strict';
import test from 'node:test';
import { reservationRepo } from './reservation.repo';
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
