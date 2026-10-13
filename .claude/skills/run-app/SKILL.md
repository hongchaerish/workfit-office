---
name: run-app
description: Launch and drive the WorkfitOffice app (Vite + React) to visually verify a change — start the dev server, log in, and screenshot screens like 조직도/사용자관리/전자결재. Use when asked to run/start/screenshot the app or confirm a UI change works in the real app.
---

# WorkfitOffice 앱 실행·확인

Vite + React SPA. 헤드리스 브라우저로 dev 서버를 구동하고 로그인해 화면을 캡처한다.
드라이버: `.claude/skills/run-app/drive.mjs` (playwright-core + 시스템 Chrome).

## 1. dev 서버 (포트 3000)

```bash
npm run dev &                 # vite, 포트 3000 (vite.config.ts 고정)
echo $! > /tmp/wf-dev.pid
until curl -sf http://localhost:3000 >/dev/null; do sleep 1; done   # 포트 폴링(sleep 금지)
```

중지: `kill $(cat /tmp/wf-dev.pid)` 또는 `pkill -f vite` (안 죽이면 다음 실행이 EADDRINUSE).

## 2. 브라우저 드라이버 준비 (최초 1회)

chromium-cli / playwright 미설치 환경이므로 **playwright-core + 시스템 Chrome**을 쓴다
(브라우저 다운로드 없음, `--no-save`로 package.json 불변).

```bash
npm i -D playwright-core --no-save
```

## 3. 실행 (로그인 → 조직도 → 사용자관리 캡처)

```bash
node .claude/skills/run-app/drive.mjs      # 스크린샷 → ./.screenshots/
```

캡처: `01-orgchart.png`, `02-orgchart-team.png`, `03-user-list.png`.
**스크린샷을 반드시 눈으로 확인**한다(빈 프레임 = 렌더 실패). 끝에 `console errors`도 확인.

환경변수로 대상/계정 변경 가능: `BASE`, `SHOT_DIR`, `LOGIN_ID`, `LOGIN_PW`, `CHROME`.

## 인증

로그인 화면 = 셸 진입 전 전체화면 게이트. 입력은 **단일 ID(사번 또는 이메일) + 비밀번호**.
관리자 계정은 `.claude/skills/run-app/login.local.json`(`{"id","pw"}`, **gitignore — 커밋 금지**)에 두고
드라이버가 `login.mjs`로 읽는다. 파일이 없으면 seed 계정(`seunggi.kim@workfit.co.kr` / `mes1234`)으로 시도하지만,
Appwrite 전환 후 seed 계정은 로그인되지 않는다. 계정이 바뀌면 이 파일만 고친다.
(사번 로그인도 가능: 예 `600001`.)

## 라우트

- 조직도: `/gw/orgchart` (그룹웨어)
- 사용자관리: `/base/user` (기준정보) — 단, 아래 gotcha 때문에 **직접 goto 금지**, 앱 내 클릭으로.
- 전자결재: `/gw/approval`

## Gotchas (실제로 겪은 것만)

- **인증 세션이 인메모리다.** 로그인 후 `page.goto`로 **전체 새로고침을 하면 로그아웃**되어
  로그인 화면으로 튕긴다. `/gw/*` 딥링크 goto는 세션이 유지되지만, `/base/*`는 로그인 화면이
  떴다. → 로그인 후 화면 전환은 **상단 메뉴/사이드바 클릭(SPA 네비게이션)**으로 한다.
  드라이버는 사용자관리를 `기준 정보` → `사용자관리` 클릭으로 연다.
- **실 백엔드는 Firestore(`workfit-office-app`).** 앱은 인메모리 폴백이 아니라 Firestore를
  읽는다(`.env.local`의 VITE_FB_*). 시드 파일만 고쳐도 화면에 반영되지 않으니, 데이터 변경은
  Firestore에 별도 반영해야 한다(참고: 메모리 `firestore-live-backend`).
- **React 제어 컴포넌트**: `el.value=` 직접 대입은 onChange가 안 뛴다. `fill`/`type` 사용.
- **첫 페인트 지연**: Vite가 라우트를 온디맨드 컴파일 → 첫 nav가 느릴 수 있다. `sleep` 말고
  `waitForSelector`로 기다린다.

## 정리

```bash
pkill -f vite
rm -rf ./.screenshots        # 캡처 산출물(임시)
```

`./.screenshots/`와 `node_modules/playwright-core`는 커밋 대상이 아니다(전자는 gitignore 권장).
