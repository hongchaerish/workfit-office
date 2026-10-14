import assert from 'node:assert/strict';
import test from 'node:test';
import { isReloginError, RELOGIN_MESSAGE, RELOGIN_SNOOZE_MS, shouldShowRelogin } from './relogin';

test('재로그인 문구로 만든 오류만 재로그인 오류로 본다', () => {
  assert.equal(isReloginError(new Error(RELOGIN_MESSAGE)), true);
  assert.equal(isReloginError(new Error('이 설문을 관리할 권한이 없습니다.')), false);
  assert.equal(isReloginError('문자열'), false);
});

test('문구에 "다시 로그인"이 들어 있다 — 기존 안내와 같은 뜻을 유지', () => {
  assert.match(RELOGIN_MESSAGE, /다시 로그인/);
});

test('한 번도 미루지 않았으면 바로 보여 준다', () => {
  assert.equal(shouldShowRelogin(null, 1_000), true);
});

test('[나중에]를 누른 뒤 일정 시간은 다시 띄우지 않는다', () => {
  const dismissed = 1_000_000;
  assert.equal(shouldShowRelogin(dismissed, dismissed + RELOGIN_SNOOZE_MS - 1), false);
  assert.equal(shouldShowRelogin(dismissed, dismissed + RELOGIN_SNOOZE_MS), true);
});

test('사용자가 직접 [다시 로그인]을 누르면 미뤄 둔 상태여도 바로 보여 준다', () => {
  const dismissed = 1_000_000;
  assert.equal(shouldShowRelogin(dismissed, dismissed + 1, true), true);
});
