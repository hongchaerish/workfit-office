import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_COMMUTE_POLICY, type CommutePolicy } from '@/domain/commutePolicy/schema';
import type { ApprovedLeaveInfo } from '@/domain/commute/engine';
import { resolvePresence, type PresenceInputs } from './resolve';

const policy: CommutePolicy = {
  ...DEFAULT_COMMUTE_POLICY,
  workStartTime: '08:30',
  workEndTime: '17:30',
  breakStartTime: '11:30',
  breakEndTime: '12:30',
};

/** KST 'YYYY-MM-DD HH:mm' → Date */
const kst = (s: string) => new Date(`${s.replace(' ', 'T')}:00+09:00`);
const D = '2026-10-02';

function resolveAt(now: string, over: Partial<PresenceInputs> = {}) {
  return resolvePresence({ stored: null, approvalDays: new Map(), meetings: [], policy, now: kst(now), ...over });
}
const days = (date: string, entries: ApprovedLeaveInfo[]) => new Map([[date, entries]]);
const leave = (leaveType: string): ApprovedLeaveInfo => ({ leaveType, category: 'LEAVE', docId: `AP-${leaveType}` });
const OUTSIDE: ApprovedLeaveInfo = { leaveType: '외근', category: 'OUTSIDE', docId: 'AP-O' };
const seen = (at: string) => ({ status: 'ONLINE' as const, message: '', updatedAt: kst(`${D} 07:00`).toISOString(), lastSeenAt: kst(at).toISOString() });

// ── 접속 여부 ──

test('아무 정보가 없으면 오프라인이다', () => {
  assert.equal(resolveAt(`${D} 10:00`).status, 'OFFLINE');
});

test('최근 3분 안에 접속 신호가 있으면 업무중, 그보다 오래되면 오프라인이다', () => {
  assert.equal(resolveAt(`${D} 10:00`, { stored: seen(`${D} 09:58`) }).status, 'ONLINE');
  assert.equal(resolveAt(`${D} 10:00`, { stored: seen(`${D} 09:55`) }).status, 'OFFLINE');
});

// ── 전자결재 일정 ──

test('연차는 근무시간 밖이나 앱이 꺼져 있어도 하루 종일 휴가다', () => {
  const r = resolveAt(`${D} 20:00`, { approvalDays: days(D, [leave('연차')]) });
  assert.equal(r.status, 'LEAVE');
  assert.equal(r.message, '연차');
});

test('오전반차는 오전 시간대에만 휴가이고 오후에는 접속 여부를 따른다', () => {
  const approvalDays = days(D, [leave('오전반차')]);
  assert.equal(resolveAt(`${D} 10:00`, { approvalDays }).status, 'LEAVE');
  assert.equal(resolveAt(`${D} 14:00`, { approvalDays, stored: seen(`${D} 13:59`) }).status, 'ONLINE');
});

test('승인된 외근일은 외근·출장이다', () => {
  assert.equal(resolveAt(`${D} 10:00`, { approvalDays: days(D, [OUTSIDE]) }).status, 'OUTSIDE');
});

test('오늘 날짜는 KST로 판단한다 (KST 오전 8시 = UTC 전날 23시)', () => {
  const r = resolveAt('2026-10-03 08:00', { approvalDays: days('2026-10-03', [leave('연차')]) });
  assert.equal(r.status, 'LEAVE');
});

// ── 캘린더 회의 ──

test('참석 중인 회의 시간에는 회의중이고 회의가 끝나면 접속 여부를 따른다', () => {
  const meetings = [{ date: D, startTime: '10:00', endTime: '11:00' }];
  assert.equal(resolveAt(`${D} 10:30`, { meetings }).status, 'MEETING');
  assert.equal(resolveAt(`${D} 11:30`, { meetings, stored: seen(`${D} 11:29`) }).status, 'ONLINE');
});

// ── 직접 설정 vs 자동 (더 최근 것이 이긴다) ──

test('직접 정한 집중근무보다 그 뒤에 시작한 회의가 우선한다', () => {
  const stored = { status: 'FOCUS' as const, message: '', updatedAt: kst(`${D} 09:00`).toISOString(), lastSeenAt: kst(`${D} 10:29`).toISOString() };
  const meetings = [{ date: D, startTime: '10:00', endTime: '11:00' }];
  assert.equal(resolveAt(`${D} 10:30`, { stored, meetings }).status, 'MEETING');
});

