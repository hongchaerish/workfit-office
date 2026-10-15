import { useMemo, useState } from 'react';
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
  const [draft, setDraft] = useState({ status: '', q: '' });
  const [applied, setApplied] = useState(draft);
  const [selected, setSelected] = useState<Array<string | number>>([]);
  const [editing, setEditing] = useState<User | null | undefined>(undefined);

  const { data: all = [] } = useUsers();
  const { data: rows = [] } = useUsers(applied);
  const { data: roleGroups = [] } = useRoleGroups();
  const org = useOrgTree();
  const upsert = useUpsertUser();
  const removeUsers = useRemoveUsers();


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
    { key: 'empNo', header: '사번', mono: true, sortable: true, width: 110 },
    { key: 'name', header: '이름', sortable: true, width: 100 },
    { key: 'email', header: '이메일', sortable: true },
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
    upsert.mutate({ values, id }, {
      // 저장 규칙(예: 미사용은 인명관리 퇴직 처리로만)에 걸리면 이유를 알린다
      onError: (e) => alert(`계정을 저장하지 못했습니다: ${e instanceof Error ? e.message : String(e)}`),
    });
  };
  const handleDelete = () => {
    if (selected.length === 0) return;
    removeUsers.mutate(selected);
    setSelected([]);
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

      {/* 필터 */}
      <FilterBar onSearch={() => setApplied(draft)}>
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


      <UserFormModal

        open={editing !== undefined}
        initial={editing}
        onClose={() => setEditing(undefined)}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
