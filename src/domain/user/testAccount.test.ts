import assert from 'node:assert/strict';
import test from 'node:test';
import { canDesignateUser, canViewerSeeTestAccounts, isTestAccount } from './testAccount';

test('테스트 부서 소속이면 테스트 계정이다', () => {
  assert.equal(isTestAccount({ id: 'U025', name: 'testA', dept: '테스트' }), true);
  assert.equal(isTestAccount({ id: 'U014', name: 'ㅍ테스터', dept: '테스트' }), true);
});

test('이름·ID·이메일·로그인ID 어디든 테스트 표식이 있으면 테스트 계정이다', () => {
  assert.equal(isTestAccount({ id: 'U900', name: '김테스터', dept: '개발팀' }), true);
  assert.equal(isTestAccount({ id: 'U901', name: 'QA', dept: '개발팀', email: 'test01@workfit.kr' }), true);
  assert.equal(isTestAccount({ id: 'U902', name: 'QA', dept: '개발팀', loginId: 'TestUser' }), true);
  assert.equal(isTestAccount({ id: 'U903', name: '허진욱2', dept: '개발팀' }), true);
});

test('일반 임직원은 테스트 계정이 아니다', () => {
  assert.equal(isTestAccount({ id: 'U012', name: '홍채원', dept: '데이터플랫폼 개발팀', email: 'cwhong@workfit.kr' }), false);
  assert.equal(isTestAccount(null), false);
});

test('지정은 같은 쪽끼리만 — 테스트 계정은 임직원을, 임직원은 테스트 계정을 지정할 수 없다', () => {
  const staff = { id: 'U012', name: '홍채원', dept: '데이터플랫폼 개발팀' };
  const otherStaff = { id: 'U003', name: '손승원', dept: '경영기획팀' };
  const tester = { id: 'U025', name: 'testA', dept: '테스트' };
  const otherTester = { id: 'U026', name: 'testB', dept: '테스트' };
  assert.equal(canDesignateUser(staff, otherStaff), true);
  assert.equal(canDesignateUser(tester, otherTester), true);
  assert.equal(canDesignateUser(tester, staff), false);
  assert.equal(canDesignateUser(staff, tester), false);
});

test('열람 — 테스트 계정 본인은 항상 테스트 계정을 본다', () => {
  assert.equal(canViewerSeeTestAccounts({ isTestViewer: true, isSuperAdmin: false, superAdminShowsTestAccounts: false }), true);
});

test('열람 — 최고관리자는 상단 토글을 따른다', () => {
  assert.equal(canViewerSeeTestAccounts({ isTestViewer: false, isSuperAdmin: true, superAdminShowsTestAccounts: true }), true);
  assert.equal(canViewerSeeTestAccounts({ isTestViewer: false, isSuperAdmin: true, superAdminShowsTestAccounts: false }), false);
});

test('열람 — 그 외 임직원은 볼 수 없다', () => {
  assert.equal(canViewerSeeTestAccounts({ isTestViewer: false, isSuperAdmin: false, superAdminShowsTestAccounts: false }), false);
  assert.equal(canViewerSeeTestAccounts({ isTestViewer: false, isSuperAdmin: false, superAdminShowsTestAccounts: true }), false);
});
