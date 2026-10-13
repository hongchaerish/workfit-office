/**
 * 인원 목록 정렬 — 근태·업무계획 등 사람을 줄 세우는 화면의 공통 기준.
 *
 * 0. 관리자가 업무계획에서 정한 전 직원 정렬 순서 — 순서에 든 사람이 그 순서대로 맨 먼저(전사 공통 설정)
 * 1. (순서에 없는 사람) 임원(그룹권한관리의 '임원' 그룹 소속) — 부서와 무관하게 위, 임원끼리는 직급 → 직책 → 이름
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
  /** 관리자가 정한 전 직원 정렬 순서(작을수록 위). 순서에 없으면 null. */
  displayOrder?: (p: RosterPerson) => number | null | undefined;
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

/** 표시 순서를 지정한 쪽이 먼저, 둘 다 지정했으면 숫자 순. 둘 다 없으면 0(다음 기준으로). */
function byDisplayOrder(a: RosterPerson, b: RosterPerson, ctx: RosterOrderContext): number {
  const oa = ctx.displayOrder?.(a);
  const ob = ctx.displayOrder?.(b);
  const hasA = oa != null;
  const hasB = ob != null;
  if (hasA && hasB) return oa - ob;
  if (hasA !== hasB) return hasA ? -1 : 1;
  return 0;
}

export function compareRoster(a: RosterPerson, b: RosterPerson, ctx: RosterOrderContext): number {
  const manual = byDisplayOrder(a, b, ctx);
  if (manual) return manual;

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
