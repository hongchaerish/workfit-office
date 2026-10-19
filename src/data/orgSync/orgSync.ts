import { userRepo } from '@/data/user/user.repo';
import { employeeProfileRepo } from '@/data/employeeProfile/employeeProfile.repo';
import { departmentMemberRepo } from '@/data/departmentMember/departmentMember.repo';

/*
 * 조직 기준정보(부서·직급·직책)를 바꿀 때, 사람 쪽에 이름으로 복사돼 있는 값을 함께 맞춘다.
 * 사람의 소속·직급·직책은 계정(users)과 인명관리(employeeProfiles) 두 곳에 이름으로 저장돼 있고,
 * 화면마다 읽는 곳이 달라 한쪽만 바꾸면 화면끼리 값이 어긋난다.
 */

/**
 * 부서명 변경 후속 처리 — 부서명을 문자열로 들고 있는 곳을 모두 새 이름으로 맞춘다.
 *
 * 사람의 소속은 부서 ID가 아니라 이름으로 저장돼 있다(users.dept, employeeProfiles.dept).
 * 조직도는 인명관리(employeeProfiles.dept)를 계정보다 먼저 보므로, 계정만 바꾸면
 * 옛 이름의 가짜 부서에 부서원이 남고 새 이름 부서는 빈 채로 보인다.
 * 테스트 계정도 놓치지 않게 전체 목록에서 찾는다. 부서 문서 자체는 호출자가 이미 저장한다.
 */
export async function cascadeDepartmentRename({ deptId, oldName, newName }: { deptId: string; oldName: string; newName: string }): Promise<{ users: number; profiles: number; memberships: number }> {
  const result = { users: 0, profiles: 0, memberships: 0 };
  if (oldName === newName) return result;

  for (const u of await userRepo.listIncludingTestAccounts()) {
    if (u.dept !== oldName) continue;
    await userRepo.updateDept(u.id, newName);
    result.users++;
  }
  for (const p of await employeeProfileRepo.listIncludingTestAccounts()) {
    if (p.dept !== oldName) continue;
    // 부서명만 바꾼다 — 근태 대상 여부는 건드리지 않는다.
    await employeeProfileRepo.save({ ...p, dept: newName }, { keepAttendanceTarget: true });
    result.profiles++;
  }
  for (const m of await departmentMemberRepo.listByDeptId(deptId)) {
    if (m.deptName === newName) continue;
    await departmentMemberRepo.save({ ...m, deptName: newName });
    result.memberships++;
  }
  return result;
}

/** 한 사람의 직책을 계정·인명관리·본직 소속 정보에 함께 저장한다(부서장 지정·해제 등). */
export async function setPersonJobTitle(userId: string, jobTitle: string): Promise<void> {
  await userRepo.updateJobTitle(userId, jobTitle);
  const profile = (await employeeProfileRepo.listIncludingTestAccounts()).find((p) => p.userId === userId || p.id === userId);
  if (profile && profile.jobTitle !== jobTitle) {
    await employeeProfileRepo.save({ ...profile, jobTitle }, { keepAttendanceTarget: true });
  }
  for (const m of await departmentMemberRepo.listByUserId(userId)) {
    if (m.isPrimary && m.jobTitle !== jobTitle) await departmentMemberRepo.save({ ...m, jobTitle });
  }
}

/** 직급명 변경 후속 처리 — 계정·인명관리의 직급을 새 이름으로. */
export async function cascadePositionRename(oldName: string, newName: string): Promise<{ users: number; profiles: number }> {
  const result = { users: 0, profiles: 0 };
  if (oldName === newName) return result;
  for (const u of await userRepo.listIncludingTestAccounts()) {
    if (u.position !== oldName) continue;
    await userRepo.save({ ...u, position: newName });
    result.users++;
  }
  for (const p of await employeeProfileRepo.listIncludingTestAccounts()) {
    if (p.position !== oldName) continue;
    await employeeProfileRepo.save({ ...p, position: newName }, { keepAttendanceTarget: true });
    result.profiles++;
  }
  return result;
}

