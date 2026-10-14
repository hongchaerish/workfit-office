# 전자설문 1단계 — 서버 처리 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 설문 쓰기·제출·결과 조회를 Appwrite Function `survey`로 옮기고, 익명 응답을 역추적할 수 없게 하며, 응답 컬렉션을 브라우저에서 잠근다.

**Architecture:** 업무 규칙은 `server/survey/`(TypeScript, 저장소 포트 주입)에 두고 `src/domain/survey/*`를 그대로 import한다. Function 진입점(`appwrite/functions/survey/src/main.ts`)은 esbuild로 한 파일에 묶여 배포된다. 앱의 repo 계층은 시그니처를 유지한 채 gateway(`createExecution`) 호출로 바뀐다.

**Tech Stack:** TypeScript, zod 4, node-appwrite 27(함수), appwrite(브라우저), esbuild(번들), node:test + tsx(테스트), React Query.

**Spec:** `docs/superpowers/specs/2026-10-14-survey-server-design.md`

## Global Constraints

- 운영 단계(함수 `--prod` 배포, 운영 권한 잠금, `origin main` push)는 **매번 사용자 확인 후** 실행한다.
- 기존 결재 문서(`approvalDocs`)·서식(`approvalForms`)은 읽기 전용. 이 계획은 둘을 건드리지 않는다.
- 운영 설문 데이터는 테스트뿐 — 데이터 이전 없음.
- 오류 코드는 기존 `SurveyErrorCode`만 쓴다(새 코드 추가 금지). 인증 실패만 HTTP 401/403로 따로 낸다.
- 응답 계약: `{ data }` 또는 `{ error: { code, message } }`. 빈 응답·`data` 없는 응답은 실패.
- 응답·답변 ID는 무작위(`ID.unique()`/`randomUUID`). 익명 응답 `submittedAt`·익명 설문 `firstRespondedAt`은 **KST 날짜의 00:00**만.
- 참여 기록에 시각을 쓰지 않는다. ID는 `설문ID__사용자ID`.
- 커밋 메시지 끝: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- 검증 명령: `npx tsc --noEmit -p .`, `npx tsc --noEmit -p tsconfig.server.json`, `npx tsx --test server/survey/*.test.ts`, `npm run build`

### 스펙과 달라진 점(구현 정밀화)

- 핵심 로직 위치를 `appwrite/functions/survey/src/handler.ts` → **`server/survey/`**로 옮긴다. 기존 `server/caps`(TS + 테스트, `tsconfig.server.json`)와 같은 자리이고, 함수 디렉터리에는 진입점과 Appwrite 어댑터만 둔다.
- 스펙 3.3의 "메모리 드라이버에서 브라우저가 handler를 직접 실행"은 **하지 않는다**. 앱은 Appwrite로만 운영되고, 메모리 어댑터는 테스트 전용이다. Appwrite가 설정되지 않은 환경에서는 설문 화면이 "설문 서버가 설정되지 않았습니다" 오류를 낸다.
- 인덱스(`surveyId`, `userId`)는 `scripts/appwrite-schema.ts`에 **이미 있다**. 스펙 10의 1단계(인덱스 추가)는 권한 정의 변경으로 대체된다.

## Review Focus

1. **함수 콜드 스타트 중 목록이 비어 보임** — 첫 호출이 느려도 "불러오는 중"을 유지하고 빈 목록으로 오인하지 않아야 한다 → Task 7의 gateway가 실패를 빈 배열로 바꾸지 않는지 테스트.
2. **토큰 만료(12h) 후 설문 화면** — 401이면 "다시 로그인" 안내가 떠야지 권한 없음처럼 보이면 안 된다 → Task 5 테스트(만료 토큰 → 401), Task 7 gateway 매핑.
3. **질문 저장 직후 응답 화면의 version 불일치** — 작성자가 질문을 고친 뒤 응답하면 `VERSION_CHANGED`로 막혀야 한다 → Task 4 테스트.
4. **결과 비공개 설문에 참여한 사람이 결과 URL을 직접 여는 경우** → Task 4 테스트(`FORBIDDEN`).
5. **같은 사용자가 두 탭에서 동시에 제출** → Task 4 테스트(동시 `Promise.all` 제출 → 1건만).

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `server/survey/port.ts` (신규) | 저장소·명부 포트 인터페이스, 서비스 컨텍스트 타입 |
| `server/survey/memoryStore.ts` (신규) | 테스트용 메모리 어댑터 |
| `server/survey/manage.ts` (신규) | 작성·수정·질문 저장·상태 전이·복제·삭제·목록 |
| `server/survey/respond.ts` (신규) | 제출·참여 현황·응답자 목록·결과 |
| `server/survey/token.ts` (신규) | 서명 토큰 검증 |
| `server/survey/dispatch.ts` (신규) | 토큰 → actor 해석 → action 분기 → `{status, body}` |
| `server/survey/*.test.ts` (신규) | 위 각각의 테스트 |
| `src/domain/survey/anonymity.ts` (신규) | `kstDayStamp`, `shuffle` — 순수 함수 |
| `src/domain/surveyParticipation/schema.ts` | `respondedAt` 제거 |
| `appwrite/functions/survey/{appwrite.json,package.json,README.md}` (신규) | 함수 메타 |
| `appwrite/functions/survey/src/appwriteStore.ts` (신규) | node-appwrite 어댑터 |
| `appwrite/functions/survey/src/main.ts` (신규) | Function 진입점 |
| `scripts/deploy-survey.mjs` (신규) | esbuild 번들 + 배포 |
| `scripts/appwrite-survey-permissions.mjs` (신규) | 5개 컬렉션 권한 잠금 |
| `scripts/appwrite-schema.ts` | 5개 컬렉션 `permissions` 정의 |
| `src/data/survey/survey.gateway.ts` (신규) | 함수 호출 |
| `src/data/survey/survey.repo.ts`, `src/data/surveyQuestion/surveyQuestion.repo.ts`, `src/data/surveyResponse/surveyResponse.repo.ts` | gateway 호출로 교체 |
| `src/data/survey/store.ts` | 삭제 |
| `src/features/survey/useSurveyResponse.ts`, `src/modules/gw/survey/SurveyResult.tsx`, `src/modules/gw/survey/SurveyScreen.tsx` | 결과 형식 변경, 시연용 사용자 선택 제거 |

---

### Task 1: 익명성 도우미와 참여 기록 스키마

**Files:**
- Create: `src/domain/survey/anonymity.ts`
- Create: `src/domain/survey/anonymity.test.ts`
- Modify: `src/domain/surveyParticipation/schema.ts`

**Interfaces:**
- Produces: `kstDayStamp(now: Date): string`, `shuffle<T>(items: T[], random?: () => number): T[]`, `SurveyParticipation` = `{ id, surveyId, userId, responded }`

- [ ] **Step 1: 실패 테스트 작성** — `src/domain/survey/anonymity.test.ts`

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { kstDayStamp, shuffle } from './anonymity';
import { surveyParticipationSchema } from '../surveyParticipation/schema';

test('kstDayStamp 는 KST 날짜의 00:00 을 UTC ISO 로 돌려준다', () => {
  // 2026-10-14 23:30 KST = 14:30Z → 2026-10-14 00:00 KST = 2026-10-13T15:00Z
  assert.equal(kstDayStamp(new Date('2026-10-14T14:30:00Z')), '2026-10-13T15:00:00.000Z');
  // 2026-10-15 00:10 KST = 2026-10-14T15:10Z → 2026-10-15 00:00 KST
  assert.equal(kstDayStamp(new Date('2026-10-14T15:10:00Z')), '2026-10-14T15:00:00.000Z');
});

test('shuffle 은 원소를 보존하고 원본을 바꾸지 않는다', () => {
  const src = [1, 2, 3, 4, 5];
  const out = shuffle(src, () => 0);
  assert.deepEqual([...out].sort(), [1, 2, 3, 4, 5]);
  assert.deepEqual(src, [1, 2, 3, 4, 5]);
  assert.notDeepEqual(out, src);
});

