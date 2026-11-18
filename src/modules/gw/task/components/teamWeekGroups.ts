import type { User } from '@/domain/user/schema';
import { hasPlannedDay, type DayCell } from '@/domain/workPlan/dayEntries';
import { dayStatusOf } from './dayDetail';

/* 주간 표의 부서 묶음 — 부서 관리 순서 그대로(내 부서도 올리지 않는다) → 소속 없음. 임원도 자기 부서에. 화면 의존 없음. */

export interface RosterGroup {
  key: string;
  label: string;
  members: User[];
}

export const NONE_GROUP_KEY = '__NONE__';

/** 업무계획 한정 — 대표이사 계정은 '위원장'으로 보인다 */
export const isChairAccount = (m: User) => m.name === '대표이사' || m.position === '대표이사' || m.jobTitle === '대표이사';

/** 업무계획에서 위원장(대표이사 계정)이 들어갈 부서 */
export const CHAIR_DEPT = '기술경영전략위원회';

/** 업무계획 한정 — 위원장(대표이사 계정)은 '대표이사' 부서가 아니라 기술경영전략위원회의 위원장으로 보인다 */
export function chairToCommittee(members: User[], isChair: (u: User) => boolean): User[] {
  return members.map((m) => (isChair(m) ? { ...m, dept: CHAIR_DEPT } : m));
}

/**
 * 사람을 부서 묶음으로 나눈다. 겸직 행(같은 id, 다른 dept)은 각 묶음에 하나씩. 묶음 안 순서는 compare(임원·직책 먼저).
 * 부서 관리에 없는 부서 이름은 자기 이름 묶음으로 뒤쪽에, 부서가 빈 사람은 맨 끝 '소속 없음'.
 */
export function groupRoster(
  members: User[],
  opts: { deptOrder: (dept: string) => number; compare: (a: User, b: User) => number },
): RosterGroup[] {
  const byDept = new Map<string, User[]>();
  const none: User[] = [];
  for (const m of members) {
    const dept = (m.dept ?? '').trim();
    if (!dept) {
      if (!none.some((x) => x.id === m.id)) none.push(m);
      continue;
    }
    const list = byDept.get(dept) ?? [];
    if (!list.some((x) => x.id === m.id)) list.push(m);
    byDept.set(dept, list);
  }
  const sortMembers = (list: User[]) => [...list].sort(opts.compare);
  const depts = [...byDept.keys()].sort((a, b) => opts.deptOrder(a) - opts.deptOrder(b) || a.localeCompare(b, 'ko'));
  const out: RosterGroup[] = [];
  for (const d of depts) out.push({ key: d, label: d, members: sortMembers(byDept.get(d)!) });
  if (none.length) out.push({ key: NONE_GROUP_KEY, label: '소속 없음', members: sortMembers(none) });
  return out;
}

export interface GroupSummary {
  leave: number;
  outside: number;
  unwritten: number;
}

/** 계획 미작성 — 지나지 않은 주에서 평일(월~금)에 아무것도 없으면 (월간 표와 같은 규칙) */
export function isUnwrittenWeek(userId: string, cellOf: (userId: string, date: string) => DayCell, today: string, weekDates: string[]): boolean {
  return weekDates[6] >= today && weekDates.slice(0, 5).every((d) => !hasPlannedDay(cellOf(userId, d)));
}

/** 묶음 줄 요약 — 오늘 휴가·외근(출장 포함) 인원, 이번 주 미작성 인원 */
export function summarizeGroup(members: User[], cellOf: (userId: string, date: string) => DayCell, today: string, weekDates: string[]): GroupSummary {
  const sum: GroupSummary = { leave: 0, outside: 0, unwritten: 0 };
  const inWeek = weekDates.includes(today);
  for (const m of members) {
    if (inWeek) {
      const st = dayStatusOf(cellOf(m.id, today).entries);
      if (st.kind === 'leave') sum.leave += 1;
      else if (st.kind === 'outside' || st.kind === 'trip') sum.outside += 1;
    }
    if (isUnwrittenWeek(m.id, cellOf, today, weekDates)) sum.unwritten += 1;
  }
  return sum;
}
