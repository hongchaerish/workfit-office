import type { ApprovalDoc } from '@/domain/approvalDoc/schema';

/** 목록 툴바 상태 — 정렬·안읽음만 보기 */
export type ListOrder = 'recent' | 'oldest';

const docTime = (d: ApprovalDoc) => new Date(d.submittedAt ?? d.createdAt ?? '').getTime() || 0;

/** 툴바 설정을 목록에 적용한다(원본은 그대로). 정렬 기준은 상신 시각, 상신 전이면 작성 시각. */
export function arrangeList(
  list: ApprovalDoc[],
  opts: { order: ListOrder; unreadOnly: boolean; isUnread: (docId: string) => boolean },
): ApprovalDoc[] {
  const filtered = opts.unreadOnly ? list.filter((d) => opts.isUnread(d.id)) : [...list];
  const dir = opts.order === 'recent' ? -1 : 1;
  return filtered.sort((a, b) => dir * (docTime(a) - docTime(b)));
}

/**
 * 열린 문서의 목록 안 위치와 이전/다음 문서 — 상세 화면의 '3 / 12'와 ◀ ▶ 이동용.
 * 지금 보이는 목록(필터·검색·정렬 반영) 순서를 따른다. 목록에 없으면 index 0.
 */
export function docPosition(
  list: ApprovalDoc[],
  selId: string,
): { index: number; total: number; prevId: string | null; nextId: string | null } {
  const i = list.findIndex((d) => d.id === selId || d.docNo === selId);
  if (i === -1) return { index: 0, total: list.length, prevId: null, nextId: null };
  return {
    index: i + 1,
    total: list.length,
    prevId: list[i - 1]?.id ?? null,
    nextId: list[i + 1]?.id ?? null,
  };
}
