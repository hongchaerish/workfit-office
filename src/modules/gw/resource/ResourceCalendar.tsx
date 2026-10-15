import { useMemo, useState } from 'react';
import type { Resource, ResourceType } from '@/domain/resource/schema';
import { RESOURCE_TYPE_LABELS } from '@/domain/resource/schema';
import type { Reservation } from '@/domain/reservation/schema';
import type { User } from '@/domain/user/schema';
import { ReservationStatusBadge, ResourceStatusBadge } from './ResourceBadges';
import { addDays, formatResourceTime, isSameLocalDate, startOfWeek, toDateInput } from './resourceDate';
import { resourceMinuteOfDay } from '@/domain/reservation/time';

interface ResourceCalendarProps {
  resources: Resource[];
  reservations: Reservation[];
  users: User[];
  onReserve: (resource: Resource, date?: string) => void;
  onSelectReservation: (reservation: Reservation) => void;
}

const DISPLAY_STATUSES = new Set(['PENDING', 'CONFIRMED', 'COMPLETED']);
const minutes = (value: string) => {
  const [hours, minute] = value.split(':').map(Number);
  return hours * 60 + minute;
};

function ApprovalModeBadge({ resource }: { resource: Resource }) {
  const approvalRequired = resource.approvalMode === 'APPROVAL';
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[8.5px] font-bold ${approvalRequired ? 'bg-amber-soft text-amber' : 'bg-teal-soft text-teal'}`}>
      {approvalRequired ? '승인 필요' : '즉시 확정'}
    </span>
  );
}

export default function ResourceCalendar({ resources, reservations, users, onReserve, onSelectReservation }: ResourceCalendarProps) {
  const [date, setDate] = useState(() => toDateInput(new Date()));
  const [view, setView] = useState<'day' | 'week'>('day');
  const [type, setType] = useState<ResourceType | ''>('');
  const [query, setQuery] = useState('');

  const filteredResources = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return resources.filter((resource) =>
      resource.status !== 'INACTIVE'
      && (!type || resource.typeCode === type)
      && (!keyword || [resource.name, resource.code, resource.location].some((value) => value.toLowerCase().includes(keyword))),
    );
  }, [query, resources, type]);

  const weekStart = startOfWeek(date);
  const weekDates = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const userName = (id: string) => users.find((user) => user.id === id)?.name ?? id;
  // 예약 시간에 운영시간 제한이 없으므로, 보이는 날짜의 예약이 축 밖으로 잘리지 않게 축을 넓힌다.
  const shownDates = view === 'day' ? [date] : weekDates;
  const shownRows = reservations.filter((row) => DISPLAY_STATUSES.has(row.status) && shownDates.some((day) => isSameLocalDate(row.startAt, day)));
  const rowStarts = shownRows.map((row) => resourceMinuteOfDay(new Date(row.startAt)));
  const rowEnds = shownRows.map((row) => (isSameLocalDate(row.endAt, toDateInput(new Date(row.startAt))) ? resourceMinuteOfDay(new Date(row.endAt)) : 24 * 60));
  const axisStart = Math.floor(Math.min(...filteredResources.map((resource) => minutes(resource.availableFrom)), ...rowStarts, 8 * 60) / 60) * 60;
  const axisEnd = Math.min(24 * 60, Math.ceil(Math.max(...filteredResources.map((resource) => minutes(resource.availableTo)), ...rowEnds, 20 * 60) / 60) * 60);
  const axisDuration = axisEnd - axisStart;
  const axisLabels = Array.from({ length: Math.floor(axisDuration / 120) + 1 }, (_, index) => axisStart + index * 120).filter((value) => value <= axisEnd);
  const visibleRows = (resourceId: string, targetDate: string) => reservations
    .filter((row) => row.resourceId === resourceId && DISPLAY_STATUSES.has(row.status) && isSameLocalDate(row.startAt, targetDate))
    .sort((a, b) => a.startAt.localeCompare(b.startAt));

  const moveDate = (amount: number) => setDate((current) => addDays(current, amount * (view === 'day' ? 1 : 7)));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-panel p-3 shadow-sm">
        <button type="button" onClick={() => moveDate(-1)} className="grid h-8 w-8 place-items-center rounded-lg border border-border text-ink2 hover:bg-panel-alt">‹</button>
        <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="h-8 rounded-lg border border-border bg-panel px-2.5 text-[11px] font-semibold text-ink outline-none focus:border-teal" />
        <button type="button" onClick={() => setDate(toDateInput(new Date()))} className="h-8 rounded-lg border border-border px-3 text-[11px] font-bold text-ink2 hover:bg-panel-alt">오늘</button>
        <button type="button" onClick={() => moveDate(1)} className="grid h-8 w-8 place-items-center rounded-lg border border-border text-ink2 hover:bg-panel-alt">›</button>
        <span className="mx-1 h-5 w-px bg-border" />
        <div className="flex rounded-lg border border-border p-0.5">
          {(['day', 'week'] as const).map((item) => (
            <button key={item} type="button" onClick={() => setView(item)} className={`rounded-md px-3 py-1.5 text-[10.5px] font-bold ${view === item ? 'bg-teal text-white' : 'text-ink3 hover:bg-panel-alt'}`}>
              {item === 'day' ? '일간' : '주간'}
            </button>
          ))}
        </div>
        <select value={type} onChange={(event) => setType(event.target.value as ResourceType | '')} className="ml-auto h-8 rounded-lg border border-border bg-panel px-2.5 text-[11px] text-ink outline-none focus:border-teal">
          <option value="">전체 분류</option>
          {Object.entries(RESOURCE_TYPE_LABELS).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
        </select>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="자원·위치 검색" className="h-8 w-44 rounded-lg border border-border bg-panel px-3 text-[11px] text-ink outline-none focus:border-teal" />
      </div>

      {filteredResources.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-panel py-16 text-center text-[12px] text-ink3">조건에 맞는 자원이 없습니다.</div>
      ) : view === 'day' ? (
        <div className="overflow-x-auto rounded-xl border border-border bg-panel shadow-sm">
          <div className="flex border-b border-border bg-panel-alt/50 text-[9px] font-semibold text-ink3">
            <div className="w-52 shrink-0 px-4 py-2">자원</div>
            <div className="relative h-8 min-w-[720px] flex-1">
              {axisLabels.map((minute) => (
                <span key={minute} className="absolute top-2 -translate-x-1/2" style={{ left: `${((minute - axisStart) / axisDuration) * 100}%` }}>{String(Math.floor(minute / 60)).padStart(2, '0')}:00</span>
              ))}
            </div>
          </div>
          <div className="divide-y divide-border">
            {filteredResources.map((resource) => {
              const rows = visibleRows(resource.id, date);
              return (
                <div key={resource.id} className="flex hover:bg-panel-alt/20" style={{ minHeight: `${Math.max(76, rows.length * 52 + 12)}px` }}>
                  <div className="w-52 shrink-0 border-r border-border px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-[12px] font-bold text-ink">{resource.name}</div>
                        <div className="mt-0.5 truncate text-[9.5px] text-ink3">{resource.location}</div>
                        <div className="mt-1"><ApprovalModeBadge resource={resource} /></div>
                      </div>
                      <ResourceStatusBadge status={resource.status} />
                    </div>
                    <button type="button" disabled={resource.status !== 'ACTIVE'} onClick={() => onReserve(resource, date)} className="mt-2 text-[10px] font-bold text-teal hover:underline disabled:cursor-not-allowed disabled:text-ink3">+ 예약</button>
                  </div>
                  <div className="relative min-w-[720px] flex-1 bg-[linear-gradient(to_right,transparent_calc(100%-1px),rgba(151,164,182,0.18)_1px)]" style={{ backgroundSize: `${(60 / axisDuration) * 100}% 100%` }}>
                    {rows.map((row, rowIndex) => {
                      const start = new Date(row.startAt);
                      const end = new Date(row.endAt);
                      const startMinute = resourceMinuteOfDay(start);
                      const endMinute = resourceMinuteOfDay(end);
                      const left = Math.max(0, ((startMinute - axisStart) / axisDuration) * 100);
                      const right = Math.min(100, ((endMinute - axisStart) / axisDuration) * 100);
                      return (
                        <button type="button" key={row.id} onClick={() => onSelectReservation(row)} aria-label={`${row.title} 예약 상세 보기`} title={`${row.title} · ${userName(row.requesterUserId)} · ${formatResourceTime(row.startAt)}~${formatResourceTime(row.endAt)}`} className={`absolute h-12 overflow-hidden rounded-lg border px-2 py-1.5 text-left shadow-sm focus:outline-none focus:ring-2 focus:ring-teal/40 ${row.status === 'PENDING' ? 'border-amber/30 bg-amber-soft/70 text-amber' : 'border-teal/25 bg-teal-soft/80 text-teal'}`} style={{ left: `${left}%`, width: `${Math.max(2, right - left)}%`, top: `${8 + rowIndex * 52}px`, zIndex: rowIndex + 1 }}>
                          <div className="truncate text-[10px] font-extrabold">{row.title}</div>
                          <div className="truncate text-[8.5px] opacity-80">{formatResourceTime(row.startAt)} · {userName(row.requesterUserId)}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-panel shadow-sm">
          <table className="min-w-[1040px] w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-border bg-panel-alt/50 text-[10px] font-bold text-ink3">
                <th className="w-48 border-r border-border px-4 py-3">자원</th>
                {weekDates.map((weekDate) => <th key={weekDate} className={`min-w-28 border-r border-border px-2 py-3 text-center ${weekDate === toDateInput(new Date()) ? 'text-teal' : ''}`}>{weekDate.slice(5)}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredResources.map((resource) => (
                <tr key={resource.id} className="align-top">
                  <td className="border-r border-border px-4 py-3">
                    <div className="text-[11px] font-bold text-ink">{resource.name}</div>
                    <div className="mt-0.5 text-[9px] text-ink3">{resource.location}</div>
                    <div className="mt-1"><ApprovalModeBadge resource={resource} /></div>
                  </td>
                  {weekDates.map((weekDate) => {
                    const rows = visibleRows(resource.id, weekDate);
                    return (
                      <td key={weekDate} className="h-24 border-r border-border p-1.5">
                        <button type="button" disabled={resource.status !== 'ACTIVE'} onClick={() => onReserve(resource, weekDate)} className="mb-1 text-[9px] font-bold text-teal hover:underline disabled:hidden">+ 예약</button>
                        <div className="space-y-1">
                          {rows.map((row) => (
                            <button type="button" key={row.id} onClick={() => onSelectReservation(row)} aria-label={`${row.title} 예약 상세 보기`} className="block w-full rounded-md border border-border bg-panel-alt/60 px-1.5 py-1 text-left hover:border-teal/30 focus:outline-none focus:ring-2 focus:ring-teal/30">
                              <div className="truncate text-[9px] font-bold text-ink">{formatResourceTime(row.startAt)} {row.title}</div>
                              <ReservationStatusBadge status={row.status} />
                            </button>
                          ))}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
