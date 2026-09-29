import { z } from 'zod';
import { isValidCalendarDate } from '@/domain/calendarEvent/calendarDate';

/**
 * 업무계획 — 이사진 등이 구글시트로 적던 개인 업무 예정을 옮겨오는 자리.
 *
 * 그룹웨어 일정관리와 다른 점: **공유 범위가 없다.** 나만 보기/부서 공유 같은 개념 자체가
 * 없고 "전체 보기"에서는 누구나 서로의 항목을 본다 — 회사 전체가 서로의 영업 일정을
 * 한눈에 보자는 목적이라 공개가 기본값이다. 대신 **고치는 건 본인 것만** 가능하다.
 * 시간 개념도 없다 — "그날 무엇을 하는지" 한 줄이면 충분해서 시작/종료 시각을 안 받는다.
 *
 * 제목/메모로 나누지 않는다 — 구글시트 한 칸에 적던 습관 그대로, 한 사람의 하루는
 * 자유 형식 텍스트 한 덩어리(`content`)다.
 */
export const workPlanSchema = z.object({
  id: z.string().regex(/^WP-\d{8}-\d{4}$/, '업무계획 ID 형식이 올바르지 않습니다.'),
  ownerUserId: z.string().min(1),
  date: z.string().refine(isValidCalendarDate, '올바른 날짜를 입력하세요.'),
  content: z.string().trim().min(1, '내용을 입력하세요.').max(1_000),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type WorkPlan = z.infer<typeof workPlanSchema>;
export type WorkPlanDraft = Omit<WorkPlan, 'id' | 'createdAt' | 'updatedAt' | 'ownerUserId'> & { ownerUserId?: string };
