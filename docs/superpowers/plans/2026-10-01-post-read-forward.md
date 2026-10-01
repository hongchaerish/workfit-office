# 기결재 문서 후열 전달 DB 영속화 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 후열(공람) 전달 기록을 DB 컬렉션 `approvalPostReadShares`에 저장하고, 수신자의 후열함·배지·알림·열람 자동확인까지 동작하게 한다.

**Architecture:** 신규 도메인(`domain/approvalPostRead`) + `createCrudBackend` 기반 repo + TanStack Query 훅. 결재함 엔진 `matchesBox`에 선택 인자 `postReadDocIds`를 추가해 기존 호출 결과는 불변. `approvalDocs`는 건드리지 않는다.

**Tech Stack:** React 19, TypeScript, TanStack Query 5, zod 4, Appwrite(node-appwrite 스키마 스크립트), `node:test` + `tsx`.

**Spec:** `docs/superpowers/specs/2026-10-01-post-read-forward-design.md`

## Global Constraints

- `approvalDocs`/`approvalForms` 기존 데이터는 읽기 전용 — 쓰기 금지(`.agents/rules/rule-readonly.md`).
- 컬렉션 id: `approvalPostReadShares`. 권한: 스키마 스크립트 기본 `POC_PERMISSIONS`.
- 개발 Appwrite(`.env.local`, 프로젝트 `6a8288390007f641306d`)에만 생성. 운영(`6a6bf85e002acb7f71d6`)은 별도 승인.
- 전달 권한: `canForwardPostRead = isOperator || isAdmin` (변경 없음).
- 테스트: `npx tsx --test <file>` (Memory 드라이버). 빌드: `npm run build`.
- 커밋 메시지 말미: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. push 금지.

## Spec 대비 조정 (구현 중 확인된 사실)

- `crudBackend` Appwrite `save()`는 컬렉션 404 시 **경고만 남기고 조용히 성공**한다. 따라서 "컬렉션 미생성 시 share 실패 표시"는 보장되지 않는다 → 운영 컬렉션 선행 생성이 필수(spec §4.6 배포 순서와 동일). 이 계획에서 crudBackend 동작은 바꾸지 않는다.
- 전임자 승계 지원을 위해 repo는 `listByRecipient(userId)` 대신 `listByRecipients(userIds: string[])`를 제공한다.
- 순수 도출 함수(`postReadDocIdsFor`, `unreadPostReadDocIdsFor`, `parseLegacyShares`)는 `domain/approvalPostRead/engine.ts`에 둔다.

## Review Focus

1. 같은 문서를 같은 수신자에게 두 번 전달 → 후열함에는 1건만, 배지도 1로 센다(문서 단위 Set). — Task 2 테스트로 고정.
2. 전달 후 문서가 `삭제` 상태가 되면 후열함·배지에서 빠진다. — Task 2 엔진 테스트로 고정.
3. 레거시 localStorage에 필드가 빠진/깨진 항목이 섞여 있어도 나머지는 이관된다. — Task 2 `parseLegacyShares` 테스트로 고정.
4. 상세를 열 때 자동확인이 중복 호출되어도 `readAt`이 첫 시각으로 유지된다. — Task 1 `markRead` 멱등 테스트로 고정.
5. 다른 사용자 앞 전달이 내 후열함에 섞이지 않는다(Memory/Firestore는 쿼리 무시). — Task 1 `listByRecipients` 테스트로 고정.

---

### Task 1: 도메인 스키마 + repo + Appwrite 컬렉션

**Files:**
- Create: `src/domain/approvalPostRead/schema.ts`
- Create: `src/data/approvalPostRead/approvalPostRead.repo.ts`
- Test: `src/data/approvalPostRead/approvalPostRead.repo.test.ts`
- Modify: `scripts/appwrite-schema.ts` (`COLLECTIONS` 배열, `backupPolicies` 정의 바로 앞)

**Interfaces:**
- Produces:
  - `approvalPostReadShareSchema`, `type ApprovalPostReadShare`
  - `approvalPostReadRepo.listByRecipients(userIds: string[]): Promise<ApprovalPostReadShare[]>`
  - `approvalPostReadRepo.listByDoc(docId: string): Promise<ApprovalPostReadShare[]>` (sentAt 내림차순)
  - `approvalPostReadRepo.share(input: SharePostReadInput): Promise<{ share: ApprovalPostReadShare; notified: boolean }>`
  - `approvalPostReadRepo.markRead(id: string): Promise<ApprovalPostReadShare | null>`
  - `approvalPostReadRepo.importLegacy(items: ApprovalPostReadShare[]): Promise<{ imported: number; skipped: number; failed: number }>`

- [ ] **Step 1: 스키마 작성** — `src/domain/approvalPostRead/schema.ts`

