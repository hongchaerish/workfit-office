import type { ApprovalBox, ApprovalDoc } from './schema';
import {
  byRecent,
  isCompletedBoxMatch,
  isDrafterBoxMatch,
  isReceivedBoxMatch,
  isRejectedBoxMatch,
  isTodoBoxMatch,
} from './engine';

/**
 * 결재 문서 검색 — PC(ApprovalScreen)와 PWA(MobileApprovalList)가 같은 규칙을 쓰도록 모은 순수 함수.
 * 검색 범위(어느 함의 문서를 볼지) → 검색어 일치 → 결과 클릭 시 열 함 판정 순서로 쓴다.
 */

/** '문서함' = 부서 문서함(같은 부서의 결재 완료 공개 문서). 나머지는 결재함 이름 그대로. */
export type ApprovalSearchScope = 'all' | ApprovalBox | '문서함';

/** 검색 필터 칩 — PC·PWA 공용 목록 */
export const APPROVAL_SEARCH_SCOPES: { key: ApprovalSearchScope; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: '대기', label: '결재대기' },
  { key: '상신', label: '기안/상신' },
  { key: '완료', label: '결재완료' },
  { key: '반려', label: '반려' },
  { key: '참조', label: '참조' },
  { key: '수신', label: '수신' },
  { key: '후열', label: '후열' },
  { key: '문서함', label: '부서 문서함' },
  { key: '임시', label: '임시저장' },
];

/** 비교용 정규화 — 유니코드 NFC(맥·외부 붙여넣기의 자모 분리형 한글 대비), 소문자, 공백 제거 */
export function normalizeSearchText(s: string | null | undefined): string {
  return (s ?? '').normalize('NFC').toLowerCase().replace(/\s+/g, '');
}

/** 검색 대상 글자 — 제목·문서번호·기안자·문서종류·기안부서 */
function haystackOf(doc: ApprovalDoc): string {
  return normalizeSearchText([doc.title, doc.docNo, doc.drafterName, doc.docType, doc.drafterDept].join(' '));
}

/**
 * 검색어 일치 — 띄어쓰기로 나눈 낱말이 모두 들어 있으면 일치.
 * 공백은 무시하므로 '휴가 신청'으로 '휴가신청서'를, '홍길동 휴가'로 홍길동이 기안한 휴가 문서를 찾는다.
 */
export function matchesSearchQuery(doc: ApprovalDoc, query: string): boolean {
  const words = query.split(/\s+/).map(normalizeSearchText).filter(Boolean);
  if (words.length === 0) return true;
  const hay = haystackOf(doc);
  return words.every((w) => hay.includes(w));
}

/**
 * 부서 문서함 판정 — 결재 완료 + 비공개 아님 + 기안 부서가 내 부서.
 * drafterDeptId 가 비어 있는 과거 문서는 기안자의 현재 부서 id(drafterDeptIdOf)로, 그것도 없으면 부서명으로 대조한다.
 */
export function isDeptArchiveDoc(
  doc: ApprovalDoc,
  my: { deptId: string; deptName: string },
  drafterDeptIdOf: (drafterId: string) => string,
): boolean {
  if (doc.status !== '완료') return false;
  if ((doc.visibility ?? '부서') === '비공개') return false;
  const docDeptId = doc.drafterDeptId || drafterDeptIdOf(doc.drafterId);
  return docDeptId === my.deptId || (!docDeptId && doc.drafterDept === my.deptName);
}

/**
 * 검색 범위의 문서 — 'all' 은 모든 결재함(삭제함 제외) + 부서 문서함의 합집합(중복 제거).
 * 결과는 최근 상신순.
 */
export function searchScopeDocs(
  scope: ApprovalSearchScope,
  byBox: Partial<Record<ApprovalBox, ApprovalDoc[]>>,
  deptArchive: ApprovalDoc[],
): ApprovalDoc[] {
  if (scope === '문서함') return [...deptArchive].sort(byRecent);
  if (scope !== 'all') return [...(byBox[scope] ?? [])].sort(byRecent);
  const map = new Map<string, ApprovalDoc>();
  for (const [box, list] of Object.entries(byBox)) {
    if (box === '삭제') continue;
    list?.forEach((d) => map.set(d.id, d));
  }
  deptArchive.forEach((d) => map.set(d.id, d));
  return Array.from(map.values()).sort(byRecent);
}

/** 범위 + 검색어 적용 */
export function searchApprovalDocs(
  query: string,
  scope: ApprovalSearchScope,
  byBox: Partial<Record<ApprovalBox, ApprovalDoc[]>>,
  deptArchive: ApprovalDoc[],
): ApprovalDoc[] {
  return searchScopeDocs(scope, byBox, deptArchive).filter((d) => matchesSearchQuery(d, query));
}

/** 문서를 열 때 맞춰 둘 결재함과 그 함의 상태 필터 */
export type DocBoxTarget =
  | { box: '완료'; doneFilter: 'all' }
  | { box: '상신'; draftFilter: 'all' | 'progress' | 'completed' | 'rejected' }
  | { box: '반려'; rejectFilter: 'all' }
  | { box: '대기'; todoFilter: 'all' }
  | { box: '임시' | '수신' | '참조' | '문서함' };

const isMyReference = (doc: ApprovalDoc, me: string) =>
  doc.status !== '임시저장' && doc.steps.some((s) => s.kind === '참조' && s.approverId === me);

/**
 * 문서가 '내' 목록에서 실제로 보이는 결재함을 고른다(알림 딥링크·검색 결과 클릭 공용).
 * 수신처·참조로만 받은 문서는 수신함·참조함으로, 어느 함에도 없으면 부서 문서함.
 * myDeptName 은 isReceivedBoxMatch 형식('부서명' 또는 '부서명||부서id').
 */
export function resolveDocBox(doc: ApprovalDoc, me: string, myDeptName?: string): DocBoxTarget {
  const fallback = (): DocBoxTarget => {
    if (isReceivedBoxMatch(doc, me, myDeptName)) return { box: '수신' };
    if (isMyReference(doc, me)) return { box: '참조' };
    return { box: '문서함' };
  };
  if (doc.status === '완료' || doc.status === '시행대기') {
    if (isCompletedBoxMatch(doc, me)) return { box: '완료', doneFilter: 'all' };
    if (isDrafterBoxMatch(doc, me)) return { box: '상신', draftFilter: 'completed' };
    return fallback();
  }
  if (doc.status === '반려' || doc.status === '긴급 조치 사후 검토 반려' || doc.status === '시행반송') {
    if (isRejectedBoxMatch(doc, me)) return { box: '반려', rejectFilter: 'all' };
    if (isDrafterBoxMatch(doc, me)) return { box: '상신', draftFilter: 'rejected' };
    return fallback();
  }
  if (doc.status === '임시저장') return { box: '임시' };
  if (isTodoBoxMatch(doc, me)) return { box: '대기', todoFilter: 'all' };
  if (isDrafterBoxMatch(doc, me)) return { box: '상신', draftFilter: doc.status === '진행중' ? 'progress' : 'all' };
  return fallback();
}
