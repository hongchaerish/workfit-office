# 전자설문 Function (`survey`)

설문 쓰기·제출·결과 조회를 서버에서 처리한다. 설계: `docs/superpowers/specs/2026-10-14-survey-server-design.md`.

## 계약

`POST { token, action, payload }` → `{ data }` | `{ error: { code, message } }`

- `token`: 로그인 때 `widdy-login`이 발급한 서명 토큰. 위조·만료 → 401, 잠금·퇴사 계정 → 403.
- `action`: `listMine` `getSurvey` `listQuestions` `createDraft` `updateBasics` `replaceQuestions`
  `publish` `close` `archive` `duplicate` `remove` `submit` `myParticipations` `listForRespondent` `readResult`
- 업무 규칙 오류는 400 + `SurveyErrorCode`.

## 코드 위치

| 위치 | 내용 |
| --- | --- |
| `server/survey/**` | 업무 규칙(포트 주입) — **정본**, 테스트 `npx tsx --test server/survey/*.test.ts` |
| `src/domain/survey/**` | 앱과 함께 쓰는 도메인 규칙 |
| `src/main.ts` | 진입점 |
| `src/appwriteStore.ts` | node-appwrite 어댑터 |

`node scripts/deploy-survey.mjs`가 esbuild로 위 코드를 `dist/main.js` 한 파일에 묶어 배포한다.
런타임에 `npm install`은 하지 않는다(의존성까지 번들).

## 환경변수

| 키 | 설명 |
| --- | --- |
| `AUTH_TOKEN_SECRET` | `widdy-login`과 같은 HMAC 시크릿. **secret으로 등록** |
| `APPWRITE_DATABASE_ID` | 기본 `workfit` |
| `APPWRITE_ENDPOINT` | https 엔드포인트 |

## 쓰는 컬렉션

읽기·쓰기: `surveys` `surveyQuestions` `surveyResponses` `surveyAnswers` `surveyParticipations`
읽기: `users` `departments` `roleGroups` `positions`
