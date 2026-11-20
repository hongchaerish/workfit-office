import { test } from 'node:test';
import assert from 'node:assert/strict';
import { docNoPrefixOf, isLumefabDoc, isLumefabForm, parseCompany } from './company';

test('문서번호 앞자리 — 루미팹 LF, 그 밖 AP', () => {
  assert.equal(docNoPrefixOf('lumefab'), 'LF');
  assert.equal(docNoPrefixOf(null), 'AP');
  assert.equal(docNoPrefixOf(undefined), 'AP');
});

test('주소의 company 값 — 아는 값만', () => {
  assert.equal(parseCompany('lumefab'), 'lumefab');
  assert.equal(parseCompany('x'), null);
  assert.equal(parseCompany(null), null);
});

test('루미팹 서식 — 코드나 이름으로', () => {
  assert.ok(isLumefabForm({ code: '지출결의', name: '아무개' }));
  assert.ok(isLumefabForm({ code: 'X1', name: '품의서' }));
  assert.ok(!isLumefabForm({ code: '휴일근무', name: '휴일근무 신청서' }));
  // 법인카드 사용 내역서 — 코드가 달라도 이름으로
  assert.ok(isLumefabForm({ code: '품의_사본', name: '법인카드 사용 내역서' }));
  assert.ok(isLumefabForm({ code: '법인카드', name: '아무 이름' }));
  // 채용 품의서 — 코드로, 이름(띄어쓰기 달라도)으로
  assert.ok(isLumefabForm({ code: '채용', name: '아무 이름' }));
  assert.ok(isLumefabForm({ code: 'X2', name: '채용품의서' }));
  assert.ok(!isLumefabForm({ code: 'X3', name: '채용 계획서' }));
  // 외근 신청서 — 코드로, 이름(띄어쓰기 달라도)으로. 출장 신청서는 아님
  assert.ok(isLumefabForm({ code: '외근', name: '아무 이름' }));
  assert.ok(isLumefabForm({ code: 'X4', name: '외근신청서' }));
  assert.ok(!isLumefabForm({ code: '국내출장', name: '국내출장 신청서' }));
  // 휴가원·개인 경비 사용 신청서 — 코드로, 이름(띄어쓰기 달라도)으로. 시험용 사본 서식은 아님
  assert.ok(isLumefabForm({ code: '휴가', name: '아무 이름' }));
  assert.ok(isLumefabForm({ code: 'X5', name: '휴가원' }));
  assert.ok(isLumefabForm({ code: '개인경비', name: '아무 이름' }));
  assert.ok(isLumefabForm({ code: 'X6', name: '개인경비 사용 신청서' }));
  assert.ok(!isLumefabForm({ code: '개인경비_운영시험', name: '(운영본) 개인 경비 사용 신청서' }));
});

test('루미팹 문서 판별 — 기존 문서(company 없음)는 워크핏', () => {
  assert.ok(isLumefabDoc({ company: 'lumefab' }));
  assert.ok(!isLumefabDoc({}));
  assert.ok(!isLumefabDoc({ company: null }));
});

test('회사 보기 — 합쳐서·워크핏만·루미팹만', async () => {
  const { inCompanyView, parseCompanyView } = await import('./company');
  const wf = {};
  const lf = { company: 'lumefab' };
  assert.ok(inCompanyView(wf, 'all') && inCompanyView(lf, 'all'));
  assert.ok(inCompanyView(wf, 'workfit') && !inCompanyView(lf, 'workfit'));
  assert.ok(!inCompanyView(wf, 'lumefab') && inCompanyView(lf, 'lumefab'));
  assert.equal(parseCompanyView('lumefab'), 'lumefab');
  assert.equal(parseCompanyView('x'), null);
});