test('참여 기록에는 시각이 없다', () => {
  const row = surveyParticipationSchema.parse({ id: 'S1__U1', surveyId: 'S1', userId: 'U1', responded: true });
  assert.equal('respondedAt' in row, false);
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx --test src/domain/survey/anonymity.test.ts`
Expected: FAIL — `Cannot find module './anonymity'`

- [ ] **Step 3: 구현** — `src/domain/survey/anonymity.ts`

```ts
/**
 * 익명 설문에서 응답자를 시각으로 맞춰 보지 못하게 하는 도우미.
 * ([[docs/superpowers/specs/2026-10-14-survey-server-design.md]] §6)
 */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** KST 기준 그날 00:00 을 UTC ISO 문자열로. 시·분·초를 버려 제출 순서를 감춘다. */
export function kstDayStamp(now: Date): string {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  const midnightKstAsUtc = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate());
  return new Date(midnightKstAsUtc - KST_OFFSET_MS).toISOString();
}

/** Fisher–Yates. 원본은 그대로 두고 섞은 사본을 돌려준다. */
export function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
```

`src/domain/surveyParticipation/schema.ts` — `respondedAt` 줄을 지우고 주석에 이유를 적는다:

```ts
export const surveyParticipationSchema = z.object({
  id: z.string().min(1),
  surveyId: z.string().min(1),
  userId: z.string().min(1),
  /**
   * 참여 여부만 남긴다. 시각을 두면 익명 응답의 제출 시각과 맞춰 응답자를 알아낼 수 있다.
   * ([[docs/superpowers/specs/2026-10-14-survey-server-design.md]] §6)
   */
  responded: z.boolean(),
}).superRefine((value, ctx) => {
  if (value.id !== surveyParticipationId(value.surveyId, value.userId)) {
    ctx.addIssue({ code: 'custom', path: ['id'], message: '참여 기록 ID는 설문ID__사용자ID 형식이어야 합니다.' });
  }
});
```

- [ ] **Step 4: 통과 확인**

Run: `npx tsx --test src/domain/survey/anonymity.test.ts`
Expected: PASS (3 tests). `npx tsc --noEmit -p .` 은 `surveyResponse.repo.ts`의 `respondedAt`에서 오류가 난다 — Task 7에서 그 파일을 교체하므로, 이 단계에서는 해당 줄(`respondedAt: stamp,`)만 지워 타입체크를 통과시킨다.

- [ ] **Step 5: 커밋**

```bash
git add src/domain/survey/anonymity.ts src/domain/survey/anonymity.test.ts src/domain/surveyParticipation/schema.ts src/data/surveyResponse/surveyResponse.repo.ts
git commit -m "feat(survey): 익명성 도우미(kstDayStamp·shuffle), 참여 기록에서 시각 제거"
```

---

### Task 2: 저장소 포트와 메모리 어댑터

**Files:**
- Create: `server/survey/port.ts`
- Create: `server/survey/memoryStore.ts`
- Create: `server/survey/memoryStore.test.ts`

**Interfaces:**
- Produces:

```ts
export type Coll = 'surveys' | 'surveyQuestions' | 'surveyResponses' | 'surveyAnswers' | 'surveyParticipations';
export interface SurveyStorePort {
  getSurvey(id: string): Promise<Survey | null>;
  listSurveys(filter?: { ownerUserId?: string }): Promise<Survey[]>;
  listQuestions(surveyId: string): Promise<SurveyQuestion[]>;
  listResponses(surveyId: string): Promise<SurveyResponse[]>;
  listAnswers(surveyId: string): Promise<SurveyAnswer[]>;
  countResponses(surveyId: string): Promise<number>;
  hasParticipation(surveyId: string, userId: string): Promise<boolean>;
  listParticipatedSurveyIds(userId: string): Promise<string[]>;
  /** 새로 만들 때만 성공. 같은 ID가 있으면 'exists'. */
  insert(coll: Coll, row: { id: string }): Promise<'created' | 'exists'>;
  /** 있으면 덮고 없으면 만든다. */
  save(coll: Coll, row: { id: string }): Promise<void>;
  remove(coll: Coll, id: string): Promise<void>;
}
export interface DirectoryPort {
  listUsers(): Promise<User[]>;
  listDepartments(): Promise<Department[]>;
  listRoleGroups(): Promise<RoleGroup[]>;
  listPositions(): Promise<Position[]>;
}
export interface Actor { user: User; deptId: string | null; isAdmin: boolean }
export interface ServiceCtx {
  store: SurveyStorePort;
  directory: DirectoryPort;
  actor: Actor;
  now: () => Date;
  newId: () => string;
  random?: () => number;
}
export function createMemoryStore(seed?: Partial<Record<Coll, { id: string }[]>>): SurveyStorePort & { dump(coll: Coll): { id: string }[]; failNextInsert?: Coll };
```

- [ ] **Step 1: 실패 테스트** — `server/survey/memoryStore.test.ts`

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryStore } from './memoryStore';

test('insert 는 같은 ID 가 있으면 exists 를 돌려주고 덮지 않는다', async () => {
  const store = createMemoryStore();
  const row = { id: 'S1__U1', surveyId: 'S1', userId: 'U1', responded: true };
  assert.equal(await store.insert('surveyParticipations', row), 'created');
  assert.equal(await store.insert('surveyParticipations', { ...row, responded: false }), 'exists');
  assert.equal((store.dump('surveyParticipations')[0] as typeof row).responded, true);
});

test('설문별 조회는 surveyId 로 좁힌다', async () => {
  const store = createMemoryStore({
    surveyResponses: [
      { id: 'r1', surveyId: 'S1' } as never,
      { id: 'r2', surveyId: 'S2' } as never,
    ],
  });
  assert.deepEqual((await store.listResponses('S1')).map((r) => r.id), ['r1']);
  assert.equal(await store.countResponses('S2'), 1);
});

test('failNextInsert 로 지정한 컬렉션의 다음 insert 는 실패한다(보상 시험용)', async () => {
  const store = createMemoryStore();
  store.failNextInsert = 'surveyAnswers';
  await assert.rejects(store.insert('surveyAnswers', { id: 'a1' }));
  assert.equal(await store.insert('surveyAnswers', { id: 'a2' }), 'created');
});
```

- [ ] **Step 2: 실패 확인** — Run: `npx tsx --test server/survey/memoryStore.test.ts` / Expected: FAIL (모듈 없음)

- [ ] **Step 3: 구현** — `server/survey/port.ts`에 위 Interfaces 블록 그대로(타입 import: `Survey` from `@/domain/survey/schema`, `SurveyQuestion` from `@/domain/surveyQuestion/schema`, `SurveyResponse` from `@/domain/surveyResponse/schema`, `SurveyAnswer` from `@/domain/surveyAnswer/schema`, `User` from `@/domain/user/schema`, `Department` from `@/domain/department/schema`, `RoleGroup` from `@/domain/roleGroup/schema`, `Position` from `@/domain/position/schema`). `createMemoryStore` 선언은 memoryStore.ts에 둔다.

`server/survey/memoryStore.ts`:

```ts
import type { Survey } from '@/domain/survey/schema';
import type { SurveyQuestion } from '@/domain/surveyQuestion/schema';
import type { SurveyResponse } from '@/domain/surveyResponse/schema';
import type { SurveyAnswer } from '@/domain/surveyAnswer/schema';
import type { SurveyParticipation } from '@/domain/surveyParticipation/schema';
import type { Coll, SurveyStorePort } from './port';

type Row = { id: string };

/** 테스트용 메모리 저장소. 깊은 복사로 돌려줘 호출부가 내부 상태를 바꾸지 못하게 한다. */
export function createMemoryStore(seed: Partial<Record<Coll, Row[]>> = {}) {
  const data: Record<Coll, Map<string, Row>> = {
    surveys: new Map(), surveyQuestions: new Map(), surveyResponses: new Map(),
    surveyAnswers: new Map(), surveyParticipations: new Map(),
  };
  for (const [coll, rows] of Object.entries(seed) as [Coll, Row[]][]) {
    for (const row of rows) data[coll].set(row.id, structuredClone(row));
  }
  const all = <T>(coll: Coll) => [...data[coll].values()].map((row) => structuredClone(row) as T);
  const bySurvey = <T extends { surveyId: string }>(coll: Coll, surveyId: string) =>
    all<T>(coll).filter((row) => row.surveyId === surveyId);

  const store: SurveyStorePort & { dump(coll: Coll): Row[]; failNextInsert?: Coll } = {
    async getSurvey(id) { const row = data.surveys.get(id); return row ? (structuredClone(row) as Survey) : null; },
    async listSurveys(filter) {
      return all<Survey>('surveys').filter((row) => !filter?.ownerUserId || row.ownerUserId === filter.ownerUserId);
    },
    async listQuestions(surveyId) { return bySurvey<SurveyQuestion>('surveyQuestions', surveyId); },
    async listResponses(surveyId) { return bySurvey<SurveyResponse>('surveyResponses', surveyId); },
    async listAnswers(surveyId) { return bySurvey<SurveyAnswer>('surveyAnswers', surveyId); },
    async countResponses(surveyId) { return bySurvey<SurveyResponse>('surveyResponses', surveyId).length; },
    async hasParticipation(surveyId, userId) { return data.surveyParticipations.has(`${surveyId}__${userId}`); },
    async listParticipatedSurveyIds(userId) {
      return all<SurveyParticipation>('surveyParticipations').filter((row) => row.userId === userId).map((row) => row.surveyId);
    },
    async insert(coll, row) {
      if (store.failNextInsert === coll) { store.failNextInsert = undefined; throw new Error(`insert ${coll} 실패(테스트)`); }
      if (data[coll].has(row.id)) return 'exists';
      data[coll].set(row.id, structuredClone(row));
      return 'created';
    },
    async save(coll, row) { data[coll].set(row.id, structuredClone(row)); },
    async remove(coll, id) { data[coll].delete(id); },
    dump(coll) { return all<Row>(coll); },
  };
  return store;
}
```

- [ ] **Step 4: 통과 확인** — Run: `npx tsx --test server/survey/memoryStore.test.ts` / Expected: PASS (3). Run: `npx tsc --noEmit -p tsconfig.server.json` / Expected: 오류 없음.

- [ ] **Step 5: 커밋**

```bash
git add server/survey/port.ts server/survey/memoryStore.ts server/survey/memoryStore.test.ts
git commit -m "feat(survey): 설문 서버 저장소 포트와 테스트용 메모리 어댑터"
```

---

### Task 3: 설문 관리 서비스 (작성·수정·질문·상태·복제·삭제·목록)

**Files:**
- Create: `server/survey/manage.ts`
- Create: `server/survey/testkit.ts` (테스트 공용 픽스처)
- Create: `server/survey/manage.test.ts`

**Interfaces:**
- Consumes: Task 2 `ServiceCtx`, `SurveyStorePort`, `createMemoryStore`
- Produces (모두 `async`, 실패 시 `SurveyError` throw):
  - `listMine(ctx, { scope?: 'mine' | 'all' }): Promise<Survey[]>` — `'all'`은 관리자만
  - `getSurvey(ctx, { id }): Promise<Survey>` — 작성자·관리자·대상자
  - `listQuestions(ctx, { surveyId }): Promise<SurveyQuestion[]>` — 같은 권한
  - `createDraft(ctx, { draft: SurveyDraft }): Promise<Survey>`
  - `updateBasics(ctx, { id, draft }): Promise<Survey>`
  - `replaceQuestions(ctx, { surveyId, drafts: SurveyQuestionDraft[] }): Promise<SurveyQuestion[]>`
  - `publish | close | archive | duplicate (ctx, { id }): Promise<Survey>`, `remove(ctx, { id }): Promise<null>`
  - 내부 공용: `requireSurvey(ctx, id)`, `requireManageable(ctx, id)`, `nextSurveyId(ctx)`, `nextQuestionIds(ctx, n)`

- [ ] **Step 1: 테스트 픽스처** — `server/survey/testkit.ts`

```ts
import type { User } from '@/domain/user/schema';
import type { SurveyDraft } from '@/domain/survey/schema';
import { createMemoryStore } from './memoryStore';
import type { Actor, DirectoryPort, ServiceCtx } from './port';

export const NOW = new Date('2026-10-14T03:00:00Z'); // 12:00 KST

export const user = (id: string, dept = '개발팀', status: User['status'] = '사용'): User =>
  ({ id, empNo: id, name: `사용자${id}`, dept, position: '사원', status } as User);

export const directory = (users: User[]): DirectoryPort => ({
  async listUsers() { return users; },
  async listDepartments() { return [{ id: 'D1', name: '개발팀' }, { id: 'D2', name: '영업팀' }] as never; },
  async listRoleGroups() { return []; },
  async listPositions() { return []; },
});

let seq = 0;
export function makeCtx(actor: Actor, store = createMemoryStore(), users: User[] = [actor.user]): ServiceCtx & { store: ReturnType<typeof createMemoryStore> } {
  return { store, directory: directory(users), actor, now: () => NOW, newId: () => `rand${(seq += 1).toString(36)}x`, random: () => 0.5 };
}

export const actorOf = (u: User, isAdmin = false): Actor => ({ user: u, deptId: u.dept === '영업팀' ? 'D2' : 'D1', isAdmin });

export const DRAFT: SurveyDraft = {
  title: '만족도 조사', description: '', categoryCode: 'EMPLOYEE',
  audienceType: 'COMPANY', audienceDeptIds: [], audienceUserIds: [],
  anonymous: true, startsAt: '2026-10-14T00:00:00.000Z', endsAt: '2026-10-20T00:00:00.000Z',
  showResultToRespondent: false,
};

export const RATING_Q = {
  id: null, type: 'RATING' as const, title: '만족하나요?', description: '', required: true, order: 0,
  options: [], ratingMinLabel: '불만', ratingMaxLabel: '만족', maxLength: null,
};
export const TEXT_Q = {
  id: null, type: 'LONG_TEXT' as const, title: '의견', description: '', required: false, order: 10,
  options: [], ratingMinLabel: '', ratingMaxLabel: '', maxLength: null,
};
```

- [ ] **Step 2: 실패 테스트** — `server/survey/manage.test.ts`

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { SurveyError } from '@/domain/survey/engine';
import { createDraft, replaceQuestions, publish, close, remove, listMine, duplicate, getSurvey } from './manage';
import { actorOf, DRAFT, makeCtx, RATING_Q, user } from './testkit';

const owner = user('U1');
const other = user('U2');

async function publishedSurvey() {
  const ctx = makeCtx(actorOf(owner));
  const s = await createDraft(ctx, { draft: DRAFT });
  await replaceQuestions(ctx, { surveyId: s.id, drafts: [RATING_Q] });
  await publish(ctx, { id: s.id });
  return { ctx, id: s.id };
}

test('초안 생성 — 서버가 ID·작성자를 정한다', async () => {
  const ctx = makeCtx(actorOf(owner));
  const s = await createDraft(ctx, { draft: DRAFT });
  assert.match(s.id, /^SUR-20261014-\d{4}$/);
  assert.equal(s.ownerUserId, 'U1');
  assert.equal(s.status, 'DRAFT');
});

test('남의 설문은 마감할 수 없다', async () => {
  const { ctx, id } = await publishedSurvey();
  const otherCtx = { ...ctx, actor: actorOf(other) };
  await assert.rejects(close(otherCtx, { id }), (e: unknown) => e instanceof SurveyError && e.code === 'FORBIDDEN');
});

test('최고관리자는 남의 설문도 마감할 수 있다', async () => {
  const { ctx, id } = await publishedSurvey();
  const adminCtx = { ...ctx, actor: actorOf(other, true) };
  const closed = await close(adminCtx, { id });
  assert.equal(closed.status, 'CLOSED');
});

test('배포된 설문은 삭제할 수 없다', async () => {
  const { ctx, id } = await publishedSurvey();
  await assert.rejects(remove(ctx, { id }), (e: unknown) => e instanceof SurveyError && e.code === 'INVALID_STATUS');
});

test('초안 삭제는 질문까지 지운다', async () => {
  const ctx = makeCtx(actorOf(owner));
  const s = await createDraft(ctx, { draft: DRAFT });
  await replaceQuestions(ctx, { surveyId: s.id, drafts: [RATING_Q] });
  await remove(ctx, { id: s.id });
  assert.equal(ctx.store.dump('surveyQuestions').length, 0);
  assert.equal(ctx.store.dump('surveys').length, 0);
});

test('질문 저장은 questionCount·version 을 갱신한다', async () => {
  const ctx = makeCtx(actorOf(owner));
  const s = await createDraft(ctx, { draft: DRAFT });
  const qs = await replaceQuestions(ctx, { surveyId: s.id, drafts: [RATING_Q] });
  assert.match(qs[0].id, /^Q-\d{4}$/);
  const after = await getSurvey(ctx, { id: s.id });
  assert.equal(after.questionCount, 1);
  assert.equal(after.version, s.version + 1);
});

test('listMine scope=all 은 관리자만', async () => {
  const { ctx } = await publishedSurvey();
  await assert.rejects(listMine({ ...ctx, actor: actorOf(other) }, { scope: 'all' }), (e: unknown) => e instanceof SurveyError && e.code === 'FORBIDDEN');
  assert.equal((await listMine({ ...ctx, actor: actorOf(other, true) }, { scope: 'all' })).length, 1);
});

test('대상이 아닌 사용자는 설문을 열 수 없다', async () => {
  const ctx = makeCtx(actorOf(owner));
  const s = await createDraft(ctx, { draft: { ...DRAFT, audienceType: 'USERS', audienceUserIds: ['U1'] } });
  await replaceQuestions(ctx, { surveyId: s.id, drafts: [RATING_Q] });
  await publish(ctx, { id: s.id });
  await assert.rejects(getSurvey({ ...ctx, actor: actorOf(other) }, { id: s.id }), (e: unknown) => e instanceof SurveyError && e.code === 'NOT_AUDIENCE');
});

test('복제는 기간을 비운 새 초안과 질문을 만든다', async () => {
  const { ctx, id } = await publishedSurvey();
  const copy = await duplicate(ctx, { id });
  assert.equal(copy.status, 'DRAFT');
  assert.equal(copy.startsAt, null);
  assert.equal(ctx.store.dump('surveyQuestions').length, 2);
});
```

- [ ] **Step 3: 실패 확인** — Run: `npx tsx --test server/survey/manage.test.ts` / Expected: FAIL (모듈 없음)

- [ ] **Step 4: 구현** — `server/survey/manage.ts`. 로직은 현재 `src/data/survey/survey.repo.ts`·`src/data/surveyQuestion/surveyQuestion.repo.ts`를 옮긴 것이고, 차이는 (a) 전역 `surveyStore` 대신 `ctx.store`, (b) `canManageSurvey(actor.user, row, actor.isAdmin)`, (c) 채번을 서버에서 하고 `insert`가 `'exists'`면 다음 번호로 재시도, (d) `deriveSurvey`로 상태를 보정해 돌려줌.

```ts
import {
  assertEndsAtChange, assertPublishable, assertQuestionsEditable, assertQuestionSet, assertSurveyTransition,
  canCreateSurvey, canManageSurvey, deriveSurvey, deriveSurveyStatus, isSurveyAudience, normalizeQuestionOrders,
  publishedStatus, SurveyError, surveyEditScope,
} from '@/domain/survey/engine';
import { isSelectableSurveyCategory } from '@/domain/survey/category';
import { surveySchema, type Survey, type SurveyDraft } from '@/domain/survey/schema';
import { surveyQuestionSchema, type SurveyQuestion, type SurveyQuestionDraft } from '@/domain/surveyQuestion/schema';
import type { ServiceCtx } from './port';

const maxSuffix = (ids: string[]) =>
  ids.reduce((v, id) => { const n = Number(id.match(/(\d+)$/)?.[1]); return Number.isFinite(n) ? Math.max(v, n) : v; }, 0);

const ymd = (d: Date) => {
  const kst = new Date(d.getTime() + 9 * 3600_000);
  return `${kst.getUTCFullYear()}${String(kst.getUTCMonth() + 1).padStart(2, '0')}${String(kst.getUTCDate()).padStart(2, '0')}`;
};

/** 설문 저장 시 상태 보정. 기간이 지난 설문을 읽을 때마다 저장 상태를 맞춘다. */
async function fresh(ctx: ServiceCtx, row: Survey): Promise<Survey> {
  const next = deriveSurvey(row, ctx.now());
  if (next !== row) await ctx.store.save('surveys', surveySchema.parse(next));
  return next;
}

export async function requireSurvey(ctx: ServiceCtx, id: string): Promise<Survey> {
  const row = await ctx.store.getSurvey(id);
  if (!row) throw new SurveyError('INVALID_INPUT', '설문을 찾을 수 없습니다.');
  return fresh(ctx, row);
}

const canManage = (ctx: ServiceCtx, row: Survey) => canManageSurvey(ctx.actor.user, row, ctx.actor.isAdmin);

export async function requireManageable(ctx: ServiceCtx, id: string): Promise<Survey> {
  const row = await requireSurvey(ctx, id);
  if (!canManage(ctx, row)) throw new SurveyError('FORBIDDEN', '이 설문을 관리할 권한이 없습니다.');
  return row;
}

/** 작성자·관리자는 언제나, 그 밖에는 배포된 설문의 대상자만 열람한다. */
async function requireReadable(ctx: ServiceCtx, id: string): Promise<Survey> {
  const row = await requireSurvey(ctx, id);
  if (canManage(ctx, row)) return row;
  if (row.status === 'DRAFT' || !isSurveyAudience(row, ctx.actor.user, ctx.actor.deptId)) {
    throw new SurveyError('NOT_AUDIENCE', '이 설문의 대상자가 아닙니다.');
  }
  return row;
}

function assertCategory(code: string) {
  if (!isSelectableSurveyCategory(undefined, code)) throw new SurveyError('INVALID_INPUT', '사용할 수 없는 설문 분류입니다.');
}

/** `SUR-YYYYMMDD-XXXX` — 생성이 겹치면(409) 다음 번호로 재시도한다. */
async function insertSurvey(ctx: ServiceCtx, build: (id: string) => Survey): Promise<Survey> {
  const base = maxSuffix((await ctx.store.listSurveys()).map((row) => row.id));
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const row = surveySchema.parse(build(`SUR-${ymd(ctx.now())}-${String(base + attempt).padStart(4, '0')}`));
    if ((await ctx.store.insert('surveys', row)) === 'created') return row;
  }
  throw new SurveyError('INVALID_INPUT', '설문 번호를 정하지 못했습니다. 잠시 후 다시 시도하세요.');
}

