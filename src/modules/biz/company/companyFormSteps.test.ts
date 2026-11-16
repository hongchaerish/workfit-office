import assert from 'node:assert/strict';
import test from 'node:test';
import type { AccountDraft, CompanyDraft } from '@/domain/company/schema';
import { companyFormSteps, requiredProgress } from './companyFormSteps';

const blank: CompanyDraft = { name: '', bizNo: '', ceoName: '', phone: '', address: '', addressDetail: '', note: '', use: true };
const acc = (p: Partial<AccountDraft>): AccountDraft => ({ bankCode: '088', accountNo: '110-1', holder: '대성', isDefault: false, use: true, note: '', ...p });
const bankName = (code: string) => (code === '088' ? '신한' : code === '004' ? '국민' : '');
const run = (form: Partial<CompanyDraft>, accounts: AccountDraft[] = [], duplicate = false) =>
  companyFormSteps({ form: { ...blank, ...form }, accounts, bankName, duplicate });
const of = (steps: ReturnType<typeof run>, key: string) => steps.find((s) => s.key === key)!;

test('빈 신규 창', () => {
  assert.deepEqual(run({}).map((s) => s.state), ['empty', 'optional', 'optional', 'optional']);
  assert.deepEqual(run({}).map((s) => s.title), ['기본 정보', '주소', '계좌', '메모']);
  assert.deepEqual(requiredProgress(blank, false), { done: 0, total: 2 });
});

test('이름만', () => {
  assert.equal(of(run({ name: '대성반도체(주)' }), 'basic').state, 'progress');
  assert.equal(requiredProgress({ ...blank, name: '대성반도체(주)' }, false).done, 1);
});

test('이름+번호', () => {
  const s = of(run({ name: ' 대성반도체(주) ', bizNo: '1234567890' }), 'basic');
  assert.equal(s.state, 'done');
  assert.equal(s.summary, '대성반도체(주) · 123-45-67890');
  assert.equal(requiredProgress({ ...blank, name: '대성반도체(주)', bizNo: '123-45-67890' }, false).done, 2);
});

test('중복', () => {
  assert.equal(of(run({ name: '대성', bizNo: '1234567890' }, [], true), 'basic').state, 'error');
  assert.equal(requiredProgress({ ...blank, name: '대성', bizNo: '1234567890' }, true).done, 1);
});

test('주소만 상세', () => {
  const s = of(run({ addressDetail: '3층' }), 'address');
  assert.equal(s.state, 'done');
  assert.equal(s.summary, '3층');
});

test('계좌 미완성(예금주 없음)', () => {
  assert.equal(of(run({}, [acc({ holder: '' })]), 'account').state, 'progress');
});

test('계좌 2개(하나 사용 안 함), 기본 신한 110-1', () => {
  const s = of(run({}, [acc({ isDefault: true }), acc({ bankCode: '004', accountNo: '9', use: false, holder: '' })]), 'account');
  assert.equal(s.state, 'done');
  assert.equal(s.summary, '계좌 1개 · 기본 신한 110-1');
});

test('사용 안 함 계좌만', () => {
  assert.equal(of(run({}, [acc({ use: false })]), 'account').state, 'optional');
});

test('메모 두 줄', () => {
  const s = of(run({ note: '첫 줄\n둘째 줄' }), 'memo');
  assert.equal(s.state, 'done');
  assert.equal(s.summary, '첫 줄');
});
