/**
 * 근태 열람 범위 판단에 쓰는 순수 함수 — DB 조회는 main.js가 하고 여기서는 판단만 한다.
 *
 * 사람의 본직 소속은 인명관리(employeeProfiles)의 기준정보 ID(deptId·positionId·jobTitleId)가 기준이다.
 * 계정(users)의 dept·position·jobTitle 칸은 옛 사본이라 보지 않는다.
 * 이 함수 모음은 웹 앱의 `resolveAffiliation`과 같은 규칙이다(함수가 따로 배포되어 코드를 공유하지 못한다).
 * 단, 못 찾으면 빈 문자열 — 예전처럼 "소속 없음"을 그대로 다룬다.
 */

const nameOf = (list, id) => (id ? list.find((x) => x.$id === id)?.name ?? '' : '');

/** uid의 본직 소속(ID와 현재 이름). 인명관리가 없으면 모두 빈 값. */
export function affiliationOf(uid, profiles, masters) {
  const p = profiles.find((x) => x.userId === uid) ?? {};
  return {
    deptId: p.deptId ?? null,
    dept: nameOf(masters.depts, p.deptId),
    positionId: p.positionId ?? null,
    position: nameOf(masters.positions, p.positionId),
    jobTitleId: p.jobTitleId ?? null,
    jobTitle: nameOf(masters.jobTitles, p.jobTitleId),
  };
}

/**
 * 권한 매핑(roleMappings) 한 줄이 요청자에게 해당하는지.
 * 부서·직급 대상은 예전 데이터에 ID로도 이름으로도 들어 있어 둘 다 맞춘다.
 */
export function matchesExecMapping(m, { uid, empNo, myName, aff }) {
  if (m.targetType === 'USER') {
    return m.targetId === uid || (!!empNo && m.targetId === empNo) || (!!myName && !!m.targetName && m.targetName.includes(myName));
  }
  if (m.targetType === 'DEPT' && aff.deptId) {
    return m.targetId === aff.deptId || m.targetId === aff.dept || m.targetName === aff.dept;
  }
  if (m.targetType === 'POSITION' && aff.positionId) {
    return m.targetId === aff.positionId || m.targetId === aff.position || m.targetName === aff.position;
  }
  return false;
}

/**
 * 부서장 열람 범위 — 맡은 부서(departments.headUserId)의 인명관리 소속자 전원.
 * 맡은 부서가 없어도 팀장·부서장 직책(또는 테스트 부서장 testB)이면 자기 부서를 본다.
 */
export function headScope({ uid, aff, depts, profiles, users }) {
  const headed = depts.filter((d) => d.headUserId === uid);
  let deptIds = headed.map((d) => d.$id);
  let deptNames = headed.map((d) => String(d.name));

  const me = users.find((u) => u.id === uid);
  if (deptIds.length === 0 && aff.deptId) {
    const jobText = `${aff.position} ${aff.jobTitle} ${me?.name ?? ''}`.toLowerCase();
    if (jobText.includes('팀장') || jobText.includes('부서장') || jobText.includes('testb')) {
      deptIds = [aff.deptId];
      deptNames = [aff.dept];
    }
  }

  const ids = new Set(deptIds);
  const memberIds = new Set(profiles.filter((p) => ids.has(p.deptId)).map((p) => p.userId));
  const memberNames = new Set(users.filter((u) => memberIds.has(u.id)).map((u) => String(u.name).trim()));
  return { deptNames, memberNames };
}