/** 질문 ID `Q-XXXX` — 전체 설문의 최댓값 다음부터. 겹치면 그 질문만 다음 번호로. */
async function insertQuestions(ctx: ServiceCtx, rows: Omit<SurveyQuestion, 'id'>[]): Promise<SurveyQuestion[]> {
  const surveys = await ctx.store.listSurveys();
  const allIds = (await Promise.all(surveys.map((s) => ctx.store.listQuestions(s.id)))).flat().map((q) => q.id);
  let next = maxSuffix(allIds) + 1;
  const out: SurveyQuestion[] = [];
  for (const row of rows) {
    for (;;) {
      const q = surveyQuestionSchema.parse({ ...row, id: `Q-${String(next).padStart(4, '0')}` });
      next += 1;
      if ((await ctx.store.insert('surveyQuestions', q)) === 'created') { out.push(q); break; }
    }
  }
  return out;
}

export async function listMine(ctx: ServiceCtx, { scope = 'mine' }: { scope?: 'mine' | 'all' }): Promise<Survey[]> {
  if (scope === 'all' && !ctx.actor.isAdmin) throw new SurveyError('FORBIDDEN', '전체 설문은 관리자만 볼 수 있습니다.');
  const rows = await ctx.store.listSurveys(scope === 'all' ? undefined : { ownerUserId: ctx.actor.user.id });
  const out = await Promise.all(rows.map((row) => fresh(ctx, row)));
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export const getSurvey = (ctx: ServiceCtx, { id }: { id: string }) => requireReadable(ctx, id);

export async function listQuestions(ctx: ServiceCtx, { surveyId }: { surveyId: string }): Promise<SurveyQuestion[]> {
  await requireReadable(ctx, surveyId);
  return (await ctx.store.listQuestions(surveyId)).sort((a, b) => a.order - b.order);
}

export async function createDraft(ctx: ServiceCtx, { draft }: { draft: SurveyDraft }): Promise<Survey> {
  if (!canCreateSurvey(ctx.actor.user)) throw new SurveyError('FORBIDDEN', '사용 중인 계정만 설문을 만들 수 있습니다.');
  assertCategory(draft.categoryCode);
  const stamp = ctx.now().toISOString();
  return insertSurvey(ctx, (id) => ({
    ...draft, id, ownerUserId: ctx.actor.user.id, status: 'DRAFT',
    audienceDeptIds: [...draft.audienceDeptIds], audienceUserIds: [...draft.audienceUserIds],
    questionCount: 0, responseCount: 0, publishedAt: null, firstRespondedAt: null, closedAt: null,
    version: 1, createdAt: stamp, updatedAt: stamp,
  }));
}

/** 상태·응답 여부별 수정 범위를 지켜 기본정보를 갱신한다(기존 repo 의 applyDraft 그대로). */
function applyDraft(row: Survey, draft: SurveyDraft, now: Date): Survey {
  const scope = surveyEditScope(row, now);
  const deny = () => { throw new SurveyError('LOCKED', '현재 상태에서는 수정할 수 없는 항목입니다.'); };
  const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);
  if (row.title !== draft.title && !scope.title) deny();
  if (row.description !== draft.description && !scope.description) deny();
  if (row.categoryCode !== draft.categoryCode && !scope.category) deny();
  if (row.anonymous !== draft.anonymous && !scope.anonymous) deny();
  if (row.showResultToRespondent !== draft.showResultToRespondent && !scope.showResult) deny();
  if (row.startsAt !== draft.startsAt && !scope.startsAt) deny();
  const audienceChanged = row.audienceType !== draft.audienceType
    || !sameList(row.audienceDeptIds, draft.audienceDeptIds) || !sameList(row.audienceUserIds, draft.audienceUserIds);
  if (audienceChanged && !scope.audience) deny();
  if (row.endsAt !== draft.endsAt) {
    if (draft.endsAt === null) { if (!scope.endsAt || scope.extendEndsAtOnly) deny(); }
    else assertEndsAtChange(row, draft.endsAt, now);
  }
  assertCategory(draft.categoryCode);
  return { ...row, ...draft, audienceDeptIds: [...draft.audienceDeptIds], audienceUserIds: [...draft.audienceUserIds], version: row.version + 1, updatedAt: now.toISOString() };
}

async function saveSurvey(ctx: ServiceCtx, row: Survey): Promise<Survey> {
  const valid = surveySchema.parse(row);
  await ctx.store.save('surveys', valid);
  return valid;
}

export async function updateBasics(ctx: ServiceCtx, { id, draft }: { id: string; draft: SurveyDraft }) {
  const row = await requireManageable(ctx, id);
  return saveSurvey(ctx, applyDraft(row, draft, ctx.now()));
}

