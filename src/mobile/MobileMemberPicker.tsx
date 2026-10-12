import { useMemo, useState } from 'react';
import { useCanDesignate } from '@/features/auth/useCanDesignate';
import { useOrgTree, type OrgNode } from '@/features/gw/useOrgTree';
import { useAllUserPresences } from '@/features/userPresence/useUserPresence';
import { PresenceDot, PresenceBadge } from '@/features/userPresence/PresenceIndicator';

/**
 * 조직도 트리 다중 선택 — 새 대화 만들기·멤버 초대 공용(모바일).
 * 데스크톱 QuickDock 의 MemberPicker 와 동일 로직, 터치 친화 크기.
 */
function OrgTreeNode({
  node,
  exclude,
  selected,
  onToggle,
  isExpanded,
  toggleExpand,
}: {
  node: OrgNode;
  exclude: string[];
  selected: string[];
  onToggle: (id: string) => void;
  isExpanded: (id: string) => boolean;
  toggleExpand: (id: string) => void;
}) {
  const { rankOf } = useOrgTree();
  const { canDesignate } = useCanDesignate();
  const presenceMap = useAllUserPresences();
  const show = isExpanded(node.dept.id);
  const deptUsers = useMemo(() => {
    const filtered = node.members.filter((u) => u.status === '사용' && !exclude.includes(u.id) && canDesignate(u));
    return filtered.sort((a, b) => rankOf(a.position) - rankOf(b.position));
  }, [node.members, exclude, rankOf, canDesignate]);

  const hasContent = deptUsers.length > 0 || node.children.length > 0;
  if (!hasContent) return null;

  return (
    <div className="mt-0.5 flex flex-col">
      <div
        onClick={() => toggleExpand(node.dept.id)}
        className="flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-2 active:bg-black/5"
      >
        <span className="grid h-3 w-3 place-items-center text-[10px] text-ink3">{show ? '▼' : '▶'}</span>
        <span className="text-[13px] font-bold text-ink2">{node.dept.name}</span>
        <span className="text-[10px] text-ink3">({node.members.filter((u) => u.status === '사용').length})</span>
      </div>

      {show && (
        <div className="my-0.5 ml-3.5 flex flex-col gap-0.5 border-l border-border/50 pl-3.5">
          {deptUsers.map((u) => {
            const on = selected.includes(u.id);
            const p = presenceMap[u.id];
            return (
              <button
                key={u.id}
                onClick={() => onToggle(u.id)}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left active:bg-panel-alt"
              >
                <div className="relative shrink-0">
                  <span className="grid h-8 w-8 place-items-center rounded-full bg-teal-soft text-[12px] font-bold text-teal">
                    {u.name[0]}
                  </span>
                  <PresenceDot presence={p} size="sm" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[13px] font-medium text-ink">{u.name}</span>
                    <span className="text-[11px] text-ink3">{u.position}</span>
                    {p && p.status !== 'OFFLINE' && (
                      <PresenceBadge presence={p} showMessage={false} size="xs" />
                    )}
                  </div>
                  {p?.message && (
                    <div className="text-[10px] text-ink3 truncate font-normal mt-0.5">
                      {p.message}
                    </div>
                  )}
                </div>
                <span className={`grid h-[19px] w-[19px] shrink-0 place-items-center rounded-full border text-[10px] font-bold ${on ? 'border-amber bg-amber text-white' : 'border-border-hi text-transparent'}`}>✓</span>
              </button>
            );
          })}

          {node.children.map((child) => (
            <OrgTreeNode
              key={child.dept.id}
              node={child}
              exclude={exclude}
              selected={selected}
              onToggle={onToggle}
              isExpanded={isExpanded}
              toggleExpand={toggleExpand}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** 조직도 트리 다중 선택기. exclude 는 표시에서 제외할 users.id(나·기존 멤버). */
export function MobileMemberPicker({ exclude, selected, onToggle }: { exclude: string[]; selected: string[]; onToggle: (id: string) => void }) {
  const { roots, isLoading } = useOrgTree();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const toggleExpand = (id: string) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  const isExpanded = (id: string) => expanded[id] !== false; // 기본값 펼침

  if (isLoading) {
    return <div className="p-10 text-center text-[12px] text-ink3">조직도를 불러오는 중...</div>;
  }

  return (
    <div className="flex select-none flex-col gap-0.5 p-3.5">
      {roots.map((root) => (
        <OrgTreeNode
          key={root.dept.id}
          node={root}
          exclude={exclude}
          selected={selected}
          onToggle={onToggle}
          isExpanded={isExpanded}
          toggleExpand={toggleExpand}
        />
      ))}
    </div>
  );
}
