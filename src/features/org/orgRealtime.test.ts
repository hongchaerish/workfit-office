import assert from 'node:assert/strict';
import test from 'node:test';
import { userSchema, type User } from '@/domain/user/schema';
import { collectionOfEvents, ORG_COLLECTIONS, keysToRefresh, userChangeMatters } from './orgRealtime';

const base = userSchema.parse({ id: 'U012', empNo: '600002', name: '홍길동', email: 'a@b.kr' });
const cached: User = { ...base, dept: '데이터플랫폼 개발팀', position: '사원', jobTitle: '팀원', phone: '010-1' } as User;

test('이벤트 이름에서 컬렉션을 꺼낸다 (예전·새 이름 둘 다)', () => {
  assert.equal(collectionOfEvents(['databases.db.collections.departments.documents.D1.update']), 'departments');
  assert.equal(collectionOfEvents(['databases.db.tables.users.rows.U1.create']), 'users');
  assert.equal(collectionOfEvents(['users.U1.update']), null);
});

test('조직 컬렉션마다 다시 받을 화면 데이터', () => {
  assert.deepEqual(keysToRefresh('departments'), [['departments'], ['employeeProfiles'], ['users']]);
  assert.deepEqual(keysToRefresh('attendanceTargets'), [['employeeProfiles'], ['users']]);
  assert.deepEqual(keysToRefresh('roleMappings'), [['roleGroups']]);
  assert.deepEqual(keysToRefresh('authAssignments'), [['authAssignments']]);
  assert.deepEqual(keysToRefresh('chatRooms'), []);
  assert.ok(ORG_COLLECTIONS.includes('users') && ORG_COLLECTIONS.includes('holidays'));
});

test('사용자 문서: 접속시각·보고 있는 방·알림 기기·알림 설정만 바뀐 저장은 무시한다', () => {
  const payload = { ...base, $id: 'U012', lastLogin: '2026-11-16 09:00', activeChatRoomId: 'RM-1', fcmToken: 't', fcmTokens: ['t'], notificationPrefs: '{}', $updatedAt: 'x' };
  assert.equal(userChangeMatters(cached, payload), false);
});

test('사용자 문서: 계정의 옛 소속·연락처 칸(화면은 인명관리 값을 씀)과 비밀번호 차이는 무시한다', () => {
  const payload = { ...base, $id: 'U012', dept: '옛 부서', position: '옛 직급', jobTitle: '', phone: '', password: 'hash' };
  assert.equal(userChangeMatters(cached, payload), false);
});

test('사용자 문서: 이름·상태·사진·서명·상급자가 바뀌면 다시 받는다', () => {
  for (const patch of [{ name: '홍길순' }, { status: '미사용' }, { photoUrl: 'p' }, { signUrl: 's' }, { managerId: 'U011' }, { email: 'c@d.kr' }]) {
    assert.equal(userChangeMatters(cached, { ...base, $id: 'U012', ...patch }), true, JSON.stringify(patch));
  }
});

test('사용자 문서: 받아 둔 적 없는 사람(새 계정)이거나 읽을 수 없으면 다시 받는다', () => {
  assert.equal(userChangeMatters(undefined, { ...base, $id: 'U099' }), true);
  assert.equal(userChangeMatters(cached, { $id: 'U012', broken: true }), true);
});