export async function replaceQuestions(ctx: ServiceCtx, { surveyId, drafts }: { surveyId: string; drafts: SurveyQuestionDraft[] }) {
  const survey = await requireManageable(ctx, surveyId);
  assertQuestionsEditable(survey, ctx.now());
  const ordered = normalizeQuestionOrders(drafts);
  const current = await ctx.store.listQuestions(surveyId);
  const existing = new Map(current.map((row) => [row.id, row]));
  const stamp = ctx.now().toISOString();
  const kept: SurveyQuestion[] = [];
  const fresh: Omit<SurveyQuestion, 'id'>[] = [];
  const seen = new Set<string>();
  for (const draft of ordered) {
    const prev = draft.id ? existing.get(draft.id) : undefined;
    if (draft.id && !prev) throw new SurveyError('INVALID_INPUT', '이 설문에 없는 질문을 수정할 수 없습니다.');
    const { id: _ignored, ...body } = draft;
    const row = { ...body, surveyId, options: draft.options.map((o) => ({ ...o })), createdAt: prev?.createdAt ?? stamp, updatedAt: stamp };
    if (prev) {
      if (seen.has(prev.id)) throw new SurveyError('INVALID_INPUT', '같은 질문이 두 번 담겼습니다.');
      seen.add(prev.id);
      kept.push(surveyQuestionSchema.parse({ ...row, id: prev.id }));
    } else fresh.push(row);
  }
  assertQuestionSet([...kept, ...fresh.map((_, i) => ({ id: `new-${i}` }))]);
  for (const q of kept) await ctx.store.save('surveyQuestions', q);
  const created = await insertQuestions(ctx, fresh);
  const next = [...kept, ...created].sort((a, b) => a.order - b.order);
  for (const row of current) if (!next.some((q) => q.id === row.id)) await ctx.store.remove('surveyQuestions', row.id);
  await saveSurvey(ctx, { ...survey, questionCount: next.length, version: survey.version + 1, updatedAt: stamp });
  return next;
}

export async function publish(ctx: ServiceCtx, { id }: { id: string }) {
  const row = await requireManageable(ctx, id);
  const now = ctx.now();
  assertPublishable(row, await ctx.store.listQuestions(id), now);
  const status = publishedStatus(row.startsAt as string, now);
  assertSurveyTransition(row.status, status);
  return saveSurvey(ctx, { ...row, status, publishedAt: now.toISOString(), version: row.version + 1, updatedAt: now.toISOString() });
}

export async function close(ctx: ServiceCtx, { id }: { id: string }) {
  const row = await requireManageable(ctx, id);
  assertSurveyTransition(deriveSurveyStatus(row, ctx.now()), 'CLOSED');
  const stamp = ctx.now().toISOString();
  return saveSurvey(ctx, { ...row, status: 'CLOSED', closedAt: stamp, version: row.version + 1, updatedAt: stamp });
}

export async function archive(ctx: ServiceCtx, { id }: { id: string }) {
  const row = await requireManageable(ctx, id);
  assertSurveyTransition(deriveSurveyStatus(row, ctx.now()), 'ARCHIVED');
  const stamp = ctx.now().toISOString();
  return saveSurvey(ctx, { ...row, status: 'ARCHIVED', version: row.version + 1, updatedAt: stamp });
}

export async function duplicate(ctx: ServiceCtx, { id }: { id: string }) {
  if (!canCreateSurvey(ctx.actor.user)) throw new SurveyError('FORBIDDEN', '사용 중인 계정만 설문을 만들 수 있습니다.');
  const source = await requireReadable(ctx, id);
  const questions = await ctx.store.listQuestions(id);
  const stamp = ctx.now().toISOString();
  const copy = await insertSurvey(ctx, (newId) => ({
    ...source, id: newId, title: `${source.title} 복사본`.slice(0, 100), ownerUserId: ctx.actor.user.id, status: 'DRAFT',
    audienceDeptIds: [...source.audienceDeptIds], audienceUserIds: [...source.audienceUserIds],
    startsAt: null, endsAt: null, questionCount: questions.length, responseCount: 0,
    publishedAt: null, firstRespondedAt: null, closedAt: null, version: 1, createdAt: stamp, updatedAt: stamp,
  }));
  await insertQuestions(ctx, questions.map(({ id: _id, ...q }) => ({ ...q, surveyId: copy.id, options: q.options.map((o) => ({ ...o })), createdAt: stamp, updatedAt: stamp })));
  return copy;
}

export async function remove(ctx: ServiceCtx, { id }: { id: string }): Promise<null> {
  const row = await requireManageable(ctx, id);
  if (row.status !== 'DRAFT') throw new SurveyError('INVALID_STATUS', '배포된 설문은 삭제할 수 없습니다. 마감 후 보관하세요.');
  // 질문을 먼저 지운다. 설문만 지우고 실패하면 주인 없는 질문 문서가 남는다.
  for (const q of await ctx.store.listQuestions(id)) await ctx.store.remove('surveyQuestions', q.id);
  await ctx.store.remove('surveys', id);
  return null;
}
```

`src/domain/survey/engine.ts`의 `canManageSurvey(actor, row, isAdmin = false)` 시그니처는 이미 `isAdmin`을 받으므로 바꾸지 않는다. `assertQuestionsEditable(row, now)`가 두 번째 인자를 받는지 확인하고, 받지 않으면 `assertQuestionsEditable(survey)`로 호출한다.

- [ ] **Step 5: 통과 확인** — Run: `npx tsx --test server/survey/manage.test.ts` / Expected: PASS (9). Run: `npx tsc --noEmit -p tsconfig.server.json` / Expected: 오류 없음.

- [ ] **Step 6: 커밋**

```bash
git add server/survey/manage.ts server/survey/manage.test.ts server/survey/testkit.ts
git commit -m "feat(survey): 서버 설문 관리 서비스 — 관리자 권한 연결, 서버 채번"
```

---

### Task 4: 응답·결과 서비스 (제출·참여 현황·응답자 목록·결과)

**Files:**
- Create: `server/survey/respond.ts`
- Create: `server/survey/respond.test.ts`
- Modify: `src/domain/survey/aggregate.ts` (아래 `SurveyResultView` 타입을 파일 끝에 추가 — 앱과 서버가 함께 쓴다)

**Interfaces:**
- Consumes: Task 2·3 (`requireSurvey`, `ServiceCtx`), Task 1 (`kstDayStamp`, `shuffle`)
- Produces:

```ts
// src/domain/survey/aggregate.ts 에 추가
export interface SurveyResultView {
  summary: SurveyResultSummary;
  /** responseId → 표시 이름. 기명 설문을 작성자·관리자가 볼 때만 채운다. 익명이면 빈 객체. */
  respondents: Record<string, string>;
}
// server/survey/respond.ts
export interface SurveySubmission { surveyId: string; surveyVersion: number; answers: SurveyAnswerInput[] }
export function submit(ctx, submission: SurveySubmission): Promise<{ submitted: true }>;
export function myParticipations(ctx, _: {}): Promise<string[]>;
export function listForRespondent(ctx, _: {}): Promise<Survey[]>;
export function readResult(ctx, { surveyId }): Promise<SurveyResultView>;
```

- [ ] **Step 1: 실패 테스트** — `server/survey/respond.test.ts`

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { SurveyError } from '@/domain/survey/engine';
import { createDraft, publish, replaceQuestions, getSurvey } from './manage';
import { listForRespondent, myParticipations, readResult, submit } from './respond';
import { actorOf, DRAFT, makeCtx, RATING_Q, TEXT_Q, user } from './testkit';

const owner = user('U1');
const a = user('U2');
const b = user('U3');

async function setup(draft = DRAFT) {
  const ctx = makeCtx(actorOf(owner), undefined, [owner, a, b]);
  const s = await createDraft(ctx, { draft });
  const qs = await replaceQuestions(ctx, { surveyId: s.id, drafts: [RATING_Q, TEXT_Q] });
  const published = await publish(ctx, { id: s.id });
  const as = (u: typeof owner, admin = false) => ({ ...ctx, actor: actorOf(u, admin) });
  const answer = (text: string) => ({
    surveyId: s.id, surveyVersion: published.version,
    answers: [{ questionId: qs[0].id, selectedOptionIds: [], textValue: null, ratingValue: 4 },
      { questionId: qs[1].id, selectedOptionIds: [], textValue: text, ratingValue: null }],
  });
  return { ctx, id: s.id, as, answer, qs };
}

test('익명 제출 — 참여 기록에 시각이 없고, 응답은 날짜만·무작위 ID·응답자 없음', async () => {
  const { ctx, as, answer } = await setup();
  await submit(as(a), answer('좋아요'));
  const [p] = ctx.store.dump('surveyParticipations') as Record<string, unknown>[];
  assert.equal('respondedAt' in p, false);
  const [r] = ctx.store.dump('surveyResponses') as Record<string, unknown>[];
  assert.equal(r.submittedAt, '2026-10-13T15:00:00.000Z');
  assert.equal(r.respondentUserId, null);
  assert.doesNotMatch(String(r.id), /^RESP-/);
});

test('익명 설문의 firstRespondedAt 도 날짜만 남는다', async () => {
  const { ctx, id, as, answer } = await setup();
  await submit(as(a), answer('x'));
  assert.equal((await getSurvey(ctx, { id })).firstRespondedAt, '2026-10-13T15:00:00.000Z');
});

test('같은 사람이 동시에 두 번 제출해도 1건만 남는다', async () => {
  const { ctx, as, answer } = await setup();
  const results = await Promise.allSettled([submit(as(a), answer('1')), submit(as(a), answer('2'))]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
  assert.equal((rejected.reason as SurveyError).code, 'ALREADY_RESPONDED');
  assert.equal(ctx.store.dump('surveyResponses').length, 1);
});

test('답변 저장이 실패하면 참여 기록·응답을 되돌려 다시 낼 수 있다', async () => {
  const { ctx, as, answer } = await setup();
  ctx.store.failNextInsert = 'surveyAnswers';
  await assert.rejects(submit(as(a), answer('x')));
  assert.equal(ctx.store.dump('surveyParticipations').length, 0);
  assert.equal(ctx.store.dump('surveyResponses').length, 0);
  await submit(as(a), answer('x'));
  assert.equal(ctx.store.dump('surveyResponses').length, 1);
});

test('responseCount 는 실제 응답 수다', async () => {
  const { ctx, id, as, answer } = await setup();
  await submit(as(a), answer('1'));
  await submit(as(b), answer('2'));
  assert.equal((await getSurvey(ctx, { id })).responseCount, 2);
});

test('질문이 바뀐 뒤의 옛 버전 제출은 VERSION_CHANGED', async () => {
  const { as, answer, id, qs } = await setup();
  const stale = answer('x');
  // 응답이 없으니 질문 수정 가능(진행 중·무응답)
  await replaceQuestions(as(owner), { surveyId: id, drafts: [{ ...RATING_Q, id: qs[0].id }] });
  await assert.rejects(submit(as(a), stale), (e: unknown) => e instanceof SurveyError && e.code === 'VERSION_CHANGED');
});

test('익명 결과 — 주관식에 응답 ID·응답자가 없고 시각은 날짜뿐', async () => {
  const { as, answer, id } = await setup();
  await submit(as(a), answer('하나'));
  await submit(as(b), answer('둘'));
  const view = await readResult(as(owner), { surveyId: id });
  const text = view.summary.questions.find((q) => q.kind === 'TEXT');
  assert.ok(text && text.kind === 'TEXT');
  assert.deepEqual(text.entries.map((e) => e.responseId), ['', '']);
  assert.ok(text.entries.every((e) => e.submittedAt === '2026-10-13T15:00:00.000Z'));
  assert.deepEqual(view.respondents, {});
  assert.equal(view.summary.audienceCount, 3);
});

test('기명 결과 — 작성자에게 응답자 이름을 준다', async () => {
  const { as, answer, id } = await setup({ ...DRAFT, anonymous: false });
  await submit(as(a), answer('하나'));
  const view = await readResult(as(owner), { surveyId: id });
  assert.deepEqual(Object.values(view.respondents), ['사용자U2 · 개발팀']);
});

test('결과 비공개 설문의 참여자는 결과를 볼 수 없다', async () => {
  const { as, answer, id } = await setup();
  await submit(as(a), answer('x'));
  await assert.rejects(readResult(as(a), { surveyId: id }), (e: unknown) => e instanceof SurveyError && e.code === 'FORBIDDEN');
});

test('결과 공개 설문의 참여자에게는 응답자 정보를 주지 않는다', async () => {
  const { as, answer, id } = await setup({ ...DRAFT, anonymous: false, showResultToRespondent: true });
  await submit(as(a), answer('x'));
  const view = await readResult(as(a), { surveyId: id });
  assert.deepEqual(view.respondents, {});
});

test('참여 현황과 응답자 목록', async () => {
  const { as, answer, id } = await setup();
  await submit(as(a), answer('x'));
  assert.deepEqual(await myParticipations(as(a), {}), [id]);
  assert.deepEqual((await listForRespondent(as(b), {})).map((s) => s.id), [id]);
});
```

