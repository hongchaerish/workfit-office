import assert from 'node:assert/strict';
import test from 'node:test';
import { matchesBox } from './engine';
import { approvalDocSchema, type ApprovalDoc } from './schema';

const mk = (over: Partial<ApprovalDoc> = {}): ApprovalDoc =>
  approvalDocSchema.parse({
    id: 'D1', docNo: 'D1', docType: '기안', title: '문서', drafterId: 'DR', status: '완료',
    steps: [{ seq: 1, kind: '결재', approverId: 'AP', decision: '승인' }],
    ...over,
  });

test('후열: 전달받은 완료 문서는 매칭', () => {
  assert.equal(matchesBox(mk(), 'U1', '후열', undefined, undefined, new Set(['D1'])), true);
});

test('후열: 전달받았어도 진행중·삭제 문서는 매칭 안 됨', () => {
  assert.equal(matchesBox(mk({ status: '진행중' }), 'U1', '후열', undefined, undefined, new Set(['D1'])), false);
  assert.equal(matchesBox(mk({ status: '삭제' }), 'U1', '후열', undefined, undefined, new Set(['D1'])), false);
});

test('후열: 인자 없이도 대결 원결재자는 기존처럼 매칭, 전달 건은 미매칭', () => {
  const delegated = mk({ steps: [{ seq: 1, kind: '결재', approverId: 'PX', delegatedFromId: 'U1', decision: '승인' }] as ApprovalDoc['steps'] });
  assert.equal(matchesBox(delegated, 'U1', '후열'), true);
  assert.equal(matchesBox(mk(), 'U1', '후열'), false);
});

test('다른 함은 postReadDocIds 영향을 받지 않는다', () => {
  const ids = new Set(['D1']);
  assert.equal(matchesBox(mk(), 'U1', '참조', undefined, undefined, ids), false);
  assert.equal(matchesBox(mk(), 'U1', '완료', undefined, undefined, ids), matchesBox(mk(), 'U1', '완료'));
});
