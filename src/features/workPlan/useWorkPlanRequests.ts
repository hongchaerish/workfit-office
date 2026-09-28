import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { workPlanRequestRepo } from '@/data/workPlan/workPlanRequest.repo';
import type { WorkPlanRequest } from '@/domain/workPlan/workPlanRequest.schema';

export const WORK_PLAN_REQUESTS_KEY = ['workPlanRequests'];

export function useReceivedWorkPlanRequests(targetUserId?: string) {
  const qc = useQueryClient();

  useEffect(() => {
    const handleUpdate = () => {
      qc.invalidateQueries({ queryKey: WORK_PLAN_REQUESTS_KEY });
    };
    window.addEventListener('workfit:workplan_requests_updated', handleUpdate);
    return () => window.removeEventListener('workfit:workplan_requests_updated', handleUpdate);
  }, [qc]);

  return useQuery({
    queryKey: [...WORK_PLAN_REQUESTS_KEY, 'received', targetUserId ?? ''],
    queryFn: () => (targetUserId ? workPlanRequestRepo.listByTarget(targetUserId) : Promise.resolve([])),
    enabled: Boolean(targetUserId),
  });
}

export function useSentWorkPlanRequests(requesterId?: string) {
  const qc = useQueryClient();

  useEffect(() => {
    const handleUpdate = () => {
      qc.invalidateQueries({ queryKey: WORK_PLAN_REQUESTS_KEY });
    };
    window.addEventListener('workfit:workplan_requests_updated', handleUpdate);
    return () => window.removeEventListener('workfit:workplan_requests_updated', handleUpdate);
  }, [qc]);

  return useQuery({
    queryKey: [...WORK_PLAN_REQUESTS_KEY, 'sent', requesterId ?? ''],
    queryFn: () => (requesterId ? workPlanRequestRepo.listByRequester(requesterId) : Promise.resolve([])),
    enabled: Boolean(requesterId),
  });
}

export function useCreateWorkPlanRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Omit<WorkPlanRequest, 'id' | 'createdAt' | 'status'>) =>
      workPlanRequestRepo.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: WORK_PLAN_REQUESTS_KEY });
    },
  });
}

export function useAcceptWorkPlanRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (requestId: string) => workPlanRequestRepo.accept(requestId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: WORK_PLAN_REQUESTS_KEY });
      qc.invalidateQueries({ queryKey: ['workPlans'] });
    },
  });
}

export function useRejectWorkPlanRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ requestId, reason }: { requestId: string; reason?: string }) =>
      workPlanRequestRepo.reject(requestId, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: WORK_PLAN_REQUESTS_KEY });
    },
  });
}
