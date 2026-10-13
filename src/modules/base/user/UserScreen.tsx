import { useMemo, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Card } from '@/shared/ui/Card';
import { Kpi } from '@/shared/ui/Kpi';
import { Pill, type Tone } from '@/shared/ui/Pill';
import { DataTable, type Column } from '@/shared/ui/DataTable';
import { ActionBar } from '@/shared/ui/ActionBar';
import { FilterBar, FilterField, Select, TextInput, type Option } from '@/shared/ui/FilterBar';
import { type User } from '@/domain/user/schema';
import { useUsers, useUpsertUser, useRemoveUsers } from '@/features/user/useUsers';
import { usePermission } from '@/features/auth/usePermission';
import { useRoleGroups } from '@/features/roleGroup/useRoleGroups';
import { useOrgTree } from '@/features/gw/useOrgTree';
import { resolveUserRoleNames } from '@/domain/roleGroup/roleResolver';
import UserFormModal, { type UserFormValues } from './UserFormModal';
import ResignModal from './ResignModal';
import { successionRepo, SUCCESSION_UPDATED_EVENT } from '@/data/succession/succession.repo';
import type { ApprovalSuccession } from '@/data/seeds/succession.seed';
import { useEffect } from 'react';


const STATUS_TONE: Record<User['status'], Tone> = { 사용: 'ok', 잠금: 'warn', 미사용: 'mute' };

const STATUS_OPTIONS: Option[] = [
  { value: '', label: '전체' },
  { value: '사용', label: '사용' },
  { value: '잠금', label: '잠금' },
  { value: '미사용', label: '미사용' },
];

