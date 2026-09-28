import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { ApprovalRecipient } from '@/domain/approvalDoc/schema';
import { X, Folder, User, Send } from 'lucide-react';
import { isTestAccount, isTestDept } from '../ApprovalLineBuilder';

/* ────────────── ⓘ 툴팁 컴포넌트 ────────────── */
function InfoTooltip({ text }: { text: string }) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative inline-flex items-center">
      <button
        type="button"
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        onClick={() => setVisible((v) => !v)}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-ink3/40 bg-panel text-[9px] font-extrabold text-ink3 hover:border-teal hover:text-teal transition-colors select-none cursor-pointer"
        aria-label="도움말"
      >
        ⓘ
      </button>

      {visible && (
        <div className="absolute right-0 top-full mt-1 z-[9999] w-[190px] rounded-lg border border-border bg-panel shadow-2xl p-2.5 text-[10.5px] text-ink2 leading-relaxed pointer-events-none break-keep">
          {text}
        </div>
      )}
    </div>
  );
}

export function SelectorDialog({
  title, org, excludeIds, singleSelect, deptOnly, onConfirm, onClose,
}: {
  title: string;
  org: any; // ReturnType<typeof useOrgTree>
  excludeIds?: Set<string>;
  singleSelect?: boolean;
  deptOnly?: boolean;
  onConfirm: (items: { id: string; name: string; type: 'user' | 'dept' }[]) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<{ id: string; name: string; type: 'user' | 'dept' }[]>([]);


  const handleToggleDept = (dept: any) => {
    const deptUsers = org.users.filter((u: any) => u.dept === dept.name && !isTestAccount(u) && !excludeIds?.has(u.id));
    const isDeptSelected = selected.some((s) => s.id === dept.id);

    if (isDeptSelected) {
      setSelected((prev) => prev.filter((s) => s.id !== dept.id && !deptUsers.some((u: any) => u.id === s.id)));
    } else {
      if (singleSelect) {
        setSelected([{ id: dept.id, name: dept.name, type: 'dept' as const }]);
        return;
      }
      setSelected((prev) => {
        const next = prev.filter((s) => !deptUsers.some((u: any) => u.id === s.id));
        return [...next, { id: dept.id, name: dept.name, type: 'dept' as const }];
      });
    }
  };

  const handleToggleUser = (user: any, dept: any) => {
    const deptUsers = org.users.filter((u: any) => u.dept === dept.name && !isTestAccount(u) && !excludeIds?.has(u.id));
    const isDeptSelected = selected.some((s) => s.id === dept.id);
    const isUserSelected = selected.some((s) => s.id === user.id);

    if (isDeptSelected) {
      if (singleSelect) return;
      // 부서가 체크된 상태에서 사원 체크 풀면 -> 부서 해제하고 남은 부서원 전원을 사원별 선택으로 풀기
      setSelected((prev) => {
        const base = prev.filter((s) => s.id !== dept.id);
        const siblings = deptUsers
          .filter((u: any) => u.id !== user.id)
          .map((u: any) => ({ id: u.id, name: `${u.name} · ${u.dept}`, type: 'user' as const }));
        return [...base, ...siblings];
      });
    } else {
      if (singleSelect) {
        setSelected([{ id: user.id, name: `${user.name} · ${user.dept}`, type: 'user' as const }]);
        return;
      }
      setSelected((prev) => {
        const next = isUserSelected
          ? prev.filter((s) => s.id !== user.id)
          : [...prev, { id: user.id, name: `${user.name} · ${user.dept}`, type: 'user' as const }];
        return next;
      });
    }
  };

  const isDeptChecked = (dept: any) => selected.some((s) => s.id === dept.id);
  const isUserChecked = (user: any, dept: any) => {
    if (selected.some((s) => s.id === dept.id)) return true; // 부서가 선택되어 있으면 하위 사원도 선택됨으로 표출
    return selected.some((s) => s.id === user.id);
  };

  // 검색 필터링
  const filteredDepts = org.depts.filter((d: any) => d.name.includes(search) && !isTestDept(d.name) && !excludeIds?.has(d.id));
  const filteredUsers = org.users.filter(
    (u: any) => (u.name.includes(search) || u.dept.includes(search) || u.position.includes(search)) && !isTestAccount(u) && !excludeIds?.has(u.id)
  );

  const isSearching = search.trim().length > 0;

  // 재귀 렌더링 함수
  const renderOrgNode = (node: any, depth: number = 0) => {
    const d = node.dept;
    if (isTestDept(d.name)) return null;
    const deptUsers = node.members.filter((u: any) => !isTestAccount(u) && !excludeIds?.has(u.id));
    const hasUsers = deptUsers.length > 0;
    const children = (node.children || []).filter((child: any) => !isTestDept(child.dept?.name));
    const hasChildren = children.length > 0;

    return (
      <div key={d.id} className="space-y-1">
        {/* 부서 노드 */}
        <div
          style={{ paddingLeft: `${depth * 14}px` }}
          className="flex items-center justify-between rounded-lg hover:bg-panel-alt px-1 py-0.5"
        >
          <div className="flex items-center gap-1.5 text-[11.5px] font-bold text-ink select-none flex-1 py-1">
            <Folder size={12} className="text-amber-500 shrink-0" />
            <span>{d.name}</span>
          </div>
          <input
            type="checkbox"
            checked={isDeptChecked(d)}
            onChange={() => handleToggleDept(d)}
            className="rounded border-border text-teal focus:ring-teal h-3.5 w-3.5 mr-1 cursor-pointer"
          />
        </div>

        {/* 부서 하위 사원 목록 (항상 펼침상태) */}
        {!deptOnly && hasUsers && (
          <div className="space-y-0.5 mt-0.5">
            {deptUsers.map((u: any) => (
              <div
                key={u.id}
                style={{ paddingLeft: `${(depth + 1) * 14 + 12}px` }}
                className="flex items-center justify-between rounded-lg hover:bg-panel-alt px-1 py-0.5"
              >
                <div className="flex-1 py-1 text-left text-[11.5px] font-medium text-ink2 truncate flex items-center gap-1.5">
                  <User size={12} className="text-teal shrink-0" />
                  <span>{u.name}</span>
                  <span className="ml-1 text-ink3 text-[10px]">{u.position}</span>
                </div>
                <input
                  type="checkbox"
                  checked={isUserChecked(u, d)}
                  onChange={() => handleToggleUser(u, d)}
                  className="rounded border-border text-teal focus:ring-teal h-3.5 w-3.5 mr-1 cursor-pointer"
                />
              </div>
            ))}
          </div>
        )}

        {/* 하위 부서 노드 재귀 호출 */}
        {hasChildren && (
          <div className="space-y-1">
            {children.map((child: any) => renderOrgNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-panel shadow-2xl flex flex-col overflow-hidden border border-border" onClick={(e) => e.stopPropagation()}>
        {/* 모달 헤더 */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3 bg-panel-alt/20">
          <span className="text-[13px] font-bold text-ink">{title}</span>
          <button type="button" onClick={onClose} className="text-ink3 hover:text-ink transition-colors cursor-pointer">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 검색창 */}
        <div className="px-4 pt-3 pb-2 border-b border-border/50">
          <input
            autoFocus
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="부서명, 사원명, 직위 검색..."
            className="w-full rounded-lg border border-border-hi bg-panel-alt px-3 py-1.5 text-[11.5px] text-ink outline-none focus:border-teal transition-all"
          />
        </div>

        {/* 조직도 트리뷰 콘텐츠 영역 */}
        <div className="content-scroll flex-1 overflow-y-auto px-4 py-2 min-h-[250px] max-h-[350px] space-y-1">
          {isSearching ? (
            /* 검색 활성화 시 플랫 리스트로 표출 */
            <div className="space-y-1">
              {filteredDepts.map((d: any) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => handleToggleDept(d)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[11.5px] font-medium transition-colors ${
                    isDeptChecked(d) ? 'bg-teal-soft text-teal font-bold' : 'hover:bg-panel-alt text-ink'
                  }`}
                >
                  <Folder size={13} className="text-amber-500 shrink-0" />
                  <span className="flex-1 truncate">{d.name}</span>
                  <input
                    type="checkbox"
                    checked={isDeptChecked(d)}
                    readOnly
                    className="rounded border-border text-teal focus:ring-teal h-3.5 w-3.5 pointer-events-none"
                  />
                </button>
              ))}
              {!deptOnly &&
                filteredUsers.map((u: any) => {
                  const d = org.depts.find((dept: any) => dept.name === u.dept);
                  if (!d) return null;
                  return (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => handleToggleUser(u, d)}
                      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[11.5px] font-medium transition-colors ${
                        isUserChecked(u, d) ? 'bg-teal-soft text-teal font-bold' : 'hover:bg-panel-alt text-ink'
                      }`}
                    >
                      <User size={13} className="text-teal shrink-0" />
                      <span className="flex-1 truncate">
                        <span className="font-semibold">{u.name}</span>
                        <span className="ml-1.5 text-ink3 text-[10.5px]">{u.position} · {u.dept}</span>
                      </span>
                      <input
                        type="checkbox"
                        checked={isUserChecked(u, d)}
                        readOnly
                        className="rounded border-border text-teal focus:ring-teal h-3.5 w-3.5 pointer-events-none"
                      />
                    </button>
                  );
                })}
              {filteredDepts.length === 0 && filteredUsers.length === 0 && (
                <p className="text-center text-[11px] text-ink3 py-8">검색 결과가 없습니다.</p>
              )}
            </div>
          ) : (
            /* 계층형 조직도 트리뷰 렌더링 (재귀 순회 방식) */
            <div className="space-y-1">
              {org.roots.map((root: any) => renderOrgNode(root, 0))}
            </div>
          )}
        </div>

        {/* 하단 선택된 목록 태그 표시 */}
        {selected.length > 0 && (
          <div className="border-t border-border px-4 py-2 flex flex-wrap gap-1 bg-panel-alt/10">
            {selected.map((s) => (
              <span key={s.id} className="flex items-center gap-1 rounded-full bg-teal-soft px-2.5 py-0.5 text-[10px] font-bold text-teal border border-teal/15 shadow-2xs">
                {s.type === 'dept' ? <Folder className="h-3 w-3" /> : <User className="h-3 w-3" />} {s.name.split(' · ')[0]}
                <button
                  type="button"
                  onClick={() => setSelected((p) => p.filter((x) => x.id !== s.id))}
                  className="text-teal/60 hover:text-red-500 font-bold ml-0.5 transition-colors cursor-pointer"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* 액션 푸터 */}
        <div className="flex gap-2 border-t border-border px-4 py-3 bg-panel-alt/10">
          <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-border py-1.5 text-[12px] font-semibold text-ink2 hover:bg-panel-alt transition-colors cursor-pointer">취소</button>
          <button
            type="button"
            disabled={selected.length === 0}
            onClick={() => { onConfirm(selected); onClose(); }}
            className="flex-1 rounded-lg bg-teal py-1.5 text-[12px] font-bold text-white hover:bg-teal-dark transition-colors disabled:opacity-40 cursor-pointer shadow-xs"
          >
            확인
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export function DraftRecipientSection({
  recipients = [], setRecipients, org,
}: {
  recipients: ApprovalRecipient[];
  setRecipients: React.Dispatch<React.SetStateAction<ApprovalRecipient[]>>;
  org: any;
}) {
  const [recipientDialog, setRecipientDialog] = useState(false);
  const excludeRecipientIds = new Set((recipients || []).map((r) => r.id));

  return (
    <div className="rounded-xl border border-border bg-panel-alt/30 overflow-hidden">
      {/* 섹션 헤더 */}
      <div className="px-3 pt-2.5 pb-2 border-b border-border/60 flex items-center justify-between">
        <span className="text-[11.5px] font-bold text-ink2 flex items-center gap-1.5">
          <Send className="h-3.5 w-3.5 text-teal shrink-0" />
          <span>수신처 설정</span>
        </span>
        <span className="text-[10px] text-ink3">결재 완료 후 자동 공유/전달</span>
      </div>

      {/* ─── 수신처 설정 ─── */}
      <div className="relative p-3 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-bold text-teal flex items-center gap-1">
            <span>수신처 (참조/수신 전용)</span>
          </div>
          <InfoTooltip text="문서가 최종 완료되면 지정한 수신처(부서 또는 사원)에 읽기 권한이 자동으로 부여(수신함)됩니다." />
        </div>

        {recipients.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {recipients.map((r) => (
              <span key={r.id} className="flex items-center gap-1 rounded-md border border-teal/25 bg-panel px-2 py-0.5 text-[10.5px] font-semibold text-teal shadow-xs">
                {r.type === 'dept' ? <Folder className="h-3 w-3" /> : <User className="h-3 w-3" />} {r.name}
                <button type="button" onClick={() => setRecipients((p) => p.filter((x) => x.id !== r.id))} className="ml-0.5 font-bold text-teal/50 hover:text-red-500 transition-colors">
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="text-[10.5px] text-ink3">지정된 수신처가 없습니다.</p>
        )}

        <button type="button" onClick={() => setRecipientDialog(true)}
          className="w-full rounded-lg border border-dashed border-teal/40 py-1.5 text-[11px] font-bold text-teal hover:bg-teal-soft/40 transition-colors">
          + 수신처 추가
        </button>
      </div>

      {recipientDialog && (
        <SelectorDialog title="수신처 추가" org={org} excludeIds={excludeRecipientIds} singleSelect={false}
          onConfirm={(items) => {
            setRecipients((prev) => [
              ...prev,
              ...items.filter((item) => !prev.some((r) => r.id === item.id))
                .map((item) => ({ id: item.id, name: item.name, type: item.type as 'user' | 'dept' })),
            ]);
            setRecipientDialog(false);
          }}
          onClose={() => setRecipientDialog(false)}
        />
      )}
    </div>
  );
}