import assert from 'node:assert/strict';
import test from 'node:test';
import { deptMemberIdsFrom } from './deptMembers.js';

const dept = { $id: 'D240', name: '데이터플랫폼 개발팀' };
const users = [
  { $id: 'U1', status: '사용', dept: '옛이름' },
  { $id: 'U2', status: '사용', dept: '데이터플랫폼 개발팀' },
  { $id: 'U3', status: '미사용', dept: '데이터플랫폼 개발팀' },
  { $id: 'U4', status: '사용', dept: '데이터플랫폼 개발팀' },
];
const profiles = [
  { userId: 'U1', deptId: 'D240' }, // 계정 이름은 옛 값이지만 인명관리 ID로 소속
  { userId: 'U2', deptId: 'D210' }, // 계정 이름은 같지만 실제로는 다른 부서
  { userId: 'U3', deptId: 'D240' }, // 퇴직
  { userId: 'U4', dept: '데이터플랫폼 개발팀' }, // ID 채우기 전 — 예전 이름으로
];

test('부서원은 인명관리 부서 ID 기준 재직자 — 계정 dept 칸은 보지 않는다', () => {
  assert.deepEqual(deptMemberIdsFrom(dept, profiles, users).sort(), ['U1', 'U4']);
});
