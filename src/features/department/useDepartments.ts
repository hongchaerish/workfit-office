import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { departmentRepo } from '@/data/department/department.repo';
import type { Department } from '@/domain/department/schema';
import { saveDepartment } from './saveDepartment';

/** 부서 마스터 훅 — 기준정보 부서관리 CRUD. 조직도(useOrgTree)와 캐시 공유('departments'). */
const KEY = 'departments';

export function useDepartments() {
  return useQuery({ queryKey: [KEY, null], queryFn: () => departmentRepo.list() });
}

export function useUpsertDepartment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (d: Department) => saveDepartment(d),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [KEY] });
      void qc.invalidateQueries({ queryKey: ['chatRooms'] });
    },
  });
}

export function useRemoveDepartment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => departmentRepo.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}
