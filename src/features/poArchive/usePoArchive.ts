import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { poReplyRepo } from '@/data/poArchive/poReply.repo';
import type { ApprovalDoc } from '@/domain/approvalDoc/schema';
import { canViewPurchaseOrder, isArchivedPurchaseOrder, isPurchaseOrderForm, type PoViewer } from '@/domain/poArchive/schema';
import { useAllApprovals } from '@/features/gw/useApprovals';
import { useApprovalForms } from '@/features/gw/useApprovalForms';
import { useOrgTree } from '@/features/gw/useOrgTree';

const KEY = 'poArchiveReplies';

/**
 * 발주서 보관함 문서 — 결재 완료된 발주서 중 내가 볼 수 있는 것.
 * 결재 문서 구독(useAllApprovals)에서 바로 골라내므로 완료되는 순간 보관함에 나타난다.
 */
export function usePurchaseOrderArchive(viewer: Omit<PoViewer, 'deptId'> | null) {
  const { data: allDocs = [], isLoading } = useAllApprovals();
  const { data: forms = [] } = useApprovalForms();
  const org = useOrgTree();

  const docs = useMemo((): ApprovalDoc[] => {
    if (!viewer) return [];
    const poCodes = new Set(forms.filter(isPurchaseOrderForm).map((f) => f.code));
    const deptIdOf = (deptName: string) => org.depts.find((d) => d.name === deptName)?.id ?? '';
    const v: PoViewer = { ...viewer, deptId: deptIdOf(viewer.deptName) };
    const drafterDeptIdOf = (drafterId: string) => deptIdOf(org.userById(drafterId)?.dept ?? '');
    return allDocs.filter((d) => isArchivedPurchaseOrder(d, poCodes) && canViewPurchaseOrder(d, v, drafterDeptIdOf));
  }, [allDocs, forms, org, viewer]);

  return { docs, isLoading };
}

export function usePoReplies() {
  return useQuery({ queryKey: [KEY], queryFn: () => poReplyRepo.list() });
}

export function useUploadPoReply() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { doc: Pick<ApprovalDoc, 'id' | 'docNo'>; file: File; actor: { id: string; name: string } }) =>
      poReplyRepo.upload(args.doc, args.file, args.actor),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}
