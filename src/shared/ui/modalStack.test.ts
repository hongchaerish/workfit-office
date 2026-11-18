import assert from 'node:assert/strict';
import test from 'node:test';
import { createModalStack } from './modalStack';

test('modalStack: 겹친 창은 맨 위 것만 Esc 를 받는다', () => {
  const s = createModalStack();
  const a = s.push();
  const b = s.push();
  assert.equal(s.isTop(a), false);
  assert.equal(s.isTop(b), true);
  s.remove(b);
  assert.equal(s.isTop(a), true);
});

test('modalStack: 가운데 창이 먼저 닫혀도 맨 위는 그대로', () => {
  const s = createModalStack();
  const a = s.push();
  const b = s.push();
  const c = s.push();
  s.remove(b);
  assert.equal(s.isTop(c), true);
  assert.equal(s.isTop(a), false);
});
