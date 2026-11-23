# 시트 서식 1단계 — 엑셀 편집기 모듈(데이터·수식·조작) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 다른 프로젝트에서도 쓸 수 있는 독립 엑셀 편집기 모듈 `src/lib/sheet/`의 바탕(시트 데이터 구조·수식 계산기·행/열 조작·셀 서식 표시)을 만들고, 전자결재 전용 칸 속성은 그 위에 이름공간으로 얹는다. 화면 변화 없음.

**Architecture:** `src/lib/sheet/`는 모듈 안 상대 경로와 `react`만 불러온다(테스트로 강제). 칸 부가 정보는 이름공간별 범용 맵(`cellMeta`·`rowMeta`·`colMeta`)이라 모듈은 결재를 모른다. 전자결재 쪽 `src/modules/gw/approval/sheetForm/approvalSheet.ts`가 이름공간(입력 칸·칸 이름·데이터 불러오기·잠금·비공개·직인)과 판단 함수를 정의한다. 기존 표 필드 코드(`formFields/formulaEngine.ts`·`sheetModel.ts`·`sheetOps.ts`·`sheetStyle.ts`)는 **한 줄도 고치지 않는다.**

**Tech Stack:** TypeScript, node:test(`npx tsx --test`).

**Spec:** `docs/superpowers/specs/2026-10-21-sheet-approval-form-design.md` (§5.0 모듈 분리, §5.1, §5.2, §5.3-7 이름 칸 수식 금지, §5.6 연동 칸 행·열 삭제 금지)

## Global Constraints

- `src/lib/sheet/` 안 파일은 같은 폴더의 상대 경로(`./…`)와 `react`만 import. `@/…`, `../` 로 폴더 밖, 전자결재 코드 금지.
- 기존 `approvalForms`·`approvalDocs` 데이터는 읽기 전용. 이 단계는 DB를 건드리지 않는다.
- 기존 표 필드 파일은 수정 금지 — 기존 테스트 전부 그대로 통과.
- 수식 오류 표시는 `#오류`, 0으로 나누기는 0, 순환 참조는 0(현행 규칙).
- 열 키는 화면에 보이지 않는 내부 키(`c_` + 영숫자 6자), 주소(A1)는 위치로 계산.
- 색은 `#rrggbb`만 저장(엑셀 색 그대로).
- 새 테스트는 `node:test`(`import test from 'node:test'`), 실행은 `npx tsx --test <파일>`.
- 커밋 메시지 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. 문자열 안의 주소 모양 글자(`"A1 참조"`)가 계산·행 삽입 때 참조로 취급되면 안 된다 → Task 1 `문자열 안의 주소는 참조가 아니다`, Task 2 `문자열 안 주소는 이동하지 않는다`.
2. 엑셀에서 온 절대 참조 `$A$1`·`A$1`이 계산되고, 행 삽입 때 `$`를 보존한 채 이동 → Task 1 `절대 참조`, Task 2 `절대 참조 이동 시 $ 보존`.
3. 수식 순환(`A1=B1`, `B1=A1+1`)에서 멈춤 없이 끝나야 한다 → Task 3 `순환 참조는 0`.
4. 칸 부가 정보가 행 삽입 때 칸을 따라 내려가고, 연동 칸이 든 행·열은 삭제 불가로 판정 → Task 4 `행 삽입 시 부가 정보 이동`, Task 6 `연동 칸 든 행·열 삭제 금지`.
5. 숫자처럼 보이는 글자(`1,200`, `₩3,000`)는 숫자로, 빈 칸은 산술에서 0·결합에서 빈 글자로 → Task 1 `빈 칸과 콤마 숫자`.

---

## File Structure

| 파일 | 책임 |
|---|---|
| Create `src/lib/sheet/formula.ts` | 수식 토큰화·계산(`evaluateFormula`)·행/열 이동(`shiftFormula`)·숫자 해석 |
| Create `src/lib/sheet/model.ts` | `Sheet` 타입, 생성·읽기·저장·재계산·구조 해시, 좌표 도우미 |
| Create `src/lib/sheet/ops.ts` | 행/열 삽입·삭제, 병합, 값 입력, 서식·테두리, 붙여넣기, 부가 정보 설정 — 순수 함수 |
| Create `src/lib/sheet/style.ts` | 셀 서식 → CSS, 숫자 표시, 기본 정렬, 색 목록 |
| Create `src/lib/sheet/index.ts` | 모듈 공개 API(이 파일로만 바깥에서 import) |
| Create `src/lib/sheet/README.md` | 다른 프로젝트에서 쓰는 법 — 공개 API, 부가 정보 이름공간 개념, 경계 규칙 |
| Create `src/lib/sheet/*.test.ts` | `formula.test.ts`·`model.test.ts`·`ops.test.ts`·`style.test.ts`·`boundary.test.ts` |
| Create `src/modules/gw/approval/sheetForm/approvalSheet.ts` (+ `.test.ts`) | 결재 이름공간·타입, 이름 칸 수식 금지, 행/열 삭제 금지 판단 |

