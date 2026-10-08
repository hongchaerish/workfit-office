import { useState } from 'react';
import type { Department } from '@/domain/department/schema';
import type { Resource, ResourceDraft, ResourceType, ResourceBookingMode, ResourceApprovalMode, ResourceStatus } from '@/domain/resource/schema';
import { RESOURCE_STATUS_LABELS, RESOURCE_TYPE_LABELS } from '@/domain/resource/schema';
import type { User } from '@/domain/user/schema';
import { useSaveResource, useDeleteResource } from '@/features/resource/useResources';
import { useCancelUpcomingByResource } from '@/features/resource/useReservations';
import { reservationRepo } from '@/data/reservation/reservation.repo';
import { usePermission } from '@/features/auth/usePermission';
import { Modal } from '@/shared/ui/Modal';
import { ResourceStatusBadge } from './ResourceBadges';
import { Button } from '@/shared/ui/Button';

interface ResourceAdminProps {
  actor: User;
  resources: Resource[];
  users: User[];
  departments: Department[];
}

function draftFrom(resource?: Resource): ResourceDraft {
  return resource ? {
    code: resource.code, name: resource.name, typeCode: resource.typeCode, bookingMode: resource.bookingMode,
    location: resource.location, description: resource.description, capacity: resource.capacity,
    totalQuantity: resource.totalQuantity, unitCode: resource.unitCode, managerUserId: resource.managerUserId,
    ownerDeptId: resource.ownerDeptId, approvalMode: resource.approvalMode, slotMinutes: resource.slotMinutes,
    minDurationMinutes: resource.minDurationMinutes, maxDurationMinutes: resource.maxDurationMinutes,
    bufferBeforeMinutes: resource.bufferBeforeMinutes, bufferAfterMinutes: resource.bufferAfterMinutes,
    maxAdvanceDays: resource.maxAdvanceDays, cancelDeadlineMinutes: resource.cancelDeadlineMinutes,
    availableFrom: resource.availableFrom, availableTo: resource.availableTo, status: resource.status,
    imageUrl: resource.imageUrl, notes: resource.notes,
  } : {
    code: '', name: '', typeCode: 'ROOM', bookingMode: 'TIME_SLOT', location: '', description: '', capacity: 8,
    totalQuantity: 1, unitCode: 'EA', managerUserId: null, ownerDeptId: null, approvalMode: 'INSTANT',
    slotMinutes: 30, minDurationMinutes: 30, maxDurationMinutes: 480, bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0, maxAdvanceDays: 60, cancelDeadlineMinutes: 30, availableFrom: '08:00',
    availableTo: '20:00', status: 'ACTIVE', imageUrl: null, notes: '',
  };
}

