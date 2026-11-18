import assert from 'node:assert/strict';
import test from 'node:test';
import { moveSibling, saveOrdersAllOrNothing } from './reorder';

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

test('saveOrdersAllOrNothing: 중간에 실패하면 이미 바꾼 부서를 원래 번호로 되돌리고 오류를 낸다', async () => {
  const db = new Map([['a', 1], ['b', 2], ['c', 3]]);
  const save = async (id: string, order: number) => {
    if (id === 'c' && order === 1) throw new Error('저장 실패');
    db.set(id, order);
  };
  await assert.rejects(
    saveOrdersAllOrNothing([{ id: 'a', order: 3 }, { id: 'b', order: 2 }, { id: 'c', order: 1 }], new Map([['a', 1], ['b', 2], ['c', 3]]), save),
    /저장 실패/,
  );
  assert.deepEqual([...db], [['a', 1], ['b', 2], ['c', 3]]);
});

test('saveOrdersAllOrNothing: 모두 되면 그대로 저장', async () => {
  const db = new Map([['a', 1], ['b', 2]]);
  await saveOrdersAllOrNothing([{ id: 'a', order: 2 }, { id: 'b', order: 1 }], new Map([['a', 1], ['b', 2]]), async (id, o) => void db.set(id, o));
  assert.deepEqual([...db], [['a', 2], ['b', 1]]);
});
