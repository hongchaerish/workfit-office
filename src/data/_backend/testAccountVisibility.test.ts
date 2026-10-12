import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import {
  hideTestAccountRows,
  isKnownTestUserId,
  registerTestAccountSource,
  resetTestAccountVisibilityForTest,
  setViewerCanSeeTestAccounts,
} from './testAccountVisibility';

const users = [
  { id: 'U012', name: '홍채원', dept: '데이터플랫폼 개발팀' },
  { id: 'U025', name: 'testA', dept: '테스트' },
];
const profiles = [
  { id: 'P012', userId: 'U012', name: '홍채원' },
  // 프로필 쪽 부서가 일반 부서여도 사용자 원본이 테스트 계정이면 숨긴다
  { id: 'P025', userId: 'U025', name: '에이' },
];

beforeEach(() => {
  resetTestAccountVisibilityForTest();
  registerTestAccountSource(async () => users);
});

test('접속자를 모르면 숨김 쪽으로 동작한다', async () => {
  const rows = await hideTestAccountRows(profiles, (p) => [p.userId]);
  assert.deepEqual(rows.map((p) => p.userId), ['U012']);
});

test('테스트 계정·최고관리자 접속자에게는 모두 보인다', async () => {
  setViewerCanSeeTestAccounts(true);
  const rows = await hideTestAccountRows(profiles, (p) => [p.userId]);
  assert.deepEqual(rows.map((p) => p.userId), ['U012', 'U025']);
});

test('행 자체의 테스트 표식으로도 숨긴다', async () => {
  const rows = await hideTestAccountRows([{ id: 'X', userId: 'U999', name: '김테스터' }], (p) => [p.userId], (p) => p.name.includes('테스터'));
  assert.equal(rows.length, 0);
});

test('사용자 목록을 읽은 뒤에는 테스트 계정 ID 를 동기로 판별한다', async () => {
  await hideTestAccountRows([], () => []);
  assert.equal(isKnownTestUserId('U025'), true);
  assert.equal(isKnownTestUserId('U012'), false);
});

test('보기 권한 값이 바뀌었을 때만 변경으로 알린다', () => {
  assert.equal(setViewerCanSeeTestAccounts(false), false);
  assert.equal(setViewerCanSeeTestAccounts(true), true);
  assert.equal(setViewerCanSeeTestAccounts(true), false);
});