- [ ] **Step 2: 실패 확인** — Run: `npx tsx --test server/survey/respond.test.ts` / Expected: FAIL (모듈 없음)

- [ ] **Step 3: 구현** — `server/survey/respond.ts`

```ts
import { aggregateSurveyResult, type SurveyResultView } from '@/domain/survey/aggregate';
import { kstDayStamp, shuffle } from '@/domain/survey/anonymity';
import {
  assertRespondable, assertSurveyVersion, canManageSurvey, canViewResultAsRespondent, countSurveyAudience,
  isSurveyAudience, SurveyError, validateSurveyAnswers,
} from '@/domain/survey/engine';
import { surveySchema, type Survey } from '@/domain/survey/schema';
import { surveyAnswerSchema, type SurveyAnswerInput } from '@/domain/surveyAnswer/schema';
import { surveyParticipationId, surveyParticipationSchema } from '@/domain/surveyParticipation/schema';
import { assertAnonymousResponse, surveyResponseSchema } from '@/domain/surveyResponse/schema';
import { resolveDeptId } from '@/domain/department/engine';
import { requireSurvey } from './manage';
import type { ServiceCtx } from './port';

export interface SurveySubmission { surveyId: string; surveyVersion: number; answers: SurveyAnswerInput[] }

export async function submit(ctx: ServiceCtx, submission: SurveySubmission): Promise<{ submitted: true }> {
  const { user, deptId } = ctx.actor;
  const survey = await requireSurvey(ctx, submission.surveyId);
  const already = await ctx.store.hasParticipation(survey.id, user.id);
  assertRespondable(survey, user, deptId, already, ctx.now());
  assertSurveyVersion(survey, submission.surveyVersion);
  const answers = validateSurveyAnswers(await ctx.store.listQuestions(survey.id), submission.answers);

  const now = ctx.now();
  const stamp = survey.anonymous ? kstDayStamp(now) : now.toISOString();

  // 1) 참여 기록을 새로 만드는 데 성공한 요청만 진행한다 — 동시 제출 중 하나만 통과.
  const participation = surveyParticipationSchema.parse({
    id: surveyParticipationId(survey.id, user.id), surveyId: survey.id, userId: user.id, responded: true,
  });
  if ((await ctx.store.insert('surveyParticipations', participation)) === 'exists') {
    throw new SurveyError('ALREADY_RESPONDED', '이미 참여한 설문입니다.');
  }

  const response = surveyResponseSchema.parse({
    id: ctx.newId(), surveyId: survey.id,
    respondentUserId: survey.anonymous ? null : user.id,
    respondentDeptId: survey.anonymous ? null : deptId,
    surveyVersion: survey.version, submittedAt: stamp,
  });
  if (survey.anonymous) assertAnonymousResponse(response);
  const rows = answers.map((answer) => surveyAnswerSchema.parse({
    id: ctx.newId(), surveyId: survey.id, responseId: response.id, questionId: answer.questionId,
    selectedOptionIds: answer.selectedOptionIds, textValue: answer.textValue, ratingValue: answer.ratingValue,
    createdAt: stamp,
  }));

  // 2) 응답·답변. 실패하면 쓴 것을 지우고 참여 기록도 되돌린다(보상).
  const written: { coll: 'surveyResponses' | 'surveyAnswers'; id: string }[] = [];
  try {
    await ctx.store.insert('surveyResponses', response);
    written.push({ coll: 'surveyResponses', id: response.id });
    for (const row of rows) {
      await ctx.store.insert('surveyAnswers', row);
      written.push({ coll: 'surveyAnswers', id: row.id });
    }
  } catch (error) {
    for (const item of written.reverse()) await ctx.store.remove(item.coll, item.id).catch(() => undefined);
    await ctx.store.remove('surveyParticipations', participation.id).catch(() => undefined);
    throw error;
  }

  // 3) 응답 수는 더하지 않고 센다. 첫 응답 시각은 익명이면 날짜만.
  const latest = await requireSurvey(ctx, survey.id);
  await ctx.store.save('surveys', surveySchema.parse({
    ...latest,
    responseCount: await ctx.store.countResponses(survey.id),
    firstRespondedAt: latest.firstRespondedAt ?? stamp,
    updatedAt: now.toISOString(),
  }));
  return { submitted: true };
}

export const myParticipations = (ctx: ServiceCtx, _: Record<string, never>) =>
  ctx.store.listParticipatedSurveyIds(ctx.actor.user.id);

export async function listForRespondent(ctx: ServiceCtx, _: Record<string, never>): Promise<Survey[]> {
  const participated = new Set(await ctx.store.listParticipatedSurveyIds(ctx.actor.user.id));
  const rows = await Promise.all((await ctx.store.listSurveys()).map((row) => requireSurvey(ctx, row.id)));
  return rows
    .filter((row) => row.status !== 'DRAFT' && isSurveyAudience(row, ctx.actor.user, ctx.actor.deptId))
    .filter((row) => row.status === 'ACTIVE' || participated.has(row.id))
    .sort((x, y) => (x.endsAt ?? '').localeCompare(y.endsAt ?? ''));
}

export async function readResult(ctx: ServiceCtx, { surveyId }: { surveyId: string }): Promise<SurveyResultView> {
  const survey = await requireSurvey(ctx, surveyId);
  const manager = canManageSurvey(ctx.actor.user, survey, ctx.actor.isAdmin);
  const participated = await ctx.store.hasParticipation(surveyId, ctx.actor.user.id);
  if (!manager && !canViewResultAsRespondent(survey, participated)) {
    throw new SurveyError('FORBIDDEN', '이 설문의 결과를 볼 권한이 없습니다.');
  }
  const [questions, responses, answers, users, departments] = await Promise.all([
    ctx.store.listQuestions(surveyId), ctx.store.listResponses(surveyId), ctx.store.listAnswers(surveyId),
    ctx.directory.listUsers(), ctx.directory.listDepartments(),
  ]);
  const audienceCount = countSurveyAudience(survey, users, (u) => resolveDeptId(departments, u.dept));
  const summary = aggregateSurveyResult(questions, responses, answers, audienceCount);

  if (survey.anonymous) {
    // 응답 ID·순서를 지워 주관식 답변끼리, 그리고 다른 질문의 답과 잇지 못하게 한다.
    summary.questions = summary.questions.map((q) => q.kind !== 'TEXT' ? q : {
      ...q, entries: shuffle(q.entries.map((e) => ({ ...e, responseId: '' })), ctx.random),
    });
    return { summary, respondents: {} };
  }
  if (!manager) return { summary, respondents: {} };

  const respondents: Record<string, string> = {};
  for (const r of responses) {
    const name = users.find((u) => u.id === r.respondentUserId)?.name ?? '알 수 없음';
    const dept = departments.find((d) => d.id === r.respondentDeptId)?.name;
    respondents[r.id] = dept ? `${name} · ${dept}` : name;
  }
  return { summary, respondents };
}
```

- [ ] **Step 4: 통과 확인** — Run: `npx tsx --test server/survey/*.test.ts src/domain/survey/*.test.ts` / Expected: PASS (전부). Run: `npx tsc --noEmit -p tsconfig.server.json` / Expected: 오류 없음.

- [ ] **Step 5: 커밋**

```bash
git add server/survey/respond.ts server/survey/respond.test.ts src/domain/survey/aggregate.ts
git commit -m "feat(survey): 서버 제출·결과 — 익명 역추적 차단, 1인 1회 원자성, 실패 시 보상"
```

---

### Task 5: 신원 확인과 요청 분기

**Files:**
- Create: `server/survey/token.ts`
- Create: `server/survey/dispatch.ts`
- Create: `server/survey/dispatch.test.ts`

**Interfaces:**
- Consumes: Task 3·4 서비스 함수, `resolveUserRoles` from `@/domain/roleGroup/roleResolver`
- Produces:

```ts
export function verifyToken(token: string, secret: string, nowSec?: number): string; // 실패 ''
export interface DispatchDeps { store: SurveyStorePort; directory: DirectoryPort; secret: string; now?: () => Date; newId: () => string }
export function dispatch(body: unknown, deps: DispatchDeps): Promise<{ status: number; body: { data: unknown } | { error: { code: string; message: string } } }>;
```

- [ ] **Step 1: 실패 테스트** — `server/survey/dispatch.test.ts`

```ts
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { createMemoryStore } from './memoryStore';
import { dispatch } from './dispatch';
import { directory, user } from './testkit';

const SECRET = 'test-secret';
const mint = (uid: string, ttl = 3600) => {
  const p = Buffer.from(JSON.stringify({ uid, exp: Math.floor(Date.now() / 1000) + ttl })).toString('base64url');
  return `${p}.${crypto.createHmac('sha256', SECRET).update(p).digest('hex')}`;
};
const deps = (users = [user('U1'), user('U9', '개발팀', '잠금')]) => ({
  store: createMemoryStore(), directory: directory(users), secret: SECRET, newId: () => crypto.randomUUID(),
});

test('토큰이 없거나 위조·만료면 401', async () => {
  assert.equal((await dispatch({ action: 'listMine', payload: {} }, deps())).status, 401);
  const forged = mint('U1').replace(/.$/, (c) => (c === 'a' ? 'b' : 'a'));
  assert.equal((await dispatch({ token: forged, action: 'listMine', payload: {} }, deps())).status, 401);
  assert.equal((await dispatch({ token: mint('U1', -10), action: 'listMine', payload: {} }, deps())).status, 401);
});

test('잠금 계정은 403', async () => {
  assert.equal((await dispatch({ token: mint('U9'), action: 'listMine', payload: {} }, deps())).status, 403);
});

test('알 수 없는 action 은 400', async () => {
  const res = await dispatch({ token: mint('U1'), action: 'nope', payload: {} }, deps());
  assert.equal(res.status, 400);
});

test('정상 요청은 { data } — 본문의 userId 는 무시한다', async () => {
  const d = deps();
  const created = await dispatch({ token: mint('U1'), action: 'createDraft', payload: { draft: {
    title: 't', description: '', categoryCode: 'EMPLOYEE', audienceType: 'COMPANY', audienceDeptIds: [], audienceUserIds: [],
    anonymous: true, startsAt: null, endsAt: null, showResultToRespondent: false,
  }, userId: 'U9' } }, d);
  assert.equal(created.status, 200);
  assert.equal((created.body as { data: { ownerUserId: string } }).data.ownerUserId, 'U1');
});

test('SurveyError 는 200 이 아닌 400 + 코드로', async () => {
  const res = await dispatch({ token: mint('U1'), action: 'getSurvey', payload: { id: 'SUR-없음' } }, deps());
  assert.equal(res.status, 400);
  assert.equal((res.body as { error: { code: string } }).error.code, 'INVALID_INPUT');
});
```

- [ ] **Step 2: 실패 확인** — Run: `npx tsx --test server/survey/dispatch.test.ts` / Expected: FAIL

- [ ] **Step 3: 구현**

`server/survey/token.ts` — `appwrite/functions/mail/src/token.js`의 `verifyToken`을 TS로 옮긴다(형식 `base64url({uid,exp}).hex(hmac)`, `timingSafeEqual`, 만료 시 `''`):

