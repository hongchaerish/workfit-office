import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ROSTER_ORDER_KEY, rosterOrderRepo } from '@/data/rosterOrder/rosterOrder.repo';

const QUERY_KEY = ['rosterOrders', ROSTER_ORDER_KEY] as const;

/** 전 직원 정렬 순서(사용자 ID 목록, 전사 공용). 비어 있으면 기본 정렬(임원 → 부서 → 직책 → 직급 → 이름). */
export function useRosterOrderSetting() {
  return useQuery({ queryKey: QUERY_KEY, queryFn: () => rosterOrderRepo.get(ROSTER_ORDER_KEY) });
}

export function useSaveRosterOrderSetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userIds, updatedBy }: { userIds: string[]; updatedBy?: string }) =>
      rosterOrderRepo.save(ROSTER_ORDER_KEY, userIds, updatedBy),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}
