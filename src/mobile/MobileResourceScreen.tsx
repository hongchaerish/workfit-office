import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useAuth } from '@/app/auth/AuthProvider';
import { usePermission } from '@/features/auth/usePermission';
import { useResources } from '@/features/resource/useResources';
import {
  useApproveReservation,
  useCancelReservation,
  useRejectReservation,
  useRescheduleReservation,
  useReservations,
} from '@/features/resource/useReservations';
import { useDepartments } from '@/features/department/useDepartments';
import { useUsers } from '@/features/user/useUsers';
import type { Reservation } from '@/domain/reservation/schema';
import { canApproveResource, canCancelReservation } from '@/domain/reservation/engine';
import { toDateInput } from '@/modules/gw/resource/resourceDate';
import MobileCommonHeader from './MobileCommonHeader';
import ResourceDayTab from './resource/ResourceDayTab';
import MyReservationsTab from './resource/MyReservationsTab';
import ApprovalsTab from './resource/ApprovalsTab';
import ReservationDetailSheet from './resource/ReservationDetailSheet';
import ReservationFormSheet from './resource/ReservationFormSheet';
import ReasonSheet from './resource/ReasonSheet';
import RescheduleSheet from './resource/RescheduleSheet';
import { ErrorBox } from './resource/shared';

type TabId = 'overview' | 'my' | 'approvals';
const TAB_LABELS: Record<TabId, string> = { overview: '예약 현황', my: '내 예약', approvals: '승인 관리' };

/**
 * PWA 자원예약 — 웹 자원예약의 예약 현황·내 예약·승인 관리를 탭으로 제공한다(자원 관리는 웹 전용).
 * 신청·취소·변경·승인·반려는 모두 웹과 같은 저장 경로를 쓰고, 권한·충돌·마감은 저장 시 다시 검사한다.
 * 본인 예약 취소·변경에는 관리자 예외를 적용하지 않는다(기존 PWA 동작 유지).
 */
