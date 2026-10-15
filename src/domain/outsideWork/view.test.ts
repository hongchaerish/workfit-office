import assert from 'node:assert/strict';
import test from 'node:test';
import type { StandardScheduleInfo } from '@/domain/approvalDoc/scheduleEngine';
import { outsideWorkSchema } from './schema';
import { fromApprovalSchedule, fromOutsideWork, overlapsRange } from './view';

const now = new Date().toISOString();

test('결재 완료 외근은 결재 출처로 변환되고 휴가는 제외된다', () => {
  const s: StandardScheduleInfo = {
    category: 'OUTSIDE', docType: '외근', docId: 'AP-1', docNo: 'D-1', docTitle: '외근 신청',
    drafterId: 'U010', drafterName: '박광래', startDate: '2026-10-20', endDate: '2026-10-20',
    startTime: '13:00', endTime: '17:00', days: 1, subType: '오후 외근', destination: 'OO전자',
    emergencyContact: '010-0000-0000',
  };
  const v = fromApprovalSchedule(s);
  assert.equal(v?.source, 'APPROVAL');
  assert.equal(v?.approval?.docId, 'AP-1');
  assert.equal(v?.contact, '010-0000-0000');
  assert.equal(fromApprovalSchedule({ ...s, category: 'LEAVE' }), null);
});

test('직접 등록은 동행자 id를 이름으로 바꾼다', () => {
  const w = outsideWorkSchema.parse({
    id: 'OW-20261020-0001', ownerUserId: 'U010', category: 'OUTSIDE', subType: '종일 외근',
    startDate: '2026-10-20', endDate: '2026-10-20', allDay: true, startTime: null, endTime: null,
    destination: 'OO전자', companionUserIds: ['U011', 'U999'], createdAt: now, updatedAt: now,
  });
  const v = fromOutsideWork(w, (id) => (id === 'U011' ? '김철수' : id === 'U010' ? '박광래' : undefined));
  assert.equal(v.source, 'SELF');
  assert.equal(v.companions, '김철수, U999');
  assert.equal(v.ownerName, '박광래');
  assert.equal(v.self?.id, w.id);
});

test('기간 겹침 판정', () => {
  assert.equal(overlapsRange({ startDate: '2026-09-28', endDate: '2026-10-02' }, '2026-10-01', '2026-10-31'), true);
  assert.equal(overlapsRange({ startDate: '2026-11-01', endDate: '2026-11-02' }, '2026-10-01', '2026-10-31'), false);
});
