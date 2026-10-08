import { useState, useMemo } from 'react';
import type { ApprovalDoc, RelatedDoc } from '@/domain/approvalDoc/schema';
import { useCompletedDocsForSelection } from '@/features/gw/useApprovals';
import { useOrgTree } from '@/features/gw/useOrgTree';
import { Link2, X, Info, Search, Paperclip } from 'lucide-react';

interface RelatedDocSearchModalProps {
  userId: string;
  userDept?: string;
  userDeptId?: string;
  selectedDocIds: string[];
  onSelect: (docs: RelatedDoc[]) => void;
  onClose: () => void;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yy}.${mm}.${dd}`;
}

export function RelatedDocSearchModal({
  userId,
  userDept,
  userDeptId,
  selectedDocIds,
  onSelect,
  onClose,
}: RelatedDocSearchModalProps) {
  const org = useOrgTree();
  const [keyword, setKeyword] = useState('');
  const [tempSelected, setTempSelected] = useState<ApprovalDoc[]>([]);

  const [scopeFilter, setScopeFilter] = useState<'all' | 'mine' | 'approver' | 'dept'>('all');
  const [selectedDocType, setSelectedDocType] = useState('전체 서식');
  const [dateRange, setDateRange] = useState('전체');
  const [limit, setLimit] = useState<number | 'all'>(10);

  // 모달 레벨 다차원 필터링을 위해 keyword를 비우고 본인이 권한을 가진 전체 문서를 훅에서 로드함
  const { data: docs = [], isLoading } = useCompletedDocsForSelection({
    userId,
    userDept,
    userDeptId,
    keyword: '',
  });

  const nameOf = (id: string) => org.userById(id)?.name ?? id;

  // 2. 고유 서식명 수집
  const docTypes = useMemo(() => {
    const types = new Set(docs.map((d) => d.docType));
    return ['전체 서식', ...Array.from(types)];
  }, [docs]);

  // 3. 다차원 클라이언트 사이드 필터링 적용
  const filteredDocs = useMemo(() => {
    let list = [...docs];

    // ① 문서 범위 필터
    if (scopeFilter === 'mine') {
      list = list.filter((d) => d.drafterId === userId);
    } else if (scopeFilter === 'approver') {
      list = list.filter((d) => d.steps.some((s) => s.approverId === userId));
    } else if (scopeFilter === 'dept') {
      list = list.filter(
        (d) => d.visibility === '부서' && ((userDeptId && d.drafterDeptId === userDeptId) || (userDept && d.drafterDept === userDept))
      );
    }

    // ② 서식 분류 필터
    if (selectedDocType !== '전체 서식') {
      list = list.filter((d) => d.docType === selectedDocType);
    }

    // ③ 완료일 기간 필터
    if (dateRange !== '전체') {
      const now = new Date();
      let limitDays = 0;
      if (dateRange === '1w') limitDays = 7;
      else if (dateRange === '1m') limitDays = 30;
      else if (dateRange === '3m') limitDays = 90;

      const cutoff = new Date(now.getTime() - limitDays * 24 * 60 * 60 * 1000);
      list = list.filter((d) => {
        if (!d.completedAt) return false;
        const compDate = new Date(d.completedAt);
        return !isNaN(compDate.getTime()) && compDate >= cutoff;
      });
    }

    // ④ 텍스트 검색어 필터 (로컬 매칭)
    if (keyword.trim()) {
      const kw = keyword.trim().toLowerCase();
      list = list.filter(
        (d) =>
          d.title.toLowerCase().includes(kw) ||
          d.docNo.toLowerCase().includes(kw) ||
          (d.drafterName && d.drafterName.toLowerCase().includes(kw))
      );
    }

    return list;
  }, [docs, scopeFilter, selectedDocType, dateRange, keyword, userId, userDept, userDeptId]);

  // 4. 표시 제한 슬라이싱
  const displayDocs = useMemo(() => {
    if (limit === 'all') return filteredDocs;
    return filteredDocs.slice(0, limit);
  }, [filteredDocs, limit]);

  const toggleSelect = (doc: ApprovalDoc) => {
    if (selectedDocIds.includes(doc.id)) return;
    setTempSelected((prev) =>
      prev.some((x) => x.id === doc.id) ? prev.filter((x) => x.id !== doc.id) : [...prev, doc]
    );
  };

  const handleApply = () => {
    const relatedList: RelatedDoc[] = tempSelected.map((d) => ({
      docId: d.id,
      docNo: d.docNo,
      title: d.title,
      docType: d.docType,
      drafterName: d.drafterName || nameOf(d.drafterId),
      drafterDept: d.drafterDept || '',
      completedAt: d.completedAt,
    }));
    onSelect(relatedList);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4 backdrop-blur-xs select-none"
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="flex max-h-[calc(85vh/var(--font-scale,1))] w-full max-w-4xl flex-col rounded-2xl border border-border bg-panel shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between border-b border-border bg-panel-alt/40 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Link2 className="h-4 w-4 text-teal shrink-0" />
            <h2 className="text-sm font-bold text-ink">관련 문서 선택 (기결재 완료 문서)</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-ink3 hover:bg-panel-alt hover:text-ink transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 보안 안내 팁 */}
        <div className="bg-amber-soft/10 border-b border-amber/15 px-5 py-2.5 text-[11px] text-amber-700 flex items-start gap-2">
          <Info className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <b>보안 안내:</b> 관련 문서 연동 시 원본 문서의 열람 권한이 그대로 유지됩니다. 개인정보나 연봉 등 민감 정보가 포함된 기결재 문서를 선택할 때는 결재선 지정 및 보안 지침에 유의해 주세요.
          </div>
        </div>

        {/* 검색 필터 바 */}
        <div className="flex flex-col gap-2.5 border-b border-border p-4 bg-panel shrink-0">
          <div className="relative flex items-center">
            <Search className="absolute left-3 h-4 w-4 text-ink3 pointer-events-none" />
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="문서 제목, 문서 번호, 기안자로 검색..."
              className="w-full rounded-xl border border-border bg-panel-alt px-3.5 py-2 pl-9 text-[12px] text-ink outline-none focus:border-[#4ea8de] focus:ring-2 focus:ring-[#4ea8de]/15 transition-all"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[11.5px]">
            {/* 범위 필터 */}
            <div className="flex items-center gap-1">
              <span className="text-ink3">범위:</span>
              <select
                value={scopeFilter}
                onChange={(e) => setScopeFilter(e.target.value as any)}
                className="rounded-lg border border-border bg-panel px-2.5 py-1 text-ink outline-none focus:border-[#4ea8de] transition-colors cursor-pointer"
              >
                <option value="all">전체 문서</option>
                <option value="mine">내가 기안한 문서</option>
                <option value="approver">내가 결재/합의한 문서</option>
                <option value="dept">우리 부서 공개 문서</option>
              </select>
            </div>

            {/* 서식 필터 */}
            <div className="flex items-center gap-1 ml-1">
              <span className="text-ink3">서식:</span>
              <select
                value={selectedDocType}
                onChange={(e) => setSelectedDocType(e.target.value)}
                className="rounded-lg border border-border bg-panel px-2.5 py-1 text-ink outline-none focus:border-[#4ea8de] transition-colors cursor-pointer"
              >
                {docTypes.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            {/* 기간 필터 */}
            <div className="flex items-center gap-1 ml-1">
              <span className="text-ink3">기간:</span>
              <select
                value={dateRange}
                onChange={(e) => setDateRange(e.target.value)}
                className="rounded-lg border border-border bg-panel px-2.5 py-1 text-ink outline-none focus:border-[#4ea8de] transition-colors cursor-pointer"
              >
                <option value="전체">전체 기간</option>
                <option value="1w">최근 1주일</option>
                <option value="1m">최근 1개월</option>
                <option value="3m">최근 3개월</option>
              </select>
            </div>

            {/* 표시 개수 제한 필터 */}
            <div className="flex items-center gap-1 ml-1">
              <span className="text-ink3">표시:</span>
              <select
                value={limit}
                onChange={(e) => setLimit(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                className="rounded-lg border border-border bg-panel px-2.5 py-1 text-ink outline-none focus:border-[#4ea8de] transition-colors cursor-pointer"
              >
                <option value={10}>10개씩 보기</option>
                <option value={20}>20개씩 보기</option>
                <option value={50}>50개씩 보기</option>
                <option value="all">전체 보기</option>
              </select>
            </div>

            {tempSelected.length > 0 && (
              <span className="ml-auto text-[11px] font-extrabold text-[#4ea8de]">
                {tempSelected.length}건 선택됨
              </span>
            )}
          </div>
        </div>

        {/* 문서 목록 그리드 */}
        <div className="menu-scroll flex-1 overflow-y-auto p-4">
          {isLoading ? (
            <div className="py-16 text-center text-[12px] text-ink3">완료 문서를 불러오는 중입니다...</div>
          ) : displayDocs.length === 0 ? (
            <div className="py-16 text-center text-[12px] text-ink3">
              조건에 일치하는 기결재 완료 문서가 없습니다.
            </div>
          ) : (
            <table className="w-full border-collapse text-[11.5px] table-fixed">
              <thead>
                <tr className="border-b border-border bg-panel-alt/50 text-ink3 text-left">
                  <th className="w-12 px-3 py-2 text-center">선택</th>
                  <th className="w-32 px-3 py-2">문서번호</th>
                  <th className="w-20 px-3 py-2">서식</th>
                  <th className="px-3 py-2">제목</th>
                  <th className="w-28 px-3 py-2">기안자</th>
                  <th className="w-24 px-3 py-2 text-center">결재 완료일</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {displayDocs.map((doc) => {
                  const isAlreadyAdded = selectedDocIds.includes(doc.id);
                  const isChecked = isAlreadyAdded || tempSelected.some((x) => x.id === doc.id);

                  return (
                    <tr
                      key={doc.id}
                      onClick={() => !isAlreadyAdded && toggleSelect(doc)}
                      className={`transition-all ${
                        isAlreadyAdded
                          ? 'bg-panel-alt/20 opacity-50 cursor-not-allowed'
                          : isChecked
                          ? 'bg-[#e3f2fd]/45 border-l-[3px] border-l-[#4ea8de] cursor-pointer font-medium'
                          : 'hover:bg-panel-alt/65 cursor-pointer'
                      }`}
                    >
                      <td className="px-3 py-2.5 text-center" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          disabled={isAlreadyAdded}
                          onChange={() => !isAlreadyAdded && toggleSelect(doc)}
                          className="rounded border-border text-[#4ea8de] focus:ring-[#4ea8de]/40 cursor-pointer"
                        />
                      </td>
                      <td className="px-3 py-2.5 font-mono text-[11px] text-ink2">{doc.docNo}</td>
                      <td className="px-3 py-2.5 font-semibold text-ink2">{doc.docType}</td>
                      <td className="px-3 py-2.5 font-bold text-ink truncate">
                        {doc.title}
                        {isAlreadyAdded && (
                          <span className="ml-1.5 text-[10px] font-normal text-ink3">(이미 추가됨)</span>
                        )}
                        {doc.attachments && doc.attachments.length > 0 && (
                          <span className="inline-flex items-center gap-0.5 ml-1.5 text-[10px] text-[#4ea8de] font-normal" title={`첨부파일 ${doc.attachments.length}개 포함`}>
                            <Paperclip className="h-3 w-3 inline" />
                            <span>({doc.attachments.length})</span>
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-ink2 truncate">
                        {doc.drafterName || nameOf(doc.drafterId)}
                        {doc.drafterDept && <span className="text-[10px] text-ink3 ml-1">({doc.drafterDept})</span>}
                      </td>
                      <td className="px-3 py-2.5 text-center text-ink3">{formatDate(doc.completedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* 푸터 버튼 */}
        <div className="flex items-center justify-between border-t border-border bg-panel-alt/30 px-5 py-3.5 shrink-0">
          <span className="text-[11px] text-ink3">
            목록에서 클릭하여 연동할 문서를 선택하세요. (첨부파일도 함께 기안문에 연동 복사됩니다.)
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-border bg-panel px-4 py-1.5 text-[12px] font-bold text-ink hover:bg-panel-alt transition-colors"
            >
              취소
            </button>
            <button
              type="button"
              onClick={handleApply}
              disabled={tempSelected.length === 0}
              className="rounded-xl bg-[#4ea8de] hover:bg-[#358ab8] active:scale-95 px-4 py-1.5 text-[12px] font-bold text-white shadow-md shadow-[#4ea8de]/20 disabled:opacity-40 disabled:scale-100 disabled:shadow-none transition-all"
            >
              선택 완료 ({tempSelected.length})
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
