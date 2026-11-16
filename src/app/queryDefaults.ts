import type { QueryClient } from '@tanstack/react-query';

/**
 * 조직·기준 정보(부서·사용자·인명·직급·직책·겸직·역할·공휴일·공통코드)는 거의 바뀌지 않는데
 * 화면 여러 곳이 같이 쓴다. 기본 30초로 두면 화면을 옮길 때마다 한 묶음(인명 목록 하나에 6건)을 다시 받는다.
 * 5분 동안은 받아 둔 값을 쓴다 — 이 브라우저에서 고치면 저장 훅이 바로 무효화하므로 즉시 반영된다.
 * 훅에서 staleTime 을 따로 준 곳(예: 사번 채번 0)은 그 값이 우선한다.
 */
export const MASTER_STALE_MS = 5 * 60_000;

const MASTER_KEYS = ['users', 'departments', 'employeeProfiles', 'positions', 'jobTitles', 'departmentMembers', 'roleGroups', 'holidays', 'commonCodes'];

export function applyQueryDefaults(client: QueryClient): void {
  for (const key of MASTER_KEYS) client.setQueryDefaults([key], { staleTime: MASTER_STALE_MS });
}
