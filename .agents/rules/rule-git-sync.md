---
trigger: always_on
---

[Strict Rule: push 전 원격 동기화] 원격(`origin`=GitHub, `gitlab`=사내)에 push하기 전에 **반드시 `git fetch` 후 원격 대비 상태를 확인**하고, 뒤처져 있으면 병합·검증까지 마친 뒤에 push한다. 이 저장소는 여러 담당자가 `main`에 동시에 올리며(2026-08-25 실측: 작업 중 GitHub `main`에 다른 담당자 9커밋이 먼저 올라와 push가 거부됨), 무작정 push하면 거부되거나 남의 작업 위에 잘못 얹힌다.

절차는 다음 순서를 지킨다.

1. `git fetch origin && git fetch gitlab`
2. `git rev-list --left-right --count HEAD...origin/main` 으로 앞뒤를 확인
3. 뒤처졌으면 `git merge origin/main` — 충돌은 양쪽 의도를 모두 살려 해소한다(한쪽을 통째로 버리지 않는다)
4. **병합 후 다시 검증**: 타입체크 → 테스트 → 빌드. 병합은 각각 통과한 두 변경을 합치면서 깨질 수 있다
5. 그 다음에 push

**운영 배포는 `upstream`(GitHub `lucaskim365/workfit-office`)의 `main` push다.** Vercel이 그 저장소에 연결되어 있어 `git push upstream main` 하면 운영 프런트를 자동 배포한다 — 검증 없이 밀지 않고, 사용자가 운영 배포를 지시했을 때만 한다.

- `origin`(GitHub `hongchaerish/workfit-office`)은 `upstream`의 fork로, `origin main` push는 배포로 이어지지 않는다(2026-10-08 확인: origin 배포 기록 0건).
- `gitlab`(사내)은 배포 설정이 없으며 배포되지 않는 것이 정상이다.
