import assert from 'node:assert/strict';
import test from 'node:test';
import { findLoginUser } from './match.js';

const users = [
  { $id: 'U009', id: 'U009', empNo: '600009', email: 'hong.gildong@workfit.co.kr' },
  { $id: 'U010', id: 'U010', empNo: '600010', email: 'kim@workfit.co.kr' },
];

test('사번·이메일로 찾는다', () => {
  assert.equal(findLoginUser(users, '600009')?.id, 'U009');
  assert.equal(findLoginUser(users, 'KIM@workfit.co.kr')?.id, 'U010');
});

test('앱 로그인처럼 사용자 ID 로도 찾는다', () => {
  assert.equal(findLoginUser(users, 'u009')?.id, 'U009');
});

test('앱 로그인처럼 이메일 앞부분으로도 찾는다', () => {
  assert.equal(findLoginUser(users, 'hong.gildong')?.id, 'U009');
});

test('없는 값은 찾지 않는다', () => {
  assert.equal(findLoginUser(users, 'nobody'), undefined);
  assert.equal(findLoginUser(users, ''), undefined);
});
