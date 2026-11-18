# 업무계획 화면 개편 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 업무계획 '주간' 보기를 부서별로 접히는 조용한 표(C 모양 줄 글)로 바꾸고, 칸 옆 상세 창·고도화한 일정 창·부서 관리 순서 바꾸기를 넣고, 수동 정렬 순서를 없앤다.

**Architecture:** 순수 계산(빈 시간·지금 상태·부서 묶음·요약·부서 순서 이동)은 `src/domain`과 `components/*.ts`에 두고 `node:test`로 검증한다. 주간 표는 새 컴포넌트 `WorkPlanTeamWeekTable`로 만들고(월간은 기존 `WorkPlanTeamMonthlyMatrix` 유지, 칩만 C 모양), 상세 창·한 주 서랍은 별도 컴포넌트, 화면 상태 연결은 `WorkPlanScreen`이 맡는다. 일정 창은 기존 `WorkPlanEventModal`·`EventFields`·`TimeGrid`를 고친다.

**Tech Stack:** Vite + React 18 + TypeScript, TanStack Query, Tailwind, Appwrite. 테스트 `npx tsx --test <파일>`(node:test + node:assert/strict).

**Spec:** `docs/superpowers/specs/2026-11-18-workplan-view-design.md` (시안: `docs/superpowers/specs/2026-11-18-workplan-view-prototype.html`)

## Global Constraints

- 답·화면 글은 한국어. 화면에 개발용 ID·"~에 저장되어 표시" 같은 안내문 금지.
- 결재 문서(`approvalDocs`)·서식(`approvalForms`) 데이터는 읽기만.
- 운영 DB `rosterOrders` 문서는 지우지 않는다 — 코드에서 읽지 않게만 한다.
- 부서 순서는 기존 `departments.order`를 쓴다(새 칸 금지).
- 업무계획 보기 권한(전사 통일)은 바꾸지 않는다.
- 일정 한 줄 색(왼쪽 2px 선): 업무 `#d6dbe3`, 회의 `#b6a2f2`, 외근·출장 `#8cc8ee`(글자 `#155f8d`), 휴가 `#e3d36a`(글자 `#6f630f`). 보통 굵기, 상자·테두리·그림자·배경 없음.
- 마우스 올림에 **세로 열 강조 금지**. 태그 **칩 줄 금지**(메뉴만). 상세 창은 **스크롤해도 닫히지 않는다**.
- 시작 수치: 칸당 3줄, 주말 칸 54px, 상세 창 360px, 일정 창 약 820px, 되돌리기 알림 4초, 빈 시간 9~18시·점심 12~13시 제외·30분 이상.
- 검증: `npx tsc --noEmit -p .` → `npx tsx --test $(git ls-files '*.test.ts' '*.test.tsx' '*.test.mjs')` → `npm run build`. `origin main` push는 배포 지시가 있을 때만.

## Review Focus

1. **겸직자** — 본직·겸직 두 부서 묶음에 모두 나오고, 칸을 누르면 같은 사람의 상세가 열린다(같은 userId). Task 5 테스트로 고정.
2. **여러 날 외근·출장** — 막대 대신 날마다 한 줄로 나와야 하고, 상세 창의 빈 시간에서 종일 외근 날은 빈 시간이 없다. Task 1·6 테스트로 고정.
3. **시간 미정 업무(종료 없음)·종일 휴가·반차** — 빈 시간 계산에서 종료 없는 업무는 30분, 종일 휴가는 하루 전체, 오전반차는 09:00~13:30, 오후반차는 12:30~18:00으로 막는다. Task 1 테스트.
4. **지금 시각이 18시 이후이거나 오늘이 아닌 날** — '지금' 줄은 오늘만, 오늘 빈 시간이 없으면 빈 시간 영역을 숨긴다. Task 1 테스트.
5. **부서가 없는 사람·부서 관리에 없는 부서 이름** — "소속 없음" 묶음으로 맨 끝에 모인다(사라지지 않는다). Task 5 테스트.

---

## File Structure

| 파일 | 책임 |
|---|---|
| `src/domain/workPlan/freeSlots.ts` (+test) | 분 단위 빈 시간·첫 빈 시각 계산 |
| `src/modules/gw/task/components/dayDetail.ts` (+test) | 칸 항목 → 바쁜 시간, 그날 상태(사무실/휴가/외근/출장), 오늘 '지금' 문구, 최근 업무 제목 |
| `src/modules/gw/task/components/entryKind.ts` (+test) | `lineToneOf` 추가 — C 모양 색 갈래 |
| `src/modules/gw/task/components/EntryLine.tsx` | C 모양 일정 한 줄(표·상세 창·월간 공용) |
| `src/modules/gw/task/components/CellMemo.tsx` | 기존 `CellMemo`를 월간 표에서 떼어 냄(상세 창도 씀) |
| `src/modules/gw/task/components/teamWeekGroups.ts` (+test) | 사람 → 부서 묶음(내 부서·임원·부서 순서·소속 없음), 묶음 요약 |
| `src/modules/gw/task/components/WorkPlanTeamWeekTable.tsx` | 새 주간 표 |
| `src/modules/gw/task/components/WorkPlanCellPopover.tsx` | 칸 옆 상세 창(내/남) |
| `src/modules/gw/task/components/WorkPlanPersonWeekDrawer.tsx` | 이름 누르면 한 주 서랍 |
| `src/features/chat/openDirectChat.ts` | 1:1 대화 열기 + 미리 채울 글 |
| `src/domain/department/reorder.ts` (+test) | 형제 부서 순서 위/아래 이동 |
| `src/domain/user/rosterOrder.ts`, `src/features/user/useRosterOrder.ts` | 수동 순서 제거 |
| `src/modules/gw/task/event/*` | 일정 창 고도화 |
| `src/modules/gw/task/WorkPlanScreen.tsx` | 연결 |

