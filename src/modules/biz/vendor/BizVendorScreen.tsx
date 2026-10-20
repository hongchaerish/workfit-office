import { useMemo, useState } from 'react';
import { Plus, RotateCcw, Search } from 'lucide-react';
import { Button } from '@/shared/ui/Button';
import { Pill, type Tone } from '@/shared/ui/Pill';
import { Field } from '@/shared/ui/form/Field';
import { TextField } from '@/shared/ui/form/TextField';
import { SelectField } from '@/shared/ui/form/SelectField';
import { VENDOR_TYPES, type Vendor } from '@/domain/vendor/schema';
import { bizNoDigits, isOngoingProject, projectsOfVendor } from '@/domain/bizVendor/schema';
import { useVendors } from '@/features/vendor/useVendors';
import { useProjects } from '@/features/project/useProjects';
import { usePermission } from '@/features/auth/usePermission';
import { useProjectAccess, useVendorProjectLinks } from '@/features/bizVendor/useBizVendor';
import { BizEmptyRow, BizHead, BizListCard, BizPager, bizTd, bizTh } from '../_biz';
import { VendorFormModal } from './VendorFormModal';
import { VendorDetailModal } from './VendorDetailModal';

const TYPE_TONE: Record<Vendor['type'], Tone> = { 매입: 'info', 매출: 'ok', 외주: 'mute' };
const EMPTY = { type: '', use: '', q: '' };

