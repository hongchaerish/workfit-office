/**
 * 익명 설문에서 응답자를 시각으로 맞춰 보지 못하게 하는 도우미.
 * ([[docs/superpowers/specs/2026-10-14-survey-server-design.md]] §6)
 */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** KST 기준 그날 00:00 을 UTC ISO 문자열로. 시·분·초를 버려 제출 순서를 감춘다. */
export function kstDayStamp(now: Date): string {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  const midnightKstAsUtc = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate());
  return new Date(midnightKstAsUtc - KST_OFFSET_MS).toISOString();
}

/** Fisher–Yates. 원본은 그대로 두고 섞은 사본을 돌려준다. */
export function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
