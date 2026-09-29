import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { ClipboardCheck, Bell, Settings, X, Info, Search } from 'lucide-react';
import { useAuth } from '@/app/auth/AuthProvider';
import { useApprovalBoxes } from '@/features/gw/useApprovals';
import { enablePushForUser, isPushConfigured, notificationPermission } from '@/shared/lib/messaging';
import { currentApproverIds, getPredecessorsOf, getReadRejectedDocIds, markRejectedDocAsRead } from '@/domain/approvalDoc/engine';
import { useOrgTree } from '@/features/gw/useOrgTree';
import type { ApprovalBox, ApprovalDoc } from '@/domain/approvalDoc/schema';

/**
 * 모바일 PWA 전자결재 결재함 — 열람·결재 중심(Flutter 모바일과 동일 스코프).
 * 웹 데스크톱과 동일한 useApprovalBoxes 훅/엔진을 재사용하므로 데이터가 실시간 공유된다.
 */
const BOX_PRIORITY: Record<ApprovalBox | '문서함', number> = {
  '상신': 1,    // 상신함
  '참조': 2,    // 참조함
  '대기': 3,    // 결재대기함
  '반려': 4,    // 반려함
  '수신': 5,    // 수신함
  '완료': 6,    // 완료함
  '후열': 7,    // 후열함
  '문서함': 8,  // 부서문서함
  '임시': 9,    // 임시저장함
  '삭제': 10,   // 휴지통
};

const FIXED_BOXES: { key: ApprovalBox | '문서함'; label: string }[] = [
  { key: '상신', label: '상신함' },
  { key: '참조', label: '참조함' },
  { key: '대기', label: '결재대기함' },
  { key: '반려', label: '반려함' },
  { key: '수신', label: '수신함' },
  { key: '완료', label: '완료함' },
];

const EXTRA_BOX_OPTIONS: { key: ApprovalBox | '문서함'; label: string }[] = [
  { key: '후열', label: '후열함' },
  { key: '문서함', label: '부서문서함' },
  { key: '임시', label: '임시저장함' },
  { key: '삭제', label: '휴지통' },
];

