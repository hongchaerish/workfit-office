import { useMemo, useRef, useState } from 'react';
import { Plus, RotateCcw, Star, X } from 'lucide-react';
import { Modal } from '@/shared/ui/Modal';
import { Button } from '@/shared/ui/Button';
import { Field } from '@/shared/ui/form/Field';
import { TextField } from '@/shared/ui/form/TextField';
import { SelectField } from '@/shared/ui/form/SelectField';
import {
  bizNoDigits,
  EMAIL_FORMAT_ERROR,
  formatBizNo,
  HOMEPAGE_FORMAT_ERROR,
  newCompanyId,
  normalizeDefaultAccount,
  validateAccountDrafts,
  validateCompanyDraft,
  type AccountDraft,
  type Company,
  type CompanyBankAccount,
} from '@/domain/company/schema';
import { formatAccountNoTyping, formatBizNoTyping, formatPhoneTyping, isValidEmail, isValidHomepage } from '@/domain/company/inputFormat';
import { DuplicateBizNoError } from '@/data/company/company.repo';
import { FormattedTextField } from './FormattedTextField';
import { useBankNames, useBankOptions, useSaveCompany } from '@/features/company/useCompanies';
import { companyFormSteps, requiredProgress } from './companyFormSteps';
import { StepSection } from './StepRail';

type Row = AccountDraft & { k: string };
let seq = 0;
const key = () => `r${++seq}`;

const blankCompany = (): Company => ({
  id: newCompanyId(), name: '', bizNo: '', ceoName: '', phone: '', fax: '', email: '', homepage: '', address: '', addressDetail: '', use: true, note: '',
  createdBy: '', createdAt: '', updatedBy: '', updatedAt: '',
});

/** 계좌 한 줄의 칸별 오류(사용 중인 줄만). 문구는 validateAccountDrafts 와 같다. */
function accountFieldErrors(r: AccountDraft): { bank?: string; no?: string; holder?: string } {
  if (!r.use) return {};
  const no = r.accountNo.trim();
  return {
    bank: r.bankCode ? undefined : '은행을 고르세요.',
    no: !no ? '계좌번호를 입력하세요.' : /^[0-9-]+$/.test(no) ? undefined : '계좌번호는 숫자와 - 만 쓸 수 있습니다.',
    holder: r.holder.trim() ? undefined : '예금주를 입력하세요.',
  };
}

/**
 * 기업 등록·수정 — 왼쪽 단계선(기본 정보 → 주소 → 계좌 → 메모)으로 입력 순서와 진행을 보여 준다.
 * 기업 칸과 계좌 여러 줄을 한 번에 저장. `company` 가 없으면 신규.
 */
