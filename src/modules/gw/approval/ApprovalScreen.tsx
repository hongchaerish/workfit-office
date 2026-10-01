import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/app/auth/AuthProvider';
import { usePermission } from '@/features/auth/usePermission';
import { useOrgTree } from '@/features/gw/useOrgTree';
import { X, Send, Folder, User as UserIcon, MessageSquare, Printer, Check, Eye, Share2, PenLine, RotateCcw, Search } from 'lucide-react';
import {
  useApprovalBoxes,
  useDecideStep,
  useRecallApproval,
  useSubmitApproval,
  useDeleteToTrash,
  useRestoreFromTrash,
  usePermanentlyDelete,
  useConfirmPostRead,
  useBatchDecideStep,
  useBatchRestoreFromTrash,
  useBatchPermanentlyDelete,
  useAllApprovals,
} from '@/features/gw/useApprovals';
import {
  useReceivedPostReads,
  useDocPostReads,
  useSharePostRead,
  useAutoMarkPostRead,
  useLegacyPostReadImport,
} from '@/features/gw/usePostReadShares';
import { postReadDocIdsFor, unreadPostReadDocIdsFor } from '@/domain/approvalPostRead/engine';
import {
  activeSteps,
  currentApproverIds,
  getPredecessorsOf,
  matchesBox,
  byRecent,
  getEffectiveRecipients,
  getReadRejectedDocIds,
  markRejectedDocAsRead,
  isCompletedBoxMatch,
  isDrafterBoxMatch,
  isRejectedBoxMatch,
  isTodoBoxMatch,
  isReceivedBoxMatch,
} from '@/domain/approvalDoc/engine';
import { type ApprovalBox, type ApprovalDoc } from '@/domain/approvalDoc/schema';
import type { User } from '@/domain/user/schema';
import { fmtDateTime, KIND_TONE, won } from './utils/approvalUtils';
import { DocStatusBadge } from './components/ApprovalBadges';
import { DocTypeIcon } from './components/DocTypeIcon';
import { useUsers } from '@/features/user/useUsers';

import { ApprovalOpinionModal } from './components/ApprovalOpinionModal';
import { RecallConfirmModal } from './components/RecallConfirmModal';
import { ApprovalDocumentView } from '@/modules/gw/approval/ApprovalDocumentView';
import { DraftFormSelectModal } from './components/DraftFormSelectModal';
import { absenceRepo } from '@/data/absence/absence.repo';
import { approvalProcessRepo } from '@/data/approvalProcess/approvalProcess.repo';


/**
 * 전자결재 결재함(§7.2) — 좌 함 탭(대기·상신·완료·참조·임시) + 중 목록 + 우 상세.
 * 상세는 결재선 진행 타임라인 + 내 차례면 승인/반려/보류 액션, 기안자면 회수/재상신/편집.
 * 모든 전이는 features 훅(엔진 위임) → 성공 시 캐시 무효화로 함·배지 자동 갱신.
 */
const BOX_LABEL: Record<ApprovalBox, string> = {
  대기: '결재 대기함',
  상신: '상신함',
  반려: '반려함',
  임시: '임시 저장함',
  수신: '수신함',
  참조: '참조함',
  후열: '후열함',
  완료: '기결재 완료함',
  삭제: '휴지통',
};



