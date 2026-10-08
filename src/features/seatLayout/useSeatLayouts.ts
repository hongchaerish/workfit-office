import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { seatLayoutRepo } from '@/data/seatLayout/seatLayout.repo';
import type { SeatLayout } from '@/domain/seatLayout/schema';

const KEY = 'seatLayouts';

/** 좌석 배치도 목록 */
export function useSeatLayouts() {
  return useQuery({ queryKey: [KEY], queryFn: () => seatLayoutRepo.list() });
}

export function useSaveSeatLayout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (item: SeatLayout) => seatLayoutRepo.save(item),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useRemoveSeatLayout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => seatLayoutRepo.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}
