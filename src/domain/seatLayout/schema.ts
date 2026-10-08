import { z } from 'zod';

/**
 * 좌석 배치도 seatLayouts. PK=id. 조직도 > 좌석배치도 탭.
 *
 * 배치도 한 장(층·구역)이 문서 하나다. 이미지는 Storage에 두고 경로만 저장하며,
 * 좌석 위치는 이미지 기준 백분율(0~100)이라 화면 크기·배율과 무관하게 같은 자리에 그려진다.
 * 수정은 운영자·임원만 한다(화면에서 판정).
 */
export const seatSchema = z.object({
  /** 좌석 ID — 배치도 안에서만 유일. */
  id: z.string().min(1),
  /** 이미지 폭 기준 가로 위치(%) — 좌석 카드의 중심. */
  x: z.number().min(0).max(100),
  /** 이미지 높이 기준 세로 위치(%) — 좌석 카드의 중심. */
  y: z.number().min(0).max(100),
  /** 앉은 사람 users.id. 빈 좌석이면 null. */
  userId: z.string().nullable().default(null),
  /** 빈 좌석·공용석 등에 붙이는 이름(예: 회의석, 방문석). */
  label: z.string().default(''),
});
export type Seat = z.infer<typeof seatSchema>;

export const seatLayoutSchema = z.object({
  id: z.string().min(1),
  /** 배치도 이름(예: 본사 3층). */
  name: z.string().min(1, '배치도 이름은 필수입니다'),
  /** 배치도 이미지의 Storage 경로(교체·정리용). */
  imagePath: z.string().default(''),
  /** 배치도 이미지 표시 URL — 업로드 때 받은 값. */
  imageUrl: z.string().default(''),
  seats: z.array(seatSchema).default([]),
  /** 탭 순서. */
  sortOrder: z.number().int().default(0),
  updatedBy: z.string().default(''),
  updatedAt: z.string().default(''),
});
export type SeatLayout = z.infer<typeof seatLayoutSchema>;
