import type { SeatBlock, SeatBlockKind, SeatGrid } from './schema';

interface TemplateBlock {
  kind: SeatBlockKind;
  col: number;
  row: number;
  colSpan: number;
  rowSpan: number;
  label?: string;
}

/** 좌석 — 템플릿의 좌석은 모두 공석이다(사람은 불러온 뒤 편집에서 지정) */
const seat = (col: number, row: number, colSpan = 4): TemplateBlock => ({ kind: 'seat', col, row, colSpan, rowSpan: 2 });
const room = (col: number, row: number, colSpan: number, rowSpan: number, label: string): TemplateBlock => ({ kind: 'room', col, row, colSpan, rowSpan, label });
const mark = (col: number, row: number, colSpan: number, rowSpan: number, label: string): TemplateBlock => ({ kind: 'label', col, row, colSpan, rowSpan, label });

/**
 * 본사 좌석 배치(2026-10 사용자 제공 배치표) — 엑셀 한 열 = 4칸, 한 행 = 2칸으로 옮겼다.
 * 열 사이 통로는 1칸, 위층 구역과 아래 구역 사이 통로는 1행. 자리 모양만 담고 사람은 넣지 않는다.
 */
const HQ_TEMPLATE: { cols: number; rows: number; blocks: TemplateBlock[] } = {
  cols: 33,
  rows: 17,
  blocks: [
    // 위 구역
    room(13, 0, 4, 2, 'EV'),
    room(17, 0, 5, 2, '남자 화장실 7층\n여자 화장실 9층'),
    seat(22, 0, 5),
    seat(22, 2, 5),
    seat(22, 4, 5),
    room(29, 0, 4, 3, '대표이사실'),
    room(29, 3, 4, 3, '본부장실'),
    room(4, 4, 4, 2, '행거'),
    mark(9, 4, 2, 2, '▼▲'),
    room(11, 4, 6, 2, '탕비실'),
    room(17, 4, 5, 2, '서버실 & 창고'),
    // 왼쪽 구역
    seat(0, 7), seat(4, 7),
    seat(0, 9), seat(4, 9),
    seat(0, 11), seat(4, 11),
    seat(0, 13), seat(4, 13),
    seat(0, 15, 8),
    // 가운데 구역
    seat(9, 9), seat(13, 9),
    seat(9, 11), seat(13, 11),
    seat(9, 13), seat(13, 13),
    seat(9, 15, 8),
    // 오른쪽 구역
    seat(18, 9), room(22, 9, 4, 2, '[프린터 & 파쇄기]'),
    seat(18, 11), seat(22, 11),
    seat(18, 13), seat(22, 13),
    seat(18, 15, 8),
    // 회의실·테라스
    mark(29, 7, 2, 2, '◀▶'),
    room(27, 9, 4, 8, '대회의실'),
    room(31, 7, 2, 10, '테라스'),
  ],
};

/** 본사 배치 템플릿 → 격자. 좌석은 모두 공석 — 사람은 불러온 뒤 좌석을 눌러 지정한다. */
export function buildHqTemplateGrid(): SeatGrid {
  const blocks: SeatBlock[] = HQ_TEMPLATE.blocks.map((t, i) => ({
    id: `B${i + 1}`,
    kind: t.kind,
    col: t.col,
    row: t.row,
    colSpan: t.colSpan,
    rowSpan: t.rowSpan,
    userId: null,
    label: t.label ?? '',
  }));
  return { cols: HQ_TEMPLATE.cols, rows: HQ_TEMPLATE.rows, blocks };
}
