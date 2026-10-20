import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/app/auth/AuthProvider';
import { vendorProjectRepo } from '@/data/bizVendor/vendorProject.repo';
import { vendorRepo } from '@/data/vendor/vendor.repo';
import { resolveDeptId } from '@/domain/department/engine';
import type { VendorProjectRole } from '@/domain/bizVendor/schema';
import type { Vendor } from '@/domain/vendor/schema';
import type { ProjectAccessContext } from '@/domain/workProject/engine';
import { usePermission } from '@/features/auth/usePermission';
import { useDepartments } from '@/features/department/useDepartments';

const LINKS_KEY = 'bizVendorProjects';
const VENDORS_KEY = 'vendors';

/** 거래처 ↔ 사업 연결 전체. */
export function useVendorProjectLinks() {
  return useQuery({ queryKey: [LINKS_KEY], queryFn: () => vendorProjectRepo.list() });
}

export function useLinkVendorProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { vendorCode: string; projectId: string; role: VendorProjectRole; actorId: string }) =>
      vendorProjectRepo.link(args, args.actorId),
    onSuccess: () => qc.invalidateQueries({ queryKey: [LINKS_KEY] }),
  });
}

export function useUnlinkVendorProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => vendorProjectRepo.unlink(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: [LINKS_KEY] }),
  });
}

/** 거래처 등록(insert)·수정(save). 등록은 같은 코드가 있으면 덮어쓰지 않는다. */
export function useUpsertVendor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ vendor, isNew }: { vendor: Vendor; isNew: boolean }) =>
      isNew ? vendorRepo.create(vendor) : vendorRepo.save(vendor),
    onSuccess: () => qc.invalidateQueries({ queryKey: [VENDORS_KEY] }),
  });
}

/** 사업 목록 조회용 접근 맥락 — 업무관리 프로젝트의 열람 규칙(비공개·팀 공개)을 그대로 따른다. */
export function useProjectAccess(): ProjectAccessContext {
  const { user } = useAuth();
  const { isAdmin } = usePermission();
  const { data: departments = [] } = useDepartments();
  return useMemo(
    () => ({
      userId: user?.id ?? '__anonymous__',
      deptId: resolveDeptId(departments, user?.dept),
      active: Boolean(user) && user?.status !== '미사용',
      isAdmin: Boolean(isAdmin),
    }),
    [user, departments, isAdmin],
  );
}
