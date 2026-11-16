import assert from 'node:assert/strict';
import test from 'node:test';
import { DocumentExistsError } from '@/data/_backend/crudBackend';
import type { AccountDraft, Company, CompanyBankAccount } from '@/domain/company/schema';
import { createCompanyRepo, DuplicateBizNoError } from './company.repo';

/** 메모리 백엔드 — insert 는 같은 id 면 DocumentExistsError, failWith 가 있으면 그 오류로 실패. */
function mem<T extends { id: string }>(coll: string) {
  const rows = new Map<string, T>();
  const calls: string[] = [];
  let failWith: unknown = null;
  return {
    rows, calls,
    fail(e: unknown) { failWith = e; },
    async loadAll() { return [...rows.values()]; },
    async loadWithQueries() { return [...rows.values()]; },
    async insert(x: T) {
      calls.push(`insert ${x.id}`);
      if (failWith) throw failWith;
      if (rows.has(x.id)) throw new DocumentExistsError(coll, x.id);
      rows.set(x.id, x);
    },
    async save(x: T) { calls.push(`save ${x.id}`); if (failWith) throw failWith; rows.set(x.id, x); },
    async patch() { throw new Error('unused'); },
    async remove() { throw new Error('unused'); },
  };
}

const company = (over: Partial<Company> = {}): Company => ({
  id: 'CMP-1', name: '대성반도체', bizNo: '1248100998', ceoName: '', phone: '', fax: '', email: '', homepage: '', address: '', addressDetail: '', use: true, note: '',
  createdBy: '', createdAt: '', updatedBy: '', updatedAt: '', ...over,
});
const row = (over: Partial<AccountDraft> = {}): AccountDraft => ({ bankCode: '004', accountNo: '1-2', holder: '대성', isDefault: false, use: true, note: '', ...over });

function setup() {
  const companies = mem<Company>('companies');
  const accounts = mem<CompanyBankAccount>('companyBankAccounts');
  const files = mem<{ id: string; companyId: string }>('companyFiles');
  const repo = createCompanyRepo({ companies, accounts, files: files as never });
  return { companies, accounts, repo };
}

test('신규 기업 + 계좌 2줄 → 기업 insert 1, 계좌 insert 2, 기본은 하나', async () => {
  const { companies, accounts, repo } = setup();
  const saved = await repo.saveCompanyWithAccounts({ company: company(), isNew: true, accounts: [row(), row({ accountNo: '3-4' })], existing: [], actorId: 'U1' });
  assert.deepEqual(companies.calls, ['insert CMP-1']);
  assert.equal(saved.createdBy, 'U1');
  assert.ok(saved.createdAt);
  const acc = [...accounts.rows.values()];
  assert.equal(accounts.calls.filter((c) => c.startsWith('insert')).length, 2);
  assert.deepEqual(acc.map((a) => a.isDefault), [true, false]);
  assert.ok(acc.every((a) => a.companyId === 'CMP-1' && /^CBA-/.test(a.id) && a.createdBy === 'U1'));
});

test('수정 — 빠진 저장 계좌는 지우지 않고 사용 안 함, 기본 false', async () => {
  const { accounts, repo } = setup();
  const old: CompanyBankAccount[] = [
    { id: 'CBA-a', companyId: 'CMP-1', bankCode: '004', accountNo: '1', holder: 'x', isDefault: true, use: true, note: '', createdBy: 'U0', createdAt: 't0', updatedBy: '', updatedAt: '' },
    { id: 'CBA-b', companyId: 'CMP-1', bankCode: '088', accountNo: '2', holder: 'x', isDefault: false, use: true, note: '', createdBy: 'U0', createdAt: 't0', updatedBy: '', updatedAt: '' },
  ];
  for (const a of old) accounts.rows.set(a.id, a);
  await repo.saveCompanyWithAccounts({ company: company(), isNew: false, accounts: [row({ id: 'CBA-b', bankCode: '088', accountNo: '2', holder: 'x' })], existing: old, actorId: 'U2' });
  const a = accounts.rows.get('CBA-a')!;
  const b = accounts.rows.get('CBA-b')!;
  assert.equal(a.use, false);
  assert.equal(a.isDefault, false);
  assert.equal(b.isDefault, true);
  assert.equal(b.createdBy, 'U0');
  assert.equal(b.updatedBy, 'U2');
  assert.equal(accounts.rows.size, 2);
});

test('기업 저장이 409면 DuplicateBizNoError, 계좌는 하나도 안 저장', async () => {
  for (const err of [new DocumentExistsError('companies', 'CMP-1'), Object.assign(new Error('unique'), { code: 409 })]) {
    const { companies, accounts, repo } = setup();
    companies.fail(err);
    await assert.rejects(
      repo.saveCompanyWithAccounts({ company: company(), isNew: true, accounts: [row()], existing: [], actorId: 'U1' }),
      DuplicateBizNoError,
    );
    assert.deepEqual(accounts.calls, []);
  }
});

test('수정 저장도 409(다른 기업과 번호 겹침)면 DuplicateBizNoError', async () => {
  const { companies, repo } = setup();
  companies.fail(Object.assign(new Error('unique'), { code: 409 }));
  await assert.rejects(repo.saveCompanyWithAccounts({ company: company(), isNew: false, accounts: [], existing: [], actorId: 'U1' }), DuplicateBizNoError);
});
