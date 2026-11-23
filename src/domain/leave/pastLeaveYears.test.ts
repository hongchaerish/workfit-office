import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePastLeaveYears } from './userLeaveBalance';
import type { ApprovalDoc } from '@/domain/approvalDoc/schema';

const leave = (id: string, leaveType: string, startDate: string, endDate = startDate, drafterId = 'U1', drafterName = '홍길동') =>
  ({
    id,
    docNo: id,
    docType: '휴가',
    drafterId,
    drafterName,
    title: `${leaveType} 신청`,
    status: '완료',
    form: { leaveType, startDate, endDate },
    createdAt: `${startDate}T00:00:00Z`,
  }) as unknown as ApprovalDoc;

const docs = [
  leave('a', '오전반차', '2026-10-01'),
  leave('b', '연차', '2026-10-19', '2026-10-23'),
  leave('c', '오후반차', '2026-11-05'),
  leave('d', '오후반차', '2026-11-11'),
  leave('e', '반반차', '2026-11-26'),
];
const at = (d: string) => new Date(`${d}T12:00:00Z`);

test('지난 연차 기간 — 첫해 발생 11일, 그 기간 사용 6.5일, 소멸 4.5일', () => {
  const past = calculatePastLeaveYears({ user: { userId: 'U1', name: '홍길동', hireDate: '2025-11-17' }, approvalDocs: docs, referenceDate: at('2026-11-23') });
  assert.equal(past.length, 1);
  assert.deepEqual(past[0], { start: '2025-11-17', end: '2026-11-16', grantedDays: 11, adjustedDays: 0, usedDays: 6.5, expiredDays: 4.5, overUsedDays: 0, beforeRecords: true });
});

test('휴가 기록이 시작된 뒤에 시작한 기간은 기록 이전 표시가 없다', () => {
  const early = [leave('z', '연차', '2025-01-10'), ...docs];
  const past = calculatePastLeaveYears({ user: { userId: 'U1', name: '홍길동', hireDate: '2025-11-17' }, approvalDocs: early, referenceDate: at('2026-11-23') });
  assert.equal(past[0].beforeRecords, false);
});

test('지금 기간이 첫 기간이면 지난 기간은 없다', () => {
  assert.deepEqual(calculatePastLeaveYears({ user: { userId: 'U1', name: '홍길동', hireDate: '2026-02-01' }, approvalDocs: docs, referenceDate: at('2026-11-23') }), []);
});

test('휴가 기록이 생기기 전에 끝난 기간은 빼고, 최근 기간부터 보여 준다', () => {
  // 2019년 입사 — 시스템 기록(가장 이른 휴가 2026-10-01) 전에 끝난 기간은 기록이 없어 전부 소멸로 보이므로 뺀다
  const past = calculatePastLeaveYears({ user: { userId: 'U1', name: '홍길동', hireDate: '2019-03-01' }, approvalDocs: docs, referenceDate: at('2027-04-01') });
  assert.deepEqual(past.map((p) => p.start), ['2026-03-01']);
  assert.equal(past[0].usedDays, 6.75);
});

test('지난 기간에 더 쓴 일수는 소멸 0, 초과로 따로 보인다', () => {
  const many = [leave('x', '연차', '2026-10-05', '2026-10-30')];
  const past = calculatePastLeaveYears({ user: { userId: 'U1', name: '홍길동', hireDate: '2025-11-17' }, approvalDocs: many, referenceDate: at('2026-11-23') });
  assert.equal(past[0].expiredDays, 0);
  assert.ok(past[0].overUsedDays > 0);
});

test('회계연도 기준 — 지난해 1~12월(입사한 해는 입사일부터)', () => {
  const past = calculatePastLeaveYears({
    user: { userId: 'U1', name: '홍길동', hireDate: '2025-11-17' },
    approvalDocs: [leave('y', '연차', '2025-12-26'), ...docs],
    referenceDate: at('2026-11-23'),
    mode: 'FISCAL_YEAR',
  });
  assert.deepEqual(past.map((p) => [p.start, p.end, p.usedDays]), [['2025-11-17', '2025-12-31', 1]]);
});