---

### Task 1: 수식 계산기 + 모듈 경계 테스트

**Files:**
- Create: `src/lib/sheet/formula.ts`, `src/lib/sheet/formula.test.ts`, `src/lib/sheet/boundary.test.ts`

**Interfaces:**
- Produces (`formula.ts`):
  - `export type SheetValue = number | string | boolean;` (빈 칸은 `''`)
  - `export type CellGetter = (r: number, c: number) => SheetValue;` — 0-based 좌표의 계산된 값
  - `export class FormulaError extends Error {}`
  - `export const FORMULA_ERROR = '#오류';`
  - `export function evaluateFormula(expression: string, get: CellGetter): SheetValue` — 잘못된 식은 `FormulaError`. 앞 `=`는 있어도 없어도 됨.
  - `export function valueText(v: SheetValue): string` — 숫자는 소수 10자리 반올림 후 `String`, 불리언 `TRUE`/`FALSE`, 글자 그대로.
  - `export function parseNumber(text: string): number | null` — 공백·`,`·`₩` 제거 후 숫자면 숫자, 끝 `%`면 ÷100, 그 외·빈 글자는 `null`.
  - `export function colLetter(idx: number): string` / `export function colIndex(letter: string): number` (0 ↔ `A`, 26 ↔ `AA`)

문법(우선순위 낮은 것부터): 비교 `= <> < > <= >=` → 결합 `&` → `+ -` → `* /` → 단항 `-` → 기본(숫자, `"글자"`(`""`는 따옴표 한 개), `TRUE`/`FALSE`, 셀 `A1`·`$A$1`, 범위 `A1:B3`(함수 인자에서만), 함수 호출, 괄호). 함수 이름·주소 대소문자 무시. `eval`·`Function` 금지. 다 읽고 토큰이 남으면 오류.

값 규칙:
- 칸에서 읽은 글자가 `parseNumber`로 숫자가 되면 숫자로 취급(칸 값은 모두 글자로 저장되므로). 수식 안 `"…"`는 변환하지 않음.
- 산술: 빈 칸 0, 불리언 1/0, 숫자가 안 되는 글자는 `FormulaError`. `/0` 은 0.
- `&`: `valueText`로 이어 붙임, 빈 칸 `''`.
- 비교: 둘 다 숫자(빈 칸은 상대가 숫자면 0)면 수 비교, 둘 다 글자면 대소문자 무시, 섞이면 숫자 < 글자.
- `SUM`·`AVERAGE`·`MIN`·`MAX`: 범위 인자는 펼치되 숫자로 안 읽히는 글자·빈 칸은 건너뜀, 직접 인자는 산술 규칙, 숫자가 없으면 0. `ROUND(x, [자리])`. `IF(조건, 참, [거짓])` — 거짓 생략 시 `''`(문서에 FALSE가 안 찍히게), 0·빈 칸·FALSE·`''`는 거짓. 그 외 함수·`#REF!`는 `FormulaError`.

- [ ] **Step 1: 실패하는 테스트 작성**

`boundary.test.ts`: `src/lib/sheet/` 의 모든 `.ts`·`.tsx`(테스트 파일 제외)를 읽어 `from '…'`·`import('…')` 대상이 `./`로 시작하거나 `react`/`react/…`인지 검사, 아니면 파일명과 대상을 담아 실패.

`formula.test.ts` — `const grid = [['10','20',''],['A','1,200','₩3,000']]; const get = (r, c) => grid[r]?.[c] ?? '';`

