import assert from 'node:assert/strict';
import test from 'node:test';
import { attendanceTargetBackend, employeeProfileRepo } from './employeeProfile.repo';

const me = { id: 'U-SELF-1', empNo: '700001', name: '홍길동', dept: '영업팀', position: '과장', jobTitle: '팀원' };

test('프로필이 없으면 계정 정보로 만들고 허용 항목만 저장한다', async () => {
  const saved = await employeeProfileRepo.updateMine(me, {
    phone: '010-1111-2222',
    birthDate: '1985-08-15',
    birthLunar: true,
    birthdayPublic: false,
    // 허용되지 않은 항목은 무시된다
    ...({ dept: '경영지원팀', rrn: '850815-1234567' } as object),
  });
  assert.equal(saved.dept, '영업팀');
  assert.equal(saved.rrn, '');
  const reloaded = await employeeProfileRepo.get(me.id);
  assert.equal(reloaded?.phone, '010-1111-2222');
  assert.equal(reloaded?.birthLunar, true);
  assert.equal(reloaded?.birthdayPublic, false);
});

test('빈 값으로 저장하면 지워지고, 다른 항목은 그대로', async () => {
  await employeeProfileRepo.updateMine(me, { address: '서울시' });
  await employeeProfileRepo.updateMine(me, { address: '' });
  const reloaded = await employeeProfileRepo.get(me.id);
  assert.equal(reloaded?.address, '');
  assert.equal(reloaded?.phone, '010-1111-2222');
});

test('본인 저장은 관리자가 정한 근태 대상 여부를 바꾸지 않는다', async () => {
  await attendanceTargetBackend.save({ targetKey: me.id, isTarget: false });
  await employeeProfileRepo.updateMine(me, { phone: '010-3333-4444' });
  const reloaded = await employeeProfileRepo.get(me.id);
  assert.equal(reloaded?.isAttendanceTarget, false);
});

test('생일 설정이 없으면 양력·공개로 읽힌다', async () => {
  const other = { ...me, id: 'U-SELF-2', empNo: '700002' };
  await employeeProfileRepo.updateMine(other, { birthDate: '1990-01-01' });
  const reloaded = await employeeProfileRepo.get(other.id);
  assert.equal(reloaded?.birthLunar, false);
  assert.equal(reloaded?.birthdayPublic, true);
});
