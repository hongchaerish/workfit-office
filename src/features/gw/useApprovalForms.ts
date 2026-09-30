import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { approvalFormRepo } from '@/data/approvalForm/approvalForm.repo';
import type { ApprovalForm, ApprovalFolder } from '@/domain/approvalForm/schema';

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

/** 활성 서식만 — 상신 유형 선택용 (취소신청서는 기존 문서 취소 전용 특수 서식이므로 기안 카탈로그에서 제외). */
export function useActiveApprovalForms() {
  const q = useApprovalForms();
  return {
    ...q,
    data: (q.data ?? []).filter(
      (form) => form.active && form.code !== '취소신청' && form.id !== '취소신청'
    ),
  };
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