---

### Task 1: 빈 시간 계산(도메인)

**Files:**
- Create: `src/domain/workPlan/freeSlots.ts`
- Test: `src/domain/workPlan/freeSlots.test.ts`

**Interfaces:**
- Produces:
  - `export const WORK_DAY = { start: 540, end: 1080 } as const` (9~18시)
  - `export const LUNCH: MinuteRange = { start: 720, end: 780 }`
  - `export function freeSlots(busy: MinuteRange[], opts?: { day?: MinuteRange; lunch?: MinuteRange | null; minLength?: number; notBefore?: number }): MinuteRange[]` — 기본 day=WORK_DAY, lunch=LUNCH, minLength=30. `notBefore`가 있으면 그 이후를 30분 단위로 올림해 자른다.
  - `export function firstFreeStart(busyLists: MinuteRange[][], length: number, opts?: { day?: MinuteRange; lunch?: MinuteRange | null; notBefore?: number; step?: number }): number | null` — 모든 목록이 함께 비는 첫 시작(분), step 기본 30. 없으면 null.
  - `MinuteRange`는 `@/domain/workPlan/timeGrid`의 것(`{ start: number; end: number }`).

- [ ] **Step 1: 실패하는 테스트 작성** — `freeSlots.test.ts`

```ts
test('freeSlots: 점심과 바쁜 시간을 빼고 30분 이상만', () => {
  assert.deepEqual(freeSlots([{ start: 540, end: 600 }, { start: 840, end: 870 }]),
    [{ start: 600, end: 720 }, { start: 780, end: 840 }, { start: 870, end: 1080 }]);
});
test('freeSlots: 20분짜리 틈은 버린다', () => {
  assert.deepEqual(freeSlots([{ start: 540, end: 700 }, { start: 780, end: 1080 }]), []);
});
test('freeSlots: notBefore 10:35 → 11:00부터', () => {
  assert.deepEqual(freeSlots([], { notBefore: 635 })[0], { start: 660, end: 720 });
});
test('freeSlots: 18시 이후 notBefore → 빈 배열', () => {
  assert.deepEqual(freeSlots([], { notBefore: 1090 }), []);
});
test('firstFreeStart: 두 사람 모두 비는 첫 시각', () => {
  assert.equal(firstFreeStart([[{ start: 540, end: 600 }], [{ start: 600, end: 660 }]], 60), 660);
});
test('firstFreeStart: 점심에 걸치면 건너뛴다', () => {
  assert.equal(firstFreeStart([[{ start: 540, end: 690 }]], 60), 780);
});
test('firstFreeStart: 없으면 null', () => {
  assert.equal(firstFreeStart([[{ start: 540, end: 1080 }]], 30), null);
});
```

- [ ] **Step 2: 실패 확인** — `npx tsx --test src/domain/workPlan/freeSlots.test.ts` → FAIL(모듈 없음)
- [ ] **Step 3: `freeSlots.ts` 구현** — 바쁜 구간에 점심을 더해 시작순 정렬 후 훑기. `notBefore`는 `Math.ceil(n / 30) * 30`로 올린 값과 day.start 중 큰 값부터.
- [ ] **Step 4: 통과 확인** — 같은 명령 → PASS
- [ ] **Step 5: 커밋** — `git add src/domain/workPlan/freeSlots*.ts && git commit -m "feat(업무계획): 빈 시간·첫 빈 시각 계산"`

---

### Task 2: 칸 항목 → 바쁜 시간·그날 상태·지금 문구·최근 제목

**Files:**
- Create: `src/modules/gw/task/components/dayDetail.ts`
- Test: `src/modules/gw/task/components/dayDetail.test.ts`
- Modify: `src/modules/gw/task/components/entryKind.ts` — `lineToneOf` 추가
- Test: `src/modules/gw/task/components/entryKind.test.ts` (새로)

**Interfaces:**
- Consumes: Task 1 `MinuteRange`, `freeSlots`; 기존 `DayEntry`, `isLeave`, `entryKindOf`.
- Produces:
  - `export type LineTone = 'item' | 'meeting' | 'outside' | 'leave'` / `export function lineToneOf(entry: DayEntry): LineTone` — trip은 'outside'. (`entryKind.ts`)
  - `export function busyRangeOf(entry: DayEntry): MinuteRange | null` — 시각 있는 항목은 start~end(종료 없으면 +30분), 종일 휴가·종일 외근/출장 = `{540,1080}`, 휴가 `schedule.subType`이 오전반차 = `{540,810}`, 오후반차 = `{750,1080}`, 그 밖 종일·미정 업무 = null(막지 않음).
  - `export type DayStatus = { kind: 'office' } | { kind: 'leave'; label: string } | { kind: 'outside' | 'trip'; label: string }` / `export function dayStatusOf(entries: DayEntry[]): DayStatus` — 휴가가 외근보다 먼저. label은 `chipLook(entry).label`에서 `[휴가] ` 접두를 뺀 글.
  - `export function nowLineOf(entries: DayEntry[], nowMinute: number): { tone: 'free' | 'busy' | 'outside' | 'away'; text: string }` — 문구는 spec 4-2 그대로: 종일 휴가 `오늘 ${label}로 자리에 없습니다. 급한 일은 메시지를 남겨 주세요.` / 반차 진행 중 `지금 ${label} 중입니다.` / 외근 진행 중 `지금 ${title} 중 · ${HH:mm}까지` / 회의·업무 진행 중 `지금 ${title} 중 · ${HH:mm}에 끝나요` / 비어 있음 `지금은 비어 있어요 · 다음 일정 ${HH:mm} ${title}` 또는 `지금은 비어 있어요 · 오늘 남은 일정 없음`.
  - `export function freeSlotsOfDay(entries: DayEntry[], opts: { isToday: boolean; nowMinute: number }): MinuteRange[]` — 종일 휴가·종일 외근/출장이면 `[]`, 아니면 `freeSlots(busy, { notBefore: isToday ? nowMinute : undefined })`.
  - `export function recentItemTitles(entriesNewestFirst: DayEntry[], limit = 5): string[]` — ITEM만, 같은 제목 하나로.

