# 소속 ID 기준 전환 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사람의 본직 부서·직급·직책을 인명관리(`employeeProfiles`)에 ID로만 기준 저장하고, 모든 읽기는 그 ID로 기준정보의 현재 이름을 채워 돌려준다.

**Architecture:** 순수 함수 `resolveAffiliation`(ID→이름)·`affiliationIdsFromNames`(이름→ID)를 도메인에 두고, 저장소가 읽을 때 이름을 채우고(읽기 경로) 저장할 때 고른 이름을 ID로 바꾼다(쓰기 경로). 화면 약 100곳은 기존 `u.dept/position/jobTitle`을 그대로 읽는다. 기존 이름 칸은 지우지 않고 저장 시 현재 이름 사본만 써 둔다(읽지 않음).

**Tech Stack:** React + TanStack Query, zod, Appwrite(web SDK / node-appwrite), `node:test` + `npx tsx --test`.

**Spec:** `docs/superpowers/specs/2026-10-19-affiliation-ids-design.md`

## Global Constraints

- 기존 문서의 칸을 삭제하지 않는다. 결재 데이터(`approvalDocs`, `approvalForms`) 접근 금지.
- 기존 이름 칸(`employeeProfiles.dept/position/jobTitle`, `users.dept/position/jobTitle`, `departmentMembers.deptName/jobTitle`)은 새 코드가 **읽지 않는다.** 저장 시 현재 이름을 사본으로 써 둔다(`users.dept`·`users.position`·`departmentMembers.deptName`은 Appwrite 필수 칸).
- 없음/못 찾음 규칙: 부서 → 테스트 계정이면 `테스트`, 아니면 `미지정` / 직급 → `사원` / 직책 → `''`.
- 화면에 ID·내부 코드·설명성 안내문을 보이지 않는다.
- 운영 DB 쓰기는 사용자 지시 후. 개발 DB 시험은 원복한다.
- 커밋 메시지 끝: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## Review Focus

1. 인명관리 화면에서 이름을 골라 저장 → 저장된 ID가 고른 항목이어야 한다(동명 항목 없음 전제, 기준정보 이름은 화면에서 중복 금지 아님 — 첫 일치 사용). (Task 2 테스트)
2. 읽은 프로필을 다른 칸만 고쳐 다시 저장(퇴직 처리·생일 설정 등) → ID가 바뀌지 않아야 한다. (Task 2 테스트)
3. 기준정보 이름이 바뀐 뒤 화면을 새로고침하지 않은 채 예전 이름으로 저장 → 이름으로 못 찾으면 기존 ID 유지. (Task 2 테스트)
4. 프로필이 없는 계정(발령 전) → `미지정`/`사원`/`''`. (Task 2 테스트)
5. 출퇴근 연동 함수의 부서장 열람 범위가 ID 기준으로 같은 사람들을 잡아야 한다. (Task 5 테스트)

---

### Task 1: 소속 변환 순수 함수

**Files:**
- Create: `src/domain/employeeProfile/affiliation.ts`
- Test: `src/domain/employeeProfile/affiliation.test.ts`

**Interfaces:**
- Produces:
  - `interface OrgMasters { depts: {id,name}[]; positions: {id,name}[]; jobTitles: {id,name}[] }`
  - `interface AffiliationIds { deptId: string|null; positionId: string|null; jobTitleId: string|null }`
  - `resolveAffiliation(ids: Partial<AffiliationIds>, masters: OrgMasters, opts?: { isTest?: boolean }): AffiliationIds & { dept: string; position: string; jobTitle: string }`
  - `affiliationIdsFromNames(names: { dept?: string; position?: string; jobTitle?: string }, masters: OrgMasters, fallback?: Partial<AffiliationIds>): AffiliationIds`

- [ ] **Step 1: 실패하는 테스트**

```ts
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
```
(직책 빈 문자열 = 직책 없음 → `null`. 못 찾은 이름만 기존 ID 유지.)

- [ ] **Step 2: 실패 확인** — `npx tsx --test src/domain/employeeProfile/affiliation.test.ts` → FAIL (모듈 없음)

- [ ] **Step 3: 구현**

