/**
 * 사람 소속(부서·직급·직책) 변환 — 본직의 기준은 인명관리에 저장된 ID다.
 * 읽을 때는 ID로 기준정보의 현재 이름을 찾고, 저장할 때는 화면에서 고른 이름을 ID로 바꾼다.
 * ([[docs/superpowers/specs/2026-10-19-affiliation-ids-design.md]])
 */
export interface OrgMasters {
  depts: { id: string; name: string }[];
  positions: { id: string; name: string }[];
  jobTitles: { id: string; name: string }[];
}

export interface AffiliationIds {
  deptId: string | null;
  positionId: string | null;
  jobTitleId: string | null;
}

export type Affiliation = AffiliationIds & { dept: string; position: string; jobTitle: string };

type Named = { id: string; name: string };
const nameOf = (list: Named[], id?: string | null) => (id ? list.find((x) => x.id === id)?.name : undefined);
const idOf = (list: Named[], name?: string) => (name ? list.find((x) => x.name === name)?.id : undefined);

export function resolveAffiliation(ids: Partial<AffiliationIds>, masters: OrgMasters, opts: { isTest?: boolean } = {}): Affiliation {
  return {
    deptId: ids.deptId ?? null,
    dept: nameOf(masters.depts, ids.deptId) ?? (opts.isTest ? '테스트' : '미지정'),
    positionId: ids.positionId ?? null,
    position: nameOf(masters.positions, ids.positionId) ?? '사원',
    jobTitleId: ids.jobTitleId ?? null,
    jobTitle: nameOf(masters.jobTitles, ids.jobTitleId) ?? '',
  };
}

/** 고른 이름을 ID로 — 이름으로 못 찾으면(화면에 남은 옛 이름 등) 기존 ID를 유지한다. 직책 빈칸은 '직책 없음'. */
export function affiliationIdsFromNames(
  names: { dept?: string; position?: string; jobTitle?: string },
  masters: OrgMasters,
  fallback: Partial<AffiliationIds> = {},
): AffiliationIds {
  return {
    deptId: idOf(masters.depts, names.dept) ?? fallback.deptId ?? null,
    positionId: idOf(masters.positions, names.position) ?? fallback.positionId ?? null,
    jobTitleId: names.jobTitle === '' ? null : (idOf(masters.jobTitles, names.jobTitle) ?? fallback.jobTitleId ?? null),
  };
}
