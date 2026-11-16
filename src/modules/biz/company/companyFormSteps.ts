import { bizNoDigits, formatBizNo, validateAccountDrafts, type AccountDraft, type CompanyDraft } from '@/domain/company/schema';
import { isValidEmail, isValidHomepage } from '@/domain/company/inputFormat';

/** 기업 등록 창의 단계(왼쪽 단계선) — 상태와 한 줄 요약. 화면은 이 결과를 그리기만 한다. */
export type StepKey = 'basic' | 'contact' | 'address' | 'account' | 'memo';
export type StepState = 'empty' | 'progress' | 'done' | 'error' | 'optional';
export interface StepView {
  key: StepKey;
  title: string;
  state: StepState;
  summary: string;
}

const filled = (v: string) => v.trim() !== '';

export function companyFormSteps({
  form,
  accounts,
  bankName,
  duplicate,
  submitted = false,
}: {
  form: CompanyDraft;
  accounts: AccountDraft[];
  bankName: (code: string) => string;
  duplicate: boolean;
  /** 등록(저장)을 누른 뒤 — 남은 문제를 '확인 필요'로 보인다. */
  submitted?: boolean;
}): StepView[] {
  const basicDone = filled(form.name) && bizNoDigits(form.bizNo).length === 10;
  const basic: StepView = {
    key: 'basic',
    title: '기본 정보',
    state: duplicate || (submitted && !basicDone) ? 'error' : basicDone ? 'done' : [form.name, form.bizNo, form.ceoName].some(filled) ? 'progress' : 'empty',
    summary: basicDone ? `${form.name.trim()} · ${formatBizNo(form.bizNo)}` : '',
  };

  const contactParts = [form.phone, form.fax, form.email, form.homepage].map((v) => v.trim()).filter(Boolean);
  const contactOk = isValidEmail(form.email) && isValidHomepage(form.homepage);
  const contact: StepView = {
    key: 'contact',
    title: '연락처',
    state: contactParts.length === 0 ? 'optional' : contactOk ? 'done' : submitted ? 'error' : 'progress',
    summary: contactOk ? contactParts.join(' · ') : '',
  };

  const addr = [form.address.trim(), form.addressDetail.trim()].filter(Boolean).join(' ');
  const address: StepView = { key: 'address', title: '주소', state: addr ? 'done' : 'optional', summary: addr };

  const active = accounts.filter((a) => a.use);
  const accountDone = active.length > 0 && validateAccountDrafts(active).length === 0;
  const main = active.find((a) => a.isDefault) ?? active[0];
  const account: StepView = {
    key: 'account',
    title: '계좌',
    state: active.length === 0 ? 'optional' : accountDone ? 'done' : submitted ? 'error' : 'progress',
    summary: accountDone ? `계좌 ${active.length}개 · 기본 ${[bankName(main.bankCode), main.accountNo.trim()].filter(Boolean).join(' ')}` : '',
  };

  const firstLine = form.note.trim().split('\n')[0].trim();
  const memo: StepView = { key: 'memo', title: '메모', state: firstLine ? 'done' : 'optional', summary: firstLine };

  return [basic, contact, address, account, memo];
}

/** 필수 칸 진행 — 기업명, 사업자등록번호(10자리·중복 아님). */
export function requiredProgress(form: CompanyDraft, duplicate: boolean): { done: number; total: 2 } {
  const done = Number(filled(form.name)) + Number(bizNoDigits(form.bizNo).length === 10 && !duplicate);
  return { done, total: 2 };
}
