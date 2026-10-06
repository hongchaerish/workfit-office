---
trigger: always_on
---

# [Strict Rule: Gemini & Claude 멀티 에이전트 협업 및 충돌 방지]

이 프로젝트는 **Gemini (Antigravity)**와 **Claude (Claude Code)** 두 AI 에이전트가 함께 작업하는 프로젝트입니다. 작업 시 다음 사항을 항상 최우선으로 준수해야 합니다.

1. **파일 무단 덮어쓰기 및 롤백 금지**
   - 다른 에이전트가 작성/수정한 코드를 확인 없이 덮어쓰거나 임의로 삭제하지 않는다.
   - 전체 리셋(`git reset --hard`, `git checkout -- .`, `git restore .`)과 같은 파괴적 명령어는 사용자의 명시적 요청이 없는 한 절대 단독으로 실행하지 않는다.

2. **파일 수정 전 최신 상태 확인**
   - 코드를 수정하기 전에 파일의 현재 내용을 항상 읽고(View), 다른 에이전트의 최근 변경 사항이 있는지 확인 후 그 위에 변경을 적용한다.

3. **작업 단위 분리 및 안전한 변경 관리**
   - 가능한 한 작업 영역(모듈/컴포넌트/기능)을 명확히 분리하여 작업한다.
   - 기능 구현 또는 수정이 완료되면 즉시 빌드 및 타입 체크(`npm run build` or `npx tsc --noEmit`)로 검증한다.

4. **공통 필수 규칙 상시 준수**
   - **DB 불변성/무결성**: `approvalDocs`, `approvalForms` 등 기존 DB 데이터는 절대 변경/삭제하지 않고 Read-Only 취급한다. ([rule-readonly.md](file:///c:/WorkFit/GW/00.workfit-gw/workfit-office/.agents/rules/rule-readonly.md))
   - **원격 동기화 필수**: push 전 반드시 `git fetch` 후 `origin/main` 병합 및 검증 단계를 거친다. ([rule-git-sync.md](file:///c:/WorkFit/GW/00.workfit-gw/workfit-office/.agents/rules/rule-git-sync.md))
   - **업무보고 형식**: `[업무보고]` 요청 시 지정된 마크다운 표 양식으로 일일 보고서를 작성한다. ([rule-work-report.md](file:///c:/WorkFit/GW/00.workfit-gw/workfit-office/.agents/rules/rule-work-report.md))
