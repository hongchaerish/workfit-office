import { z } from 'zod';
import { isValidCalendarDate } from '@/domain/calendarEvent/calendarDate';

/*
  업무계획 루틴(반복 일정) — 규칙을 저장해 두고 펼쳐 그리는 대신, 저장할 때 날짜마다 항목을 만들고
  같은 루틴 id 로 묶는다. 표·목록·근태 쪽은 손대지 않아도 되고, '이 일정만/이후 모두'는 id 로 고른다.
*/

export const ROUTINE_FREQS = ['DAILY', 'WEEKDAYS', 'WEEKLY', 'MONTHLY'] as const;
export type RoutineFreq = (typeof ROUTINE_FREQS)[number];

export const ROUTINE_FREQ_LABEL: Record<RoutineFreq, string> = {
  DAILY: '매일',
  WEEKDAYS: '평일',
  WEEKLY: '매주',
  MONTHLY: '매월',
};

/** 한 번에 만드는 최대 횟수 — 1년 매일(365)도 막는다 */
export const ROUTINE_MAX_COUNT = 120;
/** 끝 날짜는 시작에서 1년까지 */
export const ROUTINE_MAX_DAYS = 366;

export const routineRuleSchema = z.object({
  freq: z.enum(ROUTINE_FREQS),
  /** WEEKLY 만 — 0(일) ~ 6(토) */
  days: z.array(z.number().int().min(0).max(6)).max(7),
  until: z.string().refine(isValidCalendarDate, '반복 끝 날짜가 올바르지 않습니다.'),
});
export type RoutineRule = z.infer<typeof routineRuleSchema>;

export const routineSchema = routineRuleSchema.extend({
  id: z.string().regex(/^WR-[0-9a-z]+-[0-9a-z]+$/, '루틴 ID 형식이 올바르지 않습니다.').max(40),
});
export type Routine = z.infer<typeof routineSchema>;

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

const toUtc = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const fromUtc = (t: Date) => t.toISOString().slice(0, 10);

export function addDays(date: string, days: number): string {
  const t = toUtc(date);
  t.setUTCDate(t.getUTCDate() + days);
  return fromUtc(t);
}

/** 'YYYY-MM-DD' 의 요일 0(일) ~ 6(토) */
export const weekdayOf = (date: string) => toUtc(date).getUTCDay();

/** 새 루틴의 처음 값 — 매주 그 요일, 3달 뒤까지 */
export function defaultRoutineRule(start: string): RoutineRule {
  const t = toUtc(start);
  t.setUTCMonth(t.getUTCMonth() + 3);
  return { freq: 'WEEKLY', days: [weekdayOf(start)], until: fromUtc(t) };
}

/** 규칙 확인 — 문제가 있으면 이유 */
export function validateRoutineRule(start: string, rule: RoutineRule): string | null {
  if (!isValidCalendarDate(rule.until)) return '반복 끝 날짜를 고르세요.';
  if (rule.until < start) return '반복 끝 날짜는 시작 날짜보다 빠를 수 없습니다.';
  if (rule.until > addDays(start, ROUTINE_MAX_DAYS)) return '반복은 1년까지 만들 수 있습니다.';
  if (rule.freq === 'WEEKLY' && rule.days.length === 0) return '반복할 요일을 고르세요.';
  return null;
}

/**
 * 규칙에 맞는 날짜(시작 ~ 끝, 오름차순, 최대 ROUTINE_MAX_COUNT). 시작 날짜가 규칙에 안 맞아도
 * 첫 번째로 넣는다(누른 칸에는 항상 만든다). 매월은 그 날짜가 없는 달(31일 등)을 건너뛴다.
 */
export function routineDates(start: string, rule: RoutineRule): string[] {
  if (validateRoutineRule(start, rule)) return [start];
  const dates = [start];
  const startDay = Number(start.slice(8));
  for (let date = addDays(start, 1); date <= rule.until && dates.length < ROUTINE_MAX_COUNT; date = addDays(date, 1)) {
    const dow = weekdayOf(date);
    const hit =
      rule.freq === 'DAILY' ||
      (rule.freq === 'WEEKDAYS' && dow >= 1 && dow <= 5) ||
      (rule.freq === 'WEEKLY' && rule.days.includes(dow)) ||
      (rule.freq === 'MONTHLY' && Number(date.slice(8)) === startDay);
    if (hit) dates.push(date);
  }
  return dates;
}

/** '매주 월·수 · 1/31까지' */
export function routineLabel(start: string, rule: RoutineRule): string {
  const [, m, d] = rule.until.split('-').map(Number);
  const until = `${m}/${d}까지`;
  switch (rule.freq) {
    case 'DAILY':
      return `매일 · ${until}`;
    case 'WEEKDAYS':
      return `평일 매일 · ${until}`;
    case 'WEEKLY': {
      // 월요일부터
      const days = [...rule.days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((day) => WEEKDAYS[day]);
      return `매주 ${days.join('·')} · ${until}`;
    }
    case 'MONTHLY':
      return `매월 ${Number(start.slice(8))}일 · ${until}`;
  }
}

/** 새 루틴 id — 'WR-<시각36진>-<임의4>' */
export function newRoutineId(now = Date.now(), random = Math.random): string {
  return `WR-${now.toString(36)}-${Math.floor(random() * 36 ** 4).toString(36).padStart(4, '0')}`;
}
