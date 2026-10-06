import assert from 'node:assert/strict';
import test from 'node:test';
import type { User } from '@/domain/user/schema';
import { canViewWorkPlan, resolveWorkPlanScope } from './scopeHelper';

const person = (id: string, name: string, dept: string, position: string, jobTitle = ''): User =>
  ({ id, name, dept, position, jobTitle, email: `${id.toLowerCase()}@workfit.co.kr`, status: '사용' }) as User;

const staff = person('U101', '김사원', '개발팀', '사원');
const leader = person('U102', '이팀장', '영업팀', '과장', '팀장');
const otherStaff = person('U103', '박사원', '영업팀', '대리');
const tester = person('U900', '테스트계정', '개발팀', '사원');

test('업무계획 열람 범위는 직책·직급과 무관하게 전사다', () => {
  assert.equal(resolveWorkPlanScope(staff), 'ALL');
  assert.equal(resolveWorkPlanScope(leader), 'ALL');
});

test('사원도 다른 부서 팀원의 업무계획을 본다', () => {
  const scope = resolveWorkPlanScope(staff);
  assert.equal(canViewWorkPlan(staff, otherStaff, scope), true);
  assert.equal(canViewWorkPlan(staff, leader, scope), true);
});

test('테스터 계정은 여전히 서로 격리된다', () => {
  assert.equal(resolveWorkPlanScope(tester), 'MY_ONLY');
  assert.equal(canViewWorkPlan(tester, staff, resolveWorkPlanScope(tester)), false);
  assert.equal(canViewWorkPlan(staff, tester, resolveWorkPlanScope(staff)), false);
});
