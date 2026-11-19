import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCopyGesture } from './dragCopy';

test('Ctrl(맥은 ⌘·Option)을 누른 채 놓으면 복사, 아니면 이동', () => {
  const k = (o: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }>) => ({ ctrlKey: false, metaKey: false, altKey: false, ...o });
  assert.equal(isCopyGesture(k({})), false);
  assert.equal(isCopyGesture(k({ ctrlKey: true })), true);
  assert.equal(isCopyGesture(k({ metaKey: true })), true);
  assert.equal(isCopyGesture(k({ altKey: true })), true);
});
