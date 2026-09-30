import { useMemo, useState } from 'react';
import { useDepartments, useRemoveDepartment, useUpsertDepartment } from '@/features/department/useDepartments';
import { useUsers, useUpdateUserJobTitle, useUpdateUserDept } from '@/features/user/useUsers';
import { usePositions } from '@/features/position/usePositions';
import { usePermission } from '@/features/auth/usePermission';
import { DEPT_TYPES, type Department } from '@/domain/department/schema';

/**
 * 부서/조직관리 (기준정보) — 부서 트리·상위부서·부서유형·부서장 CRUD.
 * parentId(상향추적)·deptType(공장 등)·headUserId 는 동적 결재선 룰의 토대. ([[dynamic-route-engine]])
 * 도크 조직도(/gw/orgchart, 읽기전용)와 같은 departments 마스터를 공유(여기=편집).
 */
const BLANK: Department = { id: '', name: '', parentId: null, headUserId: null, deptType: '본사', order: 100 };

const TYPE_TONE: Record<string, string> = { 본사: 'text-blue', 본부: 'text-teal', 위원회: 'text-purple', 연구소: 'text-ink2', 기타: 'text-ink3' };

export default function DepartmentScreen() {
  const { canAction } = usePermission();
  const canCreate = canAction('S_BASE_DEPT', 'create');
  const canUpdate = canAction('S_BASE_DEPT', 'update');
  const canDelete = canAction('S_BASE_DEPT', 'delete');

  const { data: rows = [], isLoading } = useDepartments();
  const { data: users = [] } = useUsers();
  const { data: positions = [] } = usePositions();
  const upsert = useUpsertDepartment();
  const remove = useRemoveDepartment();
  const updateJobTitle = useUpdateUserJobTitle();
  const updateUserDept = useUpdateUserDept();
  const [sel, setSel] = useState<Department | null>(null);
  const [msg, setMsg] = useState('');

  const nameOf = (id: string | null) => users.find((u) => u.id === id)?.name ?? '—';

  // 트리 정렬 — parentId 로 깊이 계산 후 DFS 순서.
  const ordered = useMemo(() => {
    const byParent = new Map<string | null, Department[]>();
    for (const d of rows) {
      const pKey = d.parentId || null;
      const arr = byParent.get(pKey) ?? [];
      arr.push(d);
      byParent.set(pKey, arr);
    }
    for (const arr of byParent.values()) arr.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
    const out: { d: Department; depth: number }[] = [];
    const visited = new Set<string>();
    const walk = (parent: string | null, depth: number) => {
      for (const d of byParent.get(parent) ?? []) {
        if (visited.has(d.id)) continue;
        visited.add(d.id);
        out.push({ d, depth });
        walk(d.id, depth + 1);
      }
    };
    walk(null, 0);

    // 혹시라도 최상위 탐색에서 누락된 부서(상위 ID 오류 등)가 있다면 depth 0으로 안전하게 노출
    for (const d of rows) {
      if (!visited.has(d.id)) {
        out.push({ d, depth: 0 });
      }
    }
    return out;
  }, [rows]);

  const nextId = () => {
    const n = rows.reduce((m, d) => Math.max(m, Number(d.id.replace(/\D/g, '')) || 0), 0) + 10;
    return `D${String(n).padStart(3, '0')}`;
  };

  const getRank = (userId: string) => {
    const user = users.find((u) => u.id === userId);
    if (!user) return 9;
    const pos = positions.find((p) => p.name === user.position);
    return pos ? pos.rank : 9;
  };

  const save = async () => {
    if (!sel) return;
    if (!sel.name.trim()) return setMsg('부서명을 입력하세요.');
    if (sel.parentId === sel.id && sel.id) return setMsg('자기 자신을 상위로 지정할 수 없습니다.');

    // 본부 중복 지정 검증
    if (sel.deptType === '본부') {
      const existingDiv = rows.find((d) => d.deptType === '본부' && d.id !== sel.id);
      if (existingDiv) {
        return setMsg(`본부는 시스템에 1개 부서만 지정할 수 있습니다. (현재: ${existingDiv.name})`);
      }
    }

    const oldDept = rows.find((d) => d.id === sel.id);
    const oldHeadUserId = oldDept?.headUserId;

    const targetId = sel.id || nextId();
    const targetOrder = sel.id
      ? (oldDept?.order ?? sel.order ?? rows.length + 1)
      : (rows.reduce((max, d) => Math.max(max, d.order || 0), 0) + 1);

    await upsert.mutateAsync({
      ...sel,
      id: targetId,
      order: targetOrder,
      parentId: sel.parentId || null,
      headUserId: sel.headUserId || null,
    });

    // 부서명 변경에 따른 소속 사용자들의 부서명 일괄 자동 업데이트 (동기화)
    if (oldDept && oldDept.name !== sel.name) {
      const affectedUsers = users.filter((u) => u.dept === oldDept.name);
      for (const u of affectedUsers) {
        await updateUserDept.mutateAsync({ id: u.id, dept: sel.name });
      }
    }

    if (sel.headUserId) {
      let newJob = '팀장';
      if (sel.deptType === '본부') {
        newJob = '본부장';
      } else if (sel.deptType === '위원회') {
        newJob = '위원장';
      } else {
        const rank = getRank(sel.headUserId);
        newJob = rank >= 3 ? '팀장' : '임원';
      }
      await updateJobTitle.mutateAsync({ id: sel.headUserId, jobTitle: newJob });

      const deptUser = users.find((u) => u.id === sel.headUserId);
      if (deptUser) {
        // 기존 해당 부서의 부서장(팀장/본부장/위원장) 자격을 가진 다른 유저들을 팀원으로 원상복구
        const others = users.filter((u) => u.dept === deptUser.dept && ['팀장', '본부장', '위원장'].includes(u.jobTitle) && u.id !== sel.headUserId);
        for (const other of others) {
          await updateJobTitle.mutateAsync({ id: other.id, jobTitle: '팀원' });
        }
      }
    }

    if (oldHeadUserId && oldHeadUserId !== sel.headUserId) {
      const isStillHead = rows.some((d) => d.id !== sel.id && d.headUserId === oldHeadUserId);
      if (!isStillHead) {
        const rank = getRank(oldHeadUserId);
        const newJob = rank >= 3 ? '팀원' : '임원';
        await updateJobTitle.mutateAsync({ id: oldHeadUserId, jobTitle: newJob });
      }
    }

    setMsg('저장되었습니다.');
    setSel(null);
  };

  const del = async (id: string) => {
    const dept = rows.find((d) => d.id === id);
    const headUserId = dept?.headUserId;

    await remove.mutateAsync(id);

    if (headUserId) {
      const isStillHead = rows.some((d) => d.id !== id && d.headUserId === headUserId);
      if (!isStillHead) {
        const rank = getRank(headUserId);
        const newJob = rank >= 3 ? '팀원' : '임원';
        await updateJobTitle.mutateAsync({ id: headUserId, jobTitle: newJob });
      }
    }

    if (sel?.id === id) setSel(null);
  };

  const parentOptions = rows.filter((d) => d.id !== sel?.id);

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-ink">부서/조직관리</h1>
          <p className="mt-0.5 text-xs text-ink3">기준 정보 / 부서·조직관리</p>
        </div>
        <button
          onClick={() => { setSel({ ...BLANK }); setMsg(''); }}
          disabled={!canCreate}
          className="rounded-lg bg-teal px-3.5 py-2 text-[12.5px] font-bold text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          + 부서 추가
        </button>
      </div>

      <div className="grid grid-cols-[1.5fr_1fr] items-start gap-3.5">
        {/* 트리 목록 */}
        <div className="overflow-hidden rounded-xl border border-border bg-panel">
          <div className="grid grid-cols-[1fr_70px_90px_70px] border-b border-border bg-panel-alt px-3.5 py-2 text-[10.5px] font-bold text-ink2">
            <span>부서명</span><span>유형</span><span>부서장</span><span className="text-right">관리</span>
          </div>
          {isLoading && <div className="py-8 text-center text-[12px] text-ink3">불러오는 중…</div>}
          {!isLoading && ordered.length === 0 && (
            <div className="py-12 text-center text-[12px] text-ink3">
              등록된 부서가 없습니다.
            </div>
          )}
          {ordered.map(({ d, depth }) => (
            <div key={d.id} onClick={() => { setSel(d); setMsg(''); }} className={`grid grid-cols-[1fr_70px_90px_70px] items-center border-b border-border px-3.5 py-2.5 text-[12.5px] ${sel?.id === d.id ? 'bg-teal-soft/60' : 'cursor-pointer hover:bg-panel-alt'}`}>
              <span className="truncate font-semibold text-ink" style={{ paddingLeft: depth * 16 }}>{depth > 0 && <span className="text-ink3">└ </span>}{d.name}</span>
              <span className={`text-[11px] font-bold ${TYPE_TONE[d.deptType] ?? 'text-ink3'}`}>{d.deptType}</span>
              <span className="truncate text-[11.5px] text-ink2">{nameOf(d.headUserId)}</span>
              <span className="text-right">
                {canDelete && (
                  <button onClick={(e) => { e.stopPropagation(); del(d.id); }} className="text-[11.5px] text-ink3 hover:text-red-500">삭제</button>
                )}
              </span>
            </div>
          ))}
        </div>

        {/* 편집 */}
        <div className="rounded-xl border border-border bg-panel p-4">
          {sel ? (
            <div className="space-y-3">
              <div className="text-[13px] font-bold text-ink">{sel.id ? `부서 편집 · ${sel.id}` : '새 부서'}</div>
              <Field label="부서명"><input value={sel.name} onChange={(e) => setSel({ ...sel, name: e.target.value })} className="w-full rounded-lg border border-border-hi bg-panel-alt px-3 py-2 text-[13px] text-ink outline-none focus:border-teal" /></Field>
              <Field label="상위 부서">
                <select value={sel.parentId ?? ''} onChange={(e) => setSel({ ...sel, parentId: e.target.value || null })} className="w-full rounded-lg border border-border-hi bg-panel-alt px-2 py-2 text-[12.5px] text-ink outline-none focus:border-teal">
                  <option value="">(최상위)</option>
                  {parentOptions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </Field>
              <Field label="부서 유형">
                <select value={sel.deptType} onChange={(e) => setSel({ ...sel, deptType: e.target.value as Department['deptType'] })} className="w-full rounded-lg border border-border-hi bg-panel-alt px-2 py-2 text-[12.5px] text-ink outline-none focus:border-teal">
                  {DEPT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="부서장">
                <select value={sel.headUserId ?? ''} onChange={(e) => setSel({ ...sel, headUserId: e.target.value || null })} className="w-full rounded-lg border border-border-hi bg-panel-alt px-2 py-2 text-[12.5px] text-ink outline-none focus:border-teal">
                  <option value="">(미지정)</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.name} · {u.dept} · {u.position}</option>)}
                </select>
              </Field>
              <div className="rounded-lg border border-border bg-panel-alt/60 px-3 py-2 text-[11px] text-ink2 flex items-center justify-between">
                <span className="font-bold">정렬 순서</span>
                <span className="font-mono text-teal font-extrabold text-[11px]">
                  배치 순서에 따라 시스템 자동 관리
                </span>
              </div>
              {msg && <p className="text-[11.5px] font-semibold text-teal">{msg}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <button onClick={() => setSel(null)} className="rounded-lg px-3.5 py-2 text-[12.5px] font-semibold text-ink3 hover:bg-panel-alt">취소</button>
                <button onClick={save} disabled={upsert.isPending || (sel.id ? !canUpdate : !canCreate)} className="rounded-lg bg-teal px-4 py-2 text-[12.5px] font-bold text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed">저장</button>
              </div>
            </div>
          ) : (
            <div className="py-16 text-center text-[12px] text-ink3">부서를 선택하거나 추가하세요.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-[11px] font-bold text-ink2">{label}</span>{children}</label>;
}
