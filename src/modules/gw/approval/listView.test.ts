import assert from 'node:assert/strict';
import test from 'node:test';
import { approvalDocSchema, type ApprovalDoc } from '@/domain/approvalDoc/schema';
import { arrangeList, docPosition } from './listView';

const doc = (id: string, submittedAt: string | null, createdAt = '2026-09-01T00:00:00Z'): ApprovalDoc =>
  approvalDocSchema.parse({ id, docNo: `NO-${id}`, docType: '기안', title: id, drafterId: 'U011', submittedAt, createdAt });

const A = doc('A', '2026-09-10T09:00:00Z');
const B = doc('B', '2026-09-12T09:00:00Z');
const C = doc('C', null, '2026-09-11T09:00:00Z'); // 상신 전(임시)은 작성 시각 기준

test('최신순은 상신(없으면 작성) 시각이 늦은 문서가 먼저다', () => {
  assert.deepEqual(arrangeList([A, B, C], { order: 'recent', unreadOnly: false, isUnread: () => false }).map((d) => d.id), ['B', 'C', 'A']);
});

test('오래된순은 반대다', () => {
  assert.deepEqual(arrangeList([A, B, C], { order: 'oldest', unreadOnly: false, isUnread: () => false }).map((d) => d.id), ['A', 'C', 'B']);
});

test('안읽음만 보기는 안읽은 문서만 남긴다', () => {
  const r = arrangeList([A, B, C], { order: 'recent', unreadOnly: true, isUnread: (id) => id !== 'B' });
  assert.deepEqual(r.map((d) => d.id), ['C', 'A']);
});

test('원본 목록 배열을 바꾸지 않는다', () => {
  const list = [A, B, C];
  arrangeList(list, { order: 'oldest', unreadOnly: false, isUnread: () => false });
  assert.deepEqual(list.map((d) => d.id), ['A', 'B', 'C']);
});

test('이전/다음 문서와 현재 위치는 지금 보이는 목록 순서를 따른다 (id·문서번호 모두로 찾음)', () => {
  const list = [B, C, A];
  assert.deepEqual(docPosition(list, 'C'), { index: 2, total: 3, prevId: 'B', nextId: 'A' });
  assert.deepEqual(docPosition(list, 'NO-B'), { index: 1, total: 3, prevId: null, nextId: 'C' });
  assert.deepEqual(docPosition(list, 'A'), { index: 3, total: 3, prevId: 'C', nextId: null });
});

test('열린 문서가 지금 목록에 없으면(다른 결재함으로 이동 등) 위치 없이 이전/다음도 없다', () => {
  assert.deepEqual(docPosition([A, B], 'Z'), { index: 0, total: 2, prevId: null, nextId: null });
});