```ts
import crypto from 'node:crypto';

/** widdy-login 서명 토큰 → uid. 위조·만료·형식 오류는 ''. (mail/src/token.js 와 같은 규칙) */
export function verifyToken(token: string, secret: string, nowSec = Math.floor(Date.now() / 1000)): string {
  if (!token || !secret) return '';
  const dot = token.lastIndexOf('.');
  if (dot < 0) return '';
  const payloadPart = token.slice(0, dot);
  const a = Buffer.from(token.slice(dot + 1));
  const b = Buffer.from(crypto.createHmac('sha256', secret).update(payloadPart).digest('hex'));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return '';
  try {
    const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf-8')) as { uid?: string; exp?: number };
    if (payload.exp && nowSec > payload.exp) return '';
    return String(payload.uid || '');
  } catch {
    return '';
  }
}
```

`server/survey/dispatch.ts`:

```ts
import { resolveDeptId } from '@/domain/department/engine';
import { resolveUserRoles } from '@/domain/roleGroup/roleResolver';
import { SurveyError } from '@/domain/survey/engine';
import * as manage from './manage';
import * as respond from './respond';
import type { DirectoryPort, ServiceCtx, SurveyStorePort } from './port';
import { verifyToken } from './token';

export interface DispatchDeps { store: SurveyStorePort; directory: DirectoryPort; secret: string; now?: () => Date; newId: () => string }
type Result = { status: number; body: { data: unknown } | { error: { code: string; message: string } } };

const ACTIONS: Record<string, (ctx: ServiceCtx, payload: never) => Promise<unknown>> = {
  listMine: manage.listMine, getSurvey: manage.getSurvey, listQuestions: manage.listQuestions,
  createDraft: manage.createDraft, updateBasics: manage.updateBasics, replaceQuestions: manage.replaceQuestions,
  publish: manage.publish, close: manage.close, archive: manage.archive, duplicate: manage.duplicate, remove: manage.remove,
  submit: respond.submit, myParticipations: respond.myParticipations, listForRespondent: respond.listForRespondent,
  readResult: respond.readResult,
};

const fail = (status: number, code: string, message: string): Result => ({ status, body: { error: { code, message } } });

export async function dispatch(raw: unknown, deps: DispatchDeps): Promise<Result> {
  const body = (raw ?? {}) as { token?: string; action?: string; payload?: unknown };
  const uid = verifyToken(String(body.token ?? ''), deps.secret);
  if (!uid) return fail(401, 'UNAUTHENTICATED', '로그인 정보가 만료되었습니다. 다시 로그인해 주세요.');

  const handler = body.action ? ACTIONS[body.action] : undefined;
  if (!handler) return fail(400, 'INVALID_INPUT', '알 수 없는 요청입니다.');

  const [users, departments, roleGroups, positions] = await Promise.all([
    deps.directory.listUsers(), deps.directory.listDepartments(), deps.directory.listRoleGroups(), deps.directory.listPositions(),
  ]);
  const user = users.find((u) => u.id === uid);
  if (!user || user.status !== '사용') return fail(403, 'FORBIDDEN', '사용할 수 없는 계정입니다.');
  const isAdmin = resolveUserRoles(user, roleGroups, { depts: departments, positions })
    .some((g) => g.code.replace(/^ROLE_/, '').toUpperCase() === 'ADMIN');

  const ctx: ServiceCtx = {
    store: deps.store, directory: deps.directory, now: deps.now ?? (() => new Date()), newId: deps.newId,
    actor: { user, deptId: resolveDeptId(departments, user.dept), isAdmin },
  };
  try {
    return { status: 200, body: { data: await handler(ctx, (body.payload ?? {}) as never) } };
  } catch (error) {
    if (error instanceof SurveyError) return fail(400, error.code, error.message);
    if (error instanceof Error && error.name === 'ZodError') return fail(400, 'INVALID_INPUT', '입력값이 올바르지 않습니다.');
    throw error;
  }
}
```

- [ ] **Step 4: 통과 확인** — Run: `npx tsx --test server/survey/*.test.ts` / Expected: PASS. Run: `npx tsc --noEmit -p tsconfig.server.json`.

- [ ] **Step 5: 커밋**

```bash
git add server/survey/token.ts server/survey/dispatch.ts server/survey/dispatch.test.ts
git commit -m "feat(survey): 서명 토큰 신원 확인과 요청 분기, 최고관리자 판정"
```

---

### Task 6: Appwrite 어댑터·Function 진입점·배포 스크립트 (개발 배포까지)

**Files:**
- Create: `appwrite/functions/survey/src/appwriteStore.ts`
- Create: `appwrite/functions/survey/src/main.ts`
- Create: `appwrite/functions/survey/appwrite.json`, `appwrite/functions/survey/package.json`, `appwrite/functions/survey/README.md`
- Create: `scripts/deploy-survey.mjs`
- Modify: `tsconfig.server.json` (`include`에 `"appwrite/functions/survey/src"` 추가)
- Modify: `.gitignore` (`appwrite/functions/survey/dist/`)

**Interfaces:**
- Consumes: Task 2 포트, Task 5 `dispatch`
- Produces: Function `survey` (dev 프로젝트), 요청 `POST {token, action, payload}`

- [ ] **Step 1: 어댑터** — `appwrite/functions/survey/src/appwriteStore.ts`

```ts
import { Client, Databases, Query } from 'node-appwrite';
import { surveySchema } from '@/domain/survey/schema';
import { surveyQuestionSchema } from '@/domain/surveyQuestion/schema';
import { surveyResponseSchema } from '@/domain/surveyResponse/schema';
import { surveyAnswerSchema } from '@/domain/surveyAnswer/schema';
import { surveyParticipationSchema } from '@/domain/surveyParticipation/schema';
import { userSchema } from '@/domain/user/schema';
import { departmentSchema } from '@/domain/department/schema';
import { roleGroupSchema } from '@/domain/roleGroup/schema';
import { positionSchema } from '@/domain/position/schema';
import type { Coll, DirectoryPort, SurveyStorePort } from '../../../../server/survey/port';

const JSON_FIELDS: Partial<Record<string, string[]>> = { surveyQuestions: ['options'], roleGroups: ['members', 'menuPermissions'] };
const SYSTEM = ['$id', '$createdAt', '$updatedAt', '$permissions', '$databaseId', '$collectionId', '$sequence'];

export function createAppwritePorts(endpoint: string, project: string, key: string, db: string) {
  const dbs = new Databases(new Client().setEndpoint(endpoint).setProject(project).setKey(key));

  const decode = (coll: string, doc: Record<string, unknown>) => {
    const row: Record<string, unknown> = { ...doc };
    if (!row.id) row.id = row.$id;
    for (const k of SYSTEM) delete row[k];
    for (const f of JSON_FIELDS[coll] ?? []) row[f] = typeof row[f] === 'string' && row[f] ? JSON.parse(row[f] as string) : (row[f] ?? []);
    return row;
  };
  const encode = (coll: string, item: Record<string, unknown>) => {
    const row = { ...item };
    for (const f of JSON_FIELDS[coll] ?? []) row[f] = row[f] == null ? null : JSON.stringify(row[f]);
    return row;
  };

  /** 커서 페이지네이션 전건 조회. 불량 문서는 건너뛴다(목록 전체가 죽지 않게). */
  async function listAll<T>(coll: string, schema: { safeParse(v: unknown): { success: boolean; data?: T } }, queries: string[] = []): Promise<T[]> {
    const out: T[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await dbs.listDocuments({ databaseId: db, collectionId: coll,
        queries: [...queries, Query.limit(100), ...(cursor ? [Query.cursorAfter(cursor)] : [])] });
      for (const doc of page.documents as unknown as Record<string, unknown>[]) {
        const parsed = schema.safeParse(decode(coll, doc));
        if (parsed.success && parsed.data !== undefined) out.push(parsed.data);
      }
      if (page.documents.length < 100) return out;
      cursor = page.documents[page.documents.length - 1].$id;
    }
  }
  const bySurvey = (surveyId: string) => [Query.equal('surveyId', surveyId)];
  const isCode = (e: unknown, c: number) => (e as { code?: number })?.code === c;

  const store: SurveyStorePort = {
    async getSurvey(id) {
      try { return surveySchema.parse(decode('surveys', await dbs.getDocument({ databaseId: db, collectionId: 'surveys', documentId: id }) as never)); }
      catch (e) { if (isCode(e, 404)) return null; throw e; }
    },
    listSurveys: (f) => listAll('surveys', surveySchema, f?.ownerUserId ? [Query.equal('ownerUserId', f.ownerUserId)] : []),
    listQuestions: (s) => listAll('surveyQuestions', surveyQuestionSchema, bySurvey(s)),
    listResponses: (s) => listAll('surveyResponses', surveyResponseSchema, bySurvey(s)),
    listAnswers: (s) => listAll('surveyAnswers', surveyAnswerSchema, bySurvey(s)),
    async countResponses(s) {
      const page = await dbs.listDocuments({ databaseId: db, collectionId: 'surveyResponses', queries: [...bySurvey(s), Query.limit(1)] });
      return page.total;
    },
    async hasParticipation(surveyId, userId) {
      try { await dbs.getDocument({ databaseId: db, collectionId: 'surveyParticipations', documentId: `${surveyId}__${userId}` }); return true; }
      catch (e) { if (isCode(e, 404)) return false; throw e; }
    },
    async listParticipatedSurveyIds(userId) {
      return (await listAll('surveyParticipations', surveyParticipationSchema, [Query.equal('userId', userId)])).map((p) => p.surveyId);
    },
    async insert(coll: Coll, row) {
      try { await dbs.createDocument({ databaseId: db, collectionId: coll, documentId: row.id, data: encode(coll, row as never) }); return 'created'; }
      catch (e) { if (isCode(e, 409)) return 'exists'; throw e; }
    },
    async save(coll: Coll, row) {
      try { await dbs.updateDocument({ databaseId: db, collectionId: coll, documentId: row.id, data: encode(coll, row as never) }); }
      catch (e) { if (!isCode(e, 404)) throw e; await dbs.createDocument({ databaseId: db, collectionId: coll, documentId: row.id, data: encode(coll, row as never) }); }
    },
    async remove(coll: Coll, id) {
      try { await dbs.deleteDocument({ databaseId: db, collectionId: coll, documentId: id }); }
      catch (e) { if (!isCode(e, 404)) throw e; }
    },
  };
  const directory: DirectoryPort = {
    listUsers: () => listAll('users', userSchema),
    listDepartments: () => listAll('departments', departmentSchema),
    listRoleGroups: () => listAll('roleGroups', roleGroupSchema),
    listPositions: () => listAll('positions', positionSchema),
  };
  return { store, directory };
}
```

참여 기록 ID `설문ID__사용자ID`가 Appwrite 문서 ID 규칙(36자, 영숫자·`._-`)을 넘을 수 있다. `SUR-20261014-0001__U012`는 23자라 통과하지만, 앱의 `safeDocId`(`src/shared/lib/appwrite.ts`)가 긴 키를 해시로 접는 규칙을 쓰는 경우와 맞춰야 한다 → **Step 1 끝에 `safeDocId` 구현을 읽고**, 36자 초과·허용 외 문자일 때 같은 방식으로 접도록 `insert`/`getDocument`의 `documentId`를 `safeDocId(row.id)`로 감싼다(`src/shared/lib/appwrite.ts`가 브라우저 SDK를 import하면 그 함수만 `server/survey/docId.ts`로 복사하지 말고 `src/shared/lib/docId.ts`로 분리해 양쪽에서 import한다).

- [ ] **Step 2: 진입점** — `appwrite/functions/survey/src/main.ts`

