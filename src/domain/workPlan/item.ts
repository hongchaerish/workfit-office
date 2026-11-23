import { z } from 'zod';
import { isValidCalendarDate } from '@/domain/calendarEvent/calendarDate';
import { routineSchema } from './routine';
import { toHHmm, type MinuteRange } from './timeGrid';

// calendarEvent의 timeSchema와 같은 식 — 24:00은 받지 않는다.
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, '시각은 HH:mm 형식이어야 합니다.');

/** 업무계획 항목 — 한 사람의 하루 칸 하나. */
export const workPlanItemSchema = z.object({
  id: z.string().regex(/^WI-\d{8}-\d{4}$/, '항목 ID 형식이 올바르지 않습니다.'),
  ownerUserId: z.string().min(1),
  date: z.string().refine(isValidCalendarDate, '올바른 날짜를 입력하세요.'),
  allDay: z.boolean(),
  startTime: timeSchema.nullable(),
  endTime: timeSchema.nullable(),
  tagId: z.string().min(1).max(64),
  title: z.string().trim().min(1, '제목을 입력하세요.').max(100),
  memo: z.string().trim().max(1_000),
  /** 루틴(반복)으로 만든 항목 — 같은 id 끼리 '이후 모두' 고치기·지우기. 예전 항목은 없다 */
  routine: routineSchema.nullable().optional(),
  createdBy: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).superRefine((value, ctx) => {
  if (value.allDay) {
    if (value.startTime !== null || value.endTime !== null) {
      ctx.addIssue({ code: 'custom', path: ['startTime'], message: '종일 항목에는 시작·종료 시각을 지정할 수 없습니다.' });
    }
    return;
  }
  // 종료는 비워 둘 수 있다(종료 미정 — 시작만 아는 업무)
  if (!value.startTime) {
    ctx.addIssue({ code: 'custom', path: ['startTime'], message: '시간 항목에는 시작 시각이 필요합니다.' });
    return;
  }
  if (value.endTime !== null && value.startTime >= value.endTime) {
    ctx.addIssue({ code: 'custom', path: ['endTime'], message: '종료 시각은 시작 시각보다 늦어야 합니다.' });
  }
});

export type WorkPlanItem = z.infer<typeof workPlanItemSchema>;
export type WorkPlanItemDraft = Pick<WorkPlanItem, 'date' | 'allDay' | 'startTime' | 'endTime' | 'tagId' | 'title' | 'memo'>;

/**
 * 항목을 옮긴 내용 — 날짜와, 시간표에서 옮겼다면 시각만 바뀐다. 태그·제목·메모는 그대로다.
 * 종료 미정 항목은 옮겨도 종료 미정으로 남는다.
 */
export function movedDraft(item: WorkPlanItem, date: string, range?: MinuteRange): WorkPlanItemDraft {
  const { allDay, startTime, endTime, tagId, title, memo } = item;
  if (!range) return { date, allDay, startTime, endTime, tagId, title, memo };
  return { date, allDay, startTime: toHHmm(range.start), endTime: endTime === null ? null : toHHmm(range.end), tagId, title, memo };
}
