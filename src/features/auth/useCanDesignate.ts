import { useCallback, useMemo } from 'react';
import { useAuth } from '@/app/auth/AuthProvider';
import { isKnownTestUserId } from '@/data/_backend/testAccountVisibility';
import { isTestAccount, isTestDeptName, type TestAccountLike } from '@/domain/user/testAccount';

const isTestSide = (u?: TestAccountLike | null) => isTestAccount(u) || isKnownTestUserId(u?.id);

/**
 * 사람 선택(대화 상대·결재선·수신참조·참석자·담당자·대결자 등)에서 고를 수 있는 사람인지.
 * 테스트 계정은 테스트 계정끼리만, 임직원(최고관리자 포함)은 임직원끼리만 지정한다 — 지정하면 상대 화면에 드러나기 때문.
 * 새 선택 UI 도 후보 목록을 `users.filter(canDesignate)` 로 거르면 된다.
 */
export function useCanDesignate() {
  const { user } = useAuth();
  const viewerIsTest = isTestSide(user);
  const canDesignate = useCallback((target: TestAccountLike) => isTestSide(target) === viewerIsTest, [viewerIsTest]);
  /** 부서 노드를 선택 후보로 보여줄지 — 테스트 부서는 테스트 계정에게만. */
  const canDesignateDept = useCallback((deptName?: string | null) => !isTestDeptName(deptName) || viewerIsTest, [viewerIsTest]);
  return useMemo(() => ({ canDesignate, canDesignateDept, viewerIsTest }), [canDesignate, canDesignateDept, viewerIsTest]);
}
