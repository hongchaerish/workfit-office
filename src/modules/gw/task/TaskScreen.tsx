import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/app/auth/AuthProvider';
import { resolveDeptId } from '@/domain/department/engine';
import type { ProjectAccessContext } from '@/domain/workProject/engine';
import { useDepartments } from '@/features/department/useDepartments';
import { useProject, useProjects } from '@/features/project/useProjects';
import { useUsers } from '@/features/user/useUsers';
import { usePermission } from '@/features/auth/usePermission';
import { GwHead, GwSideNav, GwSplit } from '@/modules/gw/_gw';
import ProjectDetail from './ProjectDetail';
import ProjectList, { PROJECT_TABS, type ProjectTab } from './ProjectList';
import { Button } from '@/shared/ui/Button';

function LocalProjectScreen() {
  const { user: authenticatedUser, loading: authLoading } = useAuth();
  const { isAdmin } = usePermission();
  const [searchParams, setSearchParams] = useSearchParams();
  const [demoUserId, setDemoUserId] = useState('U009');
  const usersQuery = useUsers();
  const departmentsQuery = useDepartments();
  const users = useMemo(() => {
    return (usersQuery.data ?? []).filter((u) => u.status === '사용' && !u.resignedAt);
  }, [usersQuery.data]);
  const departments = departmentsQuery.data ?? [];
  const actor = authenticatedUser
    ?? users.find((user) => user.id === demoUserId)
    ?? users.find((user) => user.status === '사용')
    ?? null;
  const access = useMemo<ProjectAccessContext>(() => ({
    userId: actor?.id ?? '__anonymous__',
    deptId: resolveDeptId(departments, actor?.dept),
    active: actor?.status === '사용',
    // 관리자는 참여자·소유자 판정을 건너뛴다 (기준정보 > 권한그룹관리 연동)
    isAdmin: Boolean(isAdmin),
  }), [actor, departments, isAdmin]);
  const projectsQuery = useProjects(access);
  const requestedTab = searchParams.get('tab') as ProjectTab | null;
  const tab: ProjectTab = requestedTab && PROJECT_TABS.some((item) => item.id === requestedTab) ? requestedTab : 'available';
  const selectedProjectId = searchParams.get('project') ?? undefined;
  const selectedProjectQuery = useProject(access, selectedProjectId);
  const loading = authLoading || usersQuery.isLoading || departmentsQuery.isLoading || projectsQuery.isLoading || selectedProjectQuery.isLoading;
  const queryError = usersQuery.error ?? departmentsQuery.error ?? projectsQuery.error ?? selectedProjectQuery.error;

  const openProject = (projectId: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('project', projectId);
    setSearchParams(next);
  };

  // 좌측 메뉴 이동은 목록으로 복귀한다(게시판과 같은 규칙). 열려 있던 상세는 닫는다.
  const changeTab = (next: ProjectTab) => {
    setSearchParams({ tab: next });
  };

  const closeProject = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('project');
    setSearchParams(next, { replace: true });
  };

  if (loading) return <div className="grid min-h-[calc(60vh/var(--font-scale,1))] place-items-center text-[12px] font-semibold text-ink3">프로젝트를 불러오는 중…</div>;
  if (queryError) return <div className="grid min-h-[calc(60vh/var(--font-scale,1))] place-items-center px-5 text-center text-[12px] font-semibold text-danger">프로젝트 데이터를 불러오지 못했습니다.<br />{queryError instanceof Error ? queryError.message : ''}</div>;
  if (!actor) return <div className="grid min-h-[calc(60vh/var(--font-scale,1))] place-items-center text-[12px] font-semibold text-ink3">사용자 정보를 불러올 수 없습니다.</div>;

  return (
    <div className="mx-auto w-full max-w-[1500px] px-4 py-5 sm:px-6 sm:py-6">
      <GwHead
        icon="PM"
        name="프로젝트"
        desc="프로젝트 단위 관리 시스템: 각 팀이 유기적으로 연결되어 회사 전체 단위 프로젝트의 시작부터 마무리까지 함께 진행하고 확인·관리합니다."
        right={!authenticatedUser ? (
          <select
            value={actor.id}
            onChange={(event) => setDemoUserId(event.target.value)}
            title="사용자 선택"
            className="h-9 rounded-lg border border-amber/30 bg-amber-soft/30 px-3 text-[10.5px] font-bold text-ink outline-none"
          >
            {users.filter((user) => user.status === '사용').map((user) => (
              <option key={user.id} value={user.id}>{user.name} · {user.position || user.dept || '사원'}</option>
            ))}
          </select>
        ) : undefined}
      />

      <GwSplit
        nav={(
          <GwSideNav
            title="프로젝트 관리"
            desc="프로젝트와 단계별 진행을 관리합니다."
            items={PROJECT_TABS.map((item) => ({ id: item.id, icon: item.icon, label: item.label }))}
            activeId={tab}
            onSelect={(id) => changeTab(id as ProjectTab)}
          />
        )}
      >
      <main>
        {selectedProjectId && selectedProjectQuery.data && (
          <ProjectDetail project={selectedProjectQuery.data} actor={actor} access={access} users={users} onBack={closeProject} />
        )}
        {selectedProjectId && !selectedProjectQuery.data && (
          <div className="rounded-xl border border-amber/25 bg-panel p-8 text-center shadow-sm">
            <div className="text-[12px] font-bold text-ink">프로젝트를 조회할 수 없습니다.</div>
            <p className="mt-2 text-[10.5px] text-ink3">존재하지 않거나 현재 사용자에게 조회 권한이 없는 프로젝트입니다.</p>
            <div className="mt-4">
              <Button size="sm" onClick={closeProject}>프로젝트 목록</Button>
            </div>
          </div>
        )}
        {!selectedProjectId && <ProjectList actor={actor} access={access} projects={projectsQuery.data ?? []} users={users} tab={tab} onTabChange={changeTab} onSelectProject={openProject} />}
      </main>
      </GwSplit>
    </div>
  );
}

export default function TaskScreen() {
  return <LocalProjectScreen />;
}
