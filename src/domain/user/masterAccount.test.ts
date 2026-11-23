import test from 'node:test';
import assert from 'node:assert/strict';
import { assertMasterAccountKept, assertMasterAccountNoDept, isMasterAccount } from './masterAccount';
import { resolveGrants } from '@/domain/authz/engine';
import { SUPER_ADMIN_PERMISSIONS } from '@/domain/authz/permissions';

const org = { depts: [], positions: [] } as never;

test('admin 만 마스터 계정이다', () => {
  assert.equal(isMasterAccount({ id: 'admin' }), true);
  assert.equal(isMasterAccount({ id: 'ADMIN' }), true);
  assert.equal(isMasterAccount({ id: 'U001' }), false);
  assert.equal(isMasterAccount(null), false);
});

test('마스터 계정은 역할 지정이 없어도 모든 권한·전사 범위, 최고 관리자', () => {
  const r = resolveGrants({ id: 'admin', name: '관리자', status: '사용' }, [], [], org);
  assert.equal(r.isSuperAdmin, true);
  for (const key of SUPER_ADMIN_PERMISSIONS) assert.equal(r.grants.get(key)?.all, true, key);
});

test('마스터 계정은 사용 중지 상태로 저장돼 있어도 권한을 잃지 않는다', () => {
  const r = resolveGrants({ id: 'admin', status: '미사용' }, [], [], org);
  assert.equal(r.isSuperAdmin, true);
});

test('마스터 계정은 삭제·사용 중지·퇴직할 수 없다', () => {
  assert.throws(() => assertMasterAccountKept('admin', 'remove'));
  assert.throws(() => assertMasterAccountKept('admin', { status: '미사용' }));
  assert.throws(() => assertMasterAccountKept('admin', { status: '잠금' }));
  assert.throws(() => assertMasterAccountKept('admin', { status: '사용', resignedAt: '2026-11-23' }));
  assert.doesNotThrow(() => assertMasterAccountKept('admin', { status: '사용' }));
  assert.doesNotThrow(() => assertMasterAccountKept('U001', 'remove'));
});

test('마스터 계정은 어떤 부서에도 속할 수 없다', () => {
  assert.throws(() => assertMasterAccountNoDept('admin'));
  assert.doesNotThrow(() => assertMasterAccountNoDept('U001'));
  assert.doesNotThrow(() => assertMasterAccountNoDept(null));
});
