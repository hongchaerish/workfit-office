/**
 * 테스트 계정 판별 — 프로젝트 전체의 단일 기준.
 *
 * 공개 범위 원칙:
 * - 테스트 계정은 테스트 계정과 최고관리자에게만 보인다. 그 외 임직원에게는 어디에서도 보이지 않는다.
 * - 테스트 계정은 다른 임직원을 볼 수는 있지만 대화·결재선·참석자 등으로 지정할 수는 없다.
 *
 * 숨김은 사람 마스터 repo(users·employeeProfiles·departmentMembers)의 `list()` 에서 일괄 적용되므로
 * 새 화면·모듈은 별도 로직 없이 자동으로 따른다([[testAccountVisibility]]).
 */
export interface TestAccountLike {
  id?: string | null;
  name?: string | null;
  dept?: string | null;
  email?: string | null;
  loginId?: string | null;
}

const TEST_MARKERS = ['테스트', '테스터', 'test'];
/** 표식 없이 테스트용으로 쓰는 계정 이름. */
const TEST_ACCOUNT_NAMES = ['허진욱2'];

const hasTestMarker = (value?: string | null) => {
  const v = (value ?? '').toLowerCase();
  return v !== '' && TEST_MARKERS.some((m) => v.includes(m));
};

export function isTestAccount(user?: TestAccountLike | null): boolean {
  if (!user) return false;
  if (TEST_ACCOUNT_NAMES.includes((user.name ?? '').trim())) return true;
  return [user.name, user.dept, user.id, user.email, user.loginId].some(hasTestMarker);
}

/** 부서명이 테스트 부서인지. */
export function isTestDeptName(deptName?: string | null): boolean {
  return hasTestMarker(deptName);
}

/**
 * 지정(대화 상대·결재선·수신참조·참석자·담당자 등) 가능 여부 — 같은 쪽끼리만.
 * 테스트 계정이 임직원을, 임직원(최고관리자 포함)이 테스트 계정을 지정하면 상대 화면에 서로가 드러나기 때문이다.
 */
export function canDesignateUser(viewer: TestAccountLike | null | undefined, target: TestAccountLike): boolean {
  return isTestAccount(viewer) === isTestAccount(target);
}