```ts
/**
 * 사람 소속(부서·직급·직책) 변환 — 본직의 기준은 인명관리에 저장된 ID다.
 * 읽을 때는 ID로 기준정보의 현재 이름을 찾고, 저장할 때는 화면에서 고른 이름을 ID로 바꾼다.
 * ([[docs/superpowers/specs/2026-10-19-affiliation-ids-design.md]])
 */
export interface OrgMasters {
  depts: { id: string; name: string }[];
  positions: { id: string; name: string }[];
  jobTitles: { id: string; name: string }[];
}

export interface AffiliationIds {
  deptId: string | null;
  positionId: string | null;
  jobTitleId: string | null;
}

export type Affiliation = AffiliationIds & { dept: string; position: string; jobTitle: string };

const nameOf = (list: { id: string; name: string }[], id?: string | null) => (id ? list.find((x) => x.id === id)?.name : undefined);
const idOf = (list: { id: string; name: string }[], name?: string) => (name ? list.find((x) => x.name === name)?.id : undefined);

export function resolveAffiliation(ids: Partial<AffiliationIds>, masters: OrgMasters, opts: { isTest?: boolean } = {}): Affiliation {
  return {
    deptId: ids.deptId ?? null,
    dept: nameOf(masters.depts, ids.deptId) ?? (opts.isTest ? '테스트' : '미지정'),
    positionId: ids.positionId ?? null,
    position: nameOf(masters.positions, ids.positionId) ?? '사원',
    jobTitleId: ids.jobTitleId ?? null,
    jobTitle: nameOf(masters.jobTitles, ids.jobTitleId) ?? '',
  };
}

export function affiliationIdsFromNames(
  names: { dept?: string; position?: string; jobTitle?: string },
  masters: OrgMasters,
  fallback: Partial<AffiliationIds> = {},
): AffiliationIds {
  return {
    deptId: idOf(masters.depts, names.dept) ?? fallback.deptId ?? null,
    positionId: idOf(masters.positions, names.position) ?? fallback.positionId ?? null,
    jobTitleId: names.jobTitle === '' ? null : (idOf(masters.jobTitles, names.jobTitle) ?? fallback.jobTitleId ?? null),
  };
}
```

- [ ] **Step 4: 통과 확인** — 4 tests PASS
- [ ] **Step 5: 커밋** — `feat(인명관리): 소속 ID↔이름 변환 순수 함수`

---

### Task 2: 스키마·저장소 — 인명관리·겸직 정보·사람 목록

**Files:**
- Modify: `src/domain/employeeProfile/schema.ts` (`deptId`, `positionId`, `jobTitleId`: `z.string().nullable().default(null)`)
- Modify: `src/domain/departmentMember/schema.ts` (`jobTitleId`: `z.string().nullable().default(null)`)
- Create: `src/data/_backend/orgMasters.ts` — `loadOrgMasters(): Promise<OrgMasters>` (departmentRepo·positionRepo·jobTitleRepo 병렬 로드)
- Modify: `src/data/employeeProfile/employeeProfile.repo.ts` (`listIncludingTestAccounts` 이름 채움, `save` 이름→ID)
- Modify: `src/data/departmentMember/departmentMember.repo.ts` (읽기 이름 채움, `save` 직책 이름→ID)
- Modify: `src/data/user/user.repo.ts` (`listIncludingTestAccounts` 조인: 프로필 없으면 `미지정/사원/''`, 계정 이름 칸 미사용)
- Modify: `src/features/employeeProfile/useEmployeeProfiles.ts` (계정으로 dept/position/jobTitle 복사 3줄 제거, 상태·이메일 동기화 유지)
- Modify: `src/data/user/user.repo.ts` — `updateDept` 삭제(호출처 없으면), `useUpdateUserDept` 삭제
- Test: `src/data/employeeProfile/employeeProfile.repo.test.ts` (기존 테스트 보정 + 신규)

**Interfaces:**
- Consumes: Task 1 `resolveAffiliation`, `affiliationIdsFromNames`, `OrgMasters`
- Produces: `loadOrgMasters()`; 프로필·사람·겸직 읽기 결과의 `dept/position/jobTitle`(이름)과 `deptId/positionId/jobTitleId`

- [ ] **Step 1: 실패하는 테스트** (메모리 저장소. 기준정보는 테스트에서 직접 저장)

