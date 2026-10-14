# 전자설문 1단계 — 서버 처리·익명성·권한 정비 설계

- 작성일: 2026-10-14
- 상태: 사용자 승인(A안) → 문서 검토 대기
- 범위: 전자설문 고도화 로드맵 1~5단계 중 **1단계**. 2(알림)·3(모바일)·4(결과 활용)·5(질문 유형·첨부)는 범위 밖이다.

## 1. 배경 — 지금의 문제

현황 점검(2026-10-14, 개발 DB 기준)에서 확인한 사실이다.

| 문제 | 근거 |
|---|---|
| 5개 설문 컬렉션이 모두 `read/create/update/delete("any")` | 누구나 브라우저에서 응답을 위조·삭제하고 남의 답을 읽을 수 있다 |
| 익명 응답이 역추적된다 | `submit()`이 참여 기록 `respondedAt`과 응답 `submittedAt`에 **같은 시각**을 쓴다 (`surveyResponse.repo.ts`) |
| 모든 데이터가 모든 브라우저로 내려온다 | `loadSurveyStore()`가 5개 컬렉션 전건을 읽는다 |
| 동시 제출 시 응답 유실·카운터 어긋남 | `RESP-n`/`ANS-n`을 브라우저가 "최댓값+1"로 채번, `exclusive()`는 한 브라우저 안에서만 직렬화 |
| 관리자 권한 미연결 | `canManageSurvey(actor, row, isAdmin)`에 `isAdmin`을 넘기는 호출부가 없다 |

운영 데이터는 테스트뿐이라(사용자 확인) **데이터 이전은 하지 않는다.**

## 2. 목표 / 비목표

**목표**
1. 익명 설문에서 응답자를 식별할 수 있는 값이 어디에도 남지 않는다.
2. 응답·답변·참여 기록은 서버만 읽고 쓴다. 브라우저는 자기 권한 안의 결과만 받는다.
3. 설문 쓰기(작성·배포·마감 등)는 서버가 권한을 판정한다. 작성자 본인과 최고관리자만 관리한다.
4. 동시에 제출해도 1인 1회가 지켜지고 응답이 덮어써지지 않는다.

**비목표**: 알림, 모바일 응답, 엑셀 내보내기, 새 질문 유형, Appwrite Auth 전환.

## 3. 구조

```
브라우저 (React)                     Appwrite Function `survey`               Appwrite DB
features/survey 훅 (변경 없음)
  └ data/survey/*.repo.ts ──POST {token, action, payload}──▶ main.ts
       (gateway 호출로 교체)                                   ├ token 검증 → uid
                                                              ├ actor 해석(users·departments·roleGroups·positions)
                                                              └ handler.ts (순수 로직, DB 어댑터 주입)
                                                                    └ src/domain/survey/* 재사용 ──▶ surveys …
```

### 3.1 코드 공유 — 규칙을 두 번 적지 않는다

기존 함수(`caps-ingest`)는 저장소 코드를 import하지 못해 같은 규칙을 JS로 다시 적었고, 한쪽만 고치면 어긋날 위험이 있다.
이번에는 **esbuild로 번들**해 앱의 도메인 코드(`src/domain/survey/*`, `src/domain/roleGroup/roleResolver.ts`)를 그대로 쓴다.

- 소스: `appwrite/functions/survey/src/{main,handler,store,token}.ts`
- 빌드: `scripts/deploy-survey.mjs`가 esbuild(vite 의존성으로 이미 설치됨)로 `dist/main.js` 한 파일을 만들어 배포한다. `@/` 별칭은 esbuild alias로 푼다.
- `handler.ts`는 DB에 직접 붙지 않고 `SurveyStorePort`(아래 3.3)만 쓴다 → 단위 테스트는 메모리 어댑터로 돈다.

### 3.2 신원 확인

- 요청 본문 `{ token, action, payload }`. `token`은 로그인 때 `widdy-login`이 발급한 HMAC 서명 토큰(메일·근태와 동일).
- 검증 실패 → **401**. 익명 강등 없음. 본문의 사용자 ID는 쓰지 않는다.
- uid로 `users`를 읽어 actor를 만든다. 퇴사·잠금 계정은 403.
- 부서 ID: `departments`에서 `users.dept`(부서명)를 해석한다(앱의 `resolveDeptId`와 같은 규칙).
- 최고관리자: `roleGroups`·`positions`를 읽어 `resolveUserRoles`로 판정한다(앱과 같은 함수).

