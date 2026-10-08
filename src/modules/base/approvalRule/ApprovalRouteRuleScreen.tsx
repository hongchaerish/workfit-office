import { useState, useMemo } from 'react';
import { useRouteRules, useUpsertRouteRule, useRemoveRouteRule } from '@/features/gw/useRouteRules';
import { useApprovalForms } from '@/features/gw/useApprovalForms';
import { useOrgTree } from '@/features/gw/useOrgTree';
import type { ApprovalRouteRule } from '@/domain/approvalRoute/schema';
import { ApprovalRouteRuleEditor } from '@/modules/base/approvalForm/routeRules/ApprovalRouteRuleEditor';
import { RESOLVER_LABEL } from '@/modules/base/approvalForm/utils';
import {
  Plus,
  Search,
  Copy,
  Trash2,
  Edit3,
  GripVertical,
  GitMerge,
  Filter,
  ArrowRight,
  ShieldCheck,
  Building2,
  DollarSign,
  X,
} from 'lucide-react';

/**
 * 결재규칙(전결규정) 관리 독립 화면.
 * 전사의 모든 결재규칙(전사 공통 및 각 서식별 특화 규칙)을 한곳에서
 * 일목요연하게 조망하고 우선순위 드래그 앤 드롭 및 CRUD를 총괄 수행합니다.
 */
