import { useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { Button } from '@/shared/ui/Button';
import { Field } from '@/shared/ui/form/Field';
import { TextField } from '@/shared/ui/form/TextField';
import { SelectField } from '@/shared/ui/form/SelectField';
import { VENDOR_TYPES, VENDOR_USE, type Vendor } from '@/domain/vendor/schema';
import {
  bizNoDigits,
  findDuplicateBizNo,
  formatBizNo,
  isValidBizNoChecksum,
  nextVendorCode,
} from '@/domain/bizVendor/schema';
import { useUpsertVendor } from '@/features/bizVendor/useBizVendor';

/** 거래처 등록·수정. `vendor` 가 없으면 신규(코드 자동 부여). */
export function VendorFormModal({
  open,
  vendor,
  allVendors,
  onClose,
  onSaved,
}: {
  open: boolean;
  vendor: Vendor | null;
  allVendors: Vendor[];
  onClose: () => void;
  onSaved: (v: Vendor) => void;
}) {
  const isNew = vendor === null;
  const [form, setForm] = useState<Vendor>(
    () => vendor ?? { code: nextVendorCode(allVendors.map((v) => v.code)), name: '', type: '매입', use: '사용', bizNo: '', ceo: '', manager: '', addr: '' },
  );
  const [err, setErr] = useState<string | null>(null);
  const upsert = useUpsertVendor();
  const set = <K extends keyof Vendor>(k: K, v: Vendor[K]) => setForm((f) => ({ ...f, [k]: v }));

  const digits = bizNoDigits(form.bizNo);
  const dup = findDuplicateBizNo(allVendors, form.bizNo, isNew ? undefined : form.code);
  const bizNoError = digits && digits.length !== 10 ? '사업자번호는 숫자 10자리입니다.' : dup ? `이미 등록된 사업자번호입니다 — ${dup.name}(${dup.code})` : undefined;
  const bizNoHint = digits.length === 10 && !isValidBizNoChecksum(digits) ? '검증번호가 맞지 않습니다. 번호를 다시 확인하세요(저장은 됩니다).' : undefined;

  const submit = async () => {
    setErr(null);
    if (!form.name.trim()) return setErr('거래처명을 입력하세요.');
    if (bizNoError) return setErr(bizNoError);
    const next: Vendor = { ...form, name: form.name.trim(), bizNo: formatBizNo(form.bizNo), ceo: form.ceo.trim(), manager: form.manager.trim(), addr: form.addr.trim() };
    try {
      await upsert.mutateAsync({ vendor: next, isNew });
      onSaved(next);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '저장하지 못했습니다.');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isNew ? '거래처 신규 등록' : '거래처 수정'}
      width={560}
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button variant="primary" onClick={submit} disabled={upsert.isPending}>
            {upsert.isPending ? '저장 중…' : '저장'}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="거래처코드" hint={isNew ? '자동 부여' : undefined}>
          <TextField value={form.code} readOnly className="bg-panel-alt font-mono" />
        </Field>
        <Field label="거래처명" required>
          <TextField value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={128} placeholder="예: 대성반도체(주)" />
        </Field>
        <Field label="사업자번호" error={bizNoError} hint={bizNoHint}>
          <TextField
            value={form.bizNo}
            onChange={(e) => set('bizNo', e.target.value)}
            onBlur={() => set('bizNo', formatBizNo(form.bizNo))}
            invalid={Boolean(bizNoError)}
            maxLength={32}
            placeholder="000-00-00000"
            className="font-mono"
          />
        </Field>
        <Field label="대표자">
          <TextField value={form.ceo} onChange={(e) => set('ceo', e.target.value)} maxLength={64} />
        </Field>
        <Field label="거래 구분">
          <SelectField value={form.type} onChange={(e) => set('type', e.target.value as Vendor['type'])} options={VENDOR_TYPES.map((t) => ({ value: t, label: t }))} />
        </Field>
        <Field label="사용 여부">
          <SelectField value={form.use} onChange={(e) => set('use', e.target.value as Vendor['use'])} options={VENDOR_USE.map((t) => ({ value: t, label: t }))} />
        </Field>
        <div className="col-span-2">
          <Field label="담당자 · 연락처">
            <TextField value={form.manager} onChange={(e) => set('manager', e.target.value)} maxLength={64} placeholder="예: 김영업 · 010-0000-0000" className="w-full" />
          </Field>
        </div>
        <div className="col-span-2">
          <Field label="주소">
            <TextField value={form.addr} onChange={(e) => set('addr', e.target.value)} maxLength={256} className="w-full" />
          </Field>
        </div>
      </div>
      {err && <p className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-[11.5px] font-semibold text-danger">{err}</p>}
    </Modal>
  );
}
