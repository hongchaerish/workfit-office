# 기업 등록 창 단계 표시 개편 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기업 등록·수정 창을 왼쪽 세로 단계선(1 기본 정보 → 2 주소 → 3 계좌 → 4 메모)으로 바꾸고, 단계 상태·한 줄 요약·칸 아래 오류·필수 진행 표시를 단다.

**Architecture:** 단계 상태·요약 계산은 순수 함수(`companyFormSteps.ts`)로 빼서 테스트하고, 창(`CompanyFormModal.tsx`)은 그 결과를 그리기만 한다. 저장(`useSaveCompany`)·검증(`validateCompanyDraft`·`validateAccountDrafts`)·스키마는 그대로.

**Tech Stack:** React 18 + TS, Tailwind, lucide-react, 테스트 `node:test` (`npx tsx --test`).

**Spec:** `docs/superpowers/specs/2026-11-16-company-form-stepper-design.md`

## Global Constraints
- 저장소·훅·`src/domain/company/schema.ts` 무수정. 데이터 구조 그대로.
- 화면에 설명 안내문·내부 코드(ID) 금지 — 칸 이름·placeholder만.
- 신규 등록에서는 '사용 여부' 숨김(항상 사용), 수정일 때만 창 아래 왼쪽에 전환.
- 창 폭 760.
- 순서: 기본 정보 → 주소 → 계좌 → 메모.

## Review Focus
- 저장된 계좌를 빼면 지우지 않고 '사용 안 함'(흐리게) + 되살리기 — 기존 동작 유지.
- 사용 안 함 계좌는 계좌 단계 상태·요약·검증에서 제외.
- 중복 사업자번호는 입력 즉시 단계 ! 빨강 + 칸 아래 오류 + '등록된 기업 보기'.
- 칸 오류는 칸을 한 번 벗어난 뒤(또는 저장을 누른 뒤)부터만 표시 — 처음 열자마자 빨간 글씨 금지.
- 수정 모드로 열면(값이 다 찬 상태) 단계가 처음부터 ✓·요약으로 보여야 한다.

---

### Task 1: 단계 상태 계산 (순수 함수)

**Files:**
- Create: `src/modules/biz/company/companyFormSteps.ts`
- Test: `src/modules/biz/company/companyFormSteps.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type StepKey = 'basic' | 'address' | 'account' | 'memo';
  export type StepState = 'empty' | 'progress' | 'done' | 'error' | 'optional';
  export interface StepView { key: StepKey; title: string; state: StepState; summary: string }
  export function companyFormSteps(input: {
    form: CompanyDraft;                 // schema.ts
    accounts: AccountDraft[];           // 화면의 줄(normalizeDefaultAccount 적용 후)
    bankName: (code: string) => string; // 없으면 ''
    duplicate: boolean;                 // validateCompanyDraft(...).duplicate 유무
  }): StepView[];                        // 항상 4개, 위 순서
  export function requiredProgress(form: CompanyDraft, duplicate: boolean): { done: number; total: 2 };
  ```

규칙(정확히):
- basic: duplicate → `error`; 이름 있음 && 사업자번호 숫자 10자리 → `done`, summary `${name.trim()} · ${formatBizNo(bizNo)}`; 넷 중 하나라도 입력 → `progress`; 아니면 `empty`.
- address: 둘 다 비면 `optional`, 아니면 `done`, summary `[address, addressDetail].filter(Boolean).join(' ')`.
- account: `use` 인 줄 0개 → `optional`; 그 줄들에 `validateAccountDrafts` 오류 있으면 `progress`; 아니면 `done`, summary `계좌 N개 · 기본 ${bankName} ${accountNo}` (기본 줄 기준).
- memo: 비면 `optional`, 아니면 `done`, summary 첫 줄.
- requiredProgress: 이름 있음 +1, 사업자번호 10자리 && !duplicate +1.
- 제목: '기본 정보'·'주소'·'계좌'·'메모'.

- [ ] **Step 1: 실패 테스트 작성** — 테스트 이름과 단언:
  - `빈 신규 창` → states `['empty','optional','optional','optional']`, requiredProgress `{done:0,total:2}`
  - `이름만` → basic `progress`, `{done:1}`
  - `이름+번호 1234567890` → basic `done`, summary `'대성반도체(주) · 123-45-67890'`, `{done:2}`
  - `중복` → basic `error`, `{done:1}`
  - `주소만 상세` → address `done`, summary `'3층'`
  - `계좌 미완성(예금주 없음)` → account `progress`
  - `계좌 2개(하나 사용 안 함), 기본 신한 110-1` → account `done`, summary `'계좌 1개 · 기본 신한 110-1'`
  - `사용 안 함 계좌만` → account `optional`
  - `메모 두 줄` → memo summary 첫 줄
