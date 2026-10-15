/**
 * 사번 규칙(2026-10-15 결정): 입사 연도(한국 시간) 끝 두 자리 + 그해 순번.
 * 예) 2026년 마지막 사번이 2612면 다음은 2613. 그해 첫 사번은 YY01, 순번이 99를 넘으면 자리를 늘린다(26100).
 * 숫자 사번이 아닌 예전 아이디(영문 등)는 순번 계산에서 뺀다.
 */
export function nextEmpNo(existing: readonly string[], now = new Date()): string {
  const yy = String(new Date(now.getTime() + 9 * 3600_000).getUTCFullYear()).slice(-2);
  const pattern = new RegExp(`^${yy}([0-9]{2,})$`);
  const max = existing.reduce((acc, empNo) => {
    const m = empNo.trim().match(pattern);
    return m ? Math.max(acc, Number(m[1])) : acc;
  }, 0);
  return `${yy}${String(max + 1).padStart(2, '0')}`;
}

/** 같은 사번이 이미 있는가 — 로그인 아이디로도 쓰여서 겹치면 안 된다. selfId 는 수정 중인 본인. */
export function isDuplicateEmpNo(users: readonly { id: string; empNo: string }[], empNo: string, selfId?: string): boolean {
  const key = empNo.trim().toLowerCase();
  return users.some((u) => u.id !== selfId && u.empNo.trim().toLowerCase() === key);
}
