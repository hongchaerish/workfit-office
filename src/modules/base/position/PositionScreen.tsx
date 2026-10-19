import { useMemo, useState } from 'react';
import { usePositions, useRemovePosition, useUpsertPosition } from '@/features/position/usePositions';
import { useJobTitles, useRemoveJobTitle, useUpsertJobTitle } from '@/features/jobTitle/useJobTitles';
import { useQueryClient } from '@tanstack/react-query';
import { usePermission } from '@/features/auth/usePermission';
import { DEPARTMENT_MEMBERS_KEY } from '@/features/departmentMember/useDepartmentMembers';
import { jobTitleDeleteBlocker, positionDeleteBlocker } from '@/data/orgSync/orgSync';
import type { Position } from '@/domain/position/schema';
import type { JobTitle } from '@/domain/jobTitle/schema';

/**
 * 직급/직책 관리 (기준정보) — 직급명·서열(rank)·부서책임자 여부 및 직책(대표/임원/팀장/팀원) CRUD.
 * 탭을 전환하여 직급과 직책을 각각 독립적으로 관리할 수 있습니다.
 */
const BLANK_POS: Position = { id: '', name: '', rank: 5, isDeptHead: false, isLeaderRole: false, isExecutiveRole: false };
const BLANK_JOB: JobTitle = { id: '', name: '' };