- [ ] **Step 1: 실패하는 테스트 작성** — 테스트용 `DayEntry` 만드는 `entry(o: Partial<DayEntry>)` 도우미(`dayEntries.test.ts`의 모양을 따름). 반드시 넣을 단언:
  - `lineToneOf` : ITEM→'item', MEETING→'meeting', OUTSIDE(category TRIP)→'outside', APPROVAL LEAVE→'leave'.
  - `busyRangeOf({ startTime:'10:00', endTime:null })` → `{600,630}`; 종일 휴가 → `{540,1080}`; 오전반차 → `{540,810}`; 오후반차 → `{750,1080}`; 미정 업무 → `null`.
  - `dayStatusOf([외근, 연차])` → `{ kind:'leave', label:'연차' }`; `[]` → `{ kind:'office' }`.
  - `nowLineOf([14:00~15:00 '주간 회의'], 870)` → `{ tone:'busy', text:'지금 주간 회의 중 · 15:00에 끝나요' }`; `nowLineOf([12:30 오후반차], 635)` → `{ tone:'free', text:'지금은 비어 있어요 · 다음 일정 12:30 오후반차' }`; `nowLineOf([종일 연차], 635).tone` → `'away'`.
  - `freeSlotsOfDay([종일 외근], { isToday:false, nowMinute:0 })` → `[]`.
  - `recentItemTitles([A,B,A,meeting,C])` → `['A','B','C']`.
- [ ] **Step 2: 실패 확인** — `npx tsx --test src/modules/gw/task/components/dayDetail.test.ts src/modules/gw/task/components/entryKind.test.ts` → FAIL
- [ ] **Step 3: 구현** — 반차 판별은 `entry.schedule?.subType`(문자열에 '오전'/'오후' 포함)으로, 캘린더 VACATION은 종일 처리.
- [ ] **Step 4: 통과 확인** — 같은 명령 → PASS
- [ ] **Step 5: 커밋** — `feat(업무계획): 칸 상세용 계산(바쁜 시간·상태·지금·최근 제목)`

---

### Task 3: 수동 정렬 순서 제거

**Files:**
- Modify: `src/domain/user/rosterOrder.ts` — `displayOrder`·`byDisplayOrder` 제거, 주석 0번 항목 삭제
- Modify: `src/domain/user/rosterOrder.test.ts` — 수동 순서 테스트 삭제
- Modify: `src/features/user/useRosterOrder.ts` — `useRosterOrderSetting`·`manualOrder`·`orderById/orderByName` 제거
- Delete: `src/features/user/useRosterOrderSetting.ts`, `src/data/rosterOrder/rosterOrder.repo.ts`, `src/modules/gw/task/components/RosterOrderModal.tsx`
- Modify: `src/modules/gw/task/WorkPlanScreen.tsx` — `isOrderOpen`, `↕ 정렬 순서` 버튼, `<RosterOrderModal>` 제거(`canEditRosterOrder`는 태그 관리 `canEdit`에 계속 쓰므로 이름만 `canManageWorkPlan`으로)

**Interfaces:**
- Produces: `RosterOrderContext`에서 `displayOrder` 삭제. `useRosterOrder()`의 반환 `{ compare, isExecutive }`와 기준(임원 → 부서 순서 → 직책 → 직급 → 이름)은 그대로.

- [ ] **Step 1: 테스트 정리** — `rosterOrder.test.ts`에서 `displayOrder`를 쓰는 테스트를 지우고, 다음을 추가: `compareRoster`가 ctx에 `displayOrder`가 없어도 부서 순서 → 직책 → 직급 → 이름으로 정렬(기존 픽스처 재사용).
- [ ] **Step 2: 실행** — `npx tsx --test src/domain/user/rosterOrder.test.ts` → 타입 오류 없이 PASS(아직 코드 수정 전이므로 기존 구현으로도 통과해야 한다)
- [ ] **Step 3: 코드 제거** — 위 파일들 수정·삭제. `grep -rn "rosterOrder\|RosterOrderModal\|useRosterOrderSetting" src` 결과가 `domain/user/rosterOrder*`·`useRosterOrder.ts`·사용처(`compare`만)뿐이어야 한다.
- [ ] **Step 4: 확인** — `npx tsc --noEmit -p .` 오류 0, `npx tsx --test src/domain/user/rosterOrder.test.ts` PASS
- [ ] **Step 5: 커밋** — `refactor(인원 정렬): 업무계획 수동 정렬 순서 제거 — 부서 순서·직책·직급·이름만`

---

### Task 4: 부서 관리 — 형제 부서 순서 바꾸기

**Files:**
- Create: `src/domain/department/reorder.ts`
- Test: `src/domain/department/reorder.test.ts`
- Modify: `src/modules/base/department/DepartmentScreen.tsx` — 목록 줄에 ▲▼ 버튼, "정렬 순서 / 배치 순서에 따라 시스템 자동 관리" 상자 삭제

**Interfaces:**
- Produces: `export function moveSibling(depts: Array<{ id: string; parentId: string | null; order: number; name: string }>, id: string, dir: -1 | 1): Array<{ id: string; order: number }>` — 같은 `parentId` 형제를 (order, name) 순으로 줄 세운 뒤 자리를 바꾸고 1부터 다시 번호. **값이 바뀐 부서만** 돌려준다. 맨 위에서 -1, 맨 아래에서 +1이면 `[]`.

