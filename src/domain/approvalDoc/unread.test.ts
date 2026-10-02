import assert from 'node:assert/strict';
import test from 'node:test';
import { approvalDocSchema, APPROVAL_BOXES, type ApprovalBox, type ApprovalDoc } from './schema';
import type { ApprovalPostReadShare } from '@/domain/approvalPostRead/schema';
import { baselineReadDocIds, isDocRead, unreadByBox } from './unread';

const me = 'U012';
const doc = (id: string, over: Partial<ApprovalDoc> = {}): ApprovalDoc =>
  approvalDocSchema.parse({ id, docNo: id, docType: '기안', title: id, drafterId: 'U011', status: '진행중', ...over });

const boxes = (fill: Partial<Record<ApprovalBox, ApprovalDoc[]>>) =>
  Object.fromEntries(APPROVAL_BOXES.map((b) => [b, fill[b] ?? []])) as Record<ApprovalBox, ApprovalDoc[]>;

const share = (docId: string, readAt: string | null): ApprovalPostReadShare =>
  ({ id: `prs-${docId}`, docId, docNo: '', docTitle: '', fromUserId: 'U011', fromUserName: '', toUserId: me, toUserName: '', toUserDept: '', memo: '', sentAt: '2026-10-01T00:00:00Z', readAt });

// ── 읽음 판정 ──

test('한 번이라도 열어본 문서는 읽음이다', () => {
  assert.equal(isDocRead(doc('A'), me, new Set(['A']), []), true);
  assert.equal(isDocRead(doc('B'), me, new Set(['A']), []), false);
});

test('예전 후열 공유 기록(readAt)이나 결재선 후열 처리(postReadAt)가 있으면 읽음이다', () => {
  assert.equal(isDocRead(doc('C'), me, new Set(), [share('C', '2026-10-01T09:00:00Z')]), true);
  assert.equal(isDocRead(doc('C'), me, new Set(), [share('C', null)]), false);
  const withStep = doc('D', {
    steps: [{ seq: 1, kind: '결재', approverId: 'U020', approverName: '', delegatedFromId: me, decision: '승인', postReadAt: '2026-10-01T10:00:00Z' } as never],
  });
  assert.equal(isDocRead(withStep, me, new Set(), []), true);
});

// ── 결재함별 안읽음 ──

test('대기·참조·수신·반려·후열함의 안읽음 문서와 개수를 돌려준다', () => {
  const byBox = boxes({ 대기: [doc('A'), doc('B')], 참조: [doc('C')], 수신: [doc('D')], 반려: [doc('E')], 후열: [doc('F')], 상신: [doc('G')] });
  const r = unreadByBox(byBox, me, new Set(['A', 'C']), []);
  assert.deepEqual([...r.대기.ids], ['B']);
  assert.equal(r.대기.count, 1);
  assert.equal(r.참조.count, 0);
  assert.equal(r.수신.count, 1);
  assert.equal(r.반려.count, 1);
  assert.equal(r.후열.count, 1);
});

test('상신함·완료함·임시함은 안읽음을 세지 않는다', () => {
  const r = unreadByBox(boxes({ 상신: [doc('G')], 완료: [doc('H')], 임시: [doc('I')] }), me, new Set(), []);
  assert.equal('상신' in r, false);
  assert.equal('완료' in r, false);
  assert.equal('임시' in r, false);
});

// ── 처음 적용할 때의 기준선 ──

test('처음 적용할 때 대기·참조·수신함의 기존 문서와 브라우저에 남은 반려 열람 기록을 읽음으로 남긴다', () => {
  const byBox = boxes({ 대기: [doc('A')], 참조: [doc('C')], 수신: [doc('D')], 반려: [doc('E'), doc('E2')], 후열: [doc('F')] });
  assert.deepEqual(baselineReadDocIds(byBox, new Set(['E'])).sort(), ['A', 'C', 'D', 'E']);
});
