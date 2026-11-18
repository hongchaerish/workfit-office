import assert from 'node:assert/strict';
import test from 'node:test';
import { moveSibling } from './reorder';

const D = [
  { id: 'a', parentId: null, order: 1, name: '경영지원팀' },
  { id: 'b', parentId: null, order: 2, name: '개발팀' },
  { id: 'c', parentId: null, order: 2, name: '기획팀' },
  { id: 'x', parentId: 'b', order: 1, name: '개발1파트' },
];

test('moveSibling: 아래로 — 바뀐 것만 돌려준다', () => {
  assert.deepEqual(moveSibling(D, 'a', 1), [
    { id: 'b', order: 1 },
    { id: 'a', order: 2 },
    { id: 'c', order: 3 },
  ]);
});

test('moveSibling: 맨 위에서 위로 → 빈 배열', () => {
  assert.deepEqual(moveSibling(D, 'a', -1), []);
});

test('moveSibling: 맨 아래에서 아래로 → 빈 배열', () => {
  assert.deepEqual(moveSibling(D, 'c', 1), []);
});

test('moveSibling: 다른 상위 부서는 건드리지 않는다', () => {
  assert.ok(moveSibling(D, 'c', -1).every((r) => r.id !== 'x'));
});

test('moveSibling: 이미 번호가 맞는 형제는 돌려주지 않는다', () => {
  const list = [
    { id: 'a', parentId: null, order: 1, name: 'A' },
    { id: 'b', parentId: null, order: 2, name: 'B' },
    { id: 'c', parentId: null, order: 3, name: 'C' },
  ];
  assert.deepEqual(moveSibling(list, 'c', -1), [
    { id: 'c', order: 2 },
    { id: 'b', order: 3 },
  ]);
});