- [ ] **Step 1: 실패하는 테스트**

```ts
const D = [
  { id: 'a', parentId: null, order: 1, name: '경영지원팀' },
  { id: 'b', parentId: null, order: 2, name: '개발팀' },
  { id: 'c', parentId: null, order: 2, name: '기획팀' },
  { id: 'x', parentId: 'b', order: 1, name: '개발1파트' },
];
test('moveSibling: 아래로 — 바뀐 것만', () => {
  assert.deepEqual(moveSibling(D, 'a', 1), [{ id: 'b', order: 1 }, { id: 'a', order: 2 }, { id: 'c', order: 3 }]);
});
test('moveSibling: 맨 위에서 위로 → 빈 배열', () => assert.deepEqual(moveSibling(D, 'a', -1), []));
test('moveSibling: 다른 상위 부서는 건드리지 않는다', () =>
  assert.ok(moveSibling(D, 'c', -1).every((r) => r.id !== 'x')));
```

- [ ] **Step 2: 실패 확인** — `npx tsx --test src/domain/department/reorder.test.ts` → FAIL
- [ ] **Step 3: 구현** — 위 시그니처 그대로.
- [ ] **Step 4: 통과 확인** → PASS
- [ ] **Step 5: 화면 연결** — `DepartmentScreen` 목록 각 줄 오른쪽에 `▲`·`▼`(아이콘 버튼, `aria-label="위로"`/`"아래로"`, `canUpdate` 아닐 때 숨김, 클릭은 `stopPropagation`). 누르면 `moveSibling(rows, d.id, dir)` 결과를 `upsert.mutateAsync({...row, order})`로 차례로 저장. 저장 중엔 버튼 비활성. 새 부서 저장 시 order 계산(맨 끝)은 그대로.
- [ ] **Step 6: 확인** — `npx tsc --noEmit -p .` 오류 0
- [ ] **Step 7: 커밋** — `feat(부서 관리): 같은 상위 부서 안에서 순서 바꾸기`

---

### Task 5: 부서 묶음·묶음 요약(순수)

**Files:**
- Create: `src/modules/gw/task/components/teamWeekGroups.ts`
- Test: `src/modules/gw/task/components/teamWeekGroups.test.ts`

**Interfaces:**
- Consumes: `DayCell`, `hasPlannedDay`(dayEntries), `dayStatusOf`(Task 2).
- Produces:
  - `export interface RosterGroup { key: string; label: string; members: User[] }`
  - `export function groupRoster(members: User[], opts: { myDept: string | null; isExecutive: (u: User) => boolean; deptOrder: (dept: string) => number; compare: (a: User, b: User) => number }): RosterGroup[]` — 순서: **내 부서** → **'임원'**(key `__EXEC__`) → 나머지 부서(deptOrder, 같으면 이름) → **'소속 없음'**(key `__NONE__`, dept 빈 값 또는 deptOrder가 `Number.MAX_SAFE_INTEGER`인 부서는 자기 이름 묶음으로 두되 맨 끝 쪽). 임원은 임원 묶음에만. 같은 userId가 다른 dept 값으로 두 번 들어오면(겸직 행) 각 묶음에 하나씩. 묶음 안은 `compare`.
  - `export interface GroupSummary { leave: number; outside: number; unwritten: number }`
  - `export function summarizeGroup(members: User[], cellOf: (userId: string, date: string) => DayCell, today: string, weekDates: string[]): GroupSummary` — leave/outside는 오늘 `dayStatusOf` 기준(outside에 trip 포함), unwritten은 기존 규칙(그 주 마지막 날 ≥ today 이고 월~금 `hasPlannedDay`가 모두 false).

- [ ] **Step 1: 실패하는 테스트** — 단언:
  - 내 부서 '개발팀'이 첫 묶음, 임원 묶음이 둘째, 그다음 deptOrder 순.
  - 겸직(같은 id, dept '기획팀')이 '기획팀' 묶음과 본직 묶음 모두에 있다.
  - dept `''`인 사람은 `__NONE__` 묶음(label '소속 없음')으로 맨 끝.
  - `summarizeGroup`: 오늘 연차 1·출장 1·평일 빈 사람 1 → `{ leave:1, outside:1, unwritten:1 }`; 지난주(`weekDates[6] < today`)면 unwritten 0.
- [ ] **Step 2: 실패 확인** — `npx tsx --test src/modules/gw/task/components/teamWeekGroups.test.ts` → FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** → PASS
- [ ] **Step 5: 커밋** — `feat(업무계획): 주간 표 부서 묶음·요약 계산`

---

### Task 6: C 모양 일정 한 줄(공용) + 월간 표 적용

**Files:**
- Create: `src/modules/gw/task/components/EntryLine.tsx`
- Create: `src/modules/gw/task/components/CellMemo.tsx` (월간 표의 `CellMemo`를 옮김, 내용 변경 없음, `export function CellMemo`)
- Modify: `src/modules/gw/task/components/WorkPlanTeamMonthlyMatrix.tsx` — `EntryChip` 삭제 후 `EntryLine` 사용, `CellMemo` import, `OutsideSpanBar`의 `font-bold shadow-2xs`·`badgeClass` 제거 → 왼쪽 선 + 연한 글(EntryLine과 같은 색)

