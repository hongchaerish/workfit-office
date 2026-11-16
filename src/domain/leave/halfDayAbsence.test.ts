import assert from 'node:assert/strict';
import test from 'node:test';
import { approvalDocSchema, type ApprovalDoc } from '@/domain/approvalDoc/schema';
import { extractScheduleInfo } from '@/domain/approvalDoc/scheduleEngine';
import { getDefaultTimeWindow, halfDayAbsenceRange } from './policy';
import { normalizeLegacyLeaveDoc } from './legacyAdapter';

test('반차 부재 시각 — 점심 1시간 포함 5시간: 오전 08:30~13:30, 오후 12:30~17:30', () => {
  assert.deepEqual(getDefaultTimeWindow('오전반차'), { startTime: '08:30', endTime: '13:30' });
  assert.deepEqual(getDefaultTimeWindow('오후반차'), { startTime: '12:30', endTime: '17:30' });
});

test('예전 결재 문서(4시간으로 적힘)는 점심 쪽으로 1시간 넓혀 읽는다 — 문서는 고치지 않는다', () => {
  assert.deepEqual(halfDayAbsenceRange('오후반차', '13:30', '17:30'), { startTime: '12:30', endTime: '17:30' });
  assert.deepEqual(halfDayAbsenceRange('오전반차', '08:30', '12:30'), { startTime: '08:30', endTime: '13:30' });
});

test('새 문서(이미 5시간)·반차 아닌 휴가·시각 없음은 그대로', () => {
  assert.deepEqual(halfDayAbsenceRange('오후반차', '12:30', '17:30'), { startTime: '12:30', endTime: '17:30' });
  assert.deepEqual(halfDayAbsenceRange('반반차', '13:30', '15:30'), { startTime: '13:30', endTime: '15:30' });
  assert.deepEqual(halfDayAbsenceRange('연차', '08:30', '17:30'), { startTime: '08:30', endTime: '17:30' });
  assert.deepEqual(halfDayAbsenceRange('오후반차', undefined, undefined), { startTime: undefined, endTime: undefined });
});

const leaveDoc = (form: Record<string, unknown>, fieldValues: Record<string, unknown> = {}): ApprovalDoc =>
  approvalDocSchema.parse({ id: 'AP-1', docNo: 'AP-1', docType: '휴가', title: '휴가 신청', drafterId: 'U1', status: '완료', form, fieldValues });

test('업무계획·캘린더가 읽는 결재 일정 — 예전 오후반차 문서도 12:30부터', () => {
  const old = extractScheduleInfo(leaveDoc({ leaveType: '오후반차', startDate: '2026-11-16', endDate: '2026-11-16', startTime: '13:30', endTime: '17:30', days: 0.5 }))!;
  assert.equal(old.startTime, '12:30');
  assert.equal(old.endTime, '17:30');
  assert.equal(old.days, 0.5);
  const comp = extractScheduleInfo(leaveDoc({ leaveType: '대체휴무', startDate: '2026-11-16', endDate: '2026-11-16', startTime: '13:30', endTime: '17:30', days: 0.5 }, { leaveUnit: '오후반차' }))!;
  assert.equal(comp.startTime, '12:30');
  const quarter = extractScheduleInfo(leaveDoc({ leaveType: '반반차', startDate: '2026-11-16', endDate: '2026-11-16', startTime: '13:30', endTime: '15:30', days: 0.25 }))!;
  assert.equal(quarter.startTime, '13:30');
});

test('휴가 잔여 계산의 문서 정리 — 예전 오후반차 문서도 12:30~17:30, 사용은 0.5일', () => {
  const r = normalizeLegacyLeaveDoc(leaveDoc({ leaveType: '오후반차', startDate: '2026-11-16', endDate: '2026-11-16', startTime: '13:30', endTime: '17:30', days: 0.5 }))!;
  assert.equal(r.startTime, '12:30');
  assert.equal(r.endTime, '17:30');
  assert.equal(r.days, 0.5);
});
