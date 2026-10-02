import type { ApprovalBox, ApprovalDoc } from './schema';
import type { ApprovalPostReadShare } from '@/domain/approvalPostRead/schema';

/**
 * 전자결재 안읽음 규칙 — 웹·PWA 공용.
 *
 * - 안읽음 = 대기·참조·수신·반려·후열함에 있으면서 **내가 한 번도 열지 않은** 문서.
 * - 한 번 열면 끝 — 문서가 다시 움직여도 안읽음으로 돌아가지 않는다(결정: 2026-10-02).
 * - 읽음 기록의 원천은 DB(`approvalReads`). 예전 후열 기록(공유 readAt, 결재선 postReadAt)도 읽음으로 인정한다.
 */

export const UNREAD_TRACKED_BOXES = ['대기', '참조', '수신', '반려', '후열'] as const satisfies readonly ApprovalBox[];
export type UnreadTrackedBox = (typeof UNREAD_TRACKED_BOXES)[number];

/** 처음 적용할 때 기존 문서를 읽음으로 간주하는 결재함(반려는 브라우저에 남은 열람 기록만 옮긴다) */
const BASELINE_BOXES = ['대기', '참조', '수신'] as const satisfies readonly ApprovalBox[];

export function isDocRead(
  doc: ApprovalDoc,
  userId: string,
  readDocIds: ReadonlySet<string>,
  postReadShares: readonly ApprovalPostReadShare[],
): boolean {
  if (readDocIds.has(doc.id)) return true;
  if (postReadShares.some((s) => s.docId === doc.id && s.toUserId === userId && s.readAt)) return true;
  return doc.steps.some((s) => s.delegatedFromId === userId && Boolean(s.postReadAt));
}

export function unreadByBox(
  byBox: Record<ApprovalBox, ApprovalDoc[]>,
  userId: string,
  readDocIds: ReadonlySet<string>,
  postReadShares: readonly ApprovalPostReadShare[],
): Record<UnreadTrackedBox, { ids: Set<string>; count: number }> {
  const out = {} as Record<UnreadTrackedBox, { ids: Set<string>; count: number }>;
  for (const box of UNREAD_TRACKED_BOXES) {
    const ids = new Set(
      (byBox[box] ?? []).filter((d) => !isDocRead(d, userId, readDocIds, postReadShares)).map((d) => d.id),
    );
    out[box] = { ids, count: ids.size };
  }
  return out;
}

/**
 * 처음 적용할 때 읽음으로 남길 문서 — 대기·참조·수신함의 기존 문서(이미 알고 있다고 본다)와
 * 브라우저에 남아 있던 반려 문서 열람 기록. 이게 없으면 배포 직후 모든 기존 문서가 안읽음으로 뜬다.
 */
export function baselineReadDocIds(
  byBox: Record<ApprovalBox, ApprovalDoc[]>,
  legacyReadRejectedIds: ReadonlySet<string>,
): string[] {
  const ids = new Set<string>();
  for (const box of BASELINE_BOXES) for (const d of byBox[box] ?? []) ids.add(d.id);
  for (const d of byBox['반려'] ?? []) if (legacyReadRejectedIds.has(d.id)) ids.add(d.id);
  return [...ids];
}