**Interfaces:**
- Consumes: `lineToneOf`(Task 2), `chipLook`, `timeOf`, `timeRangeOf`.
- Produces: `export function EntryLine({ entry, onOpen, className }: { entry: DayEntry; onOpen?: (entry: DayEntry) => void; className?: string }): JSX.Element` — `<button>`(onOpen 없거나 결재 휴가면 `<div>`), 내용 `시각(text-[10.5px] text-ink3 tabular-nums w-[2.8em])` + 제목(truncate, 11.5px, font-normal). 제목은 `chipLook().label`에서 `[회의] `·`[휴가] `·`[외근] ` 같은 대괄호 접두를 뺀 글(외근·출장은 `outsideChipLabel` 결과 그대로 — 예 "외근 · 고객사"). 왼쪽 2px 선 색은 Global Constraints 값(`LINE_TONE_CLASS: Record<LineTone, string>`도 export). 대기·반려·결재 완료·반복 표시 아이콘은 기존 EntryChip과 같이 뒤에 작게(opacity-40). `title`은 `hint (timeRange)`. 클릭은 `stopPropagation` 후 `onOpen`.

- [ ] **Step 1: 구현** — 위 시그니처.
- [ ] **Step 2: 월간 표 교체** — `EntryChip`→`EntryLine`, `CellMemo` 이동, `OutsideSpanBar` 스타일만 변경(위치 계산은 그대로).
- [ ] **Step 3: 확인** — `npx tsc --noEmit -p .` 오류 0, `npx tsx --test src/modules/gw/task/components/*.test.ts` PASS
- [ ] **Step 4: 눈으로 확인** — dev 서버(run-app 스킬)로 업무계획 → 월간 캡처: 칩에 굵은 글·그림자·색 바탕이 없고 왼쪽 선만.
- [ ] **Step 5: 커밋** — `refactor(업무계획): 일정 칩을 C 모양 한 줄(EntryLine)로 — 월간 표 적용`

---

### Task 7: 새 주간 표 `WorkPlanTeamWeekTable`

**Files:**
- Create: `src/modules/gw/task/components/WorkPlanTeamWeekTable.tsx`
- Modify: `src/modules/gw/task/WorkPlanScreen.tsx` — `view === 'teamWeek'`이면 새 표, `'team'`이면 기존 월간 표

**Interfaces:**
- Consumes: Task 5 `groupRoster`/`summarizeGroup`, Task 6 `EntryLine`, `lineToneOf`, `canMoveEntry`, `useRosterOrder().isExecutive`, `useOrgTree` 부서 순서(useRosterOrder 내부 `deptIndex`와 같은 값 — `useRosterOrder`가 `deptOrder`도 함께 돌려주도록 반환에 `deptOrder: (dept: string) => number` 추가).
- Produces:

```ts
interface WorkPlanTeamWeekTableProps {
  actor: User;
  todayStr: string;
  weekStart: string;                 // 월요일
  onWeekChange: (monday: string) => void;
  members: User[];                   // scopedMembers(겸직 행 포함)
  cellOf: (userId: string, date: string) => DayCell;
  workPlans: WorkPlan[];             // 중요 일정 줄
  viewSwitch: ReactNode;
  filters: ReactNode;                // 부서 필터·검색
  forceOpen: boolean;                // 부서 필터 또는 검색어가 있으면 true
  onOpenConfig?: () => void;         // 태그 관리
  onOpenCompanySchedule?: (date: string, text?: string, planId?: string) => void;
  onOpenCell: (member: User, date: string, anchor: HTMLElement) => void;
  onOpenPerson: (member: User) => void;
  onMoveItem?: (item: WorkPlanItem, date: string) => void;
  selected: { userId: string; date: string } | null;  // 상세 창이 열린 칸(파란 2px 테두리)
}
export function WorkPlanTeamWeekTable(props: WorkPlanTeamWeekTableProps): JSX.Element
```

화면 규칙(spec 4-1 그대로):
- 상단 바: `viewSwitch`, ‹ 이번 주 ›, 제목 `M월 N주차 M/D ~ M/D`, `filters`, 태그 관리. 둘째 줄: 종류 거르기 `업무·회의·외근·출장·휴가`(LineTone + 'trip'은 외근·출장 하나로 → 4개: 업무/회의/외근·출장/휴가, 꺼진 것 흐리게+취소선) · 오른쪽 `모두 펼치기` `모두 접기`.
- 열: 이름 118px, 월~금 같은 너비, `토·일` 54px(토·일 항목을 한 칸에 줄 글로). 날짜 머리 `sticky top` (상단 바 아래), 오늘 열 `bg-sky-50/60` + 머리 "· 오늘", 공휴일 이름은 머리에 작게.
- 중요 일정 줄(기존 동작 그대로, 스타일만 조용히).
- 묶음 줄: `▾/▸ {label} {n}명` + `휴가 n`(노랑 글) `외근·출장 n`(하늘 글) `미작성 n`(주황 글), 0은 숨김. 처음엔 `actor.dept` 묶음만 펼침, `forceOpen`이면 전부.
- 사람 줄: 사이 줄 `border-[#e4e8ee]`, 짝수째 `bg-[#f8f9fb]`, 이름(보통 굵기)/직급 두 줄, 내 줄 `나`. 생일 표시(`BirthdayMark`) 유지. '미작성'이면 월~금 5칸을 합쳐 "이번 주 계획 없음"(옅은 회색).
- 칸: `EntryLine` 최대 3줄, 넘치면 `+N건 더`(그 칸만 펼침/`접기`). 메모가 있으면 마지막 줄에 메모 아이콘 + 첫 줄 글(옅은 회색, truncate). 여러 날 외근·출장은 날마다 한 줄.
- 마우스: 그 사람 **줄만** `bg-sky-50` + 이름 칸 `shadow-[inset_3px_0_0] shadow-teal` + 이름 파란 굵게, 올린 칸 옅은 테두리, 마우스 옆 안내 `{이름} {직급} · {D}일 ({요일}) · {n}건`(없으면 `일정 없음`) — `selected`가 있으면 안내 숨김. **열은 칠하지 않는다.**
- 내 줄 빈 칸: 마우스 올리면 옅게 `+ 일정 적기`.
- 칸 누르기 → `onOpenCell(member, date, td)`, 이름 누르기 → `onOpenPerson(member)`, 내 일반 업무 끌어 옮기기(기존과 같은 `draggable`·`onMoveItem`).
- 표 아래 안내 글 없음.

