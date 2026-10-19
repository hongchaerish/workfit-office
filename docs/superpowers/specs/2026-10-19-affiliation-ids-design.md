# 사람 소속(부서·직급·직책) ID 기준 전환 설계

- 작성일: 2026-10-19
- 범위: 인명관리(`employeeProfiles`)·겸직 정보(`departmentMembers`)·사람 목록 저장소·기준정보 화면·서버 함수 2곳
- 선행: `8c0aa57`(이름 변경 연쇄 반영·삭제 차단) — 이 설계로 연쇄 반영 코드는 제거된다
- 후행: 업무계획 항목형 개편(`2026-10-19-workplan-items-design.md`)은 이 작업 뒤에 진행

## 1. 배경
- 사람의 현재 소속이 **이름 문자열**로 세 군데에 있다: 계정(`users.dept/position/jobTitle`), 인명관리(`employeeProfiles.dept/position/jobTitle`), 겸직 정보(`departmentMembers.deptName/jobTitle`).
- 기준정보에서 이름을 바꾸면 사본을 일일이 고쳐야 하고, 하나라도 빠지면 화면마다 값이 어긋난다(조직도에 옛 이름 부서가 생긴 사례).
- 사람 목록 저장소(`userRepo.listIncludingTestAccounts`)는 이미 인명관리 값을 계정 위에 덮어 돌려준다. 화면 약 100곳은 이 통로로 `u.dept/position/jobTitle`을 읽는다.

## 2. 결정 사항 (사용자 확정)
- 소속의 단일 기준 = **인명관리**. 계정(`users`)은 로그인·권한만.
- 방식 = **A안(읽을 때 합치기)**: 인명관리에 ID 저장, 저장소가 읽을 때 기준정보에서 이름을 채운다. 화면 대부분은 고치지 않는다.
- 겸직은 겸직 정보에 부서 ID(기존)·직책 ID(신규)로. 겸직 정보의 본직 행은 지우지 않고 읽지 않는다.
- 화면에 ID·내부 코드·설명성 안내문을 보이지 않는다.

## 3. 저장
| 컬렉션 | 새 칸 | 기준 여부 |
|---|---|---|
| `employeeProfiles` | `deptId`, `positionId`, `jobTitleId` (모두 nullable 문자열) | **본직의 유일한 기준** |
| `departmentMembers` | `jobTitleId` (nullable) | 겸직(`isPrimary=false`)의 기준. 부서는 기존 `deptId` |

- 기존 이름 칸(`employeeProfiles.dept/position/jobTitle`, `users.dept/position/jobTitle`, `departmentMembers.deptName/jobTitle`)은 **삭제하지 않는다. 새 코드는 읽지 않는다.**
- 저장할 때 이름 칸에는 그 순간 ID로 찾은 이름을 함께 써 둔다(읽지 않는 사본). Appwrite 필수 칸 제약을 피하고, 배포 직후 남아 있는 예전 화면·도구가 크게 어긋나지 않게 하기 위함.
- `users`의 이름 칸은 더 이상 일부러 쓰지 않는다(인명관리 → 계정 복사 코드 제거).

## 4. 읽기 — `resolveAffiliation` (순수 함수, `src/domain/employeeProfile/affiliation.ts`)
입력: 인명관리 1건(ID들 + 이름·계정 정보), 기준정보(부서·직급·직책 목록), 테스트 계정 여부. 출력: `{ deptId, dept, positionId, position, jobTitleId, jobTitle }`.

| 상황 | 결과 |
|---|---|
| ID가 있고 기준정보에 있음 | 기준정보의 현재 이름 |
| 부서 ID 없음/못 찾음 | 테스트 계정이면 `테스트`, 아니면 `미지정` |
| 직급 ID 없음/못 찾음 | `사원` |
| 직책 ID 없음/못 찾음 | `''` |

- `employeeProfileRepo.listIncludingTestAccounts()`가 기준정보 3종을 읽어 각 프로필의 `dept/position/jobTitle`을 이 함수 결과로 채워 돌려준다. → 인명관리·조직도 화면 코드 변경 없음.
- `userRepo.listIncludingTestAccounts()`는 지금처럼 프로필 값을 덮는다. 프로필이 없는 계정(발령 전)은 `미지정`/`사원`/`''`(계정 이름 칸은 읽지 않음).
- `departmentMemberRepo` 읽기도 `deptName`/`jobTitle`을 ID로 찾은 현재 이름으로 채운다.

