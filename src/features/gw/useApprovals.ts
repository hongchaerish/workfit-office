import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { approvalDocRepo, type ApprovalDraftInput } from '@/data/approvalDoc/approvalDoc.repo';
import { activeSteps, byRecent, matchesBox } from '@/domain/approvalDoc/engine';
import { APPROVAL_BOXES, type ApprovalBox, type ApprovalDoc, type ApprovalStep } from '@/domain/approvalDoc/schema';
import { useUsers } from '@/features/user/useUsers';
import { departmentRepo } from '@/data/department/department.repo';
import { useReceivedPostReads } from '@/features/gw/usePostReadShares';
import { postReadDocIdsFor } from '@/domain/approvalPostRead/engine';

/**
 * 전자결재 데이터 훅 — 화면(UI)이 repository 대신 호출하는 React 바인딩.
 * 전체 문서를 실시간 구독하여 결재함(5탭)·상세를 클라이언트에서 도출하고,
 * 상태 전이는 mutation 으로 처리한다.
 */
const KEY = 'approvalDocs';

/** 전체 결재 문서 조회(실시간 구독형으로 변경해 결재함 자동 갱신). */
export function useAllApprovals() {
  const qc = useQueryClient();
  const [data, setData] = useState<ApprovalDoc[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const unsub = approvalDocRepo.subscribe((list) => {
      setData(list);
      qc.setQueryData([KEY], list);
      setIsLoading(false);
    });
    return unsub;
  }, [qc]);

  return { data, isLoading };
}

export interface ApprovalBoxes {
  byBox: Record<ApprovalBox, ApprovalDoc[]>;
  counts: Record<ApprovalBox, number>;
  isLoading: boolean;
}

/** userId 관점의 결재함 5탭 도출(대기·상신·완료·참조·임시) + 카운트. */
export function useApprovalBoxes(userId: string | undefined): ApprovalBoxes {
  const [depts, setDepts] = useState<any[]>([]);
  useEffect(() => {
    departmentRepo.list().then(setDepts);
  }, []);

  const q = useAllApprovals();
  const { data: users = [] } = useUsers();
  const user = useMemo(() => users.find((u) => u.id === userId), [users, userId]);
  const { data: postReadShares } = useReceivedPostReads(userId ? [userId] : []);
  const postReadDocIds = useMemo(
    () => (userId ? postReadDocIdsFor(postReadShares ?? [], userId) : new Set<string>()),
    [postReadShares, userId],
  );

  const userDeptObj = useMemo(() => depts.find((d) => d.name === user?.dept), [depts, user?.dept]);
  const userDeptNameOrId = useMemo(() => {
    if (!user) return '';
    return userDeptObj ? `${user.dept}||${userDeptObj.id}` : user.dept;
  }, [user, userDeptObj]);

  return useMemo(() => {
    const rows = q.data ?? [];
    const byBox = {} as Record<ApprovalBox, ApprovalDoc[]>;
    const counts = {} as Record<ApprovalBox, number>;
    for (const box of APPROVAL_BOXES) {
      const list = userId ? rows.filter((d) => matchesBox(d, userId, box, userDeptNameOrId, undefined, postReadDocIds)).sort(byRecent) : [];
      byBox[box] = list;
      counts[box] = list.length;
    }
    return { byBox, counts, isLoading: q.isLoading };
  }, [q.data, q.isLoading, userId, userDeptNameOrId, postReadDocIds]);
}

/** 단일 문서 상세(전체 캐시에서 도출 — 목록과 동일 원천으로 낙관적 갱신 즉시 반영). */
export function useApprovalDoc(id: string | null | undefined): ApprovalDoc | null {
  const q = useAllApprovals();
  return useMemo(() => (id ? q.data?.find((d) => d.id === id) ?? null : null), [q.data, id]);
}

/** 임시저장 신규 작성. */
export function useCreateDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ApprovalDraftInput) => approvalDocRepo.createDraft(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

/** 임시저장 편집. */
export function useSaveDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<ApprovalDraftInput> }) =>
      approvalDocRepo.saveDraft(id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

/** 상신/재상신. */
export function useSubmitApproval() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, userId }: { id: string; userId: string }) => approvalDocRepo.submit(id, userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

/** 결재 결정(승인·반려·보류) 통합. */
export function useDecideStep() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      seq,
      userId,
      decision,
      comment = '',
    }: {
      id: string;
      seq: number;
      userId: string;
      decision: '승인' | '반려' | '보류';
      comment?: string;
    }) => {
      if (decision === '승인') return approvalDocRepo.approve(id, seq, userId, comment);
      if (decision === '반려') return approvalDocRepo.reject(id, seq, userId, comment);
      return approvalDocRepo.hold(id, seq, userId, comment);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

/** 회수. */
export function useRecallApproval() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, userId, reason }: { id: string; userId: string; reason?: string }) =>
      approvalDocRepo.recall(id, userId, reason),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