- [ ] **Step 1: 컴포넌트 작성**
- [ ] **Step 2: 화면 연결** — `WorkPlanScreen`에서 `teamWeek`일 때 렌더, 상태 `cellPopover: { member: User; date: string; anchor: HTMLElement } | null`, `personDrawer: User | null` 추가(Task 8·9에서 씀). `forceOpen = deptFilter !== 'all' || searchKeyword.trim() !== ''`.
- [ ] **Step 3: 확인** — `npx tsc --noEmit -p .` 오류 0
- [ ] **Step 4: 눈으로 확인** — 주간 캡처: 내 부서만 펼침, 줄 글, 주말 한 칸, 마우스 올림 시 줄만 강조(열 칠 없음).
- [ ] **Step 5: 커밋** — `feat(업무계획): 주간 보기 — 부서별로 접히는 줄 글 표`

---

### Task 8: 칸 옆 상세 창 `WorkPlanCellPopover` + 한 주 서랍

**Files:**
- Create: `src/modules/gw/task/components/WorkPlanCellPopover.tsx`
- Create: `src/modules/gw/task/components/WorkPlanPersonWeekDrawer.tsx`
- Create: `src/features/chat/openDirectChat.ts`
- Modify: `src/app/shell/AppShell.tsx` — 창 이벤트 `workfit-open-dock-chat`(detail `{ roomId }`)를 받아 `setDockOpen('msg'); requestOpenChatRoom(roomId)`
- Modify: `src/modules/gw/task/WorkPlanScreen.tsx` — 연결

**Interfaces:**
- Consumes: Task 2 `busyRangeOf`, `dayStatusOf`, `nowLineOf`, `freeSlotsOfDay`; Task 6 `EntryLine`, `CellMemo`, `LINE_TONE_CLASS`.
- Produces:

```ts
// openDirectChat.ts
export async function openDirectChat(input: { me: User; other: User; text?: string; createRoom: (i: CreateRoomInput) => Promise<{ id: string }> }): Promise<void>
// 방 만들기(이미 있으면 그 방) → text가 있으면 saveChatDraft(me.id, room.id, 한 문단 RichNode) → window.dispatchEvent(new CustomEvent('workfit-open-dock-chat', { detail: { roomId } }))

interface WorkPlanCellPopoverProps {
  actor: User;
  member: User;
  date: string;
  anchor: HTMLElement;
  today: string;
  nowMinute: number;
  cellOf: (userId: string, date: string) => DayCell;
  weekDates: string[];                          // ‹ › 이동 범위(월~일)
  onDateChange: (date: string, anchor: HTMLElement | null) => void;
  onClose: () => void;
  onOpenEntry: (entry: DayEntry) => void;       // 수정/보기 → 기존 routeEntry
  onCreate?: (date: string, member: User, opts?: { range?: MinuteRange; kind?: 'MEETING'; attendeeIds?: string[] }) => void;
  onRemoveItem?: (item: WorkPlanItem) => void;  // 내 일반 업무 삭제(되돌리기는 화면이 처리)
  onSaveMemo?: (date: string, memoPlan: MemoPlanRef | null, text: string) => Promise<void>;
  onOpenWeek: (member: User) => void;
  onMessage: (member: User, text?: string) => void;
}
export function WorkPlanCellPopover(props: WorkPlanCellPopoverProps): JSX.Element  // createPortal(document.body)

export function WorkPlanPersonWeekDrawer(props: { member: User; weekDates: string[]; today: string; cellOf: ...; onClose: () => void; onOpenEntry: (entry: DayEntry) => void }): JSX.Element
```

화면 규칙(spec 4-2):
- 위치: `position:absolute`, `left/top = anchor.getBoundingClientRect() + window.scrollX/Y`. 오른쪽(rect.right+8)에 자리가 없으면 왼쪽(rect.left-360-8), 아래가 넘치면 화면 안으로 올림. 창 크기 바뀌면 다시 계산. **스크롤 이벤트로 닫지 않는다.** 바깥 `mousedown`·Esc·✕로 닫힘. 폭 360px, 둥근 14px, 그림자.
- 머리: 이름 끝 두 글자 원, 이름·직급(내 칸이면 "내 일정", 직급 없음), `dayStatusOf` 표시(사무실 회색 / 휴가 노랑 / 외근·출장 하늘), 아랫줄 `부서 · M월 D일 (요일)[ 오늘] · n건`(내 칸은 부서 생략).
- 남의 칸 + 오늘: `nowLineOf` 한 줄(tone별 바탕: free 옅은 파랑, busy 옅은 보라, outside 옅은 하늘, away 옅은 노랑).
- 하루 막대 9~18시(`busyRangeOf`로, 색은 LINE_TONE), 아래 `9시 12시 15시 18시`.
- 목록: 왼쪽 `시작<br>~ 끝`(종일/오전/오후/미정은 그 글), 오른쪽 제목 / `종류 · 태그 · 참석 n명` / 메모 상자. 메모(칸 메모)가 있으면 목록 끝에 `CellMemo`(내 칸이면 고칠 수 있게 `onSaveMemo`).
- **내 칸**: 항목에 마우스 올리면 `수정`(→ `onOpenEntry`), 내 일반 업무만 `삭제`(→ `onRemoveItem`). 휴가는 버튼 대신 `휴가는 휴가원으로만 바꿀 수 있어요`. 목록 아래 점선 `+ 이날 일정 추가`(빈 날 `+ 이날 일정 적기`, 위에 `이날 적은 일정이 없어요.`) → `onCreate(date, actor)`. 바닥 `‹ 전날` `다음날 ›` … `내 한 주`.
- **남의 칸**: 고치기 없음. `freeSlotsOfDay`가 비어 있지 않으면 `비어 있는 시간 — 누르면 이 시간으로 회의를 잡아요` + 버튼 `HH:mm–HH:mm` → `onCreate(date, actor, { kind:'MEETING', attendeeIds:[member.id], range:{ start, end: min(start+60, slot.end) } })`. 업무·회의 항목에 마우스 올리면 `이 일정 묻기` → `onMessage(member, \`${M}/${D} ${title} 일정 관련해서 여쭤볼게요.\`)`. 바닥 `‹` `›` … `한 주 보기` `회의 잡기`(빈 시간 첫 칸 또는 시간 없이) `메시지`(파란 채움).
- 서랍: 오른쪽 360px, 그 사람의 월~일, 날마다 `M월 D일 (요일)` + `EntryLine` 목록, 빈 날 `일정 없음`, 미작성 주면 `이번 주 계획을 아직 적지 않았습니다.`

