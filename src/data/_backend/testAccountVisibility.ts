import { isTestAccount, type TestAccountLike } from '@/domain/user/testAccount';

/**
 * 테스트 계정 공개 범위 — 사람 마스터 repo 가 `list()` 에서 공통으로 쓰는 필터.
 *
 * 볼 수 있는 접속자(테스트 계정·토글을 켠 최고관리자)에게만 테스트 계정이 보이고, 그 외에는 숨긴다.
 * 접속자 정보는 로그인·역할 확정 시 `TestAccountVisibilitySync` 가 넣어 준다.
 * 접속자를 아직 모르면 숨김 쪽으로 동작한다(새는 것보다 늦게 보이는 편이 낫다).
 *
 * repo 의 쓰기·채번 경로는 반드시 숨기지 않은 전체 목록(`listIncludingTestAccounts`)을 써야 한다.
 * 숨긴 목록으로 다음 ID 를 매기면 테스트 계정 ID 와 겹쳐 그 문서를 덮어쓰게 된다.
 */
let viewerCanSee = false;
let testUserIds: Set<string> | null = null;
let source: (() => Promise<TestAccountLike[]>) | null = null;
let pending: Promise<Set<string>> | null = null;

/** 접속자가 테스트 계정을 볼 수 있는지 설정한다. 값이 바뀌었으면 true(호출부가 캐시를 새로 읽는다). */
export function setViewerCanSeeTestAccounts(canSee: boolean): boolean {
  const changed = viewerCanSee !== canSee;
  viewerCanSee = canSee;
  return changed;
}

export function viewerCanSeeTestAccounts(): boolean {
  return viewerCanSee;
}

/** 테스트 계정 ID 목록을 처음 알아낼 때 쓸 원본(숨김 없는 users 원본 목록). userRepo 가 등록한다. */
export function registerTestAccountSource(load: () => Promise<TestAccountLike[]>): void {
  source = load;
}

/** 방금 읽은 사용자 원본에서 테스트 계정 ID 를 갱신한다. */
export function rememberTestAccounts(users: TestAccountLike[]): Set<string> {
  testUserIds = new Set(users.filter((u) => isTestAccount(u) && u.id).map((u) => u.id as string));
  return testUserIds;
}

/** 이미 알려진 테스트 계정 ID 인지(화면의 동기 판단용 — 사용자 목록을 한 번이라도 읽은 뒤에 정확하다). */
export function isKnownTestUserId(id?: string | null): boolean {
  return !!id && !!testUserIds?.has(id);
}

export async function loadTestUserIds(): Promise<Set<string>> {
  if (testUserIds) return testUserIds;
  if (!source) return new Set();
  pending ??= source()
    .then(rememberTestAccounts)
    .finally(() => {
      pending = null;
    });
  return pending;
}

/**
 * 접속자가 볼 수 없으면 테스트 계정 행을 뺀다.
 * @param userIdsOf 행이 가리키는 사용자 ID 들(그중 하나라도 테스트 계정이면 숨김)
 * @param isTestRow 행 자체에 테스트 표식이 있는지(이름·부서 등) — ID 로 못 잡는 경우 보완
 */
export async function hideTestAccountRows<T>(
  rows: T[],
  userIdsOf: (row: T) => Array<string | null | undefined>,
  isTestRow?: (row: T) => boolean,
): Promise<T[]> {
  if (viewerCanSee) return rows;
  const ids = await loadTestUserIds();
  return rows.filter((row) => !isTestRow?.(row) && !userIdsOf(row).some((id) => !!id && ids.has(id)));
}

/** 테스트 전용 — 모듈 상태 초기화. */
export function resetTestAccountVisibilityForTest(): void {
  viewerCanSee = false;
  testUserIds = null;
  source = null;
  pending = null;
}
