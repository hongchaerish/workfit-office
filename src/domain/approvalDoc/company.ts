/*
  결재 문서의 회사 — 루미팹(LumeFab, 광주 법인)이 조직을 따로 두기 전까지 쓰는 임시 구분.
  같은 서식(지출결의·품의·법인카드 사용 내역서·채용 품의서·외근 신청서·휴가원·개인 경비 사용 신청서 — LUMEFAB_FORMS)을 루미팹용으로 골라 쓰면 문서에 company='lumefab' 를 남긴다.
  company 가 없으면 워크핏 문서다(기존 문서는 모두 그대로).
*/

export type ApprovalCompany = 'lumefab';

export const COMPANY_LABEL: Record<ApprovalCompany, string> = { lumefab: '루미팹' };
export const COMPANY_NAME_EN: Record<ApprovalCompany, string> = { lumefab: 'LumeFab' };

/** 루미팹용으로 고를 수 있는 서식 — 서식 코드나 이름 중 하나가 맞으면 */
const LUMEFAB_FORMS = [
  { code: '지출결의', name: '지출결의서' },
  { code: '품의', name: '품의서' },
  // 법인카드를 쓴 뒤 내역을 증빙으로 내는 서식(품의서를 복사해 만듦) — 코드는 관리자가 정하므로 이름으로도 찾는다
  { code: '법인카드', name: '법인카드 사용 내역서' },
  { code: '채용', name: '채용 품의서' },
  // 외근 신청서 — 외근 일정·근태 연동은 서식 코드로 하므로 루미팹 문서도 워크핏 문서와 똑같이 이어진다
  { code: '외근', name: '외근 신청서' },
  // 휴가원 — 휴가 차감·근태·캘린더 연동도 서식 코드로 하므로 루미팹 문서도 워크핏 문서와 똑같이 이어진다
  { code: '휴가', name: '휴가원' },
  { code: '개인경비', name: '개인 경비 사용 신청서' },
];

/** 이름 비교 — 띄어쓰기만 다른 이름(채용 품의서 / 채용품의서)도 같은 서식 */
const sameName = (a: string, b: string) => a.replace(/\s+/g, '') === b.replace(/\s+/g, '');

export function isLumefabForm(form: { code: string; name: string }): boolean {
  return LUMEFAB_FORMS.some((f) => f.code === form.code || sameName(f.name, form.name));
}

export function parseCompany(v: unknown): ApprovalCompany | null {
  return v === 'lumefab' ? 'lumefab' : null;
}

/** 문서번호 앞자리 — 워크핏 AP, 루미팹 LF (번호도 따로 센다) */
export function docNoPrefixOf(company: ApprovalCompany | null | undefined): string {
  return company === 'lumefab' ? 'LF' : 'AP';
}

export function isLumefabDoc(doc: { company?: string | null }): boolean {
  return doc.company === 'lumefab';
}

/** 결재함 회사 보기 — 합쳐서·워크핏만·루미팹만 */
export type CompanyView = 'all' | 'workfit' | 'lumefab';

export function parseCompanyView(v: unknown): CompanyView | null {
  return v === 'all' || v === 'workfit' || v === 'lumefab' ? v : null;
}

export function inCompanyView(doc: { company?: string | null }, view: CompanyView): boolean {
  if (view === 'all') return true;
  return view === 'lumefab' ? isLumefabDoc(doc) : !isLumefabDoc(doc);
}
