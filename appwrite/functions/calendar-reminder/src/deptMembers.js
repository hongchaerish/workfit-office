/**
 * 부서 공유 일정의 리마인더 대상 — 그 부서 소속 재직자.
 *
 * 사람의 본직 부서는 인명관리(employeeProfiles)의 deptId가 기준이다. 계정(users)의 dept 칸은 옛 사본이라 보지 않는다.
 * 세 소속 ID가 모두 비어 있는 프로필(기존 데이터 채우기 전)은 예전 이름 칸으로 찾는다 — 웹 앱과 같은 규칙.
 */
export function deptMemberIdsFrom(dept, profiles, users) {
  const active = new Set(users.filter((u) => u.status === '사용').map((u) => u.$id));
  const inDept = (p) => (p.deptId || p.positionId || p.jobTitleId ? p.deptId === dept.$id : p.dept === dept.name);
  return profiles.filter((p) => active.has(p.userId) && inDept(p)).map((p) => p.userId);
}
