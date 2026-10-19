import assert from 'node:assert/strict';
import test from 'node:test';
import { attendanceTargetBackend, employeeProfileRepo, employeeProfileStore } from './employeeProfile.repo';
import { departmentRepo } from '@/data/department/department.repo';
import { positionRepo } from '@/data/position/position.repo';
import { jobTitleRepo } from '@/data/jobTitle/jobTitle.repo';
import { userRepo, userStore } from '@/data/user/user.repo';
import { userSchema } from '@/domain/user/schema';
import { employeeProfileSchema } from '@/domain/employeeProfile/schema';
import { positionSchema } from '@/domain/position/schema';

const me = { id: 'U-SELF-1', empNo: '700001', name: '홍길동', dept: '영업팀', position: '과장', jobTitle: '팀원' };

// 소속 이름은 기준정보에 있는 것만 보인다 — 테스트용 기준정보를 먼저 넣는다
const dept = (id: string, name: string) => departmentRepo.save({ id, name, parentId: null, headUserId: null, deptType: '본사', order: 1 });
test.before(async () => {
  await dept('DS1', '영업팀');
  await dept('DA1', '가팀');
  await dept('DA2', '나팀');
  await positionRepo.save(positionSchema.parse({ id: 'PA1', name: '가직급', rank: 5 }));
  await jobTitleRepo.save({ id: 'JA1', name: '가직책' });
});

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

test('고른 이름으로 저장하면 ID가 저장되고, 읽을 때 기준정보 현재 이름이 나온다', async () => {
  await employeeProfileRepo.save(employeeProfileSchema.parse({ id: 'UA1', userId: 'UA1', empNo: 'A1', name: '가', dept: '나팀', position: '가직급', jobTitle: '가직책' }), { keepAttendanceTarget: true });
  let p = await employeeProfileRepo.get('UA1');
  assert.deepEqual([p?.deptId, p?.positionId, p?.jobTitleId], ['DA2', 'PA1', 'JA1']);
  await dept('DA2', '나팀2');
  p = await employeeProfileRepo.get('UA1');
  assert.equal(p?.dept, '나팀2');
});

test('읽은 프로필을 다른 칸만 고쳐 저장해도 ID는 그대로, 옛 이름으로 저장해도 기존 ID 유지', async () => {
  const p = (await employeeProfileRepo.get('UA1'))!;
  await employeeProfileRepo.save({ ...p, phone: '010-0000-0000' }, { keepAttendanceTarget: true });
  assert.equal((await employeeProfileRepo.get('UA1'))?.deptId, 'DA2');
  await employeeProfileRepo.save({ ...p, dept: '나팀' /* 화면에 남은 옛 이름 */ }, { keepAttendanceTarget: true });
  assert.equal((await employeeProfileRepo.get('UA1'))?.deptId, 'DA2');
});

test('사람 목록은 프로필 ID로 이름을 채우고, 프로필 없는 계정은 미지정·사원', async () => {
  await userRepo.save(userSchema.parse({ id: 'UA1', empNo: 'A1', name: '가', email: 'a1@x.co', dept: '아무거나', position: '아무거나' }));
  await userRepo.save(userSchema.parse({ id: 'UA9', empNo: 'A9', name: '발령전', email: 'a9@x.co', dept: '옛값', position: '옛값' }));
  const u1 = await userRepo.get('UA1');
  const u9 = await userRepo.get('UA9');
  assert.deepEqual([u1?.dept, u1?.position, u1?.jobTitle], ['나팀2', '가직급', '가직책']);
  assert.deepEqual([u9?.dept, u9?.position, u9?.jobTitle], ['미지정', '사원', '']);
});

test('계정을 저장해도(로그인 기록 등) DB의 계정 소속 칸은 원래 값 그대로 — 화면용 이름을 쓰지 않는다', async () => {
  await userRepo.save(userSchema.parse({ id: 'UB1', empNo: 'B1', name: '프로필없음', email: 'b1@x.co', dept: '영업부', position: '과장', jobTitle: '팀장' }));
  await userRepo.updateActiveChatRoom('UB1', 'ROOM-1');
  const raw = (await userStore.loadAll()).find((u) => u.id === 'UB1')!;
  assert.deepEqual([raw.dept, raw.position, raw.jobTitle, raw.activeChatRoomId], ['영업부', '과장', '팀장', 'ROOM-1']);
});

test('ID를 채우기 전 프로필을 다른 칸만 고쳐 저장해도 예전 이름 칸은 그대로 — 기준정보에 없는 이름도 잃지 않는다', async () => {
  await employeeProfileStore.save(employeeProfileSchema.parse({ id: 'UC1', userId: 'UC1', empNo: 'C1', name: '옛사람', dept: '없어진팀', position: '가직급', jobTitle: '' }));
  const p = (await employeeProfileRepo.get('UC1'))!;
  await employeeProfileRepo.save({ ...p, phone: '010-1' }, { keepAttendanceTarget: true });
  const raw = (await employeeProfileStore.loadAll()).find((x) => x.id === 'UC1')!;
  assert.equal(raw.dept, '없어진팀');
  assert.equal(raw.positionId, 'PA1');
});