```ts
// employeeProfile.repo.test.ts 에 추가
import { departmentRepo } from '@/data/department/department.repo';
import { positionRepo } from '@/data/position/position.repo';
import { jobTitleRepo } from '@/data/jobTitle/jobTitle.repo';
import { userRepo } from '@/data/user/user.repo';
import { userSchema } from '@/domain/user/schema';
import { employeeProfileSchema } from '@/domain/employeeProfile/schema';
import { positionSchema } from '@/domain/position/schema';

const seedMasters = async () => {
  await departmentRepo.save({ id: 'DA1', name: '가팀', parentId: null, headUserId: null, deptType: '본사', order: 1 });
  await departmentRepo.save({ id: 'DA2', name: '나팀', parentId: null, headUserId: null, deptType: '본사', order: 2 });
  await positionRepo.save(positionSchema.parse({ id: 'PA1', name: '가직급', rank: 5 }));
  await jobTitleRepo.save({ id: 'JA1', name: '가직책' });
};

test('고른 이름으로 저장하면 ID가 저장되고, 읽을 때 기준정보 현재 이름이 나온다', async () => {
  await seedMasters();
  await employeeProfileRepo.save(employeeProfileSchema.parse({ id: 'UA1', userId: 'UA1', empNo: 'A1', name: '가', dept: '나팀', position: '가직급', jobTitle: '가직책' }), { keepAttendanceTarget: true });
  let p = await employeeProfileRepo.get('UA1');
  assert.deepEqual([p?.deptId, p?.positionId, p?.jobTitleId], ['DA2', 'PA1', 'JA1']);
  await departmentRepo.save({ id: 'DA2', name: '나팀2', parentId: null, headUserId: null, deptType: '본사', order: 2 });
  p = await employeeProfileRepo.get('UA1');
  assert.equal(p?.dept, '나팀2');
});

test('읽은 프로필을 다른 칸만 고쳐 저장해도 ID는 그대로, 옛 이름으로 저장해도 기존 ID 유지', async () => {
  const p = (await employeeProfileRepo.get('UA1'))!;
  await employeeProfileRepo.save({ ...p, phone: '010-0000-0000' }, { keepAttendanceTarget: true });
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
```
기존 테스트(`updateMine` 등)가 이름 왕복을 가정하면 `seedMasters()`로 기준정보를 먼저 넣도록 보정한다. `src/data/orgSync/orgSync.test.ts`도 같은 이유로 Task 3에서 보정.

- [ ] **Step 2: 실패 확인** — `npx tsx --test src/data/employeeProfile/employeeProfile.repo.test.ts`

- [ ] **Step 3: 구현**
  - 스키마 칸 추가(위 Files).
  - `orgMasters.ts`:
    ```ts
    import { departmentRepo } from '@/data/department/department.repo';
    import { positionRepo } from '@/data/position/position.repo';
    import { jobTitleRepo } from '@/data/jobTitle/jobTitle.repo';
    import type { OrgMasters } from '@/domain/employeeProfile/affiliation';

    /** 소속 이름을 찾을 기준정보(부서·직급·직책). 읽기·저장 때마다 DB에서 새로 읽는다. */
    export async function loadOrgMasters(): Promise<OrgMasters> {
      const [depts, positions, jobTitles] = await Promise.all([departmentRepo.list(), positionRepo.list(), jobTitleRepo.list()]);
      return { depts, positions, jobTitles };
    }
    ```
  - `employeeProfileRepo.listIncludingTestAccounts`: 기존 병렬 로드에 `loadOrgMasters()` 추가, 각 item에 `...resolveAffiliation(item, masters, { isTest: isTestAccount({ id: item.userId, name: item.name }) })` 를 덮는다(이름 칸은 결과 이름으로).
  - `employeeProfileRepo.save`: `const masters = await loadOrgMasters(); const ids = affiliationIdsFromNames(item, masters, item);` → `backend.save({ ...item, ...ids, ...이름사본(resolveAffiliation(ids, masters)), updatedAt })`.
  - `departmentMemberRepo`: 읽기(`list`, `listByUserId`, `listByDeptId`, `get`)가 거치는 내부 `loadAll`에서 `deptName = depts에서 deptId 이름 ?? 기존`, `jobTitle = jobTitles에서 jobTitleId 이름 ?? (jobTitleId 없으면 기존 jobTitle)`. `save`: `jobTitleId = idOf(jobTitle) ?? item.jobTitleId ?? null`, `deptName`은 deptId의 현재 이름 사본.
    - (겸직 직책은 채우기 전 기존 행에 `jobTitleId`가 없으므로 그땐 기존 이름을 보여 준다 — Task 6 채우기 후엔 ID 기준.)
  - `userRepo.listIncludingTestAccounts` 조인: `dept: p?.dept ?? '미지정'`, `position: p?.position ?? '사원'`, `jobTitle: p?.jobTitle ?? ''` (계정 이름 칸 미사용). `rememberTestAccounts` 입력은 그대로(계정 원본 + 프로필).
  - `useUpsertEmployeeProfile`: 계정 저장에서 `dept/position/jobTitle` 3줄 제거.
  - `updateDept`/`useUpdateUserDept`: `grep -rn "updateDept\|useUpdateUserDept" src` 결과 호출처가 없으면 삭제.

