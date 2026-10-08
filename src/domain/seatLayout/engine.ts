import { SEAT_GRID_LIMITS, type SeatBlock, type SeatBlockKind, type SeatGrid } from './schema';

/** 블록이 차지하는 칸 범위 */
export interface CellRect {
  col: number;
  row: number;
  colSpan: number;
  rowSpan: number;
}

/** 두 칸 범위가 겹치는가 */
export function rectsOverlap(a: CellRect, b: CellRect): boolean {
  return a.col < b.col + b.colSpan && b.col < a.col + a.colSpan && a.row < b.row + b.rowSpan && b.row < a.row + a.rowSpan;
}

/** 격자 안에 들어가는가 */
export function rectFits(grid: Pick<SeatGrid, 'cols' | 'rows'>, r: CellRect): boolean {
  return r.col >= 0 && r.row >= 0 && r.colSpan >= 1 && r.rowSpan >= 1 && r.col + r.colSpan <= grid.cols && r.row + r.rowSpan <= grid.rows;
}

/** 이 자리에 둘 수 있는가 — 격자 안이고 다른 블록과 겹치지 않음(ignoreId 는 자기 자신) */
export function canPlace(grid: SeatGrid, r: CellRect, ignoreId?: string): boolean {
  return rectFits(grid, r) && grid.blocks.every((b) => b.id === ignoreId || !rectsOverlap(b, r));
}

/** 두 칸(드래그 시작·끝)으로 만든 사각형 */
export function rectFromCells(a: { col: number; row: number }, b: { col: number; row: number }): CellRect {
  const col = Math.min(a.col, b.col);
  const row = Math.min(a.row, b.row);
  return { col, row, colSpan: Math.abs(a.col - b.col) + 1, rowSpan: Math.abs(a.row - b.row) + 1 };
}

/** 배치도 안에서 겹치지 않는 새 블록 ID */
export function nextBlockId(blocks: SeatBlock[]): string {
  const used = new Set(blocks.map((b) => b.id));
  let n = blocks.length + 1;
  while (used.has(`B${n}`)) n += 1;
  return `B${n}`;
}

/** 블록 추가 — 둘 수 없으면 null */
export function addBlock(grid: SeatGrid, r: CellRect, kind: SeatBlockKind, label = ''): { grid: SeatGrid; block: SeatBlock } | null {
  if (!canPlace(grid, r)) return null;
  const block: SeatBlock = { id: nextBlockId(grid.blocks), kind, ...r, userId: null, label };
  return { grid: { ...grid, blocks: [...grid.blocks, block] }, block };
}

/** 블록 옮기기·크기 바꾸기 — 둘 수 없으면 그대로 */
export function placeBlock(grid: SeatGrid, id: string, r: CellRect): SeatGrid {
  if (!canPlace(grid, r, id)) return grid;
  return { ...grid, blocks: grid.blocks.map((b) => (b.id === id ? { ...b, ...r } : b)) };
}

export function removeBlock(grid: SeatGrid, id: string): SeatGrid {
  return { ...grid, blocks: grid.blocks.filter((b) => b.id !== id) };
}

/** 종류·글자 바꾸기. 좌석이 아니게 되면 앉은 사람은 비운다 */
export function updateBlock(grid: SeatGrid, id: string, patch: { kind?: SeatBlockKind; label?: string }): SeatGrid {
  return {
    ...grid,
    blocks: grid.blocks.map((b) => {
      if (b.id !== id) return b;
      const kind = patch.kind ?? b.kind;
      return { ...b, kind, label: (patch.label ?? b.label).slice(0, 60), userId: kind === 'seat' ? b.userId : null };
    }),
  };
}

/** 좌석에 사람을 앉힌다 — 한 사람은 한 배치도에 한 자리만. null 이면 공석 */
export function assignSeat(grid: SeatGrid, id: string, userId: string | null): SeatGrid {
  return {
    ...grid,
    blocks: grid.blocks.map((b) => {
      if (b.id === id) return b.kind === 'seat' ? { ...b, userId } : b;
      if (userId && b.userId === userId) return { ...b, userId: null };
      return b;
    }),
  };
}

/** 격자 크기 바꾸기 — 범위를 벗어나는 블록이 생기면 바꾸지 않는다(null) */
export function resizeGrid(grid: SeatGrid, cols: number, rows: number): SeatGrid | null {
  const c = Math.min(SEAT_GRID_LIMITS.maxCols, Math.max(SEAT_GRID_LIMITS.minCols, Math.round(cols)));
  const r = Math.min(SEAT_GRID_LIMITS.maxRows, Math.max(SEAT_GRID_LIMITS.minRows, Math.round(rows)));
  if (grid.blocks.some((b) => b.col + b.colSpan > c || b.row + b.rowSpan > r)) return null;
  return { ...grid, cols: c, rows: r };
}
