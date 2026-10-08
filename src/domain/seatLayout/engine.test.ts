import test from 'node:test';
import assert from 'node:assert/strict';
import { addBlock, assignSeat, canPlace, nextBlockId, placeBlock, rectFromCells, rectsOverlap, removeBlock, resizeGrid, updateBlock } from './engine';
import { buildHqTemplateGrid } from './template';
import type { SeatBlock, SeatGrid } from './schema';

const block = (id: string, col: number, row: number, colSpan = 4, rowSpan = 2, userId: string | null = null): SeatBlock => ({
  id, kind: 'seat', col, row, colSpan, rowSpan, userId, label: '',
});
const grid = (...blocks: SeatBlock[]): SeatGrid => ({ cols: 20, rows: 10, blocks });

test('겹침 판정 — 맞닿기만 하면 겹치지 않는다', () => {
  assert.equal(rectsOverlap(block('a', 0, 0), block('b', 4, 0)), false);
  assert.equal(rectsOverlap(block('a', 0, 0), block('b', 3, 1)), true);
});

test('드래그한 두 칸으로 사각형 — 방향과 무관', () => {
  assert.deepEqual(rectFromCells({ col: 5, row: 4 }, { col: 2, row: 1 }), { col: 2, row: 1, colSpan: 4, rowSpan: 4 });
});

test('블록 추가: 격자 밖이나 겹치면 거부, ID 는 겹치지 않게', () => {
  const g = grid(block('B1', 0, 0));
  assert.equal(addBlock(g, { col: 2, row: 0, colSpan: 2, rowSpan: 2 }, 'seat'), null);
  assert.equal(addBlock(g, { col: 18, row: 0, colSpan: 4, rowSpan: 2 }, 'seat'), null);
  const added = addBlock(g, { col: 4, row: 0, colSpan: 4, rowSpan: 2 }, 'room', '탕비실');
  assert.equal(added?.block.id, 'B2');
  assert.equal(added?.block.label, '탕비실');
  assert.equal(nextBlockId([block('B1', 0, 0), block('B3', 0, 0)]), 'B4');
});

test('옮기기·크기 바꾸기: 자기 자리와는 겹쳐도 되고, 남과 겹치면 그대로', () => {
  const g = grid(block('B1', 0, 0), block('B2', 4, 0));
  assert.equal(placeBlock(g, 'B1', { col: 1, row: 0, colSpan: 3, rowSpan: 2 }).blocks[0].col, 1);
  assert.equal(placeBlock(g, 'B1', { col: 2, row: 0, colSpan: 4, rowSpan: 2 }), g);
  assert.equal(canPlace(g, { col: 0, row: 2, colSpan: 8, rowSpan: 2 }), true);
});

test('좌석 지정: 한 사람 한 자리, 좌석이 아니면 지정하지 않는다', () => {
  let g = grid(block('B1', 0, 0, 4, 2, 'U1'), block('B2', 4, 0));
  g = assignSeat(g, 'B2', 'U1');
  assert.deepEqual(g.blocks.map((b) => b.userId), [null, 'U1']);
  g = updateBlock(g, 'B2', { kind: 'room', label: '회의실' });
  assert.equal(g.blocks[1].userId, null);
  assert.equal(assignSeat(g, 'B2', 'U9').blocks[1].userId, null);
  assert.equal(removeBlock(g, 'B1').blocks.length, 1);
});

test('격자 줄이기: 블록이 밖으로 나가면 거부', () => {
  const g = grid(block('B1', 10, 5));
  assert.equal(resizeGrid(g, 12, 10), null);
  assert.deepEqual(resizeGrid(g, 14, 7), { ...g, cols: 14, rows: 7 });
});

test('본사 템플릿: 블록끼리 겹치지 않고 격자 안, 좌석은 모두 공석(사람·메모 없음)', () => {
  const t = buildHqTemplateGrid();
  for (const b of t.blocks) {
    assert.ok(b.col + b.colSpan <= t.cols && b.row + b.rowSpan <= t.rows, `${b.id} 격자 밖`);
    for (const o of t.blocks) if (o !== b) assert.equal(rectsOverlap(b, o), false, `${b.id}·${o.id} 겹침`);
  }
  const seats = t.blocks.filter((b) => b.kind === 'seat');
  assert.equal(seats.length, 25);
  assert.ok(seats.every((b) => b.userId === null && b.label === ''));
});