function ResourceEditor({ actor, canManage, resource, users, departments, onClose }: { actor: User; canManage: boolean; resource?: Resource; users: User[]; departments: Department[]; onClose: () => void }) {
  const [draft, setDraft] = useState<ResourceDraft>(() => draftFrom(resource));
  const [error, setError] = useState('');
  /** 사용 중 → 점검·미사용 전환 시 남은 예정 예약 수. 0보다 크면 처리 방법을 묻는다. */
  const [affectedCount, setAffectedCount] = useState(0);
  const [checking, setChecking] = useState(false);
  const saveResource = useSaveResource();
  const deleteResource = useDeleteResource();
  const cancelUpcoming = useCancelUpcomingByResource();
  const suspending = Boolean(resource && resource.status === 'ACTIVE' && draft.status !== 'ACTIVE');
  const set = <K extends keyof ResourceDraft>(key: K, value: ResourceDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const inputClass = 'h-9 w-full rounded-lg border border-border bg-panel px-3 text-[11px] text-ink outline-none focus:border-teal';
  const labelClass = 'mb-1.5 block text-[10px] font-bold text-ink2';

  const save = async (cancelReservations: boolean) => {
    setError('');
    try {
      await saveResource.mutateAsync({ actor, draft, id: resource?.id, canManage });
      if (cancelReservations && resource) {
        const label = draft.status === 'MAINTENANCE' ? '점검' : '미사용';
        await cancelUpcoming.mutateAsync({ actor, resourceId: resource.id, reason: `자원 ${label} 전환으로 관리자 일괄 취소`, canManage });
      }
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '자원 저장에 실패했습니다.');
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    // 사용 중 자원을 점검·미사용으로 돌리면 이미 잡힌 예약을 어떻게 할지 먼저 묻는다.
    if (suspending && resource && affectedCount === 0) {
      setChecking(true);
      try {
        const upcoming = await reservationRepo.listUpcomingByResource(resource.id);
        if (upcoming.length > 0) {
          setAffectedCount(upcoming.length);
          return;
        }
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : '예정 예약을 확인하지 못했습니다.');
        return;
      } finally {
        setChecking(false);
      }
    }
    await save(false);
  };

  const handleDelete = async () => {
    if (!resource) return;
    if (confirm(`정말 [${resource.name}] 자원을 완전히 삭제하시겠습니까?`)) {
      setError('');
      try {
        await deleteResource.mutateAsync({ actor, id: resource.id, canManage });
        onClose();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : '자원 삭제에 실패했습니다.');
      }
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <label><span className={labelClass}>자원 코드</span><input required value={draft.code} onChange={(event) => set('code', event.target.value.toUpperCase())} className={inputClass} /></label>
        <label><span className={labelClass}>자원명</span><input required value={draft.name} onChange={(event) => set('name', event.target.value)} className={inputClass} /></label>
        <label><span className={labelClass}>분류</span><select value={draft.typeCode} onChange={(event) => { const typeCode = event.target.value as ResourceType; setDraft((current) => ({ ...current, typeCode, capacity: typeCode === 'ROOM' ? (current.capacity ?? 1) : null })); }} className={inputClass}>{Object.entries(RESOURCE_TYPE_LABELS).map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></label>
        <label><span className={labelClass}>예약 방식</span><select value={draft.bookingMode} onChange={(event) => { const mode = event.target.value as ResourceBookingMode; setDraft((current) => ({ ...current, bookingMode: mode, totalQuantity: mode === 'TIME_SLOT' ? 1 : Math.max(1, current.totalQuantity) })); }} className={inputClass}><option value="TIME_SLOT">시간형</option><option value="QUANTITY">수량형</option></select></label>
        <label className="sm:col-span-2"><span className={labelClass}>위치</span><input required value={draft.location} onChange={(event) => set('location', event.target.value)} className={inputClass} /></label>
        <label className="sm:col-span-2"><span className={labelClass}>설명</span><textarea rows={2} value={draft.description} onChange={(event) => set('description', event.target.value)} className="w-full resize-none rounded-lg border border-border bg-panel px-3 py-2 text-[11px] outline-none focus:border-teal" /></label>
        {draft.typeCode === 'ROOM' && <label><span className={labelClass}>수용 인원</span><input type="number" min={1} required value={draft.capacity ?? 1} onChange={(event) => set('capacity', Number(event.target.value))} className={inputClass} /></label>}
        {draft.bookingMode === 'QUANTITY' && <label><span className={labelClass}>전체 수량</span><input type="number" min={1} required value={draft.totalQuantity} onChange={(event) => set('totalQuantity', Number(event.target.value))} className={inputClass} /></label>}
        <label><span className={labelClass}>단위</span><input required value={draft.unitCode} onChange={(event) => set('unitCode', event.target.value)} className={inputClass} /></label>
        <label><span className={labelClass}>승인 방식</span><select value={draft.approvalMode} onChange={(event) => set('approvalMode', event.target.value as ResourceApprovalMode)} className={inputClass}><option value="INSTANT">즉시 확정</option><option value="APPROVAL">담당자 승인</option></select></label>
        <label><span className={labelClass}>담당자 {draft.approvalMode === 'APPROVAL' && '(필수)'}</span><select required={draft.approvalMode === 'APPROVAL'} value={draft.managerUserId ?? ''} onChange={(event) => set('managerUserId', event.target.value || null)} className={inputClass}><option value="">미지정</option>{users.filter((user) => user.status === '사용').map((user) => <option key={user.id} value={user.id}>{user.name} · {user.dept}</option>)}</select></label>
        <label><span className={labelClass}>소유 부서</span><select value={draft.ownerDeptId ?? ''} onChange={(event) => set('ownerDeptId', event.target.value || null)} className={inputClass}><option value="">미지정</option>{departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label>
        <label><span className={labelClass}>상태</span><select value={draft.status} onChange={(event) => { set('status', event.target.value as ResourceStatus); setAffectedCount(0); }} className={inputClass}>{Object.entries(RESOURCE_STATUS_LABELS).map(([status, label]) => <option key={status} value={status}>{label}</option>)}</select></label>
      </div>

      <div>
        <div className="mb-3 text-[11px] font-extrabold text-ink">예약 정책</div>
        <div className="grid gap-3 sm:grid-cols-3">
          <label><span className={labelClass}>슬롯(분)</span><input type="number" min={10} required value={draft.slotMinutes} onChange={(event) => set('slotMinutes', Number(event.target.value))} className={inputClass} /></label>
          <label><span className={labelClass}>최소 이용(분)</span><input type="number" min={10} required value={draft.minDurationMinutes} onChange={(event) => set('minDurationMinutes', Number(event.target.value))} className={inputClass} /></label>
          <label><span className={labelClass}>최대 이용(분)</span><input type="number" min={10} required value={draft.maxDurationMinutes} onChange={(event) => set('maxDurationMinutes', Number(event.target.value))} className={inputClass} /></label>
          <label><span className={labelClass}>운영 시작</span><input type="time" required value={draft.availableFrom} onChange={(event) => set('availableFrom', event.target.value)} className={inputClass} /></label>
          <label><span className={labelClass}>운영 종료</span><input type="time" required value={draft.availableTo} onChange={(event) => set('availableTo', event.target.value)} className={inputClass} /></label>
          <label><span className={labelClass}>예약 가능(일)</span><input type="number" min={0} required value={draft.maxAdvanceDays} onChange={(event) => set('maxAdvanceDays', Number(event.target.value))} className={inputClass} /></label>
          <label><span className={labelClass}>취소 마감(분)</span><input type="number" min={0} required value={draft.cancelDeadlineMinutes} onChange={(event) => set('cancelDeadlineMinutes', Number(event.target.value))} className={inputClass} /></label>
          <label><span className={labelClass}>앞 버퍼(분)</span><input type="number" min={0} required value={draft.bufferBeforeMinutes} onChange={(event) => set('bufferBeforeMinutes', Number(event.target.value))} className={inputClass} /></label>
          <label><span className={labelClass}>뒤 버퍼(분)</span><input type="number" min={0} required value={draft.bufferAfterMinutes} onChange={(event) => set('bufferAfterMinutes', Number(event.target.value))} className={inputClass} /></label>
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2.5 text-[11px] font-semibold text-red-500">{error}</div>}
      {affectedCount > 0 && suspending && (
        <div className="space-y-2.5 rounded-lg border border-amber/30 bg-amber-soft/25 px-3 py-3 text-[11px] text-ink2">
          <div className="font-bold text-amber">예정된 예약 {affectedCount}건이 있습니다.</div>
          <div>자원을 &lsquo;{RESOURCE_STATUS_LABELS[draft.status]}&rsquo;(으)로 바꾸면 새 예약은 막히지만, 이미 잡힌 예약은 그대로 남습니다. 함께 취소할까요?</div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button onClick={() => setAffectedCount(0)}>돌아가기</Button>
            <Button disabled={saveResource.isPending || cancelUpcoming.isPending} onClick={() => void save(false)}>예약은 유지</Button>
            <Button disabled={saveResource.isPending || cancelUpcoming.isPending} onClick={() => void save(true)} variant="danger">
              {cancelUpcoming.isPending ? '취소 중…' : `${affectedCount}건 함께 취소`}
            </Button>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between border-t border-border pt-4">
        <div>
          {resource && (
            <Button
              type="button"
              variant="danger"
              disabled={deleteResource.isPending}
              onClick={handleDelete}
            >
              {deleteResource.isPending ? '삭제 중…' : '자원 삭제'}
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button onClick={onClose}>취소</Button>
          <Button type="submit" disabled={saveResource.isPending || checking || affectedCount > 0} variant="primary">
            {saveResource.isPending || checking ? '저장 중…' : '저장'}
          </Button>
        </div>
      </div>
    </form>
  );
}

export default function ResourceAdmin({ actor, resources, users, departments }: ResourceAdminProps) {
  const { isAdmin, canAction } = usePermission();
  const [editing, setEditing] = useState<Resource | 'new' | null>(null);
  const [listError, setListError] = useState('');
  const deleteResource = useDeleteResource();
  const canManage = isAdmin || canAction('S_GW_RESOURCE', 'update');

  if (!canManage) return <div className="rounded-xl border border-dashed border-border bg-panel py-16 text-center text-[12px] text-ink3">자원 관리는 관리자만 사용할 수 있습니다.</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[13px] font-bold text-ink">자원 기준정보</div>
          <div className="mt-1 text-[10px] text-ink3">회의실, 차량, 공용장비 마스터 정보를 등록, 수정 또는 삭제합니다.</div>
        </div>
        <Button onClick={() => setEditing('new')} variant="primary">+ 자원 추가</Button>
      </div>
      {listError && <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2.5 text-[11px] font-semibold text-red-500">{listError}</div>}
      <div className="overflow-x-auto rounded-xl border border-border bg-panel shadow-sm">
        <table className="min-w-[900px] w-full border-collapse text-left text-[11px]">
          <thead>
            <tr className="border-b border-border bg-panel-alt/60 text-[10px] font-bold text-ink3">
              <th className="px-4 py-3">코드·자원명</th>
              <th className="px-4 py-3">분류</th>
              <th className="px-4 py-3">위치</th>
              <th className="px-4 py-3">방식</th>
              <th className="px-4 py-3">담당자</th>
              <th className="px-4 py-3">상태</th>
              <th className="px-4 py-3 text-right">관리</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {resources.map((resource) => (
              <tr key={resource.id} className="hover:bg-panel-alt/30">
                <td className="px-4 py-3">
                  <div className="font-bold text-ink">{resource.name}</div>
                  <div className="mt-0.5 font-mono text-[9px] text-ink3">{resource.code}</div>
                </td>
                <td className="px-4 py-3 text-ink2">{RESOURCE_TYPE_LABELS[resource.typeCode]}</td>
                <td className="px-4 py-3 text-ink2">{resource.location}</td>
                <td className="px-4 py-3">
                  <div className="font-semibold text-ink2">
                    {resource.bookingMode === 'TIME_SLOT' ? '시간형' : `수량형 · ${resource.totalQuantity}${resource.unitCode}`}
                  </div>
                  <div className="mt-0.5 text-[9px] text-ink3">
                    {resource.approvalMode === 'INSTANT' ? '즉시 확정' : '승인 필요'}
                  </div>
                </td>
                <td className="px-4 py-3 text-ink2">{users.find((user) => user.id === resource.managerUserId)?.name ?? '미지정'}</td>
                <td className="px-4 py-3"><ResourceStatusBadge status={resource.status} /></td>
                <td className="px-4 py-3 text-right space-x-1.5 whitespace-nowrap">
                  <Button onClick={() => setEditing(resource)} size="sm">수정</Button>
                  <Button
                    onClick={async () => {
                      if (!confirm(`정말 [${resource.name}] 자원을 완전히 삭제하시겠습니까?`)) return;
                      setListError('');
                      try {
                        await deleteResource.mutateAsync({ actor, id: resource.id, canManage });
                      } catch (caught) {
                        setListError(caught instanceof Error ? caught.message : '자원 삭제에 실패했습니다.');
                      }
                    }}
                    size="sm"
                    variant="danger"
                  >
                    삭제
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? '자원 추가' : '자원 수정'} width={Math.min(720, window.innerWidth - 32)}>
        {editing && <ResourceEditor key={editing === 'new' ? 'new' : editing.id} actor={actor} canManage={canManage} resource={editing === 'new' ? undefined : editing} users={users} departments={departments} onClose={() => setEditing(null)} />}
      </Modal>
    </div>
  );
}
