import assert from 'node:assert/strict';
import test from 'node:test';
import { affiliationOf, headScope, matchesExecMapping } from './scope.js';

const masters = {
  depts: [{ $id: 'D240', name: '데이터플랫폼 개발팀', headUserId: 'U011' }, { $id: 'D210', name: '품질심사팀', headUserId: null }],
  positions: [{ $id: 'P03', name: '상무이사' }, { $id: 'P05', name: '과장' }],
  jobTitles: [{ $id: 'J03', name: '팀장' }],
};
const profiles = [
  { userId: 'U011', deptId: 'D240', positionId: 'P05', jobTitleId: 'J03' },
  { userId: 'U012', deptId: 'D240', positionId: 'P05', jobTitleId: null },
  { userId: 'U031', deptId: 'D210', positionId: 'P05', jobTitleId: null },
];
// 계정의 dept 칸은 옛 이름 — 결과에 영향을 주면 안 된다
const users = [
  { id: 'U011', name: '김승기', dept: '옛이름' },
  { id: 'U012', name: '홍채원', dept: '옛이름' },
  { id: 'U031', name: '강윤석', dept: '데이터플랫폼 개발팀' },
];

test('소속은 인명관리 ID로 기준정보의 현재 이름을 찾는다', () => {
  assert.deepEqual(affiliationOf('U011', profiles, masters), { deptId: 'D240', dept: '데이터플랫폼 개발팀', positionId: 'P05', position: '과장', jobTitleId: 'J03', jobTitle: '팀장' });
  assert.deepEqual(affiliationOf('U999', profiles, masters), { deptId: null, dept: '', positionId: null, position: '', jobTitleId: null, jobTitle: '' });
});

test('권한 매핑의 부서·직급 대상은 ID와 이름 어느 쪽이어도 일치', () => {
  const me = { uid: 'U012', empNo: '2601', myName: '홍채원', aff: affiliationOf('U012', profiles, masters) };
  assert.equal(matchesExecMapping({ targetType: 'DEPT', targetId: 'D240' }, me), true);
  assert.equal(matchesExecMapping({ targetType: 'DEPT', targetId: '데이터플랫폼 개발팀' }, me), true);
  assert.equal(matchesExecMapping({ targetType: 'DEPT', targetId: 'D210', targetName: '품질심사팀' }, me), false);
  assert.equal(matchesExecMapping({ targetType: 'POSITION', targetId: 'P05' }, me), true);
  assert.equal(matchesExecMapping({ targetType: 'POSITION', targetName: '과장' }, me), true);
  assert.equal(matchesExecMapping({ targetType: 'USER', targetId: 'U012' }, me), true);
});

test('부서장은 인명관리 부서 ID가 같은 사람 전원 — 계정 dept 칸은 보지 않는다', () => {
  const s = headScope({ uid: 'U011', aff: affiliationOf('U011', profiles, masters), depts: masters.depts, profiles, users });
  assert.deepEqual(s.deptNames, ['데이터플랫폼 개발팀']);
  assert.deepEqual([...s.memberNames].sort(), ['김승기', '홍채원']);
});

test('부서장 지정이 없어도 팀장 직책이면 자기 부서, 아니면 범위 없음', () => {
  const noHeads = masters.depts.map((d) => ({ ...d, headUserId: null }));
  const s = headScope({ uid: 'U011', aff: affiliationOf('U011', profiles, masters), depts: noHeads, profiles, users });
  assert.deepEqual(s.deptNames, ['데이터플랫폼 개발팀']);
  const t = headScope({ uid: 'U012', aff: affiliationOf('U012', profiles, masters), depts: noHeads, profiles, users });
  assert.deepEqual(t.deptNames, []);
});

test('ID를 아직 채우지 않은 예전 프로필은 예전 이름 칸으로 소속·부서원을 찾는다', () => {
  const legacy = [
    { userId: 'U011', dept: '데이터플랫폼 개발팀', position: '과장', jobTitle: '팀장' },
    { userId: 'U012', dept: '데이터플랫폼 개발팀', position: '과장', jobTitle: '' },
  ];
  const aff = affiliationOf('U011', legacy, masters);
  assert.equal(aff.deptId, 'D240');
  const s = headScope({ uid: 'U011', aff, depts: masters.depts, profiles: legacy, users, masters });
  assert.deepEqual([...s.memberNames].sort(), ['김승기', '홍채원']);
});
