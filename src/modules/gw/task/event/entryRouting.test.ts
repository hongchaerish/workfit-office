import assert from 'node:assert/strict';
import test from 'node:test';
import type { CalendarEvent } from '@/domain/calendarEvent/schema';
import type { OutsideScheduleView } from '@/domain/outsideWork/view';
import type { User } from '@/domain/user/schema';
import type { DayEntry } from '@/domain/workPlan/dayEntries';
import type { WorkPlanItem } from '@/domain/workPlan/item';
import {
  DEFAULT_CREATE_RANGE,
  OTHER_CELL_KINDS,
  OWN_CELL_KINDS,
  createTarget,
  kindEnabled,
  routeEntry,
} from './entryRouting';

const ME = { id: 'U011', name: '홍길동', status: '사용' } as User;
const OTHER = { id: 'U012', name: '김철수', status: '사용' } as User;
const base = { key: 'k', allDay: false, startTime: '09:00', endTime: '10:00', title: 't', tag: null, roomStatus: null } as const;

const item = (ownerUserId: string) => ({ id: 'WI-1', ownerUserId }) as WorkPlanItem;
const meeting = (ownerUserId: string, attendees: string[] = []) =>
  ({ id: 'CAL-1', ownerUserId, eventType: 'MEETING', attendeeUserIds: attendees, date: '2026-10-21' }) as unknown as CalendarEvent;
const outsideView = (ownerUserId: string, self: boolean) =>
  ({ key: 'o', ownerUserId, source: self ? 'SELF' : 'APPROVAL', self: self ? { id: 'OW-1', ownerUserId } : undefined }) as unknown as OutsideScheduleView;

const entry = (patch: Partial<DayEntry>) => ({ ...base, ...patch }) as DayEntry;

// ── routeEntry ────────────────────────────────

test('내 일반 항목은 수정, 남의 일반 항목은 보기', () => {
  const mine = entry({ source: 'ITEM', item: item(ME.id) });
  assert.deepEqual(routeEntry(mine, ME, true), { sheet: { mode: 'edit', entry: mine } });
  const theirs = entry({ source: 'ITEM', item: item(OTHER.id) });
  assert.deepEqual(routeEntry(theirs, ME, true), { sheet: { mode: 'view', entry: theirs } });
});

test('내가 주최한 회의는 수정, 참석자로 든 회의는 보기', () => {
  const organized = entry({ source: 'MEETING', event: meeting(ME.id, [OTHER.id]) });
  assert.deepEqual(routeEntry(organized, ME, true), { sheet: { mode: 'edit', entry: organized } });
  const attending = entry({ source: 'MEETING', event: meeting(OTHER.id, [ME.id]) });
  assert.deepEqual(routeEntry(attending, ME, true), { sheet: { mode: 'view', entry: attending } });
});

test('내가 등록한 외근은 수정, 남이 등록한 외근은 보기', () => {
  const mine = entry({ source: 'OUTSIDE', outside: outsideView(ME.id, true) });
  assert.deepEqual(routeEntry(mine, ME, true), { sheet: { mode: 'edit', entry: mine } });
  const theirs = entry({ source: 'OUTSIDE', outside: outsideView(OTHER.id, true) });
  assert.deepEqual(routeEntry(theirs, ME, true), { sheet: { mode: 'view', entry: theirs } });
});

test('동행 외근 칸은 외근 상세로', () => {
  const view = outsideView(OTHER.id, true);
  const companion = entry({ source: 'OUTSIDE', outside: view, companionOf: OTHER.id });
  assert.deepEqual(routeEntry(companion, ME, true), { outside: { view, entry: companion } });
});

test('결재 외근은 외근 상세로, 결재 휴가(외근 정보 없음)는 열지 않는다', () => {
  const view = outsideView(ME.id, false);
  const approvalOutside = entry({ source: 'APPROVAL', outside: view });
  assert.deepEqual(routeEntry(approvalOutside, ME, true), { outside: { view, entry: approvalOutside } });
  assert.equal(routeEntry(entry({ source: 'APPROVAL' }), ME, true), null);
});

test('회의 외 캘린더 일정은 캘린더 일정 창으로, 원본이 없으면 열지 않는다', () => {
  const event = { ...meeting(OTHER.id), eventType: 'COMPANY_EVENT' } as CalendarEvent;
  assert.deepEqual(routeEntry(entry({ source: 'CALENDAR', event }), ME, true), { calendar: event });
  assert.equal(routeEntry(entry({ source: 'CALENDAR' }), ME, true), null);
});

test('사용 중이 아닌 계정은 내 것도 보기로만 연다', () => {
  for (const e of [
    entry({ source: 'ITEM', item: item(ME.id) }),
    entry({ source: 'MEETING', event: meeting(ME.id) }),
    entry({ source: 'OUTSIDE', outside: outsideView(ME.id, true) }),
  ]) {
    assert.deepEqual(routeEntry(e, ME, false), { sheet: { mode: 'view', entry: e } });
  }
});

// ── createTarget ──────────────────────────────

test('본인 칸은 모든 종류, 남의 칸은 회의만', () => {
  const now = new Date(2026, 9, 21, 9, 10);
  const own = createTarget('2026-10-22', ME, ME, '2026-10-21', now);
  assert.equal(own.mode, 'create');
  assert.deepEqual(own.allowed, OWN_CELL_KINDS);
  assert.equal(own.owner, ME);
  const other = createTarget('2026-10-22', OTHER, ME, '2026-10-21', now);
  assert.deepEqual(other.allowed, OTHER_CELL_KINDS);
  assert.equal(other.owner, OTHER);
  assert.equal(other.date, '2026-10-22');
});

test('오늘이면 지금 다음 30분, 다른 날이면 09:00~09:30', () => {
  const now = new Date(2026, 9, 21, 14, 10);
  assert.deepEqual(createTarget('2026-10-21', ME, ME, '2026-10-21', now).initialRange, { start: 870, end: 900 });
  assert.deepEqual(createTarget('2026-10-22', ME, ME, '2026-10-21', now).initialRange, DEFAULT_CREATE_RANGE);
  assert.deepEqual(DEFAULT_CREATE_RANGE, { start: 540, end: 570 });
});

// ── kindEnabled ───────────────────────────────

test('새 일정은 허용 목록 안, 수정은 같은 출처 안(외근↔출장)만, 보기는 모두 막힘', () => {
  const create = createTarget('2026-10-22', OTHER, ME, '2026-10-21', new Date());
  assert.equal(kindEnabled('MEETING', create, 'MEETING', false), true);
  assert.equal(kindEnabled('ITEM', create, 'MEETING', false), false);
  const edit = { mode: 'edit', entry: entry({ source: 'OUTSIDE' }) } as const;
  assert.equal(kindEnabled('TRIP', edit, 'OUTSIDE', false), true);
  assert.equal(kindEnabled('MEETING', edit, 'OUTSIDE', false), false);
  assert.equal(kindEnabled('ITEM', { mode: 'edit', entry: entry({ source: 'ITEM' }) }, 'ITEM', false), true);
  assert.equal(kindEnabled('OUTSIDE', create, 'MEETING', true), false);
});