- [ ] **Step 1: `openDirectChat.ts` + AppShell 이벤트** — `ProfileCard.startDirect`와 같은 `createRoom` 입력(`name: \`${me.name}, ${other.name}\``, `type:'direct'`, `members:[me.id, other.id]`, `createdBy: me.id`).
- [ ] **Step 2: 상세 창·서랍 작성**
- [ ] **Step 3: 화면 연결** — `WorkPlanScreen`: `nowMinute`은 1분마다 갱신되는 state, 칸 누르기 → `setCellPopover`, `onRemoveItem` = 기존 일반 업무 삭제 mutation + 알림 `"{제목}" 일정을 지웠어요` + **되돌리기**(같은 초안으로 다시 만들기, 4초). 알림을 `{ text: string; undo?: () => void } | null`로 바꾸고 토스트에 `되돌리기` 버튼(pointer-events 켬). 기존 `setNotice(문자열)` 호출은 `{ text }`로 감싸는 도우미 `notify(text)`로 교체.
- [ ] **Step 4: 확인** — `npx tsc --noEmit -p .` 오류 0
- [ ] **Step 5: 눈으로 확인** — 내 칸·남의 오늘 칸 눌러 캡처, 스크롤해도 창이 칸을 따라가는지, 빈 시간 → 일정 창이 회의·참석자 채워 열리는지, 메시지 → 메신저 도크가 그 방으로 열리고 입력창에 글이 있는지.
- [ ] **Step 6: 커밋** — `feat(업무계획): 칸 옆 그날 상세 — 내 일정 고치기, 남의 일정 지금·빈 시간·회의·메시지`

---

### Task 9: 일정 창 — 종류 막대·태그 메뉴·반복

**Files:**
- Modify: `src/modules/gw/task/event/WorkPlanEventModal.tsx` (`KindToolbar`)
- Modify: `src/modules/gw/task/event/eventShared.ts` (`FIXED_KINDS` 순서 유지, 업무 버튼을 맨 앞에 그리도록 툴바에서 처리)

**Interfaces:**
- Consumes: 기존 `form.setKind`, `form.set('tagId')`, `form.routineRule/setRoutineRule`, `defaultRoutineRule`, `ROUTINE_FREQ_LABEL`, `selectableGeneralTags`, `ETC_TAG_ID`.
- Produces: 화면만 바뀜.

규칙(spec 4-3):
- 세그먼트 `[업무 ▾ | 회의 | 외근 | 출장]`, 각 앞에 3×13px 색 막대(업무 `#d6dbe3`, 회의 `#b6a2f2`, 외근·출장 `#8cc8ee`). 기존 `기타` 버튼 삭제 → 태그 메뉴 맨 끝 항목 `기타`(`ETC_TAG_ID`).
- `업무`가 이미 골라진 상태에서 다시 누르면 태그 메뉴(색 점 + 이름 + ✓). 다른 종류에서 누르면 업무로만 바꾼다. 태그를 고르면 버튼 글이 `● {태그} ▾`, 기본 태그면 `업무 ▾`.
- `리마인드` 버튼 삭제. `루틴` 버튼 → 업무이고 새 일정일 때만 `반복 [반복 안 함 | 매일 | 평일마다 | 매주 | 매월]` select: 고르면 `setRoutineRule({ ...defaultRoutineRule(date), freq })`, `반복 안 함`이면 `null`. 기존 `RoutineFields`(끝 날짜·횟수 줄)는 그대로 아래에 나온다.

- [ ] **Step 1: 구현**
- [ ] **Step 2: 확인** — `npx tsc --noEmit -p .`, `npx tsx --test src/modules/gw/task/event/*.test.ts` PASS
- [ ] **Step 3: 눈으로 확인** — 새 일정 창 캡처: 업무 맨 앞, 다시 누르면 태그 메뉴, 칩 줄 없음, 리마인드 없음.
- [ ] **Step 4: 커밋** — `feat(업무계획 일정 창): 업무 먼저·태그는 메뉴·반복 선택`

---

### Task 10: 일정 창 — 빠른 입력·겹침 안내·미리보기·시간표 보강·바닥

**Files:**
- Create: `src/modules/gw/task/event/EventAssist.tsx`
- Modify: `src/modules/gw/task/event/EventFields.tsx`, `TimeGrid.tsx`, `WorkPlanEventModal.tsx`, `RoomPicker.tsx`
- Modify: `src/modules/gw/task/WorkPlanScreen.tsx` — 새 일정 기본 시각·최근 제목·이어서 적기

