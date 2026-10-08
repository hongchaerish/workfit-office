import { useState, useMemo, useEffect, useRef } from 'react';
import { useActiveApprovalForms, useApprovalFolders } from '@/features/gw/useApprovalForms';
import type { ApprovalForm } from '@/domain/approvalForm/schema';
import { useAuth } from '@/app/auth/AuthProvider';
import { useOrgTree } from '@/features/gw/useOrgTree';
import { Search, Folder, FileText, Star, Clock, X, ChevronRight, Check } from 'lucide-react';

interface DraftFormSelectModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (form: ApprovalForm) => void;
  currentCode?: string;
}

/** 사용자별 로컬스토리지 키 분리 */
const getFavoriteStorageKey = (userId?: string) => `workfit:favorite_forms:${userId || 'guest'}`;
const getRecentStorageKey = (userId?: string) => `workfit:recent_forms:${userId || 'guest'}`;

/** 서식별 직관적인 한 줄 안내 문구 딕셔너리 */
const FORM_DESCRIPTIONS: Record<string, string> = {
  기안: '일반 업무 품의 및 결재 보고',
  휴가: '연차·반차·경조 휴가 신청서',
  지출결의: '법인 경비 청구 및 영수증 지출 결의',
  연장근로: '연장·야간·휴일 근무 신청',
  외근: '외근 및 현장 방문 업무 신청',
  국내출장: '국내 출장 신청 및 여비 정산',
  해외출장: '해외 출장 품의 및 일정 보고',
  보험: '사내 차량 및 시설 보험 관련 신청',
  채용: '신규 인력 충원 및 채용 요청',
  인사: '인사 발령 및 부서 이동 신청',
  구매: '비품·소모품 및 자재 구매 요청',
  계약: '대외 계약 체결 및 검토 품의',
  회의록: '사내외 주요 회의 결과 보고',
  경조사: '경조 휴가 및 경조금 신청',
  시말서: '업무상 과실 소명 및 보고',
  사직서: '퇴직 및 사직원 제출',
};