export function CompanyFormModal({
  company,
  accounts,
  allCompanies,
  actorId,
  onClose,
  onSaved,
  onOpenCompany,
}: {
  company: Company | null;
  /** 이 기업의 저장된 계좌(사용 안 함 포함). */
  accounts: CompanyBankAccount[];
  allCompanies: Company[];
  actorId: string;
  onClose: () => void;
  onSaved: (c: Company) => void;
  /** 중복 번호의 기존 기업 열기. */
  onOpenCompany: (id: string) => void;
}) {
  const isNew = company === null;
  const [form, setForm] = useState<Company>(() => (company ? { ...company, bizNo: formatBizNo(company.bizNo) } : blankCompany()));
  const [rows, setRows] = useState<Row[]>(() =>
    [...accounts]
      .sort((a, b) => Number(b.use) - Number(a.use) || Number(b.isDefault) - Number(a.isDefault))
      .map((a) => ({ k: key(), id: a.id, bankCode: a.bankCode, accountNo: a.accountNo, holder: a.holder, isDefault: a.isDefault, use: a.use, note: a.note })),
  );
  /** 한 번 벗어난 칸 — 그 칸부터 오류를 보인다. 저장을 누르면 전부. */
  const [touched, setTouched] = useState<Set<string>>(() => new Set());
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);
  const save = useSaveCompany();
  const { data: banks = [] } = useBankOptions();
  const bankNames = useBankNames();

  const set = <K extends keyof Company>(k: K, v: Company[K]) => setForm((f) => ({ ...f, [k]: v }));
  const setRow = (k: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.k === k ? { ...r, ...patch } : r)));
  const touch = (name: string) => setTouched((t) => (t.has(name) ? t : new Set(t).add(name)));
  const shows = (name: string) => submitted || touched.has(name);

  const check = validateCompanyDraft(form, allCompanies, isNew ? undefined : form.id);
  const duplicate = Boolean(check.duplicate);
  const shown = useMemo(() => normalizeDefaultAccount(rows), [rows]);
  const steps = companyFormSteps({ form, accounts: shown, bankName: (c) => bankNames.get(c) ?? '', duplicate, submitted });
  const progress = requiredProgress(form, duplicate);

  const digits = bizNoDigits(form.bizNo);
  const nameError = shows('name') && !form.name.trim() ? '기업명을 입력하세요.' : undefined;
  const bizNoError = duplicate
    ? check.errors.find((m) => m.startsWith('이미'))
    : shows('bizNo') && !digits
      ? '사업자등록번호를 입력하세요.'
      : shows('bizNo') && digits.length !== 10
        ? '사업자등록번호는 숫자 10자리입니다.'
        : undefined;
  const emailError = shows('email') && !isValidEmail(form.email) ? EMAIL_FORMAT_ERROR : undefined;
  const homepageError = shows('homepage') && !isValidHomepage(form.homepage) ? HOMEPAGE_FORMAT_ERROR : undefined;

  const addRow = () => setRows((rs) => [...rs, { k: key(), bankCode: '', accountNo: '', holder: form.name.trim(), isDefault: rs.every((r) => !r.use), use: true, note: '' }]);
  /** 저장 안 된 줄은 빼고, 저장된 줄은 사용 안 함으로(지우지 않음). */
  const dropRow = (r: Row) => (r.id ? setRow(r.k, { use: false, isDefault: false }) : setRows((rs) => rs.filter((x) => x.k !== r.k)));
  const pickDefault = (k: string) => setRows((rs) => rs.map((r) => ({ ...r, isDefault: r.k === k })));

  const submit = async () => {
    setServerError('');
    const errs = [...check.errors, ...validateAccountDrafts(rows)];
    if (errs.length) {
      setSubmitted(true);
      // 다시 그린 뒤 첫 문제 칸으로
      requestAnimationFrame(() => {
        const el = bodyRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
        el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        el?.focus({ preventScroll: true });
      });
      return;
    }
    try {
      const saved = await save.mutateAsync({
        company: { ...form, ceoName: form.ceoName.trim(), phone: form.phone.trim(), fax: form.fax.trim(), email: form.email.trim(), homepage: form.homepage.trim(), address: form.address.trim(), addressDetail: form.addressDetail.trim(), note: form.note.trim() },
        isNew,
        accounts: rows.map(({ k: _k, ...d }) => d),
        existing: accounts,
        actorId,
      });
      onSaved(saved);
    } catch (e) {
      setServerError(e instanceof DuplicateBizNoError ? '이미 등록된 사업자등록번호입니다. 목록을 새로 불러온 뒤 다시 확인하세요.' : '저장하지 못했습니다. 잠시 뒤 다시 시도하세요.');
    }
  };

  const bankOptions = (code: string) => {
    const opts = banks.map((b) => ({ value: b.code, label: b.name }));
    if (code && !opts.some((o) => o.value === code)) opts.push({ value: code, label: bankNames.get(code) ?? '선택한 은행' });
    return [{ value: '', label: '은행 선택' }, ...opts];
  };

  const [basic, contact, address, account, memo] = steps;
  const allDone = progress.done === progress.total;

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? '기업 신규 등록' : '기업 정보 수정'}
      width={760}
      footer={
        <>
          {!isNew && (
            <div className="mr-auto w-32">
              <SelectField aria-label="사용 여부" value={form.use ? 'Y' : 'N'} onChange={(e) => set('use', e.target.value === 'Y')} options={[{ value: 'Y', label: '사용' }, { value: 'N', label: '사용 안 함' }]} />
            </div>
          )}
          <span className={`self-center pr-1 text-[12px] font-bold ${allDone ? 'text-ink' : 'text-ink3'}`}>
            필수 <span className={allDone ? 'rounded bg-teal px-1.5 py-0.5' : ''}>{progress.done}/{progress.total}</span>
          </span>
          <Button onClick={onClose}>취소</Button>
          <Button variant="primary" onClick={submit} disabled={save.isPending}>{save.isPending ? '저장 중…' : isNew ? '등록' : '저장'}</Button>
        </>
      }
    >
      <div ref={bodyRef} className="flex flex-col py-1">
        <StepSection index={1} step={basic}>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Field label="기업명" required error={nameError}>
              <TextField
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                onBlur={() => touch('name')}
                invalid={Boolean(nameError)}
                aria-invalid={Boolean(nameError)}
                maxLength={128}
                placeholder="예: 대성반도체(주)"
                autoFocus={isNew}
              />
            </Field>
            <Field label="사업자등록번호" required error={bizNoError} hint={check.warnings[0]}>
              <FormattedTextField
                value={form.bizNo}
                format={formatBizNoTyping}
                onValue={(v) => set('bizNo', v)}
                onBlur={() => touch('bizNo')}
                invalid={Boolean(bizNoError)}
                aria-invalid={Boolean(bizNoError)}
                inputMode="numeric"
                placeholder="000-00-00000"
                className="font-mono"
              />
            </Field>
            {check.duplicate && (
              <div className="col-span-2 -mt-1 flex justify-end">
                <Button size="sm" onClick={() => onOpenCompany(check.duplicate!.id)}>등록된 기업 보기</Button>
              </div>
            )}
            <Field label="대표자">
              <TextField value={form.ceoName} onChange={(e) => set('ceoName', e.target.value)} maxLength={64} />
            </Field>
          </div>
        </StepSection>

        <StepSection index={2} step={contact}>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Field label="대표번호">
              <FormattedTextField value={form.phone} format={formatPhoneTyping} onValue={(v) => set('phone', v)} maxLength={32} inputMode="tel" placeholder="예: 02-1234-5678" />
            </Field>
            <Field label="팩스">
              <FormattedTextField value={form.fax} format={formatPhoneTyping} onValue={(v) => set('fax', v)} maxLength={32} inputMode="tel" placeholder="예: 02-1234-5679" />
            </Field>
            <Field label="이메일" error={emailError}>
              <TextField
                type="email"
                value={form.email}
                onChange={(e) => set('email', e.target.value)}
                onBlur={() => touch('email')}
                invalid={Boolean(emailError)}
                aria-invalid={Boolean(emailError)}
                maxLength={128}
                placeholder="예: tax@company.co.kr"
              />
            </Field>
            <Field label="홈페이지" error={homepageError}>
              <TextField
                value={form.homepage}
                onChange={(e) => set('homepage', e.target.value)}
                onBlur={() => touch('homepage')}
                invalid={Boolean(homepageError)}
                aria-invalid={Boolean(homepageError)}
                maxLength={256}
                inputMode="url"
                placeholder="예: www.company.co.kr"
              />
            </Field>
          </div>
        </StepSection>

        <StepSection index={3} step={address}>
          <div className="grid grid-cols-[2fr_1fr] gap-x-4">
            <Field label="주소">
              <TextField value={form.address} onChange={(e) => set('address', e.target.value)} maxLength={256} className="w-full" placeholder="도로명 주소" />
            </Field>
            <Field label="상세 주소">
              <TextField value={form.addressDetail} onChange={(e) => set('addressDetail', e.target.value)} maxLength={128} className="w-full" placeholder="층·호수 등" />
            </Field>
          </div>
        </StepSection>

        <StepSection
          index={4}
          step={account}
          aside={rows.length > 0 ? <Button size="sm" onClick={addRow}><Plus size={12} /> 계좌 추가</Button> : undefined}
        >
          {rows.length === 0 ? (
            <button
              type="button"
              onClick={addRow}
              className="flex h-12 items-center justify-center gap-1.5 rounded-lg border border-dashed border-border-hi text-[12.5px] font-bold text-ink3 transition-colors hover:border-teal hover:text-ink"
            >
              <Plus size={14} /> 계좌 추가
            </button>
          ) : (
            <div className="flex flex-col gap-2">
              {rows.map((r, i) => (
                <AccountCard
                  key={r.k}
                  row={r}
                  isDefault={shown[i].isDefault}
                  bankOptions={bankOptions(r.bankCode)}
                  errors={accountFieldErrors(r)}
                  shows={(f) => shows(`acc:${r.k}:${f}`)}
                  onTouch={(f) => touch(`acc:${r.k}:${f}`)}
                  onChange={(patch) => setRow(r.k, patch)}
                  onPickDefault={() => pickDefault(r.k)}
                  onDrop={() => dropRow(r)}
                />
              ))}
            </div>
          )}
        </StepSection>

        <StepSection index={5} step={memo} last>
          <textarea
            value={form.note}
            onChange={(e) => set('note', e.target.value)}
            maxLength={1000}
            rows={3}
            placeholder="참고할 내용"
            className="w-full resize-y rounded-md border border-border-hi bg-panel px-3 py-2 text-[13px] text-ink outline-none transition-colors placeholder:text-ink3 focus:border-teal"
          />
        </StepSection>

        {serverError && (
          <p className="mt-4 rounded-lg bg-danger/10 px-3 py-2 text-[11.5px] font-semibold text-danger">{serverError}</p>
        )}
      </div>
    </Modal>
  );
}

