import assert from 'node:assert/strict';
import test from 'node:test';
import type { DayEntry } from '@/domain/workPlan/dayEntries';
import { lineToneOf } from './entryKind';

const entry = (over: Partial<DayEntry>): DayEntry => ({
  key: 'k', source: 'ITEM', allDay: false, startTime: null, endTime: null, title: '', tag: null, roomStatus: null, ...over,
});

test('lineToneOf: 업무·회의·출장(외근 색)·휴가', () => {
  assert.equal(lineToneOf(entry({})), 'item');
  assert.equal(lineToneOf(entry({ source: 'MEETING' })), 'meeting');
  assert.equal(lineToneOf(entry({ source: 'OUTSIDE', outside: { category: 'TRIP' } as DayEntry['outside'] })), 'outside');
  assert.equal(
    lineToneOf(entry({ source: 'APPROVAL', schedule: { category: 'LEAVE' } as DayEntry['schedule'] })),
    'leave',
  );
});