### 3.3 저장소 포트

```ts
interface SurveyStorePort {
  getSurvey(id): Promise<Survey | null>;
  listSurveys(filter): Promise<Survey[]>;           // 상태·작성자 등 서버 쿼리
  listQuestions(surveyId): Promise<SurveyQuestion[]>;
  listResponses(surveyId): Promise<SurveyResponse[]>; // 페이지네이션 내부 처리
  listAnswers(surveyId): Promise<SurveyAnswer[]>;
  countResponses(surveyId): Promise<number>;
  hasParticipation(surveyId, userId): Promise<boolean>;
  listParticipatedSurveyIds(userId): Promise<string[]>;
  createParticipation(row): Promise<'created' | 'exists'>; // 409 → 'exists'
  create/update/delete(coll, row | id): Promise<void>;
}
```

- Appwrite 어댑터: `node-appwrite` + 함수 동적 키(`x-appwrite-key`), `Query.equal('surveyId', …)` + 커서 페이지네이션.
- 메모리 어댑터: 테스트용, 그리고 `VITE_DB_DRIVER=memory`(백엔드 없는 로컬)에서 브라우저가 같은 `handler`를 직접 돌리는 용도.

## 4. API 계약

응답은 `{ data }` 또는 `{ error: { code, message } }`. 오류 코드는 기존 `SurveyErrorCode`를 그대로 쓴다.

| action | 누가 | 하는 일 |
|---|---|---|
| `listMine` | 로그인 사용자 | 내가 만든 설문(관리자는 `scope:'all'`로 전사) |
| `listForRespondent` | 로그인 사용자 | 대상인 진행 중 설문 + 내가 참여한 설문 |
| `get` | 작성자·관리자·대상자 | 설문 1건 |
| `listQuestions` | 작성자·관리자·대상자 | 질문 목록 |
| `myParticipations` | 본인 | 내가 참여한 설문 ID 목록 |
| `createDraft` / `updateBasics` / `replaceQuestions` | 작성자·관리자 | 편집(수정 범위는 `surveyEditScope` 그대로) |
| `publish` / `close` / `archive` / `duplicate` / `remove` | 작성자·관리자 | 상태 전이(`assertSurveyTransition` 그대로) |
| `submit` | 대상자 | 응답 제출 |
| `readResult` | 작성자·관리자, 결과 공개 설문의 참여자 | **집계된 결과**(아래 6) |

## 5. 컬렉션 권한

| 컬렉션 | 바뀐 뒤 |
|---|---|
| `surveys`, `surveyQuestions` | `read("any")`만. 쓰기는 함수만(API 키) |
| `surveyResponses`, `surveyAnswers`, `surveyParticipations` | **권한 없음** — 함수만 읽고 쓴다 |

- 함수가 모든 쓰기를 맡으므로 `documentSecurity`는 끈 채로 둔다.
- 조회 성능을 위해 `surveyId` 키 인덱스를 `surveyQuestions`·`surveyResponses`·`surveyAnswers`·`surveyParticipations`에, `userId` 인덱스를 `surveyParticipations`에 건다. 스키마 정의는 `scripts/appwrite-schema.ts`에 추가한다.

## 6. 익명성

| 값 | 바뀐 뒤 |
|---|---|
| 응답·답변 ID | `RESP-n`/`ANS-n` 순번 → **무작위**(`ID.unique()`). 순번으로 제출 순서를 맞추지 못하게 |
| 참여 기록 | "참여했음"만. **시각을 저장하지 않는다**(`respondedAt` 제거) |
| 익명 응답 `submittedAt` | **날짜(KST)만**. 그날 00:00 KST로 저장 |
| 익명 설문 `firstRespondedAt` | 날짜(KST)만 — 모두가 읽는 `surveys`에 첫 응답자의 정확한 시각이 남지 않게 |
| 결과 | 함수가 집계해 돌려준다. 익명 설문은 주관식 답변에 응답 ID·응답자를 싣지 않고 **목록 순서를 섞는다** |

