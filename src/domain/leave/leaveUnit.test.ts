import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateLeaveDays, effectiveLeaveKind } from './policy';
import { normalizeLegacyLeaveDoc } from './legacyAdapter';
import type { ApprovalDoc } from '@/domain/approvalDoc/schema';

test('대체휴무 단위 — 반차 0.5·반반차 0.25·종일은 기간 일수', () => {
  assert.equal(calculateLeaveDays({ leaveType: '대체휴무', leaveUnit: '오전반차', rawDays: 1 }), 0.5);
  assert.equal(calculateLeaveDays({ leaveType: '대체휴무', leaveUnit: '반반차', rawDays: 1 }), 0.25);
  assert.equal(calculateLeaveDays({ leaveType: '대체휴무', leaveUnit: '종일', rawDays: 2 }), 2);
  assert.equal(calculateLeaveDays({ leaveType: '대체휴무', rawDays: 1 }), 1);
  assert.equal(effectiveLeaveKind('대체휴무', '오후반차'), '오후반차');
  assert.equal(effectiveLeaveKind('대체휴무', '종일'), '대체휴무');
  assert.equal(effectiveLeaveKind('연차', undefined), '연차');
});

test('휴가 문서 정규화 — 대체휴무 종류는 그대로, 단위·시간대는 반차', () => {
  const doc = {
    id: 'L1', docNo: 'AP-1', docType: '휴가', status: '완료', drafterId: 'U1', title: '휴가 신청서', body: '',
    form: { leaveType: '대체휴무', startDate: '2026-11-16', endDate: '2026-11-16', days: 1 },
    fieldValues: { leaveUnit: '오전반차' },
  } as unknown as ApprovalDoc;
  const r = normalizeLegacyLeaveDoc(doc)!;
  assert.equal(r.leaveType, '대체휴무');
  assert.equal(r.leaveUnit, '오전반차');
  assert.equal(r.days, 0.5);
  assert.equal(r.startTime, '08:30');
  assert.equal(r.endTime, '13:30'); // 반차 부재 5시간(점심 포함)
});
