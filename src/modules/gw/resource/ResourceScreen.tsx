import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/app/auth/AuthProvider';
import { useUsers } from '@/features/user/useUsers';
import { useDepartments } from '@/features/department/useDepartments';
import { useResources } from '@/features/resource/useResources';
import { useApproveReservation, useCancelReservation, useRejectReservation, useReservations } from '@/features/resource/useReservations';
import { canApproveResource, canCancelReservation, canManageResources } from '@/domain/reservation/engine';
import type { Resource } from '@/domain/resource/schema';
import type { Reservation } from '@/domain/reservation/schema';
import { GwHead, GwSideNav, GwSplit } from '@/modules/gw/_gw';
import { Modal } from '@/shared/ui/Modal';
import ResourceCalendar from './ResourceCalendar';
import ReservationForm from './ReservationForm';
import MyReservations from './MyReservations';
import ReservationApprovals from './ReservationApprovals';
import ResourceAdmin from './ResourceAdmin';
import ReservationDetailModal from './ReservationDetailModal';
import ReservationReasonDialog from './ReservationReasonDialog';
import { formatResourceDateTime } from './resourceDate';
import { Button } from '@/shared/ui/Button';
import { usePermission } from '@/features/auth/usePermission';

type TabId = 'overview' | 'request' | 'my' | 'approvals' | 'admin';

const TAB_LABELS: Record<TabId, string> = {
  overview: '예약 현황',
  request: '예약 신청',
  my: '내 예약',
  approvals: '승인 관리',
  admin: '자원 관리',
};

const TAB_ICONS: Record<TabId, string> = {
  overview: '📅',
  request: '🖊️',
  my: '🧾',
  approvals: '☑️',
  admin: '🛠️',
};

const OVERVIEW_DETAIL_STATUSES = new Set<Reservation['status']>(['PENDING', 'CONFIRMED', 'COMPLETED']);

