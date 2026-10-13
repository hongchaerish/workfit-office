import { z } from 'zod';
import { isValidCalendarDate } from './calendarDate';

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, '시각은 HH:mm 형식이어야 합니다.');

/**
 * 일정 공개 범위.
 *
 * 앞의 셋은 업무관리 `WORK_VISIBILITIES`와 같은 뜻이다 — 같은 말을 다르게 쓰면 화면마다
 * 다른 규칙인 줄 알게 된다. `PROJECT`만 일정에 더 있는 축으로, 부서와 무관하게 특정
 * 프로젝트 참여자에게만 보인다.
 */
export const CALENDAR_VISIBILITIES = ['PRIVATE', 'TEAM', 'COMPANY', 'PROJECT'] as const;

export const CALENDAR_VISIBILITY_LABELS: Record<CalendarVisibility, string> = {
  PRIVATE: '나만 보기',
  TEAM: '부서 공유',
  COMPANY: '전사 공개',
  PROJECT: '프로젝트 공유',
};

export const CALENDAR_EVENT_TYPES = ['GENERAL', 'MEETING', 'COMPANY_EVENT', 'OUTSIDE', 'VACATION'] as const;
export type CalendarEventType = (typeof CALENDAR_EVENT_TYPES)[number];

export const CALENDAR_EVENT_TYPE_LABELS: Record<CalendarEventType, { label: string; icon: string; badgeClass: string }> = {
  GENERAL: { label: '일반 일정', icon: '📝', badgeClass: 'bg-slate-500/10 text-slate-600 border-slate-500/20' },
  MEETING: { label: '회의·미팅', icon: '👥', badgeClass: 'bg-purple-500/10 text-purple-600 border-purple-500/20' },
  COMPANY_EVENT: { label: '사내행사', icon: '🎉', badgeClass: 'bg-teal-500/10 text-teal-600 border-teal-500/20' },
  OUTSIDE: { label: '외근·출장', icon: '🔵', badgeClass: 'bg-blue-500/10 text-blue-600 border-blue-500/20' },
  VACATION: { label: '휴가·부재', icon: '🏖️', badgeClass: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20' },
};

export const calendarEventSchema = z.object({
  id: z.string().regex(/^CAL-\d{8}-\d{4}$/, '일정 ID 형식이 올바르지 않습니다.'),
  ownerUserId: z.string().min(1),
  title: z.string().trim().min(1, '일정 제목을 입력하세요.').max(100),
  date: z.string().refine(isValidCalendarDate, '올바른 일정 날짜를 입력하세요.'),
  allDay: z.boolean(),
  startTime: timeSchema.nullable(),
  endTime: timeSchema.nullable(),
  memo: z.string().trim().max(2_000),
  /*
    기존 일정에는 이 세 필드가 없다. 마이그레이션 없이 읽히도록 기본값을 둔다 —
    값이 없으면 `PRIVATE`, 즉 **지금까지처럼 나만 보이는 일정**이 된다. 기본값을 공유 쪽으로
    두면 마이그레이션 한 번 빠뜨렸을 때 남의 일정이 통째로 열린다.
  */
  visibility: z.enum(CALENDAR_VISIBILITIES).default('PRIVATE'),
  /** 일정 성격 (일반, 회의, 사내행사, 외근·출장, 휴가) */
  eventType: z.enum(CALENDAR_EVENT_TYPES).default('GENERAL'),
  /** 함께하는 참여자 사원 ID 목록 (회의 참석자 등) */
  attendeeUserIds: z.array(z.string()).default([]),
  /** `TEAM`일 때 공유 대상 부서. 그 외 범위에서는 판정에 쓰이지 않는다. */
  deptId: z.string().nullable().default(null),
  /** `PROJECT`일 때 공유 대상 프로젝트. 그 외 범위에서는 판정에 쓰이지 않는다. */
  projectId: z.string().nullable().default(null),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  /**
   * 시작 10분 전 리마인더를 보냈는지 — `calendar-reminder` Function 전용 필드다.
   * 화면은 이 값을 직접 안 다룬다(`CalendarEventDraft`에서 뺌). 예전 문서는 필드가 없어도
   * 기본값 false로 읽혀 리마인더 대상이 될 수 있지만, 이미 지난 날짜라 스케줄 쿼리
   * (오늘 날짜만 훑음) 밖이라 실제로 다시 보내지지 않는다.
   */
  reminded: z.boolean().default(false),
}).superRefine((value, ctx) => {
  if (value.allDay && (value.startTime !== null || value.endTime !== null)) {
    ctx.addIssue({ code: 'custom', path: ['startTime'], message: '종일 일정에는 시작·종료 시각을 지정할 수 없습니다.' });
  }
  if (!value.allDay && (!value.startTime || !value.endTime)) {
    ctx.addIssue({ code: 'custom', path: ['startTime'], message: '시간 일정에는 시작·종료 시각이 필요합니다.' });
  }
  if (!value.allDay && value.startTime && value.endTime && value.startTime >= value.endTime) {
    ctx.addIssue({ code: 'custom', path: ['endTime'], message: '종료 시각은 시작 시각보다 늦어야 합니다.' });
  }
  /*
    대상 없는 공유는 막는다. 부서 공유인데 부서가 비면 아무에게도 안 보이는데 화면에는
    "공유됨"으로 뜬다 — 공유한 줄 알고 있다가 아무도 못 보는 쪽이 제일 나쁘다.
  */
  if (value.visibility === 'TEAM' && !value.deptId) {
    ctx.addIssue({ code: 'custom', path: ['deptId'], message: '부서 공유 일정에는 공유할 부서가 필요합니다.' });
  }
  if (value.visibility === 'PROJECT' && !value.projectId) {
    ctx.addIssue({ code: 'custom', path: ['projectId'], message: '프로젝트 공유 일정에는 공유할 프로젝트가 필요합니다.' });
  }
});

export type CalendarEvent = z.infer<typeof calendarEventSchema>;
export type CalendarVisibility = (typeof CALENDAR_VISIBILITIES)[number];
export type CalendarEventDraft = Omit<
  CalendarEvent,
  'id' | 'ownerUserId' | 'createdAt' | 'updatedAt' | 'reminded' | 'eventType' | 'attendeeUserIds'
> & {
  eventType?: CalendarEventType;
  attendeeUserIds?: string[];
};
