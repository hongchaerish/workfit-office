import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { approvalFormRepo } from '@/data/approvalForm/approvalForm.repo';
import { draftableForms, draftCatalogForms, type ApprovalForm, type ApprovalFolder } from '@/domain/approvalForm/schema';

/**
 * 결재서식 마스터 훅 — 기준정보 결재서식 관리 CRUD + 상신 모달/문서뷰 공유.
 * 저장 즉시 상신·인쇄에 반영(캐시키 'approvalForms').
 */
const KEY = 'approvalForms';
const KEY_FOLDERS = 'approvalFolders';

/** 전체 서식(비활성 포함) — 관리 화면용. */
export function useApprovalForms() {
  return useQuery({ queryKey: [KEY], queryFn: () => approvalFormRepo.list() });
}

/** 활성 서식 전부 — 기안 화면이 서식을 찾는 목록(취소 기안의 취소신청서 포함). */
export function useActiveApprovalForms() {
  const q = useApprovalForms();
  return { ...q, data: draftableForms(q.data ?? []) };
}

/** 서식 선택 목록 — 취소신청서는 기존 문서 취소 전용 특수 서식이므로 뺀다. */
export function useDraftCatalogForms() {
  const q = useApprovalForms();
  return { ...q, data: draftCatalogForms(q.data ?? []) };
}

export function useUpsertApprovalForm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (form: ApprovalForm) => approvalFormRepo.save(form),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useRemoveApprovalForm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => approvalFormRepo.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

/** 전체 폴더 리스트 로드 훅 */
export function useApprovalFolders() {
  return useQuery({ queryKey: [KEY_FOLDERS], queryFn: () => approvalFormRepo.listFolders() });
}

/** 폴더 추가/수정 훅 */
export function useUpsertApprovalFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (folder: ApprovalFolder) => approvalFormRepo.saveFolder(folder),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY_FOLDERS] }),
  });
}

/** 폴더 삭제 훅 (폴더 아래 서식은 루트로 구출되므로 양쪽 쿼리 무효화 필요) */
export function useRemoveApprovalFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (folderId: string) => approvalFormRepo.removeFolder(folderId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY_FOLDERS] });
      qc.invalidateQueries({ queryKey: [KEY] });
    },
  });
}
