import assert from 'node:assert/strict';
import test from 'node:test';
import { affiliationIdsFromNames, resolveAffiliation } from './affiliation';

const M = {
  depts: [{ id: 'D240', name: '데이터플랫폼 개발팀' }, { id: 'D210', name: '품질심사팀' }],
  positions: [{ id: 'P05', name: '과장' }],
  jobTitles: [{ id: 'J03', name: '팀장' }],
};

test('ID로 기준정보의 현재 이름을 찾는다', () => {
  assert.deepEqual(resolveAffiliation({ deptId: 'D240', positionId: 'P05', jobTitleId: 'J03' }, M), {
    deptId: 'D240', dept: '데이터플랫폼 개발팀', positionId: 'P05', position: '과장', jobTitleId: 'J03', jobTitle: '팀장',
  });
});

test('기준정보 이름이 바뀌면 바로 새 이름', () => {
  const renamed = { ...M, depts: [{ id: 'D240', name: '플랫폼팀' }] };
  assert.equal(resolveAffiliation({ deptId: 'D240' }, renamed).dept, '플랫폼팀');
});

test('없거나 못 찾으면 미지정·사원·빈칸, 테스트 계정 부서는 테스트', () => {
  assert.deepEqual(resolveAffiliation({}, M), { deptId: null, dept: '미지정', positionId: null, position: '사원', jobTitleId: null, jobTitle: '' });
  assert.equal(resolveAffiliation({ deptId: 'D999' }, M).dept, '미지정');
  assert.equal(resolveAffiliation({ deptId: null }, M, { isTest: true }).dept, '테스트');
});

test('고른 이름을 ID로, 못 찾으면 기존 ID 유지', () => {
  assert.deepEqual(affiliationIdsFromNames({ dept: '품질심사팀', position: '과장', jobTitle: '팀장' }, M), { deptId: 'D210', positionId: 'P05', jobTitleId: 'J03' });
  assert.deepEqual(
    affiliationIdsFromNames({ dept: '옛이름', position: '없음', jobTitle: '' }, M, { deptId: 'D240', positionId: 'P05', jobTitleId: 'J03' }),
    { deptId: 'D240', positionId: 'P05', jobTitleId: null },
  );
});