function LocalResourceScreen() {
  const { user: authenticatedUser } = useAuth();
  const { isAdmin, canAction } = usePermission();
  const canCreate = canAction('S_GW_RESOURCE', 'create');
  const [searchParams, setSearchParams] = useSearchParams();
  const [demoUserId, setDemoUserId] = useState('U011');
  const [modalTarget, setModalTarget] = useState<{ resource: Resource; date?: string } | null>(null);
  const [notice, setNotice] = useState('');
  /** 상세 모달에서 연 취소·반려 사유 모달의 대상. 목록의 취소·반려는 각 탭 컴포넌트가 따로 연다. */
  const [cancelTarget, setCancelTarget] = useState<Reservation | null>(null);
  const [rejectTarget, setRejectTarget] = useState<Reservation | null>(null);
  /** 상세의 승인은 사유 모달이 없어 실패를 여기(붉은 배너)로 알린다. */
  const [actionError, setActionError] = useState('');
  const cancelReservation = useCancelReservation();
  const approveReservation = useApproveReservation();
  const rejectReservation = useRejectReservation();
  const resourcesQuery = useResources();
  const reservationsQuery = useReservations();
  const usersQuery = useUsers();
  const departmentsQuery = useDepartments();

  const resources = resourcesQuery.data ?? [];
  const reservations = reservationsQuery.data ?? [];
  const users = usersQuery.data ?? [];
  const departments = departmentsQuery.data ?? [];
  const actor = authenticatedUser ?? users.find((user) => user.id === demoUserId) ?? users.find((user) => user.status === '사용') ?? null;
  const requestedTab = searchParams.get('tab') as TabId | null;
  const tab: TabId = requestedTab && requestedTab in TAB_LABELS ? requestedTab : 'overview';

  const canManage = isAdmin || canAction('S_GW_RESOURCE', 'update') || (actor ? canManageResources(actor) : false);
  const canApprove = useMemo(() => isAdmin || (actor ? resources.some((resource) => canApproveResource(actor, resource)) : false), [isAdmin, actor, resources]);
  const tabs = (Object.keys(TAB_LABELS) as TabId[]).filter((item) => item !== 'approvals' || canApprove).filter((item) => item !== 'admin' || canManage);
  const loading = resourcesQuery.isLoading || reservationsQuery.isLoading || usersQuery.isLoading || departmentsQuery.isLoading;
  const queryError = resourcesQuery.error ?? reservationsQuery.error ?? usersQuery.error ?? departmentsQuery.error;
  const activeTab = tabs.includes(tab) ? tab : 'overview';
  const selectedReservationId = searchParams.get('reservation');
  const selectedReservation = useMemo(() => {
    if (!actor || !selectedReservationId) return null;
    const row = reservations.find((reservation) => reservation.id === selectedReservationId);
    if (!row) return null;
    if (tab === 'my') return row.requesterUserId === actor.id ? row : null;
    if (tab === 'approvals') {
      const resource = resources.find((item) => item.id === row.resourceId);
      return resource && canApproveResource(actor, resource, isAdmin) ? row : null;
    }
    if (tab === 'overview') return OVERVIEW_DETAIL_STATUSES.has(row.status) ? row : null;
    return null;
  }, [actor, isAdmin, reservations, resources, selectedReservationId, tab]);
  const selectedResource = selectedReservation ? resources.find((resource) => resource.id === selectedReservation.resourceId) : undefined;
  const showPrivateDetails = Boolean(selectedReservation && actor && (
    selectedReservation.requesterUserId === actor.id
    || (selectedResource && canApproveResource(actor, selectedResource, isAdmin))
  ));

  const changeTab = (next: TabId) => {
    setNotice('');
    setSearchParams({ tab: next });
  };

  const reservationCreated = (row: Reservation) => {
    setModalTarget(null);
    setNotice(row.status === 'CONFIRMED' ? '예약이 확정되었습니다.' : '예약 신청이 접수되어 담당자 승인을 기다립니다.');
    setSearchParams({ tab: 'my', reservation: row.id });
  };

  const openReservation = (row: Reservation, sourceTab: Extract<TabId, 'overview' | 'my' | 'approvals'>) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', sourceTab);
    next.set('reservation', row.id);
    setSearchParams(next);
  };

  const closeReservation = () => {
    setActionError('');
    const next = new URLSearchParams(searchParams);
    next.delete('reservation');
    setSearchParams(next, { replace: true });
  };

  const approveSelected = async (row: Reservation) => {
    if (!actor) return;
    setActionError('');
    try {
      await approveReservation.mutateAsync({ actor, id: row.id, isAdmin });
      setNotice('예약을 승인했습니다.');
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : '승인 처리에 실패했습니다.');
    }
  };

  if (loading) return <div className="grid min-h-[calc(60vh/var(--font-scale,1))] place-items-center text-[12px] font-semibold text-ink3">자원예약을 불러오는 중…</div>;
  if (queryError) return <div className="grid min-h-[calc(60vh/var(--font-scale,1))] place-items-center px-5 text-center text-[12px] font-semibold text-red-500">자원예약 데이터를 불러오지 못했습니다.<br />{queryError instanceof Error ? queryError.message : ''}</div>;
  if (!actor) return <div className="grid min-h-[calc(60vh/var(--font-scale,1))] place-items-center text-[12px] font-semibold text-ink3">사용자 정보를 불러올 수 없습니다.</div>;

  return (
    <div className="mx-auto w-full max-w-[1500px] px-4 py-5 sm:px-6 sm:py-6">
      <GwHead
        icon="📦"
        name="자원예약"
        right={
          <div className="flex items-center gap-2">
            {!authenticatedUser && (
              <select value={actor.id} onChange={(event) => setDemoUserId(event.target.value)} title="사용자 선택" className="h-9 rounded-lg border border-amber/30 bg-amber-soft/30 px-3 text-[10.5px] font-bold text-ink outline-none">
                {users.filter((user) => user.status === '사용').map((user) => <option key={user.id} value={user.id}>{user.name} · {user.position || user.dept || '사원'}</option>)}
              </select>
            )}
            {canCreate && <Button onClick={() => changeTab('request')} variant="primary">+ 예약 신청</Button>}
          </div>
        }
      />

      {notice && <div className="mt-4 rounded-lg border border-teal/20 bg-teal-soft/25 px-3 py-2.5 text-[11px] font-semibold text-teal">{notice}</div>}
      {selectedReservationId && !selectedReservation && (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-amber/20 bg-amber-soft/25 px-3 py-2.5 text-[11px] font-semibold text-amber">
          <span>예약을 조회할 수 없거나 현재 계정에 상세 조회 권한이 없습니다.</span>
          <button type="button" onClick={closeReservation} className="shrink-0 rounded-md border border-amber/25 px-2 py-1 text-[9.5px] hover:bg-amber-soft/40">닫기</button>
        </div>
      )}

      <GwSplit
        nav={(
          <GwSideNav
            title="자원예약"
            desc="회의실·차량·장비를 예약하고 관리합니다."
            items={tabs.map((item) => ({
              id: item,
              icon: TAB_ICONS[item],
              label: TAB_LABELS[item],
              badge: item === 'approvals' && reservations.some((row) => row.status === 'PENDING' && resources.some((resource) => resource.id === row.resourceId && canApproveResource(actor, resource, isAdmin))) ? '대기' : undefined,
              badgeTone: 'amber' as const,
            }))}
            activeId={activeTab}
            onSelect={(id) => changeTab(id as TabId)}
          />
        )}
      >
      <main>
        {activeTab === 'overview' && <ResourceCalendar resources={resources} reservations={reservations} users={users} onReserve={(resource, date) => setModalTarget({ resource, date })} onSelectReservation={(row) => openReservation(row, 'overview')} />}
        {activeTab === 'request' && <div className="mx-auto max-w-2xl rounded-xl border border-border bg-panel p-5 shadow-sm"><div className="mb-4"><div className="text-[13px] font-bold text-ink">새 예약 신청</div><div className="mt-1 text-[10px] text-ink3">시간과 수량은 저장 시 다시 검증합니다.</div></div><ReservationForm actor={actor} resources={resources} departments={departments} onSuccess={reservationCreated} /></div>}
        {activeTab === 'my' && <MyReservations actor={actor} reservations={reservations} resources={resources} selectedReservationId={selectedReservationId} onSelectReservation={(row) => openReservation(row, 'my')} />}
        {activeTab === 'approvals' && <ReservationApprovals actor={actor} reservations={reservations} resources={resources} users={users} onSelectReservation={(row) => openReservation(row, 'approvals')} />}
        {activeTab === 'admin' && <ResourceAdmin actor={actor} resources={resources} users={users} departments={departments} />}
      </main>
      </GwSplit>

      <Modal open={modalTarget !== null} onClose={() => setModalTarget(null)} title="예약 신청" width={Math.min(640, window.innerWidth - 32)}>
        {modalTarget && <ReservationForm key={`${modalTarget.resource.id}-${modalTarget.date ?? ''}`} actor={actor} resources={resources} departments={departments} initialResourceId={modalTarget.resource.id} initialDate={modalTarget.date} onSuccess={reservationCreated} onCancel={() => setModalTarget(null)} />}
      </Modal>
      {selectedReservation && (
        <ReservationDetailModal
          reservation={selectedReservation}
          resource={selectedResource}
          users={users}
          showPrivateDetails={showPrivateDetails}
          onClose={closeReservation}
          onRequestCancel={
            ['PENDING', 'CONFIRMED'].includes(selectedReservation.status) && canCancelReservation(actor, selectedReservation, isAdmin)
              ? () => setCancelTarget(selectedReservation)
              : undefined
          }
          onApprove={
            selectedReservation.status === 'PENDING' && selectedResource && canApproveResource(actor, selectedResource, isAdmin)
              ? () => void approveSelected(selectedReservation)
              : undefined
          }
          onRequestReject={
            selectedReservation.status === 'PENDING' && selectedResource && canApproveResource(actor, selectedResource, isAdmin)
              ? () => setRejectTarget(selectedReservation)
              : undefined
          }
          approving={approveReservation.isPending}
          actionError={actionError}
        />
      )}
      {cancelTarget && (
        <ReservationReasonDialog
          title="예약 취소"
          description={`${cancelTarget.title} · ${cancelTarget.resourceNameSnapshot} · ${formatResourceDateTime(cancelTarget.startAt)} ~ ${formatResourceDateTime(cancelTarget.endAt)}`}
          label="취소 사유"
          confirmLabel="예약 취소"
          onClose={() => setCancelTarget(null)}
          onSubmit={async (reason) => {
            await cancelReservation.mutateAsync({ actor, id: cancelTarget.id, reason, isAdmin });
            // 상세 모달은 열어 둔다 — 취소 상태와 처리 이력이 바로 보인다.
            setCancelTarget(null);
            setNotice('예약을 취소했습니다.');
          }}
        />
      )}
      {rejectTarget && (
        <ReservationReasonDialog
          title="예약 반려"
          description={`${rejectTarget.title} · ${rejectTarget.resourceNameSnapshot} · ${formatResourceDateTime(rejectTarget.startAt)} ~ ${formatResourceDateTime(rejectTarget.endAt)}`}
          label="반려 사유"
          confirmLabel="반려"
          onClose={() => setRejectTarget(null)}
          onSubmit={async (reason) => {
            await rejectReservation.mutateAsync({ actor, id: rejectTarget.id, reason, isAdmin });
            setRejectTarget(null);
            setNotice('예약을 반려했습니다.');
          }}
        />
      )}
    </div>
  );
}

export default function ResourceScreen() {
  return <LocalResourceScreen />;
}
