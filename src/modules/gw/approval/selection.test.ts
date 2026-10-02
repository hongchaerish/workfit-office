import assert from 'node:assert/strict';
import test from 'node:test';
import { approvalDocSchema, type ApprovalDoc } from '@/domain/approvalDoc/schema';
import { correctSelection, resolveSelectedDoc } from './selection';

const doc = (id: string): ApprovalDoc =>
  approvalDocSchema.parse({ id, docNo: `NO-${id}`, docType: '기안', title: id, drafterId: 'U011' });
const A = doc('A');
const B = doc('B');

test('선택한 문서가 없으면 아무 문서도 열지 않는다 (첫 문서 자동 선택 없음)', () => {
  assert.equal(resolveSelectedDoc(null, [A, B], [A, B]), null);
  assert.equal(correctSelection(null, [A, B]), null);
});

test('선택한 문서는 id나 문서번호로 찾는다 — 목록에서 빠졌어도 전체 문서에 있으면 계속 보여준다', () => {
  assert.equal(resolveSelectedDoc('B', [A], [A, B]), B); // 결재해서 대기함에서 빠진 경우
  assert.equal(resolveSelectedDoc('NO-A', [A], [A, B]), A);
});

test('선택한 문서가 아예 사라지면 다음 문서를 열지 않고 선택을 비운다', () => {
  assert.equal(correctSelection('Z', [A, B]), null);
});

test('문서 목록을 아직 불러오기 전에는 선택을 건드리지 않는다', () => {
  assert.equal(correctSelection('Z', []), 'Z');
});
