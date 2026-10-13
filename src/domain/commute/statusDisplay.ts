import type { CommuteRecord } from './schema';
import { isHalfDayLeave, isQuarterDayLeave, QUARTER_LEAVE_SLOTS } from '@/domain/leave/policy';

/**
 * 근태 상태 표시 — 이름·짧은 표기·색의 단일 정의.
 *
 * 근태표·내 근태·직원 상세·PWA·캘린더·업무계획이 모두 이 정의로 그린다. 같은 상태가 화면마다
 * 다른 이름·색으로 보이지 않게 하려는 것이다. 판정은 [[engine]]이 하고, 여기는 보이는 방식만 정한다.
 */
export type StatusKind =
  | 'normal'
  | 'late'
  | 'absent'
  | 'missing'
  | 'annual'
  | 'half'
  | 'quarter'
  | 'leave'
  | 'outside'
  | 'trip'
  | 'holiday_work'
  | 'holiday'
  | 'off';

export interface StatusTone {
  /** 배지(배경+테두리+글자) */
  badge: string;
  /** 글자색만 */
  text: string;
  /** 점·막대 */
  dot: string;
}

export const STATUS_TONES: Record<StatusKind, StatusTone> = {
  normal: { badge: 'bg-teal/10 border-teal/30 text-teal', text: 'text-teal', dot: 'bg-teal' },
  late: {
    badge: 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-400',
    text: 'text-amber-700 dark:text-amber-400',
    dot: 'bg-amber-500',
  },
  absent: {
    badge: 'bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400',
    text: 'text-rose-600 dark:text-rose-400',
    dot: 'bg-rose-500',
  },
  missing: {
    badge: 'bg-stone-500/10 border-stone-500/30 text-stone-600 dark:text-stone-400',
    text: 'text-stone-600 dark:text-stone-400',
    dot: 'bg-stone-400',
  },
  annual: {
    badge: 'bg-emerald-500/15 border-emerald-500/35 text-emerald-700 dark:text-emerald-400',
    text: 'text-emerald-700 dark:text-emerald-400',
    dot: 'bg-emerald-500',
  },
  half: {
    badge: 'bg-emerald-500/[0.07] border-emerald-500/25 text-emerald-700 dark:text-emerald-400',
    text: 'text-emerald-700 dark:text-emerald-400',
    dot: 'bg-emerald-400',
  },
  quarter: {
    badge: 'bg-emerald-500/[0.07] border-emerald-500/25 text-emerald-700 dark:text-emerald-400',
    text: 'text-emerald-700 dark:text-emerald-400',
    dot: 'bg-emerald-400',
  },
  leave: {
    badge: 'bg-emerald-500/15 border-emerald-500/35 text-emerald-700 dark:text-emerald-400',
    text: 'text-emerald-700 dark:text-emerald-400',
    dot: 'bg-emerald-500',
  },
  outside: {
    badge: 'bg-blue-500/10 border-blue-500/30 text-blue-700 dark:text-blue-400',
    text: 'text-blue-700 dark:text-blue-400',
    dot: 'bg-blue-500',
  },
  trip: {
    badge: 'bg-indigo-500/10 border-indigo-500/30 text-indigo-700 dark:text-indigo-400',
    text: 'text-indigo-700 dark:text-indigo-400',
    dot: 'bg-indigo-500',
  },
  holiday_work: {
    badge: 'bg-violet-500/10 border-violet-500/30 text-violet-700 dark:text-violet-400',
    text: 'text-violet-700 dark:text-violet-400',
    dot: 'bg-violet-500',
  },
  holiday: { badge: 'bg-rose-500/[0.06] border-rose-500/20 text-rose-500', text: 'text-rose-500', dot: 'bg-rose-400' },
  off: { badge: 'bg-panel-alt border-border text-ink3', text: 'text-ink3', dot: 'bg-ink3/40' },
};

