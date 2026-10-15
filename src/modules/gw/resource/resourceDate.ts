import type { Resource } from '@/domain/resource/schema';
import { RESOURCE_UTC_OFFSET, resourceDateKey, resourceTimeParts } from '@/domain/reservation/time';

const pad = (value: number) => String(value).padStart(2, '0');

export function toDateInput(date: Date): string {
  return resourceDateKey(date);
}

export function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function startOfWeek(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - weekday + 1);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function combineLocalDateTime(date: string, time: string): string {
  return new Date(`${date}T${time}:00${RESOURCE_UTC_OFFSET}`).toISOString();
}

export function formatResourceDateTime(iso: string): string {
  const parts = resourceTimeParts(new Date(iso));
  return `${parts.month}.${pad(parts.day)} ${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function formatResourceFullDateTime(iso: string): string {
  const parts = resourceTimeParts(new Date(iso));
  return `${parts.year}.${pad(parts.month)}.${pad(parts.day)} ${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function formatResourceTime(iso: string): string {
  const parts = resourceTimeParts(new Date(iso));
  return `${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function isSameLocalDate(iso: string, date: string): boolean {
  return toDateInput(new Date(iso)) === date;
}

export function dateRangeIso(date: string): { from: string; to: string } {
  return {
    from: new Date(`${date}T00:00:00${RESOURCE_UTC_OFFSET}`).toISOString(),
    to: new Date(`${addDays(date, 1)}T00:00:00${RESOURCE_UTC_OFFSET}`).toISOString(),
  };
}

/**
 * 예약 창을 열 때의 기본 시간대 — 오늘이면 지금부터 15분 뒤 이후의 첫 30분 단위, 다른 날이면 09:00부터
 * 1시간. 예약 시간 판정에는 단위·운영시간 제한이 없고, 이 값은 처음 보여 줄 제안일 뿐이다.
 */
export function defaultReservationWindow(_resource: Resource, preferredDate?: string): { date: string; start: string; end: string } {
  const now = new Date();
  let date = preferredDate && preferredDate >= toDateInput(now) ? preferredDate : toDateInput(now);
  const nowParts = resourceTimeParts(now);
  const length = 60;
  let startMinutes = 9 * 60;
  if (date === toDateInput(now)) {
    startMinutes = Math.ceil((nowParts.hour * 60 + nowParts.minute + 15) / 30) * 30;
  }
  if (startMinutes + length > 24 * 60 - 1) {
    date = addDays(date, 1);
    startMinutes = 9 * 60;
  }
  const endMinutes = startMinutes + length;
  return {
    date,
    start: `${pad(Math.floor(startMinutes / 60))}:${pad(startMinutes % 60)}`,
    end: `${pad(Math.floor(endMinutes / 60))}:${pad(endMinutes % 60)}`,
  };
}
