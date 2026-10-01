import { approvalPostReadShareSchema, type ApprovalPostReadShare } from './schema';

/** userId 가 전달받은 문서 id 집합(같은 문서 중복 전달은 1건). matchesBox 의 postReadDocIds 로 쓴다. */
export function postReadDocIdsFor(shares: ApprovalPostReadShare[], userId: string): Set<string> {
  return new Set(shares.filter((s) => s.toUserId === userId).map((s) => s.docId));
}

/** userId 앞으로 온 전달 중 아직 열람(자동 확인)하지 않은 문서 id 집합 — 후열 배지용. */
export function unreadPostReadDocIdsFor(shares: ApprovalPostReadShare[], userId: string): Set<string> {
  return new Set(shares.filter((s) => s.toUserId === userId && !s.readAt).map((s) => s.docId));
}

/**
 * 예전 localStorage(`workfit_post_read_shares_*`) 기록을 스키마로 변환.
 * 깨진 항목은 건너뛴다. 옛 isRead 는 실제로 true 가 된 적이 없어 버리고 readAt=null 로 둔다.
 */
export function parseLegacyShares(raw: unknown): ApprovalPostReadShare[] {
  if (!Array.isArray(raw)) return [];
  const out: ApprovalPostReadShare[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { isRead: _isRead, ...rest } = item as Record<string, unknown>;
    const p = approvalPostReadShareSchema.safeParse({ ...rest, readAt: null });
    if (p.success) out.push(p.data);
    else console.warn('[approvalPostRead] 레거시 후열 전달 항목 건너뜀', item);
  }
  return out;
}
