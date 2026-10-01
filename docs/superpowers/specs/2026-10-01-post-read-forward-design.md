# 기결재 문서 후열(공람) 전달 — DB 영속화 및 후열함 노출 설계

- 작성일: 2026-10-01
- 대상 브랜치: `main`
- 상태: 설계 승인됨 → spec 검토 대기

## 1. 배경 / 문제

operator·관리자가 기결재 문서를 후열(공람) 전달해도 수신자의 후열함에 문서가 보이지 않는다.

| # | 원인 | 위치 |
|---|---|---|
| 1 | 전달 기록이 DB가 아니라 **보낸 사람 브라우저의 localStorage**(`workfit_post_read_shares_${me}`)에만 저장된다. 상세 화면의 "후열(공람) 전달 이력"도 같은 localStorage를 읽으므로 전달자 PC에서만 보인다. | `src/modules/gw/approval/ApprovalScreen.tsx` `handleSendPostRead` |
| 2 | 결재함 분류 엔진의 `'후열'` 조건이 **대결 원결재자**(`steps.some(s => s.delegatedFromId === userId)`)만 매칭한다. | `src/domain/approvalDoc/engine.ts` `matchesBox` |

## 2. 목표 / 성공 기준

- 관리자 A가 PC 1에서 사용자 B에게 후열 전달하면, B가 **어느 기기(웹 PC·모바일)** 에서 로그인해도 후열함에 해당 문서가 나타난다.
- 문서 상세의 전달 이력은 누가 어디서 보든 동일하며, 수신자별 확인 여부(확인함/미확인)를 표시한다.
- 수신자가 문서를 열람하면 자동으로 확인 처리된다.
- 전달 시 수신자에게 알림(웹 알림 목록 + 모바일 푸시)이 간다.
- 기존 localStorage에 남은 전달 기록은 DB로 자동 이관된다.
- 기존 대결 후열 동작, 다른 결재함 분류 결과는 변하지 않는다.

### 비목표
- 전달 권한 모델 변경(현행 `canForwardPostRead = isOperator || isAdmin` 유지).
- 서버 측 권한 강제(다른 컬렉션과 동일하게 현 구조상 범위 밖).
- 운영 Appwrite 반영(배포 시점에 별도 승인).

## 3. 결정 사항

| 항목 | 결정 |
|---|---|
| 저장 위치 | **신규 컬렉션 `approvalPostReadShares`**. `approvalDocs`는 수정하지 않는다(`.agents/rules/rule-readonly.md`). |
| 기존 localStorage 기록 | 관리자가 결재 화면 진입 시 **자동 이관**, 모두 성공 시에만 키 삭제. 이관 건은 알림 미발송. |
| 수신자 확인 | **열람 시 자동 확인**(버튼 없음). 미확인 건은 후열함 배지에 포함. |
| 알림 | 전달 시 `notificationRepo.create`로 생성 → 기존 Appwrite `push-notifications` 함수가 푸시. |
| 실시간성 | 수신자 목록은 TanStack Query로 창 포커스 시 + 60초 주기 refetch. 즉시 인지는 알림/푸시가 담당. |

검토했으나 기각한 대안:
- `approvalDocs`에 `postReadShares[]` 필드 추가 — 완료 문서 덮어쓰기로 읽기 전용 규칙 위반, `approvalDocs` 스키마 변경 필요.
- 참조(`kind:'참조'`) 결재선 추가 — 결재선 변조 + 후열함이 아닌 참조함에 노출되어 요구사항과 다름.

## 4. 구성 요소

### 4.1 도메인 스키마 (신규) — `src/domain/approvalPostRead/schema.ts`

```ts
export const approvalPostReadShareSchema = z.object({
  id: z.string().min(1),          // 'prs-<timestamp>' — 기존 localStorage id 형식 유지(이관 중복 판별)
  docId: z.string().min(1),
  docNo: z.string().default(''),   // 전달 시점 스냅샷
  docTitle: z.string().default(''),
  fromUserId: z.string().min(1),
  fromUserName: z.string().default(''),
  toUserId: z.string().min(1),
  toUserName: z.string().default(''),
  toUserDept: z.string().default(''),
  memo: z.string().default(''),
  sentAt: z.string().min(1),       // ISO
  readAt: z.string().nullable().default(null), // 열람 자동 확인 시각
});
export type ApprovalPostReadShare = z.infer<typeof approvalPostReadShareSchema>;
```

### 4.2 저장소 (신규) — `src/data/approvalPostRead/approvalPostRead.repo.ts`

