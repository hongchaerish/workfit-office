import { useMemo, useState } from 'react';
import { Link2, Unlink } from 'lucide-react';
import { Modal } from '@/shared/ui/Modal';
import { Button } from '@/shared/ui/Button';
import { Pill } from '@/shared/ui/Pill';
import { SelectField } from '@/shared/ui/form/SelectField';
import type { Vendor } from '@/domain/vendor/schema';
import type { WorkProject } from '@/domain/workProject/schema';
import { WORK_PROJECT_STATUS_LABELS } from '@/domain/workProject/schema';
import {
  VENDOR_PROJECT_ROLES,
  isOngoingProject,
  projectsOfVendor,
  type VendorProjectLink,
  type VendorProjectRole,
} from '@/domain/bizVendor/schema';
import { useLinkVendorProject, useUnlinkVendorProject } from '@/features/bizVendor/useBizVendor';
import { useUsers } from '@/features/user/useUsers';
import { bizTd, bizTh } from '../_biz';

const dateOf = (iso: string | null) => (iso ? iso.slice(0, 10) : '');

/** 도입기업 상세 — 기본 정보 + 이 도입기업과 진행하는 사업(연결·해제). */
export function VendorDetailModal({
  vendor,
  links,
  projects,
  canEdit,
  actorId,
  onEdit,
  onClose,
}: {
  vendor: Vendor;
  links: VendorProjectLink[];
  projects: WorkProject[];
  canEdit: boolean;
  actorId: string;
  onEdit: () => void;
  onClose: () => void;
}) {
  const rows = useMemo(() => projectsOfVendor(vendor, links, projects), [vendor, links, projects]);
  const [showDone, setShowDone] = useState(false);
  const visible = showDone ? rows : rows.filter((r) => isOngoingProject(r.project));
  const doneCount = rows.length - rows.filter((r) => isOngoingProject(r.project)).length;

  const linkedIds = new Set(rows.filter((r) => r.source === 'link').map((r) => r.project.id));
  const candidates = projects.filter((p) => !linkedIds.has(p.id));
  const [pick, setPick] = useState('');
  const [role, setRole] = useState<VendorProjectRole>('발주처');
  const [err, setErr] = useState<string | null>(null);
  const { data: users = [] } = useUsers();
  const ownerName = (userId: string) => {
    const u = users.find((x) => x.id === userId);
    return u ? `${u.name} ${u.position ?? ''}`.trim() : '-';
  };
  const link = useLinkVendorProject();
  const unlink = useUnlinkVendorProject();

  const doLink = async (projectId: string, r: VendorProjectRole) => {
    setErr(null);
    try {
      await link.mutateAsync({ vendorCode: vendor.code, projectId, role: r, actorId });
      setPick('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : '사업을 연결하지 못했습니다.');
    }
  };
  const doUnlink = async (id: string, name: string) => {
    if (!window.confirm(`'${name}' 사업과의 연결을 해제할까요? 도입기업과 사업 정보는 지워지지 않습니다.`)) return;
    setErr(null);
    try {
      await unlink.mutateAsync(id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '연결을 해제하지 못했습니다.');
    }
  };

  const info: [string, string][] = [
    ['도입기업코드', vendor.code],
    ['사업자번호', vendor.bizNo || '-'],
    ['대표자', vendor.ceo || '-'],
    ['거래 구분', vendor.type],
    ['사용 여부', vendor.use],
    ['주소', vendor.addr || '-'],
  ];

  return (
    <Modal open onClose={onClose} title={vendor.name} width={880} footer={canEdit ? <Button onClick={onEdit}>도입기업 정보 수정</Button> : undefined}>
      <div className="flex flex-col gap-5">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2.5 rounded-lg border border-border bg-panel-alt/40 p-4 text-[12px]">
          {info.map(([k, v]) => (
            <div key={k} className={`flex gap-3 ${k === '주소' ? 'col-span-2' : ''}`}>
              <dt className="w-24 shrink-0 font-bold text-ink3">{k}</dt>
              <dd className={`min-w-0 text-ink ${k === '사업자번호' || k === '도입기업코드' ? 'font-mono' : ''}`}>{v}</dd>
            </div>
          ))}
        </dl>

        <section className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <h3 className="text-[13px] font-extrabold text-ink">
              진행 중인 사업 <span className="text-teal">{rows.length - doneCount}</span>
            </h3>
            {doneCount > 0 && (
              <label className="flex items-center gap-1.5 text-[11px] text-ink3">
                <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
                완료·보관 사업 {doneCount}건도 보기
              </label>
            )}
          </div>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr>
                  {['프로젝트 번호', '관련 사업명', '관계', '담당자', '기간', '상태', ''].map((h) => <th key={h} className={bizTh}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 && (
                  <tr><td colSpan={7} className="px-3 py-8 text-center text-[12px] text-ink3">연결된 사업이 없습니다.</td></tr>
                )}
                {visible.map((r) => {
                  const p = r.project;
                  const period = [dateOf(p.contractStartAt ?? p.startAt), dateOf(p.contractEndAt ?? p.dueAt)].filter(Boolean).join(' ~ ');
                  return (
                    <tr key={p.id} className={isOngoingProject(p) ? '' : 'opacity-60'}>
                      <td className={`${bizTd} font-mono font-bold text-ink`}>{p.code}</td>
                      <td className={bizTd}>
                        <div className="font-semibold text-ink">{p.name}</div>
                        {p.contractNo && <div className="font-mono text-[10.5px] text-ink3">계약 {p.contractNo}</div>}
                      </td>
                      <td className={bizTd}>
                        <Pill tone={r.role === '발주처' ? 'info' : r.role === '매입처' ? 'ok' : 'mute'}>{r.role}</Pill>
                        {r.source === 'clientName' && <span className="ml-1.5 text-[10.5px] text-ink3" title="프로젝트의 발주처명이 이 도입기업명과 같아 보입니다">발주처명 일치</span>}
                      </td>
                      <td className={`${bizTd} text-ink2`}>{ownerName(p.ownerUserId)}</td>
                      <td className={`${bizTd} tabular-nums text-ink2`}>{period || '-'}</td>
                      <td className={bizTd}><Pill tone={isOngoingProject(p) ? 'ok' : 'mute'}>{WORK_PROJECT_STATUS_LABELS[p.status]}</Pill></td>
                      <td className={`${bizTd} text-right`}>
                        {canEdit && r.source === 'link' && r.linkId && (
                          <Button size="sm" variant="danger" onClick={() => doUnlink(r.linkId!, p.name)} disabled={unlink.isPending}>
                            <Unlink size={11} /> 해제
                          </Button>
                        )}
                        {canEdit && r.source === 'clientName' && (
                          <Button size="sm" variant="accent" onClick={() => doLink(p.id, '발주처')} disabled={link.isPending}>
                            <Link2 size={11} /> 연결 확정
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {canEdit && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border p-3">
              <span className="text-[11.5px] font-bold text-ink2">사업 연결</span>
              <div className="min-w-[280px] flex-1">
                <SelectField
                  value={pick}
                  onChange={(e) => setPick(e.target.value)}
                  options={[{ value: '', label: candidates.length ? '사업(프로젝트) 선택' : '연결할 수 있는 사업이 없습니다' }, ...candidates.map((p) => ({ value: p.id, label: `[${p.code}] ${p.name}` }))]}
                />
              </div>
              <div className="w-28">
                <SelectField value={role} onChange={(e) => setRole(e.target.value as VendorProjectRole)} options={VENDOR_PROJECT_ROLES.map((r) => ({ value: r, label: r }))} />
              </div>
              <Button variant="primary" onClick={() => pick && doLink(pick, role)} disabled={!pick || link.isPending}>
                <Link2 size={12} /> 연결
              </Button>
            </div>
          )}
          {err && <p className="rounded-lg bg-danger/10 px-3 py-2 text-[11.5px] font-semibold text-danger">{err}</p>}
          <p className="text-[10.5px] text-ink3">사업은 그룹웨어 › 프로젝트에 등록된 것만 보입니다(볼 권한이 있는 사업만).</p>
        </section>
      </div>
    </Modal>
  );
}
