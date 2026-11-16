import assert from 'node:assert/strict';
import test from 'node:test';
import { departmentSchema } from '@/domain/department/schema';
import { deptRoomId, deptRoomName } from '@/domain/chatRoom/deptRoom';
import { chatRoomRepo } from '@/data/chatRoom/chatRoom.repo';
import { userRepo } from '@/data/user/user.repo';
import { saveDepartment } from './saveDepartment';

const roomOf = async (deptId: string) => (await chatRoomRepo.list(undefined, { includeDeleted: true })).find((r) => r.id === deptRoomId(deptId));

test('소속 직원이 있는 부서를 저장하면 그 자리에서 부서방이 생긴다(30분 기다리지 않음)', async () => {
  await chatRoomRepo.list(); // 접속 때 한 번 맞추기를 먼저 끝내 둔다 — 이후는 30분 동안 목록 조회로는 안 맞춘다
  // 부서방은 소속 직원이 있어야 만든다 — 직원이 소속된 부서 이름을 새 부서 ID로 쓴다(시험 데이터엔 인명이 없어 '미지정')
  const member = (await userRepo.listIncludingTestAccounts()).find((u) => u.status === '사용')!;
  await saveDepartment(departmentSchema.parse({ id: 'DT1', name: member.dept }));
  assert.equal((await roomOf('DT1'))?.name, deptRoomName(member.dept));
  assert.ok((await roomOf('DT1'))?.members.includes(member.id));
});

test('부서 이름을 바꾸면 부서방 이름도 바로 따라간다', async () => {
  await saveDepartment(departmentSchema.parse({ id: 'DT1', name: '시험2팀' }));
  assert.equal((await roomOf('DT1'))?.name, deptRoomName('시험2팀'));
});
