import assert from 'node:assert/strict';
import test from 'node:test';
import { approvalDocSchema, type ApprovalDoc } from './schema';
import { isDeptArchiveDoc, matchesSearchQuery, resolveDocBox, searchApprovalDocs, searchScopeDocs } from './search';

const me = 'U012';
const doc = (id: string, over: Partial<ApprovalDoc> = {}): ApprovalDoc =>
  approvalDocSchema.parse({ id, docNo: id, docType: '기안', title: id, drafterId: 'U011', status: '진행중', ...over });
const step = (over: Record<string, unknown>) =>
  ({ seq: 1, kind: '결재', approverId: 'U020', decision: '대기', ...over }) as never;

// ── 검색어 일치 ──

test('제목 일부로 찾고, 대소문자·띄어쓰기는 가리지 않는다', () => {
  const d = doc('A', { title: '10월 휴가신청서 (VPN)' });
  assert.equal(matchesSearchQuery(d, '휴가'), true);
  assert.equal(matchesSearchQuery(d, '휴가 신청'), true);
  assert.equal(matchesSearchQuery(d, 'vpn'), true);
  assert.equal(matchesSearchQuery(d, '출장'), false);
});

test('자모가 분리된(NFD) 한글 제목도 찾는다', () => {
  const d = doc('A', { title: '휴가신청'.normalize('NFD') });
  assert.equal(matchesSearchQuery(d, '휴가'), true);
});

test('여러 낱말은 제목·기안자·문서번호 어디에 있든 모두 들어 있어야 일치한다', () => {
  const d = doc('A', { title: '출장 보고', drafterName: '홍길동', docNo: 'WF-2026-001' });
  assert.equal(matchesSearchQuery(d, '홍길동 출장'), true);
  assert.equal(matchesSearchQuery(d, 'wf-2026'), true);
  assert.equal(matchesSearchQuery(d, '홍길동 휴가'), false);
  assert.equal(matchesSearchQuery(d, '   '), true);
});

// ── 부서 문서함 ──

test('부서 문서함은 같은 부서의 결재 완료·공개 문서만이다', () => {
  const my = { deptId: 'D1', deptName: '개발팀' };
  const none = () => '';
  assert.equal(isDeptArchiveDoc(doc('A', { status: '완료', drafterDeptId: 'D1' }), my, none), true);
  assert.equal(isDeptArchiveDoc(doc('B', { status: '진행중', drafterDeptId: 'D1' }), my, none), false);
  assert.equal(isDeptArchiveDoc(doc('C', { status: '완료', drafterDeptId: 'D1', visibility: '비공개' }), my, none), false);
  assert.equal(isDeptArchiveDoc(doc('D', { status: '완료', drafterDeptId: 'D2' }), my, none), false);
  // 부서 id 가 없는 과거 문서 — 기안자 현재 부서, 그것도 없으면 부서명으로
  assert.equal(isDeptArchiveDoc(doc('E', { status: '완료', drafterDeptId: '' }), my, () => 'D1'), true);
  assert.equal(isDeptArchiveDoc(doc('F', { status: '완료', drafterDeptId: '', drafterDept: '개발팀' }), my, none), true);
});

// ── 검색 범위 ──

test("'전체'는 모든 결재함과 부서 문서함을 합치고, 삭제함과 중복은 뺀다", () => {
  const a = doc('A', { title: '휴가 A' });
  const b = doc('B', { title: '휴가 B' });
  const del = doc('X', { title: '휴가 삭제', status: '삭제' });
  const archive = doc('Z', { title: '휴가 동료', status: '완료' });
  const byBox = { 대기: [a], 참조: [a, b], 삭제: [del] };
  const ids = searchScopeDocs('all', byBox, [archive]).map((d) => d.id).sort();
  assert.deepEqual(ids, ['A', 'B', 'Z']);
  assert.deepEqual(searchScopeDocs('삭제', byBox, []).map((d) => d.id), ['X']);
});

test('부서 문서함을 고르면 부서 문서만, 결재함을 고르면 그 함 문서만 찾는다', () => {
  const byBox = { 대기: [doc('A', { title: '휴가' })] };
  const archive = [doc('Z', { title: '휴가', status: '완료' })];
  assert.deepEqual(searchApprovalDocs('휴가', '문서함', byBox, archive).map((d) => d.id), ['Z']);
  assert.deepEqual(searchApprovalDocs('휴가', '대기', byBox, archive).map((d) => d.id), ['A']);
  assert.deepEqual(searchApprovalDocs('휴가', '수신', byBox, archive), []);
});

// ── 결과 클릭 시 열 함 ──

test('완료 문서는 기안·승인했으면 완료함, 수신·참조로만 받았으면 수신함·참조함, 아니면 부서 문서함', () => {
  assert.equal(resolveDocBox(doc('A', { status: '완료', drafterId: me }), me).box, '완료');
  const received = doc('B', { status: '완료', recipients: [{ type: 'user', id: me, name: '' }] as never });
  assert.equal(resolveDocBox(received, me).box, '수신');
  const ref = doc('C', { status: '완료', steps: [step({ kind: '참조', approverId: me })] });
  assert.equal(resolveDocBox(ref, me).box, '참조');
  assert.equal(resolveDocBox(doc('D', { status: '완료' }), me).box, '문서함');
});

test('진행중 문서는 내 차례면 결재대기, 내가 기안했으면 상신함(진행중 필터)', () => {
  const todo = doc('A', { status: '진행중', currentSeq: 1, steps: [step({ approverId: me })] });
  assert.equal(resolveDocBox(todo, me).box, '대기');
  assert.deepEqual(resolveDocBox(doc('B', { status: '진행중', drafterId: me }), me), { box: '상신', draftFilter: 'progress' });
  assert.equal(resolveDocBox(doc('C', { status: '임시저장', drafterId: me }), me).box, '임시');
});