export default function ApprovalScreen() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const me = user?.id ?? '';
  const [showFormSelectModal, setShowFormSelectModal] = useState(false);
  const org = useOrgTree();
  const userObj = org.userById(me);
  const { data: users = [] } = useUsers();

  const { byBox, isLoading } = useApprovalBoxes(me);
  const { data: allDocs = [] } = useAllApprovals();
  const [params] = useSearchParams();
  const boxParam = params.get('box') as ApprovalBox | '문서함' | null;

  const [box, setBox] = useState<ApprovalBox | '문서함'>(() => boxParam || '대기');

  const preds = useMemo(() => getPredecessorsOf(me), [me]);

  // 후열(공람) 전달 — 본인 + 전임자 앞 전달을 한 번에 읽어 사용자별로 나눠 쓴다.
  const { isOperator: isOp, isAdmin: isAdm } = usePermission();
  useLegacyPostReadImport(me, isOp || isAdm);
  const { data: recvPostReads = [] } = useReceivedPostReads([me, ...preds]);
  const postReadIdsOf = (uid: string) => postReadDocIdsFor(recvPostReads, uid);
  const myUnreadPostReadIds = useMemo(() => unreadPostReadDocIdsFor(recvPostReads, me), [recvPostReads, me]);

  const activePendingCount = useMemo(() => {
    const list = byBox['대기'] ?? [];
    return list.filter((d) => {
      const approvers = currentApproverIds(d);
      return approvers.includes(me) || approvers.some((id) => preds.includes(id));
    }).length;
  }, [byBox, me, preds]);

  const [selId, setSelId] = useState<string | null>(() => params.get('doc'));
  const [doneFilter, setDoneFilter] = useState<'all' | 'draft' | 'approved'>('all');
  const [todoFilter, setTodoFilter] = useState<'pending' | 'progress' | 'all'>('pending');
  const [rejectFilter, setRejectFilter] = useState<'all' | 'rejected' | 'chain'>('all');
  const [draftFilter, setDraftFilter] = useState<'all' | 'progress' | 'rejected' | 'completed'>('all');

  const handleSelectBox = (newBox: ApprovalBox | '문서함') => {
    setBox(newBox);
    setSelId(null);
    if (newBox === '대기') setTodoFilter('pending');
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set('box', newBox);
    nextUrl.searchParams.delete('doc');
    window.history.replaceState(null, '', nextUrl.toString());
  };

  const handleSelectDoc = (d: ApprovalDoc) => {
    setSelId(d.id);
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set('box', box);
    nextUrl.searchParams.set('doc', d.docNo || d.id);
    window.history.replaceState(null, '', nextUrl.toString());
    if (box === '반려' && me) {
      markRejectedDocAsRead(me, d.id);
      setReadRejectedIds((prev) => new Set(prev).add(d.id));
    }
  };

  const handleSelectDocById = (targetDocId: string) => {
    setSelId(targetDocId);
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set('doc', targetDocId);
    window.history.replaceState(null, '', nextUrl.toString());
  };

  // ── 상단 문서 검색 상태 및 드롭다운 연동 ──
  const [searchQuery, setSearchQuery] = useState('');
  const [searchBoxFilter, setSearchBoxFilter] = useState<'all' | ApprovalBox>('all');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  // 접근 가능한 전체 고유 문서 풀 (현재 사용자가 조회 가능한 모든 함의 문서)
  const searchableDocs = useMemo(() => {
    const docMap = new Map<string, ApprovalDoc>();
    Object.values(byBox).forEach((list) => {
      list.forEach((d) => docMap.set(d.id, d));
    });
    // allDocs 중에서도 본인이 기안자/결재자/참조자인 문서 포함
    allDocs.forEach((d) => {
      if (
        d.drafterId === me ||
        d.steps.some((s) => s.approverId === me) ||
        d.recipients?.some((r) => r.id === me)
      ) {
        docMap.set(d.id, d);
      }
    });
    return Array.from(docMap.values()).sort(
      (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
    );
  }, [byBox, allDocs, me]);

  // 선택된 문서함 풀
  const targetDocsPool = useMemo(() => {
    if (searchBoxFilter === 'all') {
      return searchableDocs;
    }
    return byBox[searchBoxFilter] ?? [];
  }, [searchBoxFilter, searchableDocs, byBox]);

  // 검색어에 따른 필터링 결과
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const baseList = targetDocsPool;
    if (!q) {
      return baseList.slice(0, 6);
    }
    return baseList
      .filter((d) => {
        const title = (d.title || '').toLowerCase();
        const docNo = (d.docNo || '').toLowerCase();
        const drafter = (d.drafterName || '').toLowerCase();
        const docType = (d.docType || '').toLowerCase();
        const dept = (d.drafterDept || '').toLowerCase();
        return (
          title.includes(q) ||
          docNo.includes(q) ||
          drafter.includes(q) ||
          docType.includes(q) ||
          dept.includes(q)
        );
      })
      .slice(0, 10);
  }, [searchQuery, targetDocsPool]);

  // 검색 드롭다운 외부 클릭 시 닫기
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setIsSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 검색 결과 문서 클릭 시 이동 핸들러
  const handleSelectSearchedDoc = (d: ApprovalDoc) => {
    let targetBox: ApprovalBox = searchBoxFilter !== 'all' ? searchBoxFilter : '상신';
    if (searchBoxFilter === 'all') {
      if (d.status === '임시저장') targetBox = '임시';
      else if (d.status === '반려') targetBox = '반려';
      else if (d.status === '회수') targetBox = '상신';
      else if (d.status === '진행중') {
        const myStep = activeSteps(d).find((s) => s.approverId === me);
        targetBox = myStep ? '대기' : '상신';
      } else if (d.status === '완료') {
        targetBox = '완료';
      }
    }

    setBox(targetBox);
    handleSelectDoc(d);
    setIsSearchOpen(false);
    setSearchQuery('');
  };

  // 반려함 문서 읽음(열람) 관리
  const [readRejectedIds, setReadRejectedIds] = useState<Set<string>>(() => getReadRejectedDocIds(me));
  useEffect(() => {
    setReadRejectedIds(getReadRejectedDocIds(me));
  }, [me]);

  useEffect(() => {
    if (selId && box === '반려' && me) {
      if (!readRejectedIds.has(selId)) {
        markRejectedDocAsRead(me, selId);
        setReadRejectedIds((prev) => new Set(prev).add(selId));
      }
    }
  }, [selId, box, me, readRejectedIds]);



  // 다중 선택 상태 & 일괄 처리 훅
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showBatchApproveConfirm, setShowBatchApproveConfirm] = useState(false);
  const [batchComment, setBatchComment] = useState('');
  const [isListCollapsed, setIsListCollapsed] = useState(false);

  const batchDecide = useBatchDecideStep();
  const batchRestore = useBatchRestoreFromTrash();
  const batchPermanentDelete = useBatchPermanentlyDelete();

  // 본인 및 전임자(들)의 approval boxes 데이터를 병합하여 단일 결재함 리스트 구성 (권한 승계 완벽 반영)
  const list = useMemo(() => {
    if (box === '문서함') return [];

    // 1. 본인의 기본 문서 목록
    const myDeptObj = org.depts.find((d) => d.name === userObj?.dept);
    const myDeptNameOrId = userObj ? (myDeptObj ? `${userObj.dept}||${myDeptObj.id}` : userObj.dept) : '';
    let combined = allDocs.filter((d) => matchesBox(d, me, box as ApprovalBox, myDeptNameOrId, undefined, postReadIdsOf(me)));

    // 2. 전임자들의 문서 목록을 가져와 병합
    preds.forEach((predId) => {
      const predUser = org.userById(predId) || users.find((u) => u.id === predId);
      if (!predUser) return;
      const predDeptObj = org.depts.find((d) => d.name === predUser.dept);
      const predDeptNameOrId = predDeptObj ? `${predUser.dept}||${predDeptObj.id}` : predUser.dept;

      const predDocs = allDocs.filter((d) => matchesBox(d, predId, box as ApprovalBox, predDeptNameOrId, undefined, postReadIdsOf(predId)));
      combined = [...combined, ...predDocs];
    });

    // 3. ID 기준 중복 제거 및 최신 상신순 재정렬
    const uniqueMap = new Map<string, ApprovalDoc>();
    combined.forEach((d) => uniqueMap.set(d.id, d));
    return Array.from(uniqueMap.values()).sort(byRecent);
  }, [box, allDocs, me, preds, org, userObj, users, recvPostReads]);

  // 완료함, 결재함 필터링 적용
  const filteredList = useMemo(() => {
    if (box === '문서함') {
      const myDeptName = userObj?.dept ?? '';
      const myDeptObj = org.depts.find((d) => d.name === myDeptName);
      const myDeptId = myDeptObj?.id ?? '';
      return allDocs.filter((d) => {
        if (d.status !== '완료') return false; // 결재 완료된 문서만 노출
        const vis = d.visibility ?? '부서';
        if (vis === '비공개') return false; // 비공개는 제외

        // drafterDeptId 가 비어있는 과거 레거시 기결재 문서는 기안자의 현재 부서 ID를 도출해 필터 대조
        const drafterUser = org.userById(d.drafterId);
        const drafterCurrentDeptName = drafterUser?.dept ?? '';
        const drafterCurrentDeptObj = org.depts.find((dept) => dept.name === drafterCurrentDeptName);
        const drafterCurrentDeptId = drafterCurrentDeptObj?.id ?? '';
        const docDeptId = d.drafterDeptId || drafterCurrentDeptId;

        return docDeptId === myDeptId || (!docDeptId && d.drafterDept === myDeptName);
      }).sort((a, b) => {
        const tA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const tB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return tB - tA;
      });
    }

    if (box === '완료') {
      if (doneFilter === 'draft') {
        return list.filter((d: ApprovalDoc) => d.drafterId === me);
      }
      if (doneFilter === 'approved') {
        return list.filter((d: ApprovalDoc) => d.steps.some((s) => s.approverId === me && s.decision === '승인'));
      }
      return list;
    }
    if (box === '상신') {
      if (draftFilter === 'progress') {
        return list.filter((d: ApprovalDoc) => d.status === '진행중');
      }
      if (draftFilter === 'completed') {
        return list.filter((d: ApprovalDoc) => d.status === '완료' || d.status === '시행대기');
      }
      if (draftFilter === 'rejected') {
        return list.filter((d: ApprovalDoc) => d.status === '반려' || d.status === '긴급 조치 사후 검토 반려' || d.status === '시행반송');
      }
      return list;
    }
    if (box === '반려') {
      const preds = getPredecessorsOf(me);
      const isMyReject = (d: ApprovalDoc) =>
        d.steps.some(
          (s) =>
            (s.approverId === me || s.delegatedFromId === me || preds.includes(s.approverId)) &&
            s.decision === '반려'
        );
      if (rejectFilter === 'rejected') {
        return list.filter(isMyReject);
      }
      if (rejectFilter === 'chain') {
        return list.filter((d: ApprovalDoc) => !isMyReject(d));
      }
      return list;
    }
    if (box === '대기') {
      const preds = getPredecessorsOf(me);
      if (todoFilter === 'pending') {
        return list.filter((d: ApprovalDoc) => {
          const approvers = currentApproverIds(d);
          return approvers.includes(me) || approvers.some(id => preds.includes(id));
        });
      }
      if (todoFilter === 'progress') {
        return list.filter((d: ApprovalDoc) => {
          const approvers = currentApproverIds(d);
          return !approvers.includes(me) && !approvers.some(id => preds.includes(id));
        });
      }
      return list;
    }
    return list;
  }, [box, list, allDocs, doneFilter, todoFilter, rejectFilter, me, userObj?.dept, org, draftFilter]);

  // 선택된 selId를 기반으로 현재 열람할 문서를 결정 (단일 진실 원천)
  const selDoc = useMemo(() => {
    if (selId) {
      const match = filteredList.find((d) => d.id === selId || d.docNo === selId) || allDocs.find((d) => d.id === selId || d.docNo === selId);
      if (match) return match;
    }
    return filteredList[0] ?? null;
  }, [selId, filteredList, allDocs]);

  // 함이나 필터가 바뀌면 다중 선택 초기화
  useEffect(() => {
    setSelectedIds([]);
  }, [box, doneFilter, todoFilter, rejectFilter, draftFilter]);

  // 딥링크(?box=BOX&doc=ID) → 결재함 및 문서 동기화
  useEffect(() => {
    const docId = params.get('doc');
    const urlBox = params.get('box') as ApprovalBox | '문서함' | null;

    // 1. URL에 box만 변경된 경우
    if (!docId) {
      if (urlBox && urlBox !== box) {
        setBox(urlBox);
      }
      return;
    }

    if (allDocs.length === 0) return;

    const targetDoc = allDocs.find((d) => d.id === docId || d.docNo === docId);
    if (!targetDoc) return;

    if (selId !== targetDoc.id) {
      setSelId(targetDoc.id);
    }

    // 2. 최적 결재함 자동 판정 (urlBox가 없거나 해당 함에 targetDoc이 없을 때)
    let determinedBox: ApprovalBox | '문서함' = urlBox || '문서함';
    if (!urlBox) {
      if (targetDoc.status === '완료' || targetDoc.status === '시행대기') {
        if (isCompletedBoxMatch(targetDoc, me)) {
          determinedBox = '완료';
          setDoneFilter('all');
        } else if (isDrafterBoxMatch(targetDoc, me)) {
          determinedBox = '상신';
          setDraftFilter('completed');
        } else {
          determinedBox = '문서함';
        }
      } else if (targetDoc.status === '반려' || targetDoc.status === '긴급 조치 사후 검토 반려' || targetDoc.status === '시행반송') {
        if (isRejectedBoxMatch(targetDoc, me)) {
          determinedBox = '반려';
          setRejectFilter('all');
        } else if (isDrafterBoxMatch(targetDoc, me)) {
          determinedBox = '상신';
          setDraftFilter('rejected');
        } else {
          determinedBox = '문서함';
        }
      } else if (targetDoc.status === '임시저장') {
        determinedBox = '임시';
      } else if (isTodoBoxMatch(targetDoc, me)) {
        determinedBox = '대기';
        setTodoFilter('all');
      } else if (isDrafterBoxMatch(targetDoc, me)) {
        determinedBox = '상신';
        setDraftFilter(targetDoc.status === '진행중' ? 'progress' : 'all');
      } else if (isReceivedBoxMatch(targetDoc, me, userObj?.dept)) {
        determinedBox = '수신';
      } else {
        determinedBox = '문서함';
      }
    }

    if (box !== determinedBox) {
      setBox(determinedBox);
    }
  }, [params, allDocs, me, userObj?.dept]);

  // 함 전환/목록/필터 변화 시 선택 보정(문서가 allDocs에서 완전히 사라진 경우에만 첫 항목으로 보정).
  useEffect(() => {
    if (filteredList.length === 0) {
      if (selId !== null && allDocs.length > 0 && !allDocs.some((d) => d.id === selId || d.docNo === selId)) {
        setSelId(null);
      }
    } else {
      if (!selId) {
        setSelId(filteredList[0].id);
      } else {
        const existsInFiltered = filteredList.some((d: ApprovalDoc) => d.id === selId || d.docNo === selId);
        if (!existsInFiltered) {
          // allDocs에도 전혀 존재하지 않을 때만 첫 번째 항목으로 보정
          const existsInAll = allDocs.some((d: ApprovalDoc) => d.id === selId || d.docNo === selId);
          if (!existsInAll && allDocs.length > 0) {
            setSelId(filteredList[0].id);
          }
        }
      }
    }

    setSelectedIds((prev) => {
      const next = prev.filter((id) => filteredList.some((d: ApprovalDoc) => d.id === id));
      if (JSON.stringify(prev) === JSON.stringify(next)) return prev; // 참조 비교 우회 방어
      return next;
    });
  }, [filteredList, selId, allDocs]);


  const isDocSelectable = (d: ApprovalDoc) => {
    if (box === '삭제') return true;
    if (box === '대기') {
      if (todoFilter === 'progress') return false;
      const approvers = currentApproverIds(d);
      return approvers.includes(me) || approvers.some(id => preds.includes(id));
    }
    return false;
  };

  // 다중 선택 처리 헬퍼
  const selectableList = useMemo(() => filteredList.filter(isDocSelectable), [filteredList, box, todoFilter]);
  const isAllSelected = selectableList.length > 0 && selectedIds.length === selectableList.length;
  const toggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedIds([]);
    } else {
      setSelectedIds(selectableList.map((d: ApprovalDoc) => d.id));
    }
  };


  const toggleSelectOne = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  // 일괄 승인 실행
  const handleBatchApprove = async () => {
    if (selectedIds.length === 0) return;
    try {
      await batchDecide.mutateAsync({
        docIds: selectedIds,
        userId: me,
        comment: batchComment.trim() || '일괄 승인 처리되었습니다.',
      });
      setShowBatchApproveConfirm(false);
      setBatchComment('');
      setSelectedIds([]);
    } catch (err: any) {
      alert(`일괄 승인 중 오류가 발생했습니다: ${err.message || String(err)}`);
    }
  };

  // 일괄 복원 실행
  const handleBatchRestore = async () => {
    if (selectedIds.length === 0) return;
    if (confirm(`선택한 ${selectedIds.length}건의 문서를 휴지통에서 복원하시겠습니까?`)) {
      try {
        await batchRestore.mutateAsync(selectedIds);
        setSelectedIds([]);
      } catch (err: any) {
        alert(`일괄 복원 중 오류가 발생했습니다: ${err.message || String(err)}`);
      }
    }
  };

  // 일괄 영구 삭제 실행
  const handleBatchPermanentDelete = async () => {
    if (selectedIds.length === 0) return;
    if (confirm(`[경고] 선택한 ${selectedIds.length}건의 문서를 영구 삭제하시겠습니까?\n이 작업은 복구할 수 없습니다.`)) {
      try {
        await batchPermanentDelete.mutateAsync(selectedIds);
        setSelectedIds([]);
      } catch (err: any) {
        alert(`일괄 삭제 중 오류가 발생했습니다: ${err.message || String(err)}`);
      }
    }
  };

  if (!user) return <div className="p-10 text-center text-[13px] text-ink3">로그인이 필요합니다.</div>;

  return (
    <div className={`w-full px-6 pt-2 pb-6 ${isListCollapsed ? 'min-w-[920px]' : 'min-w-[1240px]'}`}>
      <div className="flex gap-4 items-start w-full">
        {/* 좌: 함 탭 (사이드바 - 상단 밀착형) */}
        <div className="w-[160px] rounded-xl border border-border bg-panel p-2 flex flex-col gap-1.5 self-start shadow-sm shrink-0 sticky top-[8px] z-10">

          <button
            onClick={() => setShowFormSelectModal(true)}
            className="w-full rounded-lg bg-teal py-2 text-[12.5px] font-bold text-white hover:opacity-90 transition-all flex items-center justify-center gap-1 shadow-sm mb-0.5 cursor-pointer"
          >
            + 새 상신
          </button>

          {/* 임시 저장함 단독 버튼 (새 상신 바로 밑 배치) */}
          <button
            onClick={() => handleSelectBox('임시')}
            className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-[12.5px] transition-colors mb-1 ${box === '임시' ? 'bg-teal-soft font-bold text-teal' : 'text-ink2 hover:bg-panel-alt'
              }`}
          >
            <span className="flex items-center gap-1.5">
              <span>임시 저장함</span>
            </span>
            {(byBox['임시'] ?? []).length > 0 && (
              <span className={`grid h-[18px] min-w-[18px] place-items-center rounded-full px-1.5 text-[10px] font-bold ${box === '임시' ? 'bg-teal text-white' : 'bg-ink3/15 text-ink2'
                }`}>
                {(byBox['임시'] ?? []).length}
              </span>
            )}
          </button>

          {[
            {
              title: '개인 문서함',
              boxes: [
                { key: '상신', label: '상신함' },
                { key: '참조', label: '참조함' },
              ] as const,
              titleBg: 'bg-blue-50/50 text-[#1e3a8a] border-l-2 border-[#1890ff] pl-2 font-extrabold dark:bg-blue-950/20 dark:text-blue-300',
            },
            {
              title: '결재함',
              boxes: [
                { key: '대기', label: '결재 대기함' },
                { key: '반려', label: '반려함' },
                { key: '후열', label: '후열함' },
              ] as const,
              titleBg: 'bg-blue-50/50 text-[#1e3a8a] border-l-2 border-[#1890ff] pl-2 font-extrabold dark:bg-blue-950/20 dark:text-blue-300',
            },
            {
              title: '공유 문서함',
              boxes: [
                { key: '수신', label: '수신함' },
                { key: '문서함', label: '부서 문서함' },
              ] as const,
              titleBg: 'bg-blue-50/50 text-[#1e3a8a] border-l-2 border-[#1890ff] pl-2 font-extrabold dark:bg-blue-950/20 dark:text-blue-300',
            },
            {
              title: '관리',
              boxes: [
                { key: '완료', label: '완료함' },
                { key: '삭제', label: '휴지통' },
              ] as const,
              titleBg: 'bg-blue-50/50 text-[#1e3a8a] border-l-2 border-[#1890ff] pl-2 font-extrabold dark:bg-blue-950/20 dark:text-blue-300',
            },
          ].map((g) => (
            <div key={g.title} className="flex flex-col gap-1.5">
              <div className={`px-2.5 py-1 rounded-md text-[10px] font-extrabold tracking-wider uppercase ${g.titleBg}`}>
                {g.title}
              </div>
              <div className="space-y-0.5">
                {g.boxes.map((bInfo) => {
                  const b = bInfo.key;
                  const label = bInfo.label;

                  const unconfirmedPostReadCount = (byBox['후열'] ?? []).filter(
                    (d) => d.steps.some((s) => s.delegatedFromId === me && !s.postReadAt) || myUnreadPostReadIds.has(d.id)
                  ).length;

                  // 배지 개수 산출
                  let badgeCount = 0;
                  if (b === '문서함') {
                    const myDeptName = userObj?.dept ?? '';
                    const myDeptObj = org.depts.find((d) => d.name === myDeptName);
                    const myDeptId = myDeptObj?.id ?? '';
                    const deptDocsCount = allDocs.filter((d) => {
                      const vis = d.visibility ?? '부서';
                      if (vis === '비공개') return false;

                      const drafterUser = org.userById(d.drafterId);
                      const drafterCurrentDeptName = drafterUser?.dept ?? '';
                      const drafterCurrentDeptObj = org.depts.find((dept) => dept.name === drafterCurrentDeptName);
                      const drafterCurrentDeptId = drafterCurrentDeptObj?.id ?? '';
                      const docDeptId = d.drafterDeptId || drafterCurrentDeptId;

                      return docDeptId === myDeptId || (!docDeptId && d.drafterDept === myDeptName);
                    }).length;
                    badgeCount = deptDocsCount;
                  } else {
                    const myDeptObj = org.depts.find((d) => d.name === userObj?.dept);
                    const myDeptNameOrId = userObj ? (myDeptObj ? `${userObj.dept}||${myDeptObj.id}` : userObj.dept) : '';
                    let combined = allDocs.filter((d) => matchesBox(d, me, b as ApprovalBox, myDeptNameOrId, undefined, postReadIdsOf(me)));

                    preds.forEach((predId) => {
                      const predUser = org.userById(predId) || users.find((u) => u.id === predId);
                      if (!predUser) return;
                      const predDeptObj = org.depts.find((d) => d.name === predUser.dept);
                      const predDeptNameOrId = predDeptObj ? `${predUser.dept}||${predDeptObj.id}` : predUser.dept;
                      const predDocs = allDocs.filter((d) => matchesBox(d, predId, b as ApprovalBox, predDeptNameOrId, undefined, postReadIdsOf(predId)));
                      combined = [...combined, ...predDocs];
                    });

                    const uniqueIds = new Set(combined.map((d) => d.id));
                    if (b === '상신') {
                      badgeCount = Array.from(uniqueIds)
                        .map(id => combined.find(d => d.id === id)!)
                        .filter((d) => d.status === '반려' || d.status === '긴급 조치 사후 검토 반려' || d.status === '시행반송')
                        .length;
                    } else if (b === '반려') {
                      badgeCount = Array.from(uniqueIds)
                        .map(id => combined.find(d => d.id === id)!)
                        .filter((d) => !readRejectedIds.has(d.id))
                        .length;
                    } else if (b === '대기') {
                      badgeCount = activePendingCount;
                    } else {
                      badgeCount = uniqueIds.size;
                    }
                  }


                  const hasBadge = badgeCount > 0;

                  const badgeClass = b === '대기'
                    ? (activePendingCount > 0
                      ? 'bg-red-500 text-white animate-pulse'
                      : 'bg-ink3/15 text-ink2')
                    : b === '상신'
                      ? (badgeCount > 0
                        ? 'bg-red-500 text-white animate-pulse'
                        : 'bg-ink3/15 text-ink2')
                      : b === '반려'
                        ? (badgeCount > 0
                          ? 'bg-rose-500 text-white animate-pulse'
                          : 'bg-ink3/15 text-ink2')
                        : b === '후열'
                          ? (unconfirmedPostReadCount > 0
                            ? 'bg-amber-500 text-white animate-pulse'
                            : 'bg-ink3/15 text-ink2')
                          : (box === b ? 'bg-teal text-white' : 'bg-ink3/15 text-ink2');

                  return (
                    <button
                      key={b}
                      onClick={() => handleSelectBox(b)}
                      className={`flex w-full items-center justify-between rounded-lg pl-5 pr-2.5 py-1.5 text-[12.5px] transition-colors ${box === b ? 'bg-teal-soft font-bold text-teal' : 'text-ink2 hover:bg-panel-alt'}`}
                    >

                      <span className="flex items-center gap-1.5">
                        <span>{label}</span>
                      </span>
                      {hasBadge && b !== '문서함' && (
                        <span className={`grid h-[18px] min-w-[18px] place-items-center rounded-full px-1.5 text-[10px] font-bold ${badgeClass}`}>
                          {badgeCount}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* 우측 영역: 타이틀 바 + (목록 & 상세) */}
        <div className="flex-1 flex flex-col gap-3">
          {/* 상단 고정 통합 타이틀 바 ( GwHead 잘림 제거 대안 ) */}
          <div className="flex items-center justify-between gap-4 border-b border-border pb-2.5">
            <div className="flex items-center gap-2 shrink-0">
              <PenLine size={20} className="text-teal" />
              <h1 className="text-[20px] font-extrabold tracking-tight text-ink">전자결재</h1>
            </div>

            {/* ── 상단 문서 검색 인풋 & 결과 드롭다운 (가로 너비 유동적 100% 활용) ── */}
            <div ref={searchContainerRef} className="relative flex-1 min-w-0">
              <div className="relative w-full">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setIsSearchOpen(true);
                  }}
                  onFocus={() => setIsSearchOpen(true)}
                  placeholder="결재 문서명, 문서번호, 기안자 검색..."
                  className="w-full rounded-lg border border-border bg-panel-alt/50 hover:bg-panel pl-8.5 pr-8 py-1.5 text-[12px] text-ink placeholder:text-ink3 outline-none focus:border-teal focus:bg-panel focus:ring-1 focus:ring-teal/30 transition-all shadow-2xs"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      setIsSearchOpen(false);
                    }}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink3 hover:text-ink p-0.5 rounded cursor-pointer"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>

              {/* 검색 결과 드롭다운 */}
              {isSearchOpen && (
                <div className="absolute left-0 right-0 top-full mt-1.5 z-50 max-h-[400px] overflow-y-auto rounded-xl border border-border bg-panel shadow-2xl p-1.5 space-y-1 backdrop-blur-md animate-fadeIn">
                  {/* 드롭다운 내부 상단 문서함 필터 탭 칩 */}
                  <div className="flex items-center justify-between gap-1 overflow-x-auto px-2 py-1.5 border-b border-border/60 bg-panel-alt/30 rounded-t-lg">
                    <div className="flex items-center gap-1 overflow-x-auto min-w-0 flex-1">
                      <span className="text-[10.5px] font-bold text-ink3 shrink-0 mr-1">문서함 필터:</span>
                      {[
                        { k: 'all', l: '전체' },
                        { k: '대기', l: '결재대기' },
                        { k: '상신', l: '기안/상신' },
                        { k: '완료', l: '결재완료' },
                        { k: '반려', l: '반려' },
                        { k: '참조', l: '참조' },
                        { k: '수신', l: '수신' },
                        { k: '부서', l: '부서' },
                        { k: '임시', l: '임시저장' },
                      ].map((tab) => (
                        <button
                          key={tab.k}
                          type="button"
                          onClick={() => setSearchBoxFilter(tab.k as any)}
                          className={`rounded-md px-2 py-0.5 text-[10px] font-bold transition-all shrink-0 cursor-pointer ${
                            searchBoxFilter === tab.k
                              ? 'bg-teal text-white shadow-2xs'
                              : 'bg-panel border border-border text-ink3 hover:text-ink hover:border-teal/40'
                          }`}
                        >
                          {tab.l}
                        </button>
                      ))}
                    </div>
                    <span className="text-[9.5px] text-ink3 shrink-0 ml-2">ESC 닫기</span>
                  </div>

                  <div className="px-2 py-0.5 text-[10px] font-bold text-ink3 flex items-center justify-between">
                    <span>
                      {searchBoxFilter !== 'all' ? `[${searchBoxFilter}함] ` : ''}
                      {searchQuery.trim() ? `검색 결과 (${searchResults.length}건)` : '최근 문서'}
                    </span>
                    <span className="text-[9.5px] text-ink3">결과를 클릭하면 해당 문서로 이동합니다</span>
                  </div>

                  {searchResults.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => handleSelectSearchedDoc(d)}
                      className={`flex w-full items-start gap-2.5 rounded-lg p-2 text-left transition-colors cursor-pointer hover:bg-teal-soft/40 ${
                        selId === d.id ? 'bg-teal-soft/60 border border-teal/20' : ''
                      }`}
                    >
                      <div className="pt-0.5 shrink-0">
                        <DocTypeIcon type={d.docType} size={15} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <DocStatusBadge doc={d} me={me} />
                          <span className="truncate text-[11.5px] font-bold text-ink hover:text-teal transition-colors">
                            {d.title}
                          </span>
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-ink3 truncate">
                          <span className="font-mono text-ink2">{d.docNo || '임시문서'}</span>
                          <span>·</span>
                          <span>{d.drafterName} ({d.drafterDept || d.docType})</span>
                          <span>·</span>
                          <span>{d.createdAt ? d.createdAt.slice(0, 10) : ''}</span>
                        </div>
                      </div>
                    </button>
                  ))}

                  {searchResults.length === 0 && (
                    <div className="py-6 text-center text-[11.5px] text-ink3">
                      선택된 문서함에 검색 조건과 일치하는 결재 문서가 없습니다.
                    </div>
                  )}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => setIsListCollapsed(!isListCollapsed)}
              className="rounded-lg border border-teal/30 bg-white dark:bg-panel px-3 py-1.5 text-[11.5px] font-extrabold text-teal hover:border-teal hover:bg-teal-soft/20 transition-all shadow-2xs hover:scale-[1.01] active:scale-[0.99] flex items-center gap-1.5 cursor-pointer shrink-0"
            >
              <span>{isListCollapsed ? '▶' : '◀'}</span>
              <span>{isListCollapsed ? '목록 펼치기' : '목록 접기'}</span>
            </button>
          </div>

          <div className="flex items-start gap-4">
            {/* 중: 목록 (목록 접기 시 hidden 처리) */}
            {!isListCollapsed && (
              <div className="overflow-hidden rounded-xl border border-border bg-panel flex flex-col w-[320px] shrink-0 min-w-0 shadow-sm self-start animate-fadeIn sticky top-[8px]">
                {/* 목록 헤더 */}

                <div className="border-b border-border px-3.5 py-2.5 flex items-center justify-between text-[12px] font-bold text-ink2 bg-panel-alt/30">
                  <div className="flex items-center gap-2">
                    {((box === '대기' && todoFilter !== 'progress') || box === '삭제') && selectedIds.length > 0 && (
                      <input
                        type="checkbox"
                        checked={isAllSelected}
                        onChange={toggleSelectAll}
                        className="rounded border-border text-teal focus:ring-teal cursor-pointer h-3.5 w-3.5 animate-fadeIn"
                        title="전체 선택/해제"
                      />
                    )}
                    <span>
                      {box === '문서함' ? '문서함' : BOX_LABEL[box as ApprovalBox]}
                      <span className="text-ink3">· {filteredList.length}</span>
                    </span>


                  </div>
                </div>

                {box === '상신' && (
                  <div className="flex border-b border-border bg-panel-alt/50 p-1.5 gap-1.5">
                    {(() => {
                      const rejectedDraftCount = (byBox['상신'] ?? []).filter(
                        (d) => d.status === '반려' || d.status === '긴급 조치 사후 검토 반려' || d.status === '시행반송'
                      ).length;

                      return (['all', 'progress', 'rejected', 'completed'] as const).map((f) => {
                        const label = f === 'all' ? '전체' : f === 'progress' ? '진행중' : f === 'rejected' ? '반려' : '완료';
                        const active = draftFilter === f;
                        return (
                          <button
                            key={f}
                            onClick={() => setDraftFilter(f)}
                            className={`flex-1 rounded-lg py-1.5 text-[10.5px] font-bold transition-all flex items-center justify-center gap-1 ${active
                              ? 'bg-blue-600 text-white shadow-sm'
                              : 'text-ink3 hover:bg-panel-alt hover:text-ink2'
                              }`}
                          >
                            <span>{label}</span>
                            {f === 'rejected' && rejectedDraftCount > 0 && (
                              <span
                                className={`rounded-full px-1.5 py-0.2 text-[9px] font-extrabold ${
                                  active ? 'bg-white text-red-600' : 'bg-red-500 text-white'
                                }`}
                              >
                                {rejectedDraftCount}
                              </span>
                            )}
                          </button>
                        );
                      });
                    })()}
                  </div>
                )}

                {box === '대기' && (
                  <div className="flex border-b border-border bg-panel-alt/50 p-1.5 gap-1.5">
                    {(['pending', 'progress', 'all'] as const).map((f) => {
                      const label = f === 'pending' ? '결재대기중' : f === 'progress' ? '진행중' : '전체';
                      const active = todoFilter === f;
                      return (
                        <button
                          key={f}
                          onClick={() => setTodoFilter(f)}
                          className={`flex-1 rounded-lg py-1.5 text-[10.5px] font-bold transition-all flex items-center justify-center gap-1 ${active
                            ? 'bg-teal text-white shadow-sm'
                            : 'text-ink3 hover:bg-panel-alt hover:text-ink2'
                            }`}
                        >
                          <span>{label}</span>
                          {f === 'pending' && activePendingCount > 0 && (
                            <span
                              className={`rounded-full px-1.5 py-0.2 text-[9px] font-extrabold ${
                                active ? 'bg-white text-teal' : 'bg-red-500 text-white'
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

                {box === '완료' && (
                  <div className="flex border-b border-border bg-panel-alt/50 p-1.5 gap-1.5">
                    {(['all', 'draft', 'approved'] as const).map((f) => {
                      const label = f === 'all' ? '전체' : f === 'draft' ? '기안한 문서' : '결재한 문서';
                      return (
                        <button
                          key={f}
                          onClick={() => setDoneFilter(f)}
                          className={`flex-1 rounded-lg py-1.5 text-[10.5px] font-bold transition-all ${doneFilter === f
                            ? 'bg-teal text-white shadow-sm'
                            : 'text-ink3 hover:bg-panel-alt hover:text-ink2'
                            }`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                )}
                {box === '반려' && (
                  <div className="flex border-b border-border bg-panel-alt/50 p-1.5 gap-1.5">
                    {(['all', 'rejected', 'chain'] as const).map((f) => {
                      const label = f === 'all' ? '전체' : f === 'rejected' ? '내가 직접 반려' : '결재참여 반려';
                      return (
                        <button
                          key={f}
                          onClick={() => setRejectFilter(f)}
                          className={`flex-1 rounded-lg py-1.5 text-[10.5px] font-bold transition-all ${rejectFilter === f
                            ? 'bg-rose-500 text-white shadow-sm'
                            : 'text-ink3 hover:bg-panel-alt hover:text-ink2'
                            }`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                )}




                {/* 목록 데이터 영역 */}
                <div>
                  {isLoading && <div className="py-10 text-center text-[12px] text-ink3">불러오는 중…</div>}
                  {!isLoading && filteredList.length === 0 && <div className="py-14 text-center text-[12px] text-ink3">문서가 없습니다.</div>}
                  {filteredList.map((d: ApprovalDoc) => {
                    const isRecentCompleted = d.status === '완료' && d.completedAt && (Date.now() - new Date(d.completedAt).getTime() < 24 * 60 * 60 * 1000);
                    const isChecked = selectedIds.includes(d.id);

                    const isActive = selDoc?.id === d.id || selDoc?.docNo === d.docNo;
                    return (
                      <button
                        key={d.id}
                        onClick={() => handleSelectDoc(d)}
                        className={`relative flex w-full items-start gap-2 border-b border-border px-3.5 py-3 text-left transition-all ${isActive
                          ? 'bg-teal-soft/50 border-l-4 border-l-teal shadow-2xs font-semibold'
                          : isRecentCompleted
                            ? 'bg-teal-soft/10 border-l-4 border-l-teal/30 hover:bg-teal-soft/20'
                            : 'hover:bg-panel-alt border-l-4 border-l-transparent'
                          }`}

                      >
                        {isDocSelectable(d) && (
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => { }}
                            onClick={(e) => toggleSelectOne(d.id, e)}
                            className="mt-1 rounded border-border text-teal focus:ring-teal cursor-pointer h-3.5 w-3.5 shrink-0"
                          />
                        )}
                        <div className="flex flex-col gap-1 min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <DocTypeIcon type={d.docType} size={14} className="text-ink3 shrink-0" />
                            <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-ink">{d.title}</span>
                            {isRecentCompleted && (
                              <span className="flex items-center gap-1 bg-teal/10 text-teal text-[9px] px-1.5 py-0.5 rounded-full font-bold animate-pulse">
                                <span className="h-1.5 w-1.5 rounded-full bg-teal"></span>
                                최근 완료
                              </span>
                            )}
                            {box === '반려' && !readRejectedIds.has(d.id) && (
                              <span className="flex items-center gap-1 bg-rose-500/10 text-rose-600 text-[9.5px] px-1.5 py-0.5 rounded-full font-bold shrink-0">
                                <span className="h-1.5 w-1.5 rounded-full bg-rose-500 animate-pulse"></span>
                                미열람
                              </span>
                            )}
                            <DocStatusBadge doc={d} me={me} />
                          </div>
                          <div className="flex items-center justify-between text-[10.5px] text-ink3">
                            <span className="truncate">{d.docNo} · {org_nameFallback(d)}</span>
                            <span>{fmtDateTime(d.submittedAt ?? d.createdAt)}</span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* 목록 하단 풋터 액션 바 (선택 항목 존재 시 목록 바로 아래에 조밀하게 표시) */}
                {((box === '대기' && todoFilter !== 'progress') || box === '삭제') && selectedIds.length > 0 && (
                  <div className="border-t border-border bg-panel-alt/60 p-2.5 flex items-center justify-between animate-fadeIn">
                    <span className="text-[11px] font-extrabold text-teal bg-teal/10 border border-teal/20 px-2 py-0.5 rounded-md">
                      {selectedIds.length}개 선택됨
                    </span>

                    {box === '대기' && (
                      <button
                        onClick={() => setShowBatchApproveConfirm(true)}
                        className="group relative inline-flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-teal to-emerald-600 text-white rounded-lg text-[11.5px] font-bold shadow-sm shadow-teal/20 hover:shadow-md hover:shadow-teal/30 hover:scale-[1.02] active:scale-[0.98] transition-all duration-150"
                      >
                        <svg className="w-3.5 h-3.5 stroke-[2.5]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                        <span>일괄 승인</span>
                      </button>
                    )}

                    {box === '삭제' && (
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={handleBatchRestore}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-emerald-500 to-teal text-white rounded-lg text-[11.5px] font-bold shadow-sm shadow-emerald-500/20 hover:shadow-md hover:shadow-emerald-500/30 hover:scale-[1.02] active:scale-[0.98] transition-all duration-150"
                        >
                          <svg className="w-3.5 h-3.5 stroke-[2.5]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                          <span>일괄 복원</span>
                        </button>
                        <button
                          onClick={handleBatchPermanentDelete}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-rose-500/10 hover:bg-rose-500 text-rose-600 hover:text-white border border-rose-500/20 hover:border-rose-500 rounded-lg text-[11.5px] font-bold shadow-xs hover:shadow-sm hover:scale-[1.02] active:scale-[0.98] transition-all duration-150"
                        >
                          <svg className="w-3.5 h-3.5 stroke-[2]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                          <span>영구 삭제</span>
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* 우: 상세 */}
            <div className="rounded-xl border border-border bg-panel flex-1 min-w-[680px] shadow-sm">
              {selDoc ? (
                <DocDetail
                  key={selDoc.id}
                  doc={selDoc}
                  me={me}
                  users={users}
                  onEdit={(d) => navigate(`/gw/approval/edit/${d.id}`)}
                  onSelectDocId={handleSelectDocById}
                />

              ) : (
                <div className="grid h-full place-items-center py-20 text-[12px] text-ink3">문서를 선택하세요.</div>
              )}
            </div>
          </div>
        </div>
      </div>





      {/* 일괄 승인 경고 및 의견 입력 모달 */}
      {showBatchApproveConfirm && (
        <ApprovalOpinionModal
          title="일괄 결재 승인 확인"
          description={
            <div className="space-y-1 text-amber-700 dark:text-amber-300 font-semibold">
              <p>선택하신 <span className="font-extrabold underline">{selectedIds.length}건</span>의 결재 문서를 일괄 승인하시겠습니까?</p>
              <p className="text-[11.5px] font-normal text-amber-600 dark:text-amber-400">
                ※ 일괄 승인 처리 후에는 결재를 취소하거나 이전 상태로 되돌릴 수 없습니다.
              </p>
            </div>
          }
          confirmText="일괄 승인 확정"
          confirmTone="bg-teal"
          busy={batchDecide.isPending}
          onConfirm={(comment) => {
            setBatchComment(comment);
            handleBatchApprove();
          }}
          onClose={() => setShowBatchApproveConfirm(false)}
        />
      )}

      {/* 새 상신 양식 선택 모달 */}
      {showFormSelectModal && (
        <DraftFormSelectModal
          open={showFormSelectModal}
          onClose={() => setShowFormSelectModal(false)}
          onSelect={(form) => {
            navigate(`/gw/approval/new?type=${encodeURIComponent(form.code)}`);
          }}
        />
      )}
    </div>
  );
}


/** 목록 보조 표기(기안자명은 상세에서 org 로 해석 — 목록은 부서 비정규화 사용). */
function org_nameFallback(d: ApprovalDoc): string {
  return d.drafterDept || '기안';
}

function DocDetail({
  doc,
  me,
  users,
  onEdit,
  onSelectDocId,
}: {
  doc: ApprovalDoc;
  me: string;
  users: User[];
  onEdit: (d: ApprovalDoc) => void;
  onSelectDocId?: (id: string) => void;
}) {
  const navigate = useNavigate();
  const org = useOrgTree();
  const { isOperator, isAdmin } = usePermission();
  const canForwardPostRead = isOperator || isAdmin;
  const decide = useDecideStep();
  const submitM = useSubmitApproval();
  const recallM = useRecallApproval();
  const deleteM = useDeleteToTrash();
  const restoreM = useRestoreFromTrash();
  const permDeleteM = usePermanentlyDelete();
  const confirmPostReadM = useConfirmPostRead();
  const [reject, setReject] = useState<{ seq: number; comment: string } | null>(null);
  const [showApproveModal, setShowApproveModal] = useState(false);
  const [showRecallModal, setShowRecallModal] = useState(false);
  const [approveComment, setApproveComment] = useState('');
  const [err, setErr] = useState('');

  const nameOf = (id: string) => {
    const u = org.userById(id) || users.find((x) => x.id === id);
    if (!u) return id;
    return u.status === '미사용' ? `${u.name}(퇴사)` : u.name;
  };

  const busy = decide.isPending || submitM.isPending || recallM.isPending || deleteM.isPending || restoreM.isPending || permDeleteM.isPending || confirmPostReadM.isPending;

  const postReadStep = useMemo(() => doc.steps.find((s) => s.delegatedFromId === me), [doc.steps, me]);

  // 내 차례(직접 활성 결재자 또는 대결자)의 seq.
  const [mySeq, setMySeq] = useState<number | null>(null);
  const myStep = useMemo(() => doc.steps.find((s) => s.seq === mySeq), [doc.steps, mySeq]);
  const isMyStepAgreement = myStep?.kind === '합의';

  useEffect(() => {
    let isMounted = true;
    async function resolveMySeq() {
      if (!doc || !me) {
        if (isMounted) setMySeq(null);
        return;
      }
      const acts = activeSteps(doc);
      // 1) 본인이 직접 결재자인 경우
      const direct = acts.find((s) => s.approverId === me && s.kind !== '참조');
      if (direct) {
        if (isMounted) setMySeq(direct.seq);
        return;
      }
      // 2) 본인이 대결자로 지정된 부재자의 결재 단계인 경우 (옵션 ON 상태일 때만)
      const isProxyEnabled = await approvalProcessRepo.isOptionEnabled('proxy_approval');
      if (isProxyEnabled) {
        for (const actStep of acts) {
          if (actStep.kind === '참조') continue;
          const abs = await absenceRepo.get(actStep.approverId);
          if (abs.isAbsent && abs.delegateUserId === me) {
            const now = new Date();
            const startValid = !abs.startDate || now >= new Date(abs.startDate);
            const endValid = !abs.endDate || now <= new Date(abs.endDate);
            if (startValid && endValid) {
              if (isMounted) setMySeq(actStep.seq);
              return;
            }
          }
        }
      }
      if (isMounted) setMySeq(null);
    }
    resolveMySeq();
    return () => {
      isMounted = false;
    };
  }, [doc, me]);
  const iAmDrafter = doc.drafterId === me;
  const canRecall = iAmDrafter && doc.status === '진행중';
  const approvedApprovers = useMemo(() => {
    const seen = new Set<string>();
    const list: { name: string; position: string | null; dept: string | null }[] = [];
    for (const s of doc.steps) {
      if (s.kind !== '참조' && s.decision === '승인') {
        if (!seen.has(s.approverId)) {
          seen.add(s.approverId);
          const u = users.find((user) => user.id === s.approverId);
          list.push({
            name: s.approverName || u?.name || s.approverId,
            position: s.approverPos || u?.position || null,
            dept: s.approverDept || u?.dept || null,
          });
        }
      }
    }
    return list;
  }, [doc.steps, users]);
  const hasApprovedSteps = approvedApprovers.length > 0;
  const canResubmit = iAmDrafter && (doc.status === '반려' || doc.status === '긴급 조치 사후 검토 반려' || doc.status === '회수' || doc.status === '시행반송');
  const canEditDraft = iAmDrafter && doc.status === '임시저장';
  const isInTrash = iAmDrafter && doc.status === '삭제';

  // 기결재 문서 후열(공람) 전달 모달 상태
  const [showForwardPostReadModal, setShowForwardPostReadModal] = useState(false);
  const [forwardTargetUserId, setForwardTargetUserId] = useState('');
  const [forwardMemo, setForwardMemo] = useState('');
  // 전달 기록은 DB(approvalPostReadShares)에 둔다 — 수신자·다른 PC에서도 같은 이력이 보인다.
  const { data: docShares = [] } = useDocPostReads(doc.id);
  const sharePostReadM = useSharePostRead();
  useAutoMarkPostRead(doc.id, me);

  const handleSendPostRead = async () => {
    if (!canForwardPostRead) {
      alert('후열 전달 기능은 시스템관리자(operator)만 사용할 수 있습니다.');
      return;
    }
    if (!forwardTargetUserId) {
      alert('후열로 전달할 임직원을 선택해주세요.');
      return;
    }
    const targetUser = org.userById(forwardTargetUserId) || users.find((u) => u.id === forwardTargetUserId);
    try {
      const { notified } = await sharePostReadM.mutateAsync({
        doc: { id: doc.id, docNo: doc.docNo, title: doc.title },
        fromUserId: me,
        fromUserName: org.userById(me)?.name || '관리자',
        toUserId: forwardTargetUserId,
        toUserName: targetUser?.name || forwardTargetUserId,
        toUserDept: targetUser?.dept || '',
        memo: forwardMemo,
      });
      alert(
        notified
          ? `${targetUser?.name || '해당 사용자'} 님에게 후열(공람) 문서로 전달되었습니다.`
          : `${targetUser?.name || '해당 사용자'} 님에게 전달은 완료되었으나 알림 발송에 실패했습니다.`,
      );
      setShowForwardPostReadModal(false);
      setForwardTargetUserId('');
      setForwardMemo('');
    } catch (e) {
      // 모달과 입력값을 그대로 두어 다시 시도할 수 있게 한다.
      alert(`후열 전달에 실패했습니다: ${e instanceof Error ? e.message : String(e)}`);
    }
  };


  const run = async (fn: () => Promise<unknown>) => {
    setErr('');
    try { await fn(); } catch (e) { setErr(e instanceof Error ? e.message : '처리 중 오류가 발생했습니다.'); }
  };

  const toTrash = () => {
    if (window.confirm('이 임시저장 문서를 휴지통으로 보내시겠습니까?')) {
      run(() => deleteM.mutateAsync(doc.id));
    }
  };
  const restoreTrash = () => run(() => restoreM.mutateAsync(doc.id));
  const permDelete = () => {
    if (window.confirm('이 문서를 영구 삭제하시겠습니까? 복구할 수 없습니다.')) {
      run(() => permDeleteM.mutateAsync(doc.id));
    }
  };

  const handleConfirmApprove = () => {
    if (mySeq == null) return;
    run(() =>
      decide.mutateAsync({
        id: doc.id,
        seq: mySeq,
        userId: me,
        decision: '승인',
        comment: approveComment.trim() || undefined,
      })
    ).then(() => {
      setShowApproveModal(false);
      setApproveComment('');
    });
  };

  const hold = () => mySeq != null && run(() => decide.mutateAsync({ id: doc.id, seq: mySeq, userId: me, decision: '보류' }));
  const doReject = () => {
    if (!reject) return;
    if (!reject.comment.trim()) { setErr('반려 사유를 입력하세요.'); return; }
    run(() => decide.mutateAsync({ id: doc.id, seq: reject.seq, userId: me, decision: '반려', comment: reject.comment }))
      .then(() => setReject(null));
  };

  const activeIds = currentApproverIds(doc);

  return (
    <div className="flex h-full flex-col min-w-0">
      {/* 상세 헤더 & 미니 결재선 (너비 충분 시 우측 배치, 좁아지면 자연스럽게 아래로 래핑) */}
      <div className="border-b border-border px-4 sm:px-5 py-3 min-w-0">
        <div className="flex flex-wrap lg:flex-nowrap items-center justify-between gap-3 min-w-0">
          {/* 좌측: 문서 기본 정보 */}
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center gap-2">
              <DocStatusBadge doc={doc} me={me} />
              <DocTypeIcon type={doc.docType} size={17} className="text-ink3 shrink-0" />
              <h2 className="text-[16px] font-bold text-ink truncate">{doc.title}</h2>
            </div>
            <div className="text-[11.5px] text-ink3">
              {doc.docNo} · {doc.docType} · 기안 <span className="font-medium text-ink2">{nameOf(doc.drafterId)}</span>({doc.drafterDept}) · {fmtDateTime(doc.submittedAt ?? doc.createdAt)}
            </div>
            {(doc.amount != null || doc.form) && (
              <div className="pt-0.5 flex flex-wrap gap-1.5 text-[11px]">
                {doc.amount != null && <span className="rounded-md bg-panel-alt px-2 py-0.5 font-semibold text-ink2">금액 {won(doc.amount)}</span>}
                {doc.form && (
                  <span className="rounded-md bg-panel-alt px-2 py-0.5 font-semibold text-ink2">
                    {doc.form.leaveType} · {doc.form.startDate}~{doc.form.endDate} · {doc.form.days}일
                  </span>
                )}
              </div>
            )}
          </div>

          {/* 우측: 결재선 플로우차트 (우측 정렬 & 자연스러운 래핑) */}
          <div className="shrink-0 flex items-center justify-end select-none">
            {(() => {
              const approvalSteps = doc.steps.filter((s) => s.kind !== '참조').sort((a, b) => a.seq - b.seq);

              // 병렬 그룹으로 묶기
              const flowGroups: any[] = [];
              approvalSteps.forEach((s) => {
                if (s.parallelGroup) {
                  const existing = flowGroups.find((g) => g.isParallel && g.id === s.parallelGroup);
                  if (existing) {
                    existing.steps.push(s);
                  } else {
                    flowGroups.push({
                      id: s.parallelGroup,
                      isParallel: true,
                      steps: [s],
                    });
                  }
                } else {
                  flowGroups.push({
                    id: 'seq-' + s.seq,
                    isParallel: false,
                    steps: [s],
                  });
                }
              });

              const totalCount = 1 + flowGroups.length; // 기안자 + 결재 단계 수

              // 일반 카드 크기 정의
              let cardWidthClass = 'w-[90px] h-[76px]';
              let nameFontClass = 'text-[11px]';
              let subFontClass = 'text-[9px]';
              let arrowFontClass = 'text-[11px]';
              let gapClass = 'gap-1.5';
              let paddingClass = 'p-2';

              if (totalCount >= 6) {
                cardWidthClass = 'w-[68px] h-[64px]';
                nameFontClass = 'text-[9.5px]';
                subFontClass = 'text-[7.5px]';
                arrowFontClass = 'text-[8.5px]';
                gapClass = 'gap-1';
                paddingClass = 'p-1';
              } else if (totalCount >= 5) {
                cardWidthClass = 'w-[76px] h-[68px]';
                nameFontClass = 'text-[10px]';
                subFontClass = 'text-[8px]';
                arrowFontClass = 'text-[9px]';
                gapClass = 'gap-1';
                paddingClass = 'p-1.5';
              } else if (totalCount >= 4) {
                cardWidthClass = 'w-[82px] h-[72px]';
                nameFontClass = 'text-[10.5px]';
                subFontClass = 'text-[8.5px]';
                arrowFontClass = 'text-[10px]';
                gapClass = 'gap-1';
                paddingClass = 'p-1.5';
              }

              // 병렬 카드 전용 크기 정의
              let parallelCardWidthClass = 'w-[130px] h-[46px]';
              let parallelPaddingClass = 'px-2 py-1.2';
              let parallelNameFontClass = 'text-[11px]';
              let parallelSubFontClass = 'text-[9px]';

              if (totalCount >= 6) {
                parallelCardWidthClass = 'w-[110px] h-[40px]';
                parallelPaddingClass = 'px-1.5 py-1';
                parallelNameFontClass = 'text-[9.5px]';
                parallelSubFontClass = 'text-[7.5px]';
              } else if (totalCount >= 5) {
                parallelCardWidthClass = 'w-[118px] h-[42px]';
                parallelPaddingClass = 'px-2 py-1';
                parallelNameFontClass = 'text-[10px]';
                parallelSubFontClass = 'text-[8px]';
              }

              return (
                <div className={'flex flex-wrap items-center ' + gapClass}>
                  {/* 기안자 카드 */}
                  <div className={cardWidthClass + ' ' + paddingClass + ' shrink-0 flex flex-col justify-between rounded-xl border border-teal/20 bg-teal-soft/10 text-center shadow-xs'}>
                    <div className={subFontClass + ' font-bold text-teal'}>기안</div>
                    <div className="flex flex-col items-center justify-center flex-1 min-w-0">
                      <span className={nameFontClass + ' font-semibold text-ink truncate w-full'}>
                        {doc.drafterName || nameOf(doc.drafterId)}
                      </span>
                      <span className={subFontClass + ' text-ink3 truncate w-full mt-0.5'}>
                        {doc.drafterPos || org.userById(doc.drafterId)?.position || doc.drafterDept}
                      </span>
                    </div>
                    <div className={'rounded bg-teal/15 py-0.2 ' + subFontClass + ' font-bold text-teal'}>상신</div>
                  </div>

                  {/* 결재권자 카드들 */}
                  {flowGroups.map((group) => {
                    return (
                      <Fragment key={group.id}>
                        <span className={'text-ink3 ' + arrowFontClass + ' font-bold shrink-0'} style={{ lineHeight: '1' }}>➔</span>
                        {group.isParallel ? (
                          // 병렬 단계: 슬림 가로형 카드
                          <div className="flex flex-col gap-1 shrink-0">
                            {group.steps.map((s: typeof approvalSteps[number]) => {
                              const isActive = activeIds.includes(s.approverId) && (s.decision === '대기' || s.decision === '보류') && s.kind !== '참조';
                              let statusText: string = s.decision;
                              let statusBg = 'bg-ink3/10 text-ink3';
                              if (s.decision === '승인') {
                                statusText = '승인';
                                statusBg = 'bg-teal-soft text-teal';
                              } else if (s.decision === '반려') {
                                statusText = '반려';
                                statusBg = 'bg-red-500/10 text-red-500';
                              } else if (s.decision === '보류') {
                                statusText = s.kind === '합의' ? '협의요청' : '보류';
                                statusBg = s.kind === '합의' ? 'bg-purple-100 text-purple-800 dark:bg-purple-950/20 dark:text-purple-400 border border-purple-200' : 'bg-amber/10 text-amber';
                              } else if (isActive) {
                                statusText = s.kind === '합의' ? '합의대기' : '결재대기';
                                statusBg = s.kind === '합의' ? 'bg-purple-600 text-white animate-pulse' : 'bg-amber text-white animate-pulse';
                              }

                              return (
                                <div key={s.seq} className={parallelCardWidthClass + ' ' + parallelPaddingClass + ' flex items-center justify-between rounded-xl border shadow-xs transition-all gap-1.5 ' + (isActive ? 'border-teal bg-teal-soft/30 ring-2 ring-teal/30 scale-102' : 'border-border bg-panel')}>
                                  <div className="flex flex-col items-start min-w-0 flex-1">
                                    <span className={parallelNameFontClass + ' font-bold text-ink truncate w-full'}>
                                      {s.approverName || nameOf(s.approverId)}
                                    </span>
                                    <span className={parallelSubFontClass + ' text-ink3 truncate w-full'}>
                                      {s.approverPos || org.userById(s.approverId)?.position || '—'}
                                      {s.delegatedFromId && <span className="ml-1 text-[7.5px] text-amber font-bold">(대결)</span>}
                                    </span>
                                  </div>
                                  <div className="flex flex-col items-end shrink-0 gap-0.5">
                                    <div className="flex items-center gap-1">
                                      <span className="text-[8px] text-ink3 font-medium">Seq{s.seq}</span>
                                      <span className={(KIND_TONE[s.kind] || 'text-ink2') + ' ' + parallelSubFontClass + ' font-bold'}>{s.kind}</span>
                                    </div>
                                    <div className={'rounded px-1 py-0.2 ' + parallelSubFontClass + ' font-bold ' + statusBg}>
                                      {statusText}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          // 단일 순차 단계: 기존 세로 3단 카드 유지
                          (() => {
                            const s = group.steps[0];
                            const isActive = activeIds.includes(s.approverId) && (s.decision === '대기' || s.decision === '보류') && s.kind !== '참조';
                            let statusText: string = s.decision;
                            let statusBg = 'bg-ink3/10 text-ink3';
                            if (s.decision === '승인') {
                              statusText = '승인';
                              statusBg = 'bg-teal-soft text-teal';
                            } else if (s.decision === '반려') {
                              statusText = '반려';
                              statusBg = 'bg-red-500/10 text-red-500';
                            } else if (s.decision === '보류') {
                              statusText = s.kind === '합의' ? '협의요청' : '보류';
                              statusBg = s.kind === '합의' ? 'bg-purple-100 text-purple-800 dark:bg-purple-950/20 dark:text-purple-400 border border-purple-200' : 'bg-amber/10 text-amber';
                            } else if (isActive) {
                              statusText = s.kind === '합의' ? '합의대기' : '결재대기';
                              statusBg = s.kind === '합의' ? 'bg-purple-600 text-white animate-pulse' : 'bg-amber text-white animate-pulse';
                            }

                            return (
                              <div className={cardWidthClass + ' ' + paddingClass + ' shrink-0 flex flex-col justify-between rounded-xl border text-center shadow-xs transition-all ' + (isActive ? 'border-teal bg-teal-soft/30 ring-2 ring-teal/30 scale-102' : 'border-border bg-panel')}>
                                <div className={'flex items-center justify-between ' + subFontClass + ' font-bold'}>
                                  <span className="text-ink3">Seq{s.seq}</span>
                                  <span className={KIND_TONE[s.kind] || 'text-ink2'}>{s.kind}</span>
                                </div>
                                <div className="flex flex-col items-center justify-center flex-1 min-w-0">
                                  <span className={nameFontClass + ' font-semibold text-ink truncate w-full'}>
                                    {s.approverName || nameOf(s.approverId)}
                                  </span>
                                  <span className={subFontClass + ' text-ink3 truncate w-full mt-0.5'}>
                                    {s.approverPos || org.userById(s.approverId)?.position || '—'}
                                  </span>
                                  {s.delegatedFromId && <span className="text-[7.5px] text-amber truncate w-full">대결</span>}
                                </div>
                                <div className={'rounded py-0.2 ' + subFontClass + ' font-bold ' + statusBg}>
                                  {statusText}
                                </div>
                              </div>
                            );
                          })()
                        )}
                      </Fragment>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        </div>
      </div>

      {/* 헤더 아래 본문 영역 */}
      <div className="px-4 sm:px-5 py-4 min-w-0 flex-1">
        {/* 수신/참조자 목록 (슬림 인라인 배치 & 수신/참조 태그 명시) */}
        {(() => {
          const effectiveRecipients = getEffectiveRecipients(doc);
          if (effectiveRecipients.length === 0 && !doc.steps.some((s) => s.kind === '참조')) return null;
          return (
            <div className="mb-2.5 flex items-center gap-2 text-[11px] leading-none">
              <span className="text-ink3 font-semibold shrink-0 select-none flex items-center gap-1">
                <span>└─</span>
                <Share2 size={11} className="text-teal shrink-0" />
                <span>공유처:</span>
              </span>
              <div className="flex flex-wrap items-center gap-1.5">
                {effectiveRecipients.map((r) => {
                  let detailInfo = '';
                  let isRetired = false;
                  if (r.type === 'user') {
                    const u = org.userById(r.id) || users.find((x) => x.id === r.id);
                    if (u) {
                      detailInfo = ` (${u.dept} ${u.position})`;
                      isRetired = u.status === '미사용';
                    }
                  } else if (r.type === 'dept') {
                    detailInfo = ' (부서)';
                  }
                  const label = r.type === 'drafter' ? '[기안자]' : '[수신]';
                  const displayName = isRetired ? `${r.name.replace('(퇴사)', '')}(퇴사)` : r.name;
                  return (
                    <span key={r.id} className="inline-flex items-center gap-1 text-teal font-medium">
                      <span className="text-[9.5px] opacity-75 font-bold">{label}</span>
                      <span className="shrink-0">{r.type === 'dept' ? <Folder size={11} className="text-amber-500 inline" /> : <UserIcon size={11} className="text-teal inline" />}</span>
                      <span>{displayName}{detailInfo}</span>
                    </span>
                  );
                })}
                {doc.steps.filter((s) => s.kind === '참조').map((s) => {
                  const u = org.userById(s.approverId) || users.find((x) => x.id === s.approverId);
                  const isRetired = u?.status === '미사용';
                  const displayName = isRetired ? `${u?.name || s.approverName || s.approverId}(퇴사)` : (s.approverName || nameOf(s.approverId));

                  const pos = s.approverPos || u?.position || '';
                  const dept = s.approverDept || u?.dept || '';
                  const posDept = dept || pos ? ` (${dept} ${pos})` : '';
                  return (
                    <span key={s.approverId} className="inline-flex items-center gap-1 text-teal font-medium">
                      <span className="text-[9.5px] opacity-75 font-bold">[참조]</span>
                      <span>{displayName}{posDept}</span>
                    </span>
                  );
                })}

              </div>
            </div>
          );
        })()}
        {/* 결재 진행 및 결재자 심사의견 / 코멘트 이력 카드 (기안자 및 모든 열람자 확인 가능, 인쇄 시에는 문서에 미표시) */}
        {(() => {
          const stepsWithComments = doc.steps.filter((s) => s.comment && s.comment.trim() && s.decision !== '대기');
          if (stepsWithComments.length === 0) return null;
          return (
            <div className="mb-4 rounded-xl border border-teal/30 bg-teal/5 p-3.5 text-[12px] text-ink animate-fade-in print:hidden">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5 font-bold text-teal">
                  <MessageSquare size={14} className="shrink-0" />
                  <span>결재자 심사의견 / 코멘트 ({stepsWithComments.length}건)</span>
                </div>
                <span className="text-[10.5px] text-ink3 font-medium">결재자가 남긴 처리 의견입니다</span>
              </div>
              <div className="space-y-2">
                {stepsWithComments.map((s, idx) => {
                  const u = org.userById(s.approverId) || users.find((x) => x.id === s.approverId);
                  const approverName = s.approverName || u?.name || s.approverId;
                  const approverPos = s.approverPos || u?.position || '';
                  const approverDept = s.approverDept || u?.dept || '';
                  const isReject = s.decision === '반려';
                  return (
                    <div
                      key={idx}
                      className={`rounded-lg p-2.5 border ${isReject
                          ? 'border-danger/30 bg-danger/5'
                          : 'border-border/60 bg-white dark:bg-zinc-800 shadow-2xs'
                        }`}
                    >
                      <div className="flex items-center justify-between text-[11px] mb-1">
                        <div className="flex items-center gap-1.5 font-bold">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-extrabold ${isReject ? 'bg-danger text-white' : 'bg-teal/15 text-teal'
                              }`}
                          >
                            {s.decision || s.kind}
                          </span>
                          <span className="text-ink">{approverName} {approverPos}</span>
                          {approverDept && <span className="text-ink3 font-normal">({approverDept})</span>}
                        </div>
                        <span className="text-ink3">{s.decidedAt ? fmtDateTime(s.decidedAt) : ''}</span>
                      </div>
                      <div className="text-[11.5px] text-ink leading-relaxed whitespace-pre-wrap pl-2 border-l-2 border-teal/40 ml-1">
                        “{s.comment}”
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* 기결재 문서 후열(공람) 전달 이력 */}
        {docShares.length > 0 && (
          <div className="mb-4 rounded-xl border border-teal/40 bg-teal-soft/20 p-3.5 text-[12px] text-ink animate-fade-in print:hidden">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5 font-bold text-teal">
                <Send size={13} className="shrink-0" />
                <span>후열(공람) 전달 이력 ({docShares.length}건)</span>
              </div>
              <span className="text-[10.5px] text-ink3 font-medium">기결재 완료 후 추가로 전달된 수신자 목록입니다</span>
            </div>
            <div className="space-y-1.5">
              {docShares.map((share) => (
                <div
                  key={share.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-panel p-2.5 border border-border text-[11.5px]"
                >
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-teal-soft px-1.5 py-0.5 text-[10px] font-bold text-teal">
                      후열 수신
                    </span>
                    <span className="font-bold text-ink">{share.toUserName}</span>
                    <span className="text-ink3 font-mono text-[11px]">({share.toUserDept})</span>
                    {share.memo && (
                      <span className="text-ink2 text-[11px] ml-1">
                        — &ldquo;{share.memo}&rdquo;
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-[10.5px] text-ink3">
                    <span>전달자: {share.fromUserName}</span>
                    <span>·</span>
                    <span className="font-mono">{share.sentAt?.slice(0, 16).replace('T', ' ')}</span>
                    <span>·</span>
                    {share.readAt ? (
                      <span className="font-semibold text-teal">확인함 ({share.readAt.slice(0, 16).replace('T', ' ')})</span>
                    ) : (
                      <span className="font-semibold text-amber-600">미확인</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 하단: 결재 문서 */}

        <div className="border-t border-border pt-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-[11.5px] font-bold text-ink2">결재 문서</div>
            {/* 인쇄 버튼을 결재 문서 섹션으로 이동 */}
            <button
              onClick={() => window.print()}
              title="결재 문서 인쇄"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border-hi bg-panel px-2.5 py-1 text-[11px] font-semibold text-ink2 hover:border-teal hover:text-teal transition-all print:hidden"
            >
              <Printer size={13} />
              <span>인쇄</span>
            </button>
          </div>
          <div className="rounded-xl border border-border bg-white dark:bg-zinc-900 shadow-sm p-3 sm:p-4">
            <ApprovalDocumentView doc={doc} currentUser={{ id: me, dept: org.userById(me)?.dept }} />
          </div>
        </div>

        {err && <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-[11.5px] font-semibold text-red-500">{err}</p>}

        {/* 반려 사유 입력 */}
        {reject && (
          <div className="mt-3 rounded-xl border border-red-500/40 bg-red-500/5 p-3">
            <div className="mb-1.5 text-[11.5px] font-bold text-red-500">반려 사유</div>
            <textarea
              value={reject.comment}
              onChange={(e) => setReject({ ...reject, comment: e.target.value })}
              rows={2}
              autoFocus
              placeholder="반려 사유를 입력하세요(필수)"
              className="w-full resize-none rounded-lg border border-border-hi bg-panel px-3 py-2 text-[12px] text-ink outline-none focus:border-red-500"
            />
            <div className="mt-2 flex justify-end gap-2">
              <button onClick={() => setReject(null)} className="rounded-lg px-3 py-1.5 text-[12px] font-semibold text-ink3 hover:bg-panel-alt">취소</button>
              <button onClick={doReject} disabled={busy} className="rounded-lg bg-red-500 px-3.5 py-1.5 text-[12px] font-bold text-white hover:opacity-90 disabled:opacity-50">반려 확정</button>
            </div>
          </div>
        )}
      </div>

      {/* 액션 바 */}
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3">
        {mySeq != null && !reject && (
          <>
            <button onClick={() => setReject({ seq: mySeq, comment: '' })} disabled={busy} className="rounded-lg border border-red-500/50 px-3.5 py-2 text-[12.5px] font-bold text-red-500 hover:bg-red-500/5 disabled:opacity-50">반려</button>
            <button onClick={hold} disabled={busy} className="rounded-lg border border-border-hi px-3.5 py-2 text-[12.5px] font-bold text-ink2 hover:border-ink3 disabled:opacity-50">
              {isMyStepAgreement ? '협의 요청' : '보류'}
            </button>
            <button onClick={() => setShowApproveModal(true)} disabled={busy} className="rounded-lg bg-teal px-4 py-2 text-[12.5px] font-bold text-white hover:opacity-90 disabled:opacity-50">승인</button>
          </>
        )}
        {canRecall && (
          <button
            type="button"
            onClick={() => setShowRecallModal(true)}
            disabled={busy}
            className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3.5 py-2 text-[12.5px] font-bold text-amber-600 dark:text-amber-400 hover:bg-amber-500 hover:text-white transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs disabled:opacity-50"
            title={hasApprovedSteps ? '이미 승인한 결재자가 있는 문서를 사유 입력 후 회수합니다' : '상신한 문서를 회수합니다'}
          >
            <RotateCcw size={14} />
            <span>{hasApprovedSteps ? '결재 회수' : '회수'}</span>
          </button>
        )}
        {canEditDraft && (
          <>
            <button onClick={toTrash} disabled={busy} className="rounded-lg border border-red-500/50 px-3.5 py-2 text-[12.5px] font-bold text-red-500 hover:bg-red-500/5 disabled:opacity-50">삭제</button>
            <button onClick={() => onEdit(doc)} disabled={busy} className="rounded-lg border border-border-hi px-3.5 py-2 text-[12.5px] font-bold text-ink2 hover:border-teal hover:text-teal disabled:opacity-50">편집</button>
            <button onClick={() => run(() => submitM.mutateAsync({ id: doc.id, userId: me }))} disabled={busy} className="rounded-lg bg-teal px-4 py-2 text-[12.5px] font-bold text-white hover:opacity-90 disabled:opacity-50">상신</button>
          </>
        )}
        {isInTrash && (
          <>
            <button onClick={permDelete} disabled={busy} className="rounded-lg border border-red-500/50 px-3.5 py-2 text-[12.5px] font-bold text-red-500 hover:bg-red-500/5 disabled:opacity-50">영구삭제</button>
            <button onClick={restoreTrash} disabled={busy} className="rounded-lg bg-teal px-4 py-2 text-[12.5px] font-bold text-white hover:opacity-90 disabled:opacity-50">복구</button>
          </>
        )}
        {canResubmit && (
          <>
            <button onClick={() => onEdit(doc)} disabled={busy} className="rounded-lg border border-border-hi px-3.5 py-2 text-[12.5px] font-bold text-ink2 hover:border-teal hover:text-teal disabled:opacity-50">편집</button>
            <button onClick={() => run(() => submitM.mutateAsync({ id: doc.id, userId: me }))} disabled={busy} className="rounded-lg bg-teal px-4 py-2 text-[12.5px] font-bold text-white hover:opacity-90 disabled:opacity-50">재상신</button>
          </>
        )}
        {postReadStep && (
          postReadStep.postReadAt ? (
            <span className="rounded-lg bg-teal/15 px-3 py-1.5 text-[12px] font-bold text-teal border border-teal/30 flex items-center gap-1.5">
              <Check size={13} strokeWidth={2.5} />
              <span>후열 확인 완료 ({fmtDateTime(postReadStep.postReadAt)})</span>
            </span>
          ) : (
            <button
              onClick={() => run(() => confirmPostReadM.mutateAsync({ id: doc.id, seq: postReadStep.seq, userId: me }))}
              disabled={busy}
              className="rounded-lg bg-amber-500 text-white px-4 py-2 text-[12.5px] font-bold shadow-sm hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
            >
              <Eye size={14} />
              <span>후열 확인</span>
            </button>
          )
        )}
        {canForwardPostRead && doc.status === '완료' && (
          <button
            type="button"
            onClick={() => setShowForwardPostReadModal(true)}
            className="rounded-lg bg-teal-soft text-teal border border-teal/40 px-3.5 py-2 text-[12.5px] font-bold hover:bg-teal hover:text-white transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
            title="시스템관리자(operator) 전용: 기결재 문서 후열(공람) 전달"
          >
            <Send size={14} />
            <span>후열 전달 (공람)</span>
          </button>
        )}

        {/* 취소 결재 관련 액션 및 상태 인디케이터 */}
        {doc.status === '취소완료' && (
          <span className="rounded-lg bg-rose-500/10 text-rose-600 border border-rose-500/30 px-3.5 py-1.5 text-[12px] font-bold flex items-center gap-1.5 shadow-2xs">
            <span>취소 완료됨</span>
            {doc.cancelledByDocId && (
              <button
                type="button"
                onClick={() => (onSelectDocId ? onSelectDocId(doc.cancelledByDocId!) : navigate(`/gw/approval?doc=${doc.cancelledByDocId}`))}
                className="underline hover:text-rose-700 font-semibold cursor-pointer ml-1"
                title="취소를 승인한 취소 기안 문서 보기"
              >
                (취소결재: {doc.cancelledByDocId})
              </button>
            )}
          </span>
        )}
        {(doc.status === '완료' || doc.status === '시행대기') && doc.cancelDraftId && (
          <span className="rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/30 px-3.5 py-1.5 text-[12px] font-bold flex items-center gap-1.5 shadow-2xs">
            <span>취소 결재 진행중</span>
            <button
              type="button"
              onClick={() => (onSelectDocId ? onSelectDocId(doc.cancelDraftId!) : navigate(`/gw/approval?doc=${doc.cancelDraftId}`))}
              className="underline hover:text-amber-800 dark:hover:text-amber-300 font-semibold cursor-pointer ml-1"
              title="진행 중인 취소 기안 문서 보기"
            >
              (문서 바로가기)
            </button>
          </span>
        )}
        {(doc.status === '완료' || doc.status === '시행대기') && !doc.cancelDraftId && !doc.cancelledAt && doc.drafterId === me && (
          <button
            type="button"
            onClick={() => navigate(`/gw/approval/new?type=취소신청&cancelTargetId=${doc.id}`)}
            className="rounded-lg border border-red-500/50 bg-red-50 text-red-600 dark:bg-red-950/30 dark:border-red-800 dark:text-red-400 px-3.5 py-2 text-[12.5px] font-bold hover:bg-red-500 hover:text-white transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
            title="기결재 완료된 문서의 효력을 취소하기 위한 취소 기안을 작성합니다"
          >
            <RotateCcw size={14} />
            <span>취소 기안 작성</span>
          </button>
        )}

        {mySeq == null && !canRecall && !canEditDraft && !canResubmit && !isInTrash && !postReadStep && doc.status !== '완료' && doc.status !== '취소완료' && (
          <span className="text-[11px] text-ink3">
            {doc.status === '진행중' ? '다른 결재자의 차례입니다.' : ''}
          </span>
        )}
      </div>

      {/* 기결재 문서 후열(공람) 전달 모달 (시스템관리자/operator 전용) */}
      {canForwardPostRead && showForwardPostReadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-3xl border border-border bg-panel p-6 shadow-2xl animate-in zoom-in-95 duration-200"
          >
            <div className="flex items-center justify-between border-b border-border pb-3.5">
              <h2 className="text-base font-extrabold text-ink flex items-center gap-2">
                <Send className="h-4 w-4 text-teal shrink-0" />
                <span>기결재 문서 후열(공람) 전달</span>
                <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10.5px] font-bold text-amber-600 border border-amber-500/20">
                  관리자 전용
                </span>
              </h2>
              <button
                type="button"
                onClick={() => setShowForwardPostReadModal(false)}
                className="rounded-lg p-1 text-ink3 hover:bg-panel-alt hover:text-ink cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-4">
              <div className="rounded-xl bg-panel-alt/50 p-3 border border-border">
                <div className="text-[11px] text-ink3 font-medium">문서 번호 / 제목</div>
                <div className="text-[12.5px] font-bold text-ink mt-0.5">[{doc.docNo}] {doc.title}</div>
              </div>

              <div>
                <label className="block text-[11.5px] font-bold text-ink2 mb-1.5">후열 수신 대상자 *</label>
                <select
                  value={forwardTargetUserId}
                  onChange={(e) => setForwardTargetUserId(e.target.value)}
                  className="h-10 w-full rounded-xl border border-border bg-panel-alt/50 px-3 text-[12px] text-ink outline-none focus:border-teal"
                  autoFocus
                >
                  <option value="">후열(공람)로 전달할 사원을 선택하세요</option>
                  {users
                    .filter((u) => u.status === '사용' && u.id !== me)
                    .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.dept} / {u.position})
                      </option>
                    ))}
                </select>
                {forwardTargetUserId && docShares.some((s) => s.toUserId === forwardTargetUserId && !s.readAt) && (
                  <p className="mt-1.5 text-[11px] font-semibold text-amber-600">이미 전달되어 아직 확인하지 않은 사용자입니다. 다시 전달하면 알림이 한 번 더 갑니다.</p>
                )}
              </div>

              <div>
                <label className="block text-[11.5px] font-bold text-ink2 mb-1.5">전달 메모 (선택)</label>
                <textarea
                  value={forwardMemo}
                  onChange={(e) => setForwardMemo(e.target.value)}
                  placeholder="예: 업무 참조 바랍니다, 기결재 완료본 확인 요망"
                  rows={2}
                  className="w-full rounded-xl border border-border bg-panel-alt/50 p-3 text-[12px] text-ink outline-none focus:border-teal resize-none"
                />
              </div>

              <div className="flex justify-end gap-2 border-t border-border pt-4">
                <button
                  type="button"
                  onClick={() => setShowForwardPostReadModal(false)}
                  className="rounded-xl px-4 py-2 text-[12px] font-bold text-ink2 hover:bg-panel-alt"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={handleSendPostRead}
                  disabled={sharePostReadM.isPending}
                  className="rounded-xl bg-teal px-4 py-2 text-[12px] font-bold text-white shadow-xs hover:opacity-90 disabled:opacity-50"
                >
                  후열 전달하기
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 단일 결재 승인 의견 입력 모달 */}

      {showApproveModal && (
        <ApprovalOpinionModal
          title={isMyStepAgreement ? "합의 승인 확인" : "결재 승인 확인"}
          description={
            <div className="space-y-1 text-teal-800 dark:text-teal-200 font-semibold">
              <p className="font-extrabold text-[13px] text-ink">{doc.title}</p>
              <p className="text-[11.5px] font-normal text-ink2">
                {isMyStepAgreement ? "위 결재 문서를 합의 승인하시겠습니까?" : "위 결재 문서를 승인하시겠습니까?"}
              </p>
            </div>
          }
          confirmText="승인 확정"
          confirmTone="bg-teal"
          busy={decide.isPending}
          onConfirm={(comment) => {
            setApproveComment(comment);
            handleConfirmApprove();
          }}
          onClose={() => setShowApproveModal(false)}
        />
      )}

      {/* 결재 문서 회수 확인/사유 입력 모달 */}
      {showRecallModal && (
        <RecallConfirmModal
          open={showRecallModal}
          docTitle={doc.title}
          approvedApprovers={approvedApprovers}
          busy={busy}
          onConfirm={async (reason) => {
            await run(() => recallM.mutateAsync({ id: doc.id, userId: me, reason }));
            setShowRecallModal(false);
          }}
          onClose={() => setShowRecallModal(false)}
        />
      )}
    </div>
  );
}
