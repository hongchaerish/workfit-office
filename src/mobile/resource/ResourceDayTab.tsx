import { useMemo, useState } from 'react';
import { Calendar, CheckCircle2, ChevronLeft, ChevronRight, Clock } from 'lucide-react';
import { RESOURCE_TYPE_LABELS, RESOURCE_TYPES, type Resource, type ResourceType } from '@/domain/resource/schema';
import type { Reservation } from '@/domain/reservation/schema';
import type { User } from '@/domain/user/schema';
import { useReservations } from '@/features/resource/useReservations';
import { addDays, dateRangeIso, formatResourceTime, toDateInput } from '@/modules/gw/resource/resourceDate';
import { EmptyBox, ResourceTypeIcon, StatusBadge, formatDateTitle } from './shared';

interface ResourceDayTabProps {
  date: string;
  onDateChange: (date: string) => void;
  resources: Resource[];
  users: User[];
  currentUserId: string;
  onReserve: (resource: Resource) => void;
  onOpenReservation: (reservation: Reservation) => void;
}

/** 현황에 보이는 상태 — 웹 예약 현황과 같다(취소·반려·만료는 시간을 점유하지 않으므로 숨김). */
const SHOWN_STATUSES = new Set<Reservation['status']>(['PENDING', 'CONFIRMED', 'COMPLETED']);

