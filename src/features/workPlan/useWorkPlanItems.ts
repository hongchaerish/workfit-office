import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { workPlanItemRepo, type WorkPlanItemActor } from '@/data/workPlan/workPlanItem.repo';
import { workPlanTagRepo } from '@/data/workPlan/workPlanTag.repo';
import type { WorkPlanItem, WorkPlanItemDraft } from '@/domain/workPlan/item';
import type { Routine } from '@/domain/workPlan/routine';
import type { WorkPlanTag, WorkPlanTagDraft } from '@/domain/workPlan/tag';

const ITEM_KEY = 'workPlanItems';
const TAG_KEY = 'workPlanTags';

/** 전사 공개 — 범위 안 전원의 항목. */
export function useWorkPlanItems(range: { from: string; to: string }, enabled = true) {
  return useQuery({
    queryKey: [ITEM_KEY, range.from, range.to],
    queryFn: () => workPlanItemRepo.listRange(range),
    enabled,
  });
}

function useItemMutation<T, R>(mutationFn: (input: T) => Promise<R>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [ITEM_KEY] });
    },
  });
}

export function useCreateWorkPlanItem() {
  return useItemMutation<{ actor: WorkPlanItemActor; ownerUserId: string; draft: WorkPlanItemDraft }, WorkPlanItem>(
    ({ actor, ownerUserId, draft }) => workPlanItemRepo.create(actor, ownerUserId, draft),
  );
}

export function useUpdateWorkPlanItem() {
  return useItemMutation<{ actor: WorkPlanItemActor; id: string; draft: WorkPlanItemDraft }, WorkPlanItem>(
    ({ actor, id, draft }) => workPlanItemRepo.update(actor, id, draft),
  );
}

export function useRemoveWorkPlanItem() {
  return useItemMutation<{ actor: WorkPlanItemActor; id: string }, WorkPlanItem>(
    ({ actor, id }) => workPlanItemRepo.remove(actor, id),
  );
}

/** 루틴(반복) — 날짜마다 항목을 만든다 */
export function useCreateWorkPlanRoutine() {
  return useItemMutation<{ actor: WorkPlanItemActor; ownerUserId: string; drafts: WorkPlanItemDraft[]; routine: Routine }, WorkPlanItem[]>(
    ({ actor, ownerUserId, drafts, routine }) => workPlanItemRepo.createRoutine(actor, ownerUserId, drafts, routine),
  );
}

/** 루틴 '이후 모두' 고치기 */
export function useUpdateFollowingWorkPlanItems() {
  return useItemMutation<{ actor: WorkPlanItemActor; id: string; draft: WorkPlanItemDraft }, WorkPlanItem[]>(
    ({ actor, id, draft }) => workPlanItemRepo.updateFollowing(actor, id, draft),
  );
}

/** 루틴 '이후 모두' 지우기 */
export function useRemoveFollowingWorkPlanItems() {
  return useItemMutation<{ actor: WorkPlanItemActor; id: string }, WorkPlanItem[]>(
    ({ actor, id }) => workPlanItemRepo.removeFollowing(actor, id),
  );
}

/** 숨긴 태그까지 전부 — 항목 표시용 이름·색 풀이와 관리 화면이 함께 쓴다. */
export function useWorkPlanTags(enabled = true) {
  return useQuery({
    queryKey: [TAG_KEY],
    queryFn: () => workPlanTagRepo.list(),
    enabled,
  });
}

/** `id`가 있으면 고치고, 없으면 새로 만든다. */
export function useSaveWorkPlanTag() {
  const queryClient = useQueryClient();
  return useMutation<WorkPlanTag, Error, { id?: string; draft: WorkPlanTagDraft }>({
    mutationFn: ({ id, draft }) => (id ? workPlanTagRepo.update(id, draft) : workPlanTagRepo.create(draft)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [TAG_KEY] });
    },
  });
}