## 5. 쓰기
- **인명관리 발령·편집**(`EmployeeScreen`, `useUpsertEmployeeProfile`): 부서·직급·직책을 ID로 저장. 화면의 선택 목록은 기준정보에서 오며, 고른 항목의 ID를 넘긴다. 인명관리 → 계정 소속 복사 제거(계정 상태·업무 이메일 동기화는 유지).
- **겸직 등록**: `deptId`(기존) + `jobTitleId`.
- **부서장 지정·해제**(`DepartmentScreen`): `setPersonJobTitle` → 인명관리 `jobTitleId` 갱신(+본직 겸직정보 행이 있으면 그 `jobTitleId`도).
- **이름 변경 연쇄 반영 제거**: `cascadeDepartmentRename`·`cascadePositionRename`·`cascadeJobTitleRename`과 화면 호출 삭제. 이름은 기준정보 한 곳뿐.
- **삭제 차단 유지**: `departmentDeleteBlocker`·`positionDeleteBlocker`·`jobTitleDeleteBlocker`를 ID 기준(인명관리 `deptId/positionId/jobTitleId`, 겸직 `deptId`)으로 판단.
- 사용자관리 새 계정: 발령 전까지 `미지정`(현행과 동일).

## 6. 서버
- **전자설문 서버**(`server/survey/dispatch.ts`, `respond.ts`, 운영 미반영): 사람 부서 판단을 인명관리 `deptId`로. 공용 `resolveAffiliation` 사용.
- **출퇴근 연동 함수**(`appwrite/functions/caps-ingest`, 운영 중):
  - 요청자 정보: `users` 대신 인명관리 + 기준정보로 부서·직급·직책 판단.
  - 부서장 열람 범위: `users`를 부서명으로 검색하던 것(`Query.equal('dept', …)`)을 인명관리 `deptId` 검색으로.
  - 권한 매핑(`roleMappings`) DEPT/POSITION 매칭: 대상 값이 ID 또는 이름인 경우 모두 맞춘다(기존 데이터 호환).
  - 다시 배포 필요.

## 7. 기존 데이터 채우기
- 스크립트 `scripts/backfill-affiliation-ids.ts` (`--prod`, `--apply` 없으면 확인만):
  1. `employeeProfiles`: 프로필의 현재 이름(없으면 계정 이름)으로 부서·직급·직책 ID를 찾아 **새 칸에만** 쓴다. 이미 ID가 있으면 건드리지 않는다.
  2. `departmentMembers`: 직책 이름으로 `jobTitleId`를 채운다.
  3. 찾지 못한 이름(예: 테스트 계정의 `테스트` 부서)은 목록으로 보고하고 비워 둔다(읽을 때 규칙으로 처리).
- 칸 추가 스크립트(기존 `scripts/appwrite-schema.ts` 방식)로 개발·운영 DB에 새 칸 생성.
- 다른 칸·다른 컬렉션은 수정·삭제하지 않는다. 결재 데이터는 읽지도 않는다.

## 8. 배포 순서
1. 개발 DB: 칸 추가 → 채우기(확인만 → 적용) → 화면 확인
2. 운영 DB: 칸 추가 → 채우기(확인만 → 적용) — 예전 코드는 새 칸을 무시하므로 안전
3. 웹 배포 + 출퇴근 연동 함수 재배포 (사용자 지시 후)
- 예전 화면이 열려 있어도 새 칸을 지우지 않는다(Appwrite는 보낸 칸만 갱신).

## 9. 테스트·확인
- 단위: `affiliation.test.ts` — ID→이름, 없음/못 찾음 규칙, 테스트 계정, 기준정보 이름 변경 즉시 반영.
- 저장소(메모리): 프로필 읽기 시 이름 채움, 발령 저장 시 ID 저장, 삭제 차단 ID 기준, 부서장 직책 저장.
- 서버: 설문 서버 기존 테스트 통과 + 부서 판단 테스트. caps-ingest는 범위 판단 함수를 순수 함수로 떼어 테스트.
- 개발 DB 화면: 부서 이름 변경 → 조직도·인명관리·메신저·업무계획 즉시 반영 후 원복, 인명관리 발령·편집·겸직, 부서장 지정.
- `npx tsc --noEmit`, 전체 테스트, `npm run build`.

## 10. 범위 밖
- 계정 이름 칸 삭제(DB 칸 제거)
- 결재 문서에 남은 작성 당시 부서명(기록이므로 유지)
- 업무계획 항목형 개편(후행 작업)
