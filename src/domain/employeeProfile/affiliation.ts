/**
 * 사람 소속(부서·직급·직책) 변환 — 본직의 기준은 인명관리에 저장된 ID다.
 * 읽을 때는 ID로 기준정보의 현재 이름을 찾고, 저장할 때는 화면에서 고른 이름을 ID로 바꾼다.
 * ([[docs/superpowers/specs/2026-10-19-affiliation-ids-design.md]])
 */
import { isTestAccount } from '@/domain/user/testAccount';

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
/** 고른 이름의 ID — 기존 ID가 같은 이름이면 그것(같은 이름이 둘 이상일 때 엉뚱한 쪽으로 옮겨 가지 않게). */
const pick = (list: Named[], name: string | undefined, current?: string | null) =>
  current && name && nameOf(list, current) === name ? current : idOf(list, name);

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

type StoredAffiliation = Partial<AffiliationIds> & { dept?: string; position?: string; jobTitle?: string };

/**
 * 저장된 소속 ID — 세 ID 중 하나라도 있으면 채워진 사람이라 ID만 쓴다.
 * 셋 다 비어 있으면(기존 데이터 채우기 전) 예전 이름 칸으로 찾는다. 채우기 순서가 어긋나도 소속·권한이 사라지지 않게.
 * (Appwrite는 빈 칸을 null로 돌려주므로 칸 하나로는 "안 채움"과 "없음"을 구분할 수 없다.)
 */
export function storedAffiliationIds(stored: StoredAffiliation, masters: OrgMasters): AffiliationIds {
  if (stored.deptId || stored.positionId || stored.jobTitleId) {
    return { deptId: stored.deptId ?? null, positionId: stored.positionId ?? null, jobTitleId: stored.jobTitleId ?? null };
  }
  return affiliationIdsFromNames({ dept: stored.dept, position: stored.position, jobTitle: stored.jobTitle }, masters);
}

/** 고른 이름을 ID로 — 이름으로 못 찾으면(화면에 남은 옛 이름 등) 기존 ID를 유지한다. 직책 빈칸은 '직책 없음'. */
export function affiliationIdsFromNames(
  names: { dept?: string; position?: string; jobTitle?: string },
  masters: OrgMasters,
  fallback: Partial<AffiliationIds> = {},
): AffiliationIds {
  return {
    deptId: pick(masters.depts, names.dept, fallback.deptId) ?? fallback.deptId ?? null,
    positionId: pick(masters.positions, names.position, fallback.positionId) ?? fallback.positionId ?? null,
    jobTitleId: names.jobTitle === '' ? null : (pick(masters.jobTitles, names.jobTitle, fallback.jobTitleId) ?? fallback.jobTitleId ?? null),
  };
}

/**
 * 사람 목록에 본직 소속 이름을 채운다 — 원본 인명관리(ID)만 쓰고 계정의 이름 칸은 무시한다.
 * 서버처럼 DB 원본을 직접 읽는 곳에서 쓴다(화면 쪽은 저장소가 같은 규칙으로 채운다).
 */
export function applyAffiliations<U extends { id: string; name: string; dept?: string; position?: string; jobTitle?: string }>(
  users: U[],
  profiles: ({ userId: string } & StoredAffiliation)[],
  masters: OrgMasters,
): (U & Affiliation)[] {
  const byUser = new Map(profiles.map((p) => [p.userId, p]));
  return users.map((u) => {
    const p = byUser.get(u.id);
    return { ...u, ...resolveAffiliation(p ? storedAffiliationIds(p, masters) : {}, masters, { isTest: isTestAccount(u) }) };
  });
}