/** 계좌 카드 — 은행·계좌번호·예금주, 기본 칩, 빼기. 저장된 계좌를 빼면 흐리게 '사용 안 함' + 되살리기. */
function AccountCard({
  row,
  isDefault,
  bankOptions,
  errors,
  shows,
  onTouch,
  onChange,
  onPickDefault,
  onDrop,
}: {
  row: Row;
  isDefault: boolean;
  bankOptions: { value: string; label: string }[];
  errors: { bank?: string; no?: string; holder?: string };
  shows: (field: 'bank' | 'no' | 'holder') => boolean;
  onTouch: (field: 'bank' | 'no' | 'holder') => void;
  onChange: (patch: Partial<Row>) => void;
  onPickDefault: () => void;
  onDrop: () => void;
}) {
  if (!row.use) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-border bg-panel-alt/50 px-3 py-2.5 text-[12.5px] text-ink3">
        <span className="font-mono line-through">{row.accountNo || '-'}</span>
        <span>{row.holder}</span>
        <span className="ml-auto font-semibold">사용 안 함</span>
        <Button size="sm" onClick={() => onChange({ use: true })}><RotateCcw size={12} /> 되살리기</Button>
      </div>
    );
  }
  const err = (f: 'bank' | 'no' | 'holder') => (shows(f) ? errors[f] : undefined);
  return (
    <div className={`flex flex-col gap-2 rounded-lg border px-3 py-3 transition-colors ${isDefault ? 'border-teal bg-teal/5' : 'border-border bg-panel'}`}>
      <div className="flex items-start gap-2">
        <div className="w-36 shrink-0">
          <Field error={err('bank')}>
            <SelectField
              aria-label="은행"
              value={row.bankCode}
              onChange={(e) => { onChange({ bankCode: e.target.value }); onTouch('bank'); }}
              onBlur={() => onTouch('bank')}
              invalid={Boolean(err('bank'))}
              aria-invalid={Boolean(err('bank'))}
              options={bankOptions}
            />
          </Field>
        </div>
        <div className="min-w-0 flex-1">
          <Field error={err('no')}>
            <FormattedTextField
              aria-label="계좌번호"
              value={row.accountNo}
              format={formatAccountNoTyping}
              onValue={(v) => onChange({ accountNo: v })}
              inputMode="numeric"
              onBlur={() => onTouch('no')}
              invalid={Boolean(err('no'))}
              aria-invalid={Boolean(err('no'))}
              maxLength={32}
              className="w-full font-mono"
              placeholder="계좌번호"
            />
          </Field>
        </div>
        <div className="w-36 shrink-0">
          <Field error={err('holder')}>
            <TextField
              aria-label="예금주"
              value={row.holder}
              onChange={(e) => onChange({ holder: e.target.value })}
              onBlur={() => onTouch('holder')}
              invalid={Boolean(err('holder'))}
              aria-invalid={Boolean(err('holder'))}
              maxLength={64}
              className="w-full"
              placeholder="예금주"
            />
          </Field>
        </div>
        <button
          type="button"
          onClick={onPickDefault}
          aria-pressed={isDefault}
          title={isDefault ? '기본 계좌' : '기본 계좌로'}
          className={`flex h-9 shrink-0 items-center gap-1 rounded-full px-3 text-[11.5px] font-bold transition-colors ${
            isDefault ? 'bg-teal' : 'border border-border-hi text-ink3 hover:border-teal hover:text-ink'
          }`}
        >
          <Star size={11} fill={isDefault ? 'currentColor' : 'none'} /> 기본
        </button>
        <button
          type="button"
          aria-label="계좌 빼기"
          title={row.id ? '사용 안 함으로' : '빼기'}
          onClick={onDrop}
          className="grid h-9 w-8 shrink-0 place-items-center rounded-md text-ink3 transition-colors hover:bg-panel-alt hover:text-danger"
        >
          <X size={14} />
        </button>
      </div>
      <TextField
        aria-label="계좌 메모"
        value={row.note}
        onChange={(e) => onChange({ note: e.target.value })}
        maxLength={200}
        className="h-8 w-full text-[12px]"
        placeholder="용도 등 메모"
      />
    </div>
  );
}
