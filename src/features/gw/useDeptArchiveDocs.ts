import { useMemo } from 'react';
import { byRecent } from '@/domain/approvalDoc/engine';
import { isDeptArchiveDoc } from '@/domain/approvalDoc/search';
import { useAllApprovals } from './useApprovals';
import { useOrgTree } from './useOrgTree';

/** 부서 문서함 — 내 부서의 결재 완료·공개 문서(최근 상신순). PC·PWA 목록과 검색이 같이 쓴다. */
export function useDeptArchiveDocs(userId: string | undefined) {
  const { data: allDocs = [] } = useAllApprovals();
  const org = useOrgTree();
  const myDeptName = (userId && org.userById(userId)?.dept) || '';

  return useMemo(() => {
    if (!myDeptName) return [];
    const deptIdOf = (deptName: string) => org.depts.find((d) => d.name === deptName)?.id ?? '';
    const my = { deptName: myDeptName, deptId: deptIdOf(myDeptName) };
    const drafterDeptIdOf = (drafterId: string) => deptIdOf(org.userById(drafterId)?.dept ?? '');
    return allDocs.filter((d) => isDeptArchiveDoc(d, my, drafterDeptIdOf)).sort(byRecent);
  }, [allDocs, org, myDeptName]);
}
