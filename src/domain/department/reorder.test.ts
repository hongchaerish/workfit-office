import assert from 'node:assert/strict';
import test from 'node:test';
import { moveSibling, orderOnSave, renumberSiblings, sameNameDept, saveOrdersAllOrNothing } from './reorder';

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

test('orderOnSave: 새 부서·상위를 바꾼 부서는 새 상위 부서 안 맨 끝, 그대로면 번호 유지', () => {
  // 새 부서 — 최상위 형제(a 1, b 2, c 2) 뒤
  assert.equal(orderOnSave(D, { id: '', parentId: null }), 3);
  // b 아래로 옮긴 c — b 의 자식(x 1) 뒤
  assert.equal(orderOnSave(D, { id: 'c', parentId: 'b' }), 2);
  // 상위 그대로 — 번호 유지
  assert.equal(orderOnSave(D, { id: 'a', parentId: null }), 1);
  // 자식이 없는 상위로 — 1
  assert.equal(orderOnSave(D, { id: 'c', parentId: 'a' }), 1);
});

test('renumberSiblings: 같은 상위 부서 안을 1부터 다시 — 겹친 번호를 푼다(바뀐 것만)', () => {
  assert.deepEqual(renumberSiblings(D, null), [{ id: 'c', order: 3 }]);
  assert.deepEqual(renumberSiblings(D, 'b'), []);
  const tops = [
    { id: '1', parentId: null, order: 1, name: '대표이사' },
    { id: '2', parentId: null, order: 1, name: '영업팀' },
    { id: '3', parentId: null, order: 1, name: 'X팀' },
  ];
  const orders = new Map(renumberSiblings(tops, null).map((r) => [r.id, r.order]));
  const final = tops.map((t) => orders.get(t.id) ?? t.order);
  assert.deepEqual([...final].sort(), [1, 2, 3]);
});

test('sameNameDept: 띄어쓰기를 무시하고 같은 이름의 다른 부서를 찾는다', () => {
  assert.equal(sameNameDept(D, '경영 지원팀', 'b')?.id, 'a');
  assert.equal(sameNameDept(D, '경영지원팀', 'a'), null); // 자기 자신
  assert.equal(sameNameDept(D, '새팀', ''), null);
});
