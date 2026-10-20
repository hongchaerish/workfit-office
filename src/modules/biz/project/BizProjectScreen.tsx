import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RotateCcw, Search } from 'lucide-react';
import { Button } from '@/shared/ui/Button';
import { Pill } from '@/shared/ui/Pill';
import { Field } from '@/shared/ui/form/Field';
import { TextField } from '@/shared/ui/form/TextField';
import { SelectField } from '@/shared/ui/form/SelectField';
import { WORK_PROJECT_STATUS_LABELS, projectTypeLabel, type WorkProject } from '@/domain/workProject/schema';
import { isOngoingProject, normalizeCompanyName, type VendorProjectRole } from '@/domain/bizVendor/schema';
import { useVendors } from '@/features/vendor/useVendors';
import { useProjects } from '@/features/project/useProjects';
import { useUsers } from '@/features/user/useUsers';
import { useProjectAccess, useVendorProjectLinks } from '@/features/bizVendor/useBizVendor';
import { BizEmptyRow, BizHead, BizListCard, BizPager, bizTd, bizTh } from '../_biz';

type StatusFilter = 'ongoing' | 'done' | 'all';
const EMPTY = { status: 'ongoing' as StatusFilter, q: '' };
const dateOf = (iso: string | null) => (iso ? iso.slice(0, 10) : '');

interface PartnerTag {
  name: string;
  role: VendorProjectRole;
}

