import assert from 'node:assert/strict';
import test from 'node:test';
import { RESOURCE_SEED } from '@/data/seeds/resource.seed';
import { reservationSchema } from './schema';
import { ReservationError, validateReservationRequest } from './engine';

/** 시간 단위·운영시간·이용시간 제한 없이 자유롭게 예약하고, 다른 예약과 겹칠 때만 막는다. (2026-10-15) */
const vehicle = RESOURCE_SEED.find((resource) => resource.id === 'RES-0003')!; // 08:00~20:00, 60분 단위, 60~720분
const now = new Date('2026-08-12T00:00:00.000Z');
const at = (time: string) => new Date(`2026-08-13T${time}:00+09:00`).toISOString();
const ask = (start: string, end: string) => ({
  resourceId: vehicle.id, requesterDeptId: 'D230', title: '자유 예약', purpose: '자유 예약 검증',
  startAt: at(start), endAt: at(end), quantity: 1, attendeeCount: null, attendeeUserIds: [],
});
const code = (expected: string) => (error: unknown) => error instanceof ReservationError && error.code === expected;

test('단위에 안 맞는 시각도 예약된다 (13:00~14:00, 13:10~13:35)', () => {
  assert.doesNotThrow(() => validateReservationRequest(vehicle, ask('13:00', '14:00'), [], now));
  assert.doesNotThrow(() => validateReservationRequest(vehicle, ask('13:10', '13:35'), [], now));
});

test('운영시간 밖, 최소·최대 이용시간을 벗어나도 예약된다', () => {
  assert.doesNotThrow(() => validateReservationRequest(vehicle, ask('06:00', '07:00'), [], now));
  assert.doesNotThrow(() => validateReservationRequest(vehicle, ask('21:00', '23:50'), [], now));
  assert.doesNotThrow(() => validateReservationRequest(vehicle, ask('09:00', '09:10'), [], now));
  assert.doesNotThrow(() => validateReservationRequest(vehicle, ask('00:10', '23:50'), [], now));
});

test('다른 예약과 겹치면 막는다', () => {
  const existing = reservationSchema.parse({
    id: 'RSV-20260813-0001', resourceId: vehicle.id, resourceCodeSnapshot: vehicle.code, resourceNameSnapshot: vehicle.name,
    requesterUserId: 'U010', requesterDeptId: 'D230', title: '기존', purpose: '기존 예약', startAt: at('13:00'), endAt: at('14:00'),
    quantity: 1, attendeeCount: null, attendeeUserIds: [], status: 'CONFIRMED', approvalModeSnapshot: 'APPROVAL',
    approverUserId: 'U009', approvedAt: '2026-08-11T00:00:00.000Z', rejectedAt: null, rejectionReason: null,
    cancelledAt: null, cancelReason: null, version: 1, createdAt: '2026-08-11T00:00:00.000Z', updatedAt: '2026-08-11T00:00:00.000Z',
  });
  assert.throws(() => validateReservationRequest(vehicle, ask('13:30', '14:30'), [existing], now), code('CONFLICT'));
  assert.doesNotThrow(() => validateReservationRequest(vehicle, ask('14:00', '15:00'), [existing], now));
});

test('초 단위 시각은 받지 않는다', () => {
  const raw = { ...ask('13:00', '14:00'), startAt: new Date(`2026-08-13T13:00:30+09:00`).toISOString() };
  assert.throws(() => validateReservationRequest(vehicle, raw, [], now), code('SLOT_MISMATCH'));
});