- `createCrudBackend<ApprovalPostReadShare>({ coll: 'approvalPostReadShares', parse, idOf, seed: [] })` — Memory/Firestore/Appwrite 공통.
- 메서드:
  - `listByRecipient(userId)` — `loadWithQueries([Query.equal('toUserId', userId)])`.
  - `listByDoc(docId)` — `loadWithQueries([Query.equal('docId', docId)])`, `sentAt` 내림차순.
  - ⚠️ Memory·Firestore 드라이버의 `loadWithQueries`는 쿼리를 무시하고 전체를 반환하므로, 두 메서드 모두 **결과를 JS에서 한 번 더 필터**한다(Appwrite에서는 무해한 중복 필터).
  - Appwrite 컬렉션이 없으면(404) `crudBackend`가 조회 시 seed(`[]`)로 폴백하므로 목록은 빈 채로 동작하고, `share()` 저장만 실패해 오류가 표시된다.
  - `share(input)` — 검증(`fromUserId` 필수, `toUserId !== fromUserId`) → 저장 → 알림 생성. 반환 `{ share, notified: boolean }`(알림 실패 시 `notified:false`, 저장은 유지).
  - `markRead(id)` — `readAt == null`일 때만 현재 시각 기록(멱등).
  - `importLegacy(items)` — 이미 존재하는 id는 건너뜀, 알림 미생성. 반환 `{ imported, skipped, failed }`.

알림 내용: `type:'결재'`, `title:'후열 문서 전달'`, `text:'[<docNo>] <docTitle>'`, `senderName:<fromUserName>`, `linkUrl:'/gw/approval?doc=<docId>'`.

### 4.3 분류 엔진 (수정) — `src/domain/approvalDoc/engine.ts`

```ts
export function matchesBox(doc, userId, box, userDeptName?, absentApproverIds?, postReadDocIds?: ReadonlySet<string>)
// '후열':
//   (status ∈ {완료, 시행대기, 취소완료})
//   && (steps.some(s => s.delegatedFromId === userId) || postReadDocIds?.has(doc.id) === true)
```

- 인자 미전달 시 기존과 완전히 동일. `'삭제'` 상태 선필터도 그대로.

### 4.4 훅 — `src/features/gw/usePostReadShares.ts` (신규) / `useApprovals.ts` (수정)

- `useReceivedPostReads(userId)` — 수신 목록. `refetchOnWindowFocus: true`, `refetchInterval: 60_000`.
- `useDocPostReads(docId)` — 문서별 전달 이력.
- `useSharePostRead()` — 성공 시 해당 문서 이력·수신자 목록 쿼리 무효화.
- `useMarkPostRead()` — 성공 시 수신 목록·문서 이력 무효화.
- `useApprovalBoxes(userId)`(웹·모바일 공용) — 수신 목록에서 `postReadDocIds` 도출해 `matchesBox`에 전달.
- `approvalDocRepo.listByBox` — `box === '후열'`일 때 `approvalPostReadRepo.listByRecipient(userId)`로 Set을 만들어 전달.

### 4.5 화면 (수정)

`src/modules/gw/approval/ApprovalScreen.tsx`
- `handleSendPostRead`: localStorage 저장 제거 → `useSharePostRead().mutateAsync`. 실패 시 모달 유지·입력 보존·사유 표시. 같은 수신자에게 미확인 전달이 이미 있으면 모달에 "이미 전달됨(미확인)" 안내(재전달은 허용).
- 전달 이력 블록: `useDocPostReads(doc.id)` 사용, 항목별 `readAt` 유무로 "확인함 (<시각>) / 미확인" 표시.
- `DocDetail`: 마운트 시 `toUserId === me && readAt == null`인 해당 문서 전달 건을 `markRead`(1회).
- 결재함 목록(`list` useMemo)·사이드 카운트(현 638행 근방)·전임자 병합: 본인/전임자 각각의 수신 목록으로 `postReadDocIds`를 만들어 `matchesBox`에 전달.
- 후열 미확인 배지 = 대결 미확인 수 + 본인 수신 전달 중 `readAt == null` 수.
- localStorage 이관: `canForwardPostRead`인 사용자가 화면 진입 시 `workfit_post_read_shares_${me}` 및 레거시 `workfit_post_read_shares`를 읽어 `importLegacy`, `failed === 0`일 때만 두 키 삭제.

`src/mobile/MobileApprovalList.tsx` — 후열 미확인 배지에 수신 전달 미확인 수 합산.
`src/mobile/MobileApprovalDetail.tsx` — 열람 시 자동 확인(웹 `DocDetail`과 동일 규칙).

### 4.6 프로비저닝 — `scripts/appwrite-schema.ts`

`COLLECTIONS`에 추가(기존 규칙·권한 `POC_PERMISSIONS`과 동일):

```ts
{
  id: 'approvalPostReadShares',
  name: '결재 후열 전달',
  attributes: [
    S('id', 64, true), S('docId', 64, true), S('docNo', 64), S('docTitle', 256),
    S('fromUserId', 64, true), S('fromUserName', 128),
    S('toUserId', 64, true), S('toUserName', 128), S('toUserDept', 128),
    S('memo', 1000), S('sentAt', 40, true), S('readAt', 40),
  ],
  indexes: [IX('toUserId', ['toUserId']), IX('docId', ['docId'])],
}
```

