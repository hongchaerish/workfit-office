import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
