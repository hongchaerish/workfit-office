import { z } from 'zod';

/**
 * 좌석 배치도 seatLayouts. PK=id. 조직도 > 좌석배치도 탭.
 *
 * 배치도 한 장(층·구역)이 문서 하나다. 엑셀처럼 **격자(가로·세로 칸) 위에 사각형 블록을 그린다** —
 * 이미지 위에 점을 찍지 않는다. 블록은 여러 칸을 합칠 수 있고(병합), 겹치지 않는다.
 * 수정은 운영자·임원만 한다(화면에서 판정).
 */

/** 블록 종류 — 좌석(사람·공석) / 공간(회의실·탕비실 등) / 글자(테두리 없는 표시: ◀▶ 등) */
export const SEAT_BLOCK_KINDS = ['seat', 'room', 'label'] as const;
export type SeatBlockKind = (typeof SEAT_BLOCK_KINDS)[number];
export const SEAT_BLOCK_KIND_LABELS: Record<SeatBlockKind, string> = { seat: '좌석', room: '공간', label: '글자' };

export const seatBlockSchema = z.object({
  /** 블록 ID — 배치도 안에서만 유일 */
  id: z.string().min(1),
  kind: z.enum(SEAT_BLOCK_KINDS).default('seat'),
  /** 왼쪽 위 칸(0부터) */
  col: z.number().int().min(0),
  row: z.number().int().min(0),
  /** 차지하는 칸 수(병합) */
  colSpan: z.number().int().min(1).default(1),
  rowSpan: z.number().int().min(1).default(1),
  /** 좌석에 앉은 사람 users.id. 공석·공간·글자는 null */
  userId: z.string().nullable().default(null),
  /** 공간·글자의 이름, 좌석의 메모(예: 소장). 줄바꿈 가능 */
  label: z.string().default(''),
});
export type SeatBlock = z.infer<typeof seatBlockSchema>;

export const SEAT_GRID_LIMITS = { minCols: 4, maxCols: 80, minRows: 2, maxRows: 60 } as const;

export const seatGridSchema = z.object({
  cols: z.number().int().min(SEAT_GRID_LIMITS.minCols).max(SEAT_GRID_LIMITS.maxCols).default(33),
  rows: z.number().int().min(SEAT_GRID_LIMITS.minRows).max(SEAT_GRID_LIMITS.maxRows).default(17),
  blocks: z.array(seatBlockSchema).default([]),
});
export type SeatGrid = z.infer<typeof seatGridSchema>;

export const seatLayoutSchema = z.object({
  id: z.string().min(1),
  /** 배치도 이름(예: 본사 7층). */
  name: z.string().min(1, '배치도 이름은 필수입니다'),
  /** 격자와 블록 — 저장소에는 JSON 문자열(grid)로 둔다 */
  grid: seatGridSchema.default({ cols: 33, rows: 17, blocks: [] }),
  /** 탭 순서. */
  sortOrder: z.number().int().default(0),
  updatedBy: z.string().default(''),
  updatedAt: z.string().default(''),
});
export type SeatLayout = z.infer<typeof seatLayoutSchema>;
