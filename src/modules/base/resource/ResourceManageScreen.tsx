import { useAuth } from '@/app/auth/AuthProvider';
import { useResources } from '@/features/resource/useResources';
import { useUsers } from '@/features/user/useUsers';
import { useDepartments } from '@/features/department/useDepartments';
import ResourceAdmin from '@/modules/gw/resource/ResourceAdmin';

/** 관리자 콘솔 › 회사·운영 › 자원 관리 — 회의실·차량·비품 기준정보. 예약·승인은 업무 화면 자원예약에서 */
export default function ResourceManageScreen() {
  const { user } = useAuth();
  const { data: resources = [], isLoading } = useResources();
  const { data: users = [] } = useUsers();
  const { data: departments = [] } = useDepartments();
  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-4 px-3 py-4 sm:px-5 sm:py-5">
      <div>
        <h1 className="text-xl font-extrabold tracking-tight text-ink">자원 관리</h1>
        <p className="mt-0.5 text-xs text-ink3">회사·운영 / 자원 관리</p>
      </div>
      {user && !isLoading && <ResourceAdmin actor={user} resources={resources} users={users} departments={departments} />}
    </div>
  );
}
