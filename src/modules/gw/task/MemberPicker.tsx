import { useMemo, useState } from 'react';
import { useCanDesignate } from '@/features/auth/useCanDesignate';
import type { User } from '@/domain/user/schema';

interface MemberPickerProps {
  users: User[];
  selected: string[];
  /** 항상 참여자로 고정되는 사용자(프로젝트 소유자). 체크를 풀 수 없다. */
  lockedUserId: string;
  onChange: (next: string[]) => void;
}

/**
 * 부서 트리 참여자 선택기.
 *
 * 평면 체크박스 목록은 사람이 늘수록 "우리 팀 전부"를 고르는 데 클릭이 비례해서 늘어난다.
 * 부서로 접어 두고 **부서 헤더 한 번으로 하위 전원**을 토글한다.
 *
 * 부서 체크박스는 3상태다 — 전원 선택(checked) / 일부(indeterminate) / 없음. 부분 선택을
 * 빈 체크박스로 그리면 "이 부서는 아무도 없다"로 읽혀서 다시 전체를 누르게 된다.
 */
export function MemberPicker({ users: allUsers, selected, lockedUserId, onChange }: MemberPickerProps) {
  const { canDesignate } = useCanDesignate();
  const users = useMemo(() => allUsers.filter(canDesignate), [allUsers, canDesignate]);
  const [keyword, setKeyword] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const groups = useMemo(() => {
    const query = keyword.trim().toLowerCase();
    const matched = query
      ? users.filter((user) => [user.name, user.dept, user.position].some((v) => v.toLowerCase().includes(query)))
      : users;
    const byDept = new Map<string, User[]>();
    for (const user of matched) {
      const list = byDept.get(user.dept);
      if (list) list.push(user);
      else byDept.set(user.dept, [user]);
    }
    return [...byDept.entries()]
      .map(([dept, members]) => ({ dept, members: members.slice().sort((a, b) => a.name.localeCompare(b.name)) }))
      .sort((a, b) => a.dept.localeCompare(b.dept));
  }, [keyword, users]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const toggleUser = (userId: string) => {
    if (userId === lockedUserId) return;
    onChange(selectedSet.has(userId) ? selected.filter((id) => id !== userId) : [...selected, userId]);
  };

  /** 부서 전원 토글 — 이미 전원이면 해제, 아니면 추가. 소유자는 건드리지 않는다. */
  const toggleDept = (members: User[]) => {
    const ids = members.map((user) => user.id).filter((id) => id !== lockedUserId);
    if (ids.length === 0) return;
    const allSelected = ids.every((id) => selectedSet.has(id));
    onChange(allSelected
      ? selected.filter((id) => !ids.includes(id))
      : [...selected, ...ids.filter((id) => !selectedSet.has(id))]);
  };

  const toggleCollapse = (dept: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(dept)) next.delete(dept);
      else next.add(dept);
      return next;
    });
  };

  return (
    <div className="rounded-lg border border-border">
      <div className="border-b border-border p-2">
        <input
          type="search"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder="이름·부서·직급 검색"
          aria-label="참여자 검색"
          className="w-full rounded-md border border-border-hi bg-panel px-2.5 py-1.5 text-[11px] text-ink outline-none placeholder:text-ink3 focus:border-teal"
        />
      </div>
      <div className="max-h-56 overflow-y-auto p-1.5">
        {groups.length === 0 && (
          <div className="py-6 text-center text-[10.5px] text-ink3">검색 결과가 없습니다.</div>
        )}
        {groups.map(({ dept, members }) => {
          const selectable = members.filter((user) => user.id !== lockedUserId);
          const picked = selectable.filter((user) => selectedSet.has(user.id)).length;
          const all = selectable.length > 0 && picked === selectable.length;
          const some = picked > 0 && !all;
          const isCollapsed = collapsed.has(dept);
          return (
            <div key={dept} className="mb-1 last:mb-0">
              <div className="flex items-center gap-1.5 rounded-md bg-panel-alt px-2 py-1.5">
                <button
                  type="button"
                  onClick={() => toggleCollapse(dept)}
                  aria-label={`${dept} ${isCollapsed ? '펼치기' : '접기'}`}
                  aria-expanded={!isCollapsed}
                  className="grid h-4 w-4 shrink-0 place-items-center text-[9px] font-bold text-ink3 hover:text-ink"
                >
                  {isCollapsed ? '▶' : '▼'}
                </button>
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={all}
                    ref={(node) => { if (node) node.indeterminate = some; }}
                    onChange={() => toggleDept(members)}
                    disabled={selectable.length === 0}
                    aria-label={`${dept} 전체 선택`}
                    className="accent-teal"
                  />
                  <span className="min-w-0 truncate text-[10.5px] font-extrabold text-ink2">{dept}</span>
                  <span className="shrink-0 text-[9.5px] font-bold text-ink3">{picked}/{members.length}</span>
                </label>
              </div>
              {!isCollapsed && (
                <div className="grid gap-0.5 py-0.5 pl-6 sm:grid-cols-2">
                  {members.map((user) => (
                    <label
                      key={user.id}
                      className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-[10.5px] ${user.id === lockedUserId ? 'bg-teal-soft/30' : 'hover:bg-panel-alt'}`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedSet.has(user.id)}
                        disabled={user.id === lockedUserId}
                        onChange={() => toggleUser(user.id)}
                        className="accent-teal"
                      />
                      <span className="min-w-0 truncate font-semibold text-ink2">
                        {user.name} {user.position}
                        {user.id === lockedUserId ? ' · 소유자' : ''}
                        {user.status === '사용' ? '' : ' · 비활성'}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