/** 문서 일시(상신/생성) 포맷 — YYYY.MM.DD HH:mm. */
export function fmtDocDate(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 상태 배지 색상(문서 상태별). */
export function statusColor(status: string): string {
  switch (status) {
    case '완료':
      return '#16a34a';
    case '반려':
      return '#e0483b';
    case '진행중':
      return '#2563eb';
    default:
      return '#8a8f98';
  }
}

export default function MobileApprovalList() {
  const { user } = useAuth();
  const nav = useNavigate();
  const me = user!.id;
  const { byBox, counts, isLoading } = useApprovalBoxes(me);
  const [box, setBox] = useState<ApprovalBox | '문서함'>('대기');
  const [todoFilter, setTodoFilter] = useState<'pending' | 'progress' | 'all'>('pending');
  const [draftFilter, setDraftFilter] = useState<'all' | 'progress' | 'completed' | 'rejected'>('all');
  const [doneFilter, setDoneFilter] = useState<'all' | 'draft' | 'approved'>('all');
  const [rejectFilter, setRejectFilter] = useState<'all' | 'rejected' | 'chain'>('all');
  const [readRejectedIds, setReadRejectedIds] = useState<Set<string>>(() => getReadRejectedDocIds(me));
  const [searchQuery, setSearchQuery] = useState('');
  const [searchBoxFilter, setSearchBoxFilter] = useState<'all' | ApprovalBox | '문서함'>('all');
  const org = useOrgTree();

  const preds = useMemo(() => getPredecessorsOf(me), [me]);

  // 1. 내가 즉시 승인/결재해야 할 활성 대기 건수 (전임자 승계 건 포함)
  const activePendingCount = useMemo(() => {
    const list = byBox['대기'] ?? [];
    return list.filter((d: ApprovalDoc) => {
      const approvers = currentApproverIds(d);
      return approvers.includes(me) || approvers.some((id) => preds.includes(id));
    }).length;
  }, [byBox, me, preds]);

  // 2. 상신한 문서 중 반려되어 조치가 필요한 건수
  const rejectedDraftCount = useMemo(() => {
    const list = byBox['상신'] ?? [];
    return list.filter(
      (d) => d.status === '반려' || d.status === '긴급 조치 사후 검토 반려' || d.status === '시행반송'
    ).length;
  }, [byBox]);

  // 3. 아직 열람하지 않은 반려 문서 건수
  const unreadRejectedCount = useMemo(() => {
    const list = byBox['반려'] ?? [];
    return list.filter((d) => !readRejectedIds.has(d.id)).length;
  }, [byBox, readRejectedIds]);

  // 4. 사후 열람 확인이 필요한 후열 문서 건수
  const unconfirmedPostReadCount = useMemo(() => {
    const list = byBox['후열'] ?? [];
    return list.filter((d) => d.steps.some((s) => s.delegatedFromId === me && !s.postReadAt)).length;
  }, [byBox, me]);

  // 로컬스토리지 키 설정 (사용자별 안전 격리)
  const STORAGE_KEY = `workfit-approval-extra-tabs-v3-${me}`;

  // 로컬스토리지에서 추가 활성화 탭 읽기 (레거시 키 호환 fallback)
  const [extraTabs, setExtraTabs] = useState<(ApprovalBox | '문서함')[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) || localStorage.getItem('workfit-approval-extra-tabs-v3');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // 현재 활성화된 모든 결재함 탭들
  const activeBoxes = useMemo(() => {
    const extra = EXTRA_BOX_OPTIONS.filter((b) => extraTabs.includes(b.key));
    const combined = [...FIXED_BOXES, ...extra];
    return combined.sort((a, b) => BOX_PRIORITY[a.key] - BOX_PRIORITY[b.key]);
  }, [extraTabs]);

  // 설정 변경 모달 열림 여부
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  // 모달 안에서 편집할 임시 설정 값
  const [tempExtraTabs, setTempExtraTabs] = useState<(ApprovalBox | '문서함')[]>(extraTabs);

  const openSettings = () => {
    setTempExtraTabs(extraTabs);
    setIsSettingsOpen(true);
  };

  const handleToggleExtraTab = (key: ApprovalBox | '문서함') => {
    setTempExtraTabs((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const saveSettings = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tempExtraTabs));
    setExtraTabs(tempExtraTabs);
    setIsSettingsOpen(false);

    // 만약 현재 선택된 탭(box)이 새 설정에서 제외되었다면, 첫 번째 고정 탭인 '대기'로 이동
    const isStillActive = [...FIXED_BOXES.map((b) => b.key), ...tempExtraTabs].includes(box);
    if (!isStillActive) {
      setBox('대기');
    }
  };

  // 결재 푸시 opt-in — 권한이 아직 'default'일 때만 노출(최초 허용은 사용자 제스처 필요).
  const [pushPerm, setPushPerm] = useState<NotificationPermission | 'unsupported'>(() => notificationPermission());
  const [notice, setNotice] = useState('');
  const showPushOptIn = isPushConfigured() && pushPerm === 'default';
  const enablePush = async () => {
    setNotice('알림 설정 중…');
    const res = await enablePushForUser(me);
    setPushPerm(notificationPermission());
    setNotice(res.ok ? '✅ 결재 알림이 켜졌습니다.' : `⚠️ 알림 실패 — ${res.error}`);
    setTimeout(() => setNotice(''), 8000);
  };

  const docs = useMemo(() => {
    if (box === '문서함') {
      const myDeptObj = org.depts.find((d: any) => d.name === user?.dept);
      const myDeptId = myDeptObj?.id ?? '';
      const myDeptName = user?.dept ?? '';

      const allDocs = Object.values(byBox).flat();
      return allDocs.filter((d) => {
        if (d.status !== '완료') return false;
        if (d.visibility === '비공개') return false;
        const drafterUser = org.users.find((u: any) => u.id === d.drafterId);
        const docDeptId = d.drafterDeptId || org.depts.find((dept: any) => dept.name === drafterUser?.dept)?.id || '';
        return docDeptId === myDeptId || (!docDeptId && d.drafterDept === myDeptName);
      });
    }

    const rawDocs = byBox[box as ApprovalBox] ?? [];

    // 1. 결재 대기함 필터링
    if (box === '대기') {
      const preds = getPredecessorsOf(me);
      if (todoFilter === 'pending') {
        return rawDocs.filter((d: ApprovalDoc) => {
          const approvers = currentApproverIds(d);
          return approvers.includes(me) || approvers.some((id) => preds.includes(id));
        });
      }
      if (todoFilter === 'progress') {
        return rawDocs.filter((d: ApprovalDoc) => {
          const approvers = currentApproverIds(d);
          return !approvers.includes(me) && !approvers.some((id) => preds.includes(id));
        });
      }
      return rawDocs;
    }

    // 2. 상신함 필터링
    if (box === '상신') {
      if (draftFilter === 'progress') return rawDocs.filter((d) => d.status === '진행중');
      if (draftFilter === 'completed') return rawDocs.filter((d) => d.status === '완료' || d.status === '시행대기');
      if (draftFilter === 'rejected') {
        return rawDocs.filter((d) => d.status === '반려' || d.status === '긴급 조치 사후 검토 반려' || d.status === '시행반송');
      }
      return rawDocs;
    }

    // 3. 기결재 완료함 필터링
    if (box === '완료') {
      if (doneFilter === 'draft') return rawDocs.filter((d) => d.drafterId === me);
      if (doneFilter === 'approved') return rawDocs.filter((d) => d.steps.some((s) => s.approverId === me && s.decision === '승인'));
      return rawDocs;
    }



    // 4.5 반려함 필터링
    if (box === '반려') {
      const preds = getPredecessorsOf(me);
      const isMyReject = (d: ApprovalDoc) =>
        d.steps.some(
          (s) =>
            (s.approverId === me || s.delegatedFromId === me || preds.includes(s.approverId)) &&
            s.decision === '반려'
        );
      if (rejectFilter === 'rejected') {
        return rawDocs.filter(isMyReject);
      }
      if (rejectFilter === 'chain') {
        return rawDocs.filter((d: ApprovalDoc) => !isMyReject(d));
      }
      return rawDocs;
    }

    return rawDocs;
  }, [byBox, box, todoFilter, draftFilter, doneFilter, rejectFilter, me, org, user?.dept]);

  // 전체 문서함 통합 고유 문서 풀 (검색용)
  const allUniqueDocs = useMemo(() => {
    const map = new Map<string, ApprovalDoc>();
    Object.values(byBox).forEach((list) => {
      (list as ApprovalDoc[]).forEach((doc) => {
        if (!map.has(doc.id)) map.set(doc.id, doc);
      });
    });
    return Array.from(map.values());
  }, [byBox]);

  // 검색어 및 문서함 필터가 적용된 검색 결과
  const searchResults = useMemo(() => {
    const kw = searchQuery.trim().toLowerCase();
    if (!kw && searchBoxFilter === 'all') return [];

    let pool = allUniqueDocs;
    if (searchBoxFilter !== 'all') {
      if (searchBoxFilter === '문서함') {
        const myDeptObj = org.depts.find((d: any) => d.name === user?.dept);
        const myDeptId = myDeptObj?.id ?? '';
        const myDeptName = user?.dept ?? '';
        pool = pool.filter((d) => {
          if (d.status !== '완료' || d.visibility === '비공개') return false;
          const drafterUser = org.users.find((u: any) => u.id === d.drafterId);
          const docDeptId = d.drafterDeptId || org.depts.find((dept: any) => dept.name === drafterUser?.dept)?.id || '';
          return docDeptId === myDeptId || (!docDeptId && d.drafterDept === myDeptName);
        });
      } else {
        const boxDocs = byBox[searchBoxFilter as ApprovalBox] ?? [];
        const boxDocIds = new Set(boxDocs.map((d) => d.id));
        pool = pool.filter((d) => boxDocIds.has(d.id));
      }
    }

    if (!kw) return pool;

    return pool.filter((d) => {
      const titleMatch = d.title?.toLowerCase().includes(kw);
      const noMatch = d.docNo?.toLowerCase().includes(kw);
      const drafterMatch = d.drafterName?.toLowerCase().includes(kw);
      const typeMatch = d.docType?.toLowerCase().includes(kw);
      const deptMatch = d.drafterDept?.toLowerCase().includes(kw);
      return Boolean(titleMatch || noMatch || drafterMatch || typeMatch || deptMatch);
    });
  }, [allUniqueDocs, byBox, searchQuery, searchBoxFilter, org, user?.dept]);

  const isSearching = searchQuery.trim().length > 0;

  return (
    <div className="flex h-full flex-col" style={{ background: '#f0f4f8' }}>
      <header className="flex shrink-0 items-center gap-2 px-2 py-3 text-white" style={{ background: '#101830' }}>
        <button onClick={() => nav('/m')} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[18px] hover:bg-white/10">←</button>
        <span className="flex items-center gap-1.5 text-[15px] font-bold"><ClipboardCheck size={17} /> 전자결재</span>
        <div className="ml-auto flex items-center gap-1">
          {showPushOptIn && (
            <button onClick={enablePush} title="결재 알림 켜기" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg hover:bg-white/10">
              <Bell size={18} strokeWidth={2} />
            </button>
          )}
          <button onClick={openSettings} title="결재함 설정" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg hover:bg-white/10">
            <Settings size={18} strokeWidth={2} />
          </button>
        </div>
      </header>

      {notice && <div className="px-4 py-2 text-[11.5px] text-navy" style={{ background: '#c7ecc5' }}>{notice}</div>}

      {/* ── 검색 바 ── */}
      <div className="shrink-0 border-b border-[#e2e8f0] bg-white px-3 py-2">
        <div className="relative flex items-center">
          <Search size={14} className="absolute left-3 text-ink3" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="결재 문서명, 문서번호, 기안자 검색…"
            className="w-full rounded-xl border border-slate-200 bg-slate-50/80 py-1.5 pl-8.5 pr-8 text-[12px] text-ink placeholder:text-ink3 outline-none focus:border-[#3b82f6] focus:bg-white transition-all shadow-2xs"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setSearchBoxFilter('all');
              }}
              className="absolute right-2.5 p-1 text-ink3 hover:text-ink"
              title="검색어 지우기"
            >
              <X size={13} />
            </button>
          )}
        </div>

        {/* 검색어가 있을 때 문서함 필터 칩 */}
        {isSearching && (
          <div className="flex items-center gap-1 overflow-x-auto pt-2 pb-0.5 no-scrollbar">
            <span className="text-[10px] font-bold text-ink3 shrink-0 mr-1">문서함:</span>
            {[
              { k: 'all', l: '전체' },
              { k: '대기', l: '대기' },
              { k: '상신', l: '상신' },
              { k: '완료', l: '완료' },
              { k: '반려', l: '반려' },
              { k: '참조', l: '참조' },
              { k: '수신', l: '수신' },
              { k: '문서함', l: '부서문서' },
            ].map((chip) => (
              <button
                key={chip.k}
                type="button"
                onClick={() => setSearchBoxFilter(chip.k as any)}
                className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold shrink-0 transition-all ${
                  searchBoxFilter === chip.k
                    ? 'bg-[#3b82f6] text-white shadow-2xs'
                    : 'bg-slate-100 text-ink3 hover:bg-slate-200'
                }`}
              >
                {chip.l}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 결재함 탭 (검색 모드가 아닐 때만 노출) */}
      {!isSearching && (
        <>
          <div 
            className="flex shrink-0 border-b border-[#e2e8f0] bg-white overflow-x-auto whitespace-nowrap scrollbar-none flex-row flex-nowrap"
            style={{ WebkitOverflowScrolling: 'touch' }}
          >
        {activeBoxes.map((b) => {
          const active = b.key === box;
          const rawCnt = counts[b.key as ApprovalBox] ?? 0;
          const cnt =
            b.key === '대기'
              ? activePendingCount
              : b.key === '반려'
              ? unreadRejectedCount
              : b.key === '상신'
              ? rejectedDraftCount
              : rawCnt;

          // 스마트 뱃지 색상 정책 (웹과 완벽 통일)
          const badgeBg =
            b.key === '대기'
              ? activePendingCount > 0
                ? '#ef4444' // 내 차례 결재가 있으면 빨간색 경고
                : '#94a3b8' // 내 차례가 아니면 일반 회색
              : b.key === '상신'
              ? '#ef4444' // 반려된 상신 문서 경고 레드
              : b.key === '반려'
              ? '#f43f5e' // 미열람 반려 문서 로즈 레드
              : b.key === '후열'
              ? unconfirmedPostReadCount > 0
                ? '#f59e0b' // 미확인 후열 문서 주황 앰버
                : '#94a3b8'
              : '#94a3b8';

          const shouldPulse =
            (b.key === '대기' && activePendingCount > 0) ||
            (b.key === '상신' && rejectedDraftCount > 0) ||
            (b.key === '반려' && unreadRejectedCount > 0) ||
            (b.key === '후열' && unconfirmedPostReadCount > 0);

          return (
            <button
              key={b.key}
              onClick={() => {
                setBox(b.key);
                setTodoFilter('pending');
                setDraftFilter('all');
                setDoneFilter('all');
                setRejectFilter('all');
              }}
              className={`relative flex-1 shrink-0 px-4 py-2.5 text-[12.5px] font-bold transition-colors ${active ? 'text-ink' : 'text-ink3'}`}
            >
              <span className="inline-flex items-center gap-1">
                {b.label}
                {cnt > 0 && (
                  <span
                    className={`grid h-[15px] min-w-[15px] place-items-center rounded-full px-1 text-[9.5px] font-extrabold text-white ${
                      shouldPulse ? 'animate-pulse' : ''
                    }`}
                    style={{ background: badgeBg }}
                  >
                    {cnt}
                  </span>
                )}
              </span>
              {active && <span className="absolute inset-x-3 bottom-0 h-[2.5px] rounded-full" style={{ background: '#3b82f6' }} />}
            </button>
          );
        })}
      </div>

      {box === '대기' && (
        <div className="flex shrink-0 border-b border-black/5 bg-white p-2.5 gap-2 select-none">
          {(['pending', 'progress', 'all'] as const).map((f) => {
            const label = f === 'pending' ? '결재대기중' : f === 'progress' ? '진행중' : '전체';
            const active = todoFilter === f;
            return (
              <button
                key={f}
                onClick={() => setTodoFilter(f)}
                className={`flex-1 rounded-xl py-2 text-[12px] font-bold transition-all flex items-center justify-center gap-1 ${
                  active ? 'bg-[#3b82f6] text-white shadow-sm shadow-[#3b82f6]/20' : 'bg-black/5 text-ink3 hover:bg-black/10'
                }`}
              >
                <span>{label}</span>
                {f === 'pending' && activePendingCount > 0 && (
                  <span
                    className={`rounded-full px-1.5 py-0.2 text-[9.5px] font-extrabold ${
                      active ? 'bg-white text-red-600' : 'bg-red-500 text-white'
                    }`}
                  >
                    {activePendingCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {box === '상신' && (
        <div className="flex shrink-0 border-b border-black/5 bg-white p-2.5 gap-2 select-none">
          {(['all', 'progress', 'rejected', 'completed'] as const).map((f) => {
            const label = f === 'all' ? '전체' : f === 'progress' ? '진행중' : f === 'rejected' ? '반려' : '완료';
            const active = draftFilter === f;
            return (
              <button
                key={f}
                onClick={() => setDraftFilter(f)}
                className={`flex-1 rounded-xl py-2 text-[12px] font-bold transition-all flex items-center justify-center gap-1 ${
                  active ? 'bg-[#2563eb] text-white shadow-sm shadow-[#2563eb]/20' : 'bg-black/5 text-ink3 hover:bg-black/10'
                }`}
              >
                <span>{label}</span>
                {f === 'rejected' && rejectedDraftCount > 0 && (
                  <span
                    className={`rounded-full px-1.5 py-0.2 text-[9.5px] font-extrabold ${
                      active ? 'bg-white text-red-600' : 'bg-red-500 text-white'
                    }`}
                  >
                    {rejectedDraftCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {box === '완료' && (
        <div className="flex shrink-0 border-b border-black/5 bg-white p-2.5 gap-2 select-none">
          {(['all', 'draft', 'approved'] as const).map((f) => {
            const label = f === 'all' ? '전체' : f === 'draft' ? '기안한 문서' : '결재한 문서';
            const active = doneFilter === f;
            return (
              <button
                key={f}
                onClick={() => setDoneFilter(f)}
                className={`flex-1 rounded-xl py-2 text-[12px] font-bold transition-all ${
                  active ? 'bg-[#3b82f6] text-white shadow-sm shadow-[#3b82f6]/20' : 'bg-black/5 text-ink3 hover:bg-black/10'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}



      {box === '반려' && (
        <div className="flex shrink-0 border-b border-black/5 bg-white p-2.5 gap-2 select-none">
          {(['all', 'rejected', 'chain'] as const).map((f) => {
            const label = f === 'all' ? '전체' : f === 'rejected' ? '내가 직접 반려' : '결재참여 반려';
            const active = rejectFilter === f;
            return (
              <button
                key={f}
                onClick={() => setRejectFilter(f)}
                className={`flex-1 rounded-xl py-2 text-[12px] font-bold transition-all ${
                  active ? 'bg-rose-500 text-white shadow-sm shadow-rose-500/20' : 'bg-black/5 text-ink3 hover:bg-black/10'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}
      </>
      )}

      {/* ── 본문 목록 영역 ── */}
      <div className="min-h-0 flex-1 overflow-y-auto" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {isSearching ? (
          /* 검색 결과 목록 */
          <div>
            <div className="flex items-center justify-between bg-slate-100/90 px-4 py-2 text-[11px] font-bold text-ink2 border-b border-slate-200">
              <span>
                {searchBoxFilter !== 'all' ? `[${searchBoxFilter}] ` : ''}
                검색 결과 ({searchResults.length}건)
              </span>
              <span className="text-[10px] text-ink3">문서를 탭하여 상세 조회</span>
            </div>

            {searchResults.length === 0 ? (
              <div className="py-20 text-center text-[12px] text-ink3">
                검색 조건과 일치하는 결재 문서가 없습니다.
              </div>
            ) : (
              searchResults.map((d) => (
                <ApprovalRow
                  key={d.id}
                  doc={d}
                  isUnread={box === '반려' && !readRejectedIds.has(d.id)}
                  onOpen={() => {
                    if (d.status === '반려' && me) {
                      markRejectedDocAsRead(me, d.id);
                      setReadRejectedIds((prev) => new Set(prev).add(d.id));
                    }
                    nav(`/m/approval/${d.id}`);
                  }}
                />
              ))
            )}
          </div>
        ) : (
          /* 기존 결재함 문서 목록 */
          <>
            {isLoading ? (
              <div className="py-16 text-center text-[12px] text-ink3">불러오는 중…</div>
            ) : docs.length === 0 ? (
              <div className="py-16 text-center text-[12px] text-ink3">
                {box === '대기' ? '결재할 문서가 없습니다.' : '문서가 없습니다.'}
              </div>
            ) : (
              docs.map((d) => (
                <ApprovalRow
                  key={d.id}
                  doc={d}
                  isUnread={box === '반려' && !readRejectedIds.has(d.id)}
                  onOpen={() => {
                    if (box === '반려' && me) {
                      markRejectedDocAsRead(me, d.id);
                      setReadRejectedIds((prev) => new Set(prev).add(d.id));
                    }
                    nav(`/m/approval/${d.id}`);
                  }}
                />
              ))
            )}
          </>
        )}
      </div>

      {/* 반려함 안내 문구 */}
      {(box === '반려' || (box === '상신' && draftFilter === 'rejected')) && (
        <div className="shrink-0 border-t border-slate-200/80 bg-slate-50/90 px-4 py-2.5 text-center shadow-xs" style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}>
          <p className="text-[12px] text-slate-600 flex items-center justify-center gap-1.5 font-medium">
            <Info size={15} className="text-blue-500 shrink-0" strokeWidth={2.2} />
            <span>반려 문서의 <strong className="text-slate-800 font-bold">편집 및 재상신</strong>은 <strong className="text-blue-600 font-bold">PC 웹</strong>에서 진행해 주시기 바랍니다.</span>
          </p>
        </div>
      )}

      {isSettingsOpen && createPortal(
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50 p-4" onClick={() => setIsSettingsOpen(false)}>
          <div className="w-full max-w-md rounded-t-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()} style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }}>
            <div className="flex items-center justify-between pb-3 border-b border-black/5">
              <span className="text-[15px] font-bold text-ink">결재함 설정</span>
              <button onClick={() => setIsSettingsOpen(false)} className="text-ink3 p-1">
                <X size={16} />
              </button>
            </div>
            
            <div className="py-4 space-y-3.5">
              <div className="text-[11.5px] text-ink3 font-medium">기본 노출 (고정)</div>
              <div className="grid grid-cols-2 gap-2">
                {FIXED_BOXES.map((b) => (
                  <div key={b.key} className="flex items-center gap-2 rounded-lg bg-black/[0.02] p-3 border border-black/5 opacity-60">
                    <input type="checkbox" checked disabled className="h-4 w-4 rounded accent-[#e6960c]" />
                    <span className="text-[12.5px] font-semibold text-ink3">{b.label}</span>
                  </div>
                ))}
              </div>

              <div className="h-px bg-black/5 my-2" />

              <div className="text-[11.5px] text-ink3 font-medium">추가 노출 선택</div>
              <div className="grid grid-cols-2 gap-2">
                {EXTRA_BOX_OPTIONS.map((b) => {
                  const active = tempExtraTabs.includes(b.key);
                  return (
                    <button
                      key={b.key}
                      onClick={() => handleToggleExtraTab(b.key)}
                      className={`flex items-center gap-2 rounded-lg border p-3 text-left transition-all ${active ? 'border-[#e6960c] bg-amber-50/10' : 'border-black/5 bg-white'}`}
                      style={active ? { background: '#e6960c15' } : undefined}
                    >
                      <input
                        type="checkbox"
                        checked={active}
                        readOnly
                        className="h-4 w-4 rounded accent-[#e6960c]"
                      />
                      <span className={`text-[12.5px] font-bold ${active ? 'text-[#e6960c]' : 'text-ink2'}`}>{b.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex gap-2.5 mt-2">
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="flex-1 rounded-lg border py-2.5 text-[13.5px] font-bold text-ink2 border-black/10 bg-white active:bg-black/5"
              >
                취소
              </button>
              <button
                onClick={saveSettings}
                className="flex-1 rounded-lg py-2.5 text-[13.5px] font-bold text-white active:opacity-90"
                style={{ background: '#e6960c' }}
              >
                저장
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

function ApprovalRow({ doc, onOpen, isUnread }: { doc: ApprovalDoc; onOpen: () => void; isUnread?: boolean }) {
  const drafter = doc.drafterName || doc.drafterId;
  
  let statusText: string = doc.status === '시행대기' ? '완료' : doc.status === '시행반송' ? '반려' : doc.status;
  let sColor = statusColor(statusText);

  return (
    <button
      onClick={onOpen}
      className="flex w-full flex-col gap-1 border-b border-slate-100 bg-white px-4 py-3 text-left active:bg-slate-50 transition-colors"
    >
      <div className="flex items-center gap-1.5">
        <span className="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold" style={{ background: '#dbeafe', color: '#1e40af' }}>
          {doc.docType}
        </span>
        <span
          className="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold"
          style={{ background: `${sColor}1f`, color: sColor }}
        >
          {statusText}
        </span>
        {isUnread && (
          <span className="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold bg-rose-50 text-rose-600 border border-rose-200 animate-pulse">
            미열람
          </span>
        )}
        <span className="ml-auto shrink-0 text-[10px] tabular-nums text-ink3">{doc.docNo}</span>
      </div>
      <div className="truncate text-[14px] font-bold text-ink">{doc.title}</div>
      <div className="flex items-center gap-2 text-[11px] text-ink3">
        <span className="truncate">
          {drafter}
          {doc.drafterDept ? ` · ${doc.drafterDept}` : ''}
        </span>
        <span className="ml-auto shrink-0 tabular-nums">{fmtDocDate(doc.submittedAt ?? doc.createdAt)}</span>
      </div>
    </button>
  );
}
