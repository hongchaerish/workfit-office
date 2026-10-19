import { userRepo } from '@/data/user/user.repo';
import { employeeProfileRepo } from '@/data/employeeProfile/employeeProfile.repo';
import { departmentMemberRepo } from '@/data/departmentMember/departmentMember.repo';

/*
 * 조직 기준정보(부서·직급·직책)와 사람 소속 사이의 규칙.
 * 사람의 본직 소속은 인명관리에 기준정보 ID로만 저장된다 — 기준정보 이름을 바꿔도 사람 쪽은 고칠 것이 없다.
 * 여기서는 부서장 직책 지정과, 쓰는 사람이 있는 기준정보의 삭제 차단만 다룬다.
 */

/** 한 사람의 직책을 인명관리와 본직 소속행에 저장한다(부서장 지정·해제 등). 이름은 저장소가 ID로 바꾼다. */
export async function setPersonJobTitle(userId: string, jobTitle: string): Promise<void> {
  const profile = (await employeeProfileRepo.listIncludingTestAccounts()).find((p) => p.userId === userId || p.id === userId);
  if (profile && profile.jobTitle !== jobTitle) {
    await employeeProfileRepo.save({ ...profile, jobTitle }, { keepAttendanceTarget: true });
  }
  for (const m of await departmentMemberRepo.listByUserId(userId)) {
    if (m.isPrimary && m.jobTitle !== jobTitle) await departmentMemberRepo.save({ ...m, jobTitle });
  }
}

/** 재직자(계정 '미사용' 제외)의 인명관리 프로필. */
async function activeProfiles() {
  const [users, profiles] = await Promise.all([userRepo.listIncludingTestAccounts(), employeeProfileRepo.listIncludingTestAccounts()]);
  const active = new Set(users.filter((u) => u.status !== '미사용').map((u) => u.id));
  return { active, profiles: profiles.filter((p) => active.has(p.userId)) };
}

/**
 * 부서를 지울 수 없는 이유 — 지울 수 있으면 null.
 * 사람이 남은 채 지우면 그 사람들의 소속이 사라진다. 퇴직자는 따지지 않는다.
 */
export async function departmentDeleteBlocker(
  dept: { id: string; name: string },
  allDepts: { id: string; name: string; parentId: string | null }[],
): Promise<string | null> {
  const children = allDepts.filter((d) => d.parentId === dept.id);
  if (children.length) return `하위 부서(${children.map((d) => d.name).join(', ')})가 있어 삭제할 수 없습니다. 하위 부서를 먼저 옮기거나 삭제하세요.`;

  const { active, profiles } = await activeProfiles();
  const members = profiles.filter((p) => p.deptId === dept.id).length;
  if (members) return `소속 인원 ${members}명이 있어 삭제할 수 없습니다. 인명관리에서 다른 부서로 옮긴 뒤 삭제하세요.`;

  const concurrent = (await departmentMemberRepo.listByDeptId(dept.id)).filter((m) => !m.isPrimary && active.has(m.userId));
  if (concurrent.length) return `겸직자 ${concurrent.length}명이 있어 삭제할 수 없습니다. 인명관리에서 겸직을 해제한 뒤 삭제하세요.`;
  return null;
}

/** 직급을 지울 수 없는 이유 — 지울 수 있으면 null. */
export async function positionDeleteBlocker(positionId: string): Promise<string | null> {
  const n = (await activeProfiles()).profiles.filter((p) => p.positionId === positionId).length;
  return n ? `이 직급을 쓰는 직원 ${n}명이 있어 삭제할 수 없습니다. 인명관리에서 직급을 바꾼 뒤 삭제하세요.` : null;
}

/** 직책을 지울 수 없는 이유 — 지울 수 있으면 null. 겸직 직책도 센다. */
export async function jobTitleDeleteBlocker(jobTitleId: string): Promise<string | null> {
  const { active, profiles } = await activeProfiles();
  const ids = new Set(profiles.filter((p) => p.jobTitleId === jobTitleId).map((p) => p.userId));
  for (const m of await departmentMemberRepo.list()) {
    if (!m.isPrimary && m.jobTitleId === jobTitleId && active.has(m.userId)) ids.add(m.userId);
  }
  return ids.size ? `이 직책을 맡은 직원 ${ids.size}명이 있어 삭제할 수 없습니다. 인명관리에서 직책을 바꾼 뒤 삭제하세요.` : null;
}