export default function PositionScreen() {
  const { canAction } = usePermission();
  const canCreate = canAction('S_BASE_POSITION', 'create');
  const canUpdate = canAction('S_BASE_POSITION', 'update');
  const canDelete = canAction('S_BASE_POSITION', 'delete');

  const [tab, setTab] = useState<'position' | 'jobTitle'>('position');
  const [msg, setMsg] = useState('');
  const qc = useQueryClient();
  // 이름을 바꾸면 사람 정보 화면이 새 이름을 다시 읽게 한다
  const refreshPeople = () => { for (const key of ['users', 'employeeProfiles', DEPARTMENT_MEMBERS_KEY]) qc.invalidateQueries({ queryKey: [key] }); };

  /* ── 직급 (Position) ── */
  const { data: positions = [], isLoading: isPosLoading } = usePositions();
  const upsertPos = useUpsertPosition();
  const removePos = useRemovePosition();
  const sortedPositions = useMemo(() => [...positions].sort((a, b) => a.rank - b.rank), [positions]);

  /* ── 직책 (JobTitle) ── */
  const { data: jobTitles = [], isLoading: isJobLoading } = useJobTitles();
  const upsertJob = useUpsertJobTitle();
  const removeJob = useRemoveJobTitle();

  /* ── 통합 선택 상태 ── */
  const [selPos, setSelPos] = useState<Position | null>(null);
  const [selJob, setSelJob] = useState<JobTitle | null>(null);

  const nextPosId = () => {
    const n = positions.reduce((m, p) => Math.max(m, Number(p.id.replace(/\D/g, '')) || 0), 0) + 1;
    return `P${String(n).padStart(2, '0')}`;
  };

  const nextJobId = () => {
    const n = jobTitles.reduce((m, j) => Math.max(m, Number(j.id.replace(/\D/g, '')) || 0), 0) + 1;
    return `J${String(n).padStart(2, '0')}`;
  };

  const savePos = async () => {
    if (!selPos) return;
    if (!selPos.name.trim()) return setMsg('직급명을 입력하세요.');
    const item = { ...selPos, id: selPos.id || nextPosId() };
    const before = positions.find((p) => p.id === selPos.id);
    await upsertPos.mutateAsync(item);
    if (before && before.name !== item.name) refreshPeople();
    setMsg('저장되었습니다.');
    setSelPos(null);
  };

  const delPos = async (id: string) => {
    const target = positions.find((p) => p.id === id);
    const blocker = target ? await positionDeleteBlocker(target.id) : null;
    if (blocker) return window.alert(blocker);
    await removePos.mutateAsync(id);
    if (selPos?.id === id) setSelPos(null);
  };

  const saveJob = async () => {
    if (!selJob) return;
    if (!selJob.name.trim()) return setMsg('직책명을 입력하세요.');
    const item = { ...selJob, id: selJob.id || nextJobId() };
    const before = jobTitles.find((j) => j.id === selJob.id);
    await upsertJob.mutateAsync(item);
    if (before && before.name !== item.name) refreshPeople();
    setMsg('저장되었습니다.');
    setSelJob(null);
  };

  const delJob = async (id: string) => {
    const target = jobTitles.find((j) => j.id === id);
    const blocker = target ? await jobTitleDeleteBlocker(target.id) : null;
    if (blocker) return window.alert(blocker);
    await removeJob.mutateAsync(id);
    if (selJob?.id === id) setSelJob(null);
  };

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-ink">직급/직책 관리</h1>
          <p className="mt-0.5 text-xs text-ink3">기준 정보 / 직급 및 직책 관리</p>
        </div>
        {tab === 'position' ? (
          <button
            onClick={() => {
              setSelPos({ ...BLANK_POS });
              setMsg('');
            }}
            disabled={!canCreate}
            className="rounded-lg bg-teal px-3.5 py-2 text-[12.5px] font-bold text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            + 직급 추가
          </button>
        ) : (
          <button
            onClick={() => {
              setSelJob({ ...BLANK_JOB });
              setMsg('');
            }}
            disabled={!canCreate}
            className="rounded-lg bg-teal px-3.5 py-2 text-[12.5px] font-bold text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            + 직책 추가
          </button>
        )}
      </div>

      {/* 상단 탭 */}
      <div className="flex border-b border-border">
        <button
          onClick={() => {
            setTab('position');
            setSelPos(null);
            setSelJob(null);
            setMsg('');
          }}
          className={`px-4 py-2.5 text-[13.5px] font-bold transition-all ${
            tab === 'position' ? 'border-b-2 border-teal text-teal' : 'text-ink3 hover:text-ink'
          }`}
        >
          직급 관리
        </button>
        <button
          onClick={() => {
            setTab('jobTitle');
            setSelPos(null);
            setSelJob(null);
            setMsg('');
          }}
          className={`px-4 py-2.5 text-[13.5px] font-bold transition-all ${
            tab === 'jobTitle' ? 'border-b-2 border-teal text-teal' : 'text-ink3 hover:text-ink'
          }`}
        >
          직책 관리
        </button>
      </div>

      <div className="grid grid-cols-[1.4fr_1fr] items-start gap-3.5">
        {/* 목록 */}
        <div className="overflow-hidden rounded-xl border border-border bg-panel">
          {tab === 'position' ? (
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr>
                  {['서열', '직급명', '부서책임자', ''].map((h) => (
                    <th
                      key={h}
                      className="border-b border-border bg-panel-alt px-3.5 py-2.5 text-left text-[10.5px] font-bold text-ink2"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isPosLoading && (
                  <tr>
                    <td colSpan={4} className="px-3.5 py-8 text-center text-ink3">
                      불러오는 중…
                    </td>
                  </tr>
                )}
                {sortedPositions.map((p) => (
                  <tr
                    key={p.id}
                    onClick={() => {
                      setSelPos(p);
                      setMsg('');
                    }}
                    className={`cursor-pointer ${
                      selPos?.id === p.id ? 'bg-teal-soft/60' : 'hover:bg-panel-alt'
                    }`}
                  >
                    <td className="border-b border-border px-3.5 py-2.5 tabular-nums text-ink2">{p.rank}</td>
                    <td className="border-b border-border px-3.5 py-2.5 font-semibold text-ink">{p.name}</td>
                    <td className="border-b border-border px-3.5 py-2.5">
                      {p.isDeptHead ? (
                        <span className="rounded bg-teal/15 px-1.5 py-px text-[10px] font-bold text-teal">
                          책임자
                        </span>
                      ) : (
                        <span className="text-ink3">—</span>
                      )}
                    </td>
                    <td className="border-b border-border px-3.5 py-2.5 text-right">
                      {canDelete && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            delPos(p.id);
                          }}
                          className="text-[12px] text-ink3 hover:text-red-500"
                        >
                          삭제
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr>
                  {['직책명', ''].map((h) => (
                    <th
                      key={h}
                      className="border-b border-border bg-panel-alt px-3.5 py-2.5 text-left text-[10.5px] font-bold text-ink2"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isJobLoading && (
                  <tr>
                    <td colSpan={2} className="px-3.5 py-8 text-center text-ink3">
                      불러오는 중…
                    </td>
                  </tr>
                )}
                {jobTitles.map((j) => (
                  <tr
                    key={j.id}
                    onClick={() => {
                      setSelJob(j);
                      setMsg('');
                    }}
                    className={`cursor-pointer ${
                      selJob?.id === j.id ? 'bg-teal-soft/60' : 'hover:bg-panel-alt'
                    }`}
                  >
                    <td className="border-b border-border px-3.5 py-2.5 font-semibold text-ink">{j.name}</td>
                    <td className="border-b border-border px-3.5 py-2.5 text-right">
                      {canDelete && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            delJob(j.id);
                          }}
                          className="text-[12px] text-ink3 hover:text-red-500"
                        >
                          삭제
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* 편집 */}
        <div className="rounded-xl border border-border bg-panel p-4">
          {tab === 'position' ? (
            selPos ? (
              <div className="space-y-3">
                <div className="text-[13px] font-bold text-ink">
                  {selPos.id ? '직급 편집' : '새 직급'}
                </div>
                <Field label="직급명">
                  <input
                    value={selPos.name}
                    onChange={(e) => setSelPos({ ...selPos, name: e.target.value })}
                    className="w-full rounded-lg border border-border-hi bg-panel-alt px-3 py-2 text-[13px] text-ink outline-none focus:border-teal"
                  />
                </Field>
                <Field label="서열(rank, 작을수록 상위)">
                  <input
                    type="number"
                    value={selPos.rank}
                    onChange={(e) => setSelPos({ ...selPos, rank: Number(e.target.value) })}
                    className="w-full rounded-lg border border-border-hi bg-panel-alt px-3 py-2 text-[13px] text-ink outline-none focus:border-teal"
                  />
                </Field>
                <div className="space-y-1.5 pt-1">
                  <label className="flex items-center gap-2 text-[12.5px] text-ink2">
                    <input
                      type="checkbox"
                      checked={selPos.isDeptHead}
                      onChange={(e) => setSelPos({ ...selPos, isDeptHead: e.target.checked })}
                    />{' '}
                    부서 책임자 직급(팀장 등)
                  </label>
                  <label className="flex items-center gap-2 text-[12.5px] text-ink2">
                    <input
                      type="checkbox"
                      checked={selPos.isLeaderRole ?? false}
                      onChange={(e) => setSelPos({ ...selPos, isLeaderRole: e.target.checked })}
                    />{' '}
                    리더/책임자 권한 자동 부여 (isLeaderRole)
                  </label>
                  <label className="flex items-center gap-2 text-[12.5px] text-ink2">
                    <input
                      type="checkbox"
                      checked={selPos.isExecutiveRole ?? false}
                      onChange={(e) => setSelPos({ ...selPos, isExecutiveRole: e.target.checked })}
                    />{' '}
                    임원/경영진 권한 자동 부여 (isExecutiveRole)
                  </label>
                </div>
                {msg && <p className="text-[11.5px] font-semibold text-teal">{msg}</p>}
                <div className="flex justify-end gap-2 pt-1">
                  <button
                    onClick={() => setSelPos(null)}
                    className="rounded-lg px-3.5 py-2 text-[12.5px] font-semibold text-ink3 hover:bg-panel-alt"
                  >
                    취소
                  </button>
                  <button
                    onClick={savePos}
                    disabled={upsertPos.isPending || (selPos.id ? !canUpdate : !canCreate)}
                    className="rounded-lg bg-teal px-4 py-2 text-[12.5px] font-bold text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    저장
                  </button>
                </div>
              </div>
            ) : (
              <div className="py-16 text-center text-[12px] text-ink3">직급을 선택하거나 추가하세요.</div>
            )
          ) : selJob ? (
            <div className="space-y-3">
              <div className="text-[13px] font-bold text-ink">
                {selJob.id ? '직책 편집' : '새 직책'}
              </div>
              <Field label="직책명">
                <input
                  value={selJob.name}
                  onChange={(e) => setSelJob({ ...selJob, name: e.target.value })}
                  className="w-full rounded-lg border border-border-hi bg-panel-alt px-3 py-2 text-[13px] text-ink outline-none focus:border-teal"
                  placeholder="예: 팀장"
                />
              </Field>
              {msg && <p className="text-[11.5px] font-semibold text-teal">{msg}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <button
                  onClick={() => setSelJob(null)}
                  className="rounded-lg px-3.5 py-2 text-[12.5px] font-semibold text-ink3 hover:bg-panel-alt"
                >
                  취소
                </button>
                <button
                  onClick={saveJob}
                  disabled={upsertJob.isPending || (selJob.id ? !canUpdate : !canCreate)}
                  className="rounded-lg bg-teal px-4 py-2 text-[12.5px] font-bold text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  저장
                </button>
              </div>
            </div>
          ) : (
            <div className="py-16 text-center text-[12px] text-ink3">직책을 선택하거나 추가하세요.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-bold text-ink2">{label}</span>
      {children}
    </label>
  );
}
