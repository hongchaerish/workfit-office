import assert from 'node:assert/strict';
import test from 'node:test';
import {
  companySchema,
  findCompanyByBizNo,
  newAccountId,
  newCompanyFileId,
  newCompanyId,
  normalizeDefaultAccount,
  validateAccountDrafts,
  validateCompanyDraft,
  type AccountDraft,
  type Company,
  type CompanyDraft,
} from './schema';

const co = (id: string, name: string, bizNo: string, use = true): Company => ({
  id, name, bizNo, ceoName: '', phone: '', fax: '', email: '', homepage: '', address: '', addressDetail: '', use, note: '',
  createdBy: '', createdAt: '', updatedBy: '', updatedAt: '',
});
const draft = (over: Partial<CompanyDraft> = {}): CompanyDraft => ({
  name: '대성반도체', bizNo: '1248100998', ceoName: '', phone: '', fax: '', email: '', homepage: '', address: '', addressDetail: '', note: '', use: true, ...over,
});
const acc = (use: boolean, isDefault: boolean) => ({ use, isDefault });
const accDraft: AccountDraft = { bankCode: '004', accountNo: '123-456-7890', holder: '대성반도체', isDefault: true, use: true, note: '' };

test('사업자번호는 숫자만 비교 — 모양이 달라도 같은 번호면 중복, 사용 안 함도 포함', () => {
  const all = [co('CMP-1', '대성', '1248100998', false)];
  assert.equal(findCompanyByBizNo(all, '124-81-00998')?.id, 'CMP-1');
  assert.equal(findCompanyByBizNo(all, ' 124 81 00998 ')?.id, 'CMP-1');
  assert.equal(findCompanyByBizNo(all, '1248100998', 'CMP-1'), undefined);
  assert.equal(findCompanyByBizNo(all, ''), undefined);
});

test('기업 검사 — 이름·번호 필수, 10자리 아니면 오류, 검증식 틀리면 경고만, 중복이면 오류와 대상', () => {
  assert.deepEqual(validateCompanyDraft(draft({ name: '', bizNo: '' }), []).errors, ['기업명을 입력하세요.', '사업자등록번호를 입력하세요.']);
  assert.deepEqual(validateCompanyDraft(draft({ bizNo: '12345' }), []).errors, ['사업자등록번호는 숫자 10자리입니다.']);
  const bad = validateCompanyDraft(draft({ bizNo: '1248100999' }), []);
  assert.deepEqual(bad.errors, []);
  assert.deepEqual(bad.warnings, ['사업자등록번호 검증식에 맞지 않습니다. 번호를 다시 확인하세요.']);
  const off = validateCompanyDraft(draft({ bizNo: '124-81-00998' }), [co('CMP-1', '대성', '1248100998', false)]);
  assert.equal(off.duplicate?.id, 'CMP-1');
  assert.deepEqual(off.errors, ['이미 등록된 사업자등록번호입니다(대성, 사용 안 함). 그 기업을 다시 사용으로 바꾸세요.']);
  const on = validateCompanyDraft(draft(), [co('CMP-1', '대성', '1248100998')]);
  assert.deepEqual(on.errors, ['이미 등록된 사업자등록번호입니다(대성).']);
  assert.deepEqual(validateCompanyDraft(draft(), [co('CMP-1', '대성', '1248100998')], 'CMP-1').errors, []);
});

test('기본 계좌 — 사용 중 계좌 중 정확히 하나, 사용 중이 없으면 없음', () => {
  assert.deepEqual(normalizeDefaultAccount([acc(false, true), acc(true, false)]).map((a) => a.isDefault), [false, true]);
  assert.deepEqual(normalizeDefaultAccount([acc(true, true), acc(true, true)]).map((a) => a.isDefault), [true, false]);
  assert.deepEqual(normalizeDefaultAccount([acc(true, false), acc(true, false)]).map((a) => a.isDefault), [true, false]);
  assert.deepEqual(normalizeDefaultAccount([acc(false, true)]).map((a) => a.isDefault), [false]);
  assert.deepEqual(normalizeDefaultAccount([acc(true, false), acc(true, true)]).map((a) => a.isDefault), [false, true]);
});

test('계좌 검사 — 사용 중 줄은 은행·계좌번호·예금주 필수, 계좌번호는 숫자와 - 만', () => {
  assert.deepEqual(validateAccountDrafts([accDraft]), []);
  assert.deepEqual(validateAccountDrafts([{ ...accDraft, bankCode: '' }]), ['1번째 계좌: 은행을 고르세요.']);
  assert.deepEqual(validateAccountDrafts([{ ...accDraft, accountNo: '12a-3' }]), ['1번째 계좌: 계좌번호는 숫자와 - 만 쓸 수 있습니다.']);
  assert.deepEqual(validateAccountDrafts([{ ...accDraft, accountNo: '' }]), ['1번째 계좌: 계좌번호를 입력하세요.']);
  assert.deepEqual(validateAccountDrafts([{ ...accDraft, holder: ' ' }]), ['1번째 계좌: 예금주를 입력하세요.']);
  assert.deepEqual(validateAccountDrafts([{ ...accDraft, bankCode: '', use: false }]), []);
});

test('ID 머리 — CMP·CBA·CFL', () => {
  assert.match(newCompanyId(), /^CMP-[a-z0-9]+$/);
  assert.match(newAccountId(), /^CBA-[a-z0-9]+$/);
  assert.match(newCompanyFileId(), /^CFL-[a-z0-9]+$/);
  assert.notEqual(newCompanyId(), newCompanyId());
});

test('기업 검사 — 이메일·홈페이지는 비어 있어도 되지만 모양이 틀리면 오류', () => {
  assert.deepEqual(validateCompanyDraft(draft({ email: 'tax@daesung.co.kr', homepage: 'www.daesung.co.kr' }), []).errors, []);
  assert.deepEqual(validateCompanyDraft(draft({ email: 'tax@daesung' }), []).errors, ['이메일 형식을 확인하세요. (예: tax@company.co.kr)']);
  assert.deepEqual(validateCompanyDraft(draft({ homepage: '대성반도체' }), []).errors, ['홈페이지 주소를 확인하세요. (예: www.company.co.kr)']);
});

test('기업 스키마 — 예전 문서(팩스·이메일·홈페이지 없음)도 빈 값으로 읽는다', () => {
  const c = companySchema.parse({ id: 'CMP-1', name: '대성', bizNo: '1248100998' });
  assert.equal(c.fax, '');
  assert.equal(c.email, '');
  assert.equal(c.homepage, '');
});

test('기업 스키마 — 칸을 새로 만든 뒤 예전 문서는 null 로 온다: 빈 값으로 읽어야 목록에서 사라지지 않는다', () => {
  const r = companySchema.safeParse({ id: 'CMP-1', name: '대성', bizNo: '1248100998', fax: null, email: null, homepage: null, ceoName: null });
  assert.equal(r.success, true);
  assert.equal(r.data?.fax, '');
  assert.equal(r.data?.email, '');
  assert.equal(r.data?.homepage, '');
});
