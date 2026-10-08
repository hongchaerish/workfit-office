import type { ReservationStatus } from '@/domain/reservation/schema';
import { RESERVATION_STATUS_LABELS } from '@/domain/reservation/schema';
import type { ResourceStatus } from '@/domain/resource/schema';
import { RESOURCE_STATUS_LABELS } from '@/domain/resource/schema';

const RESERVATION_TONE: Record<ReservationStatus, string> = {
  PENDING: 'bg-amber/15 text-amber',
  CONFIRMED: 'bg-teal/15 text-teal',
  REJECTED: 'bg-red-500/12 text-red-500',
  CANCELLED: 'bg-ink3/12 text-ink3',
  COMPLETED: 'bg-blue/12 text-blue',
  EXPIRED: 'bg-ink3/12 text-ink3',
};

const RESOURCE_TONE: Record<ResourceStatus, string> = {
  ACTIVE: 'bg-teal/15 text-teal',
  MAINTENANCE: 'bg-amber/15 text-amber',
  INACTIVE: 'bg-ink3/12 text-ink3',
};

export function ReservationStatusBadge({ status }: { status: ReservationStatus }) {
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${RESERVATION_TONE[status]}`}>{RESERVATION_STATUS_LABELS[status]}</span>;
}

export function ResourceStatusBadge({ status }: { status: ResourceStatus }) {
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${RESOURCE_TONE[status]}`}>{RESOURCE_STATUS_LABELS[status]}</span>;
}