기명 설문은 지금처럼 응답자 이름·부서를 결과에 보여준다(작성자·관리자에게만).

## 7. 동시 제출 안전성

1. 참여 기록을 ID `설문ID__사용자ID`로 **생성**한다. 이미 있으면(409) `ALREADY_RESPONDED`.
2. 응답 → 답변을 쓴다.
3. 2에서 실패하면 쓴 응답·답변과 참여 기록을 지우고(보상) 오류를 돌려준다 — 응답 없이 "참여함"만 남아 다시 못 내는 상태를 막는다.
4. `responseCount`는 더하지 않고 **실제 응답 수를 세어** 설문에 기록한다.

설문·질문 ID(`SUR-YYYYMMDD-XXXX`, `Q-XXXX`)는 서버가 채번하고, 생성이 409면 다음 번호로 재시도한다.

## 8. 앱 쪽 변경

- `src/data/survey/survey.repo.ts`·`surveyQuestion.repo.ts`·`surveyResponse.repo.ts`: 공개 메서드 시그니처는 유지하고 내부만 gateway 호출로 바꾼다. 훅·화면은 그대로.
- 새 파일 `src/data/survey/survey.gateway.ts`: 메일 gateway(`appwriteMail.gateway.ts`)와 같은 방식(토큰 없으면 재로그인 안내, 빈 응답·형식 오류는 실패로).
- `store.ts`의 `loadSurveyStore`·`exclusive`·`persistDocs`·채번 함수 제거.
- 결과 화면(`SurveyResult.tsx`)은 집계된 결과를 받도록 데이터 입력부만 바꾼다(`aggregate.ts`는 함수 쪽에서 실행).
- 시연용 사용자 선택 상자(`SurveyScreen.tsx`의 `demoUserId`) 제거.

## 9. 테스트

`npx tsx --test appwrite/functions/survey/src/*.test.ts` — 메모리 어댑터로 `handler`를 시험한다.

- 익명: 참여 기록에 시각이 없고, 응답 `submittedAt`이 날짜뿐이며, 응답 ID가 순번이 아니다. 결과에 응답자가 없다.
- 1인 1회: 같은 사용자의 두 번째 제출 → `ALREADY_RESPONDED`, 응답 1건만 남는다.
- 보상: 답변 쓰기가 실패하면 참여 기록·응답이 남지 않는다.
- 권한: 남의 설문 마감 → `FORBIDDEN`, 최고관리자는 성공. 대상이 아닌 사용자 제출 → 거부.
- 결과 접근: 결과 비공개 설문의 참여자 → `FORBIDDEN`.
- 토큰: 위조·만료 토큰 → 401.

기존 `src/domain/survey` 테스트는 그대로 통과해야 한다.

## 10. 배포 순서

| 순서 | 개발 | 운영 |
|---|---|---|
| 1 | 인덱스 추가(`appwrite-schema.ts`) | 사용자 확인 후 |
| 2 | 함수 배포(`node scripts/deploy-survey.mjs`) | `--prod`, 사용자 확인 후 |
| 3 | 앱(dev 서버)로 작성·배포·응답·결과 E2E | Vercel 배포(`origin main` push) — 사용자 지시 시 |
| 4 | 컬렉션 권한 잠금(`scripts/appwrite-survey-permissions.mjs`) | **앱 배포 후에** — 먼저 잠그면 옛 앱이 깨진다 |

운영 단계는 진행 직전에 매번 사용자에게 확인한다.

## 11. 위험과 대응

| 위험 | 대응 |
|---|---|
| 함수 호출 지연(콜드 스타트)으로 목록이 느려짐 | 모든 조회는 함수로 한다(대상자 판정이 서버에 있어야 하므로). 개발 E2E에서 목록 응답이 2초를 넘으면, 그때 `surveys`·`surveyQuestions` 공개 읽기로 직접 조회하는 경로를 별도로 제안한다 |
| esbuild 번들에 브라우저 전용 코드가 섞임 | 함수가 import하는 것은 `src/domain/**`(순수 코드)뿐으로 제한, 빌드 시 `platform:'node'` |
| 운영 토큰 시크릿 미설정 | 배포 스크립트가 `AUTH_TOKEN_SECRET_PROD` 없으면 중단(메일 스택과 동일) |