- **개발 Appwrite**(`.env.local` → 프로젝트 `6a8288390007f641306d`)에는 구현 첫 단계에서 `npm run appwrite:schema -- --only=approvalPostReadShares`로 생성한다(멱등).
- **운영 Appwrite**(`6a6bf85e002acb7f71d6`)는 배포 직전 별도 승인 후 동일 명령을 운영 설정으로 실행한다. 운영 미생성 상태로 배포하면 전달 저장이 실패(오류 표시)하므로 배포 순서상 선행 필수.
- Firestore 드라이버는 `firestore.rules`의 범용 규칙(`/{coll}/{docId}`)으로 별도 작업 불필요.

## 5. 데이터 흐름

1. **전달**: 상세 → 모달(대상·메모) → `share()` → 컬렉션 저장 + 알림 생성(→ 푸시) → 이력 갱신.
2. **수신자 후열함**: `useReceivedPostReads(me)` → `postReadDocIds` → `matchesBox(..., '후열', ..., postReadDocIds)` → 목록·카운트·배지. 전임자 수신분도 전임자 ID 기준으로 동일 처리해 병합.
3. **자동 확인**: 수신자가 상세를 열면 본인 미확인 건 `markRead` → 배지·이력 갱신. 전임자 앞 건은 자동 확인하지 않는다.
4. **이관**: 관리자 화면 진입 1회 → `importLegacy` → 전부 성공 시 키 삭제.

## 6. 오류 처리

| 상황 | 처리 |
|---|---|
| 전달 저장 실패 | 모달 유지, 입력 보존, "후열 전달에 실패했습니다: <사유>" 표시. 성공 메시지 미표시. |
| 저장 성공·알림 실패 | 전달 성공 처리, `console.error`, "전달 완료(알림 발송 실패)" 표시. |
| 수신 목록 조회 실패 | `postReadDocIds`를 빈 Set으로 간주(대결 건만 노출), 다음 refetch에서 재시도. |
| `markRead` 실패 | 무음, 다음 열람 시 재시도. |
| 이관 부분 실패 | 키 유지 → 다음 진입 재시도(중복 id 건너뜀). 파싱 불가 항목은 건너뛰고 로그. |
| 전달 후 문서 삭제 | `matchesBox` 삭제 선필터로 미노출, 전달 기록은 보존. |
| 자기 자신 전달·`fromUserId` 누락 | repo에서 거부(에러). |

## 7. 테스트

프레임워크: 기존과 동일 `node:test` + `tsx`, Memory 드라이버. TDD로 테스트 선작성.

- `src/domain/approvalDoc/engine.test.ts`(신규) — `matchesBox` `'후열'`:
  - `postReadDocIds` 포함 + 완료 → true / 포함 + 진행중·삭제 → false
  - 대결 원결재자 → 인자 없이도 true(회귀)
  - 인자 없음 → 전달 건 false(기존 결과 불변)
  - `참조`·`완료` 등 타 함은 `postReadDocIds` 영향 없음
- `src/data/approvalPostRead/approvalPostRead.repo.test.ts`(신규):
  - `share` → `listByRecipient`·`listByDoc` 노출, 수신자 알림 1건 생성
  - 자기 자신 전달 거부
  - `markRead` 멱등
  - `importLegacy` 중복 id 건너뜀·알림 미생성
- 검증 명령: `npx tsx --test`(전체), `npm run build`.
- 수동: `run-app` 스킬(Memory 드라이버)로 관리자 전달 → 타 계정 후열함·배지 → 열람 자동 확인 → 관리자 이력 "확인함". 개발 Appwrite 컬렉션 생성 후 동일 시나리오 1회.

## 8. 변경 파일 요약

| 구분 | 파일 |
|---|---|
| 신규 | `src/domain/approvalPostRead/schema.ts`, `src/data/approvalPostRead/approvalPostRead.repo.ts`, `src/data/approvalPostRead/approvalPostRead.repo.test.ts`, `src/features/gw/usePostReadShares.ts`, `src/domain/approvalDoc/engine.test.ts` |
| 수정 | `src/domain/approvalDoc/engine.ts`, `src/data/approvalDoc/approvalDoc.repo.ts`, `src/features/gw/useApprovals.ts`, `src/modules/gw/approval/ApprovalScreen.tsx`, `src/mobile/MobileApprovalList.tsx`, `src/mobile/MobileApprovalDetail.tsx`, `scripts/appwrite-schema.ts` |
| 외부 | 개발 Appwrite에 `approvalPostReadShares` 컬렉션 생성(운영은 별도 승인) |
