import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldApplyDeepLink } from './deepLink';

test('처음 들어온 딥링크는 대상이 준비되면 적용한다', () => {
  assert.equal(shouldApplyDeepLink(null, 'doc=AP-1', true), true);
});

test('대상 데이터가 아직 없으면 적용을 미룬다', () => {
  assert.equal(shouldApplyDeepLink(null, 'doc=AP-1', false), false);
});

test('이미 적용한 딥링크는 데이터가 갱신돼도 다시 적용하지 않는다', () => {
  assert.equal(shouldApplyDeepLink('doc=AP-1', 'doc=AP-1', true), false);
});

test('주소의 딥링크가 바뀌면 새로 적용한다', () => {
  assert.equal(shouldApplyDeepLink('doc=AP-1', 'doc=AP-2', true), true);
});

test('딥링크가 없으면 적용하지 않는다', () => {
  assert.equal(shouldApplyDeepLink(null, null, true), false);
});
