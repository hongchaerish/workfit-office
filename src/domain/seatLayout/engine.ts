import type { Seat } from './schema';

/** 좌표를 0~100(%) 안으로, 소수 둘째 자리까지 맞춘다. */
export function clampPercent(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.round(Math.min(100, Math.max(0, v)) * 100) / 100;
}

/** 배치도 안에서 겹치지 않는 새 좌석 ID. */
export function nextSeatId(seats: Seat[]): string {
  const used = new Set(seats.map((s) => s.id));
  let n = seats.length + 1;
  while (used.has(`S${n}`)) n += 1;
  return `S${n}`;
}

export function addSeat(seats: Seat[], x: number, y: number): { seats: Seat[]; seat: Seat } {
  const seat: Seat = { id: nextSeatId(seats), x: clampPercent(x), y: clampPercent(y), userId: null, label: '' };
  return { seats: [...seats, seat], seat };
}

export function moveSeat(seats: Seat[], seatId: string, x: number, y: number): Seat[] {
  return seats.map((s) => (s.id === seatId ? { ...s, x: clampPercent(x), y: clampPercent(y) } : s));
}

export function removeSeat(seats: Seat[], seatId: string): Seat[] {
  return seats.filter((s) => s.id !== seatId);
}

export function setSeatLabel(seats: Seat[], seatId: string, label: string): Seat[] {
  return seats.map((s) => (s.id === seatId ? { ...s, label: label.slice(0, 30) } : s));
}

/**
 * 좌석에 사람을 앉힌다. 한 사람은 한 배치도에 한 자리만 — 다른 자리에 있던 같은 사람은 비운다.
 * userId 가 null 이면 그 자리를 비운다.
 */
export function assignSeat(seats: Seat[], seatId: string, userId: string | null): Seat[] {
  return seats.map((s) => {
    if (s.id === seatId) return { ...s, userId };
    if (userId && s.userId === userId) return { ...s, userId: null };
    return s;
  });
}
