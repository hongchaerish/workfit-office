import type { ApprovalDoc } from '@/domain/approvalDoc/schema';

/**
 * 전자결재 목록의 문서 선택 규칙.
 *
 * **문서는 사용자가 눌렀을 때만 연다.** 예전에는 결재함에 들어가거나 선택이 비면 맨 앞 문서를
 * 자동으로 열었다 — 열어보지도 않은 문서가 읽음 처리되고, 목록만 보고 싶어도 상세가 떴다.
 */

const matches = (selId: string) => (d: ApprovalDoc) => d.id === selId || d.docNo === selId;

/** 지금 상세에 보일 문서. 선택이 없으면 null(목록만 보인다). */
export function resolveSelectedDoc(
  selId: string | null,
  filteredList: ApprovalDoc[],
  allDocs: ApprovalDoc[],
): ApprovalDoc | null {
  if (!selId) return null;
  return filteredList.find(matches(selId)) ?? allDocs.find(matches(selId)) ?? null;
}

/**
 * 목록이 바뀐 뒤의 선택 보정. 선택한 문서가 결재함에서 빠졌어도(결재 처리 등) 전체 문서에
 * 남아 있으면 그대로 두고, 아예 사라졌을 때만 선택을 비운다 — 다음 문서를 대신 열지 않는다.
 */
export function correctSelection(selId: string | null, allDocs: ApprovalDoc[]): string | null {
  if (!selId || allDocs.length === 0) return selId;
  return allDocs.some(matches(selId)) ? selId : null;
}
