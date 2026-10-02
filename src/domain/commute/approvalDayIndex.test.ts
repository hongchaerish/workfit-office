import assert from 'node:assert/strict';
import test from 'node:test';
import { approvalDocSchema, type ApprovalDoc } from '@/domain/approvalDoc/schema';
import { buildApprovalDayIndex } from './approvalDayIndex';

function doc(over: Partial<ApprovalDoc> & Pick<ApprovalDoc, 'id' | 'docType'>): ApprovalDoc {
  return approvalDocSchema.parse({
    docNo: over.id,
    title: `${over.docType} 신청`,
    drafterId: 'U010',
    drafterName: '박광래',
    status: '완료',
    ...over,
  });
}

test('완료된 외근 문서는 기안자 id로 해당 날짜에 연결된다', () => {
  const index = buildApprovalDayIndex([
    doc({ id: 'AP-1', docType: '외근', fieldValues: { period: '2026-09-17', period__end: '2026-09-17' } }),
  ]);
  const days = index.lookup({ id: 'U010' });
  assert.deepEqual(days.get('2026-09-17')?.map((e) => e.category), ['OUTSIDE']);
});

test('완료되지 않은 문서는 연결하지 않는다', () => {
  const index = buildApprovalDayIndex([
    doc({ id: 'AP-1', docType: '외근', status: '반려', fieldValues: { period: '2026-09-17' } }),
  ]);
  assert.equal(index.lookup({ id: 'U010' }).size, 0);
});

test('출장 기간의 모든 날짜에 연결된다', () => {
  const index = buildApprovalDayIndex([
    doc({ id: 'AP-1', docType: '국내출장', fieldValues: { period: '2026-09-11', period__end: '2026-09-15' } }),
  ]);
  assert.deepEqual(
    [...index.lookup({ id: 'U010' }).keys()].sort(),
    ['2026-09-11', '2026-09-12', '2026-09-13', '2026-09-14', '2026-09-15'],
  );
});

test('같은 날의 결재 여러 건을 모두 보존한다 (외근 + 오전반차)', () => {
  const index = buildApprovalDayIndex([
    doc({ id: 'AP-1', docType: '외근', fieldValues: { period: '2026-09-17' } }),
    doc({
      id: 'AP-2',
      docType: '휴가',
      form: { leaveType: '오전반차', startDate: '2026-09-17', endDate: '2026-09-17', days: 0.5 },
    }),
  ]);
  const entries = index.lookup({ id: 'U010' }).get('2026-09-17') ?? [];
  assert.deepEqual(entries.map((e) => e.docId).sort(), ['AP-1', 'AP-2']);
});

test('id로 묶인 결재와 이름으로만 묶인 결재를 합친다', () => {
  const index = buildApprovalDayIndex([
    doc({ id: 'AP-1', docType: '외근', fieldValues: { period: '2026-09-02' } }),
    // 계정 이관 등으로 기안자 id가 다른 문서 — 이름으로만 연결된다
    doc({ id: 'AP-2', docType: '외근', drafterId: 'OLD-7', fieldValues: { period: '2026-09-22' } }),
  ]);
  const days = index.lookup({ id: 'U010', name: '박광래' });
  assert.deepEqual([...days.keys()].sort(), ['2026-09-02', '2026-09-22']);
});

test('같은 문서가 id와 이름 양쪽으로 잡혀도 한 번만 들어간다', () => {
  const index = buildApprovalDayIndex([
    doc({ id: 'AP-1', docType: '외근', fieldValues: { period: '2026-09-17' } }),
  ]);
  const entries = index.lookup({ id: 'U010', name: '박 광래' }).get('2026-09-17') ?? [];
  assert.equal(entries.length, 1);
});

test('반반차는 결재의 슬롯을 보존한다 (fieldValues.quarterSlot 우선, 없으면 시작 시각으로 추정)', () => {
  const index = buildApprovalDayIndex([
    doc({
      id: 'AP-1',
      docType: '휴가',
      form: { leaveType: '반반차', startDate: '2026-09-18', endDate: '2026-09-18', days: 0.25 },
      fieldValues: { quarterSlot: 'AM1' },
    }),
    doc({
      id: 'AP-2',
      docType: '휴가',
      form: { leaveType: '반반차', startDate: '2026-09-19', endDate: '2026-09-19', startTime: '13:30', endTime: '15:30', days: 0.25 },
    }),
  ]);
  const days = index.lookup({ id: 'U010' });
  assert.equal(days.get('2026-09-18')?.[0].quarterSlot, 'AM1');
  assert.equal(days.get('2026-09-19')?.[0].quarterSlot, 'PM1');
});