- [ ] **Step 4: 통과 확인** — 해당 테스트 + `npx tsx --test "src/**/*.test.ts"` 전체. 깨지는 기존 테스트는 원인 확인 후 기준정보 시드 보정(동작 변경이 아니라 전제 변경인 경우만).
- [ ] **Step 5: 타입체크·커밋** — `feat(인명관리): 소속을 ID로 저장하고 읽을 때 기준정보 이름으로 채움`

---

### Task 3: 기준정보 화면 — 연쇄 반영 제거, 삭제 차단 ID 기준

**Files:**
- Modify: `src/data/orgSync/orgSync.ts` (`cascadeDepartmentRename`·`cascadePositionRename`·`cascadeJobTitleRename` 삭제, `setPersonJobTitle`에서 `userRepo.updateJobTitle` 호출 삭제, 차단 함수 ID 기준)
- Modify: `src/data/orgSync/orgSync.test.ts`
- Modify: `src/modules/base/department/DepartmentScreen.tsx` (연쇄 반영 호출·refresh 중 이름 변경 분기 삭제 — 저장 후 `refreshPeople()`은 유지)
- Modify: `src/modules/base/position/PositionScreen.tsx` (연쇄 반영 호출 삭제, 삭제 차단은 ID 인자로)

**Interfaces:**
- Consumes: Task 2 저장소(프로필 `deptId/positionId/jobTitleId`)
- Produces:
  - `departmentDeleteBlocker(dept: {id,name}, allDepts): Promise<string|null>` — 인명관리 `deptId === dept.id`(재직자) + 겸직 `deptId`(재직자) + 하위 부서
  - `positionDeleteBlocker(positionId: string): Promise<string|null>`
  - `jobTitleDeleteBlocker(jobTitleId: string): Promise<string|null>` — 인명관리 + 겸직 `jobTitleId`
  - `setPersonJobTitle(userId, jobTitleName)` — 프로필 저장(이름→ID는 저장소가), 본직 겸직행 있으면 그 직책도

- [ ] **Step 1: 테스트 수정** — 연쇄 반영 테스트 3개 삭제. 나머지는 기준정보를 시드하고, 사람은 프로필로만 소속을 갖게(계정 `dept`는 엉뚱한 값) 바꿔 **ID 기준임을 증명**:
  - 부서장 직책: 프로필 `jobTitleId`가 지정 직책 ID, 사람 목록 `jobTitle`이 그 이름.
  - 부서 삭제 차단: 계정 `dept`가 그 부서명이어도 프로필 `deptId`가 다른 부서면 막지 않음 / 프로필 `deptId`가 그 부서면 막음.
  - 직급·직책 삭제 차단: ID 인자로 같은 판단, 퇴직자 제외.
- [ ] **Step 2: 실패 확인** → **Step 3: 구현** → **Step 4: 통과 + 전체 테스트 + tsc**
- [ ] **Step 5: 커밋** — `refactor(기준정보): 이름 변경 연쇄 반영 제거, 삭제 차단을 ID 기준으로`

---

### Task 4: 전자설문 서버 — 사람 목록에 소속 이름 채우기

**Files:**
- Modify: `appwrite/functions/survey/src/appwriteStore.ts` (`listUsers`가 `employeeProfiles`·`positions`·`jobTitles`·`departments`를 읽어 `resolveAffiliation`으로 `dept/position/jobTitle` 채움)
- Modify: `server/survey/testkit.ts` 등 메모리 명부가 있으면 같은 규칙 반영 필요 여부 확인
- Test: `server/survey/dispatch.test.ts` (부서 대상 설문에서 계정 `dept` 대신 프로필 기준 부서로 판단되는 케이스 추가 — 명부 구현 방식에 맞춰)