```ts
import { z } from 'zod';

/**
 * 기결재 문서 후열(공람) 전달 기록. approvalDocs 와 분리된 별도 컬렉션(approvalPostReadShares).
 * 기존 결재 문서는 읽기 전용이므로 전달 사실은 문서에 쓰지 않고 여기에만 남긴다.
 */
export const approvalPostReadShareSchema = z.object({
  /** 'prs-…' — 예전 localStorage 기록의 id 형식을 그대로 써서 이관 시 중복을 가린다. */
  id: z.string().min(1),
  docId: z.string().min(1),
  /** 전달 시점 스냅샷(이력 표시용). */
  docNo: z.string().default(''),
  docTitle: z.string().default(''),
  fromUserId: z.string().min(1),
  fromUserName: z.string().default(''),
  toUserId: z.string().min(1),
  toUserName: z.string().default(''),
  toUserDept: z.string().default(''),
  memo: z.string().default(''),
  sentAt: z.string().min(1),
  /** 수신자가 문서를 열람해 자동 확인된 시각(ISO). 미확인이면 null. */
  readAt: z.string().nullable().default(null),
});

export type ApprovalPostReadShare = z.infer<typeof approvalPostReadShareSchema>;
```

- [ ] **Step 2: 실패하는 repo 테스트 작성** — `src/data/approvalPostRead/approvalPostRead.repo.test.ts`

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { approvalPostReadRepo } from './approvalPostRead.repo';
import { notificationRepo } from '@/data/notification/notification.repo';

const doc = { id: 'AP-T-001', docNo: 'AP-T-001', title: '테스트 기안' };
const base = { fromUserId: 'ADM', fromUserName: '관리자', toUserName: '수신', toUserDept: '개발팀', memo: '' };

test('share: 수신자·문서 기준으로 조회되고 다른 수신자 건은 섞이지 않는다', async () => {
  await approvalPostReadRepo.share({ ...base, doc, toUserId: 'R1' });
  await approvalPostReadRepo.share({ ...base, doc: { ...doc, id: 'AP-T-002', docNo: 'AP-T-002' }, toUserId: 'R2' });

  const r1 = await approvalPostReadRepo.listByRecipients(['R1']);
  assert.deepEqual(r1.map((s) => s.docId), ['AP-T-001']);
  assert.equal(r1[0].readAt, null);

  const both = await approvalPostReadRepo.listByRecipients(['R1', 'R2']);
  assert.equal(both.length, 2);

  const byDoc = await approvalPostReadRepo.listByDoc('AP-T-001');
  assert.deepEqual(byDoc.map((s) => s.toUserId), ['R1']);
});

test('share: 수신자에게 후열 알림 1건을 만든다', async () => {
  const { notified } = await approvalPostReadRepo.share({ ...base, doc: { ...doc, id: 'AP-T-003', docNo: 'AP-T-003' }, toUserId: 'R3' });
  assert.equal(notified, true);
  const notis = await notificationRepo.list('R3');
  assert.equal(notis.length, 1);
  assert.equal(notis[0].title, '후열 문서 전달');
  assert.equal(notis[0].linkUrl, '/gw/approval?doc=AP-T-003');
});

test('share: 본인에게 전달하거나 대상이 없으면 거부한다', async () => {
  await assert.rejects(approvalPostReadRepo.share({ ...base, doc, toUserId: 'ADM' }), /본인/);
  await assert.rejects(approvalPostReadRepo.share({ ...base, doc, toUserId: '' }), /대상자/);
});

test('markRead: 멱등 — 두 번째 호출이 readAt 을 바꾸지 않는다', async () => {
  const { share } = await approvalPostReadRepo.share({ ...base, doc: { ...doc, id: 'AP-T-004', docNo: 'AP-T-004' }, toUserId: 'R4' });
  const first = await approvalPostReadRepo.markRead(share.id);
  assert.ok(first?.readAt);
  await new Promise((r) => setTimeout(r, 5));
  const second = await approvalPostReadRepo.markRead(share.id);
  assert.equal(second?.readAt, first?.readAt);
  assert.equal(await approvalPostReadRepo.markRead('없는-id'), null);
});

test('importLegacy: 이미 있는 id 는 건너뛰고 알림을 만들지 않는다', async () => {
  const legacy = {
    id: 'prs-legacy-1', docId: 'AP-T-005', docNo: 'AP-T-005', docTitle: '레거시', fromUserId: 'ADM', fromUserName: '관리자',
    toUserId: 'R5', toUserName: '수신5', toUserDept: '', memo: '', sentAt: '2026-09-20T09:00:00.000Z', readAt: null,
  };
  const first = await approvalPostReadRepo.importLegacy([legacy]);
  assert.deepEqual(first, { imported: 1, skipped: 0, failed: 0 });
  const again = await approvalPostReadRepo.importLegacy([legacy]);
  assert.deepEqual(again, { imported: 0, skipped: 1, failed: 0 });
  assert.equal((await notificationRepo.list('R5')).length, 0);
  assert.equal((await approvalPostReadRepo.listByRecipients(['R5'])).length, 1);
});
```

- [ ] **Step 3: 실패 확인** — Run: `npx tsx --test src/data/approvalPostRead/approvalPostRead.repo.test.ts` → Expected: FAIL (모듈 없음).

- [ ] **Step 4: repo 구현** — `src/data/approvalPostRead/approvalPostRead.repo.ts`

```ts
import { approvalPostReadShareSchema, type ApprovalPostReadShare } from '@/domain/approvalPostRead/schema';
import { createCrudBackend, Query } from '@/data/_backend/crudBackend';
import { notificationRepo } from '@/data/notification/notification.repo';

