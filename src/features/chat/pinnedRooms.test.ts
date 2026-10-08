import test from 'node:test';
import assert from 'node:assert/strict';
import { sortPinnedFirst } from './pinnedRooms';

const rooms = ['a', 'b', 'c', 'd'].map((id) => ({ id }));

test('고정한 방은 고정한 순서대로 맨 위, 나머지는 원래 순서', () => {
  assert.deepEqual(sortPinnedFirst(rooms, ['c', 'a']).map((r) => r.id), ['c', 'a', 'b', 'd']);
});

test('고정이 없거나 목록에 없는 방을 고정해 두었어도 원래 순서', () => {
  assert.deepEqual(sortPinnedFirst(rooms, []).map((r) => r.id), ['a', 'b', 'c', 'd']);
  assert.deepEqual(sortPinnedFirst(rooms, ['zz']).map((r) => r.id), ['a', 'b', 'c', 'd']);
});