test('외근일에 복귀해 직접 업무중으로 바꾸면 업무중이다', () => {
  const stored = { status: 'ONLINE' as const, message: '', updatedAt: kst(`${D} 14:00`).toISOString(), lastSeenAt: kst(`${D} 14:30`).toISOString() };
  assert.equal(resolveAt(`${D} 14:31`, { stored, approvalDays: days(D, [OUTSIDE]) }).status, 'ONLINE');
});

test('오늘 직접 정한 상태는 접속 여부보다 우선한다 (오프라인으로 숨기기 포함)', () => {
  const at = (status: 'FOCUS' | 'OFFLINE') => ({ status, message: '몰입', updatedAt: kst(`${D} 09:00`).toISOString(), lastSeenAt: kst(`${D} 09:59`).toISOString() });
  assert.equal(resolveAt(`${D} 10:00`, { stored: at('FOCUS') }).status, 'FOCUS');
  assert.equal(resolveAt(`${D} 10:00`, { stored: at('FOCUS') }).message, '몰입');
  assert.equal(resolveAt(`${D} 10:00`, { stored: at('OFFLINE') }).status, 'OFFLINE');
});

test('어제 직접 정한 상태는 오늘 적용되지 않는다', () => {
  const stored = { status: 'FOCUS' as const, message: '', updatedAt: kst('2026-10-01 15:00').toISOString(), lastSeenAt: kst(`${D} 09:59`).toISOString() };
  assert.equal(resolveAt(`${D} 10:00`, { stored }).status, 'ONLINE');
});

// ── 자리비움 (창은 열려 있으나 키보드·마우스 입력이 20분 없음) ──

const open = (activeAt: string | null, status: 'ONLINE' | 'FOCUS' | 'AWAY' | 'OUTSIDE' | 'MEETING' | 'LEAVE' = 'ONLINE', setAt = `${D} 07:00`) => ({
  status,
  message: '',
  updatedAt: kst(setAt).toISOString(),
  lastSeenAt: kst(`${D} 09:59`).toISOString(),
  lastActiveAt: activeAt ? kst(activeAt).toISOString() : null,
});

test('창이 열려 있고 20분 안에 입력이 있으면 업무중, 20분 넘게 없으면 자리비움이다', () => {
  assert.equal(resolveAt(`${D} 10:00`, { stored: open(`${D} 09:41`) }).status, 'ONLINE');
  assert.equal(resolveAt(`${D} 10:00`, { stored: open(`${D} 09:39`) }).status, 'AWAY');
});

test('활동 기록이 없는 예전 클라이언트는 창이 열려 있으면 업무중으로 본다', () => {
  assert.equal(resolveAt(`${D} 10:00`, { stored: open(null) }).status, 'ONLINE');
});

test('직접 고른 업무중도 입력이 20분 없으면 자리비움이다', () => {
  assert.equal(resolveAt(`${D} 10:00`, { stored: open(`${D} 09:30`, 'ONLINE', `${D} 09:00`) }).status, 'AWAY');
});

test('직접 고른 자리비움·집중근무는 창이 열려 있을 때만 보이고 창을 닫으면 오프라인이다', () => {
  assert.equal(resolveAt(`${D} 10:00`, { stored: open(`${D} 09:59`, 'AWAY', `${D} 09:00`) }).status, 'AWAY');
  const closed = { ...open(`${D} 09:00`, 'FOCUS', `${D} 08:50`), lastSeenAt: kst(`${D} 09:00`).toISOString() };
  assert.equal(resolveAt(`${D} 10:00`, { stored: closed }).status, 'OFFLINE');
});

test('외근·회의중·휴가는 직접 설정으로 인정하지 않는다 (결재·캘린더로만 정해짐)', () => {
  for (const status of ['OUTSIDE', 'MEETING', 'LEAVE'] as const) {
    assert.equal(resolveAt(`${D} 10:00`, { stored: open(`${D} 09:59`, status, `${D} 09:00`) }).status, 'ONLINE');
  }
});