/**
 * 후열(공람) 전달 Repository — 컬렉션 approvalPostReadShares.
 * 예전에는 전달한 사람 브라우저의 localStorage 에만 남아 수신자 쪽에서는 존재하지 않았다.
 * approvalDocs 는 읽기 전용이라 문서에 쓰지 않고 이 컬렉션에 따로 둔다.
 */
const backend = createCrudBackend<ApprovalPostReadShare>({
  coll: 'approvalPostReadShares',
  parse: (raw) => {
    const p = approvalPostReadShareSchema.safeParse(raw);
    return p.success ? p.data : null;
  },
  idOf: (x) => x.id,
  seed: [],
});

export interface SharePostReadInput {
  doc: { id: string; docNo: string; title: string };
  fromUserId: string;
  fromUserName: string;
  toUserId: string;
  toUserName: string;
  toUserDept: string;
  memo: string;
}

const newestFirst = (a: ApprovalPostReadShare, b: ApprovalPostReadShare) => b.sentAt.localeCompare(a.sentAt);

export const approvalPostReadRepo = {
  /** Memory·Firestore 드라이버는 쿼리를 무시하고 전체를 주므로 JS 에서도 한 번 더 거른다. */
  async listByRecipients(userIds: string[]): Promise<ApprovalPostReadShare[]> {
    const ids = userIds.filter(Boolean);
    if (ids.length === 0) return [];
    const rows = await backend.loadWithQueries([Query.equal('toUserId', ids)]);
    return rows.filter((s) => ids.includes(s.toUserId)).sort(newestFirst);
  },

  async listByDoc(docId: string): Promise<ApprovalPostReadShare[]> {
    const rows = await backend.loadWithQueries([Query.equal('docId', docId)]);
    return rows.filter((s) => s.docId === docId).sort(newestFirst);
  },

  /** 저장이 핵심, 알림은 부가 — 알림이 실패해도 전달은 성공으로 돌려준다(notified=false). */
  async share(input: SharePostReadInput): Promise<{ share: ApprovalPostReadShare; notified: boolean }> {
    if (!input.toUserId) throw new Error('후열로 전달할 대상자를 선택해주세요.');
    if (!input.fromUserId) throw new Error('전달자 정보를 확인할 수 없습니다.');
    if (input.toUserId === input.fromUserId) throw new Error('본인에게는 후열 전달할 수 없습니다.');

    const share = approvalPostReadShareSchema.parse({
      id: `prs-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      docId: input.doc.id,
      docNo: input.doc.docNo,
      docTitle: input.doc.title,
      fromUserId: input.fromUserId,
      fromUserName: input.fromUserName,
      toUserId: input.toUserId,
      toUserName: input.toUserName,
      toUserDept: input.toUserDept,
      memo: input.memo.trim(),
      sentAt: new Date().toISOString(),
      readAt: null,
    });
    await backend.save(share);

    let notified = true;
    try {
      await notificationRepo.create({
        userId: share.toUserId,
        type: '결재',
        title: '후열 문서 전달',
        text: `[${share.docNo}] ${share.docTitle}`,
        senderName: share.fromUserName,
        linkUrl: `/gw/approval?doc=${share.docId}`,
      });
    } catch (e) {
      notified = false;
      console.error('[approvalPostRead] 후열 전달 알림 생성 실패', e);
    }
    return { share, notified };
  },

  /** 열람 자동 확인 — 이미 확인된 건은 그대로 둔다(멱등). 없는 id 는 null. */
  async markRead(id: string): Promise<ApprovalPostReadShare | null> {
    const rows = await backend.loadAll();
    const cur = rows.find((s) => s.id === id);
    if (!cur) return null;
    if (cur.readAt) return cur;
    const next = { ...cur, readAt: new Date().toISOString() };
    await backend.save(next);
    return next;
  },

  /** 예전 localStorage 기록 이관. 이미 있는 id 는 건너뛰고, 과거 건이라 알림은 보내지 않는다. */
  async importLegacy(items: ApprovalPostReadShare[]): Promise<{ imported: number; skipped: number; failed: number }> {
    const existing = new Set((await backend.loadAll()).map((s) => s.id));
    let imported = 0;
    let skipped = 0;
    let failed = 0;
    for (const it of items) {
      if (existing.has(it.id)) {
        skipped++;
        continue;
      }
      try {
        await backend.save(it);
        existing.add(it.id);
        imported++;
      } catch (e) {
        failed++;
        console.error('[approvalPostRead] 레거시 후열 전달 이관 실패', it.id, e);
      }
    }
    return { imported, skipped, failed };
  },
};
```

- [ ] **Step 5: 통과 확인** — Run: `npx tsx --test src/data/approvalPostRead/approvalPostRead.repo.test.ts` → Expected: 5 pass.

- [ ] **Step 6: Appwrite 컬렉션 정의 추가** — `scripts/appwrite-schema.ts`의 `COLLECTIONS`에서 `backupPolicies` 항목 앞에 삽입:

```ts
  {
    id: 'approvalPostReadShares',
    name: '결재 후열 전달',
    attributes: [
      S('id', 64, true),
      S('docId', 64, true),
      S('docNo', 64),
      S('docTitle', 256),
      S('fromUserId', 64, true),
      S('fromUserName', 128),
      S('toUserId', 64, true),
      S('toUserName', 128),
      S('toUserDept', 128),
      S('memo', 1000),
      S('sentAt', 40, true),
      S('readAt', 40),
    ],
    indexes: [IX('toUserId', ['toUserId']), IX('docId', ['docId'])],
  },
```

- [ ] **Step 7: 개발 Appwrite에 생성** — Run: `npm run appwrite:schema -- --only=approvalPostReadShares`
  Expected: 첫 줄 `project 6a8288390007f641306d`(개발) 확인 후 `✓ collection "approvalPostReadShares" 생성`, attr 12개, index 2개, `✅ 스키마 적용 완료`. 프로젝트 id가 운영(`6a6bf85e…`)이면 **즉시 중단**.

- [ ] **Step 8: Commit**

```bash
git add src/domain/approvalPostRead/schema.ts src/data/approvalPostRead scripts/appwrite-schema.ts
git commit -m "feat(approval): 후열 전달 기록 컬렉션(approvalPostReadShares) 및 repo 추가"
```

---

### Task 2: 순수 도출 함수 + `matchesBox` 확장

**Files:**
- Create: `src/domain/approvalPostRead/engine.ts`
- Test: `src/domain/approvalPostRead/engine.test.ts`
- Modify: `src/domain/approvalDoc/engine.ts:297-315` (`matchesBox`)
- Test: `src/domain/approvalDoc/engine.test.ts` (신규)

**Interfaces:**
- Consumes: `ApprovalPostReadShare` (Task 1)
- Produces:
  - `postReadDocIdsFor(shares: ApprovalPostReadShare[], userId: string): Set<string>`
  - `unreadPostReadDocIdsFor(shares: ApprovalPostReadShare[], userId: string): Set<string>`
  - `parseLegacyShares(raw: unknown): ApprovalPostReadShare[]`
  - `matchesBox(doc, userId, box, userDeptName?, absentApproverIds?, postReadDocIds?: ReadonlySet<string>): boolean`

- [ ] **Step 1: 실패하는 테스트** — `src/domain/approvalPostRead/engine.test.ts`

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseLegacyShares, postReadDocIdsFor, unreadPostReadDocIdsFor } from './engine';
import type { ApprovalPostReadShare } from './schema';

const s = (over: Partial<ApprovalPostReadShare>): ApprovalPostReadShare => ({
  id: 'prs-1', docId: 'D1', docNo: 'D1', docTitle: 't', fromUserId: 'ADM', fromUserName: '', toUserId: 'U1',
  toUserName: '', toUserDept: '', memo: '', sentAt: '2026-10-01T00:00:00.000Z', readAt: null, ...over,
});

test('postReadDocIdsFor: 해당 수신자 문서만, 중복 전달은 1건', () => {
  const shares = [s({ id: 'a' }), s({ id: 'b' }), s({ id: 'c', toUserId: 'U2', docId: 'D2' })];
  assert.deepEqual([...postReadDocIdsFor(shares, 'U1')], ['D1']);
});

test('unreadPostReadDocIdsFor: 하나라도 미확인이면 미확인 문서', () => {
  const shares = [s({ id: 'a', readAt: '2026-10-01T01:00:00.000Z' }), s({ id: 'b', docId: 'D2' })];
  assert.deepEqual([...unreadPostReadDocIdsFor(shares, 'U1')], ['D2']);
});

test('parseLegacyShares: 깨진 항목은 건너뛰고 나머지는 readAt=null 로 변환', () => {
  const out = parseLegacyShares([
    { id: 'prs-1', docId: 'D1', docNo: 'D1', docTitle: 't', fromUserId: 'ADM', fromUserName: '관리자', toUserId: 'U1',
      toUserName: '수신', toUserDept: '', memo: '', sentAt: '2026-09-01T00:00:00.000Z', isRead: false },
    { id: 'prs-2' },
    'garbage',
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].readAt, null);
  assert.equal('isRead' in out[0], false);
  assert.deepEqual(parseLegacyShares('not-array'), []);
});
```

`src/domain/approvalDoc/engine.test.ts`

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { matchesBox } from './engine';
import { approvalDocSchema, type ApprovalDoc } from './schema';

const mk = (over: Partial<ApprovalDoc> = {}): ApprovalDoc =>
  approvalDocSchema.parse({
    id: 'D1', docNo: 'D1', docType: '기안', title: '문서', drafterId: 'DR', status: '완료',
    steps: [{ seq: 1, kind: '결재', approverId: 'AP', decision: '승인' }],
    ...over,
  });

test("후열: 전달받은 완료 문서는 매칭", () => {
  assert.equal(matchesBox(mk(), 'U1', '후열', undefined, undefined, new Set(['D1'])), true);
});

test('후열: 전달받았어도 진행중·삭제 문서는 매칭 안 됨', () => {
  assert.equal(matchesBox(mk({ status: '진행중' }), 'U1', '후열', undefined, undefined, new Set(['D1'])), false);
  assert.equal(matchesBox(mk({ status: '삭제' }), 'U1', '후열', undefined, undefined, new Set(['D1'])), false);
});

test('후열: 인자 없이도 대결 원결재자는 기존처럼 매칭, 전달 건은 미매칭', () => {
  const delegated = mk({ steps: [{ seq: 1, kind: '결재', approverId: 'PX', delegatedFromId: 'U1', decision: '승인' }] as ApprovalDoc['steps'] });
  assert.equal(matchesBox(delegated, 'U1', '후열'), true);
  assert.equal(matchesBox(mk(), 'U1', '후열'), false);
});

test('다른 함은 postReadDocIds 영향을 받지 않는다', () => {
  const ids = new Set(['D1']);
  assert.equal(matchesBox(mk(), 'U1', '참조', undefined, undefined, ids), false);
  assert.equal(matchesBox(mk(), 'U1', '완료', undefined, undefined, ids), matchesBox(mk(), 'U1', '완료'));
});
```

- [ ] **Step 2: 실패 확인** — Run: `npx tsx --test src/domain/approvalPostRead/engine.test.ts src/domain/approvalDoc/engine.test.ts` → Expected: FAIL (모듈 없음 / 후열 전달 매칭 false).

- [ ] **Step 3: 구현** — `src/domain/approvalPostRead/engine.ts`

```ts
import { approvalPostReadShareSchema, type ApprovalPostReadShare } from './schema';

/** userId 가 전달받은 문서 id 집합(같은 문서 중복 전달은 1건). matchesBox 의 postReadDocIds 로 쓴다. */
export function postReadDocIdsFor(shares: ApprovalPostReadShare[], userId: string): Set<string> {
  return new Set(shares.filter((s) => s.toUserId === userId).map((s) => s.docId));
}

/** userId 앞으로 온 전달 중 아직 열람(자동 확인)하지 않은 문서 id 집합 — 후열 배지용. */
export function unreadPostReadDocIdsFor(shares: ApprovalPostReadShare[], userId: string): Set<string> {
  return new Set(shares.filter((s) => s.toUserId === userId && !s.readAt).map((s) => s.docId));
}

/**
 * 예전 localStorage(`workfit_post_read_shares_*`) 기록을 스키마로 변환.
 * 깨진 항목은 건너뛴다. 옛 isRead 는 실제로 true 가 된 적이 없어 버리고 readAt=null 로 둔다.
 */
export function parseLegacyShares(raw: unknown): ApprovalPostReadShare[] {
  if (!Array.isArray(raw)) return [];
  const out: ApprovalPostReadShare[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { isRead: _isRead, ...rest } = item as Record<string, unknown>;
    const p = approvalPostReadShareSchema.safeParse({ ...rest, readAt: null });
    if (p.success) out.push(p.data);
    else console.warn('[approvalPostRead] 레거시 후열 전달 항목 건너뜀', item);
  }
  return out;
}
```

`src/domain/approvalDoc/engine.ts` `matchesBox` 교체:

```ts
export function matchesBox(
  doc: ApprovalDoc,
  userId: string,
  box: ApprovalBox,
  userDeptName?: string,
  absentApproverIds?: string[],
  /** userId 가 후열(공람) 전달받은 문서 id 집합. 넘기지 않으면 대결 원결재자 건만 후열로 본다. */
  postReadDocIds?: ReadonlySet<string>
): boolean {
```

그리고 `'후열'` case:

```ts
    case '후열':
      return (doc.status === '완료' || doc.status === '시행대기' || doc.status === '취소완료')
        && (doc.steps.some((s) => s.delegatedFromId === userId) || postReadDocIds?.has(doc.id) === true);
```

- [ ] **Step 4: 통과 확인** — Run: 위 2개 테스트 → Expected: 전부 pass. engine.ts가 `successionRepo`를 import해 Node에서 로드 실패하면, 그 원인을 확인하고 테스트에서 동적 import 없이 해결 가능한지 본다(실패 메시지 그대로 보고).

- [ ] **Step 5: Commit**

```bash
git add src/domain/approvalPostRead/engine.ts src/domain/approvalPostRead/engine.test.ts src/domain/approvalDoc/engine.ts src/domain/approvalDoc/engine.test.ts
git commit -m "fix(approval): 후열함이 후열 전달받은 문서도 포함하도록 matchesBox 확장"
```

---

### Task 3: 훅 + 공용 결재함 도출 연결

**Files:**
- Create: `src/features/gw/usePostReadShares.ts`
- Modify: `src/features/gw/useApprovals.ts` (`useApprovalBoxes`)
- Modify: `src/data/approvalDoc/approvalDoc.repo.ts` (`listByBox` 마지막 return)

**Interfaces:**
- Consumes: Task 1 repo, Task 2 함수
- Produces:
  - `useReceivedPostReads(userIds: string[])` → `UseQueryResult<ApprovalPostReadShare[]>`
  - `useDocPostReads(docId: string)` → `UseQueryResult<ApprovalPostReadShare[]>`
  - `useSharePostRead()` → mutation(`SharePostReadInput`) → `{ share, notified }`
  - `useAutoMarkPostRead(docId: string, me: string)` — 열람 자동 확인 부수효과
  - `useLegacyPostReadImport(me: string, enabled: boolean)` — 1회 이관 부수효과

- [ ] **Step 1: 훅 작성** — `src/features/gw/usePostReadShares.ts`

```ts
import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { approvalPostReadRepo, type SharePostReadInput } from '@/data/approvalPostRead/approvalPostRead.repo';
import { parseLegacyShares } from '@/domain/approvalPostRead/engine';

/** 후열(공람) 전달 훅. 실시간 구독이 없어 포커스 복귀·60초 주기로 다시 읽는다(즉시 인지는 알림/푸시). */
const KEY = 'approvalPostReads';

export function useReceivedPostReads(userIds: string[]) {
  const ids = [...new Set(userIds.filter(Boolean))].sort();
  return useQuery({
    queryKey: [KEY, 'recv', ...ids],
    queryFn: () => approvalPostReadRepo.listByRecipients(ids),
    enabled: ids.length > 0,
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
  });
}

export function useDocPostReads(docId: string) {
  return useQuery({
    queryKey: [KEY, 'doc', docId],
    queryFn: () => approvalPostReadRepo.listByDoc(docId),
    enabled: Boolean(docId),
  });
}

export function useSharePostRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SharePostReadInput) => approvalPostReadRepo.share(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

/** 수신자가 문서를 열면 본인 앞 미확인 전달을 확인 처리. 전임자 앞 건은 건드리지 않는다. 실패는 무음(다음 열람 때 재시도). */
export function useAutoMarkPostRead(docId: string, me: string) {
  const qc = useQueryClient();
  const { data: shares = [] } = useDocPostReads(docId);
  const tried = useRef(new Set<string>());
  useEffect(() => {
    const mine = shares.filter((s) => s.toUserId === me && !s.readAt && !tried.current.has(s.id));
    if (mine.length === 0) return;
    mine.forEach((s) => tried.current.add(s.id));
    Promise.all(mine.map((s) => approvalPostReadRepo.markRead(s.id)))
      .then(() => qc.invalidateQueries({ queryKey: [KEY] }))
      .catch((e) => console.error('[approvalPostRead] 후열 자동 확인 실패', e));
  }, [shares, me, qc]);
}

/** 예전 localStorage 전달 기록을 DB 로 1회 이관. 전부 성공했을 때만 키를 지운다. */
export function useLegacyPostReadImport(me: string, enabled: boolean) {
  const qc = useQueryClient();
  const done = useRef(false);
  useEffect(() => {
    if (!enabled || !me || done.current) return;
    done.current = true;
    const keys = [`workfit_post_read_shares_${me}`, 'workfit_post_read_shares'];
    let raw: unknown[] = [];
    try {
      for (const k of keys) {
        const v = localStorage.getItem(k);
        if (v) raw = raw.concat(JSON.parse(v));
      }
    } catch (e) {
      console.warn('[approvalPostRead] 레거시 후열 기록 읽기 실패', e);
      return;
    }
    if (raw.length === 0) return;
    approvalPostReadRepo
      .importLegacy(parseLegacyShares(raw))
      .then((r) => {
        if (r.failed === 0) keys.forEach((k) => localStorage.removeItem(k));
        if (r.imported > 0) void qc.invalidateQueries({ queryKey: [KEY] });
      })
      .catch((e) => console.error('[approvalPostRead] 레거시 후열 기록 이관 실패', e));
  }, [me, enabled, qc]);
}
```

- [ ] **Step 2: `useApprovalBoxes` 연결** — `src/features/gw/useApprovals.ts`
  - import 추가: `import { useReceivedPostReads } from '@/features/gw/usePostReadShares';`, `import { postReadDocIdsFor } from '@/domain/approvalPostRead/engine';`
  - `const { data: users = [] } = useUsers();` 아래에:

```ts
  const { data: postReadShares } = useReceivedPostReads(userId ? [userId] : []);
  const postReadDocIds = useMemo(
    () => (userId ? postReadDocIdsFor(postReadShares ?? [], userId) : new Set<string>()),
    [postReadShares, userId],
  );
```

  - `matchesBox(d, userId, box, userDeptNameOrId)` → `matchesBox(d, userId, box, userDeptNameOrId, undefined, postReadDocIds)`, useMemo 의존성에 `postReadDocIds` 추가.

- [ ] **Step 3: `listByBox` 연결** — `src/data/approvalDoc/approvalDoc.repo.ts`
  - import: `import { approvalPostReadRepo } from '@/data/approvalPostRead/approvalPostRead.repo';`, `import { postReadDocIdsFor } from '@/domain/approvalPostRead/engine';`
  - 마지막 `return rows.filter((d) => matchesBox(d, userId, box, userDeptNameOrId)).sort(byRecent);`를:

```ts
    const postReadDocIds = box === '후열'
      ? postReadDocIdsFor(await approvalPostReadRepo.listByRecipients([userId]).catch(() => []), userId)
      : undefined;
    return rows.filter((d) => matchesBox(d, userId, box, userDeptNameOrId, undefined, postReadDocIds)).sort(byRecent);
```

- [ ] **Step 4: 타입 확인** — Run: `npx tsc --noEmit` → Expected: 오류 0.

- [ ] **Step 5: Commit**

```bash
git add src/features/gw/usePostReadShares.ts src/features/gw/useApprovals.ts src/data/approvalDoc/approvalDoc.repo.ts
git commit -m "feat(approval): 후열 전달 조회·전달·자동확인·이관 훅 추가 및 결재함 도출 연결"
```

---

### Task 4: 웹 결재 화면 연결

**Files:**
- Modify: `src/modules/gw/approval/ApprovalScreen.tsx`

**Interfaces:**
- Consumes: Task 2 `postReadDocIdsFor`, `unreadPostReadDocIdsFor`; Task 3 훅 전부

- [ ] **Step 1: import** — 상단에 추가:

```ts
import {
  useReceivedPostReads,
  useDocPostReads,
  useSharePostRead,
  useAutoMarkPostRead,
  useLegacyPostReadImport,
} from '@/features/gw/usePostReadShares';
import { postReadDocIdsFor, unreadPostReadDocIdsFor } from '@/domain/approvalPostRead/engine';
```

- [ ] **Step 2: `ApprovalScreen` 본문** — `const preds = useMemo(...)` 바로 아래:

```ts
  // 후열(공람) 전달 — 본인 + 전임자 앞 전달을 한 번에 읽어 사용자별로 나눠 쓴다.
  const { isOperator: isOp, isAdmin: isAdm } = usePermission();
  useLegacyPostReadImport(me, isOp || isAdm);
  const { data: recvPostReads = [] } = useReceivedPostReads([me, ...preds]);
  const postReadIdsOf = (uid: string) => postReadDocIdsFor(recvPostReads, uid);
  const myUnreadPostReadIds = useMemo(() => unreadPostReadDocIdsFor(recvPostReads, me), [recvPostReads, me]);
```

  - `list` useMemo: `matchesBox(d, me, box as ApprovalBox, myDeptNameOrId)` → `matchesBox(d, me, box as ApprovalBox, myDeptNameOrId, undefined, postReadIdsOf(me))`, `matchesBox(d, predId, box as ApprovalBox, predDeptNameOrId)` → `..., predDeptNameOrId, undefined, postReadIdsOf(predId))`, 의존성에 `recvPostReads` 추가.
  - 사이드 카운트 블록(동일 두 호출)도 같은 방식으로 인자 추가.
  - `unconfirmedPostReadCount` 계산을:

```ts
                  const unconfirmedPostReadCount = (byBox['후열'] ?? []).filter(
                    (d) => d.steps.some((s) => s.delegatedFromId === me && !s.postReadAt) || myUnreadPostReadIds.has(d.id)
                  ).length;
```

- [ ] **Step 3: `DocDetail`** — localStorage 상태(`postReadStorageKey`, `postReadShareList`, `docShares` useMemo) 제거 후:

```ts
  const { data: docShares = [] } = useDocPostReads(doc.id);
  const sharePostReadM = useSharePostRead();
  useAutoMarkPostRead(doc.id, me);
```

  `handleSendPostRead` 교체:

```ts
  const handleSendPostRead = async () => {
    if (!canForwardPostRead) {
      alert('후열 전달 기능은 시스템관리자(operator)만 사용할 수 있습니다.');
      return;
    }
    if (!forwardTargetUserId) {
      alert('후열로 전달할 임직원을 선택해주세요.');
      return;
    }
    const targetUser = org.userById(forwardTargetUserId) || users.find((u) => u.id === forwardTargetUserId);
    try {
      const { notified } = await sharePostReadM.mutateAsync({
        doc: { id: doc.id, docNo: doc.docNo, title: doc.title },
        fromUserId: me,
        fromUserName: org.userById(me)?.name || '관리자',
        toUserId: forwardTargetUserId,
        toUserName: targetUser?.name || forwardTargetUserId,
        toUserDept: targetUser?.dept || '',
        memo: forwardMemo,
      });
      alert(
        notified
          ? `${targetUser?.name || '해당 사용자'} 님에게 후열(공람) 문서로 전달되었습니다.`
          : `${targetUser?.name || '해당 사용자'} 님에게 전달은 완료되었으나 알림 발송에 실패했습니다.`,
      );
      setShowForwardPostReadModal(false);
      setForwardTargetUserId('');
      setForwardMemo('');
    } catch (e) {
      // 모달과 입력값을 그대로 두어 다시 시도할 수 있게 한다.
      alert(`후열 전달에 실패했습니다: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
```

  - 모달의 대상자 select 아래에, 미확인 중복 안내:

```tsx
                {forwardTargetUserId && docShares.some((s) => s.toUserId === forwardTargetUserId && !s.readAt) && (
                  <p className="mt-1.5 text-[11px] font-semibold text-amber-600">이미 전달되어 아직 확인하지 않은 사용자입니다. 다시 전달하면 알림이 한 번 더 갑니다.</p>
                )}
```

  - '후열 전달하기' 버튼에 `disabled={sharePostReadM.isPending}`.
  - 이력 항목의 시각 옆에 확인 여부:

```tsx
                    <span>·</span>
                    {share.readAt ? (
                      <span className="font-semibold text-teal">확인함 ({share.readAt.slice(0, 16).replace('T', ' ')})</span>
                    ) : (
                      <span className="font-semibold text-amber-600">미확인</span>
                    )}
```

- [ ] **Step 4: 타입·빌드 확인** — Run: `npx tsc --noEmit` → Expected: 오류 0.

- [ ] **Step 5: Commit**

```bash
git add src/modules/gw/approval/ApprovalScreen.tsx
git commit -m "fix(approval): 후열 전달을 localStorage 대신 DB에 저장하고 수신자 후열함·배지·자동확인 연결"
```

---

### Task 5: 모바일 연결

**Files:**
- Modify: `src/mobile/MobileApprovalList.tsx` (후열 배지 useMemo, 109-112행 근방)
- Modify: `src/mobile/MobileApprovalDetail.tsx` (컴포넌트 상단 훅)

- [ ] **Step 1: 목록 배지** — import 추가 `useReceivedPostReads`, `unreadPostReadDocIdsFor`. `useApprovalBoxes(me)` 아래:

```ts
  const { data: recvPostReads = [] } = useReceivedPostReads([me]);
```

  배지 계산 교체:

```ts
  const unconfirmedPostReadCount = useMemo(() => {
    const list = byBox['후열'] ?? [];
    const unread = unreadPostReadDocIdsFor(recvPostReads, me);
    return list.filter((d) => d.steps.some((s) => s.delegatedFromId === me && !s.postReadAt) || unread.has(d.id)).length;
  }, [byBox, me, recvPostReads]);
```

- [ ] **Step 2: 상세 자동 확인** — import `useAutoMarkPostRead`; `const doc = useApprovalDoc(id);` 아래 `useAutoMarkPostRead(doc?.id ?? '', me);`

- [ ] **Step 3: 타입 확인** — Run: `npx tsc --noEmit` → 오류 0.

- [ ] **Step 4: Commit**

```bash
git add src/mobile/MobileApprovalList.tsx src/mobile/MobileApprovalDetail.tsx
git commit -m "fix(approval): 모바일 후열 배지·열람 자동확인에 후열 전달 반영"
```

---

### Task 6: 전체 검증

- [ ] **Step 1:** Run: `npx tsx --test $(git ls-files 'src/**/*.test.ts')` 와 신규 테스트 → Expected: 전부 pass(기존 실패가 있으면 이번 변경 전에도 실패하는지 `git stash` 없이 원인만 확인해 보고).
- [ ] **Step 2:** Run: `npm run build` → Expected: 성공.
- [ ] **Step 3:** 수동 확인(run-app 스킬): 관리자 계정 → 완료 문서 상세 → 후열 전달 → 다른 계정 로그인 → 후열함 노출·주황 배지 → 문서 열기 → 배지 해제 → 관리자 쪽 이력 "확인함". 개발 Appwrite 드라이버로 1회.
- [ ] **Step 4:** 운영 반영 체크리스트를 사용자에게 보고: 운영 Appwrite 컬렉션 생성 → 배포 순서.
