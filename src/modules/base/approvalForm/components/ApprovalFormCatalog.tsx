import { useState, useMemo } from 'react';
import type { ApprovalForm, ApprovalFolder } from '@/domain/approvalForm/schema';
import { useRouteRules } from '@/features/gw/useRouteRules';
import {
  Search,
  Plus,
  Copy,
  Trash2,
  Edit3,
  Shield,
  Clock,
  ArrowUpDown,
  FileText,
  SlidersHorizontal,
} from 'lucide-react';

interface ApprovalFormCatalogProps {
  forms: ApprovalForm[];
  folders: ApprovalFolder[];
  selFolderId: string | null;
  onSelectForm: (form: ApprovalForm) => void;
  onAddNewForm: () => void;
  onToggleActive: (form: ApprovalForm) => void;
  onDuplicate: (form: ApprovalForm) => void;
  onDelete: (form: ApprovalForm) => void;
}

export function ApprovalFormCatalog({
  forms,
  folders,
  selFolderId,
  onSelectForm,
  onAddNewForm,
  onToggleActive,
  onDuplicate,
  onDelete,
}: ApprovalFormCatalogProps) {
  const { data: rules = [] } = useRouteRules();
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'order' | 'name' | 'code'>('order');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  // 폴더 맵핑
  const folderMap = useMemo(() => {
    const map = new Map<string, string>();
    folders.forEach((f) => map.set(f.id, f.name));
    return map;
  }, [folders]);

  // 서식별 결재규칙 개수 맵핑
  const ruleCountMap = useMemo(() => {
    const map = new Map<string, number>();
    rules.forEach((r) => {
      if (r.formId) {
        map.set(r.formId, (map.get(r.formId) || 0) + 1);
      }
      if (r.docType) {
        map.set(r.docType, (map.get(r.docType) || 0) + 1);
      }
    });
    return map;
  }, [rules]);

  // 필터링 및 정렬
  const filteredForms = useMemo(() => {
    let list = forms;

    // 1. 폴더 필터
    if (selFolderId === 'root') {
      list = list.filter((f) => !f.folderId);
    } else if (selFolderId) {
      list = list.filter((f) => f.folderId === selFolderId);
    }

    // 2. 사용 상태 필터
    if (statusFilter === 'active') {
      list = list.filter((f) => f.active);
    } else if (statusFilter === 'inactive') {
      list = list.filter((f) => !f.active);
    }

    // 3. 검색 필터
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(
        (f) =>
          f.name.toLowerCase().includes(q) ||
          f.code.toLowerCase().includes(q) ||
          (f.docTitle && f.docTitle.toLowerCase().includes(q))
      );
    }

    // 4. 정렬
    return [...list].sort((a, b) => {
      if (sortBy === 'order') return (a.order ?? 99) - (b.order ?? 99);
      if (sortBy === 'name') return a.name.localeCompare(b.name, 'ko');
      if (sortBy === 'code') return a.code.localeCompare(b.code);
      return 0;
    });
  }, [forms, selFolderId, statusFilter, searchQuery, sortBy]);

  // 통계
  const stats = useMemo(() => {
    const total = forms.length;
    const active = forms.filter((f) => f.active).length;
    const inactive = total - active;
    return { total, active, inactive };
  }, [forms]);

  const currentFolderTitle = useMemo(() => {
    if (!selFolderId) return '전체 서식';
    if (selFolderId === 'root') return '루트 (미지정 폴더)';
    return folderMap.get(selFolderId) || '선택된 폴더';
  }, [selFolderId, folderMap]);

  return (
    <div className="space-y-4">
      {/* 상단 요약 배너 및 컨트롤러 */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-panel p-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-[15px] font-bold text-ink">{currentFolderTitle}</h2>
            <span className="rounded-full bg-teal-soft px-2 py-0.5 text-[11px] font-bold text-teal">
              {filteredForms.length}개
            </span>
          </div>
          <div className="mt-1 flex items-center gap-3 text-[11.5px] text-ink3">
            <span>전체 {stats.total}종</span>
            <span>·</span>
            <span className="text-emerald font-semibold">사용 중 {stats.active}종</span>
            <span>·</span>
            <span className="text-ink3/70">사용 중지 {stats.inactive}종</span>
          </div>
        </div>

        {/* 상단 우측 액션 */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* 검색 입력창 */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink3" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="서식명 / 코드 검색..."
              className="h-8.5 w-48 rounded-lg border border-border bg-panel-alt pl-8 pr-3 text-[11.5px] text-ink outline-none transition-all placeholder:text-ink3 focus:w-60 focus:border-teal focus:bg-panel"
            />
          </div>

          {/* 상태 필터 버튼 그룹 */}
          <div className="inline-flex rounded-lg border border-border bg-panel-alt p-0.5 text-[11px]">
            <button
              type="button"
              onClick={() => setStatusFilter('all')}
              className={`rounded-md px-2.5 py-1 font-semibold transition-all ${
                statusFilter === 'all' ? 'bg-panel font-bold text-teal shadow-xs' : 'text-ink3 hover:text-ink'
              }`}
            >
              전체
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('active')}
              className={`rounded-md px-2.5 py-1 font-semibold transition-all ${
                statusFilter === 'active' ? 'bg-panel font-bold text-emerald shadow-xs' : 'text-ink3 hover:text-ink'
              }`}
            >
              사용
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('inactive')}
              className={`rounded-md px-2.5 py-1 font-semibold transition-all ${
                statusFilter === 'inactive' ? 'bg-panel font-bold text-ink2 shadow-xs' : 'text-ink3 hover:text-ink'
              }`}
            >
              중지
            </button>
          </div>

          {/* 정렬 셀렉트 */}
          <div className="flex items-center gap-1 rounded-lg border border-border bg-panel-alt px-2.5 py-1 text-[11.5px]">
            <ArrowUpDown className="h-3 w-3 text-ink3" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="bg-transparent text-[11px] font-semibold text-ink2 outline-none cursor-pointer"
            >
              <option value="order">정렬순서</option>
              <option value="name">서식명 (가나다)</option>
              <option value="code">코드순</option>
            </select>
          </div>

          {/* 서식 추가 버튼 */}
          <button
            type="button"
            onClick={onAddNewForm}
            className="flex items-center gap-1.5 rounded-lg bg-teal px-3.5 py-1.5 text-[12px] font-bold text-white shadow-xs transition-opacity hover:opacity-90 cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>새 서식 추가</span>
          </button>
        </div>
      </div>

      {/* 서식 목록 카드 그리드 */}
      {filteredForms.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-panel/50 py-24 text-center">
          <FileText className="mb-2 h-10 w-10 text-ink3/40" />
          <p className="text-[13px] font-bold text-ink2">조건에 부합하는 결재 서식이 없습니다.</p>
          <p className="mt-1 text-[11.5px] text-ink3">검색어를 변경하거나 새로운 서식을 추가해 보세요.</p>
          <button
            type="button"
            onClick={onAddNewForm}
            className="mt-4 flex items-center gap-1.5 rounded-lg bg-teal-soft px-3 py-1.5 text-[11.5px] font-bold text-teal hover:bg-teal hover:text-white transition-colors cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            새 서식 디자인 시작하기
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-3">
          {filteredForms.map((formItem) => {
            const ruleCount =
              (ruleCountMap.get(formItem.id) || 0) + (ruleCountMap.get(formItem.code) || 0);
            const folderName = formItem.folderId
              ? folderMap.get(formItem.folderId) || '지정 폴더'
              : '루트 (미지정)';

            return (
              <div
                key={formItem.id}
                className={`group relative flex flex-col justify-between rounded-xl border transition-all duration-200 bg-panel hover:shadow-md ${
                  formItem.active
                    ? 'border-border hover:border-teal/50'
                    : 'border-border/60 bg-panel-alt/40 opacity-80'
                }`}
              >
                {/* 상단 카드 바디 (클릭 시 편집기 진입) */}
                <div
                  onClick={() => onSelectForm(formItem)}
                  className="p-4 cursor-pointer"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-panel-alt text-[20px] shadow-xs border border-border/60 group-hover:scale-105 transition-transform">
                        {formItem.icon || '📄'}
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <h3 className="truncate text-[13.5px] font-bold text-ink group-hover:text-teal transition-colors">
                            {formItem.name}
                          </h3>
                          {formItem.system && (
                            <span className="shrink-0 rounded bg-ink3/10 px-1.5 py-0.2 text-[9px] font-extrabold text-ink3">
                              기본
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink3">
                          <span className="truncate">{folderName}</span>
                        </div>
                      </div>
                    </div>

                    {/* 원클릭 사용/중지 토글 스위치 */}
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center gap-1.5"
                    >
                      <label className="relative inline-flex cursor-pointer items-center">
                        <input
                          type="checkbox"
                          checked={formItem.active}
                          onChange={() => onToggleActive(formItem)}
                          className="peer sr-only"
                        />
                        <div className="peer h-4.5 w-8 rounded-full bg-border-hi after:absolute after:left-[2px] after:top-[2px] after:h-3.5 after:w-3.5 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:bg-teal peer-checked:after:translate-x-3.5 peer-focus:outline-none"></div>
                      </label>
                      <span
                        className={`text-[10.5px] font-bold ${
                          formItem.active ? 'text-teal' : 'text-ink3'
                        }`}
                      >
                        {formItem.active ? '사용' : '중지'}
                      </span>
                    </div>
                  </div>

                  {/* 서식 본문 필드 및 격식 정보 */}
                  <div className="mt-3.5 rounded-lg bg-panel-alt/60 p-2.5 text-[11px] space-y-1.5">
                    <div className="flex items-center justify-between text-ink3">
                      <span>격식 문서명:</span>
                      <span className="font-semibold text-ink2 truncate max-w-[170px]">
                        {formItem.docTitle || formItem.name}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-ink3">
                      <span>입력 필드:</span>
                      <span className="font-semibold text-ink2">
                        {formItem.fields?.length ?? 0}개 항목
                      </span>
                    </div>
                  </div>

                  {/* 메타데이터 배지 행 */}
                  <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[10px]">
                    <span className="inline-flex items-center gap-1 rounded bg-panel-alt px-2 py-0.5 font-medium text-ink2 border border-border/50">
                      <Shield className="h-2.5 w-2.5 text-ink3" />
                      {formItem.securityLevel || '일반'}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded bg-panel-alt px-2 py-0.5 font-medium text-ink2 border border-border/50">
                      <Clock className="h-2.5 w-2.5 text-ink3" />
                      {formItem.preservationPeriod || '5년'}
                    </span>
                    {ruleCount > 0 && (
                      <span className="inline-flex items-center gap-1 rounded bg-indigo-500/10 px-2 py-0.5 font-bold text-indigo-600">
                        <SlidersHorizontal className="h-2.5 w-2.5" />
                        결재규칙 {ruleCount}개
                      </span>
                    )}
                  </div>
                </div>

                {/* 하단 카드 액션 바 */}
                <div className="flex items-center justify-between border-t border-border/60 bg-panel-alt/20 px-4 py-2 text-[11px]">
                  <span className="text-ink3 font-mono text-[10px]">
                    정렬순서: {formItem.order ?? 99}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onDuplicate(formItem)}
                      title="서식 복사"
                      className="rounded p-1 text-ink3 hover:bg-panel hover:text-ink transition-colors cursor-pointer"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                    {!formItem.system && (
                      <button
                        type="button"
                        onClick={() => onDelete(formItem)}
                        title="서식 삭제"
                        className="rounded p-1 text-ink3 hover:bg-red-500/10 hover:text-red-500 transition-colors cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onSelectForm(formItem)}
                      className="ml-1 flex items-center gap-1 rounded bg-teal-soft px-2.5 py-1 font-bold text-teal hover:bg-teal hover:text-white transition-colors cursor-pointer"
                    >
                      <Edit3 className="h-3 w-3" />
                      <span>디자인 편집</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
