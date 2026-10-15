import { z } from 'zod';
import { isValidCalendarDate } from '@/domain/calendarEvent/calendarDate';

/**
 * 외근·출장 직접 등록 — 결재 없이 본인이 올리는 외근·출장 카드.
 *
 * 결재 완료 외근·출장과 **같은 효력**을 갖는다: 업무계획·캘린더에 보이고, 근태(지각·미출근
 * 판정)와 재실 상태에도 외근·출장으로 반영된다(2026-10-15 결정). 공개 범위는 전사 공개
 * 고정이라 필드가 없다. 고치고 지우는 건 등록한 본인만.
 *
 * 결재 문서(`approvalDocs`)와는 완전히 별개 컬렉션이다 — 결재 문서는 읽기만 한다.
 */
export const OUTSIDE_WORK_CATEGORIES = ['OUTSIDE', 'TRIP'] as const;
export type OutsideWorkCategory = (typeof OUTSIDE_WORK_CATEGORIES)[number];

export const OUTSIDE_WORK_CATEGORY_LABELS: Record<OutsideWorkCategory, string> = {
  OUTSIDE: '외근',
  TRIP: '출장',
};

/** 세부 구분 — 결재 서식(outsideType·overseasType)과 같은 말을 써서 근태·칩 표기가 같게 나온다 */
export const OUTSIDE_WORK_SUBTYPES: Record<OutsideWorkCategory, readonly string[]> = {
  OUTSIDE: ['종일 외근', '오전 외근', '오후 외근', '시간 외근'],
  TRIP: ['국내출장', '해외출장'],
};

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, '시각은 HH:mm 형식이어야 합니다.');
const dateSchema = z.string().refine(isValidCalendarDate, '올바른 날짜를 입력하세요.');

export const outsideWorkSchema = z.object({
  id: z.string().regex(/^OW-\d{8}-\d{4}$/, '외근·출장 ID 형식이 올바르지 않습니다.'),
  ownerUserId: z.string().min(1),
  category: z.enum(OUTSIDE_WORK_CATEGORIES),
  subType: z.string().trim().min(1, '세부 구분을 고르세요.').max(20),
  startDate: dateSchema,
  endDate: dateSchema,
  allDay: z.boolean(),
  startTime: timeSchema.nullable(),
  endTime: timeSchema.nullable(),
  destination: z.string().trim().min(1, '장소를 입력하세요.').max(200),
  purpose: z.string().trim().max(500).default(''),
  companionUserIds: z.array(z.string()).default([]),
  transportation: z.string().trim().max(50).default(''),
  contact: z.string().trim().max(50).default(''),
  memo: z.string().trim().max(2_000).default(''),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).superRefine((value, ctx) => {
  if (value.endDate < value.startDate) {
    ctx.addIssue({ code: 'custom', path: ['endDate'], message: '종료일은 시작일보다 빠를 수 없습니다.' });
  }
  if (value.allDay && (value.startTime !== null || value.endTime !== null)) {
    ctx.addIssue({ code: 'custom', path: ['startTime'], message: '종일 일정에는 시작·종료 시각을 지정할 수 없습니다.' });
  }
  if (!value.allDay && (!value.startTime || !value.endTime)) {
    ctx.addIssue({ code: 'custom', path: ['startTime'], message: '시간을 정한 외근·출장에는 시작·종료 시각이 필요합니다.' });
  }
  if (!value.allDay && value.startTime && value.endTime && value.startTime >= value.endTime) {
    ctx.addIssue({ code: 'custom', path: ['endTime'], message: '종료 시각은 시작 시각보다 늦어야 합니다.' });
  }
  if (!OUTSIDE_WORK_SUBTYPES[value.category].includes(value.subType)) {
    ctx.addIssue({ code: 'custom', path: ['subType'], message: '세부 구분이 올바르지 않습니다.' });
  }
});

export type OutsideWork = z.infer<typeof outsideWorkSchema>;
export type OutsideWorkDraft = Omit<OutsideWork, 'id' | 'ownerUserId' | 'createdAt' | 'updatedAt'>;
