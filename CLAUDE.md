# WorkFit Office 프로젝트 지침 및 에이전트 협업 가이드

본 문서는 Claude Code 및 Gemini(Antigravity)를 포함한 AI 어시스턴트가 준수해야 하는 필수 프로젝트 규칙입니다.

---

## 1. 🤖 멀티 에이전트(Claude + Gemini) 협업 및 충돌 방지 규칙
- **동시 작업 인지**: 이 프로젝트는 Gemini(Antigravity)와 Claude Code가 병행하여 작업합니다.
- **수정 전 최신 파일 확인**: 파일을 편집하기 전에 항상 파일 내용을 먼저 확인하여, 상대 에이전트가 최근에 수정한 내용이 덮어쓰여지거나 유실되지 않도록 보존합니다.
- **무단 롤백/리셋 금지**: `git reset --hard`, `git checkout -- .`, `git restore .` 등의 파괴적인 리셋 명령은 사용자의 명시적 지시 없이 절대 단독으로 실행하지 않습니다.
- **검증 필수**: 코드 변경 후 `npm run build` 또는 `npx tsc --noEmit` 등을 통해 타입/빌드 에러를 검증합니다.

---

## 2. 🛡️ [Strict Rule] 데이터베이스 불변성 및 무결성 보장
- 실제 데이터베이스(`appwrite`, `garage s3`)에 존재하는 기존 결재 문서(`approvalDocs`) 및 서식 마스터(`approvalForms`) 데이터를 **절대로 변경, 삭제, 또는 덮어쓰지 않고 항상 읽기 전용(Read-Only)**으로 취급해야 합니다.
- 신규 데이터는 기존 데이터와 완전히 격리하여 독립적으로 생성 및 관리해야 합니다.
- 이때 중복 데이터(같은 값을 의미하나 이름이 다른 경우 등)가 발생하지 않도록 주의합니다.
- 상세 규칙: [.agents/rules/rule-readonly.md](.agents/rules/rule-readonly.md)

---

## 3. 🚀 [Strict Rule] 원격 저장소 Push 전 동기화 절차
원격(`origin`=GitHub, `gitlab`=사내)에 push하기 전에 반드시 아래 절차를 준수합니다 (`main` push는 Vercel 운영 배포로 이어짐).

1. `git fetch origin && git fetch gitlab`
2. `git rev-list --left-right --count HEAD...origin/main` 으로 앞뒤 상태 확인
3. 뒤처졌으면 `git merge origin/main` (충돌 시 양쪽 의도를 모두 살려 해소)
4. **병합 후 재검증**: 타입체크 → 테스트 → 빌드 수행
5. 검증 완료 후 `git push`
- 상세 규칙: [.agents/rules/rule-git-sync.md](.agents/rules/rule-git-sync.md)

---

## 4. 📋 [Rule] 일일 업무 보고서 생성 ([업무보고])
사용자가 프롬프트에 `[업무보고]` 단어를 포함하거나 요청하는 경우, 해당 일자의 Git 커밋 이력(`git log`)을 수집 및 분류하여 지정된 표 양식(대제목 `# 일 일 업 무 보 고`, 기본 정보 표, 업무 수행 내역 표)에 맞추어 마크다운으로 작성합니다.
- 상세 규칙: [.agents/rules/rule-work-report.md](.agents/rules/rule-work-report.md)

---

## 5. 📌 현재 작업 분담 (Gemini ↔ Claude)
- **Gemini 담당**: 메신저 전체 (모바일 사진 확대 및 스크롤 시작 위치 보정 완료)
- **Claude 담당**: 
  1. 업무계획 **보기 권한을 전사로 통일**
  2. 결재서식 **텍스트 필드 여러 줄 입력 & 기안 작성 중 텍스트 입력 시 스크롤 강제이동 오류 수정**
  3. 영업관리 → 사업관리 명칭 변경 및 메뉴 개편
  4. 7단계 정리 (죽은 코드, 결재 상세 가로 잘림 등)
  5. 캘린더 ↔ 업무계획 연동 고도화
- **보류 (원천 배제)**: 패치노트 팝업 (추후 구현), PWA 전자결재 작성 기능 (무기한 연기)
- 상세 역할분담표: [.agents/rules/rule-work-split.md](.agents/rules/rule-work-split.md)