/** 사업관리 › 도입기업 정보 — 도입기업 목록·등록·수정 + 도입기업별 진행 사업. */
export default function BizVendorScreen() {
  const { canAction } = usePermission();
  const canCreate = canAction('S_BIZ_VENDOR', 'create');
  const canUpdate = canAction('S_BIZ_VENDOR', 'update');

  const { data: vendors = [], isLoading } = useVendors();
  const { data: links = [] } = useVendorProjectLinks();
  const access = useProjectAccess();
  const { data: projects = [] } = useProjects(access);

  const [draft, setDraft] = useState(EMPTY);
  const [applied, setApplied] = useState(EMPTY);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const rows = useMemo(() => {
    const kw = applied.q.trim().toLowerCase();
    const kwDigits = bizNoDigits(applied.q);
    return vendors
      .filter((v) => (!applied.type || v.type === applied.type) && (!applied.use || v.use === applied.use))
      .filter((v) =>
        !kw ||
        v.name.toLowerCase().includes(kw) ||
        v.code.toLowerCase().includes(kw) ||
        (kwDigits.length >= 3 && bizNoDigits(v.bizNo).includes(kwDigits)),
      )
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  }, [vendors, applied]);

  /** 도입기업별 진행 중 사업 수. */
  const ongoingCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of vendors) m.set(v.code, projectsOfVendor(v, links, projects).filter((r) => isOngoingProject(r.project)).length);
    return m;
  }, [vendors, links, projects]);

  const pageRows = rows.slice((page - 1) * pageSize, page * pageSize);
  const search = () => { setApplied(draft); setPage(1); };
  const reset = () => { setDraft(EMPTY); setApplied(EMPTY); setPage(1); };

  const [detailCode, setDetailCode] = useState<string | null>(null);
  const [form, setForm] = useState<{ vendor: Vendor | null } | null>(null);
  const detail = vendors.find((v) => v.code === detailCode) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <BizHead group="도입기업" title="도입기업 정보" desc="도입기업의 사업자 정보와 그 도입기업과 진행 중인 사업(프로젝트)을 관리합니다." />

      {/* 검색 */}
      <div className="flex flex-wrap items-end gap-3 rounded-[10px] border border-border bg-panel p-4">
        <div className="w-32">
          <Field label="거래 구분">
            <SelectField value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })} options={[{ value: '', label: '전체' }, ...VENDOR_TYPES.map((t) => ({ value: t, label: t }))]} />
          </Field>
        </div>
        <div className="w-28">
          <Field label="사용 여부">
            <SelectField value={draft.use} onChange={(e) => setDraft({ ...draft, use: e.target.value })} options={[{ value: '', label: '전체' }, { value: '사용', label: '사용' }, { value: '미사용', label: '미사용' }]} />
          </Field>
        </div>
        <div className="min-w-[240px] flex-1">
          <Field label="도입기업명·사업자번호 검색">
            <TextField
              value={draft.q}
              onChange={(e) => setDraft({ ...draft, q: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && search()}
              placeholder="도입기업명 또는 사업자번호를 입력하세요."
              className="w-full"
            />
          </Field>
        </div>
        <div className="flex gap-2">
          <Button variant="primary" onClick={search}><Search size={13} /> 검색</Button>
          <Button onClick={reset}><RotateCcw size={13} /> 초기화</Button>
          {canCreate && <Button variant="accent" onClick={() => setForm({ vendor: null })}><Plus size={13} /> 신규 등록</Button>}
        </div>
      </div>

      {/* 목록 */}
      <BizListCard
        title="도입기업 목록"
        count={`총 ${rows.length}개 도입기업`}
        footer={<BizPager total={rows.length} page={page} pageSize={pageSize} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} />}
      >
        <table className="w-full border-collapse text-left">
          <thead>
            <tr>
              {['No.', '도입기업명', '사업자번호', '대표자', '구분', '진행 사업', '사용', '관리'].map((h, i) => (
                <th key={h} className={`${bizTh} ${i === 0 || i >= 5 ? 'text-center' : ''}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading && <BizEmptyRow colSpan={8}>불러오는 중…</BizEmptyRow>}
            {!isLoading && rows.length === 0 && <BizEmptyRow colSpan={8}>{vendors.length ? '검색 조건에 맞는 도입기업이 없습니다.' : '등록된 도입기업이 없습니다.'}</BizEmptyRow>}
            {pageRows.map((v, i) => {
              const n = ongoingCount.get(v.code) ?? 0;
              return (
                <tr key={v.code} onClick={() => setDetailCode(v.code)} className="cursor-pointer transition-colors hover:bg-panel-alt/60">
                  <td className={`${bizTd} text-center text-ink3`}>{(page - 1) * pageSize + i + 1}</td>
                  <td className={bizTd}>
                    <div className="font-bold text-ink">{v.name}</div>
                    <div className="font-mono text-[10.5px] text-ink3">{v.code}</div>
                  </td>
                  <td className={`${bizTd} font-mono text-ink2`}>{v.bizNo || '-'}</td>
                  <td className={`${bizTd} text-ink2`}>{v.ceo || '-'}</td>
                  <td className={bizTd}><Pill tone={TYPE_TONE[v.type]}>{v.type}</Pill></td>
                  <td className={`${bizTd} text-center font-bold ${n ? 'text-teal' : 'text-ink3'}`}>{n}건</td>
                  <td className={`${bizTd} text-center`}><Pill tone={v.use === '사용' ? 'ok' : 'mute'}>{v.use}</Pill></td>
                  <td className={`${bizTd} text-center`} onClick={(e) => e.stopPropagation()}>
                    {canUpdate ? (
                      <Button size="sm" onClick={() => setForm({ vendor: v })}>수정</Button>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => setDetailCode(v.code)}>보기</Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </BizListCard>

      {detail && (
        <VendorDetailModal
          vendor={detail}
          links={links}
          projects={projects}
          canEdit={canUpdate}
          actorId={access.userId}
          onEdit={() => setForm({ vendor: detail })}
          onClose={() => setDetailCode(null)}
        />
      )}
      {form && (
        <VendorFormModal
          key={form.vendor?.code ?? 'new'}
          open
          vendor={form.vendor}
          allVendors={vendors}
          onClose={() => setForm(null)}
          onSaved={() => setForm(null)}
        />
      )}
    </div>
  );
}
