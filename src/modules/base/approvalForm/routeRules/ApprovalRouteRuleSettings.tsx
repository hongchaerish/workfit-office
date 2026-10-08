import { useState, useMemo } from 'react';
import type { ApprovalForm } from '@/domain/approvalForm/schema';
import type { ApprovalRouteRule } from '@/domain/approvalRoute/schema';
import { useRouteRules, useUpsertRouteRule, useRemoveRouteRule } from '@/features/gw/useRouteRules';
import { ApprovalRouteRuleEditor } from './ApprovalRouteRuleEditor';
import { blankRule } from '../utils';

interface ApprovalRouteRuleSettingsProps {
  form: ApprovalForm;
  org: any;
}

export function ApprovalRouteRuleSettings({ form, org }: ApprovalRouteRuleSettingsProps) {
  const { data: rules = [], isLoading: rulesLoading } = useRouteRules();
  const upsertRule = useUpsertRouteRule();
  const removeRule = useRemoveRouteRule();

  const [selRule, setSelRule] = useState<ApprovalRouteRule | null>(null);
  const [ruleMsg, setRuleMsg] = useState('');

  const formRules = useMemo(() => {
    return rules
      .filter((r) => r.formId === form.id || (r.formId === null && r.docType === form.code))
      .sort((a, b) => a.priority - b.priority);
  }, [rules, form.id, form.code]);

  // Drag and Drop reordering states & handlers
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
  const [draggableRuleId, setDraggableRuleId] = useState<string | null>(null);

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIdx(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = async (e: React.DragEvent, targetIdx: number) => {
    e.preventDefault();
    if (draggedIdx === null || draggedIdx === targetIdx) return;

    const nextRules = [...formRules];
    const draggedItem = nextRules[draggedIdx];
    nextRules.splice(draggedIdx, 1);
    nextRules.splice(targetIdx, 0, draggedItem);

    const updated = nextRules.map((rule, idx) => ({
      ...rule,
      priority: idx + 1,
    }));

    for (const rule of updated) {
      await upsertRule.mutateAsync(rule);
    }
    setDraggedIdx(null);
  };

  const saveRule = async () => {
    if (!selRule) return;
    if (!selRule.name.trim()) return setRuleMsg('룰 이름을 입력하세요.');
    if (selRule.steps.length === 0) return setRuleMsg('최소 1개 이상의 결재 단계가 필요합니다.');

    const nextId = () =>
      `RR-${rules.length + 1}-${Math.max(0, ...rules.map((r) => Number(r.id.split('-')[1]) || 0)) + 1}`;

    const ruleToSave = {
      ...selRule,
      id: selRule.id || nextId(),
      formId: form.id,
      docType: form.code,
      priority: selRule.priority || formRules.length + 1,
    };

    await upsertRule.mutateAsync(ruleToSave);
    setRuleMsg('규칙이 저장되었습니다.');
    setSelRule(null);
  };

  const delRule = async (ruleId: string) => {
    if (!confirm('이 결재 규칙을 삭제하시겠습니까?')) return;
    await removeRule.mutateAsync(ruleId);
    setSelRule(null);
  };

  return (
    <div className="rounded-xl border border-border bg-panel p-4 space-y-4">
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div>
          <div className="text-[13px] font-bold text-ink">해당 서식 전용 결재 규칙 설정 ({formRules.length}개)</div>
          <div className="text-[10.5px] text-ink3 mt-0.5">이 서식 기안 시 기안자의 부서·직급 및 결재 조건에 매칭되어 작동할 결재선 규칙 목록입니다.</div>
        </div>
        <button
          type="button"
          onClick={() => {
            setSelRule(blankRule(form.id, form.code));
            setRuleMsg('');
          }}
          className="rounded-lg bg-teal px-3 py-1.5 text-[11px] font-bold text-white hover:opacity-90 cursor-pointer"
        >
          + 규칙 추가
        </button>
      </div>

      {rulesLoading ? (
        <div className="py-8 text-center text-[12px] text-ink3">로딩 중...</div>
      ) : formRules.length === 0 ? (
        <div className="py-12 text-center text-[12px] border border-dashed border-border rounded-xl text-ink3">
          등록된 서식 전용 규칙이 없습니다. 기본 전결 규칙이나 폴백이 적용됩니다.
        </div>
      ) : (
        <div className="space-y-2">
          {formRules.map((r, idx) => {
            const getScopeLabel = (rule: ApprovalRouteRule) =>
              rule.deptScope.kind === '전체'
                ? '전체부서'
                : rule.deptScope.kind === '부서유형'
                ? `유형=${rule.deptScope.deptType}`
                : `${rule.deptScope.kind}=${org.depts.find((d: any) => d.id === rule.deptScope.deptId)?.name ?? rule.deptScope.deptId}`;

            const isDragged = draggedIdx === idx;

            return (
              <div
                key={r.id}
                draggable={draggableRuleId === r.id}
                onDragStart={(e) => handleDragStart(e, idx)}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, idx)}
                className={`flex items-center justify-between rounded-xl border px-4 py-3 transition-all ${
                  isDragged
                    ? 'border-dashed border-teal/40 bg-teal-soft/10 opacity-40 shadow-xs'
                    : 'border-border bg-panel hover:border-teal/30 hover:shadow-sm'
                }`}
              >
                <div className="flex items-center gap-3">
                  {/* 드래그 핸들 (좌측 그립만 드래그 가능하게 통제) */}
                  <span
                    onMouseDown={() => setDraggableRuleId(r.id)}
                    onMouseUp={() => setDraggableRuleId(null)}
                    onMouseLeave={() => setDraggableRuleId(null)}
                    className="cursor-grab active:cursor-grabbing text-ink3 hover:text-teal transition-colors p-1 text-[14px] select-none"
                    title="드래그하여 순서 변경"
                  >
                    ☰
                  </span>
                  <span className="grid h-6 min-w-6 place-items-center rounded bg-ink3/10 px-1 text-[11px] font-bold text-ink2 pointer-events-none">
                    {idx + 1}
                  </span>
                  <div className="min-w-0">
                    <span className="font-semibold text-[13px] text-ink truncate block">{r.name}</span>
                    <span className="text-[11px] text-ink3 mt-0.5 block">
                      적용부서: <span className="text-ink2">{getScopeLabel(r)}</span> · 결재 프로세스:{' '}
                      <span className="text-teal font-medium">{r.steps.length}단계</span>
                    </span>
                  </div>
                  {!r.active && (
                    <span className="rounded bg-red-100 px-1.5 py-0.5 text-[9px] font-bold text-red-600">중지됨</span>
                  )}
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setSelRule(r);
                      setRuleMsg('');
                    }}
                    className="rounded-lg border border-border-hi bg-panel-alt px-3 py-1.5 text-[11.5px] font-semibold text-ink2 hover:bg-border/30 transition-colors cursor-pointer"
                  >
                    수정
                  </button>
                  <button
                    type="button"
                    onClick={() => delRule(r.id)}
                    className="rounded-lg border border-border-hi bg-panel-alt px-3 py-1.5 text-[11.5px] font-semibold text-red-500 hover:bg-red-500/5 transition-colors cursor-pointer"
                  >
                    ✕
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 룰 편집 모달 다이얼로그 */}
      {selRule && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4">
          <div
            className="relative w-[640px] max-h-[calc(85vh/var(--font-scale,1))] overflow-y-auto rounded-xl bg-panel border border-border p-6 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setSelRule(null)}
              className="absolute right-4 top-4 text-ink3 hover:text-ink text-[18px] font-semibold cursor-pointer"
            >
              ✕
            </button>
            <ApprovalRouteRuleEditor
              rule={selRule}
              onChange={setSelRule}
              onSave={saveRule}
              onCancel={() => setSelRule(null)}
              onDelete={selRule.id ? () => delRule(selRule.id) : undefined}
              saving={upsertRule.isPending}
              msg={ruleMsg}
              forms={[form]}
              org={org}
            />
          </div>
        </div>
      )}
    </div>
  );
}