export default function MobileResourceScreen() {
  const { user } = useAuth();
  const { isAdmin } = usePermission();
  const [searchParams, setSearchParams] = useSearchParams();
  const [date, setDate] = useState(() => toDateInput(new Date()));
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');
  const [formTarget, setFormTarget] = useState<{ resourceId?: string; date: string } | null>(null);
  const [detail, setDetail] = useState<Reservation | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Reservation | null>(null);
  const [rescheduleTarget, setRescheduleTarget] = useState<Reservation | null>(null);
  const [rejectTarget, setRejectTarget] = useState<Reservation | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);

  const resources = useResources().data ?? [];
  const users = useUsers().data ?? [];
  const departments = useDepartments().data ?? [];
  const approveReservation = useApproveReservation();
  const rejectReservation = useRejectReservation();
  const cancelReservation = useCancelReservation();
  const rescheduleReservation = useRescheduleReservation();

  // 승인 대기는 날짜와 상관없이 모은다 — 관리자=전체 자원, 그 외=내 담당 자원.
  const pendingQuery = useReservations({ status: 'PENDING' });
  const canApprove = user ? resources.some((resource) => canApproveResource(user, resource, isAdmin)) : false;
  const pendingApprovals = useMemo(() => {
    if (!user) return [];
    return (pendingQuery.data ?? []).filter((row) => {
      const resource = resources.find((item) => item.id === row.resourceId);
      return Boolean(resource && canApproveResource(user, resource, isAdmin));
    }).sort((a, b) => a.startAt.localeCompare(b.startAt));
  }, [pendingQuery.data, resources, user, isAdmin]);

  // 처리 결과 안내는 화면 아래 알림으로 띄웠다가 자동으로 지운다(목록을 스크롤해 있어도 보이도록).
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const tabs: TabId[] = canApprove ? ['overview', 'my', 'approvals'] : ['overview', 'my'];
  const requestedTab = searchParams.get('tab') as TabId | null;
  const tab: TabId = requestedTab && tabs.includes(requestedTab) ? requestedTab : 'overview';

  const changeTab = (next: TabId) => {
    setNotice('');
    setActionError('');
    setSearchParams({ tab: next }, { replace: true });
  };

  if (!user) return null;

  const resourceOf = (row: Reservation) => resources.find((item) => item.id === row.resourceId);
  const isOwnActive = (row: Reservation) => canCancelReservation(user, row) && (row.status === 'PENDING' || row.status === 'CONFIRMED');
  const isApprovable = (row: Reservation) => {
    const resource = resourceOf(row);
    return row.status === 'PENDING' && Boolean(resource && canApproveResource(user, resource, isAdmin));
  };

  const openDetail = (row: Reservation) => {
    setActionError('');
    setDetail(row);
  };
  // 상세에서 취소·변경·반려를 고르면 상세를 닫고 해당 입력 창을 연다.
  const startCancel = (row: Reservation) => { setDetail(null); setNotice(''); setCancelTarget(row); };
  const startReschedule = (row: Reservation) => { setDetail(null); setNotice(''); setRescheduleTarget(row); };
  const startReject = (row: Reservation) => { setDetail(null); setNotice(''); setRejectTarget(row); };

  const approve = async (row: Reservation) => {
    if (approvingId) return;
    setApprovingId(row.id);
    setActionError('');
    setNotice('');
    try {
      await approveReservation.mutateAsync({ actor: user, id: row.id, isAdmin });
      setDetail(null);
      setNotice(`'${row.title}' 예약을 승인했습니다.`);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : '승인 처리에 실패했습니다.');
    } finally {
      setApprovingId(null);
    }
  };

  const detailResource = detail ? resourceOf(detail) : undefined;
  const rescheduleResource = rescheduleTarget ? resourceOf(rescheduleTarget) : undefined;

  return (
    <div className="flex h-full flex-col select-none overflow-hidden" style={{ background: '#f2f8fc' }}>
      <MobileCommonHeader
        title="자원예약"
        rightAction={
          <button
            type="button"
            onClick={() => { setNotice(''); setFormTarget({ date }); }}
            className="grid h-8 w-8 cursor-pointer place-items-center rounded-xl bg-teal text-white shadow-2xs transition-all hover:opacity-90 active:scale-95"
            title="예약 신청"
            aria-label="예약 신청"
          >
            <Plus size={18} strokeWidth={2.2} />
          </button>
        }
      />

      <nav className="flex shrink-0 border-b border-border/70 bg-white px-2 shadow-2xs" aria-label="자원예약 메뉴">
        {tabs.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => changeTab(item)}
            aria-current={tab === item ? 'page' : undefined}
            className={`relative flex flex-1 items-center justify-center gap-1 py-2.5 text-[12.5px] font-bold ${tab === item ? 'text-teal' : 'text-ink3'}`}
          >
            {TAB_LABELS[item]}
            {item === 'approvals' && pendingApprovals.length > 0 && (
              <span className="rounded-full bg-amber-500 px-1.5 text-[10px] font-extrabold leading-4 text-white">{pendingApprovals.length}</span>
            )}
            {tab === item && <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-teal" />}
          </button>
        ))}
      </nav>

      <div className="flex-1 space-y-3 overflow-y-auto px-3.5 py-3">
        {actionError && !detail && <ErrorBox>{actionError}</ErrorBox>}

        {tab === 'overview' && (
          <ResourceDayTab
            date={date}
            onDateChange={(next) => { setNotice(''); setDate(next); }}
            resources={resources}
            users={users}
            currentUserId={user.id}
            onReserve={(resource) => { setNotice(''); setFormTarget({ resourceId: resource.id, date }); }}
            onOpenReservation={openDetail}
          />
        )}
        {tab === 'my' && (
          <MyReservationsTab
            currentUserId={user.id}
            resources={resources}
            onOpenReservation={openDetail}
            onReschedule={startReschedule}
            onCancel={startCancel}
            busy={cancelReservation.isPending || rescheduleReservation.isPending}
          />
        )}
        {tab === 'approvals' && (
          <ApprovalsTab
            isAdmin={isAdmin}
            pending={pendingApprovals}
            resources={resources}
            users={users}
            onOpenReservation={openDetail}
            onApprove={(row) => void approve(row)}
            onReject={startReject}
            approvingId={approvingId}
          />
        )}
      </div>

      {notice && (
        <div className="pointer-events-none fixed inset-x-0 z-[70] flex justify-center px-4" style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 20px)' }}>
          <p role="status" className="pointer-events-auto max-w-[420px] rounded-2xl bg-[#101830] px-4 py-3 text-center text-[12.5px] font-semibold text-white shadow-xl" onClick={() => setNotice('')}>
            {notice}
          </p>
        </div>
      )}

      {detail && (
        <ReservationDetailSheet
          reservation={detail}
          resource={detailResource}
          users={users}
          showPrivateDetails={detail.requesterUserId === user.id || Boolean(detailResource && canApproveResource(user, detailResource, isAdmin))}
          onClose={() => { if (!approvingId) { setDetail(null); setActionError(''); } }}
          onCancel={isOwnActive(detail) ? () => startCancel(detail) : undefined}
          onReschedule={isOwnActive(detail) && detailResource ? () => startReschedule(detail) : undefined}
          onApprove={isApprovable(detail) ? () => void approve(detail) : undefined}
          onReject={isApprovable(detail) ? () => startReject(detail) : undefined}
          approving={approvingId === detail.id}
          actionError={actionError}
        />
      )}

      {formTarget && (
        <ReservationFormSheet
          actor={user}
          resources={resources}
          users={users}
          departments={departments}
          initialResourceId={formTarget.resourceId}
          initialDate={formTarget.date}
          onClose={() => setFormTarget(null)}
          onCreated={(row) => {
            setFormTarget(null);
            setDate(toDateInput(new Date(row.startAt)));
            setNotice(row.status === 'PENDING' ? `'${row.title}' 예약을 신청했습니다. 담당자 승인을 기다립니다.` : `'${row.title}' 예약이 확정되었습니다.`);
          }}
        />
      )}

      {cancelTarget && (
        <ReasonSheet
          kind="cancel"
          reservation={cancelTarget}
          onClose={() => setCancelTarget(null)}
          onSubmit={async (reason) => {
            // 웹과 같은 저장소가 최신 예약 상태·취소 마감을 검사한다.
            await cancelReservation.mutateAsync({ actor: user, id: cancelTarget.id, reason });
            setCancelTarget(null);
            setNotice('예약을 취소했습니다.');
          }}
        />
      )}

      {rejectTarget && (
        <ReasonSheet
          kind="reject"
          reservation={rejectTarget}
          onClose={() => setRejectTarget(null)}
          onSubmit={async (reason) => {
            await rejectReservation.mutateAsync({ actor: user, id: rejectTarget.id, reason, isAdmin });
            setRejectTarget(null);
            setNotice(`'${rejectTarget.title}' 예약을 반려했습니다.`);
          }}
        />
      )}

      {rescheduleTarget && rescheduleResource && (
        <RescheduleSheet
          reservation={rescheduleTarget}
          resource={rescheduleResource}
          onClose={() => setRescheduleTarget(null)}
          onSubmit={async (next) => {
            const updated = await rescheduleReservation.mutateAsync({ actor: user, id: rescheduleTarget.id, next });
            setRescheduleTarget(null);
            setDate(toDateInput(new Date(updated.startAt)));
            setNotice(updated.status === 'PENDING' ? '예약 시간을 변경했습니다. 담당자 재승인을 기다립니다.' : '예약 시간을 변경했습니다.');
          }}
        />
      )}
    </div>
  );
}