- [ ] **Step 2: 실행해서 실패 확인** — `npx tsx --test src/modules/biz/company/companyFormSteps.test.ts` → FAIL(모듈 없음)
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — 같은 명령 → pass 9
- [ ] **Step 5: 커밋** `feat(사업관리): 기업 등록 단계 상태 계산`

### Task 2: 창 개편 (단계선·계좌 카드·칸 오류·진행 표시)

**Files:**
- Create: `src/modules/biz/company/StepRail.tsx` — `StepSection({ index, step, last, aside, children })`: 왼쪽 동그라미(상태별: empty 회색 테두리 번호 / progress 청록 테두리 번호 / done 청록 채움 ✓ / error 빨강 ! / optional 회색 번호) + 아래로 세로선(다음 단계까지, 이 단계가 done 이면 청록, 아니면 border 색; `last` 면 선 없음), 오른쪽 머리줄 `제목 · 상태글(선택/요약)` + `aside`, 그 아래 children.
- Modify: `src/modules/biz/company/CompanyFormModal.tsx` (전면)

**Interfaces:**
- Consumes: Task 1 `companyFormSteps`, `requiredProgress`, `StepView`.

- [ ] **Step 1: StepRail.tsx 작성** — 상태글: optional/empty 는 '선택'(optional)·빈칸(empty), done 은 summary(한 줄 말줄임 `truncate`), error 는 빨강 '확인 필요'.
- [ ] **Step 2: CompanyFormModal 다시 짜기**
  - width 760, 네 단계 순서대로 `StepSection`.
  - 1 기본 정보: 기업명*·사업자등록번호*(2열), 대표자·대표번호(2열). 중복이면 칸 아래 오류 + '등록된 기업 보기' 단추(기존 그대로).
  - 칸 오류: `touched: Set<string>` — onBlur 로 추가, 저장 누르면 전부 touched. 이름 비었음/번호 자릿수·비었음 오류는 touched 일 때만 칸 아래(`Field error`), 검증식 경고는 hint.
  - 3 계좌: 카드 한 장씩(`rounded-lg border`): 윗줄 은행 select(w-36)·계좌번호(flex-1, mono)·예금주(w-40)·기본 칩(누르면 기본, 기본이면 청록 채움)·빼기 X; 아랫줄 메모 칸(작게). 사용 안 함 카드는 흐리게 + '사용 안 함' 글씨 + '되살리기' 단추(`use:true`). 계좌 칸 오류도 touched 기준으로 칸 아래(키 `acc:${k}:bank|no|holder`). 단계 머리 aside = '+ 계좌 추가'. 계좌 0개면 카드 대신 점선 '+ 계좌 추가' 상자.
  - 4 메모: 여러 줄(textarea, rows 3).
  - footer: 왼쪽 — 수정일 때만 사용/사용 안 함 전환(SelectField 또는 작은 토글); 오른쪽 — `필수 {done}/2`(2/2면 청록) · 취소 · 저장.
  - 저장: 오류면 모두 touched, 첫 문제 칸으로 `scrollIntoView({block:'center'})`+focus(`data-field` 속성으로 찾기). 서버 오류(중복 409·기타)만 아래 묶음 상자.
- [ ] **Step 3: 타입 확인** — `npx tsc --noEmit` → 오류 없음
- [ ] **Step 4: 화면 확인** — run-app 으로 사업관리 › 기업 정보 › 신규 등록: 빈 창 / 기본 정보 채움 / 계좌 2개 / 저장 눌러 오류 이동 / 수정 모드 캡처를 눈으로 확인(1366×768). 개발 DB에 시험 저장은 하지 않음(취소로 닫기).
- [ ] **Step 5: 전체 테스트·빌드** — `npx tsx --test $(git ls-files '*.test.ts' '*.test.tsx' '*.test.mjs')` 전부 pass, `npm run build` 성공
- [ ] **Step 6: 커밋** `feat(사업관리): 기업 등록 창 — 단계선·한 줄 요약·계좌 카드·칸 아래 오류`