```ts
test('사칙연산과 우선순위', () => {
  assert.equal(evaluateFormula('=A1+B1*2', get), 50);
  assert.equal(evaluateFormula('=(A1+B1)/3', get), 10);
  assert.equal(evaluateFormula('=-A1+5', get), -5);
  assert.equal(evaluateFormula('=A1/0', get), 0);
});
test('빈 칸과 콤마 숫자', () => {
  assert.equal(evaluateFormula('=C1+1', get), 1);
  assert.equal(evaluateFormula('=B2+C2', get), 4200);
  assert.equal(evaluateFormula('="["&C1&"]"', get), '[]');
});
test('글자 산술은 오류', () => {
  assert.throws(() => evaluateFormula('=A2+1', get), FormulaError);
});
test('함수와 범위 — 범위 안 글자는 건너뜀', () => {
  assert.equal(evaluateFormula('=SUM(A1:C2)', get), 4230);
  assert.equal(evaluateFormula('=average(A1:B1)', get), 15);
  assert.equal(evaluateFormula('=MAX(A1,B1,5)', get), 20);
  assert.equal(evaluateFormula('=ROUND(10/3,2)', get), 3.33);
  assert.equal(evaluateFormula('=SUM(C1:C1)', get), 0);
});
test('비교와 IF', () => {
  assert.equal(evaluateFormula('=A1<B1', get), true);
  assert.equal(evaluateFormula('=A2="a"', get), true);
  assert.equal(evaluateFormula('=A1<>10', get), false);
  assert.equal(evaluateFormula('=IF(B1>A1,"큼","작음")', get), '큼');
  assert.equal(evaluateFormula('=IF(A1>B1,"큼")', get), '');
  assert.equal(evaluateFormula('=IF(C1,1,2)', get), 2);
});
test('결합', () => {
  assert.equal(evaluateFormula('=A1&"원"', get), '10원');
  assert.equal(evaluateFormula('=A1+B1&"원"', get), '30원');
  assert.equal(evaluateFormula('="say ""hi"""', get), 'say "hi"');
});
test('문자열 안의 주소는 참조가 아니다', () => {
  assert.equal(evaluateFormula('="A1 참조"', get), 'A1 참조');
});
test('절대 참조', () => {
  assert.equal(evaluateFormula('=$A$1+A$1+$B1', get), 40);
});
test('잘못된 식', () => {
  for (const e of ['=SUM(', '=A1+', '=FOO(1)', '=#REF!+1', '=A1 B1', '=VLOOKUP(A1,A1:B2,2)', '=A1:B2'])
    assert.throws(() => evaluateFormula(e, get), FormulaError, e);
});
test('숫자 해석·표시·열 문자', () => {
  assert.equal(parseNumber(' 1,200 '), 1200);
  assert.equal(parseNumber('10%'), 0.1);
  assert.equal(parseNumber(''), null);
  assert.equal(parseNumber('abc'), null);
  assert.equal(valueText(0.1 + 0.2), '0.3');
  assert.equal(valueText(true), 'TRUE');
  assert.equal(colLetter(26), 'AA');
  assert.equal(colIndex('AA'), 26);
});
```

- [ ] **Step 2: 실패 확인** — `npx tsx --test src/lib/sheet/formula.test.ts src/lib/sheet/boundary.test.ts` → formula FAIL(모듈 없음), boundary PASS(빈 폴더라도 통과해야 함 — 파일 0개면 통과)
- [ ] **Step 3: `formula.ts` 구현** — 토큰에 원문 시작·끝 위치를 기록(Task 2에서 사용). 토큰화 → 재귀 하강 파서가 바로 값 계산.
- [ ] **Step 4: 통과 확인** — 같은 명령, 전부 PASS
- [ ] **Step 5: 커밋** — `git add src/lib/sheet && git commit -m "feat(시트 모듈): 수식 계산기 — IF·비교·문자열 결합, 모듈 경계 테스트"`

### Task 2: 수식 행·열 이동 (`shiftFormula`)

**Files:** Modify `src/lib/sheet/formula.ts`, `src/lib/sheet/formula.test.ts`

