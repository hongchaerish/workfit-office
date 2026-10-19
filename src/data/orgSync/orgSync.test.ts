import assert from 'node:assert/strict';
import test from 'node:test';
import { userSchema } from '@/domain/user/schema';
import { employeeProfileSchema } from '@/domain/employeeProfile/schema';
import { userRepo } from '@/data/user/user.repo';
import { employeeProfileRepo } from '@/data/employeeProfile/employeeProfile.repo';
import { departmentMemberRepo } from '@/data/departmentMember/departmentMember.repo';
import { cascadeDepartmentRename, cascadeJobTitleRename, cascadePositionRename, departmentDeleteBlocker, jobTitleDeleteBlocker, positionDeleteBlocker, setPersonJobTitle } from './orgSync';

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

const person = async (id: string, over: { dept?: string; position?: string; jobTitle?: string; status?: '사용' | '잠금' | '미사용' }) => {
  await userRepo.save(userSchema.parse({ id, empNo: id, name: id, email: `${id.toLowerCase()}@x.co`, ...over }));
  await employeeProfileRepo.save(employeeProfileSchema.parse({ id, userId: id, empNo: id, name: id, ...over, status: undefined }), { keepAttendanceTarget: true });
};

test('직책 지정은 계정·인명관리·본직 소속의 직책을 함께 바꾼다', async () => {
  await person('UJ1', { dept: 'J팀', jobTitle: '팀원' });
  await departmentMemberRepo.save({ id: 'DM-UJ1-DJ1', userId: 'UJ1', deptId: 'DJ1', deptName: 'J팀', isPrimary: true, jobTitle: '팀원' });

  await setPersonJobTitle('UJ1', '팀장');

  assert.equal((await userRepo.get('UJ1'))?.jobTitle, '팀장');
  assert.equal((await employeeProfileRepo.get('UJ1'))?.jobTitle, '팀장');
  assert.equal((await departmentMemberRepo.get('DM-UJ1-DJ1'))?.jobTitle, '팀장');
});

test('직급 이름을 바꾸면 계정·인명관리의 직급이 함께 바뀐다', async () => {
  await person('UP1', { position: '옛직급' });
  await person('UP2', { position: '사원' });

  const r = await cascadePositionRename('옛직급', '새직급');

  assert.deepEqual(r, { users: 1, profiles: 1 });
  assert.equal((await userRepo.get('UP1'))?.position, '새직급');
  assert.equal((await employeeProfileRepo.get('UP1'))?.position, '새직급');
  assert.equal((await userRepo.get('UP2'))?.position, '사원');
});

test('직책 이름을 바꾸면 계정·인명관리·소속 정보의 직책이 함께 바뀐다', async () => {
  await person('UT1', { jobTitle: '옛직책' });
  await departmentMemberRepo.save({ id: 'DM-UT1-DT1', userId: 'UT1', deptId: 'DT1', deptName: 'T팀', isPrimary: false, jobTitle: '옛직책' });

  const r = await cascadeJobTitleRename('옛직책', '새직책');

  assert.deepEqual(r, { users: 1, profiles: 1, memberships: 1 });
  assert.equal((await userRepo.get('UT1'))?.jobTitle, '새직책');
  assert.equal((await employeeProfileRepo.get('UT1'))?.jobTitle, '새직책');
  assert.equal((await departmentMemberRepo.get('DM-UT1-DT1'))?.jobTitle, '새직책');
});

test('부서 삭제는 소속 인원·겸직자·하위 부서가 있으면 막고, 비어 있으면 허용한다', async () => {
  const depts = [
    { id: 'DD1', name: '빈부서', parentId: null },
    { id: 'DD2', name: '사람있는부서', parentId: null },
    { id: 'DD3', name: '상위부서', parentId: null },
    { id: 'DD4', name: '하위부서', parentId: 'DD3' },
    { id: 'DD5', name: '겸직만부서', parentId: null },
  ];
  await person('UD1', { dept: '사람있는부서' });
  await person('UD2', { dept: '빈부서', status: '미사용' }); // 퇴직자는 막지 않는다
  await departmentMemberRepo.save({ id: 'DM-UD1-DD5', userId: 'UD1', deptId: 'DD5', deptName: '겸직만부서', isPrimary: false });

  assert.equal(await departmentDeleteBlocker(depts[0], depts), null);
  assert.match((await departmentDeleteBlocker(depts[1], depts)) ?? '', /소속 인원 1명/);
  assert.match((await departmentDeleteBlocker(depts[2], depts)) ?? '', /하위 부서/);
  assert.match((await departmentDeleteBlocker(depts[4], depts)) ?? '', /겸직/);
});

test('사용 중인 직급·직책은 삭제를 막고, 퇴직자만 쓰거나 아무도 안 쓰면 허용한다', async () => {
  await person('UX1', { position: '쓰는직급', jobTitle: '쓰는직책' });
  await person('UX2', { position: '퇴직자직급', jobTitle: '퇴직자직책', status: '미사용' });

  assert.match((await positionDeleteBlocker('쓰는직급')) ?? '', /1명/);
  assert.equal(await positionDeleteBlocker('퇴직자직급'), null);
  assert.equal(await positionDeleteBlocker('없는직급'), null);
  assert.match((await jobTitleDeleteBlocker('쓰는직책')) ?? '', /1명/);
  assert.equal(await jobTitleDeleteBlocker('퇴직자직책'), null);
});
