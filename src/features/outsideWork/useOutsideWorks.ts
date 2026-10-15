import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAllApprovals } from '@/features/gw/useApprovals';
import { extractApprovedSchedules } from '@/domain/approvalDoc/scheduleEngine';
import { fromApprovalSchedule, fromOutsideWork, type OutsideScheduleView } from '@/domain/outsideWork/view';
import { outsideWorkRepo, type OutsideWorkActor, type OutsideWorkFilter } from '@/data/outsideWork/outsideWork.repo';
import type { OutsideWork, OutsideWorkDraft } from '@/domain/outsideWork/schema';

const KEY = 'outsideWorks';

/**
 * 직접 등록 외근·출장 — 전사 공개라 범위 안 전원 것을 읽는다.
 * 범위가 없으면 전부(근태·재실 인덱스용 — 결재 전건 조회와 같은 방식).
 */
export function useOutsideWorks(filter?: OutsideWorkFilter, enabled = true) {
  return useQuery({
    queryKey: [KEY, filter ?? null],
    queryFn: () => outsideWorkRepo.listAll(filter),
    enabled,
  });
}

function useOutsideWorkMutation<T, R>(mutationFn: (input: T) => Promise<R>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [KEY] });
    },
  });
}

export function useCreateOutsideWork() {
  return useOutsideWorkMutation<{ actor: OutsideWorkActor; draft: OutsideWorkDraft }, OutsideWork>(
    ({ actor, draft }) => outsideWorkRepo.create(actor, draft),
  );
}

export function useUpdateOutsideWork() {
  return useOutsideWorkMutation<{ actor: OutsideWorkActor; id: string; draft: OutsideWorkDraft }, OutsideWork>(
    ({ actor, id, draft }) => outsideWorkRepo.update(actor, id, draft),
  );
}

export function useRemoveOutsideWork() {
  return useOutsideWorkMutation<{ actor: OutsideWorkActor; id: string }, OutsideWork>(
    ({ actor, id }) => outsideWorkRepo.remove(actor, id),
  );
}

/**
 * 한 사람의 외근·출장 전체(결재 완료 + 직접 등록) — 등록 창의 '같은 기간' 경고용.
 * 결재 기안자 id가 계정 이관 등으로 다르면 이름으로 잇는다(업무계획·근태와 같은 규칙).
 */
export function useOutsideSchedulesOf(userId: string, userName: string): OutsideScheduleView[] {
  const approvalsQuery = useAllApprovals();
  const worksQuery = useOutsideWorks();
  return useMemo(() => {
    const norm = (v?: string | null) => (v ?? '').replace(/\s+/g, '');
    const approved = extractApprovedSchedules(approvalsQuery.data ?? [])
      .filter((s) => s.drafterId === userId || norm(s.drafterName) === norm(userName))
      .map(fromApprovalSchedule)
      .filter((v): v is OutsideScheduleView => v !== null);
    const self = (worksQuery.data ?? []).filter((w) => w.ownerUserId === userId).map((w) => fromOutsideWork(w));
    return [...approved, ...self];
  }, [approvalsQuery.data, worksQuery.data, userId, userName]);
}
