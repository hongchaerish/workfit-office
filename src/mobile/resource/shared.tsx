import type { ReactNode } from 'react';
import { Building2, Car, Laptop, Package, X } from 'lucide-react';
import { RESERVATION_STATUS_LABELS, type ReservationStatus } from '@/domain/reservation/schema';
import type { ResourceType } from '@/domain/resource/schema';

/** 예약 상태 색 — 웹 ResourceBadges와 같은 구분(대기=주황, 확정=청록, 완료=파랑, 반려=빨강, 취소·만료=회색). */
const STATUS_TONE: Record<ReservationStatus, string> = {
  PENDING: 'bg-amber-500/15 text-amber-700',
  CONFIRMED: 'bg-teal/15 text-teal',
  REJECTED: 'bg-rose-500/12 text-rose-600',
  CANCELLED: 'bg-ink3/12 text-ink3',
  COMPLETED: 'bg-blue-500/12 text-blue-600',
  EXPIRED: 'bg-ink3/12 text-ink3',
};

export function StatusBadge({ status }: { status: ReservationStatus }) {
  return <span className={`inline-block shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold ${STATUS_TONE[status]}`}>{RESERVATION_STATUS_LABELS[status]}</span>;
}

export function ResourceTypeIcon({ typeCode, size = 16 }: { typeCode: ResourceType; size?: number }) {
  if (typeCode === 'VEHICLE') return <Car size={size} className="text-amber-500" />;
  if (typeCode === 'EQUIPMENT') return <Laptop size={size} className="text-blue-500" />;
  if (typeCode === 'SUPPLY') return <Package size={size} className="text-violet-500" />;
  return <Building2 size={size} className="text-teal" />;
}

export function ErrorBox({ children }: { children: ReactNode }) {
  return <p role="alert" className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-[12px] font-semibold text-rose-600">{children}</p>;
}

export function EmptyBox({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-dashed border-border bg-white py-14 text-center text-[12px] text-ink3">{children}</div>;
}

interface SheetProps {
  title: ReactNode;
  titleId: string;
  onClose: () => void;
  /** 저장 중에는 닫기를 막는다. */
  closeDisabled?: boolean;
  /** 다른 창 위에 겹쳐 뜨는 창(사유 입력 등)은 더 위로 올린다. */
  raised?: boolean;
  children: ReactNode;
  footer?: ReactNode;
}

/** 화면 아래에서 올라오는 PWA 공용 창. 본문만 스크롤되고 머리·버튼 줄은 고정된다. */
export function Sheet({ title, titleId, onClose, closeDisabled = false, raised = false, children, footer }: SheetProps) {
  return (
    <div className={`fixed inset-0 ${raised ? 'z-[60]' : 'z-50'} flex items-end justify-center bg-black/40 p-2 sm:p-4`}>
      <section role="dialog" aria-modal="true" aria-labelledby={titleId} className="flex w-full max-w-[440px] max-h-[90dvh] flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-[#101830] px-4 py-3 text-white">
          <h2 id={titleId} className="min-w-0 text-[13.5px] font-bold">{title}</h2>
          <button type="button" aria-label="닫기" disabled={closeDisabled} onClick={onClose} className="shrink-0 p-1 disabled:opacity-50"><X size={18} /></button>
        </header>
        <div className="flex-1 overflow-y-auto">{children}</div>
        {footer && <div className="flex shrink-0 gap-2 border-t border-border bg-white p-3">{footer}</div>}
      </section>
    </div>
  );
}

export const inputClass = 'mt-1 h-10 w-full min-w-0 max-w-full rounded-xl border border-border bg-panel px-3 text-[13px] font-normal text-ink outline-none focus:border-teal disabled:opacity-50';
export const labelClass = 'block min-w-0 text-[12px] font-bold text-ink2';
export const secondaryButton = 'flex-1 rounded-xl bg-panel-alt py-2.5 text-[12.5px] font-bold text-ink2 disabled:opacity-50';
export const primaryButton = 'flex-1 rounded-xl bg-teal py-2.5 text-[12.5px] font-bold text-white disabled:opacity-50';
export const dangerButton = 'flex-1 rounded-xl bg-rose-600 py-2.5 text-[12.5px] font-bold text-white disabled:opacity-50';
export const dangerOutlineButton = 'flex-1 rounded-xl border border-rose-500/30 bg-white py-2.5 text-[12.5px] font-bold text-rose-600 disabled:opacity-50';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/** 'YYYY-MM-DD' → '2026년 10월 19일 (월)' */
export function formatDateTitle(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${y}년 ${m}월 ${d}일 (${weekday})`;
}
