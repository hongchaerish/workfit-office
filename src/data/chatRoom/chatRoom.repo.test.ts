import assert from 'node:assert/strict';
import test from 'node:test';
import { chatRoomSchema } from '@/domain/chatRoom/schema';
import { chatRoomRepo } from './chatRoom.repo';

const save = (over: Record<string, unknown>) => chatRoomRepo.save(chatRoomSchema.parse({ name: '방', ...over }));
const find = async (id: string) => (await chatRoomRepo.list(undefined, { includeDeleted: true })).find((r) => r.id === id)!;

test('퇴직자는 살아있는 부서방에서만 빠지고, 일반 단체방·지운 부서방은 그대로', async () => {
  await save({ id: 'RM-DEPT-T1', type: 'dept', members: ['R1', 'R2'] });
  await save({ id: 'RM-DEPT-T2', type: 'dept', members: ['R1'], deletedAt: '2026-10-01T00:00:00' });
  await save({ id: 'RM-T3', type: 'group', members: ['R1', 'R2', 'R3'] });

  const ids = await chatRoomRepo.removeMemberFromDeptRooms('R1');

  assert.deepEqual(ids, ['RM-DEPT-T1']);
  assert.deepEqual((await find('RM-DEPT-T1')).members, ['R2']);
  assert.deepEqual((await find('RM-DEPT-T2')).members, ['R1']);
  assert.deepEqual((await find('RM-T3')).members, ['R1', 'R2', 'R3']);
});

test('부서 삭제 시 그 부서방은 이름·참여자를 유지한 채 일반 단체방이 된다', async () => {
  await save({ id: 'RM-DEPT-T9', type: 'dept', name: '[폐지팀] 부서 단체방', members: ['A', 'B'] });

  const ids = await chatRoomRepo.detachDeptRoom('T9');

  assert.deepEqual(ids, ['RM-DEPT-T9']);
  const r = await find('RM-DEPT-T9');
  assert.equal(r.type, 'group');
  assert.equal(r.deptId, null);
  assert.equal(r.name, '[폐지팀] 부서 단체방');
  assert.deepEqual(r.members, ['A', 'B']);
  assert.deepEqual(await chatRoomRepo.detachDeptRoom('T9'), []);
});

test('부서명 변경 적용은 최신 방을 다시 읽어, 이미 바뀌었으면 건너뛰고 그사이 바뀐 참여자를 지킨다', async () => {
  await save({ id: 'RM-DEPT-T5', type: 'dept', name: '[옛팀] 부서 단체방', members: ['A'] });
  // 다른 브라우저가 그사이 초대한 상황
  await save({ id: 'RM-DEPT-T5', type: 'dept', name: '[옛팀] 부서 단체방', members: ['A', 'B'] });

  assert.equal(await chatRoomRepo.applyDeptRoomRename('RM-DEPT-T5', '[새팀] 부서 단체방'), true);
  const r = await find('RM-DEPT-T5');
  assert.equal(r.name, '[새팀] 부서 단체방');
  assert.deepEqual(r.members, ['A', 'B']);

  // 다른 브라우저가 같은 이름 변경을 또 시도 → 건너뜀(메시지 중복 방지)
  assert.equal(await chatRoomRepo.applyDeptRoomRename('RM-DEPT-T5', '[새팀] 부서 단체방'), false);
});
