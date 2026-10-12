/**
 * 인원 목록 정렬 — 근태·업무계획 등 사람을 줄 세우는 화면의 공통 기준.
 *
 * 1. 임원(그룹권한관리의 '임원' 그룹 소속) — 부서와 무관하게 맨 위, 임원끼리는 직급 → 직책 → 이름
 * 2. 그 외 — 부서(조직도 순서) → 직책 → 직급 → 이름
 *
 * 임원 판정·부서 순서·직급 서열은 화면 쪽 데이터에서 주입한다([[useRosterOrder]]).
 */
export interface RosterPerson {
  name?: string | null;
  dept?: string | null;
  position?: string | null;
  jobTitle?: string | null;
}

export interface RosterOrderContext {
  isExecutive: (p: RosterPerson) => boolean;
  /** 조직도 순서(작을수록 위). 모르는 부서는 큰 값. */
  deptOrder: (dept: string) => number;
  /** 직급 서열(작을수록 위). */
  positionRank: (position: string) => number;
}

/** 직책 서열(작을수록 위). 포함 관계가 있는 이름(부위원장⊃위원장, 부팀장⊃팀장)은 긴 쪽을 먼저 본다. */
export function jobTitleRank(jobTitle?: string | null): number {
  const t = (jobTitle ?? '').trim();
  if (t.includes('부위원장')) return 2;
  if (t.includes('위원장') || t.includes('대표')) return 1;
  if (t.includes('임원') || t.includes('본부장')) return 3;
  if (t.includes('센터장') || t.includes('소장') || t.includes('실장')) return 4;
  if (t.includes('부팀장') || t.includes('파트장') || t.includes('그룹장')) return 6;
  if (t.includes('팀장') || t.includes('부서장')) return 5;
  return 10;
}

export function compareRoster(a: RosterPerson, b: RosterPerson, ctx: RosterOrderContext): number {
  const execA = ctx.isExecutive(a);
  const execB = ctx.isExecutive(b);
  if (execA !== execB) return execA ? -1 : 1;

  const byPosition = () => ctx.positionRank(a.position ?? '') - ctx.positionRank(b.position ?? '');
  const byTitle = () => jobTitleRank(a.jobTitle) - jobTitleRank(b.jobTitle);
  const byName = () => (a.name ?? '').localeCompare(b.name ?? '', 'ko');

  if (execA) return byPosition() || byTitle() || byName();

  const deptA = a.dept ?? '';
  const deptB = b.dept ?? '';
  return (
    ctx.deptOrder(deptA) - ctx.deptOrder(deptB) ||
    deptA.localeCompare(deptB, 'ko') ||
    byTitle() ||
    byPosition() ||
    byName()
  );
}