/** 직책명 변경 후속 처리 — 계정·인명관리·소속 정보의 직책을 새 이름으로. */
export async function cascadeJobTitleRename(oldName: string, newName: string): Promise<{ users: number; profiles: number; memberships: number }> {
  const result = { users: 0, profiles: 0, memberships: 0 };
  if (oldName === newName) return result;
  for (const u of await userRepo.listIncludingTestAccounts()) {
    if (u.jobTitle !== oldName) continue;
    await userRepo.save({ ...u, jobTitle: newName });
    result.users++;
  }
  for (const p of await employeeProfileRepo.listIncludingTestAccounts()) {
    if (p.jobTitle !== oldName) continue;
    await employeeProfileRepo.save({ ...p, jobTitle: newName }, { keepAttendanceTarget: true });
    result.profiles++;
  }
  for (const m of await departmentMemberRepo.list()) {
    if (m.jobTitle !== oldName) continue;
    await departmentMemberRepo.save({ ...m, jobTitle: newName });
    result.memberships++;
  }
  return result;
}

/**
 * 부서를 지울 수 없는 이유 — 지울 수 있으면 null.
 * 사람이 남은 채 지우면 그 사람들의 부서명만 남아 조직도에 이름만 있는 부서가 생긴다. 퇴직자는 따지지 않는다.
 */
export async function departmentDeleteBlocker(
  dept: { id: string; name: string },
  allDepts: { id: string; name: string; parentId: string | null }[],
): Promise<string | null> {
  const children = allDepts.filter((d) => d.parentId === dept.id);
  if (children.length) return `하위 부서(${children.map((d) => d.name).join(', ')})가 있어 삭제할 수 없습니다. 하위 부서를 먼저 옮기거나 삭제하세요.`;

  const users = await userRepo.listIncludingTestAccounts();
  const active = new Set(users.filter((u) => u.status !== '미사용').map((u) => u.id));
  const members = new Set(users.filter((u) => active.has(u.id) && u.dept === dept.name).map((u) => u.id));
  for (const p of await employeeProfileRepo.listIncludingTestAccounts()) {
    if (p.dept === dept.name && active.has(p.userId)) members.add(p.userId);
  }
  if (members.size) return `소속 인원 ${members.size}명이 있어 삭제할 수 없습니다. 인명관리에서 다른 부서로 옮긴 뒤 삭제하세요.`;

  const concurrent = (await departmentMemberRepo.listByDeptId(dept.id)).filter((m) => !m.isPrimary && active.has(m.userId));
  if (concurrent.length) return `겸직자 ${concurrent.length}명이 있어 삭제할 수 없습니다. 인명관리에서 겸직을 해제한 뒤 삭제하세요.`;
  return null;
}

/** 그 이름을 쓰는 재직자 수 — 계정·인명관리 중 어느 쪽에라도 있으면 센다. */
async function activePeopleUsing(field: 'position' | 'jobTitle', name: string): Promise<number> {
  const users = await userRepo.listIncludingTestAccounts();
  const active = new Set(users.filter((u) => u.status !== '미사용').map((u) => u.id));
  const ids = new Set(users.filter((u) => active.has(u.id) && u[field] === name).map((u) => u.id));
  for (const p of await employeeProfileRepo.listIncludingTestAccounts()) {
    if (p[field] === name && active.has(p.userId)) ids.add(p.userId);
  }
  return ids.size;
}

/** 직급을 지울 수 없는 이유 — 지울 수 있으면 null. */
export async function positionDeleteBlocker(name: string): Promise<string | null> {
  const n = await activePeopleUsing('position', name);
  return n ? `이 직급을 쓰는 직원 ${n}명이 있어 삭제할 수 없습니다. 인명관리에서 직급을 바꾼 뒤 삭제하세요.` : null;
}

/** 직책을 지울 수 없는 이유 — 지울 수 있으면 null. */
export async function jobTitleDeleteBlocker(name: string): Promise<string | null> {
  const n = await activePeopleUsing('jobTitle', name);
  return n ? `이 직책을 맡은 직원 ${n}명이 있어 삭제할 수 없습니다. 인명관리에서 직책을 바꾼 뒤 삭제하세요.` : null;
}
