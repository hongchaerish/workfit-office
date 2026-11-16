import assert from 'node:assert/strict';
import test from 'node:test';
import { forgetSharedRead, registerSharedRead } from './sharedReads';

test('신호가 온 컬렉션만 나눠 쓰던 읽기를 버린다', () => {
  const calls: string[] = [];
  registerSharedRead('departments', () => calls.push('departments'));
  registerSharedRead('users', () => calls.push('users'));
  forgetSharedRead('departments');
  assert.deepEqual(calls, ['departments']);
  forgetSharedRead('none');
  assert.deepEqual(calls, ['departments']);
});
