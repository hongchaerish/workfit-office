import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DayEntry } from '@/domain/workPlan/dayEntries';
import { weekSpans } from './weekSpans';

const COLS = [['2026-11-16'], ['2026-11-17'], ['2026-11-18'], ['2026-11-19'], ['2026-11-20'], ['2026-11-21', '2026-11-22']];
const trip = (key: string, startDate: string, endDate: string) =>
  ({ key, source: 'OUTSIDE', allDay: true, startTime: null, endTime: null, title: '부산', tag: null, roomStatus: null, outside: { startDate, endDate } }) as unknown as DayEntry;
const item = (key: string) => ({ key, source: 'ITEM', allDay: false, startTime: '09:00', endTime: '10:00', title: 'x', tag: null, roomStatus: null }) as unknown as DayEntry;

const byDate = (map: Record<string, DayEntry[]>) => (date: string) => map[date] ?? [];

test('여러 날 출장은 이어진 칸을 한 줄로 묶는다', () => {
  const t = trip('out-1', '2026-11-17', '2026-11-19');
  const spans = weekSpans(COLS, byDate({ '2026-11-17': [t, item('a')], '2026-11-18': [t], '2026-11-19': [t] }));
  assert.deepEqual(spans.map((s) => [s.key, s.start, s.end, s.lane]), [['out-1', 1, 3, 0]]);
});

test('하루짜리 외근·일반 업무는 묶지 않는다', () => {
  const one = trip('out-2', '2026-11-18', '2026-11-18');
  assert.deepEqual(weekSpans(COLS, byDate({ '2026-11-18': [one, item('b')] })), []);
});

test('토·일 안에서만 이어지면 한 칸이라 묶지 않고, 금~토로 이어지면 주말 칸까지 묶는다', () => {
  const we = trip('out-3', '2026-11-21', '2026-11-22');
  assert.deepEqual(weekSpans(COLS, byDate({ '2026-11-21': [we], '2026-11-22': [we] })), []);
  const fs = trip('out-4', '2026-11-20', '2026-11-21');
  assert.deepEqual(weekSpans(COLS, byDate({ '2026-11-20': [fs], '2026-11-21': [fs] })).map((s) => [s.start, s.end]), [[4, 5]]);
});

test('겹치는 두 출장은 다른 줄(lane)에', () => {
  const a = trip('out-a', '2026-11-16', '2026-11-18');
  const b = trip('out-b', '2026-11-18', '2026-11-19');
  const spans = weekSpans(COLS, byDate({ '2026-11-16': [a], '2026-11-17': [a], '2026-11-18': [a, b], '2026-11-19': [b] }));
  assert.deepEqual(spans.map((s) => [s.key, s.lane]), [['out-a', 0], ['out-b', 1]]);
});