**Interfaces:**
- Produces: `export type ShiftAction = { type: 'row_add' | 'row_del' | 'col_add' | 'col_del'; atIndex: number };` / `export function shiftFormula(expression: string, action: ShiftAction): string` — 참조 토큰만 바꾸고 나머지 원문(공백·대소문자·글자)은 그대로. 규칙은 기존 `formFields/formulaEngine.ts`의 `shiftPlainCoordinates`와 같음: 단일 참조는 삽입 위치 이상이면 +1, 지워진 행·열이면 `#REF!`; 범위는 시작 앞 삽입이면 통째 이동, 범위 안 또는 끝 바로 다음 삽입이면 끝 확장, 삭제 시 줄이고 다 지워지면 `#REF!`. `$`는 자리 그대로 보존하고 위치는 이동. 토큰화 실패 식은 원문 그대로.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
test('행 삽입·삭제 이동', () => {
  assert.equal(shiftFormula('=A1+A3', { type: 'row_add', atIndex: 1 }), '=A1+A4');
  assert.equal(shiftFormula('=SUM(B2:B4)', { type: 'row_add', atIndex: 4 }), '=SUM(B2:B5)');
  assert.equal(shiftFormula('=A2*2', { type: 'row_del', atIndex: 1 }), '=#REF!*2');
  assert.equal(shiftFormula('=SUM(A2:A2)', { type: 'row_del', atIndex: 1 }), '=SUM(#REF!)');
});
test('열 이동', () => {
  assert.equal(shiftFormula('=B1&C1', { type: 'col_add', atIndex: 1 }), '=C1&D1');
  assert.equal(shiftFormula('=C1', { type: 'col_del', atIndex: 0 }), '=B1');
});
test('절대 참조 이동 시 $ 보존', () => {
  assert.equal(shiftFormula('=$A$2+A$2', { type: 'row_add', atIndex: 0 }), '=$A$3+A$3');
});
test('문자열 안 주소는 이동하지 않는다', () => {
  assert.equal(shiftFormula('=IF(A2>0,"A2 확인","")', { type: 'row_add', atIndex: 0 }), '=IF(A3>0,"A2 확인","")');
});
test('함수 이름·공백 보존, 깨진 식은 그대로', () => {
  assert.equal(shiftFormula('=round( A1 , 2 )', { type: 'row_add', atIndex: 0 }), '=round( A2 , 2 )');
  assert.equal(shiftFormula('="열린 따옴표', { type: 'row_add', atIndex: 0 }), '="열린 따옴표');
});
```

- [ ] **Step 2: 실패 확인** — `npx tsx --test src/lib/sheet/formula.test.ts` → FAIL(`shiftFormula` 없음)
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — PASS
- [ ] **Step 5: 커밋** — `git commit -m "feat(시트 모듈): 수식 행·열 이동 — 문자열·절대 참조 보존"`

### Task 3: 시트 데이터 구조 (`model.ts`)

**Files:** Create `src/lib/sheet/model.ts`, `src/lib/sheet/model.test.ts`

**Interfaces:**
- Consumes: Task 1 `evaluateFormula`, `valueText`, `FormulaError`, `FORMULA_ERROR`, `colLetter`.
- Produces:

```ts
export interface Merge { startRow: number; startCol: number; rowSpan: number; colSpan: number }
export type BorderW = 'none' | 'thin' | 'thick';
export interface CellStyle {
  bold?: boolean; italic?: boolean; underline?: boolean;
  fontSize?: number;                 // pt
  color?: string; bg?: string;       // '#rrggbb'
  align?: 'left' | 'center' | 'right';
  valign?: 'top' | 'middle' | 'bottom';
  numFmt?: 'general' | 'currency' | 'percent';
  border?: { t?: BorderW; r?: BorderW; b?: BorderW; l?: BorderW };
}
/** 이름공간 → 키 → 값. 모듈은 값의 뜻을 모르고, 행·열이 움직일 때 키만 옮긴다 */
export type MetaMap = Record<string, Record<string, unknown>>;
export interface Sheet {
  version: 1;
  cols: string[];                          // 내부 열 키
  rows: Array<Record<string, string>>;     // 수식 칸은 계산 결과가 들어 있음
  colWidths: Record<string, number>;       // 열 키 → px
  rowHeights: Record<string, number>;      // 행 번호 → px
  merges: Merge[];
  formulas: Record<string, string>;        // "r:colKey" → '=A1+B1'
  styles: Record<string, CellStyle>;       // "r:colKey"
  cellMeta: MetaMap;                       // 키 "r:colKey"
  rowMeta: MetaMap;                        // 키 행 번호
  colMeta: MetaMap;                        // 키 열 키
}
export const DEFAULT_COL_WIDTH = 96;
export const DEFAULT_ROW_HEIGHT = 28;
export function cellKey(r: number, col: string): string;          // `${r}:${col}`
export function newColKey(existing: string[]): string;            // 'c_' + 영숫자 6자, 중복 없음
export function createSheet(rowCount?: number, colCount?: number): Sheet; // 기본 30 × 8
export function parseSheet(raw: unknown): Sheet | null;           // 문자열 JSON·객체; version !== 1 또는 cols/rows 배열 없으면 null; 빠진 맵은 빈 값
export function serializeSheet(s: Sheet): string;
export function recalculate(s: Sheet): Sheet;
export function sheetSignature(s: Sheet): string;                 // 값·열 너비·행 높이 제외 구조 해시(djb2, 36진)
```

`recalculate`: 모든 수식 칸을 메모이즈해 계산. getter는 (1) 병합 대표 칸 치환 없음 — 엑셀처럼 병합에 가려진 칸(대표 칸이 아닌 칸)은 남아 있는 글자와 상관없이 `''`로 읽음(기존 v2의 대표 칸 치환과 다르다는 점을 주석으로 남김) (2) 그 칸에 수식이 있으면 재귀 계산, 계산 중인 칸을 다시 만나면 0, 오류 칸을 참조하면 이 칸도 오류 (3) 아니면 칸 글자, 시트 밖은 `''`. 결과는 `valueText`, 오류는 `FORMULA_ERROR`로 `rows`에 기록. 입력 `s`는 바꾸지 않음.

- [ ] **Step 1: 실패하는 테스트 작성** — 헬퍼 `fill(values: string[][], formulas: Record<string,string>)`: 크기에 맞춰 `createSheet` 후 값·수식(A1 표기 → `cellKey`) 채움, `val(s, r, c) = s.rows[r][s.cols[c]]`

```ts
test('createSheet 기본 크기와 빈 맵', () => {
  const s = createSheet();
  assert.equal(s.version, 1);
  assert.equal(s.rows.length, 30);
  assert.equal(new Set(s.cols).size, 8);
  assert.ok(s.cols.every((k) => /^c_[a-z0-9]{6}$/.test(k)));
  assert.deepEqual([s.cellMeta, s.rowMeta, s.colMeta, s.formulas], [{}, {}, {}, {}]);
});
test('parseSheet — 다른 형식·깨진 값은 null, 저장 왕복', () => {
  assert.equal(parseSheet('{"version":2,"cols":["a"],"rows":[]}'), null);
  assert.equal(parseSheet('not json'), null);
  assert.equal(parseSheet(undefined), null);
  const s = { ...createSheet(2, 2), cellMeta: { name: { '0:x': 'amount' } } };
  assert.deepEqual(parseSheet(serializeSheet(s)), s);
  const partial = parseSheet(JSON.stringify({ version: 1, cols: ['x'], rows: [{ x: '1' }] }))!;
  assert.deepEqual([partial.cellMeta, partial.rowHeights, partial.merges], [{}, {}, []]);
});
test('재계산 — 연쇄·IF·오류', () => {
  // A1=10 B1=20 C1:=A1+B1, A2:=C1*2, B2:=IF(A2>50,"초과","이내"), C2:=A1+"x"
  assert.equal(val(r, 0, 2), '30'); assert.equal(val(r, 1, 0), '60');
  assert.equal(val(r, 1, 1), '초과'); assert.equal(val(r, 1, 2), '#오류');
});
test('순환 참조는 0', () => { /* A1:=B1, B1:=A1+1 */ assert.equal(val(r, 0, 1), '1'); });
test('오류 칸을 참조하면 오류', () => { /* A1:="x"+1, B1:=A1*2 */ assert.equal(val(r, 0, 1), '#오류'); });
test('병합에 가려진 칸은 빈 칸', () => { /* merges A1:B1, B1 값 '5'(직접 넣음), C1:=B1+1 */ assert.equal(val(r, 0, 2), '1'); });
test('sheetSignature — 값·너비엔 그대로, 부가 정보엔 바뀜', () => {
  const s = createSheet(2, 2); const sig = sheetSignature(s);
  assert.equal(sheetSignature({ ...s, rows: [{ ...s.rows[0], [s.cols[0]]: '값' }, s.rows[1]], colWidths: { [s.cols[0]]: 200 } }), sig);
  assert.notEqual(sheetSignature({ ...s, cellMeta: { name: { [cellKey(0, s.cols[0])]: 'amount' } } }), sig);
});
```

- [ ] **Step 2: 실패 확인** — `npx tsx --test src/lib/sheet/model.test.ts` → FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — PASS, `boundary.test.ts`도 PASS
- [ ] **Step 5: 커밋** — `git commit -m "feat(시트 모듈): 시트 데이터 구조 — 생성·읽기·저장·재계산, 이름공간 부가 정보"`

### Task 4: 시트 조작 (`ops.ts`)

**Files:** Create `src/lib/sheet/ops.ts`, `src/lib/sheet/ops.test.ts`

**Interfaces:**
- Consumes: Task 2 `shiftFormula`, Task 3 `Sheet`·`CellStyle`·`Merge`·`cellKey`·`newColKey`.
- Produces (모두 순수 함수, 입력 불변, `Sheet` 반환):

```ts
export interface CellRange { r1: number; c1: number; r2: number; c2: number }
export type BorderPreset = 'all' | 'outer' | 'thickOuter' | 'none';
export function insertRow(s: Sheet, at: number): Sheet;
export function deleteRow(s: Sheet, at: number): Sheet;
export function insertCol(s: Sheet, at: number): Sheet;
export function deleteCol(s: Sheet, at: number): Sheet;
export function mergeRange(s: Sheet, range: CellRange): Sheet;
export function unmergeAt(s: Sheet, r: number, c: number): Sheet;
export function setCellValue(s: Sheet, r: number, c: number, text: string, opts?: { allowFormula?: boolean }): Sheet;
export function applyStyle(s: Sheet, range: CellRange, patch: Partial<CellStyle>): Sheet;
export function applyBorder(s: Sheet, range: CellRange, preset: BorderPreset): Sheet;
export function pasteTsv(s: Sheet, r: number, c: number, text: string): Sheet;
export function setCellMeta(s: Sheet, ns: string, r: number, c: number, value: unknown): Sheet; // undefined면 지움, 이름공간이 비면 이름공간도 지움
export function setRowMeta(s: Sheet, ns: string, r: number, value: unknown): Sheet;
export function setColMeta(s: Sheet, ns: string, c: number, value: unknown): Sheet;
```

규칙은 기존 `formFields/sheetOps.ts`와 같고(병합 축 이동·흡수, 대표 칸 외 값·수식 지움, 테두리 4가지, 붙여넣기 넘치면 행·열 추가), 차이는:
- 수식 이동은 `shiftFormula`.
- 행 삽입·삭제: `formulas`·`styles`·`cellMeta` 모든 이름공간의 `"r:col"` 키, `rowMeta` 모든 이름공간과 `rowHeights`의 행 번호 키를 같은 규칙으로 이동·삭제.
- 열 삭제: 그 열 키를 `colWidths`·`formulas`·`styles`·`cellMeta`(모든 이름공간)·`colMeta`(모든 이름공간)에서 제거. 열 삽입은 키가 그대로라 맵 이동 없음.
- `setCellValue`: `allowFormula`(기본 true)가 false면 `=`로 시작해도 값으로 저장하고 그 칸 수식 제거. 수식이면 `formulas`에 넣고 계산은 하지 않음(호출자가 `recalculate`).
- v2의 `sumCell`·`amountCells`·`secret*`·`headerValues`·교차 표 참조 개념은 없음.

- [ ] **Step 1: 실패하는 테스트 작성** — 기존 `formFields/sheetOps.test.ts`의 1~N번 시나리오 중 `sumCell`·`amountCells`·`secret`·`propagateStructureChange`·예전 형식을 뺀 것을 새 구조로 옮기고(삽입·삭제 시 수식/서식/병합 이동, 병합 흡수, 테두리, 붙여넣기), 아래를 추가:

```ts
test('행 삽입 시 부가 정보 이동', () => {
  const s0 = createSheet(3, 2); const [a, b] = s0.cols;
  const s = { ...s0, rowHeights: { '1': 40 }, rowMeta: { secret: { '2': true } },
    cellMeta: { name: { [`1:${a}`]: 'amount' }, lock: { [`0:${a}`]: true, [`2:${a}`]: true } },
    formulas: { [`0:${b}`]: '=A2*2' } };
  const n = insertRow(s, 1);
  assert.deepEqual(n.rowHeights, { '2': 40 });
  assert.deepEqual(n.rowMeta, { secret: { '3': true } });
  assert.deepEqual(n.cellMeta, { name: { [`2:${a}`]: 'amount' }, lock: { [`0:${a}`]: true, [`3:${a}`]: true } });
  assert.equal(n.formulas[`0:${b}`], '=A3*2');
  assert.notEqual(n, s); assert.deepEqual(s.rowHeights, { '1': 40 }); // 입력 불변
});
test('행·열 삭제 시 부가 정보 제거', () => {
  // 위 s: deleteRow(s,1) → cellMeta.name 이름공간 없어짐, rowHeights {}, rowMeta.secret {'1':true}
  // deleteCol(s,0) → cellMeta.lock·name에서 a 열 키 제거, colMeta·colWidths의 a 제거
});
test('문자열 안 주소는 행 삽입에도 그대로', () => {
  // formulas {'0:b': '="A2"&A2'} → insertRow(s,0) → formulas['1:b'] === '="A2"&A3'
});
test('allowFormula false면 값으로 저장', () => {
  // setCellValue(s,0,0,'=1+1',{allowFormula:false}) → rows[0][a] === '=1+1', formulas에 키 없음
  // 기본값으로는 formulas['0:a'] === '=1+1'
});
test('부가 정보 설정·삭제', () => {
  // setCellMeta(s,'name',0,0,'amount') → cellMeta.name['0:a']; 다시 undefined → cellMeta에 'name' 없음
});
```

- [ ] **Step 2: 실패 확인** — `npx tsx --test src/lib/sheet/ops.test.ts` → FAIL
- [ ] **Step 3: 구현** — `"r:col"`·행 번호 키 맵 이동은 이름공간 맵 전체에 같은 도우미를 적용.
- [ ] **Step 4: 통과 확인** — PASS, `boundary.test.ts` PASS
- [ ] **Step 5: 커밋** — `git commit -m "feat(시트 모듈): 행·열·병합·서식·붙여넣기 조작 — 부가 정보 함께 이동"`

### Task 5: 셀 서식 표시·공개 API·사용 안내 (`style.ts`, `index.ts`, `README.md`)

**Files:** Create `src/lib/sheet/style.ts`, `src/lib/sheet/style.test.ts`, `src/lib/sheet/index.ts`, `src/lib/sheet/README.md`

**Interfaces:**
- Consumes: Task 3 `Sheet`·`CellStyle`·`BorderW`, Task 1 `parseNumber`.
- Produces:
  - `export const SHEET_COLORS: Array<{ label: string; text: string; bg: string }>` — 기존 `formFields/sheetStyle.ts`의 `SHEET_PALETTE` 9색 값을 그대로(토큰 없이 hex).
  - `export function cellCss(style?: CellStyle): CSSProperties` — `#rrggbb`(3자리 `#rgb`도 허용) 색만 적용, 그 외 글자 무시. 배경만 있으면 글자색 `#1a1a1a`. `fontSize` → `${n}pt`, `italic` → `fontStyle`, `underline` → `textDecoration`, `valign` → `verticalAlign`(`middle`), 테두리는 기존과 같은 CSS(`thin` `1px solid #333`, `thick` `2px solid #111`, `none` `1px hidden transparent`).
  - `export function displayValue(s: Sheet, r: number, col: string): string` — `numFmt` `currency`면 천 단위 콤마, `percent`면 `값%`, 그 외 그대로.
  - `export function defaultAlign(s: Sheet, r: number, col: string): 'left' | 'right'` — 숫자면 오른쪽.
  - `index.ts`: `formula`·`model`·`ops`·`style`의 공개 함수·타입을 다시 내보냄. 바깥(전자결재)은 `@/lib/sheet`로만 import.
  - `README.md`: 모듈 목적, 경계 규칙(무엇을 import할 수 있나), 공개 API 목록 한 줄씩, 부가 정보 이름공간 개념과 예(`setCellMeta(s, 'name', r, c, 'amount')`), 지원 수식 목록, 다른 프로젝트로 옮기는 법(폴더 복사 또는 패키지화 시 `react`만 peer 의존).

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
test('엑셀 색 그대로', () => {
  assert.deepEqual(cellCss({ color: '#FF0000', bg: '#00ff00' }), { color: '#FF0000', backgroundColor: '#00ff00' });
  assert.deepEqual(cellCss({ bg: '#eee' }), { backgroundColor: '#eee', color: '#1a1a1a' });
  assert.deepEqual(cellCss({ color: 'red;x', bg: '#12' }), {});
});
test('글꼴·정렬', () => {
  assert.deepEqual(cellCss({ fontSize: 14, italic: true, underline: true, valign: 'middle', bold: true }),
    { fontSize: '14pt', fontStyle: 'italic', textDecoration: 'underline', verticalAlign: 'middle', fontWeight: 700 });
});
test('숫자 표시와 기본 정렬', () => {
  // 칸 '1234567' + numFmt currency → '1,234,567'; '15' + percent → '15%'; '가' → 그대로, defaultAlign '1,200' → 'right', '가' → 'left'
});
```

- [ ] **Step 2: 실패 확인** — `npx tsx --test src/lib/sheet/style.test.ts` → FAIL
- [ ] **Step 3: 구현** (`style.ts`, `index.ts`, `README.md`)
- [ ] **Step 4: 통과 확인** — `npx tsx --test src/lib/sheet/*.test.ts` 전부 PASS, `npx tsc --noEmit` 오류 0
- [ ] **Step 5: 커밋** — `git commit -m "feat(시트 모듈): 셀 서식 표시(엑셀 색·글꼴), 공개 API, 사용 안내"`

### Task 6: 전자결재 칸 속성 (`approvalSheet.ts`)

**Files:** Create `src/modules/gw/approval/sheetForm/approvalSheet.ts`, `src/modules/gw/approval/sheetForm/approvalSheet.test.ts`

**Interfaces:**
- Consumes: `@/lib/sheet`의 `Sheet`, `cellKey`, `setCellValue`.
- Produces:

```ts
/** 시트 부가 정보 이름공간 — 저장 데이터의 키이므로 바꾸지 말 것 */
export const APPROVAL_NS = { input: 'input', name: 'name', bind: 'bind', lock: 'lock', secret: 'secret', seal: 'seal' } as const;
export type CellInputType =
  | 'text' | 'multiline' | 'number' | 'currency' | 'date' | 'dateRange'
  | 'select' | 'multiSelect' | 'checkbox' | 'user' | 'dept';
