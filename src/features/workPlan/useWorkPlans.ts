import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { workPlanRepo, type WorkPlanActor, type WorkPlanFilter } from '@/data/workPlan/workPlan.repo';
import type { WorkPlan, WorkPlanDraft } from '@/domain/workPlan/schema';

const KEY = 'workPlans';
const CALENDAR_KEY = 'calendarEvents';

export function useMyWorkPlans(actor: WorkPlanActor, filter?: WorkPlanFilter) {
  return useQuery({
    queryKey: [KEY, 'mine', actor.userId, actor.active, filter ?? null],
    queryFn: () => workPlanRepo.list(actor, filter),
  });
}

export function useAllWorkPlans(filter: WorkPlanFilter | undefined, enabled: boolean) {
  return useQuery({
    queryKey: [KEY, 'all', filter ?? null],
    queryFn: () => workPlanRepo.listAll(filter),
    enabled,
  });
}

function useWorkPlanMutation<T, R = unknown>(mutationFn: (input: T) => Promise<R>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [KEY] });
      queryClient.invalidateQueries({ queryKey: [CALENDAR_KEY] });
    },
  });
}

export function useCreateWorkPlan() {
  return useWorkPlanMutation<
    { actor: WorkPlanActor; draft: WorkPlanDraft },
    WorkPlan
  >(({ actor, draft }) => workPlanRepo.create(actor, draft));
}

export function useUpdateWorkPlan() {
  return useWorkPlanMutation<
    { actor: WorkPlanActor; id: string; draft: WorkPlanDraft; expectedUpdatedAt?: string },
    WorkPlan
  >(({ actor, id, draft, expectedUpdatedAt }) => workPlanRepo.update(actor, id, draft, expectedUpdatedAt));
}

export function useRemoveWorkPlan() {
  return useWorkPlanMutation<
    { actor: WorkPlanActor; id: string },
    WorkPlan
  >(({ actor, id }) => workPlanRepo.remove(actor, id));
}
