import assert from 'node:assert/strict';
import test from 'node:test';
import { userSchema } from '@/domain/user/schema';
import { employeeProfileSchema } from '@/domain/employeeProfile/schema';
import { positionSchema } from '@/domain/position/schema';
import { userRepo } from '@/data/user/user.repo';
import { employeeProfileRepo } from '@/data/employeeProfile/employeeProfile.repo';
import { departmentMemberRepo } from '@/data/departmentMember/departmentMember.repo';
import { departmentRepo } from '@/data/department/department.repo';
import { positionRepo } from '@/data/position/position.repo';
import { jobTitleRepo } from '@/data/jobTitle/jobTitle.repo';
import { departmentDeleteBlocker, jobTitleDeleteBlocker, positionDeleteBlocker, setPersonJobTitle } from './orgSync';

const dept = (id: string, name: string, parentId: string | null = null) =>
  departmentRepo.save({ id, name, parentId, headUserId: null, deptType: '본사', order: 1 });

test.before(async () => {
  await dept('DX1', 'X팀');
  await dept('DX2', 'Y팀');
  await positionRepo.save(positionSchema.parse({ id: 'PX1', name: 'X직급', rank: 5 }));
  await positionRepo.save(positionSchema.parse({ id: 'PX2', name: 'Y직급', rank: 6 }));
  await jobTitleRepo.save({ id: 'JX1', name: 'X직책' });
  await jobTitleRepo.save({ id: 'JX2', name: 'Y직책' });
});

/** 소속은 인명관리에만 둔다. 계정 이름 칸은 일부러 엉뚱한 값 — ID 기준임을 확인하려고. */
const person = async (id: string, aff: { dept?: string; position?: string; jobTitle?: string }, status: '사용' | '미사용' = '사용') => {
  await userRepo.save(userSchema.parse({ id, empNo: id, name: id, email: `${id.toLowerCase()}@x.co`, dept: '엉뚱', position: '엉뚱', jobTitle: '엉뚱', status }));
  await employeeProfileRepo.save(employeeProfileSchema.parse({ id, userId: id, empNo: id, name: id, ...aff }), { keepAttendanceTarget: true });
};

test('부서장 직책 지정은 인명관리 직책 ID와 본직 소속행 직책을 바꾸고, 사람 목록에 그 이름이 나온다', async () => {
  await person('UJ1', { dept: 'X팀', jobTitle: 'Y직책' });
  await departmentMemberRepo.save({ id: 'DM-UJ1-DX1', userId: 'UJ1', deptId: 'DX1', deptName: 'X팀', isPrimary: true, jobTitle: 'Y직책' });

  await setPersonJobTitle('UJ1', 'X직책');

  assert.equal((await employeeProfileRepo.get('UJ1'))?.jobTitleId, 'JX1');
  assert.equal((await userRepo.get('UJ1'))?.jobTitle, 'X직책');
  assert.equal((await departmentMemberRepo.get('DM-UJ1-DX1'))?.jobTitleId, 'JX1');
});

test('부서 삭제 차단은 인명관리 부서 ID 기준 — 계정 이름 칸은 보지 않는다', async () => {
  const depts = [
    { id: 'DX1', name: 'X팀', parentId: null },
    { id: 'DX2', name: 'Y팀', parentId: null },
    { id: 'DX3', name: '상위', parentId: null },
    { id: 'DX4', name: '하위', parentId: 'DX3' },
    { id: 'DX5', name: '겸직만', parentId: null },
    { id: 'DX6', name: '엉뚱', parentId: null },
  ];
  await person('UD1', { dept: 'Y팀' });
  await person('UD2', { dept: 'X팀' }, '미사용');
  await departmentMemberRepo.save({ id: 'DM-UD1-DX5', userId: 'UD1', deptId: 'DX5', deptName: '겸직만', isPrimary: false });

  assert.match((await departmentDeleteBlocker(depts[1], depts)) ?? '', /소속 인원 1명/);
  assert.match((await departmentDeleteBlocker(depts[2], depts)) ?? '', /하위 부서/);
  assert.match((await departmentDeleteBlocker(depts[4], depts)) ?? '', /겸직/);
  // 계정 이름 칸이 '엉뚱'인 사람들이 있어도 막지 않는다
  assert.equal(await departmentDeleteBlocker(depts[5], depts), null);
});

test('직급·직책 삭제 차단은 ID 기준, 퇴직자만 쓰면 허용', async () => {
  await person('UX1', { position: 'X직급', jobTitle: 'X직책' });
  await person('UX2', { position: 'Y직급', jobTitle: 'Y직책' }, '미사용');

  assert.match((await positionDeleteBlocker('PX1')) ?? '', /명/);
  assert.equal(await positionDeleteBlocker('PX2'), null);
  assert.match((await jobTitleDeleteBlocker('JX1')) ?? '', /명/);
});
