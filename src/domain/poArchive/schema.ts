import { z } from 'zod';
import type { ApprovalDoc } from '@/domain/approvalDoc/schema';
import { isDeptArchiveDoc, matchesSearchQuery } from '@/domain/approvalDoc/search';

/**
 * 발주서 보관함 — 문서관리의 결재 연동 보관함.
 *
 * 보관함 목록은 **따로 복사해 두지 않는다.** 결재 완료된 발주서를 approvalDocs 에서 그때그때
 * 골라 보여 준다. 완료 시점에 옮겨 담는 방식은 완료 처리 경로(PC·PWA·일괄 결재)마다 훅을 걸어야
 * 하고 하나라도 빠지면 보관함에서 문서가 사라진다. 결재 문서는 읽기 전용으로만 다룬다(CLAUDE.md §2).
 *
 * 따로 저장하는 것은 사용자가 올린 **회신 문서**(거래처 직인이 찍힌 최종본) 하나뿐이다.
 */

/** 서식 이름이나 코드에 이 낱말이 들어 있으면 발주서로 본다. 서식은 사용자가 직접 만든다. */
export const PO_FORM_KEYWORD = '발주';

/** 발주서 서식인가 — 서식 code(문서의 docType)나 이름에 '발주'가 들어 있다. */
export function isPurchaseOrderForm(form: { code: string; name: string }): boolean {
  return form.code.includes(PO_FORM_KEYWORD) || form.name.includes(PO_FORM_KEYWORD);
}

/** 보관함에 들어갈 문서 — 결재 완료된 발주서. `poFormCodes` 는 발주서 서식 code 모음. */
export function isArchivedPurchaseOrder(doc: ApprovalDoc, poFormCodes: ReadonlySet<string>): boolean {
  if (doc.status !== '완료') return false;
  return poFormCodes.has(doc.docType) || doc.docType.includes(PO_FORM_KEYWORD);
}

export interface PoViewer {
  userId: string;
  deptId: string;
  deptName: string;
  /** 관리자 또는 문서관리 등록·수정 권한자 — 비공개가 아닌 발주서는 모두 본다. */
  isManager: boolean;
}

/** 결재에 직접 관여했는가 — 기안자·결재선·수신처. */
function isParticipant(doc: ApprovalDoc, v: PoViewer): boolean {
  if (doc.drafterId === v.userId) return true;
  if (doc.steps.some((s) => s.approverId === v.userId)) return true;
  return doc.recipients.some((r) =>
    r.type === 'user' ? r.id === v.userId : r.type === 'dept' ? r.id === v.deptId || r.name === v.deptName : false,
  );
}

/**
 * 열람 범위 — 결재 원본의 공개 규칙을 그대로 따른다.
 * 관여자는 언제나, 같은 부서와 문서 관리자는 공개·일반 등급일 때만 본다.
 */
export function canViewPurchaseOrder(
  doc: ApprovalDoc,
  v: PoViewer,
  drafterDeptIdOf: (drafterId: string) => string,
): boolean {
  if (isParticipant(doc, v)) return true;
  if ((doc.visibility ?? '부서') === '비공개') return false;
  // 대외비·극비는 결재 문서 보기와 같이 관여자만 연다.
  if ((doc.securityLevel ?? '일반') !== '일반') return false;
  if (v.isManager) return true;
  return isDeptArchiveDoc(doc, { deptId: v.deptId, deptName: v.deptName }, drafterDeptIdOf);
}

/** 회신 문서를 올릴 수 있는가 — 기안자(거래처에 보낸 사람)와 문서 관리자. */
export function canUploadPoReply(doc: ApprovalDoc, v: PoViewer): boolean {
  return v.isManager || doc.drafterId === v.userId;
}

/** 회신 문서 메타. 실제 파일은 fileStorage(Garage S3)에 있다. 문서 ID = 결재 문서 ID(문서당 1건). */
export const poReplySchema = z.object({
  docId: z.string().min(1),
  docNo: z.string().min(1),
  name: z.string().trim().min(1).max(255),
  /** 저장소가 돌려준 접근 URL. */
  url: z.string().min(1).max(512),
  /** 저장소 경로 — 다운로드 서명·교체 시 삭제에 쓴다. */
  storagePath: z.string().max(512),
  size: z.number().int().min(0),
  contentType: z.string().max(100),
  uploadedBy: z.string().min(1),
  uploadedByName: z.string().default(''),
  uploadedAt: z.string().datetime(),
});

export type PoReply = z.infer<typeof poReplySchema>;

export type PoReplyFilter = 'all' | 'replied' | 'pending';

export interface PoArchiveQuery {
  /** 제목·문서번호·기안자·기안부서 — 띄어쓴 낱말이 모두 들어 있으면 일치. */
  keyword: string;
  /** 완료일 범위 `YYYY-MM-DD` (비우면 제한 없음). */
  from: string;
  to: string;
  reply: PoReplyFilter;
}

/** 완료일 `YYYY-MM-DD`(로컬). 완료일이 없으면 빈 문자열. */
export function completedDateOf(doc: Pick<ApprovalDoc, 'completedAt'>): string {
  if (!doc.completedAt) return '';
  const d = new Date(doc.completedAt);
  if (Number.isNaN(d.getTime())) return doc.completedAt.slice(0, 10);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 검색 조건 적용 + 완료일 최신순. */
export function filterPurchaseOrders(
  docs: ApprovalDoc[],
  q: PoArchiveQuery,
  hasReply: (docId: string) => boolean,
): ApprovalDoc[] {
  return docs
    .filter((d) => {
      if (!matchesSearchQuery(d, q.keyword)) return false;
      const day = completedDateOf(d);
      if (q.from && day < q.from) return false;
      if (q.to && day > q.to) return false;
      if (q.reply === 'replied' && !hasReply(d.id)) return false;
      if (q.reply === 'pending' && hasReply(d.id)) return false;
      return true;
    })
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
}

/** PDF 파일명 — `[문서번호] 제목.pdf` (파일명에 못 쓰는 글자는 뺀다). */
export function poPdfFileName(doc: Pick<ApprovalDoc, 'docNo' | 'title'>): string {
  const safe = `[${doc.docNo}] ${doc.title}`.replace(/[\\/:*?"<>|]/g, '_').trim();
  return `${safe}.pdf`;
}