```ts
/**
 * Appwrite Function — survey: 전자설문 쓰기·제출·결과.
 *   요청: POST { token, action, payload }  응답: { data } | { error: { code, message } }
 * env: AUTH_TOKEN_SECRET(★widdy-login 과 같은 값), APPWRITE_DATABASE_ID(기본 workfit), APPWRITE_ENDPOINT(https)
 * 규칙의 정본은 server/survey/** 와 src/domain/survey/** — esbuild 로 함께 묶여 배포된다.
 */
import crypto from 'node:crypto';
import { dispatch } from '../../../../server/survey/dispatch';
import { createAppwritePorts } from './appwriteStore';

export default async ({ req, res, error }: {
  req: { bodyJson?: unknown; headers: Record<string, string> };
  res: { json(body: unknown, status?: number): unknown };
  error(msg: string): void;
}) => {
  const secret = process.env.AUTH_TOKEN_SECRET || process.env.WIDDY_TOKEN_SECRET || '';
  if (!secret) return res.json({ error: { code: 'INVALID_INPUT', message: 'server not configured' } }, 500);
  const endpoint = process.env.APPWRITE_ENDPOINT || process.env.APPWRITE_FUNCTION_API_ENDPOINT || '';
  const project = process.env.APPWRITE_FUNCTION_PROJECT_ID || '';
  const ports = createAppwritePorts(endpoint, project, req.headers['x-appwrite-key'], process.env.APPWRITE_DATABASE_ID || 'workfit');
  try {
    const result = await dispatch(req.bodyJson, { ...ports, secret, newId: () => crypto.randomUUID().replace(/-/g, '').slice(0, 20) });
    return res.json(result.body, result.status);
  } catch (e) {
    error(`survey: ${(e as Error).message}`);
    return res.json({ error: { code: 'INVALID_INPUT', message: '설문 서버 처리 중 오류가 났습니다.' } }, 500);
  }
};
```

`appwrite/functions/survey/appwrite.json`:

```json
{
  "projectId": "6a8288390007f641306d",
  "functions": [{
    "$id": "survey", "name": "Survey", "runtime": "node-22.0",
    "entrypoint": "dist/main.js", "commands": "", "path": ".",
    "execute": ["any"],
    "scopes": ["databases.read", "documents.read", "documents.write"],
    "timeout": 30
  }]
}
```

`appwrite/functions/survey/package.json`: `{ "name": "workfit-survey", "version": "1.0.0", "type": "module", "main": "dist/main.js" }` (의존성은 번들에 포함 — `npm install` 없음).

- [ ] **Step 3: 배포 스크립트** — `scripts/deploy-survey.mjs`. `scripts/deploy-mail-stack.mjs`의 env 읽기·`--prod`·`retry`·`bundle`·함수 생성/갱신·변수 upsert·배포 대기 흐름을 그대로 따르고, 대상은 `survey` 하나, 변수는 `{ AUTH_TOKEN_SECRET, APPWRITE_DATABASE_ID: DB_ID, APPWRITE_ENDPOINT: ENDPOINT }`(secret: `AUTH_TOKEN_SECRET`), 토큰 시크릿은 dev `WIDDY_TOKEN_SECRET` / prod `AUTH_TOKEN_SECRET_PROD`. 번들 전에 esbuild를 실행한다:

```js
import { build } from 'esbuild';
await build({
  entryPoints: ['appwrite/functions/survey/src/main.ts'],
  outfile: 'appwrite/functions/survey/dist/main.js',
  bundle: true, platform: 'node', format: 'esm', target: 'node22',
  alias: { '@': resolve('src') },
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
  logLevel: 'info',
});
```

tar 대상에서 `src`를 빼고 `dist`·`package.json`만 담는다(`--exclude=src`). `--prod` 없이 실행하면 개발 프로젝트로만 간다.

- [ ] **Step 4: 빌드 확인** — Run: `node -e "import('esbuild').then(({build})=>build({entryPoints:['appwrite/functions/survey/src/main.ts'],outfile:'appwrite/functions/survey/dist/main.js',bundle:true,platform:'node',format:'esm',target:'node22',alias:{'@':process.cwd()+'/src'},banner:{js:\"import { createRequire } from 'module'; const require = createRequire(import.meta.url);\"}}))" && node -e "import('./appwrite/functions/survey/dist/main.js').then(m=>console.log(typeof m.default))"`
Expected: `function`. 번들에 `react`/`appwrite`(브라우저 SDK)가 들어가면 안 된다 → `grep -c "react-dom\|from \"appwrite\"" appwrite/functions/survey/dist/main.js` 결과 0.

- [ ] **Step 5: 개발 배포** — Run: `node scripts/deploy-survey.mjs` / Expected: `survey` 배포 status=ready. Run: `node scripts/deploy-survey.mjs --status`.

- [ ] **Step 6: 실제 호출 확인** — 개발 `widdy-login`으로 토큰을 받아(`.claude/skills/run-app/login.local.json`의 계정) `listMine` 호출. scratchpad에 일회용 스크립트를 두고 실행:

```js
// scratchpad/survey-smoke.mjs — 저장소에 커밋하지 않는다
import fs from 'fs';
import { Client, Functions } from 'node-appwrite';
const env = fs.readFileSync('.env.local', 'utf8');
const g = (k) => (env.match(new RegExp(`^${k}="?([^"\\n#]*)`, 'm')) || [])[1]?.trim();
const login = JSON.parse(fs.readFileSync('.claude/skills/run-app/login.local.json', 'utf8'));
const fn = new Functions(new Client().setEndpoint(g('VITE_APPWRITE_ENDPOINT')).setProject(g('VITE_APPWRITE_PROJECT_ID')).setKey(g('APPWRITE_API_KEY')));
const tok = JSON.parse((await fn.createExecution({ functionId: 'widdy-login', body: JSON.stringify({ loginId: login.id, password: login.pw }) })).responseBody).token;
for (const action of ['listMine', 'listForRespondent', 'myParticipations']) {
  const t = Date.now();
  const ex = await fn.createExecution({ functionId: 'survey', body: JSON.stringify({ token: tok, action, payload: {} }) });
  console.log(action, ex.responseStatusCode, `${Date.now() - t}ms`, ex.responseBody.slice(0, 160));
}
```

Expected: 세 action 모두 200, `{"data":[...]}`. 응답 시간을 기록해 둔다(Review Focus 1, 스펙 11의 2초 기준).

- [ ] **Step 7: 커밋**

```bash
git add appwrite/functions/survey scripts/deploy-survey.mjs tsconfig.server.json .gitignore
git commit -m "feat(survey): Appwrite Function survey — 어댑터·진입점·esbuild 배포 스크립트"
```

---

### Task 7: 앱을 Function 호출로 전환

**Files:**
- Create: `src/data/survey/survey.gateway.ts`
- Modify: `src/data/survey/survey.repo.ts`, `src/data/surveyQuestion/surveyQuestion.repo.ts`, `src/data/surveyResponse/surveyResponse.repo.ts` (전체 교체)
- Delete: `src/data/survey/store.ts`
- Modify: `src/features/survey/useSurveyResponse.ts`, `src/modules/gw/survey/SurveyResult.tsx`, `src/modules/gw/survey/SurveyScreen.tsx`
- Delete: `src/data/seeds/survey.seed.ts`, `src/data/seeds/surveyQuestion.seed.ts` (사용처가 store.ts뿐인지 `grep -rn "survey.seed\|surveyQuestion.seed" src` 로 확인 후)

**Interfaces:**
- Consumes: Task 5의 action 이름·payload, Task 4가 `src/domain/survey/aggregate.ts`에 추가한 `SurveyResultView`
- Produces: repo 공개 메서드 시그니처 **유지**(actor 인자는 받되 쓰지 않음). 단 `surveyResponseRepo.readResult(actor, surveyId)`의 반환형은 `SurveyResultView`로 바뀐다.

- [ ] **Step 1: gateway** — `src/data/survey/survey.gateway.ts` (메일 gateway와 같은 규칙)

```ts
import { Functions } from 'appwrite';
import { client } from '@/shared/lib/appwrite';
import { getWiddyToken } from '@/data/widdyChat/widdyAuth';
import { SurveyError, type SurveyErrorCode } from '@/domain/survey/engine';

const FUNCTION_ID = (import.meta.env.VITE_SURVEY_FUNCTION_ID as string | undefined) || 'survey';
const KNOWN: SurveyErrorCode[] = ['INVALID_INPUT', 'FORBIDDEN', 'INVALID_STATUS', 'NOT_AUDIENCE', 'NOT_OPEN',
  'ALREADY_RESPONDED', 'LOCKED', 'VERSION_CHANGED', 'QUESTION_LIMIT', 'REQUIRED_ANSWER', 'ANSWER_FORMAT'];

/**
 * 설문 Function 호출. 실패를 빈 결과로 바꾸지 않는다 — 빈 목록으로 보이면 "설문이 없다"로 오인한다.
 */
export async function callSurvey<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  if (!client) throw new SurveyError('INVALID_INPUT', '설문 서버가 설정되지 않았습니다.');
  const token = getWiddyToken();
  if (!token) throw new SurveyError('FORBIDDEN', '로그인 정보가 만료되었습니다. 로그아웃 후 다시 로그인해 주세요.');
  let raw = '';
  let status = 0;
  try {
    const ex = await new Functions(client).createExecution(FUNCTION_ID, JSON.stringify({ token, action, payload }), false);
    raw = ex.responseBody ?? '';
    status = ex.responseStatusCode ?? 0;
  } catch {
    throw new SurveyError('INVALID_INPUT', '설문 서버에 연결하지 못했습니다. 잠시 후 다시 시도하세요.');
  }
  if (raw.trim() === '') throw new SurveyError('INVALID_INPUT', `설문 서버가 응답하지 않았습니다. (HTTP ${status})`);
  let body: { data?: T; error?: { code: string; message: string } };
  try { body = JSON.parse(raw); } catch { throw new SurveyError('INVALID_INPUT', '설문 서버 응답을 이해하지 못했습니다.'); }
  if (body.error) {
    if (status === 401) throw new SurveyError('FORBIDDEN', '로그인 정보가 만료되었습니다. 로그아웃 후 다시 로그인해 주세요.');
    const code = (KNOWN as string[]).includes(body.error.code) ? (body.error.code as SurveyErrorCode) : 'INVALID_INPUT';
    throw new SurveyError(code, body.error.message || '설문 요청을 처리하지 못했습니다.');
  }
  if (!('data' in body)) throw new SurveyError('INVALID_INPUT', `설문 서버 응답 형식이 올바르지 않습니다. (HTTP ${status})`);
  return body.data as T;
}
```

- [ ] **Step 2: repo 교체** — `src/data/survey/survey.repo.ts`

```ts
import type { User } from '@/domain/user/schema';
import type { Survey, SurveyDraft, SurveyStatus } from '@/domain/survey/schema';
import { callSurvey } from './survey.gateway';

export interface SurveyFilter { ownerUserId?: string; status?: SurveyStatus; categoryCode?: string; q?: string }

/** 화면 쪽 필터(상태·분류·검색어)는 받은 목록에 적용한다. 권한 범위는 서버가 정한다. */
function applyFilter(rows: Survey[], filter?: SurveyFilter): Survey[] {
  const keyword = filter?.q?.trim().toLowerCase() ?? '';
  return rows.filter((row) => (!filter?.status || row.status === filter.status)
    && (!filter?.categoryCode || row.categoryCode === filter.categoryCode)
    && (!keyword || [row.title, row.description].some((v) => v.toLowerCase().includes(keyword))));
}

/**
 * 설문 Repository — 저장·권한 판정은 Function `survey` 가 한다.
 * actor 인자는 호출부 호환을 위해 받지만 쓰지 않는다(서버가 서명 토큰으로 요청자를 정한다).
 */
export const surveyRepo = {
  async list(filter?: SurveyFilter): Promise<Survey[]> {
    return applyFilter(await callSurvey<Survey[]>('listMine', {}), filter);
  },
  get: (id: string) => callSurvey<Survey>('getSurvey', { id }).catch(() => null),
  listForRespondent: (_actor: User, _deptId: string | null) => callSurvey<Survey[]>('listForRespondent'),
  createDraft: (_actor: User, draft: SurveyDraft) => callSurvey<Survey>('createDraft', { draft }),
  updateBasics: (_actor: User, id: string, draft: SurveyDraft) => callSurvey<Survey>('updateBasics', { id, draft }),
  publish: (_actor: User, id: string) => callSurvey<Survey>('publish', { id }),
  close: (_actor: User, id: string) => callSurvey<Survey>('close', { id }),
  archive: (_actor: User, id: string) => callSurvey<Survey>('archive', { id }),
  duplicate: (_actor: User, id: string) => callSurvey<Survey>('duplicate', { id }),
  remove: async (_actor: User, id: string) => { await callSurvey<null>('remove', { id }); },
};
```

`useMySurveys`는 `surveyRepo.list({ ...filter, ownerUserId })`를 부르므로 그대로 동작한다(서버 `listMine`이 본인 것만 준다).

`src/data/surveyQuestion/surveyQuestion.repo.ts`:

```ts
import type { User } from '@/domain/user/schema';
import type { SurveyQuestion, SurveyQuestionDraft } from '@/domain/surveyQuestion/schema';
import { callSurvey } from '@/data/survey/survey.gateway';