/** 대결(위임 승인). */
export function useDelegateStep() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      seq,
      delegateUserId,
      comment = '',
    }: {
      id: string;
      seq: number;
      delegateUserId: string;
      comment?: string;
    }) => approvalDocRepo.delegate(id, seq, delegateUserId, comment),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

/** 후열 확인(원결재자 사후 확인). */
export function useConfirmPostRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, seq, userId }: { id: string; seq: number; userId: string }) =>
      approvalDocRepo.confirmPostRead(id, seq, userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

/** 휴지통으로 이동. */
export function useDeleteToTrash() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => approvalDocRepo.deleteToTrash(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

/** 휴지통에서 복원. */
export function useRestoreFromTrash() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => approvalDocRepo.restoreFromTrash(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

/** 영구 삭제. */
export function usePermanentlyDelete() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => approvalDocRepo.permanentlyDelete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

/** 일괄 결재 승인 mutation */
export function useBatchDecideStep() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ docIds, userId, comment }: { docIds: string[]; userId: string; comment?: string }) => {
      const list = await approvalDocRepo.list();
      for (const id of docIds) {
        const doc = list.find((d: ApprovalDoc) => d.id === id);
        if (doc && doc.status === '진행중') {
          const active = activeSteps(doc).find((s: ApprovalStep) => s.approverId === userId);
          if (active) {
            await approvalDocRepo.approve(id, active.seq, userId, comment);
          }
        }
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

/** 일괄 휴지통 복원 mutation */
export function useBatchRestoreFromTrash() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (docIds: string[]) => {
      for (const id of docIds) {
        await approvalDocRepo.restoreFromTrash(id);
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

/** 일괄 영구 삭제 mutation */
export function useBatchPermanentlyDelete() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (docIds: string[]) => {
      for (const id of docIds) {
        await approvalDocRepo.permanentlyDelete(id);
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}



/** 관련 문서 연동용 기결재 완료 문서 목록 검색 훅 */
export function useCompletedDocsForSelection(params: {
  userId?: string;
  userDept?: string;
  userDeptId?: string;
  keyword?: string;
}) {
  const { data: allDocs = [], isLoading } = useAllApprovals();

  const filteredDocs = useMemo(() => {
    if (!params.userId) return [];
    const { userId, userDept, userDeptId, keyword } = params;

    let list = allDocs.filter((d) => d.status === '완료');

    list = list.filter((doc) => {
      // 1. 내가 기안한 문서
      if (doc.drafterId === userId) return true;
      // 2. 내가 결재/합의선에 포함된 문서
      if (doc.steps.some((s) => s.approverId === userId)) return true;
      // 3. 나 또는 내 부서가 참조/수신처로 지정된 문서
      if (
        doc.recipients?.some((r) => {
          if (r.type === 'user') return r.id === userId;
          if (r.type === 'dept') return r.id === userDeptId || r.name === userDept || r.id === userDept;
          if (r.type === 'drafter') return doc.drafterId === userId;
          return false;
        })
      ) {
        return true;
      }
      // 4. 나 또는 내 부서가 시행 담당처로 지정된 문서
      if (doc.execution) {
        if (doc.execution.targetType === 'USER' && doc.execution.targetId === userId) return true;
        if (
          doc.execution.targetType === 'DEPT' &&
          (doc.execution.targetId === userDeptId || doc.execution.targetId === userDept)
        ) {
          return true;
        }
      }
      // 5. 우리 부서 공개 완료 문서
      if (
        doc.visibility === '부서' &&
        ((userDeptId && doc.drafterDeptId === userDeptId) || (userDept && doc.drafterDept === userDept))
      ) {
        return true;
      }
      return false;
    });

    if (keyword && keyword.trim()) {
      const kw = keyword.trim().toLowerCase();
      list = list.filter(
        (d) =>
          d.title.toLowerCase().includes(kw) ||
          d.docNo.toLowerCase().includes(kw) ||
          (d.drafterName && d.drafterName.toLowerCase().includes(kw))
      );
    }

    return list.sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
  }, [allDocs, params.userId, params.userDept, params.userDeptId, params.keyword]);

  return { data: filteredDocs, isLoading };
}