export function DraftFormSelectModal({
  open,
  onClose,
  onSelect,
  currentCode,
}: DraftFormSelectModalProps) {
  const { user } = useAuth();
  const org = useOrgTree();
  const { data: forms = [] } = useActiveApprovalForms();
  const { data: folders = [] } = useApprovalFolders();

  const [search, setSearch] = useState('');
  const [selectedFolderId, setSelectedFolderId] = useState<string>('all');
  const [favorites, setFavorites] = useState<string[]>([]);
  const [recents, setRecents] = useState<string[]>([]);

  // 사용자 계정별 즐겨찾기 및 최근 사용 서식 완전 격리 로드
  useEffect(() => {
    if (!user?.id) return;
    try {
      const favSaved = localStorage.getItem(getFavoriteStorageKey(user.id));
      setFavorites(favSaved ? JSON.parse(favSaved) : []);
      const recSaved = localStorage.getItem(getRecentStorageKey(user.id));
      setRecents(recSaved ? JSON.parse(recSaved) : []);
    } catch {
      setFavorites([]);
      setRecents([]);
    }
  }, [user?.id, open]);

  // 사용자 직급 서열 계산 (기안 권한 체크용)
  const myRank = useMemo(() => {
    if (!user?.position) return 999;
    const pos = org.positions.find((p) => p.name === user.position);
    return pos ? pos.rank : 999;
  }, [user?.position, org.positions]);

  // 서식별 기안 가능 여부 판별
  const isFormAllowed = (form: ApprovalForm) => {
    if (form.allowedPositionFromRank == null) return true;
    return myRank <= form.allowedPositionFromRank;
  };

  const toggleFavorite = (e: React.MouseEvent, code: string) => {
    e.stopPropagation();
    setFavorites((prev) => {
      const next = prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code];
      try {
        if (user?.id) {
          localStorage.setItem(getFavoriteStorageKey(user.id), JSON.stringify(next));
        }
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const handleSelectForm = (form: ApprovalForm) => {
    if (!isFormAllowed(form)) {
      alert('해당 서식은 기안 권한이 제한되어 있습니다.');
      return;
    }

    // 사용자별 최근 사용 서식 저장 (최대 8개)
    try {
      const nextRecents = [form.code, ...recents.filter((c) => c !== form.code)].slice(0, 8);
      setRecents(nextRecents);
      if (user?.id) {
        localStorage.setItem(getRecentStorageKey(user.id), JSON.stringify(nextRecents));
      }
    } catch {
      /* ignore */
    }

    onSelect(form);
    onClose();
  };

  // 모달 열릴 때 검색어 초기화
  useEffect(() => {
    if (open) {
      setSearch('');
    }
  }, [open]);

  // 폴더별 필터링 및 검색
  const filteredForms = useMemo(() => {
    let list = forms;

    // 검색어 필터
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      return list.filter(
        (f) =>
          f.name.toLowerCase().includes(q) ||
          f.code.toLowerCase().includes(q) ||
          (f.docTitle && f.docTitle.toLowerCase().includes(q))
      );
    }

    // 카테고리 탭 필터
    if (selectedFolderId === 'favorites') {
      return list.filter((f) => favorites.includes(f.code));
    }
    if (selectedFolderId === 'recents') {
      return list.filter((f) => recents.includes(f.code));
    }
    if (selectedFolderId === 'all') {
      return list;
    }
    if (selectedFolderId === 'root') {
      return list.filter((f) => !f.folderId);
    }
    return list.filter((f) => f.folderId === selectedFolderId);
  }, [forms, search, selectedFolderId, favorites, recents]);

  // 상단 1행 최근 사용 서식 목록 (최대 4개)
  const recentFormsList = useMemo(() => {
    if (selectedFolderId !== 'all' || search.trim()) return [];
    return recents
      .map((code) => forms.find((f) => f.code === code))
      .filter((f): f is ApprovalForm => !!f)
      .slice(0, 4);
  }, [recents, forms, selectedFolderId, search]);

  const currentFolderTitle = useMemo(() => {
    if (search.trim()) return `"${search}" 검색 결과`;
    if (selectedFolderId === 'all') return '전체 서식';
    if (selectedFolderId === 'favorites') return '즐겨찾는 서식';
    if (selectedFolderId === 'recents') return '최근 사용 서식';
    if (selectedFolderId === 'root') return '기본 / 공통 서식';
    const f = folders.find((fol) => fol.id === selectedFolderId);
    return f ? `${f.name} 서식` : '서식 목록';
  }, [selectedFolderId, search, folders]);

  const pressedOnBackdropRef = useRef(false);

  if (!open) return null;

  return (
    // 바깥(어두운 배경)을 누르면 닫는다. 모달 안에서 드래그하다 바깥에서 놓은 경우는 닫지 않도록
    // 누르기 시작한 곳도 바깥이었는지 함께 확인한다.
    <div
      className="@container fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs animate-in fade-in duration-150"
      onMouseDown={(e) => { pressedOnBackdropRef.current = e.target === e.currentTarget; }}
      onClick={(e) => {
        if (pressedOnBackdropRef.current && e.target === e.currentTarget) onClose();
        pressedOnBackdropRef.current = false;
      }}
    >
      {/* 높이는 vh가 아니라 오버레이 기준(h-full)으로 잡는다 — body zoom(화면 배율)이 vh 값에 한 번 더 곱해져
          모달이 화면보다 커지고 위쪽 닫기 버튼이 잘리던 문제를 막는다.
          너비는 카드(210px)가 몇 장 들어가는지에 맞춰 2·3·4장 폭 중 하나로 정해 빈 공간이 남지 않게 한다.
          (컨테이너 쿼리라 화면 배율이 반영된 실제 폭 기준) 폭 = 분류함 210 + 경계 1 + 좌우 여백 40 + 스크롤바 여유 12
          + 카드 n×210 + 간격 (n-1)×12 → 2장 695 / 3장 917 / 4장 1139 */}
      <div
        className="flex h-full max-h-[600px] w-[695px] max-w-full @min-[917px]:w-[917px] @min-[1139px]:w-[1139px] flex-col overflow-hidden rounded-2xl border border-border bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 모달 상단 헤더 */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4 shrink-0">
          <div>
            <h2 className="text-base font-extrabold text-ink flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-teal-soft text-teal font-bold text-sm">
                📄
              </span>
              <span>결재 서식 선택</span>
            </h2>
            <p className="mt-0.5 text-xs text-ink3">
              작성할 전자결재 문서의 양식을 선택하세요.
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* 검색창 */}
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink3" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="서식명 검색..."
                className="w-full rounded-lg border border-border bg-panel-alt/50 pl-8 pr-3 py-1.5 text-xs text-ink placeholder:text-ink3 outline-none focus:border-teal focus:bg-panel transition-all"
                autoFocus
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink3 hover:text-ink cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-ink3 hover:bg-panel-alt hover:text-ink transition-colors cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* 모달 2단 본문: 좌측 카테고리 트리 + 우측 서식 카드 그리드 */}
        <div className="grid grid-cols-[210px_1fr] flex-1 min-h-0 overflow-hidden">
          {/* 좌측: 폴더 및 스마트 필터 네비게이션 */}
          <div className="border-r border-border bg-panel-alt/30 p-3 overflow-y-auto space-y-1 select-none shrink-0">
            <div className="text-[11px] font-bold text-ink3 px-2 py-1 uppercase tracking-wider">
              스마트 보기
            </div>
            <button
              type="button"
              onClick={() => { setSelectedFolderId('all'); setSearch(''); }}
              className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-xs font-semibold transition-colors cursor-pointer ${
                selectedFolderId === 'all' && !search
                  ? 'bg-teal text-white font-bold shadow-xs'
                  : 'text-ink2 hover:bg-panel-alt'
              }`}
            >
              <span className="flex items-center gap-2">
                <FileText className="h-4 w-4" />
                <span>전체 서식</span>
              </span>
              <span className="text-[11px] opacity-70">{forms.length}</span>
            </button>

            <button
              type="button"
              onClick={() => { setSelectedFolderId('favorites'); setSearch(''); }}
              className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-xs font-semibold transition-colors cursor-pointer ${
                selectedFolderId === 'favorites' && !search
                  ? 'bg-amber-500 text-white font-bold shadow-xs'
                  : 'text-ink2 hover:bg-panel-alt'
              }`}
            >
              <span className="flex items-center gap-2">
                <Star className={`h-4 w-4 ${selectedFolderId === 'favorites' ? 'fill-white' : 'text-amber-500 fill-amber-500/20'}`} />
                <span>즐겨찾는 서식</span>
              </span>
              <span className="text-[11px] opacity-70">
                {forms.filter((f) => favorites.includes(f.code)).length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => { setSelectedFolderId('recents'); setSearch(''); }}
              className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-xs font-semibold transition-colors cursor-pointer ${
                selectedFolderId === 'recents' && !search
                  ? 'bg-teal text-white font-bold shadow-xs'
                  : 'text-ink2 hover:bg-panel-alt'
              }`}
            >
              <span className="flex items-center gap-2">
                <Clock className="h-4 w-4" />
                <span>최근 사용 서식</span>
              </span>
              <span className="text-[11px] opacity-70">
                {forms.filter((f) => recents.includes(f.code)).length}
              </span>
            </button>

            <div className="pt-3 pb-1">
              <div className="border-t border-border/80 my-1" />
              <div className="text-[11px] font-bold text-ink3 px-2 py-1 uppercase tracking-wider">
                서식 분류함
              </div>
            </div>

            {/* 일반 루트 폴더 */}
            <button
              type="button"
              onClick={() => { setSelectedFolderId('root'); setSearch(''); }}
              className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-xs font-semibold transition-colors cursor-pointer ${
                selectedFolderId === 'root' && !search
                  ? 'bg-teal text-white font-bold shadow-xs'
                  : 'text-ink2 hover:bg-panel-alt'
              }`}
            >
              <span className="flex items-center gap-2 truncate">
                <Folder className="h-4 w-4 shrink-0" />
                <span className="truncate">기본 / 공통</span>
              </span>
              <span className="text-[11px] opacity-70">
                {forms.filter((f) => !f.folderId).length}
              </span>
            </button>

            {/* 개별 생성된 폴더들 */}
            {folders.map((f) => {
              const count = forms.filter((form) => form.folderId === f.id).length;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => { setSelectedFolderId(f.id); setSearch(''); }}
                  className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-xs font-semibold transition-colors cursor-pointer ${
                    selectedFolderId === f.id && !search
                      ? 'bg-teal text-white font-bold shadow-xs'
                      : 'text-ink2 hover:bg-panel-alt'
                  }`}
                >
                  <span className="flex items-center gap-2 truncate">
                    <Folder className="h-4 w-4 shrink-0" />
                    <span className="truncate">{f.name}</span>
                  </span>
                  <span className="text-[11px] opacity-70">{count}</span>
                </button>
              );
            })}
          </div>

          {/* 우측: 서식 카드 그리드 — 카드 폭 210px 고정, 열 수는 모달 폭(위 컨테이너 쿼리)에 따라 2~4열 */}
          <div className="p-5 overflow-y-auto bg-panel">
            {/* 1. 상단 1행: 최근 사용 서식 섹션 (동일한 정규 서식 카드 1행 최대 4개 노출 + 가로 구분선) */}
            {recentFormsList.length > 0 && (
              <div className="mb-5">
                <div className="flex items-center justify-between mb-2.5">
                  <div className="flex items-center gap-1.5 text-xs font-extrabold text-ink">
                    <Clock className="h-3.5 w-3.5 text-teal" />
                    <span>최근 사용 서식</span>
                    <span className="text-[10.5px] font-normal text-ink3">
                      (최근에 작성한 서식입니다)
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-[repeat(auto-fill,210px)] gap-3">
                  {recentFormsList.map((form) => (
                    <FormCard
                      key={`recent-${form.id}`}
                      form={form}
                      isAllowed={isFormAllowed(form)}
                      isCurrent={currentCode === form.code}
                      isFav={favorites.includes(form.code)}
                      onSelect={() => handleSelectForm(form)}
                      onToggleFav={(e) => toggleFavorite(e, form.code)}
                    />
                  ))}
                </div>

                {/* 최근 사용 서식과 전체 서식 사이의 명확한 가로 구분선 */}
                <div className="border-b border-border/80 my-5" />
              </div>
            )}

            {/* 2. 하단 본문: 전체 / 카테고리별 서식 목록 헤더 */}
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-extrabold text-ink flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5 text-teal" />
                <span>{currentFolderTitle}</span>
              </span>
              <span className="text-[11px] text-ink3 font-semibold">
                총 {filteredForms.length}개 서식
              </span>
            </div>

            {filteredForms.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-ink3">
                <FileText className="h-10 w-10 stroke-1 opacity-40 mb-2" />
                <p className="text-sm font-semibold">해당하는 서식이 없습니다.</p>
                {search && <p className="text-xs mt-1">검색어를 다시 확인해주세요.</p>}
              </div>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,210px)] gap-3">
                {filteredForms.map((form) => (
                  <FormCard
                    key={form.id}
                    form={form}
                    isAllowed={isFormAllowed(form)}
                    isCurrent={currentCode === form.code}
                    isFav={favorites.includes(form.code)}
                    onSelect={() => handleSelectForm(form)}
                    onToggleFav={(e) => toggleFavorite(e, form.code)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 모달 하단 닫기 */}
        <div className="flex items-center justify-end border-t border-border px-6 py-3 bg-panel-alt/20 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-1.5 text-xs font-bold text-ink2 hover:bg-panel-alt transition-colors cursor-pointer"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}

/** 단순화된 사용자 중심 서식 카드 컴포넌트 */
interface FormCardProps {
  form: ApprovalForm;
  isAllowed: boolean;
  isCurrent: boolean;
  isFav: boolean;
  onSelect: () => void;
  onToggleFav: (e: React.MouseEvent) => void;
}

function FormCard({
  form,
  isAllowed,
  isCurrent,
  isFav,
  onSelect,
  onToggleFav,
}: FormCardProps) {
  const desc = FORM_DESCRIPTIONS[form.code] || (form.docTitle && form.docTitle !== form.name ? form.docTitle : '전자결재 문서 작성');

  return (
    <div
      onClick={() => isAllowed && onSelect()}
      className={`group relative flex flex-col justify-between rounded-xl border p-3.5 transition-all text-left select-none ${
        !isAllowed
          ? 'opacity-40 border-border bg-panel-alt/20 cursor-not-allowed'
          : isCurrent
          ? 'border-teal bg-teal-soft/20 shadow-xs cursor-pointer'
          : 'border-border bg-panel hover:border-teal/60 hover:shadow-md hover:-translate-y-0.5 cursor-pointer'
      }`}
    >
      <div>
        {/* 상단: 아이콘 + 서식명 + 즐겨찾기 별표 버튼 */}
        <div className="flex items-start justify-between gap-1.5">
          <div className="flex items-center gap-2 min-w-0">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-panel-alt text-base shadow-2xs group-hover:scale-105 transition-transform">
              {form.icon || '📄'}
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-1">
                <h3 className="font-extrabold text-[13px] leading-snug text-ink line-clamp-2 break-keep group-hover:text-teal transition-colors" title={form.name}>
                  {form.name}
                </h3>
                {form.system && (
                  <span className="rounded bg-ink3/10 px-1 py-0.2 text-[8.5px] font-bold text-ink3 shrink-0">
                    기본
                  </span>
                )}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onToggleFav}
            className="p-1 text-ink3 hover:text-amber-500 transition-colors cursor-pointer shrink-0"
            title={isFav ? '즐겨찾기 해제' : '즐겨찾기 추가'}
          >
            <Star
              className={`h-4 w-4 ${
                isFav ? 'fill-amber-400 text-amber-500' : 'opacity-30 group-hover:opacity-100'
              }`}
            />
          </button>
        </div>

        {/* 한 줄 직관 설명 (관리자용 코드 및 공식양식명 제거) */}
        <p className="mt-2 text-[11.5px] text-ink3 line-clamp-2 leading-relaxed h-[34px]">
          {desc}
        </p>
      </div>

      {/* 카드 하단: 현재 작성 중 상태 또는 [작성하기 →] 버튼 CTA */}
      <div className="mt-3 pt-2.5 border-t border-border/60 flex items-center justify-between text-[11px]">
        <div>
          {isCurrent && (
            <span className="flex items-center gap-1 text-teal font-extrabold text-[10.5px]">
              <Check className="h-3 w-3" />
              <span>작성 중</span>
            </span>
          )}
        </div>

        {isAllowed ? (
          <span className="inline-flex items-center gap-1 rounded-lg bg-teal-soft/70 px-2.5 py-1 text-[11px] font-bold text-teal group-hover:bg-teal group-hover:text-white transition-all shadow-2xs">
            <span>작성하기</span>
            <ChevronRight className="h-3 w-3 group-hover:translate-x-0.5 transition-transform" />
          </span>
        ) : (
          <span className="rounded bg-rose-500/10 px-2 py-0.5 text-[10px] font-bold text-rose-500">
            권한 제한
          </span>
        )}
      </div>
    </div>
  );
}