**Interfaces:**
- Consumes: Task 1 `firstFreeStart`, Task 2 `busyRangeOf`, `recentItemTitles`, Task 6 `LINE_TONE_CLASS`.
- Produces:
  - `WorkPlanEventModal` 새 props: `recentTitles?: string[]`, `nowMinute?: number`, `onSavedAndNext?: (date: string) => void`.
  - `export function EventAssist({ form, blocks, ownerName }: { form: EventForm; blocks: TimeGridBlock[]; ownerName: string }): JSX.Element` — 안내 상자 + "팀원 화면에는 이렇게 보여요" 미리보기.
  - `TimeGrid` 새 props: `nowMinute?: number`(오늘이면 빨간 선), `lunch?: boolean`(12~13시 빗금), `fits?: number[]` + `onPickFit?: (start: number) => void`(아래 `참석자 모두 가능한 시간` 버튼, 최대 4개).
  - `WorkPlanScreen.handleCreate(date, member, opts?)` — `opts.range`가 없으면 `firstFreeStart([내 그날 busy], 60, { notBefore: 오늘이면 nowMinute })`로 `{start, start+60}`(null이면 기존 기본값). `opts.kind/attendeeIds`는 `EventTarget` create에 `initialKind`·`initialAttendeeIds`로 넘긴다(`eventFormMapping`의 create 초기값에 반영, 테스트 `eventFormMapping.test.ts`에 한 줄 추가: `initialKind:'MEETING', initialAttendeeIds:['U2']` → state.kind `'MEETING'`, attendeeIds `['U2']`).

규칙(spec 4-3):
- 제목 아래(업무만) `최근` + `recentTitles` 버튼 → 제목 채움.
- 참석자·동행자 검색 결과 줄 끝에 고른 시간에 바쁘면 `이 시간 바쁨`(`cellOf(user.id, date)`의 `busyRangeOf`와 겹침).
- 안내 상자(왼쪽 맨 아래 위): 내 일정과 겹침 → 주황 `내 일정 「{제목}」({HH:mm})와 시간이 겹쳐요. 그래도 저장할 수 있어요.` / 회의 참석자 바쁨 → 주황 `{이름들} 님이 이 시간에 다른 일정이 있어요. 오른쪽에서 모두 가능한 시간을 골라 보세요.` / 참석자 모두 빔 → 초록 `참석자 모두 이 시간에 비어 있어요.`
- 미리보기: 점선 위 `팀원 화면에는 이렇게 보여요` + EntryLine 모양 한 줄(시각 + 제목, 외근·출장은 `외근 · {행선지}`).
- 시간표: 내 일정 회색, 참석자 바쁨 보라 반투명(이미 `entriesToBlocks`가 이름 붙여 줌 — tone은 그대로), 점심 빗금, 오늘 빨간 선, 겹치면 고른 칸 주황(`bg-amber-500`), 아래 모두 가능한 시간(회의+참석자 있을 때, `firstFreeStart`를 30분씩 반복해 최대 4개, 지금 이후).
- 회의실: `RoomPicker`에서 비어 있지 않은 방 이름 뒤에 ` · 사용 중`.
- 바닥: 새 일정이면 왼쪽 `☐ 저장하고 이어서 적기`(체크 시 저장 후 `onSavedAndNext(date)` → 화면이 같은 날짜로 새 창), 오른쪽 `Ctrl+Enter 저장`(작은 회색 글), `취소`, `저장` — 참석자 있는 새 회의면 `저장하고 초대 보내기`. 창 어디서든 Ctrl/⌘+Enter = 저장.
- 수정 창의 삭제는 지금처럼 두 번 확인(되돌리기는 상세 창의 일반 업무 삭제에만).

- [ ] **Step 1: 매핑 테스트 추가** — `eventFormMapping.test.ts`에 위 한 줄. `npx tsx --test src/modules/gw/task/event/eventFormMapping.test.ts` → FAIL
- [ ] **Step 2: 매핑 구현** → PASS
- [ ] **Step 3: EventAssist·TimeGrid·EventFields·RoomPicker·모달 바닥 구현**
- [ ] **Step 4: 화면 연결** — `recentTitles = recentItemTitles(actor의 monthDates 칸 항목, 날짜 내림차순)`, `handleCreate` 기본 시각, `onSavedAndNext`.
- [ ] **Step 5: 확인** — `npx tsc --noEmit -p .`, 전체 테스트 PASS
- [ ] **Step 6: 눈으로 확인** — 새 업무(최근 버튼·기본 시각), 회의(참석자 추가 → 보라 겹침·모두 가능 버튼·초록/주황 안내), 외근(미리보기 `외근 · 고객사`), 겹침 주황 캡처.
- [ ] **Step 7: 커밋** — `feat(업무계획 일정 창): 최근 제목·첫 빈 시각·겹침 안내·미리보기·모두 가능한 시간·이어서 적기`

---

### Task 11: 마무리 검증

- [ ] **Step 1:** `npx tsc --noEmit -p .` → 오류 0
- [ ] **Step 2:** `npx tsx --test $(git ls-files '*.test.ts' '*.test.tsx' '*.test.mjs')` → 실패 0
- [ ] **Step 3:** `npm run build` → 성공
- [ ] **Step 4:** run-app으로 주간·월간·내 주간·부서 관리·근태 인원 목록 캡처를 눈으로 확인(근태·식권 목록 순서가 부서 순서 → 직책 → 직급 → 이름인지).
- [ ] **Step 5:** 시안과 비교해 spec "실패로 볼 것" 네 가지가 없는지 확인 후 커밋 정리. push는 사용자 지시 후.