export interface CellInput { type: CellInputType; options?: string[] }   // cellMeta.input 값
export type BindSource =                                                 // cellMeta.bind 값
  | 'company.name' | 'company.bizNo' | 'company.ceo' | 'company.address' | 'company.phone' | 'company.fax'
  | 'draft.drafter' | 'draft.dept' | 'draft.date';
// cellMeta.name: string(칸 이름), cellMeta.lock·secret·seal: true, rowMeta.secret·colMeta.secret: true
export function isStructureLocked(s: Sheet, axis: 'row' | 'col', index: number): boolean;
export function setApprovalCellValue(s: Sheet, r: number, c: number, text: string): Sheet; // 이름 칸이면 allowFormula:false
```

`isStructureLocked`: 그 행/열의 칸 중 `name`·`bind`·`secret`·`seal` 이름공간에 값이 있거나, 행이면 `rowMeta.secret`, 열이면 `colMeta.secret`에 있으면 true(spec §5.6). 화면 문구는 4단계.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
test('연동 칸 든 행·열 삭제 금지', () => {
  // createSheet(4,3) a,b,c
  // cellMeta.name {'1:a'} → row 1 true, row 0 false, col 0 true, col 1 false
  // cellMeta.bind {'0:b'} → col 1 true
  // cellMeta.seal {'2:c'} → row 2 true
  // rowMeta.secret {'3': true} → row 3 true; colMeta.secret {c: true} → col 2 true
  // cellMeta.lock·input만 있는 칸은 잠그지 않음 → 해당 행 false
});
test('이름 칸에는 수식이 들어가지 않는다', () => {
  // cellMeta.name {'0:a':'amount'} → setApprovalCellValue(s,0,0,'=1+1') → rows[0][a] '=1+1', formulas 키 없음
  // 이름 없는 칸 (0,1) → formulas['0:b'] === '=1+1'
});
test('이름공간 값은 바뀌지 않는다', () => {
  assert.deepEqual(APPROVAL_NS, { input: 'input', name: 'name', bind: 'bind', lock: 'lock', secret: 'secret', seal: 'seal' });
});
```

