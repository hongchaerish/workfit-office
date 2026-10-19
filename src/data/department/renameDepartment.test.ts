import assert from 'node:assert/strict';
import test from 'node:test';
import { userSchema } from '@/domain/user/schema';
import { employeeProfileSchema } from '@/domain/employeeProfile/schema';
import { userRepo } from '@/data/user/user.repo';
import { employeeProfileRepo } from '@/data/employeeProfile/employeeProfile.repo';
import { departmentMemberRepo } from '@/data/departmentMember/departmentMember.repo';
import { cascadeDepartmentRename } from './renameDepartment';

test('부서명을 바꾸면 계정·인명관리·겸직 정보의 부서명이 함께 바뀌고, 다른 부서 사람은 그대로', async () => {
  await userRepo.save(userSchema.parse({ id: 'UR1', empNo: 'R1', name: '가', email: 'r1@x.co', dept: '옛팀' }));
  await userRepo.save(userSchema.parse({ id: 'UR2', empNo: 'R2', name: '나', email: 'r2@x.co', dept: '다른팀' }));
  await employeeProfileRepo.save(employeeProfileSchema.parse({ id: 'UR1', userId: 'UR1', empNo: 'R1', name: '가', dept: '옛팀' }), { keepAttendanceTarget: true });
  await employeeProfileRepo.save(employeeProfileSchema.parse({ id: 'UR2', userId: 'UR2', empNo: 'R2', name: '나', dept: '다른팀' }), { keepAttendanceTarget: true });
  await departmentMemberRepo.save({ id: 'DM-UR2-DR9', userId: 'UR2', deptId: 'DR9', deptName: '옛팀', isPrimary: false });

  const r = await cascadeDepartmentRename({ deptId: 'DR9', oldName: '옛팀', newName: '새팀' });

  assert.deepEqual(r, { users: 1, profiles: 1, memberships: 1 });
  assert.equal((await userRepo.get('UR1'))?.dept, '새팀');
  assert.equal((await employeeProfileRepo.get('UR1'))?.dept, '새팀');
  assert.equal((await departmentMemberRepo.get('DM-UR2-DR9'))?.deptName, '새팀');
  assert.equal((await userRepo.get('UR2'))?.dept, '다른팀');
  assert.equal((await employeeProfileRepo.get('UR2'))?.dept, '다른팀');
});

test('이름이 같으면 아무것도 바꾸지 않는다', async () => {
  assert.deepEqual(await cascadeDepartmentRename({ deptId: 'DR9', oldName: '새팀', newName: '새팀' }), { users: 0, profiles: 0, memberships: 0 });
});
