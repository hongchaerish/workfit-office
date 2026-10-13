import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { ActionButton } from '@/shared/ui/ActionBar';
import { useAuth } from '@/app/auth/AuthProvider';
import { useOrgTree } from '@/features/gw/useOrgTree';
import { useRosterOrder } from '@/features/user/useRosterOrder';
import { useSaveRosterOrderSetting } from '@/features/user/useRosterOrderSetting';

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * 전 직원 정렬 순서 편집(관리자 전용) — 저장하면 근태·업무계획 등 모든 인원 목록에 전사 공통으로 적용된다.
 * 순서는 DB(rosterOrders)에 사용자 ID 목록으로 저장되고, 목록에 없는 사람(이후 입사자 등)은 뒤에 기본 순서로 붙는다.
 */
export function RosterOrderModal({ open, onClose }: Props) {
  const { user } = useAuth();
  const org = useOrgTree();
  const { compare } = useRosterOrder();
  const save = useSaveRosterOrderSetting();

  const members = useMemo(() => org.users.filter((u) => u.status === '사용').sort(compare), [org.users, compare]);
  const byId = useMemo(() => new Map(members.map((u) => [u.id, u])), [members]);

  const [ids, setIds] = useState<string[]>([]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [keyword, setKeyword] = useState('');
  useEffect(() => {
    if (!open) return;
    // 열 때 한 번만 현재 순서로 채운다(편집 중 다시 정렬되지 않게)
    setIds(members.map((u) => u.id));
    setKeyword('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const moveTo = (from: number, to: number) => {
    if (from === to || to < 0 || to >= ids.length) return;
    const next = [...ids];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setIds(next);
  };

  const persist = async (userIds: string[], done: string) => {
    try {
      await save.mutateAsync({ userIds, updatedBy: user?.name });
      alert(done);
      onClose();
    } catch (e) {
      alert(`정렬 순서 저장에 실패했습니다: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const q = keyword.trim().replace(/\s+/g, '');
  const matches = (id: string) => {
    if (!q) return true;
    const u = byId.get(id);
    return !!u && `${u.name}${u.dept}${u.position}${u.jobTitle}`.replace(/\s+/g, '').includes(q);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="인원 정렬 순서"
      width={520}
      footer={
        <>
          <ActionButton
            icon="refresh"
            label="기본 순서로"
            onClick={() => {
              if (confirm('직접 정한 순서를 지우고 기본 순서(임원 → 부서 → 직책 → 직급 → 이름)로 되돌릴까요?')) {
                void persist([], '기본 순서로 되돌렸습니다.');
              }
            }}
            disabled={save.isPending}
          />
          <ActionButton icon="refresh" label="취소" onClick={onClose} />
          <ActionButton
            icon="save"
            label="저장"
            variant="primary"
            onClick={() => void persist(ids, '정렬 순서를 저장했습니다. 근태·업무계획 목록에 모두 적용됩니다.')}
            disabled={save.isPending || ids.length === 0}
          />
        </>
      }
    >
      <p className="mb-2 text-[11px] text-ink3">
        끌어서 옮기거나 ▲▼, 순번 입력으로 순서를 바꿉니다. 저장하면 근태·업무계획 등 모든 인원 목록에 전사 공통으로 적용됩니다.
      </p>
      <input
        type="text"
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        placeholder="이름·부서로 찾기 (찾는 동안 끌어서 옮기기는 꺼집니다)"
        className="mb-2 h-8 w-full rounded-lg border border-border bg-panel-alt/40 px-2.5 text-[11px] text-ink outline-none focus:border-teal/50"
      />
      <ol className="content-scroll max-h-[calc(60vh/var(--font-scale,1))] space-y-1 overflow-y-auto pr-1">
        {ids.map((id, i) => {
          const u = byId.get(id);
          if (!u || !matches(id)) return null;
          const draggable = !q;
          return (
            <li
              key={id}
              draggable={draggable}
              onDragStart={() => setDragIndex(i)}
              onDragOver={(e) => {
                if (dragIndex === null) return;
                e.preventDefault();
                if (dragIndex !== i) {
                  moveTo(dragIndex, i);
                  setDragIndex(i);
                }
              }}
              onDragEnd={() => setDragIndex(null)}
              className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 ${
                dragIndex === i ? 'border-teal bg-teal-soft/30' : 'border-border bg-panel-alt/40'
              } ${draggable ? 'cursor-grab' : ''}`}
            >
              {draggable && <span className="select-none text-[12px] text-ink3">⠿</span>}
              <input
                key={`${id}-${i}`}
                type="number"
                min={1}
                max={ids.length}
                defaultValue={i + 1}
                title="순번을 입력하고 Enter"
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  const to = Number((e.target as HTMLInputElement).value) - 1;
                  if (Number.isInteger(to)) moveTo(i, Math.max(0, Math.min(ids.length - 1, to)));
                }}
                className="h-6 w-11 rounded border border-border bg-panel px-1 text-center text-[11px] font-bold text-teal outline-none focus:border-teal/50"
              />
              <div className="min-w-0 flex-1">
                <span className="text-[12px] font-bold text-ink">{u.name}</span>
                <span className="ml-1.5 text-[10.5px] text-ink3">{[u.dept, u.position, u.jobTitle].filter(Boolean).join(' · ')}</span>
              </div>
              <button
                type="button"
                onClick={() => moveTo(i, i - 1)}
                disabled={i === 0}
                title="위로"
                className="grid h-6 w-6 place-items-center rounded-md border border-border text-[11px] text-ink2 hover:bg-panel disabled:opacity-30"
              >
                ▲
              </button>
              <button
                type="button"
                onClick={() => moveTo(i, i + 1)}
                disabled={i === ids.length - 1}
                title="아래로"
                className="grid h-6 w-6 place-items-center rounded-md border border-border text-[11px] text-ink2 hover:bg-panel disabled:opacity-30"
              >
                ▼
              </button>
            </li>
          );
        })}
      </ol>
    </Modal>
  );
}