/** 사업관리 › 사업 현황 — 업무관리 프로젝트를 사업 관점(번호·사업명·거래처)으로 본다. */
export default function BizProjectScreen() {
  const navigate = useNavigate();
  const access = useProjectAccess();
  const { data: projects = [], isLoading } = useProjects(access);
  const { data: vendors = [] } = useVendors();
  const { data: links = [] } = useVendorProjectLinks();
  const { data: users = [] } = useUsers();

  const [draft, setDraft] = useState(EMPTY);
  const [applied, setApplied] = useState(EMPTY);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  /** 사업별 연결 거래처 — 연결표 + 연결이 없을 때 발주처명과 같은 이름의 거래처. */
  const partnersOf = useMemo(() => {
    const vendorByCode = new Map(vendors.map((v) => [v.code, v]));
    const vendorByName = new Map(vendors.map((v) => [normalizeCompanyName(v.name), v]));
    const m = new Map<string, PartnerTag[]>();
    for (const l of links) {
      const v = vendorByCode.get(l.vendorCode);
      if (!v) continue;
      m.set(l.projectId, [...(m.get(l.projectId) ?? []), { name: v.name, role: l.role }]);
    }
    return (p: WorkProject): PartnerTag[] => {
      const tags = [...(m.get(p.id) ?? [])];
      if (p.clientName && !tags.some((t) => t.role === '발주처')) {
        const v = vendorByName.get(normalizeCompanyName(p.clientName));
        tags.push({ name: v?.name ?? p.clientName, role: '발주처' });
      }
      return tags;
    };
  }, [vendors, links]);

  const userName = useMemo(() => new Map(users.map((u) => [u.id, u.name])), [users]);

  const rows = useMemo(() => {
    const kw = applied.q.trim().toLowerCase();
    return projects
      .filter((p) => applied.status === 'all' || (applied.status === 'ongoing') === isOngoingProject(p))
      .filter((p) =>
        !kw ||
        [p.code, p.name, p.contractNo ?? '', ...partnersOf(p).map((t) => t.name)].some((s) => s.toLowerCase().includes(kw)),
      )
      .sort((a, b) => a.code.localeCompare(b.code));
  }, [projects, applied, partnersOf]);

  const pageRows = rows.slice((page - 1) * pageSize, page * pageSize);
  const search = () => { setApplied(draft); setPage(1); };
  const reset = () => { setDraft(EMPTY); setApplied(EMPTY); setPage(1); };

  return (
    <div className="flex flex-col gap-4">
      <BizHead group="사업 관리" title="사업 현황" desc="그룹웨어 › 프로젝트에 등록된 사업을 프로젝트 번호·사업명·거래처 기준으로 봅니다. 거래처 연결은 거래처 정보에서 합니다." />

      <div className="flex flex-wrap items-end gap-3 rounded-[10px] border border-border bg-panel p-4">
        <div className="w-32">
          <Field label="상태">
            <SelectField
              value={draft.status}
              onChange={(e) => setDraft({ ...draft, status: e.target.value as StatusFilter })}
              options={[{ value: 'ongoing', label: '진행 중' }, { value: 'done', label: '완료·보관' }, { value: 'all', label: '전체' }]}
            />
          </Field>
        </div>
        <div className="min-w-[240px] flex-1">
          <Field label="프로젝트 번호·사업명·거래처 검색">
            <TextField
              value={draft.q}
              onChange={(e) => setDraft({ ...draft, q: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && search()}
              placeholder="프로젝트 번호, 사업명, 계약번호 또는 거래처명을 입력하세요."
              className="w-full"
            />
          </Field>
        </div>
        <div className="flex gap-2">
          <Button variant="primary" onClick={search}><Search size={13} /> 검색</Button>
          <Button onClick={reset}><RotateCcw size={13} /> 초기화</Button>
        </div>
      </div>

      <BizListCard
        title="사업 목록"
        count={`총 ${rows.length}개 사업`}
        footer={<BizPager total={rows.length} page={page} pageSize={pageSize} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} />}
      >
        <table className="w-full border-collapse text-left">
          <thead>
            <tr>
              {['No.', '프로젝트 번호', '관련 사업명', '유형', '거래처', '계약번호', '기간', '책임자', '상태'].map((h, i) => (
                <th key={h} className={`${bizTh} ${i === 0 || i === 8 ? 'text-center' : ''}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading && <BizEmptyRow colSpan={9}>불러오는 중…</BizEmptyRow>}
            {!isLoading && rows.length === 0 && <BizEmptyRow colSpan={9}>{projects.length ? '검색 조건에 맞는 사업이 없습니다.' : '볼 수 있는 사업이 없습니다.'}</BizEmptyRow>}
            {pageRows.map((p, i) => {
              const tags = partnersOf(p);
              const period = [dateOf(p.contractStartAt ?? p.startAt), dateOf(p.contractEndAt ?? p.dueAt)].filter(Boolean).join(' ~ ');
              return (
                <tr
                  key={p.id}
                  onClick={() => navigate(`/gw/task?project=${encodeURIComponent(p.id)}`)}
                  title="그룹웨어 › 프로젝트에서 열기"
                  className="cursor-pointer transition-colors hover:bg-panel-alt/60"
                >
                  <td className={`${bizTd} text-center text-ink3`}>{(page - 1) * pageSize + i + 1}</td>
                  <td className={`${bizTd} font-mono font-bold text-ink`}>{p.code}</td>
                  <td className={`${bizTd} font-semibold text-ink`}>{p.name}</td>
                  <td className={`${bizTd} text-ink2`}>{projectTypeLabel(p)}</td>
                  <td className={bizTd}>
                    {tags.length === 0 ? (
                      <span className="text-ink3">-</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {tags.map((t) => (
                          <span key={`${t.role}-${t.name}`} className="rounded-md bg-panel-alt px-1.5 py-0.5 text-[11px] text-ink2">
                            <b className="mr-1 text-[10px] text-teal">{t.role}</b>{t.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className={`${bizTd} font-mono text-ink2`}>{p.contractNo || '-'}</td>
                  <td className={`${bizTd} tabular-nums text-ink2`}>{period || '-'}</td>
                  <td className={`${bizTd} text-ink2`}>{userName.get(p.ownerUserId) ?? '-'}</td>
                  <td className={`${bizTd} text-center`}><Pill tone={isOngoingProject(p) ? 'ok' : 'mute'}>{WORK_PROJECT_STATUS_LABELS[p.status]}</Pill></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </BizListCard>
    </div>
  );
}
