import { userRepo } from '@/data/user/user.repo';
import { employeeProfileRepo } from '@/data/employeeProfile/employeeProfile.repo';
import { departmentMemberRepo } from '@/data/departmentMember/departmentMember.repo';

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
