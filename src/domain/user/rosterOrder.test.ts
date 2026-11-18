import assert from 'node:assert/strict';
import test from 'node:test';
import { compareRoster, jobTitleRank, type RosterOrderContext, type RosterPerson } from './rosterOrder';

const DEPTS = ['대표이사', '기술경영전략위원회', '경영기획팀', 'AX지능화본부', '품질심사팀'];
const RANKS: Record<string, number> = { 대표이사: 1, 상무이사: 2, 이사: 3, 부장: 4, 차장: 5, 과장: 6, 대리: 7, 주임: 9 };
const ctx = (execNames: string[]): RosterOrderContext => ({
  isExecutive: (p) => execNames.includes(p.name ?? ''),
  deptOrder: (d) => (DEPTS.includes(d) ? DEPTS.indexOf(d) : Number.MAX_SAFE_INTEGER),
  positionRank: (pos) => RANKS[pos] ?? 99,
});
const p = (name: string, dept: string, position: string, jobTitle = '팀원'): RosterPerson => ({ name, dept, position, jobTitle });

const son = p('손승원', 'AX지능화본부', '상무이사', '임원');
const moran = p('모 란', '경영기획팀', '대리');
const kang = p('강윤석', '품질심사팀', '이사', '팀장');
const choi = p('최지혜', '품질심사팀', '주임');
const park = p('박광래', '품질심사팀', '차장');

const sorted = (list: RosterPerson[], execNames: string[]) => [...list].sort((a, b) => compareRoster(a, b, ctx(execNames))).map((x) => x.name);

test('임원 그룹은 부서 순서와 무관하게 맨 위에 온다', () => {
  assert.deepEqual(sorted([moran, son], ['손승원']), ['손승원', '모 란']);
});

test('임원이 아니면 부서 순서 → 직책 → 직급 → 이름 순이다', () => {
  assert.deepEqual(sorted([choi, park, kang, moran], ['손승원']), ['모 란', '강윤석', '박광래', '최지혜']);
});

test('임원 여부는 직급이 아니라 주어진 기준(권한그룹)을 따른다', () => {
  assert.deepEqual(sorted([moran, kang, son], ['손승원', '강윤석']), ['손승원', '강윤석', '모 란']);
});

test('직책 서열 — 부팀장은 팀장보다 아래다', () => {
  assert.ok(jobTitleRank('팀장') < jobTitleRank('부팀장'));
  assert.ok(jobTitleRank('부팀장') < jobTitleRank('팀원'));
  assert.ok(jobTitleRank('부위원장') > jobTitleRank('위원장'));
});
