import type { User } from '@/domain/user/schema';
import { hasPlannedDay, type DayCell } from '@/domain/workPlan/dayEntries';
import { dayStatusOf } from './dayDetail';

/* 주간 표의 부서 묶음 — 내 부서 → 임원 → 나머지 부서(부서 관리 순서) → 소속 없음. 화면 의존 없음. */

export interface RosterGroup {
  key: string;
  label: string;
  members: User[];
}

export const EXEC_GROUP_KEY = '__EXEC__';
export const NONE_GROUP_KEY = '__NONE__';

/**
 * 사람을 부서 묶음으로 나눈다. 겸직 행(같은 id, 다른 dept)은 각 묶음에 하나씩, 임원은 임원 묶음에만.
 * 부서 관리에 없는 부서 이름은 자기 이름 묶음으로 뒤쪽에, 부서가 빈 사람은 맨 끝 '소속 없음'.
 */
export function groupRoster(
  members: User[],
  opts: { myDept: string | null; isExecutive: (u: User) => boolean; deptOrder: (dept: string) => number; compare: (a: User, b: User) => number },
): RosterGroup[] {
  const exec: User[] = [];
  const byDept = new Map<string, User[]>();
  const none: User[] = [];
  const seenExec = new Set<string>();
  for (const m of members) {
    if (opts.isExecutive(m)) {
      if (!seenExec.has(m.id)) {
        seenExec.add(m.id);
        exec.push(m);
      }
      continue;
    }
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
  const mine = opts.myDept && byDept.has(opts.myDept) ? opts.myDept : null;
  const out: RosterGroup[] = [];
  if (mine) out.push({ key: mine, label: mine, members: sortMembers(byDept.get(mine)!) });
  if (exec.length) out.push({ key: EXEC_GROUP_KEY, label: '임원', members: sortMembers(exec) });
  for (const d of depts) if (d !== mine) out.push({ key: d, label: d, members: sortMembers(byDept.get(d)!) });
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