- [ ] **Step 2: 실패 확인** — `npx tsx --test src/modules/gw/approval/sheetForm/approvalSheet.test.ts` → FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — PASS
- [ ] **Step 5: 커밋** — `git commit -m "feat(결재서식): 시트 서식 결재 칸 속성 — 이름공간, 연동 칸 행·열 삭제 금지, 이름 칸 수식 금지"`

### Task 7: 단계 마무리 검증

- [ ] **Step 1:** `npx tsx --test $(git ls-files '*.test.ts' '*.test.tsx' '*.test.mjs') src/lib/sheet/*.test.ts src/modules/gw/approval/sheetForm/*.test.ts` → `fail 0` (기존 474 + 새 테스트)
- [ ] **Step 2:** 기존 실행형 테스트(`formFields/formulaEngine.test.ts`·`sheetModel.test.ts`·`sheetOps.test.ts`·`sheetStyle.test.ts`)를 `npx tsx <파일>`로 → 통과 메시지(파일은 안 바뀌었으므로 확인용)
- [ ] **Step 3:** `git diff origin/main --stat -- src/modules/gw/approval/formFields` → 출력 없음(기존 표 필드 파일 무변경 확인)
- [ ] **Step 4:** `npm run build` → 성공
- [ ] **Step 5:** 화면 변화 없음 — 운영 배포는 2단계와 함께(사용자 판단). 브랜치 `feat/sheet-form-model` 상태로 보고.
