import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { holidayRepo } from '@/data/holiday/holiday.repo';
import type { Holiday } from '@/domain/holiday/schema';

export const HOLIDAYS_QUERY_KEY = ['holidays'];

export function useHolidays(year?: string) {
  return useQuery({
    queryKey: [...HOLIDAYS_QUERY_KEY, year ?? 'all'],
    queryFn: () => holidayRepo.list(year),
  });
}

export function useCreateHoliday() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Omit<Holiday, 'id' | 'createdAt'>) => holidayRepo.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: HOLIDAYS_QUERY_KEY });
    },
  });
}

export function useUpdateHoliday() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Omit<Holiday, 'id'>> }) =>
      holidayRepo.update(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: HOLIDAYS_QUERY_KEY });
    },
  });
}

export function useDeleteHoliday() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => holidayRepo.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: HOLIDAYS_QUERY_KEY });
    },
  });
}

export function useResetHolidays() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (year?: string) => holidayRepo.resetToDefault(year),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: HOLIDAYS_QUERY_KEY });
    },
  });
}

export function useImportKoreaHolidays() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (year: string) => holidayRepo.importKoreaHolidays(year),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: HOLIDAYS_QUERY_KEY });
    },
  });
}