- [ ] 실패 테스트 → 구현 → `npx tsx --test "server/**/*.test.ts"` 통과 → 설문 함수 번들 빌드(`appwrite/functions/survey/package.json`의 build 스크립트) 성공 확인 → 커밋 `fix(설문 서버): 사람 소속을 인명관리 기준으로`
- 운영 미반영 함수이므로 배포는 하지 않는다.

---

### Task 5: 출퇴근 연동 함수 — 열람 범위를 인명관리 기준으로

**Files:**
- Create: `appwrite/functions/caps-ingest/src/scope.js` — 순수 함수 `resolveScopeFromDirectory({ uid, me, profiles, depts, positions, jobTitles, headedDeptIds, mappings })`
- Modify: `appwrite/functions/caps-ingest/src/main.js` (`resolveViewerScope`가 DB에서 프로필·기준정보를 읽어 위 함수에 넘김. `users`를 `dept`로 검색하던 코드 제거 → 프로필 `deptId`로 부서원 판단. roleMappings DEPT/POSITION은 `targetId`가 ID 또는 이름 어느 쪽이어도 일치)
- Test: `appwrite/functions/caps-ingest/src/scope.test.mjs` (`node --test`)

- [ ] 실패 테스트(부서장 → 같은 `deptId` 프로필 전원, 계정 `dept`가 옛 이름이어도 결과 동일 / 매핑 DEPT targetId=ID·이름 둘 다 / 일반 사원 본인만) → 구현 → 통과 → 커밋 `fix(출퇴근 연동): 열람 범위를 인명관리 소속 ID로 판단`
- 재배포는 Task 7 이후 사용자 지시 시(`scripts/deploy-caps-ingest.mjs`).

---

### Task 6: DB 칸 추가·기존 데이터 채우기 스크립트 (개발 DB만 적용)

**Files:**
- Modify: `scripts/appwrite-schema.ts` — `departmentMembers`에 `S('jobTitleId', 64)`; `employeeProfiles` 정의 추가(새 칸 `deptId`·`positionId`·`jobTitleId` 각 `S(…, 64)`만 — 기존 칸은 이미 있으므로 생략, 정의 주석에 "기존 칸은 운영 DB에 이미 있음" 명시). 컬렉션이 있으면 생성은 건너뛰고 없는 칸만 만든다(`ensureCollection`/`ensureAttribute` 동작 확인함).
- Create: `scripts/backfill-affiliation-ids.ts` — 기본 확인만, `--apply`로 적용, `--prod`로 운영. `loadAppwriteConfig` 사용. 동작:
  1. `departments`·`positions`·`jobTitles`·`users`·`employeeProfiles`·`departmentMembers` 전량 읽기(커서 페이지)
  2. 각 프로필: ID 칸이 비어 있는 것만, 이름(프로필 → 없으면 계정)으로 ID 찾기 → `updateDocument`로 **새 칸만** 전송
  3. 각 겸직행: `jobTitleId` 비어 있고 `jobTitle` 이름으로 찾으면 전송
  4. 못 찾은 이름은 사람 이름과 함께 출력, 비워 둠
  5. 끝에 "변경 예정/적용 N건, 못 찾음 M건" 요약
- [ ] 개발 DB: `npx tsx scripts/appwrite-schema.ts --only=employeeProfiles,departmentMembers` → 확인만 실행 → 결과 검토 → `--apply` → 다시 확인만 실행해 0건 확인
- [ ] 커밋 `chore(인명관리): 소속 ID 칸 추가·기존 데이터 채우기 스크립트`

---

### Task 7: 전체 검증 (개발 DB)

- [ ] `npx tsc --noEmit`, `npx tsx --test "src/**/*.test.ts"`, `npx tsx --test "server/**/*.test.ts"`, caps-ingest 테스트, `npm run build`
- [ ] 개발 서버(`run-app` 스킬):
  - 부서관리에서 품질심사팀 → 품질심사팀X: 조직도·인명관리·메신저 참여자 표시·업무계획 부서 묶음에 즉시 반영 → 원복
  - 인명관리 편집에서 한 사람의 직급을 바꿨다가 원복, 조직도·사람 목록 반영
  - 부서장 지정 화면에서 직책 표시 확인(저장은 원복 가능한 범위만)
  - 화면 어디에도 ID 노출 없음
- [ ] 최종 검토(별도 검토자) → 지적 반영
- [ ] 운영 반영 순서(사용자 지시 후): 운영 칸 추가 → 채우기 확인만 → 적용 → 웹 배포 + caps-ingest 재배포
