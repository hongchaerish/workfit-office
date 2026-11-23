import test from 'node:test';
import assert from 'node:assert/strict';
import { currentLeaveYear, evaluateAdvanceLeaveOffset } from './accrualEngine';
import { calculateUserLeaveBalance } from './userLeaveBalance';
import type { ApprovalDoc } from '@/domain/approvalDoc/schema';

const leave = (id: string, leaveType: string, startDate: string, endDate = startDate, status = '완료') =>
  ({
    id,
    docNo: id,
    docType: '휴가',
    drafterId: 'U1',
    drafterName: '홍길동',
    title: `${leaveType} 신청`,
    status,
    form: { leaveType, startDate, endDate },
    createdAt: `${startDate}T00:00:00Z`,
  }) as unknown as ApprovalDoc;

// 입사 1년이 지난 직원 — 첫해에 쓴 휴가 6.5일, 2년차 연차 기간에 쓴(예정) 반반차 0.25일
const docs = [
  leave('a', '오전반차', '2026-10-01'),
  leave('b', '연차', '2026-10-19', '2026-10-23'),
  leave('c', '오후반차', '2026-11-05'),
  leave('d', '오후반차', '2026-11-11'),
  leave('e', '반반차', '2026-11-26'),
];
const user = { userId: 'U1', name: '홍길동', hireDate: '2025-11-17' };
const at = (d: string) => new Date(`${d}T12:00:00Z`);

test('입사일 기준 연차 기간 — 1년 미만은 입사일부터, 1년이 지나면 입사 기념일부터 1년', () => {
  assert.deepEqual(currentLeaveYear('2025-11-17', '2026-11-16', 'HIRE_DATE'), { start: '2025-11-17', end: '2026-11-16' });
  assert.deepEqual(currentLeaveYear('2025-11-17', '2026-11-17', 'HIRE_DATE'), { start: '2026-11-17', end: '2027-11-16' });
  assert.deepEqual(currentLeaveYear('2020-03-01', '2026-02-28', 'HIRE_DATE'), { start: '2025-03-01', end: '2026-02-28' });
  assert.deepEqual(currentLeaveYear('2024-02-29', '2025-03-01', 'HIRE_DATE'), { start: '2025-02-28', end: '2026-02-27' });
});

test('회계연도 기준 연차 기간 — 그해 1월 1일부터 12월 31일', () => {
  assert.deepEqual(currentLeaveYear('2025-11-17', '2026-11-23', 'FISCAL_YEAR'), { start: '2026-01-01', end: '2026-12-31' });
});

test('입사 1년이 지나면 선사용으로 보지 않는다', () => {
  const r = evaluateAdvanceLeaveOffset('2025-11-17', '2026-11-23', 6.75);
  assert.equal(r.isAdvanceUsed, false);
  assert.equal(r.offsetRemainingDays, 0);
  assert.equal(r.estimatedFullOffsetDate, null);
});

test('1년 미만에 발생분보다 더 쓰면 여전히 선사용이다', () => {
  const r = evaluateAdvanceLeaveOffset('2026-09-01', '2026-11-23', 5);
  assert.equal(r.isAdvanceUsed, true);
  assert.equal(r.currentAccrued, 2);
  assert.equal(r.offsetRemainingDays, 3);
});

test('1년 미만 — 첫해 연차 기간 안의 사용만 월별 발생분에서 뺀다', () => {
  const b = calculateUserLeaveBalance({ user, approvalDocs: docs, referenceDate: at('2026-11-16') });
  assert.deepEqual(b.leaveYear, { start: '2025-11-17', end: '2026-11-16' });
  assert.equal(b.entitledDays, 11);
  assert.equal(b.usedDays, 6.5); // 11/26 반반차는 다음 연차 기간 몫
  assert.equal(b.remainingDays, 4.5);
  assert.equal(b.advanceStatus.isAdvanceUsed, false);
});

test('1년이 지나면 새로 생긴 15일에서 그 기간의 사용만 뺀다 — 첫해 사용분은 빼지 않는다', () => {
  const b = calculateUserLeaveBalance({ user, approvalDocs: docs, referenceDate: at('2026-11-23') });
  assert.deepEqual(b.leaveYear, { start: '2026-11-17', end: '2027-11-16' });
  assert.equal(b.entitledDays, 15);
  assert.equal(b.usedDays, 0.25);
  assert.equal(b.remainingDays, 14.75);
  assert.equal(b.advanceStatus.isAdvanceUsed, false);
  // 내역에는 지난 기간 사용도 그대로 남는다
  assert.equal(b.leaveHistory.length, 5);
});

test('결재 진행 중도 그 연차 기간 것만 신청중으로 센다', () => {
  const withPending = [...docs, leave('p1', '연차', '2026-11-12', '2026-11-12', '진행중'), leave('p2', '연차', '2026-12-01', '2026-12-01', '진행중')];
  const b = calculateUserLeaveBalance({ user, approvalDocs: withPending, referenceDate: at('2026-11-23') });
  assert.equal(b.pendingDays, 1);
});

test('수동 조정도 그 연차 기간에 등록한 것만 더한다', () => {
  const adj = (grantedAt: string, deltaDays: number) => ({
    id: grantedAt, empName: '홍길동', type: 'REWARD' as const, deltaDays, reason: '', grantedAt, grantedBy: '관리자', createdAt: '2026-11-23T00:00:00Z',
  });
  const b = calculateUserLeaveBalance({
    user,
    approvalDocs: docs,
    adjustments: [adj('2026-06-01', 2), adj('2026-11-20', 1)],
    referenceDate: at('2026-11-23'),
  });
  assert.equal(b.adjustedDays, 1);
  assert.equal(b.adjustmentHistory.length, 2);
});