export default function ResourceDayTab({ date, onDateChange, resources, users, currentUserId, onReserve, onOpenReservation }: ResourceDayTabProps) {
  const [type, setType] = useState<ResourceType | ''>('');
  const today = toDateInput(new Date());
  const isToday = date === today;

  // 예약 시각은 ISO(UTC)로 저장되므로 그날 0시~익일 0시(KST) 구간으로 거른다.
  const dayRange = useMemo(() => dateRangeIso(date), [date]);
  const reservationsQuery = useReservations(dayRange);
  const reservations = useMemo(
    () => (reservationsQuery.data ?? []).filter((r) => SHOWN_STATUSES.has(r.status)).sort((a, b) => a.startAt.localeCompare(b.startAt)),
    [reservationsQuery.data],
  );

  // 자원이 있는 종류만 필터로 보여준다.
  const types = useMemo(() => RESOURCE_TYPES.filter((code) => resources.some((r) => r.typeCode === code)), [resources]);
  const shownResources = type ? resources.filter((r) => r.typeCode === type) : resources;
  const managerName = (id: string | null) => (id ? users.find((u) => u.id === id)?.name ?? id : '미지정');
  const userLabel = (id: string) => {
    const u = users.find((item) => item.id === id);
    return u ? `${u.name}${u.dept ? ` · ${u.dept}` : ''}` : id;
  };

  return (
    <div className="space-y-3">
      {/* 날짜 이동 — 가운데 날짜를 누르면 달력에서 바로 고른다. */}
      <div className="flex items-center justify-between gap-1 rounded-2xl border border-border/80 bg-white px-2 py-1.5 shadow-2xs">
        <button type="button" aria-label="이전 날" onClick={() => onDateChange(addDays(date, -1))} className="grid h-9 w-9 place-items-center rounded-xl text-ink2 hover:bg-panel-alt">
          <ChevronLeft size={18} />
        </button>
        <label className="relative flex min-w-0 flex-1 cursor-pointer items-center justify-center gap-1.5 text-[13.5px] font-bold text-ink">
          <Calendar size={14} className="shrink-0 text-teal" />
          <span className="truncate">{formatDateTitle(date)}</span>
          <input
            type="date"
            aria-label="날짜 선택"
            value={date}
            onChange={(e) => e.target.value && onDateChange(e.target.value)}
            onClick={(e) => { try { e.currentTarget.showPicker?.(); } catch { /* 지원하지 않는 브라우저는 기본 동작 */ } }}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </label>
        {!isToday && (
          <button type="button" onClick={() => onDateChange(today)} className="shrink-0 rounded-lg border border-teal/30 px-2 py-1 text-[11px] font-bold text-teal">오늘</button>
        )}
        <button type="button" aria-label="다음 날" onClick={() => onDateChange(addDays(date, 1))} className="grid h-9 w-9 place-items-center rounded-xl text-ink2 hover:bg-panel-alt">
          <ChevronRight size={18} />
        </button>
      </div>

      {types.length > 1 && (
        <div className="-mx-3.5 flex gap-1.5 overflow-x-auto px-3.5 pb-0.5">
          {(['', ...types] as Array<ResourceType | ''>).map((code) => (
            <button
              key={code || 'all'}
              type="button"
              onClick={() => setType(code)}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-[11.5px] font-bold ${type === code ? 'border-teal bg-teal text-white' : 'border-border bg-white text-ink2'}`}
            >
              {code ? RESOURCE_TYPE_LABELS[code] : '전체'}
            </button>
          ))}
        </div>
      )}

      {reservationsQuery.isError && <p role="alert" className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-[12px] text-rose-600">예약 현황을 불러오지 못했습니다.</p>}

      {shownResources.length === 0 ? (
        <EmptyBox>등록된 자원이 없습니다.</EmptyBox>
      ) : (
        shownResources.map((res) => {
          const rows = reservations.filter((r) => r.resourceId === res.id);
          return (
            <div key={res.id} className="space-y-2.5 rounded-2xl border border-border/80 bg-white p-3.5 shadow-2xs">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-panel-alt"><ResourceTypeIcon typeCode={res.typeCode} /></div>
                  <div className="min-w-0">
                    <h3 className="truncate text-[13.5px] font-bold text-ink">{res.name}</h3>
                    <p className="truncate text-[10.5px] text-ink3">
                      {RESOURCE_TYPE_LABELS[res.typeCode]}{res.location ? ` · ${res.location}` : ''}{res.capacity ? ` · ${res.capacity}명` : ''}{res.bookingMode === 'QUANTITY' ? ` · 전체 ${res.totalQuantity}${res.unitCode}` : ''}                    </p>
                    <p className={`truncate text-[10.5px] font-semibold ${res.approvalMode === 'APPROVAL' ? 'text-amber-700' : 'text-ink3'}`}>
                      {res.approvalMode === 'APPROVAL' ? '승인 필요' : '즉시 확정'} · 담당 {managerName(res.managerUserId)}
                    </p>
                  </div>
                </div>
                {res.status === 'ACTIVE' ? (
                  <button type="button" onClick={() => onReserve(res)} className="shrink-0 rounded-xl bg-teal-soft/20 px-2.5 py-1.5 text-[11px] font-bold text-teal hover:bg-teal-soft/40">예약하기</button>
                ) : (
                  <span className="shrink-0 rounded-xl bg-panel-alt px-2.5 py-1.5 text-[11px] font-bold text-ink3">예약 불가</span>
                )}
              </div>

              <div className="space-y-1.5 border-t border-border/50 pt-2">
                {rows.length === 0 ? (
                  <p className="flex items-center gap-1 py-1 text-[11px] font-semibold text-emerald-600">
                    <CheckCircle2 size={13} />
                    {isToday ? '오늘' : '이 날'} 예약 없음
                  </p>
                ) : (
                  rows.map((r) => {
                    const mine = r.requesterUserId === currentUserId;
                    return (
                      <button
                        key={r.id}
                        type="button"
                        aria-label={`${r.title} 예약 상세 보기`}
                        onClick={() => onOpenReservation(r)}
                        className={`block w-full rounded-xl px-2.5 py-2 text-left text-[11.5px] ${mine ? 'bg-teal-soft/20 ring-1 ring-inset ring-teal/20' : 'bg-panel-alt/60'}`}
                      >
                        <div className="flex items-center gap-1.5">
                          <Clock size={12} className="shrink-0 text-teal" />
                          <span className="shrink-0 whitespace-nowrap font-mono font-bold text-ink">{formatResourceTime(r.startAt)} ~ {formatResourceTime(r.endAt)}</span>
                          {r.status !== 'CONFIRMED' && <StatusBadge status={r.status} />}
                          {mine && <span className="shrink-0 rounded-md bg-teal px-1.5 py-0.5 text-[10px] font-bold text-white">내 예약</span>}
                          <ChevronRight size={14} className="ml-auto shrink-0 text-ink3" />
                        </div>
                        <p className="mt-1 break-words font-medium text-ink2">{r.title}</p>
                        <p className="mt-0.5 truncate text-[10.5px] text-ink3">{userLabel(r.requesterUserId)}{r.quantity > 1 ? ` · ${r.quantity}${res.unitCode}` : ''}</p>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
