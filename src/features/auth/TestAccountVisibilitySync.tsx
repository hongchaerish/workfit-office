import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/app/auth/AuthProvider';
import { useSecurityContext } from '@/features/auth/useSecurityContext';
import { isKnownTestUserId, setViewerCanSeeTestAccounts } from '@/data/_backend/testAccountVisibility';
import { canViewerSeeTestAccounts, isTestAccount } from '@/domain/user/testAccount';
import { useShowTestAccounts } from './testAccountToggle';

/**
 * 접속자의 테스트 계정 열람 가능 여부를 사람 마스터 repo 에 알린다.
 * 테스트 계정 본인은 항상, 최고관리자는 상단 토글을 따르고, 그 외 임직원은 볼 수 없다([[canViewerSeeTestAccounts]]).
 * QueryProvider 바로 안쪽, 화면보다 먼저 렌더되어야 첫 조회부터 올바르게 숨겨진다.
 * 최고관리자 판정은 역할 그룹을 읽은 뒤에 확정되므로, 값이 바뀌면 캐시를 모두 다시 읽는다.
 */
export function TestAccountVisibilitySync() {
  const { user } = useAuth();
  const { isSuperAdmin } = useSecurityContext();
  const superAdminShowsTestAccounts = useShowTestAccounts();
  const qc = useQueryClient();
  const canSee =
    !!user &&
    canViewerSeeTestAccounts({
      isTestViewer: isTestAccount(user) || isKnownTestUserId(user.id),
      isSuperAdmin,
      superAdminShowsTestAccounts,
    });

  // 렌더 중에 반영해 같은 렌더의 하위 화면 조회가 바로 이 값을 쓰게 한다(같은 값 반복 설정은 무해).
  const changed = setViewerCanSeeTestAccounts(canSee);
  const pendingRefetch = useRef(false);
  if (changed) pendingRefetch.current = true;

  useEffect(() => {
    if (!pendingRefetch.current) return;
    pendingRefetch.current = false;
    void qc.invalidateQueries();
  }, [canSee, qc]);

  return null;
}
