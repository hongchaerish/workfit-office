import assert from 'node:assert/strict';
import test from 'node:test';
import type { User } from '@/domain/user/schema';
import type { DayCell, DayEntry } from '@/domain/workPlan/dayEntries';
import { chairToCommittee, groupRoster, isChairAccount, summarizeGroup } from './teamWeekGroups';

const u = (id: string, name: string, dept: string) => ({ id, name, dept }) as User;
const DEPTS = ['경영지원팀', '개발팀', '기획팀'];
const opts = (_myDept?: string | null) => ({
  deptOrder: (d: string) => (DEPTS.includes(d) ? DEPTS.indexOf(d) : Number.MAX_SAFE_INTEGER),
  compare: (a: User, b: User) => a.name.localeCompare(b.name, 'ko'),
});

const A = u('U1', '가나', '경영지원팀');
const B = u('U2', '다라', '개발팀');
const C = u('U3', '마바', '기획팀');
const E = u('U9', '임원', '경영지원팀');

test('groupRoster: 내 부서도 올리지 않고 부서 관리 순서 그대로, 임원은 자기 부서에', () => {
  const g = groupRoster([A, B, C, E], opts('개발팀'));
  assert.deepEqual(g.map((x) => x.label), ['경영지원팀', '개발팀', '기획팀']);
  assert.deepEqual(g[0].members.map((m) => m.id), ['U1', 'U9']);
});

test('groupRoster: 겸직 행은 두 묶음에 모두', () => {
  const g = groupRoster([B, { ...B, dept: '기획팀' } as User, C], opts(null));
  const ids = (label: string) => g.find((x) => x.label === label)!.members.map((m) => m.id);
  assert.deepEqual(ids('개발팀'), ['U2']);
  assert.deepEqual(ids('기획팀'), ['U2', 'U3']);
});

test('groupRoster: 부서 없는 사람은 맨 끝 소속 없음', () => {
  const g = groupRoster([u('U5', '사바', ''), A, u('U6', '아자', '모르는팀')], opts(null));
  assert.deepEqual(g.map((x) => x.label), ['경영지원팀', '모르는팀', '소속 없음']);
  assert.equal(g[2].key, '__NONE__');
});

const entry = (over: Partial<DayEntry>): DayEntry => ({
  key: 'k', source: 'ITEM', allDay: false, startTime: null, endTime: null, title: 't', tag: null, roomStatus: null, ...over,
});
const LEAVE = entry({ source: 'APPROVAL', allDay: true, schedule: { category: 'LEAVE', leaveType: '연차' } as DayEntry['schedule'] });
const TRIP = entry({ source: 'OUTSIDE', allDay: true, outside: { category: 'TRIP' } as DayEntry['outside'] });
const WORK = entry({ startTime: '09:00', endTime: '10:00' });
const WEEK = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22'];
const TODAY = '2026-11-18';

const cells: Record<string, DayEntry[]> = { U1: [LEAVE], U2: [TRIP], U3: [] };
const cellOf = (userId: string, date: string): DayCell => ({
  entries: date === TODAY ? cells[userId] ?? [] : userId === 'U3' ? [] : [WORK],
  memo: null,
  memoPlan: null,
});

test('summarizeGroup: 오늘 휴가·외근(출장 포함)·미작성', () => {
  assert.deepEqual(summarizeGroup([A, B, C], cellOf, TODAY, WEEK), { leave: 1, outside: 1, unwritten: 1 });
});

test('summarizeGroup: 지난주는 미작성을 세지 않는다', () => {
  assert.equal(summarizeGroup([C], cellOf, '2026-11-30', WEEK).unwritten, 0);
});

test('chairToCommittee: 위원장(대표이사 계정)은 업무계획에서 기술경영전략위원회 소속으로', () => {
  const chair = { id: 'C1', name: '대표이사', dept: '대표이사' } as User;
  const out = chairToCommittee([chair, A], (m) => m.id === 'C1');
  assert.equal(out[0].dept, '기술경영전략위원회');
  assert.equal(out[1], A);
  const g = groupRoster(out, opts(null));
  assert.ok(!g.some((x) => x.label === '대표이사'));
});

test('isChairAccount: 이름·직위·직책 중 하나가 대표이사면 위원장 계정', () => {
  assert.equal(isChairAccount({ id: 'x', name: '대표이사', dept: '대표이사' } as User), true);
  assert.equal(isChairAccount({ id: 'y', name: '홍길동', dept: '대표이사', jobTitle: '대표이사' } as User), true);
  assert.equal(isChairAccount(A), false);
});
