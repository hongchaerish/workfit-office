import assert from 'node:assert/strict';
import test from 'node:test';
import { chatRoomSchema, type ChatRoom } from './schema';
import { deptIdOfRoom, deptRoomId, deptRoomName, planDeptRoomSync } from './deptRoom';

const NOW = '2026-10-19T09:00:00';
const room = (over: Partial<ChatRoom> & { id: string }): ChatRoom =>
  chatRoomSchema.parse({ name: '방', type: 'dept', members: [], ...over });
const plan = (rooms: ChatRoom[], depts = [{ id: 'D240', name: '개발팀' }], users = [
  { id: 'U1', dept: '개발팀', status: '사용' },
  { id: 'U2', dept: '개발팀', status: '사용' },
  { id: 'U3', dept: '개발팀', status: '미사용' },
  { id: 'U4', dept: '연구팀', status: '사용' },
]) => planDeptRoomSync({ depts, users, rooms, now: NOW, pickColor: () => '#000000' });

test('방 ID·이름 규칙', () => {
  assert.equal(deptRoomId('D240'), 'RM-DEPT-D240');
  assert.equal(deptRoomName('개발팀'), '[개발팀] 부서 단체방');
});

test('부서방이면 방 ID에서 부서 ID를 꺼내고, 일반 단체방이면 null', () => {
  assert.equal(deptIdOfRoom(room({ id: 'RM-DEPT-D240' })), 'D240');
  assert.equal(deptIdOfRoom(room({ id: 'ROOM-DEPT-D240' })), 'D240');
  assert.equal(deptIdOfRoom(room({ id: 'RM-1786578370251', deptId: 'D120' })), 'D120');
  assert.equal(deptIdOfRoom(room({ id: 'RM-DEPT-D110', type: 'group' })), null);
  assert.equal(deptIdOfRoom(room({ id: 'RM-1786578370251' })), null);
});

test('방 없는 부서에 사용 중 부서원이 있으면 그 부서원으로 한 번 개설한다', () => {
  const r = plan([]);
  assert.equal(r.create.length, 1);
  const c = r.create[0];
  assert.equal(c.id, 'RM-DEPT-D240');
  assert.equal(c.name, '[개발팀] 부서 단체방');
  assert.equal(c.type, 'dept');
  assert.deepEqual([...c.members].sort(), ['U1', 'U2']);
  assert.equal(c.lastMessage?.text, '개발팀 부서 단체방이 개설되었습니다.');
  assert.equal(c.createdBy, 'system');
  assert.deepEqual(r.rename, []);
});

test('사용 중 부서원이 없으면 개설하지 않는다', () => {
  assert.deepEqual(plan([], [{ id: 'D999', name: '빈부서' }]).create, []);
});

test('방이 있으면 참여자가 달라도 건드리지 않는다 (직접 관리)', () => {
  const r = plan([room({ id: 'RM-DEPT-D240', name: '[개발팀] 부서 단체방', members: ['U4'] })]);
  assert.deepEqual(r, { create: [], rename: [] });
});

test('참여자가 모두 나간 빈 방도 다시 만들거나 채우지 않는다', () => {
  const r = plan([room({ id: 'RM-DEPT-D240', name: '[개발팀] 부서 단체방', members: [] })]);
  assert.deepEqual(r, { create: [], rename: [] });
});

test('지운 부서방이 있으면 재개설하지 않는다', () => {
  const r = plan([room({ id: 'RM-DEPT-D240', name: '[개발팀] 부서 단체방', deletedAt: '2026-10-01T00:00:00' })]);
  assert.deepEqual(r, { create: [], rename: [] });
});

test('부서명이 바뀌면 이름만 변경 대상이다', () => {
  const r = plan([room({ id: 'RM-DEPT-D240', name: '[옛이름팀] 부서 단체방', members: ['U1'] })]);
  assert.deepEqual(r, { create: [], rename: [{ roomId: 'RM-DEPT-D240', name: '[개발팀] 부서 단체방' }] });
});

test('같은 ID의 일반 단체방이 있으면 덮어쓰지 않는다', () => {
  const r = plan([room({ id: 'RM-DEPT-D240', type: 'group', name: '대표이사 직속 단체방' })]);
  assert.deepEqual(r, { create: [], rename: [] });
});

test('이름에 부서명이 들어간 일반 단체방은 부서방으로 취급하지 않는다', () => {
  const r = plan([room({ id: 'RM-0007', type: 'group', name: '개발팀 회식방', members: ['U1'] })]);
  assert.equal(r.create.length, 1);
  assert.equal(r.create[0].id, 'RM-DEPT-D240');
  assert.deepEqual(r.rename, []);
});
