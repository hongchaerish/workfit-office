import { useState, useMemo } from 'react';
import {
  Search,
  X,
  Pin,
  AlertTriangle,
  FolderGit2,
  Globe,
  ScrollText,
  BookOpen,
  FileText,
  Building2,
  Folder,
  User,
  FileEdit,
  Star,
  FolderOpen,
  History,
  Download,
  FolderPlus,
  FilePlus,
  TrendingUp,
} from 'lucide-react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { useApplyDeepLinkOnce } from '@/shared/lib/deepLink';
import { useAuth } from '@/app/auth/AuthProvider';
import { usePermission } from '@/features/auth/usePermission';
import { useDocument } from '@/features/document/useDocument';

export default function DocumentScreen() {
  const { user } = useAuth();
  const { isAdmin, canAction } = usePermission();
  const {
    boxes,
    documents,
    createBox,
    updateBox,
    createDocument,
    createRuleVersion,
    deleteDocument
  } = useDocument();

  const [searchParams] = useSearchParams();

  // 로그인 세션 가공 및 권한 식별
  const CURRENT_USER = useMemo(() => {
    return {
      id: user?.id || 'guest',
      name: user?.name ? `${user.name}`.trim() : '게스트',
      dept: user?.dept || '-',
      position: user?.position || '',
    };
  }, [user]);

  // 권한 요약 (기준정보 > 권한그룹관리 연동)
  const hasWriteAccess = isAdmin || canAction('S_GW_DOCUMENT', 'create') || canAction('S_GW_DOCUMENT', 'update');

  // 사이드바 카테고리 필터
  const [activeCategory, setActiveCategory] = useState<'public' | 'dept' | 'personal' | 'all'>('all');
  const [isNoticeOpen, setIsNoticeOpen] = useState(true);
  const [activeSubCategory, setActiveSubCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // 3대 대분류 전용 가상 목업 문서 데이터
  const mockDocuments = useMemo(() => {
    return [
      // 1) 전사 공용 문서 (사내규정, 매뉴얼, 서양양식)
      { id: 101, name: '사내 취업규칙 및 노사협약서', boxId: 'rule', category: 'public', subCategory: 'rule', dept: '경영지원팀', date: '2026-01-10', version: 'v3.2', isRule: true, author: '임진서 대리', desc: 'WorkFit 주식회사 사내 취업규칙 개정본입니다.', attachments: ['취업규칙_v3.2_시행본.pdf'], versions: [{ version: 'v3.2', effectiveDate: '2026-01-10', revisedDate: '2026-01-10', reason: '근로기준법 개정에 따른 유연근무 규정 보완', attachments: ['취업규칙_v3.2_시행본.pdf'] }] },
      { id: 102, name: '정보보안 가이드라인 및 서약서', boxId: 'rule', category: 'public', subCategory: 'rule', dept: '보안관리팀', date: '2026-03-15', version: 'v2.0', isRule: true, author: '김민수 과장', desc: '보안 강화를 위한 사내 가이드라인입니다.', attachments: ['정보보안_가이드라인.pdf'], versions: [] },
      { id: 103, name: 'Vite 개발 표준 매뉴얼', boxId: 'manual', category: 'public', subCategory: 'manual', dept: '데이터플랫폼 개발팀', date: '2026-02-20', version: 'v1.0', isRule: false, author: '홍채원 주임', desc: '프론트엔드 Vite 개발 표준 스펙 가이드입니다.', attachments: ['Vite_개발_가이드.pdf'] },
      { id: 104, name: '지출결의서 양식 (Hwp)', boxId: 'form', category: 'public', subCategory: 'form', dept: '재무관리팀', date: '2025-12-01', version: 'v1.0', isRule: false, author: '박찬우 차장', desc: '지출결의 품의를 위한 기본 양식 문서입니다.', attachments: ['지출결의서_표준양식.hwp'] },

      // 2) 부서별 문서 (품질심사팀, 경영기획팀, AX PMO팀, 데이터플랫폼 개발팀 등)
      { id: 201, name: '[품질] 2분기 사내 안전점검 결과보고서', boxId: 'etc', category: 'dept', subCategory: '품질심사팀', dept: '품질심사팀', date: '2026-06-18', version: 'v1.0', isRule: false, author: '강윤석 이사', desc: '품질심사팀 2분기 공장 안전점검 종합결과입니다.', attachments: ['2분기_안전점검_결과보고.pdf'] },
      { id: 202, name: '[기획] 2026 하반기 사업계획 보고서', boxId: 'etc', category: 'dept', subCategory: '경영기획팀', dept: '경영기획팀', date: '2026-07-02', version: 'v2.1', isRule: false, author: '최지혜 주임', desc: '경영기획팀 2026년 하반기 전사 사업 계획 초안입니다.', attachments: ['2026_하반기_사업계획.pdf'] },
      { id: 203, name: '[PMO] AX 지능화 신규 프로젝트 관리대장', boxId: 'etc', category: 'dept', subCategory: 'AX PMO팀', dept: 'AX PMO팀', date: '2026-05-14', version: 'v1.0', isRule: false, author: '박명규 부장', desc: '신규 프로젝트 진척 관리 대장입니다.', attachments: ['AX_프로젝트_관리대장.xlsx'] },
      { id: 204, name: '[개발] 데이터 플랫폼 백엔드 아키텍처 설계도', boxId: 'etc', category: 'dept', subCategory: '데이터플랫폼 개발팀', dept: '데이터플랫폼 개발팀', date: '2026-06-30', version: 'v1.5', isRule: false, author: '김승기 부장', desc: '데이터 플랫폼 실시간 수집 파이프라인 설계 명세입니다.', attachments: ['데이터플랫폼_설계도_v1.5.pdf'] },

      // 3) 개인 문서함 (내 기안 초안, 보관문서)
      { id: 301, name: '[내초안] 경비 지출 증빙 모음집', boxId: 'etc', category: 'personal', subCategory: 'draft', dept: CURRENT_USER.dept, date: '2026-08-20', version: 'v1.0', isRule: false, author: CURRENT_USER.name, desc: '8월 소모품비 지출결의용 영수증 증빙 초안입니다.', attachments: ['8월_경비증빙_모음.pdf'] },
      { id: 302, name: '[즐겨찾기] 사내 복리후생 규정집', boxId: 'rule', category: 'personal', subCategory: 'fav', dept: '인사지원팀', date: '2026-04-01', version: 'v2.0', isRule: true, author: '조민아 부장', desc: '사내 동호회 지원 및 건강검진 복리후생 개정 규정입니다.', attachments: ['복리후생_규정집_2026.pdf'], versions: [] }
    ];
  }, [CURRENT_USER]);

  // 선택된 문서 상세
  const [selectedDocId, setSelectedDocId] = useState<number | null>(null);
  
  // 규정 문서 과거 버전 조회 상태 (null이면 현재 최신 시행 버전)
  const [activeVersionName, setActiveVersionName] = useState<string | null>(null);

  // 모달 상태
  const [isBoxModalOpen, setIsBoxModalOpen] = useState(false);
  const [isDocModalOpen, setIsDocModalOpen] = useState(false);
  const [isReviseModalOpen, setIsReviseModalOpen] = useState(false); // 규정 개정 등록용

  // 문서함 폼 상태
  const [editingBoxId, setEditingBoxId] = useState<string | null>(null);
  const [boxNameInput, setBoxNameInput] = useState('');
  const [boxDescInput, setBoxDescInput] = useState('');

  // 문서 등록 폼 상태
  const [docNameInput, setDocNameInput] = useState('');
  const [docBoxInput, setDocBoxInput] = useState('rule');
  const [docDescInput, setDocDescInput] = useState('');
  const [docDeptInput, setDocDeptInput] = useState(CURRENT_USER.dept);
  const [docFileInput, setDocFileInput] = useState('');
  const [docIsRule, setDocIsRule] = useState(true);
  const [docVersionInput, setDocVersionInput] = useState('v1.0');

  // 규정 개정 등록 폼 상태
  const [revVersionInput, setRevVersionInput] = useState('');
  const [revEffectiveDate, setRevEffectiveDate] = useState('');
  const [revReasonInput, setRevReasonInput] = useState('');
  const [revFileInput, setRevFileInput] = useState('');

  // 1. 게시판 바로가기 딥링크 대응 (`docId` 쿼리 파라미터 감지).
  // 주소가 바뀔 때 한 번만 적용한다 — 문서 목록이 갱신될 때마다 다시 적용하면 사용자가 옮겨 간 선택이 되돌아간다.
  const location = useLocation();
  const docIdParam = searchParams.get('docId');
  const deepLinkDoc = useMemo(() => {
    const idNum = docIdParam ? parseInt(docIdParam, 10) : NaN;
    return Number.isNaN(idNum) ? null : mockDocuments.find((d) => d.id === idNum) ?? null;
  }, [docIdParam, mockDocuments]);
  useApplyDeepLinkOnce(docIdParam ? `${location.key}|${docIdParam}` : null, deepLinkDoc !== null, () => {
    if (!deepLinkDoc) return;
    setSelectedDocId(deepLinkDoc.id);
    setActiveCategory(deepLinkDoc.category as any);
    setActiveSubCategory(deepLinkDoc.subCategory);
    setActiveVersionName(null); // 최신 버전
  });

  // 선택된 문서 데이터
  const selectedDoc = useMemo(() => {
    return mockDocuments.find((d) => d.id === selectedDocId) || null;
  }, [documents, selectedDocId]);

  // 과거 버전이나 최신 버전 기준으로 화면 표시용 데이터 매핑
  const activeDocDisplay = useMemo((): {
    name: string;
    version: string;
    date: string;
    reason?: string;
    attachments: string[];
    desc?: string;
  } | null => {
    if (!selectedDoc) return null;

    // 일반 문서거나 최신 시행 버전 선택인 경우
    if (!selectedDoc.isRule || !activeVersionName) {
      return {
        name: selectedDoc.name,
        version: selectedDoc.version || 'v1.0',
        date: selectedDoc.date,
        reason: selectedDoc.isRule ? selectedDoc.versions?.[0]?.reason : undefined,
        attachments: selectedDoc.attachments,
        desc: selectedDoc.desc
      };
    }

    // 규정 과거 버전 선택 시
    const ver = selectedDoc.versions?.find((v) => v.version === activeVersionName);
    if (ver) {
      return {
        name: `${selectedDoc.name} (${ver.version} 개정이력)`,
        version: ver.version,
        date: ver.effectiveDate,
        reason: ver.reason,
        attachments: ver.attachments,
        desc: `${selectedDoc.desc || ''}\n[개정일: ${ver.revisedDate}]`
      };
    }

    return null;
  }, [selectedDoc, activeVersionName]);

  // 필터링된 문서 리스트
  const filteredDocs = useMemo(() => {
    return mockDocuments.filter((d) => {
      // 1. 대분류 필터
      if (activeCategory !== 'all' && d.category !== activeCategory) return false;
      // 2. 소분류 필터
      if (activeSubCategory !== 'all' && d.subCategory !== activeSubCategory) return false;
      // 3. 검색어 필터
      const matchQuery = !searchQuery.trim() || d.name.toLowerCase().includes(searchQuery.toLowerCase()) || (d.desc && d.desc.toLowerCase().includes(searchQuery.toLowerCase()));
      return matchQuery;
    });
  }, [mockDocuments, activeCategory, activeSubCategory, searchQuery]);

  // 1. 문서함 추가 / 편집 저장
  const handleSaveBox = (e: React.FormEvent) => {
    e.preventDefault();
    if (!boxNameInput.trim()) return;

    if (editingBoxId) {
      updateBox(editingBoxId, boxNameInput.trim(), boxDescInput.trim());
    } else {
      createBox(boxNameInput.trim(), boxDescInput.trim());
    }

    setBoxNameInput('');
    setBoxDescInput('');
    setEditingBoxId(null);
    setIsBoxModalOpen(false);
  };

  // 2. 문서 신규 등록
  const handleCreateDoc = (e: React.FormEvent) => {
    e.preventDefault();
    if (!docNameInput.trim()) return;

    const fileList = docFileInput.trim() ? [docFileInput.trim()] : ['첨부문서_가상본문.pdf'];
    createDocument({
      boxId: docBoxInput,
      name: docNameInput.trim(),
      desc: docDescInput.trim(),
      attachments: fileList,
      dept: docDeptInput.trim(),
      author: `${CURRENT_USER.name} ${CURRENT_USER.position}`.trim(),
      version: docIsRule ? docVersionInput.trim() : undefined,
      isRule: docIsRule
    });

    // 폼 초기화
    setDocNameInput('');
    setDocDescInput('');
    setDocFileInput('');
    setDocVersionInput('v1.0');
    setIsDocModalOpen(false);
  };

  // 3. 규정 개정 버전 등록
  const handleCreateRevise = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDoc || !revVersionInput.trim() || !revEffectiveDate) return;

    const fileList = revFileInput.trim() ? [revFileInput.trim()] : [`${selectedDoc.name}_${revVersionInput.trim()}.pdf`];
    createRuleVersion(selectedDoc.id, {
      version: revVersionInput.trim(),
      effectiveDate: revEffectiveDate,
      revisedDate: new Date().toISOString().split('T')[0],
      reason: revReasonInput.trim(),
      attachments: fileList,
      author: `${CURRENT_USER.name} ${CURRENT_USER.position}`.trim()
    });

    setRevVersionInput('');
    setRevEffectiveDate('');
    setRevReasonInput('');
    setRevFileInput('');
    setIsReviseModalOpen(false);
    setActiveVersionName(null); // 신규 등록된 최신 버전으로 뷰 포커싱 리셋
  };

  // 4. 문서 삭제
  const handleDeleteDoc = (id: number) => {
    if (confirm('이 문서를 영구히 삭제하시겠습니까? (규정의 이력은 보존 권고안에 따라 주의해 주십시오)')) {
      deleteDocument(id);
      setSelectedDocId(null);
    }
  };

  // 5. 가상 파일 다운로드 로직 (임직원 사용 편의)
  const downloadVirtualFile = (filename: string) => {
    const content = `[WorkFit 공식 문서 저장소]\n\n파일명: ${filename}\n본 문서는 ${CURRENT_USER.dept} ${CURRENT_USER.name} 님이 공식 다운로드 하였습니다.\n보안 지침에 따라 유출에 주의하시기 바랍니다.\n다운로드 일시: ${new Date().toLocaleString()}`;
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename.endsWith('.pdf') ? filename.replace('.pdf', '.txt') : filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex h-full w-full gap-5 bg-panel p-6 text-[12.5px] text-ink relative overflow-hidden">
      
      {/* ── 좌측 문서함 관리 사이드바 ── */}
      <aside className="w-[240px] shrink-0 flex flex-col gap-4 rounded-xl border border-border bg-panel p-4 shadow-sm select-none overflow-y-auto max-h-[calc(100vh/var(--font-scale,1)-140px)]">
        <div className="flex items-center justify-between border-b border-border pb-2 shrink-0">
          <h2 className="text-sm font-extrabold text-navy flex items-center gap-2">
            <FolderGit2 size={16} className="text-teal" />
            <span>문서관리</span>
          </h2>
        </div>

        {/* 1) 전사 공용 문서함 */}
        <div className="space-y-1">
          <button
            onClick={() => {
              setActiveCategory('public');
              setActiveSubCategory('all');
              setSelectedDocId(null);
            }}
            className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left font-bold text-[12px] transition-all ${
              activeCategory === 'public' && activeSubCategory === 'all'
                ? 'bg-teal/10 text-teal'
                : 'text-ink hover:bg-panel-alt'
            }`}
          >
            <span className="flex items-center gap-2">
              <Globe size={14} className="text-teal" />
              <span>전사 공용 문서함</span>
            </span>
          </button>
          <div className="pl-4.5 flex flex-col gap-0.5 border-l border-border/50 ml-2.5">
            {[
              { id: 'rule', label: '사내 규정', icon: <ScrollText size={13} /> },
              { id: 'manual', label: '업무 매뉴얼', icon: <BookOpen size={13} /> },
              { id: 'form', label: '공통 서식 양식', icon: <FileText size={13} /> }
            ].map((sub) => (
              <button
                key={sub.id}
                onClick={() => {
                  setActiveCategory('public');
                  setActiveSubCategory(sub.id);
                  setSelectedDocId(null);
                }}
                className={`flex w-full items-center gap-2 py-1 px-2 rounded text-left transition-colors text-[11px] font-semibold ${
                  activeCategory === 'public' && activeSubCategory === sub.id
                    ? 'text-teal font-extrabold bg-teal-soft/20'
                    : 'text-ink3 hover:text-ink hover:bg-panel-alt/50'
                }`}
              >
                <span className="shrink-0">{sub.icon}</span>
                <span>{sub.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 2) 부서별 문서함 */}
        <div className="space-y-1 pt-1">
          <button
            onClick={() => {
              setActiveCategory('dept');
              setActiveSubCategory('all');
              setSelectedDocId(null);
            }}
            className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left font-bold text-[12px] transition-all ${
              activeCategory === 'dept' && activeSubCategory === 'all'
                ? 'bg-teal/10 text-teal'
                : 'text-ink hover:bg-panel-alt'
            }`}
          >
            <span className="flex items-center gap-2">
              <Building2 size={14} className="text-teal" />
              <span>부서별 문서함</span>
            </span>
          </button>
          <div className="pl-4.5 flex flex-col gap-0.5 border-l border-border/50 ml-2.5">
            {[
              '경영기획팀',
              '품질심사팀',
              'AX PMO팀',
              '데이터플랫폼 개발팀'
            ].map((deptName) => (
              <button
                key={deptName}
                onClick={() => {
                  setActiveCategory('dept');
                  setActiveSubCategory(deptName);
                  setSelectedDocId(null);
                }}
                className={`flex w-full items-center gap-2 py-1 px-2 rounded text-left transition-colors text-[11px] font-semibold ${
                  activeCategory === 'dept' && activeSubCategory === deptName
                    ? 'text-teal font-extrabold bg-teal-soft/20'
                    : 'text-ink3 hover:text-ink hover:bg-panel-alt/50'
                }`}
              >
                <Folder size={13} className="shrink-0" />
                <span className="truncate">{deptName}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 3) 개인 문서함 */}
        <div className="space-y-1 pt-1">
          <button
            onClick={() => {
              setActiveCategory('personal');
              setActiveSubCategory('all');
              setSelectedDocId(null);
            }}
            className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left font-bold text-[12px] transition-all ${
              activeCategory === 'personal' && activeSubCategory === 'all'
                ? 'bg-teal/10 text-teal'
                : 'text-ink hover:bg-panel-alt'
            }`}
          >
            <span className="flex items-center gap-2">
              <User size={14} className="text-teal" />
              <span>개인 문서함</span>
            </span>
          </button>
          <div className="pl-4.5 flex flex-col gap-0.5 border-l border-border/50 ml-2.5">
            {[
              { id: 'draft', label: '내 기안 초안', icon: <FileEdit size={13} /> },
              { id: 'fav', label: '개인 보관 문서', icon: <Star size={13} /> }
            ].map((sub) => (
              <button
                key={sub.id}
                onClick={() => {
                  setActiveCategory('personal');
                  setActiveSubCategory(sub.id);
                  setSelectedDocId(null);
                }}
                className={`flex w-full items-center gap-2 py-1 px-2 rounded text-left transition-colors text-[11px] font-semibold ${
                  activeCategory === 'personal' && activeSubCategory === sub.id
                    ? 'text-teal font-extrabold bg-teal-soft/20'
                    : 'text-ink3 hover:text-ink hover:bg-panel-alt/50'
                }`}
              >
                <span className="shrink-0">{sub.icon}</span>
                <span>{sub.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 전체 보기 리셋 */}
        <button
          onClick={() => {
            setActiveCategory('all');
            setActiveSubCategory('all');
            setSelectedDocId(null);
          }}
          className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left font-bold text-[11px] transition-all mt-4 border border-dashed ${
            activeCategory === 'all'
              ? 'border-teal bg-teal-soft/20 text-teal'
              : 'border-border text-ink3 hover:border-ink hover:text-ink'
          }`}
        >
          <FolderOpen size={14} />
          <span>전체 보기</span>
        </button>
      </aside>

      {/* ── 중앙 문서 목록 영역 ── */}
      <main className="flex-1 flex flex-col gap-4 rounded-xl border border-border bg-panel p-5 shadow-sm overflow-hidden">
        {/* 상단 액션바 */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3 shrink-0">
          <div>
            <h1 className="text-base font-extrabold text-ink flex items-center gap-2">
              <span className="text-teal">
                {activeCategory === 'all' ? <FolderOpen size={18} /> : activeCategory === 'public' ? <Globe size={18} /> : activeCategory === 'dept' ? <Building2 size={18} /> : <User size={18} />}
              </span>
              <span>
                {activeCategory === 'all' 
                  ? '전체 문서함' 
                  : `${activeCategory === 'public' ? '전사 공용' : activeCategory === 'dept' ? '부서별' : '개인'} / ${
                      activeSubCategory === 'all' ? '전체' : activeSubCategory === 'rule' ? '사내 규정' : activeSubCategory === 'manual' ? '업무 매뉴얼' : activeSubCategory === 'form' ? '공통 서식' : activeSubCategory === 'draft' ? '내 기안 초안' : activeSubCategory === 'fav' ? '개인 보관 문서' : activeSubCategory
                    }`}
              </span>
            </h1>
            <p className="text-[11px] text-ink3 mt-0.5">회사의 공식 규정서, 부서 업무 파일 및 개인 문서의 체계적 보관소입니다.</p>
          </div>

          <div className="flex items-center gap-2">
            {/* 검색 인풋 */}
            <div className="relative w-56">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="문서명 검색"
                className="h-8 w-full rounded-lg border border-border-hi bg-panel px-3 pr-7 text-[11px] outline-none focus:border-teal"
              />
              <Search size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink3 pointer-events-none" />
            </div>

            {/* 등록 버튼 */}
            {hasWriteAccess && (
              <button
                onClick={() => setIsDocModalOpen(true)}
                className="rounded-lg bg-teal px-3.5 py-1.5 font-bold text-white shadow-xs hover:opacity-90 transition-opacity text-[11.5px]"
              >
                ＋ 문서 등록
              </button>
            )}
          </div>
        </div>

        {/* 문서 목록 테이블 */}
        <div className="flex-1 overflow-auto rounded-lg border border-border bg-panel">
          <table className="w-full border-collapse text-left text-[11.5px]">
            <thead>
              <tr className="border-b border-border bg-panel-alt/50 font-bold text-ink2">
                <th className="p-3">문서명</th>
                <th className="p-3 w-20">분류</th>
                <th className="p-3 w-28">담당부서</th>
                <th className="p-3 w-24">수정일(시행일)</th>
                <th className="p-3 w-20">버전</th>
                <th className="p-3 w-16 text-center">형식</th>
              </tr>
            </thead>
            <tbody>
              {filteredDocs.length > 0 ? (
                filteredDocs.map((d) => {
                  const ext = d.attachments[0]?.split('.').pop()?.toUpperCase() || 'PDF';
                  const isSelected = d.id === selectedDocId;
                  return (
                    <tr
                      key={d.id}
                      onClick={() => {
                        setSelectedDocId(d.id);
                        setActiveVersionName(null); // 최신화
                      }}
                      className={`border-b border-border hover:bg-panel-alt/30 cursor-pointer transition-colors ${
                        isSelected ? 'bg-teal-soft/10 font-semibold' : ''
                      }`}
                    >
                      <td className="p-3 text-ink font-semibold flex items-center gap-1.5 min-w-0">
                        {d.isRule && <span className="text-[10px] font-extrabold text-teal bg-teal-soft border border-teal/20 rounded px-1 shrink-0">규정</span>}
                        <span className="truncate hover:text-teal transition-colors">{d.name}</span>
                      </td>
                      <td className="p-3 text-ink2">{d.category === 'public' ? (d.subCategory === 'rule' ? '규정' : d.subCategory === 'manual' ? '매뉴얼' : '서식') : (d.category === 'dept' ? '부서' : '개인')}</td>
                      <td className="p-3 text-ink2 truncate">{d.dept}</td>
                      <td className="p-3 text-ink3 font-mono">{d.date}</td>
                      <td className="p-3 text-ink2 font-semibold">
                        {d.isRule ? d.version : <span className="text-ink3 font-normal">-</span>}
                      </td>
                      <td className="p-3 text-center">
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${
                          ext === 'PDF' ? 'bg-red-soft/20 border-red/20 text-red' : 'bg-blue-soft/20 border-blue/20 text-blue'
                        }`}>
                          {ext}
                        </span>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={6} className="p-12 text-center text-ink3">게시물이 존재하지 않습니다.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </main>

      {/* ── 우측 상세 슬라이딩 Drawer 패널 ── */}
      {selectedDocId && selectedDoc && activeDocDisplay && (
        <>
          {/* 어두운 백드롭 오버레이 */}
          <div
            onClick={() => setSelectedDocId(null)}
            className="fixed inset-0 bg-black/25 z-40"
          />

          <div className="fixed right-0 top-0 h-full w-[460px] shadow-2xl z-50 bg-panel border-l border-border flex flex-col justify-between transition-transform duration-300 transform translate-x-0">
            {/* Drawer 헤더 */}
            <div className="p-4 border-b border-border flex items-center justify-between shrink-0 bg-panel-alt/10">
              <div>
                <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded bg-teal-soft border border-teal/20 text-teal uppercase">
                  {selectedDoc.isRule ? '규정 문서' : '일반 문서'}
                </span>
                <h3 className="font-extrabold text-ink text-sm mt-1">{selectedDoc.name}</h3>
              </div>
              <button
                onClick={() => setSelectedDocId(null)}
                className="text-ink3 hover:text-ink p-1 rounded hover:bg-panel-alt"
              >
                <X size={16} />
              </button>
            </div>

            {/* Drawer 스크롤 본문 */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              
              {/* 규정 문서일 경우 상단에 시행일 및 개정사유 표시 */}
              {selectedDoc.isRule && (
                <div className="bg-teal-soft/10 border border-teal/20 rounded-xl p-3.5 space-y-2 text-[11.5px]">
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-teal flex items-center gap-1">
                      <Pin size={13} /> 시행 버전: {activeDocDisplay.version}
                    </span>
                    <span className="text-ink3">시행일: {activeDocDisplay.date}</span>
                  </div>
                  {activeDocDisplay.reason && (
                    <p className="text-ink2 leading-relaxed bg-panel p-2 rounded border border-border/30">
                      <strong>개정사유:</strong> {activeDocDisplay.reason}
                    </p>
                  )}
                </div>
              )}

              {/* 문서 정보 리스트 */}
              <div className="grid grid-cols-2 gap-3 text-[11.5px] border-b border-border/40 pb-4">
                <div>
                  <span className="text-ink3 block">관리부서</span>
                  <span className="font-semibold text-ink mt-0.5 block">{selectedDoc.dept}</span>
                </div>
                <div>
                  <span className="text-ink3 block">등록자</span>
                  <span className="font-semibold text-ink mt-0.5 block">{selectedDoc.author}</span>
                </div>
                <div>
                  <span className="text-ink3 block">최초 등록일</span>
                  <span className="font-semibold text-ink mt-0.5 block">{selectedDoc.date}</span>
                </div>
                <div>
                  <span className="text-ink3 block">문서 파일 형식</span>
                  <span className="font-semibold text-ink mt-0.5 block">
                    {activeDocDisplay.attachments[0]?.split('.').pop()?.toUpperCase() || 'PDF'}
                  </span>
                </div>
              </div>

              {/* 문서 설명 */}
              {activeDocDisplay.desc && (
                <div className="space-y-1">
                  <span className="text-ink3 text-[11px] block">문서 설명</span>
                  <p className="text-[12px] text-ink2 leading-relaxed whitespace-pre-wrap">{activeDocDisplay.desc}</p>
                </div>
              )}

              {/* PDF 미리보기 (MVP PDF 뷰어 연동) */}
              <div className="rounded-xl border border-border bg-panel-alt/30 overflow-hidden flex flex-col">
                <div className="bg-panel-alt border-b border-border p-2.5 flex items-center justify-between text-[11px]">
                  <span className="font-bold text-ink2 flex items-center gap-1.5">
                    <FileText size={13} className="text-teal" />
                    <span>브라우저 미리보기 (PDF v1.0)</span>
                  </span>
                  <span className="text-teal font-extrabold">조회 모드</span>
                </div>
                <div className="h-56 p-4 flex flex-col items-center justify-center text-center bg-panel space-y-2">
                  <Search size={32} className="text-ink3 opacity-30" />
                  <div className="space-y-1">
                    <p className="font-bold text-ink2 text-[12px]">{activeDocDisplay.attachments[0] || '가상문서_미리보기.pdf'}</p>
                    <p className="text-[10px] text-ink3">본문 내부 미리보기가 MVP로 호환 모드로 렌더링되었습니다.</p>
                  </div>
                  <button
                    onClick={() => downloadVirtualFile(activeDocDisplay.attachments[0])}
                    className="mt-2 text-[11px] font-bold text-teal bg-teal-soft/40 hover:bg-teal-soft/60 px-3 py-1 rounded-md transition-colors"
                  >
                    다운로드하여 전체 읽기
                  </button>
                </div>
              </div>

              {/* 규정 문서 개정 이력 리스트 (isRule) */}
              {selectedDoc.isRule && (
                <div className="space-y-2 pt-2 border-t border-border/40">
                  <div className="flex justify-between items-center">
                    <h4 className="font-extrabold text-ink text-xs flex items-center gap-1.5">
                      <History size={13} className="text-teal" />
                      <span>개정 이력</span>
                    </h4>
                    {hasWriteAccess && (
                      <button
                        onClick={() => {
                          setRevVersionInput('');
                          setRevEffectiveDate('');
                          setRevReasonInput('');
                          setRevFileInput('');
                          setIsReviseModalOpen(true);
                        }}
                        className="text-[10.5px] text-teal hover:underline font-bold"
                      >
                        ＋ 개정안 등록
                      </button>
                    )}
                  </div>
                  <div className="divide-y divide-border border rounded-xl overflow-hidden bg-panel">
                    {(selectedDoc.versions || []).map((v) => {
                      const isActive = activeVersionName === v.version || (!activeVersionName && v.version === selectedDoc.version);
                      return (
                        <div
                          key={v.version}
                          onClick={() => setActiveVersionName(v.version === selectedDoc.version ? null : v.version)}
                          className={`p-3 text-left cursor-pointer transition-colors ${
                            isActive ? 'bg-teal-soft/25 font-semibold' : 'hover:bg-panel-alt/30'
                          }`}
                        >
                          <div className="flex justify-between items-center text-[11px]">
                            <span className="font-bold text-ink">{v.version}</span>
                            <span className="text-ink3 font-mono">{v.effectiveDate} 시행</span>
                          </div>
                          <p className="text-[10.5px] text-ink2 mt-1 line-clamp-1">{v.reason}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

            </div>

            {/* Drawer 푸터 조작반 */}
            <div className="p-4 border-t border-border bg-panel-alt/20 shrink-0 flex gap-2">
              <button
                onClick={() => downloadVirtualFile(activeDocDisplay.attachments[0])}
                className="flex-1 rounded-lg bg-teal py-2.5 text-center font-bold text-white hover:opacity-90 transition-opacity flex items-center justify-center gap-1.5"
              >
                <Download size={14} />
                <span>원본 파일 다운로드</span>
              </button>
              {hasWriteAccess && (
                <button
                  onClick={() => handleDeleteDoc(selectedDoc.id)}
                  className="rounded-lg border border-red-200 text-red px-3.5 py-2.5 font-bold bg-red-soft/20 hover:bg-red-soft/40 transition-colors"
                >
                  삭제
                </button>
              )}
            </div>
          </div>
        </>
      )}

      {/* ==================== E. 문서함 편집/생성 모달 ==================== */}
      {isBoxModalOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-panel border border-border w-[400px] rounded-xl p-5 shadow-2xl flex flex-col gap-4">
            <div className="flex justify-between items-center border-b border-border pb-2">
              <span className="font-extrabold text-navy text-[13px] flex items-center gap-1.5">
                <FolderPlus size={15} className="text-teal" />
                <span>{editingBoxId ? '문서함 정보 수정' : '신규 문서함 추가'}</span>
              </span>
              <button onClick={() => setIsBoxModalOpen(false)} className="text-ink3 hover:text-ink p-1">
                <X size={15} />
              </button>
            </div>

            <form onSubmit={handleSaveBox} className="space-y-4">
              <div className="flex flex-col gap-1.5">
                <label className="font-bold text-ink2">문서함 이름</label>
                <input
                  type="text"
                  value={boxNameInput}
                  onChange={(e) => setBoxNameInput(e.target.value)}
                  placeholder="예: 교육자료"
                  required
                  className="h-9 w-full rounded-lg border border-border bg-panel px-3 outline-none focus:border-teal"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="font-bold text-ink2">설명</label>
                <textarea
                  value={boxDescInput}
                  onChange={(e) => setBoxDescInput(e.target.value)}
                  placeholder="문서함 용도를 간략히 설명해 주세요."
                  rows={3}
                  className="w-full rounded-lg border border-border bg-panel p-3 outline-none focus:border-teal resize-none"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-border/40">
                <button
                  type="button"
                  onClick={() => setIsBoxModalOpen(false)}
                  className="rounded-lg border px-4 py-2 font-bold text-ink2 hover:bg-panel-alt"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-teal text-white px-5 py-2 font-bold hover:opacity-90"
                >
                  저장하기
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================== F. 신규 문서 등록 모달 ==================== */}
      {isDocModalOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-panel border border-border w-[460px] rounded-xl p-5 shadow-2xl flex flex-col gap-4 max-h-[calc(90vh/var(--font-scale,1))] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-border pb-2">
              <span className="font-extrabold text-navy text-[13px] flex items-center gap-1.5">
                <FilePlus size={15} className="text-teal" />
                <span>신규 공식 문서 등록</span>
              </span>
              <button onClick={() => setIsDocModalOpen(false)} className="text-ink3 hover:text-ink p-1">
                <X size={15} />
              </button>
            </div>

            <form onSubmit={handleCreateDoc} className="space-y-4">
              <div className="flex flex-col gap-1.5">
                <label className="font-bold text-ink2">문서명 (필수)</label>
                <input
                  type="text"
                  value={docNameInput}
                  onChange={(e) => setDocNameInput(e.target.value)}
                  placeholder="문서의 표시 이름"
                  required
                  className="h-9 w-full rounded-lg border border-border bg-panel px-3 outline-none focus:border-teal"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="font-bold text-ink2">문서 분류함 (필수)</label>
                  <select
                    value={docBoxInput}
                    onChange={(e) => setDocBoxInput(e.target.value)}
                    className="h-9.5 rounded-lg border border-border bg-panel px-2 outline-none focus:border-teal"
                  >
                    {boxes.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="font-bold text-ink2">담당부서 (필수)</label>
                  <input
                    type="text"
                    value={docDeptInput}
                    onChange={(e) => setDocDeptInput(e.target.value)}
                    required
                    className="h-9 w-full rounded-lg border border-border bg-panel px-3 outline-none focus:border-teal"
                  />
                </div>
              </div>

              {/* 규정 여부 토글 */}
              <div className="bg-panel-alt/25 p-3 rounded-lg flex items-center justify-between">
                <div>
                  <span className="font-bold text-ink block text-[12px]">사내 공식 규정 문서입니까?</span>
                  <span className="text-[10px] text-ink3">체킹 시 개정 이력 버전관리와 시행일 관리 모델이 작동합니다.</span>
                </div>
                <input
                  type="checkbox"
                  checked={docIsRule}
                  onChange={(e) => setDocIsRule(e.target.checked)}
                  className="h-5 w-5 accent-teal cursor-pointer"
                />
              </div>

              {/* 규정일 때만 초기 버전 작성 */}
              {docIsRule && (
                <div className="flex flex-col gap-1.5">
                  <label className="font-bold text-ink2">초기 버전 명세 (필수)</label>
                  <input
                    type="text"
                    value={docVersionInput}
                    onChange={(e) => setDocVersionInput(e.target.value)}
                    placeholder="예: v1.0"
                    required={docIsRule}
                    className="h-9 w-full rounded-lg border border-border bg-panel px-3 outline-none focus:border-teal"
                  />
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <label className="font-bold text-ink2">간략 설명</label>
                <textarea
                  value={docDescInput}
                  onChange={(e) => setDocDescInput(e.target.value)}
                  placeholder="문서에 대한 설명을 입력하세요."
                  rows={3}
                  className="w-full rounded-lg border border-border bg-panel p-3 outline-none focus:border-teal resize-none"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="font-bold text-ink2">문서 파일 첨부 (가상 파일명)</label>
                <input
                  type="text"
                  value={docFileInput}
                  onChange={(e) => setDocFileInput(e.target.value)}
                  placeholder="예: 취업규칙_v3.0.pdf (공백 시 가상 기본 PDF 생성)"
                  className="h-9 w-full rounded-lg border border-border bg-panel px-3 outline-none focus:border-teal"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-border/40">
                <button
                  type="button"
                  onClick={() => setIsDocModalOpen(false)}
                  className="rounded-lg border px-4 py-2 font-bold text-ink2 hover:bg-panel-alt"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-teal text-white px-5 py-2 font-bold hover:opacity-90"
                >
                  등록 완료
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================== G. 규정 개정안 등록 모달 ==================== */}
      {isReviseModalOpen && selectedDoc && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-panel border border-border w-[440px] rounded-xl p-5 shadow-2xl flex flex-col gap-4">
            <div className="flex justify-between items-center border-b border-border pb-2">
              <span className="font-extrabold text-navy text-[13px] flex items-center gap-1.5">
                <TrendingUp size={15} className="text-teal" />
                <span>{selectedDoc.name} 개정안 등록</span>
              </span>
              <button onClick={() => setIsReviseModalOpen(false)} className="text-ink3 hover:text-ink p-1">
                <X size={15} />
              </button>
            </div>

            <form onSubmit={handleCreateRevise} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="font-bold text-ink2">개정 버전 (필수)</label>
                  <input
                    type="text"
                    value={revVersionInput}
                    onChange={(e) => setRevVersionInput(e.target.value)}
                    placeholder="예: v4.0"
                    required
                    className="h-9 w-full rounded-lg border border-border bg-panel px-3 outline-none focus:border-teal"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="font-bold text-ink2">시행 예정일 (필수)</label>
                  <input
                    type="date"
                    value={revEffectiveDate}
                    onChange={(e) => setRevEffectiveDate(e.target.value)}
                    required
                    className="h-9 w-full rounded-lg border border-border bg-panel px-3 outline-none focus:border-teal"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="font-bold text-ink2">개정 사유 (필수)</label>
                <textarea
                  value={revReasonInput}
                  onChange={(e) => setRevReasonInput(e.target.value)}
                  placeholder="개정 사항 및 변경된 주요 규칙을 서술해 주세요."
                  required
                  rows={4}
                  className="w-full rounded-lg border border-border bg-panel p-3 outline-none focus:border-teal resize-none"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="font-bold text-ink2">개정 문서 파일명</label>
                <input
                  type="text"
                  value={revFileInput}
                  onChange={(e) => setRevFileInput(e.target.value)}
                  placeholder="예: 취업규칙_v4.0_시행본.pdf"
                  className="h-9 w-full rounded-lg border border-border bg-panel px-3 outline-none focus:border-teal"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-border/40">
                <button
                  type="button"
                  onClick={() => setIsReviseModalOpen(false)}
                  className="rounded-lg border px-4 py-2 font-bold text-ink2 hover:bg-panel-alt"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-teal text-white px-5 py-2 font-bold hover:opacity-90"
                >
                  개정안 등록
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── 기능 제한 공지 모달 ── */}
      {isNoticeOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-xs select-none text-ink">
          <div className="w-[400px] rounded-2xl border border-border bg-panel p-6 shadow-2xl flex flex-col gap-4 text-center font-sans">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-amber/10 text-amber">
              <AlertTriangle size={24} />
            </div>
            <div className="space-y-1.5 text-center">
              <h3 className="text-base font-extrabold text-ink">서비스 이용 안내</h3>
              <p className="text-[12px] text-ink2 leading-relaxed">
                해당 페이지는 **아직 개발 및 구현 중**이므로<br />
                실제 기능 및 데이터를 정상적으로 이용할 수 없습니다.
              </p>
            </div>
            <button
              onClick={() => setIsNoticeOpen(false)}
              className="mt-2 w-full rounded-xl bg-teal py-2.5 font-bold text-white shadow-sm hover:opacity-90 transition-opacity text-[12px]"
            >
              확인하였습니다
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