export default function ApprovalRouteRuleScreen() {
  const { data: rules = [], isLoading: rulesLoading } = useRouteRules();
  const { data: forms = [], isLoading: formsLoading } = useApprovalForms();
  const org = useOrgTree();
  const upsertRule = useUpsertRouteRule();
  const removeRule = useRemoveRouteRule();

  // 검색 및 필터 상태
  const [query, setQuery] = useState('');
  const [selectedFormFilter, setSelectedFormFilter] = useState<string>('ALL'); // 'ALL' | 'GLOBAL' | formCode
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');

  // 편집 모달 상태
  const [selRule, setSelRule] = useState<ApprovalRouteRule | null>(null);
  const [editorMsg, setEditorMsg] = useState('');

  // Drag and Drop reordering 상태
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
  const [draggableRuleId, setDraggableRuleId] = useState<string | null>(null);

  // 서식 매핑 헬퍼
  const formMap = useMemo(() => {
    const map = new Map<string, (typeof forms)[0]>();
    forms.forEach((f) => map.set(f.code, f));
    return map;
  }, [forms]);

  const formNameOf = (code: string) => formMap.get(code)?.name ?? code;
  const deptNameOf = (id: string | null) => org.depts.find((d) => d.id === id)?.name ?? (id || '');

  // 부서 범위 라벨 생성
  const getScopeLabel = (r: ApprovalRouteRule) => {
    if (r.deptScope.kind === '전체') return '전체 부서';
    if (r.deptScope.kind === '부서유형') return `부서유형: ${r.deptScope.deptType ?? '전체'}`;
    return `${r.deptScope.kind}: ${deptNameOf(r.deptScope.deptId)}`;
  };

  // 금액 포맷
  const formatAmount = (amt: number | null) => {
    if (amt === null || amt === undefined) return null;
    return `${new Intl.NumberFormat('ko-KR').format(amt)}원`;
  };

  // 통계 계산
  const stats = useMemo(() => {
    const total = rules.length;
    const activeCount = rules.filter((r) => r.active).length;
    const globalCount = rules.filter((r) => !r.docType || r.docType === '전체').length;
    const formSpecificCount = total - globalCount;
    return { total, activeCount, globalCount, formSpecificCount };
  }, [rules]);

  // 우선순위 정렬 및 필터링된 규칙 목록
  const sortedRules = useMemo(() => {
    return [...rules].sort((a, b) => a.priority - b.priority);
  }, [rules]);

  const filteredRules = useMemo(() => {
    let list = sortedRules;

    // 1. 서식 필터
    if (selectedFormFilter === 'GLOBAL') {
      list = list.filter((r) => !r.docType || r.docType === '전체');
    } else if (selectedFormFilter !== 'ALL') {
      list = list.filter((r) => r.docType === selectedFormFilter);
    }

    // 2. 상태 필터
    if (statusFilter === 'ACTIVE') {
      list = list.filter((r) => r.active);
    } else if (statusFilter === 'INACTIVE') {
      list = list.filter((r) => !r.active);
    }

    // 3. 텍스트 검색
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((r) => {
        const formName = r.docType ? formNameOf(r.docType).toLowerCase() : '';
        return (
          r.name.toLowerCase().includes(q) ||
          (r.docType && r.docType.toLowerCase().includes(q)) ||
          formName.includes(q) ||
          (r.conditionKey && r.conditionKey.toLowerCase().includes(q)) ||
          r.conditionValues.some((v) => v.toLowerCase().includes(q))
        );
      });
    }

    return list;
  }, [sortedRules, selectedFormFilter, statusFilter, query, formMap]);

  // 드래그 앤 드롭 정렬 핸들러
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

    const nextRules = [...filteredRules];
    const draggedItem = nextRules[draggedIdx];
    nextRules.splice(draggedIdx, 1);
    nextRules.splice(targetIdx, 0, draggedItem);

    // 전체 리스트 순위 재할당
    const updated = nextRules.map((rule, idx) => ({
      ...rule,
      priority: idx + 1,
    }));

    for (const rule of updated) {
      await upsertRule.mutateAsync(rule);
    }
    setDraggedIdx(null);
  };

  // 신규 룰 생성
  const handleAddNewRule = () => {
    const nextPriority = rules.length + 1;
    const defaultDocType = selectedFormFilter !== 'ALL' && selectedFormFilter !== 'GLOBAL'
      ? selectedFormFilter
      : '전체';
    const defaultForm = forms.find((f) => f.code === defaultDocType);

    const newRule: ApprovalRouteRule = {
      id: '',
      name: '',
      priority: nextPriority,
      active: true,
      formId: defaultForm?.id ?? null,
      docType: defaultDocType,
      conditionKey: null,
      conditionValues: [],
      deptScope: { kind: '전체', deptId: null, deptType: null },
      positionFromRank: null,
      positionToRank: null,
      amountFrom: null,
      amountTo: null,
      steps: [
        { resolver: 'DEPT_HEAD', arg: null, kind: '전결', dedupeSelf: true, optional: false },
      ],
    };

    setSelRule(newRule);
    setEditorMsg('');
  };

  // 룰 복사
  const handleDuplicateRule = async (rule: ApprovalRouteRule) => {
    const nextPriority = rules.length + 1;
    const nextId = `RR-${Date.now().toString(36).slice(-4)}-${Math.floor(Math.random() * 1000)}`;
    const cloned: ApprovalRouteRule = {
      ...rule,
      id: nextId,
      name: `${rule.name} (복사본)`,
      priority: nextPriority,
    };
    await upsertRule.mutateAsync(cloned);
  };

  // 룰 저장
  const handleSaveRule = async () => {
    if (!selRule) return;
    if (!selRule.name.trim()) {
      setEditorMsg('규칙 이름을 입력해 주세요.');
      return;
    }
    if (selRule.steps.length === 0) {
      setEditorMsg('최소 1개 이상의 결재 단계가 필요합니다.');
      return;
    }

    const nextId = () =>
      `RR-${rules.length + 1}-${Math.max(0, ...rules.map((r) => Number(r.id.split('-')[1]) || 0)) + 1}`;

    const ruleToSave: ApprovalRouteRule = {
      ...selRule,
      id: selRule.id || nextId(),
    };

    await upsertRule.mutateAsync(ruleToSave);
    setEditorMsg('규칙이 성공적으로 저장되었습니다.');
    setSelRule(null);
  };

  // 룰 삭제
  const handleDeleteRule = async (ruleId: string) => {
    if (!window.confirm('이 결재 규칙을 정말 삭제하시겠습니까?')) return;
    await removeRule.mutateAsync(ruleId);
    if (selRule?.id === ruleId) {
      setSelRule(null);
    }
  };

  // 활성/비활성 토글
  const handleToggleActive = async (rule: ApprovalRouteRule) => {
    await upsertRule.mutateAsync({
      ...rule,
      active: !rule.active,
    });
  };

  return (
    <div className="flex flex-col gap-4 p-1">
      {/* 1. 상단 타이틀 & 통계 카드 */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-teal/10 px-2 py-0.5 text-[11px] font-extrabold text-teal border border-teal/20">
              기준 정보
            </span>
            <span className="text-[12px] text-ink3 font-medium">조직·결재 기준정보</span>
          </div>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-ink flex items-center gap-2.5">
            <GitMerge className="h-6 w-6 text-teal" />
            <span>결재규칙(전결규정) 관리</span>
          </h1>
          <p className="mt-0.5 text-xs text-ink3">
            전사 공통 및 서식별 위임전결 규정, 부서·직급·금액 조건에 따른 자동 결재선을 총괄 관리합니다.
          </p>
        </div>

        {/* 액션 버튼 */}
        <button
          type="button"
          onClick={handleAddNewRule}
          className="flex items-center gap-1.5 self-start md:self-auto rounded-xl bg-teal px-4 py-2 text-[13px] font-bold text-white shadow-sm hover:opacity-90 transition-all cursor-pointer"
        >
          <Plus className="h-4 w-4" />
          <span>새 결재규칙 등록</span>
        </button>
      </div>

      {/* 2. 대시보드 통계 카드 그리드 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-xl border border-border bg-panel p-3.5 shadow-xs">
          <div className="text-[11px] font-semibold text-ink3">전체 결재규칙</div>
          <div className="mt-1 text-2xl font-extrabold text-ink">{stats.total}개</div>
        </div>
        <div className="rounded-xl border border-border bg-panel p-3.5 shadow-xs">
          <div className="text-[11px] font-semibold text-teal">정상 운영 (활성)</div>
          <div className="mt-1 text-2xl font-extrabold text-teal">{stats.activeCount}개</div>
        </div>
        <div className="rounded-xl border border-border bg-panel p-3.5 shadow-xs">
          <div className="text-[11px] font-semibold text-blue-600 dark:text-blue-400">전사 공통 규칙</div>
          <div className="mt-1 text-2xl font-extrabold text-blue-600 dark:text-blue-400">{stats.globalCount}개</div>
        </div>
        <div className="rounded-xl border border-border bg-panel p-3.5 shadow-xs">
          <div className="text-[11px] font-semibold text-purple-600 dark:text-purple-400">서식 전용 규칙</div>
          <div className="mt-1 text-2xl font-extrabold text-purple-600 dark:text-purple-400">{stats.formSpecificCount}개</div>
        </div>
      </div>

      {/* 3. 검색 및 필터 툴바 */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-panel p-3 shadow-xs">
        <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[300px]">
          {/* 검색창 */}
          <div className="relative flex-1 min-w-[200px] max-w-[320px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink3" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="규칙명, 서식명, 조건 검색..."
              className="w-full rounded-lg border border-border bg-panel-alt pl-9 pr-3 py-1.5 text-[12px] text-ink outline-none focus:border-teal transition-colors"
            />
          </div>

          {/* 적용 서식 필터 드롭다운 */}
          <div className="flex items-center gap-1 text-[11.5px] text-ink2">
            <Filter className="h-3.5 w-3.5 text-ink3" />
            <select
              value={selectedFormFilter}
              onChange={(e) => setSelectedFormFilter(e.target.value)}
              className="rounded-lg border border-border bg-panel-alt px-2.5 py-1.5 text-[12px] text-ink outline-none focus:border-teal cursor-pointer"
            >
              <option value="ALL">전체 서식/공통 ({rules.length})</option>
              <option value="GLOBAL">🌐 전사 공통 규칙 ({stats.globalCount})</option>
              <optgroup label="개별 서식">
                {forms.map((f) => {
                  const count = rules.filter((r) => r.docType === f.code || r.formId === f.id).length;
                  return (
                    <option key={f.id} value={f.code}>
                      {f.icon || '📄'} {f.name} ({count})
                    </option>
                  );
                })}
              </optgroup>
            </select>
          </div>

          {/* 활성/중지 상태 필터 */}
          <div className="flex rounded-lg border border-border bg-panel-alt p-0.5 text-[11.5px]">
            <button
              type="button"
              onClick={() => setStatusFilter('ALL')}
              className={`px-2.5 py-1 font-semibold rounded-md transition-all cursor-pointer ${
                statusFilter === 'ALL'
                  ? 'bg-panel text-teal shadow-xs'
                  : 'text-ink3 hover:text-ink'
              }`}
            >
              전체
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('ACTIVE')}
              className={`px-2.5 py-1 font-semibold rounded-md transition-all cursor-pointer ${
                statusFilter === 'ACTIVE'
                  ? 'bg-panel text-teal shadow-xs'
                  : 'text-ink3 hover:text-ink'
              }`}
            >
              사용중
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('INACTIVE')}
              className={`px-2.5 py-1 font-semibold rounded-md transition-all cursor-pointer ${
                statusFilter === 'INACTIVE'
                  ? 'bg-panel text-teal shadow-xs'
                  : 'text-ink3 hover:text-ink'
              }`}
            >
              중지
            </button>
          </div>
        </div>

        <div className="text-[11.5px] text-ink3 font-medium">
          조회 결과: <span className="font-bold text-teal">{filteredRules.length}</span>개 규칙
          <span className="ml-2 text-ink3/80 text-[10.5px]">
            (☰ 핸들을 드래그하여 우선순위를 변경할 수 있습니다)
          </span>
        </div>
      </div>

      {/* 4. 결재 규칙 마스터 카드 리스트 */}
      {rulesLoading || formsLoading ? (
        <div className="py-20 text-center text-[12.5px] text-ink3 rounded-xl border border-border bg-panel">
          결재 규칙 데이터를 불러오는 중입니다...
        </div>
      ) : filteredRules.length === 0 ? (
        <div className="py-20 text-center rounded-xl border border-dashed border-border bg-panel p-8 space-y-3">
          <GitMerge className="h-10 w-10 text-ink3/50 mx-auto" />
          <div className="text-[13.5px] font-bold text-ink">일치하는 결재 규칙이 없습니다.</div>
          <p className="text-[11.5px] text-ink3 max-w-md mx-auto">
            조건에 맞는 규칙이 없습니다. 검색어나 필터를 초기화하거나 새로운 결재선 규칙을 등록하세요.
          </p>
          <button
            type="button"
            onClick={handleAddNewRule}
            className="inline-flex items-center gap-1.5 rounded-lg bg-teal px-3.5 py-1.5 text-[12px] font-bold text-white hover:opacity-90 cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>결재규칙 추가</span>
          </button>
        </div>
      ) : (
        <div className="space-y-2.5">
          {filteredRules.map((rule, idx) => {
            const isDragged = draggedIdx === idx;
            const isGlobal = !rule.docType || rule.docType === '전체';
            const targetForm = !isGlobal ? formMap.get(rule.docType) : null;

            return (
              <div
                key={rule.id}
                draggable={draggableRuleId === rule.id}
                onDragStart={(e) => handleDragStart(e, idx)}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, idx)}
                className={`rounded-xl border bg-panel p-4 transition-all shadow-xs ${
                  isDragged
                    ? 'border-dashed border-teal bg-teal-soft/15 opacity-40 shadow-none'
                    : 'border-border hover:border-teal/40 hover:shadow-sm'
                }`}
              >
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                  {/* 좌측: 드래그 핸들 + 순위 + 규칙명 + 태그 */}
                  <div className="flex items-start sm:items-center gap-3 min-w-0 flex-1">
                    {/* 드래그 그립 */}
                    <span
                      onMouseDown={() => setDraggableRuleId(rule.id)}
                      onMouseUp={() => setDraggableRuleId(null)}
                      onMouseLeave={() => setDraggableRuleId(null)}
                      className="cursor-grab active:cursor-grabbing text-ink3 hover:text-teal transition-colors p-1 text-[16px] select-none shrink-0"
                      title="드래그하여 우선순위 변경"
                    >
                      <GripVertical className="h-4 w-4" />
                    </span>

                    {/* 우선순위 배지 */}
                    <span className="grid h-6 min-w-6 place-items-center rounded-md bg-ink3/10 px-1 text-[11px] font-mono font-bold text-ink2 shrink-0">
                      #{rule.priority}
                    </span>

                    {/* 규칙명 & 적용 서식 */}
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-[13.5px] text-ink truncate">{rule.name}</span>

                        {/* 전사 공통 or 개별 서식 배지 */}
                        {isGlobal ? (
                          <span className="rounded-md bg-blue-500/10 px-2 py-0.5 text-[10.5px] font-bold text-blue-600 dark:text-blue-400 border border-blue-500/20">
                            🌐 전사 공통
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 rounded-md bg-purple-500/10 px-2 py-0.5 text-[10.5px] font-bold text-purple-600 dark:text-purple-400 border border-purple-500/20">
                            <span>{targetForm?.icon || '📄'}</span>
                            <span>{targetForm?.name || rule.docType}</span>
                          </span>
                        )}

                        {/* 사용 / 중지 상태 버튼 */}
                        <button
                          type="button"
                          onClick={() => handleToggleActive(rule)}
                          className={`rounded-md px-2 py-0.5 text-[10px] font-extrabold transition-all cursor-pointer ${
                            rule.active
                              ? 'bg-teal-soft text-teal hover:opacity-80'
                              : 'bg-red-500/10 text-red-500 border border-red-500/20'
                          }`}
                        >
                          {rule.active ? '운영중' : '중지됨'}
                        </button>
                      </div>

                      {/* 적용 세부 조건 배지들 */}
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink3">
                        <span className="flex items-center gap-1">
                          <Building2 className="h-3 w-3 text-ink3" />
                          <span className="text-ink2">{getScopeLabel(rule)}</span>
                        </span>

                        {(rule.positionToRank || rule.positionFromRank) && (
                          <span className="flex items-center gap-1 border-l border-border pl-2">
                            <ShieldCheck className="h-3 w-3 text-ink3" />
                            <span>직급: </span>
                            <span className="font-medium text-ink2">
                              {rule.positionToRank ? `서열 ${rule.positionToRank} 이상` : ''}
                              {rule.positionFromRank ? ` 서열 ${rule.positionFromRank} 이하` : ''}
                            </span>
                          </span>
                        )}

                        {(rule.amountFrom !== null || rule.amountTo !== null) && (
                          <span className="flex items-center gap-1 border-l border-border pl-2">
                            <DollarSign className="h-3 w-3 text-ink3" />
                            <span>금액: </span>
                            <span className="font-semibold text-teal">
                              {rule.amountFrom ? formatAmount(rule.amountFrom) : '0원'} ~{' '}
                              {rule.amountTo ? formatAmount(rule.amountTo) : '무제한'}
                            </span>
                          </span>
                        )}

                        {rule.conditionKey && rule.conditionValues.length > 0 && (
                          <span className="flex items-center gap-1 border-l border-border pl-2">
                            <span>구분키({rule.conditionKey}): </span>
                            <span className="text-ink2 font-medium">
                              {rule.conditionValues.join(', ')}
                            </span>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* 우측: 액션 버튼 */}
                  <div className="flex items-center gap-1.5 self-end lg:self-center shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setSelRule(rule);
                        setEditorMsg('');
                      }}
                      className="flex items-center gap-1 rounded-lg border border-border bg-panel-alt px-3 py-1.5 text-[11.5px] font-bold text-ink2 hover:border-teal hover:text-teal transition-colors cursor-pointer"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                      <span>편집</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDuplicateRule(rule)}
                      className="flex items-center gap-1 rounded-lg border border-border bg-panel-alt px-2.5 py-1.5 text-[11.5px] font-semibold text-ink2 hover:bg-border/30 transition-colors cursor-pointer"
                      title="규칙 복제"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteRule(rule.id)}
                      className="flex items-center gap-1 rounded-lg border border-border bg-panel-alt px-2.5 py-1.5 text-[11.5px] font-semibold text-red-500 hover:bg-red-500/10 transition-colors cursor-pointer"
                      title="규칙 삭제"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {/* 하단: 생성되는 결재선 타임라인 흐름도 배지 */}
                <div className="mt-3 pt-2.5 border-t border-border/60 flex flex-wrap items-center gap-1.5">
                  <span className="text-[10.5px] font-bold text-ink3 mr-1 shrink-0">자동 결재선:</span>
                  <span className="inline-flex items-center gap-1 rounded bg-panel-alt px-2 py-0.5 text-[10.5px] font-semibold text-ink2 border border-border/80">
                    기안자
                  </span>
                  {rule.steps.map((step, sIdx) => {
                    const label = RESOLVER_LABEL[step.resolver] || step.resolver;
                    const kind = step.kind;

                    const kindColor =
                      kind === '전결'
                        ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30'
                        : kind === '검토'
                        ? 'bg-purple-500/15 text-purple-700 dark:text-purple-400 border-purple-500/30'
                        : kind === '참조'
                        ? 'bg-ink3/10 text-ink3 border-border'
                        : 'bg-teal-soft text-teal border-teal/30';

                    return (
                      <div key={sIdx} className="inline-flex items-center gap-1.5">
                        <ArrowRight className="h-3 w-3 text-ink3" />
                        <span
                          className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10.5px] font-bold border ${kindColor}`}
                        >
                          <span>{label}</span>
                          <span className="text-[9px] opacity-80 font-normal">[{kind}]</span>
                          {step.arg && (
                            <span className="text-[9px] opacity-70">({step.arg})</span>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 5. 룰 편집/추가 전용 팝업 모달 (ApprovalRouteRuleEditor 100% 재사용) */}
      {selRule && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-200"
          onClick={() => setSelRule(null)}
        >
          <div
            className="relative w-full max-w-3xl max-h-[calc(88vh/var(--font-scale,1))] overflow-y-auto rounded-2xl bg-panel border border-border p-6 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-soft text-teal">
                  <GitMerge className="h-4 w-4" />
                </span>
                <div>
                  <h2 className="text-[15px] font-bold text-ink">
                    {selRule.id ? `결재 규칙 편집 · ${selRule.name || selRule.id}` : '새 결재 규칙 등록'}
                  </h2>
                  <p className="text-[11px] text-ink3">
                    조직도 기반 동적 결재선 단계 및 적용 조건을 설정합니다.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelRule(null)}
                className="rounded-lg p-1 text-ink3 hover:bg-panel-alt hover:text-ink transition-colors cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <ApprovalRouteRuleEditor
              rule={selRule}
              onChange={setSelRule}
              onSave={handleSaveRule}
              onCancel={() => setSelRule(null)}
              onDelete={selRule.id ? () => handleDeleteRule(selRule.id) : undefined}
              saving={upsertRule.isPending}
              msg={editorMsg}
              forms={forms}
              org={org}
            />
          </div>
        </div>
      )}
    </div>
  );
}