/** 사용자관리 — 필터 + KPI 요약 + 목록(사번·이름·부서·직급·직책·상태·최근접속) + CRUD. */
export default function UserScreen() {
  const { canAction } = usePermission();
  const canCreate = canAction('S_BASE_USER', 'create');
  const canDelete = canAction('S_BASE_USER', 'delete');
  const canUpdate = canAction('S_BASE_USER', 'update');

  // 사용여부 필터 기본값 '' (전체) — 미사용(퇴사 등) 계정도 기본 화면에서 함께 확인 가능.
  const [draft, setDraft] = useState({ dept: '', status: '', q: '' });
  const [applied, setApplied] = useState(draft);
  const [selected, setSelected] = useState<Array<string | number>>([]);
  const [editing, setEditing] = useState<User | null | undefined>(undefined);
  const [resigning, setResigning] = useState<User | null>(null);
  const [notice, setNotice] = useState<string>('');

  // ── 권한 승계(인수인계) 동적 관리 상태 및 핸들러 ──
  const [successions, setSuccessions] = useState<ApprovalSuccession[]>([]);
  const [predSelectId, setPredSelectId] = useState<string>('');
  const [succSelectId, setSuccSelectId] = useState<string>('');

  useEffect(() => {
    const refresh = () => setSuccessions(successionRepo.getAll());
    refresh();
    window.addEventListener(SUCCESSION_UPDATED_EVENT, refresh);
    return () => window.removeEventListener(SUCCESSION_UPDATED_EVENT, refresh);
  }, []);

  const handleAddSuccession = async () => {
    if (!predSelectId || !succSelectId) {
      alert('전임자와 후임자를 모두 선택해 주세요.');
      return;
    }
    if (predSelectId === succSelectId) {
      alert('전임자와 후임자는 동일인물일 수 없습니다.');
      return;
    }
    try {
      await successionRepo.add(predSelectId, succSelectId);
    } catch (e) {
      alert(`권한 승계 저장에 실패했습니다: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    setPredSelectId('');
    setSuccSelectId('');
    setNotice('권한 승계 관계가 성공적으로 등록되었습니다.');
  };

  const handleDeleteSuccession = async (id: string) => {
    if (confirm('선택한 권한 승계 관계를 삭제하시겠습니까?')) {
      try {
        await successionRepo.delete(id);
      } catch (e) {
        alert(`권한 승계 삭제에 실패했습니다: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
      setNotice('권한 승계 관계가 삭제되었습니다.');
    }
  };

  const { data: all = [] } = useUsers();
  const { data: rows = [] } = useUsers(applied);
  const { data: roleGroups = [] } = useRoleGroups();
  const org = useOrgTree();
  const upsert = useUpsertUser();
  const removeUsers = useRemoveUsers();

  const deptOptions: Option[] = [
    { value: '', label: '전체' },
    ...[...new Set(all.map((u) => u.dept))].map((d) => ({ value: d, label: d })),
  ];

  const summary = useMemo(
    () => ({
      total: all.length,
      active: all.filter((u) => u.status === '사용').length,
      locked: all.filter((u) => u.status === '잠금').length,
      inactive: all.filter((u) => u.status === '미사용').length,
    }),
    [all],
  );

  const columns: Column<User>[] = [
    { key: 'empNo', header: '사번 (ID)', mono: true, sortable: true, width: 110 },
    { key: 'name', header: '이름', sortable: true, width: 100 },
    { key: 'email', header: '이메일', sortable: true },
    {
      key: 'dept',
      header: '소속 부서',
      sortable: true,
      width: 140,
      render: (u) => (
        <span className={u.dept && u.dept !== '미지정' ? 'text-ink2' : 'text-ink3 italic'}>
          {u.dept || '미지정'}
        </span>
      ),
    },
    {
      key: 'roles' as any,
      header: '부여된 역할 (권한그룹)',
      width: 180,
      render: (u) => {
        const roleNames = resolveUserRoleNames(u, roleGroups, org);
        return (
          <div className="flex flex-wrap gap-1">
            {roleNames.map((rn) => (
              <span
                key={rn}
                className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
                  rn.includes('관리자')
                    ? 'bg-amber-100 text-amber-800'
                    : rn.includes('일반')
                    ? 'bg-slate-100 text-slate-700'
                    : 'bg-teal-100 text-teal-800'
                }`}
              >
                {rn}
              </span>
            ))}
          </div>
        );
      },
    },
    {
      key: 'status',
      header: '계정 상태',
      align: 'center',
      sortable: true,
      width: 90,
      render: (u) => (
        <Pill tone={STATUS_TONE[u.status]} solid={u.status === '잠금'}>
          {u.status}
        </Pill>
      ),
    },
    { key: 'lastLogin', header: '최근 접속', align: 'right', mono: true, sortable: true, width: 140 },
  ];

  const handleSubmit = (values: UserFormValues, id?: string) => {
    upsert.mutate({ values, id });
  };
  const handleDelete = () => {
    if (selected.length === 0) return;
    removeUsers.mutate(selected);
    setSelected([]);
  };

  // 퇴사 처리 — 정확히 1명 선택 + 아직 미사용이 아닌 경우만.
  const singleSelected =
    selected.length === 1 ? all.find((u) => String(u.id) === String(selected[0])) ?? null : null;
  const canResign = !!singleSelected && singleSelected.status !== '미사용';
  const handleResign = () => {
    if (singleSelected) setResigning(singleSelected);
  };

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-ink">사용자관리</h1>
          <p className="mt-0.5 text-xs text-ink3">기준 정보 / 사용자관리</p>
        </div>
        <ActionBar actions={['refresh']} />
      </div>

      {/* 퇴사 처리 결과 알림 */}
      {notice && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-teal-300 bg-teal-soft px-3.5 py-2.5 text-[12px] text-navy">
          <span className="flex items-center gap-1.5"><CheckCircle2 size={15} className="text-teal" /> {notice}</span>
          <button className="font-semibold underline-offset-2 hover:underline" onClick={() => setNotice('')}>
            닫기
          </button>
        </div>
      )}

      {/* 필터 */}
      <FilterBar onSearch={() => setApplied(draft)}>
        <FilterField label="부서">
          <Select value={draft.dept} onChange={(v) => setDraft({ ...draft, dept: v })} options={deptOptions} width={130} />
        </FilterField>
        <FilterField label="사용여부">
          <Select value={draft.status} onChange={(v) => setDraft({ ...draft, status: v })} options={STATUS_OPTIONS} width={100} />
        </FilterField>
        <FilterField label="검색">
          <TextInput value={draft.q} onChange={(v) => setDraft({ ...draft, q: v })} placeholder="사번 / 이름" width={180} onEnter={() => setApplied(draft)} />
        </FilterField>
      </FilterBar>

      {/* KPI 요약 (클릭 시 해당 상태로 빠른 필터링) */}
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <div
          className="cursor-pointer transition-transform active:scale-[0.98]"
          onClick={() => {
            const next = { ...draft, status: '' };
            setDraft(next);
            setApplied(next);
          }}
          title="클릭하여 전체 사용자 보기"
        >
          <Card className={`transition-colors ${applied.status === '' ? 'border-teal ring-1 ring-teal/30' : 'hover:border-border-hi'}`}>
            <Kpi label="전체 사용자" value={String(summary.total)} unit="명" />
          </Card>
        </div>
        <div
          className="cursor-pointer transition-transform active:scale-[0.98]"
          onClick={() => {
            const next = { ...draft, status: '사용' };
            setDraft(next);
            setApplied(next);
          }}
          title="클릭하여 사용중인 사용자만 보기"
        >
          <Card className={`transition-colors ${applied.status === '사용' ? 'border-teal ring-1 ring-teal/30' : 'hover:border-border-hi'}`}>
            <Kpi label="사용중" value={String(summary.active)} unit="명" tone="teal" />
          </Card>
        </div>
        <div
          className="cursor-pointer transition-transform active:scale-[0.98]"
          onClick={() => {
            const next = { ...draft, status: '잠금' };
            setDraft(next);
            setApplied(next);
          }}
          title="클릭하여 잠금 상태 사용자만 보기"
        >
          <Card className={`transition-colors ${applied.status === '잠금' ? 'border-teal ring-1 ring-teal/30' : 'hover:border-border-hi'}`}>
            <Kpi label="잠금" value={String(summary.locked)} unit="명" />
          </Card>
        </div>
        <div
          className="cursor-pointer transition-transform active:scale-[0.98]"
          onClick={() => {
            const next = { ...draft, status: '미사용' };
            setDraft(next);
            setApplied(next);
          }}
          title="클릭하여 미사용 계정만 보기"
        >
          <Card className={`transition-colors ${applied.status === '미사용' ? 'border-amber-500 ring-1 ring-amber-500/30' : 'hover:border-border-hi'}`}>
            <Kpi label="미사용" value={String(summary.inactive)} unit="명" />
          </Card>
        </div>
      </div>

      {/* 목록 */}
      <Card
        title="사용자 목록"
        action={
          <ActionBar
            screenId="S_BASE_USER"
            actions={[
              { icon: 'logout', label: '퇴사 처리', onClick: handleResign, disabled: !canResign || !canDelete },
              { preset: 'delete', onClick: handleDelete, disabled: selected.length === 0 || !canDelete },
              { preset: 'add', label: '사용자 추가', variant: 'primary', onClick: () => setEditing(null), disabled: !canCreate },
            ]}
          />
        }
        bodyClassName="p-3"
      >
        {selected.length > 0 && (
          <div className="mb-2 flex items-center gap-3 rounded-md bg-teal-soft px-3 py-2 text-[11.5px] text-navy">
            <b>{selected.length}</b>명 선택됨
            <button className="font-semibold underline-offset-2 hover:underline" onClick={() => setSelected([])}>
              선택 해제
            </button>
          </div>
        )}
        <DataTable<User>
          columns={columns}
          rows={rows}
          rowKey={(u) => u.id}
          pageSize={20}
          selectable
          selectedKeys={selected}
          onSelectionChange={setSelected}
          onRowClick={(u) => (canUpdate ? setEditing(u) : undefined)}
        />
      </Card>

      {/* 🔗 업무 승계 및 결재 권한 이관 설정 카드 */}
      <Card
        title="🔗 업무 승계 및 결재 권한 이관 설정"
        bodyClassName="p-4"
      >
        <div className="grid grid-cols-1 md:grid-cols-5 gap-5">
          {/* 좌측: 신규 매핑 등록 폼 */}
          <div className="md:col-span-2 space-y-3.5 border-r border-border pr-5">
            <div className="rounded-lg bg-panel-alt/60 p-3 space-y-3">
              <h3 className="text-[12px] font-bold text-ink2">새 권한 승계 관계 등록</h3>
              <div>
                <label className="block text-[11px] font-bold text-ink2 mb-1">인계자 (전임자 / 퇴사자)</label>
                <select
                  value={predSelectId}
                  onChange={(e) => setPredSelectId(e.target.value)}
                  className="w-full text-[12px] rounded-lg border border-border px-3 py-2 bg-panel focus:outline-none focus:ring-1 focus:ring-teal"
                >
                  <option value="">-- 임직원 선택 --</option>
                  {all.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.dept} / {u.position} · {u.status})
                    </option>
                  ))}
                </select>
                {(() => {
                  const selUser = all.find((u) => u.id === predSelectId);
                  if (!selUser) return null;
                  return (
                    <div className="mt-1 text-[10.5px] font-bold text-amber-800 bg-amber-500/5 border border-amber-500/10 px-2 py-0.5 rounded-md animate-fadeIn">
                      👉 {selUser.name} ({selUser.dept} / {selUser.position || '직급없음'})
                    </div>
                  );
                })()}
              </div>

              <div className="flex justify-center text-[11px] text-teal font-extrabold">
                ⬇️ 결재 권한 승계 ⬇️
              </div>

              <div>
                <label className="block text-[11px] font-bold text-ink2 mb-1">인수자 (후임자)</label>
                <select
                  value={succSelectId}
                  onChange={(e) => setSuccSelectId(e.target.value)}
                  className="w-full text-[12px] rounded-lg border border-border px-3 py-2 bg-panel focus:outline-none focus:ring-1 focus:ring-teal"
                >
                  <option value="">-- 임직원 선택 --</option>
                  {all.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.dept} / {u.position})
                    </option>
                  ))}
                </select>
                {(() => {
                  const selUser = all.find((u) => u.id === succSelectId);
                  if (!selUser) return null;
                  return (
                    <div className="mt-1 text-[10.5px] font-bold text-teal bg-teal/5 border border-teal/10 px-2 py-0.5 rounded-md animate-fadeIn">
                      👉 {selUser.name} ({selUser.dept} / {selUser.position || '직급없음'})
                    </div>
                  );
                })()}
              </div>
            </div>

            <button
              type="button"
              onClick={handleAddSuccession}
              disabled={!canUpdate}
              className="w-full py-2 bg-teal hover:bg-teal-dark text-white rounded-lg text-[12px] font-bold shadow-xs hover:shadow transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              🔗 승계 관계 등록
            </button>

          </div>

          {/* 우측: 현재 등록되어 활성화된 매핑 테이블 */}
          <div className="md:col-span-3 space-y-3.5">
            <h3 className="text-[12px] font-bold text-ink2">현재 설정된 승계 목록</h3>
            <div className="overflow-x-auto border border-border rounded-lg">
              <table className="w-full border-collapse text-left text-[11.5px]">
                <thead>
                  <tr className="bg-panel-alt/50 border-b border-border text-ink3 font-bold">
                    <th className="p-2">인계자 (전임)</th>
                    <th className="p-2 text-center">➡️</th>
                    <th className="p-2">인수자 (후임)</th>
                    <th className="p-2 text-right">관리</th>
                  </tr>
                </thead>
                <tbody>
                  {successions.map((s) => {
                    const pred = all.find((u) => u.id === s.predecessorId);
                    const succ = all.find((u) => u.id === s.successorId);
                    return (
                      <tr key={s.id} className="border-b border-border hover:bg-panel-alt/30">
                        <td className="p-2 font-semibold">
                          {pred ? `${pred.name} (${pred.dept}/${pred.position})` : `[삭제됨:${s.predecessorId}]`}
                        </td>
                        <td className="p-2 text-center text-teal font-extrabold text-[12px]">➔</td>
                        <td className="p-2 font-semibold text-teal-dark">
                          {succ ? `${succ.name} (${succ.dept}/${succ.position})` : `[삭제됨:${s.successorId}]`}
                        </td>
                        <td className="p-2 text-right">
                          <button
                            type="button"
                            onClick={() => handleDeleteSuccession(s.id)}
                            className="px-2 py-1 text-danger hover:bg-danger-soft rounded text-[11px] font-bold transition-all"
                          >
                            해제
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {successions.length === 0 && (
                    <tr>
                      <td colSpan={4} className="p-8 text-center text-ink3 text-[11px]">
                        현재 활성화된 업무 승계 관계가 존재하지 않습니다.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </Card>

      <UserFormModal

        open={editing !== undefined}
        initial={editing}
        onClose={() => setEditing(undefined)}
        onSubmit={handleSubmit}
      />

      <ResignModal
        open={resigning !== null}
        user={resigning}
        onClose={() => setResigning(null)}
        onDone={(msg) => {
          setNotice(msg);
          setSelected([]);
        }}
      />
    </div>
  );
}