export interface StatusChip {
  kind: StatusKind;
  /** 근태표 칸처럼 좁은 곳에 쓰는 짧은 표기 (예: 반차, 휴근) */
  short: string;
  /** 전체 이름 (예: 오전반차, 종일 외근) */
  label: string;
}

const clean = (v?: string | null) => (v ?? '').trim();

/** 휴가 종류 한 건의 표시. 연차·반차·반반차는 고정 표기, 나머지(대체휴무·경조·병가·공가 등)는 휴가 이름 그대로. */
export function leaveChip(leaveType?: string | null, title?: string | null, quarterSlot?: string | null): StatusChip {
  const t = clean(leaveType);
  if (isQuarterDayLeave(t, title)) {
    const slot = QUARTER_LEAVE_SLOTS.find((s) => s.key === quarterSlot);
    return { kind: 'quarter', short: '반반', label: slot ? `반반차 (${slot.label})` : '반반차' };
  }
  if (isHalfDayLeave(t, title)) {
    const text = `${t}${title ?? ''}`;
    const label = text.includes('오전') ? '오전반차' : text.includes('오후') ? '오후반차' : '반차';
    return { kind: 'half', short: '반차', label };
  }
  if (!t || t === '연차' || t === 'ANNUAL') return { kind: 'annual', short: '연차', label: '연차' };
  return { kind: 'leave', short: t, label: t };
}

export const chipOf = (kind: StatusKind, short: string, label = short): StatusChip => ({ kind, short, label });

/**
 * 근태 기록 하루를 배지 목록으로. 두 상태가 겹치면 둘 다 낸다(예: 반차 + 지각, 반차 + 외근).
 * 빈 배열이면 표시할 상태가 없다는 뜻(주말 휴무·입사 전·미래) — 화면은 '—' 등으로 그린다.
 */
export function describeCommuteRecord(rec: Pick<
  CommuteRecord,
  'status' | 'leaveName' | 'outsideName' | 'tripName' | 'holidayName' | 'lateMin'
> | null | undefined): StatusChip[] {
  if (!rec) return [];
  const leave = rec.leaveName ? leaveChip(rec.leaveName) : null;
  const withLeave = (...chips: StatusChip[]) => (leave ? [leave, ...chips] : chips);
  switch (rec.status) {
    case 'normal':
      return leave ? [leave] : [chipOf('normal', '정상')];
    case 'late':
      return withLeave(chipOf('late', '지각', rec.lateMin > 0 ? `지각 ${rec.lateMin}분` : '지각'));
    case 'absent':
      return [chipOf('absent', '결근')];
    case 'missing_in':
      return withLeave(chipOf('missing', '미체크', '출근 미기록'));
    case 'missing_out':
      return withLeave(chipOf('missing', '미체크', '퇴근 미기록'));
    case 'leave':
      return [leave ?? leaveChip('연차')];
    case 'outside':
      return withLeave(chipOf('outside', '외근', clean(rec.outsideName) || '외근'));
    case 'trip':
      return withLeave(chipOf('trip', '출장', clean(rec.tripName) || '출장'));
    case 'holiday_work':
      return [chipOf('holiday_work', '휴근', '휴일근무')];
    case 'off':
      return rec.holidayName && rec.holidayName !== '주말 휴무' ? [chipOf('holiday', '휴', rec.holidayName)] : [];
    default:
      return [];
  }
}

/** 결재 일정 분류(휴가·외근·출장)의 표시 — 캘린더·업무계획 칩용. */
export function scheduleChip(s: {
  category: 'LEAVE' | 'OUTSIDE' | 'TRIP';
  leaveType?: string | null;
  subType?: string | null;
  docTitle?: string | null;
}): StatusChip {
  if (s.category === 'LEAVE') return leaveChip(s.leaveType, s.docTitle);
  if (s.category === 'OUTSIDE') return chipOf('outside', '외근', clean(s.subType) || '외근');
  return chipOf('trip', '출장', clean(s.subType) || '출장');
}