/** 설문 질문 저장소 — 질문 전체를 한 번에 교체한다(서버 `replaceQuestions`). */
export const surveyQuestionRepo = {
  list: (surveyId: string) => callSurvey<SurveyQuestion[]>('listQuestions', { surveyId }),
  replaceAll: (_actor: User, surveyId: string, drafts: SurveyQuestionDraft[]) =>
    callSurvey<SurveyQuestion[]>('replaceQuestions', { surveyId, drafts }),
};
```

`src/data/surveyResponse/surveyResponse.repo.ts`:

```ts
import type { User } from '@/domain/user/schema';
import type { SurveyAnswerInput } from '@/domain/surveyAnswer/schema';
import type { SurveyResultView } from '@/domain/survey/aggregate';
import { callSurvey } from '@/data/survey/survey.gateway';

export interface SurveySubmission { surveyId: string; surveyVersion: number; answers: SurveyAnswerInput[] }

/**
 * 설문 응답 저장소. 응답·답변·참여 기록은 브라우저가 직접 읽지 못한다 — 서버만 다룬다.
 * 결과는 서버가 집계해 준다(익명 설문은 응답자·순서를 지운 채로).
 */
export const surveyResponseRepo = {
  participatedSurveyIds: (_userId: string) => callSurvey<string[]>('myParticipations'),
  submit: async (_actor: User, _deptId: string | null, submission: SurveySubmission) => {
    await callSurvey('submit', { ...submission });
  },
  readResult: (_actor: User, surveyId: string) => callSurvey<SurveyResultView>('readResult', { surveyId }),
};
```

`useSubmitSurveyResponse`가 반환값을 쓰는지 `grep -rn "submit.mutateAsync\|useSubmitSurveyResponse" src`로 확인 — `SurveyResponse`를 쓰는 곳이 있으면 그 사용을 제거한다.

- [ ] **Step 3: 결과 화면** — `src/modules/gw/survey/SurveyResult.tsx`
  - import에서 `aggregateSurveyResult`, `countSurveyAudience`, `SurveyResponse`, `resolveUserDeptId`, `Department`를 지운다.
  - `audienceCount`·`summary` `useMemo`를 다음으로 바꾼다: `const summary = resultQuery.data?.summary ?? null; const respondents = resultQuery.data?.respondents ?? {}; const audienceCount = summary?.audienceCount ?? 0;`
  - `respondentLabel(...)` 함수를 지우고, `QuestionCard`의 props를 `{ index, result, respondents }`로 바꿔 주관식 줄을 `<span>{respondents[entry.responseId] ?? '익명'}</span>`로 그린다. `key={entry.responseId}`는 익명에서 `''`가 겹치므로 `key={`${entry.responseId}-${i}`}`(map 인덱스 `i`)로 바꾼다.
  - `Props`에서 `users`·`departments`를 지우고, `SurveyScreen.tsx`의 `<SurveyResult ... />` 호출에서도 두 prop을 지운다.

- [ ] **Step 4: 시연용 사용자 선택 제거** — `src/modules/gw/survey/SurveyScreen.tsx`: `demoUserId` state, `actor` 계산의 `?? users.find(...)` 두 줄, `{!authenticatedUser && (<select ...>)}` 블록을 지우고 `const actor = authenticatedUser ?? null;`로 둔다.

- [ ] **Step 5: store 삭제와 정리** — `git rm src/data/survey/store.ts`. `grep -rn "data/survey/store\|survey.seed\|surveyQuestion.seed" src` 결과가 0이면 두 seed 파일도 `git rm`.

- [ ] **Step 6: 검증** — Run: `npx tsc --noEmit -p . && npx tsc --noEmit -p tsconfig.server.json && npx tsx --test server/survey/*.test.ts src/domain/survey/*.test.ts && npm run build` / Expected: 모두 통과.

- [ ] **Step 7: 커밋**

```bash
git add -A src/data/survey src/data/surveyQuestion src/data/surveyResponse src/data/seeds src/features/survey src/modules/gw/survey
git commit -m "feat(survey): 앱 설문 저장소를 Function 호출로 전환, 결과는 서버 집계"
```

---

### Task 8: 개발 E2E와 권한 잠금

**Files:**
- Create: `scripts/appwrite-survey-permissions.mjs`
- Modify: `scripts/appwrite-schema.ts` (5개 설문 컬렉션 정의에 `permissions`)

**Interfaces:**
- Consumes: Task 6 배포된 함수, Task 7 앱

- [ ] **Step 1: 권한 정의** — `scripts/appwrite-schema.ts`의 `surveys`·`surveyQuestions` 정의에 `permissions: [Permission.read(Role.any())],`, `surveyResponses`·`surveyAnswers`·`surveyParticipations`에 `permissions: [],`를 넣고 각각 위에 한 줄 주석(“쓰기는 Function survey 만 — 2026-10-14 설계 §5”). 이 스크립트는 **새로 만들 때만** 권한을 적용하므로 기존 컬렉션은 Step 2 스크립트로 바꾼다.

- [ ] **Step 2: 권한 스크립트** — `scripts/appwrite-survey-permissions.mjs`

```js
/**
 * 설문 컬렉션 권한 잠금 — 설계 §5. 기본은 dry-run, --apply 로 적용, --prod 면 운영.
 * 운영은 **새 앱이 배포된 뒤에만** 적용한다(옛 앱은 직접 쓰기를 해서 깨진다).
 */
import { readFileSync } from 'node:fs';
import { Client, Databases, Permission, Role } from 'node-appwrite';
const env = readFileSync('.env.local', 'utf8');
const g = (k) => (env.match(new RegExp(`^${k}\\s*=\\s*"?([^"\\n#]*)`, 'm')) || [])[1]?.trim();
const PROD = process.argv.includes('--prod');
const APPLY = process.argv.includes('--apply');
const project = PROD ? (g('APPWRITE_PROJECT_ID_PROD') ?? '6a6bf85e002acb7f71d6') : g('VITE_APPWRITE_PROJECT_ID');
const key = PROD ? g('APPWRITE_API_KEY_PROD') : (g('APPWRITE_API_KEY') ?? g('APPWRITE_API_KEY_DEV'));
const db = g('VITE_APPWRITE_DATABASE_ID') ?? 'workfit';
const dbs = new Databases(new Client().setEndpoint(g('VITE_APPWRITE_ENDPOINT')).setProject(project).setKey(key));
const PLAN = {
  surveys: [Permission.read(Role.any())],
  surveyQuestions: [Permission.read(Role.any())],
  surveyResponses: [],
  surveyAnswers: [],
  surveyParticipations: [],
};
console.log(`▶ ${PROD ? '운영' : '개발'} ${project} — ${APPLY ? '적용' : 'dry-run'}`);
for (const [id, perms] of Object.entries(PLAN)) {
  const c = await dbs.getCollection({ databaseId: db, collectionId: id });
  console.log(`${id}: ${JSON.stringify(c.$permissions)} → ${JSON.stringify(perms)}`);
  if (APPLY) await dbs.updateCollection({ databaseId: db, collectionId: id, name: c.name, permissions: perms, documentSecurity: false, enabled: c.enabled });
}
```

- [ ] **Step 3: 개발 E2E(권한 잠그기 전)** — dev 서버(`npm run dev`, 포트 3000)를 띄우고 `.claude/skills/run-app` 방식으로 Playwright 일회용 스크립트(`.claude/skills/run-app/_s1.mjs`, 끝나면 삭제)를 돌린다:
  1. 로그인 → `/gw/survey` → [+ 새 설문] → 제목 `[E2E] 서버 전환 확인`, 익명, 만족도 질문 1개·장문 1개 저장 → 배포.
  2. [참여할 설문]에서 그 설문 응답 제출 → "참여 완료" 확인.
  3. [내가 만든 설문] → 결과: 응답 1건, 주관식에 "익명" 표시.
  4. 같은 설문에 다시 응답 시도 → 이미 참여 안내.
  5. 각 단계 스크린샷을 보고 확인, 콘솔 오류 0.
  
  이어서 dev DB를 읽어(scratchpad 일회용) 방금 응답의 `surveyResponses.submittedAt`이 `T15:00:00.000Z`(KST 자정)이고 `respondentUserId`가 null, 참여 기록에 `respondedAt` 값이 없는지 확인한다.

- [ ] **Step 4: 개발 권한 잠금** — Run: `node scripts/appwrite-survey-permissions.mjs` (dry-run 출력 확인) → `node scripts/appwrite-survey-permissions.mjs --apply`.

- [ ] **Step 5: 잠금 후 확인**
  - 브라우저 SDK(키 없이 프로젝트 ID만)로 `surveyResponses` 목록 조회 → 401/404 계열 실패(scratchpad 스크립트로 `fetch(`${EP}/databases/workfit/collections/surveyResponses/documents`, { headers: { 'X-Appwrite-Project': devProject } })` → 200이 아니어야 함).
  - 같은 방식으로 `surveys` 조회는 200, `surveys`에 문서 생성 시도는 실패.
  - Step 3의 E2E를 다시 돌려 앱이 그대로 동작하는지 확인.

- [ ] **Step 6: 정리와 커밋** — 개발 DB의 `[E2E]` 설문은 앱의 [마감]→[보관]으로 정리(삭제는 초안만 가능). 일회용 스크립트 삭제.

```bash
git add scripts/appwrite-survey-permissions.mjs scripts/appwrite-schema.ts
git commit -m "feat(survey): 설문 컬렉션 권한 잠금 스크립트, 스키마 권한 정의"
```

---

### Task 9: 운영 반영 (사용자 확인 필수 — 자동 진행 금지)

이 작업은 단계마다 사용자에게 묻고, 승인된 단계만 실행한다.

- [ ] **Step 1: 확인 요청** — 사용자에게 다음 순서와 영향을 보여 주고 승인을 받는다: (1) 운영 함수 배포 `node scripts/deploy-survey.mjs --prod` (`.env.local`에 `AUTH_TOKEN_SECRET_PROD` 필요), (2) CLAUDE.md 3절 절차로 `origin main` push(=Vercel 운영 배포), (3) 배포된 운영 앱에서 설문 목록이 뜨는지 확인, (4) `node scripts/appwrite-survey-permissions.mjs --prod` dry-run → `--apply`.
- [ ] **Step 2: 승인된 단계만 실행하고 각 결과를 보고한다.**

---

## 자체 점검 결과

- 스펙 §2 목표 1~4 → Task 4(익명·1인 1회·보상), Task 3(관리자 권한), Task 7·8(브라우저 차단).
- 스펙 §6 표의 각 행 → Task 1(`kstDayStamp`, 참여 기록), Task 4(무작위 ID, `firstRespondedAt`, 결과 섞기).
- 스펙 §7 → Task 4 테스트(동시 제출, 보상, 응답 수).
- 스펙 §8 → Task 7. 스펙 §9 테스트 목록 → Task 4·5 테스트. 스펙 §10 순서 → Task 6·8·9.
- 이름 일관성: `SurveyResultView`(Task 4에서 `aggregate.ts`에 정의, Task 7에서 사용), `callSurvey`, `ServiceCtx`, action 이름(`getSurvey`·`listQuestions`·`replaceQuestions` 등)은 dispatch 표와 repo가 같다.
