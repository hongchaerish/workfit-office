import { Navigate } from 'react-router-dom';
import { useAuth } from '@/app/auth/AuthProvider';
import { usePermission } from '@/features/auth/usePermission';
import { useOrgTree } from '@/features/gw/useOrgTree';
import { resolveCommuteScope } from '@/features/auth/scopeHelper';

/**
 * 휴가 관리 라우트 (/gw/leave)
 *
 * 권한에 따라 /gw/commute 로 안전하게 라우팅합니다:
 * - 전사 권한자: /gw/commute?tab=team&adminTab=leave_ledger (전사 연차 원장 대시보드)
 * - 일반 사원: /gw/commute?tab=leave (내 연차·휴가 화면)
 */
export default function LeaveScreen() {
  const { user } = useAuth();
  const { userRoles } = usePermission();
  const org = useOrgTree();

  const commuteScope = resolveCommuteScope(user, userRoles, org);
  const canAll = commuteScope === 'ALL';

  if (canAll) {
    return <Navigate to="/gw/commute?tab=team&adminTab=leave_ledger" replace />;
  }

  return <Navigate to="/gw/commute" replace />;
}
