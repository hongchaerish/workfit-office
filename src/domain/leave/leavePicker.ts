import { calculateLeaveDays } from './policy';
import { DAY_MIN, formatMinutes } from './substituteLedger';

/**
 * 휴가원 사용기간 선택(화면설계서 V5.8) — 휴가 구분·시간대·신청량·막는 조건·문서 값.
 * 반차는 점심 1시간을 포함해 5시간 부재, 사용 4시간(2026-11-16 확정): 오전반차 08:30~13:30(13:30 출근), 오후반차 12:30~17:30(12:30 퇴근).
 * 문서에도 이 시각을 그대로 적는다 — 업무계획·캘린더는 결재 문서 시각을 쓴다.
 * 대체휴무는 종일(8시간)·반일(4시간)만.
 */
export type LeavePickType =
  | 'full' | 'am-half' | 'pm-half' | 'am-quarter' | 'pm-quarter' | 'sick' | 'official' | 'comp-full' | 'comp-half';
export type LeaveGroupId = 'full' | 'half' | 'quarter' | 'sick' | 'official' | 'comp-full' | 'comp-half';

export interface LeavePick {
  type: LeavePickType;
  /** 시작 시각 HH:mm */
  start: string;
}

export const LEAVE_GROUPS: ReadonlyArray<{ id: LeaveGroupId; name: string; unit: string }> = [
  { id: 'full', name: '연차', unit: '1.0일' },
  { id: 'half', name: '반차', unit: '0.5일' },
  { id: 'quarter', name: '반반차', unit: '0.25일' },
  { id: 'sick', name: '병가', unit: '1일' },
  { id: 'official', name: '공가', unit: '1일' },
  { id: 'comp-full', name: '종일 대휴', unit: '8시간' },
  { id: 'comp-half', name: '반일 대휴', unit: '4시간' },
];

export const LEAVE_TYPE_NAMES: Record<LeavePickType, string> = {
  full: '연차', 'am-half': '오전 반차', 'pm-half': '오후 반차', 'am-quarter': '오전 반반차', 'pm-quarter': '오후 반반차',
  sick: '병가', official: '공가', 'comp-full': '종일 대휴', 'comp-half': '반일 대휴',
};

/** 문서의 휴가종류 칸 값 */
const DOC_LEAVE_TYPE: Record<LeavePickType, string> = {
  full: '연차', 'am-half': '오전반차', 'pm-half': '오후반차', 'am-quarter': '반반차', 'pm-quarter': '반반차',
  sick: '병가', official: '공가', 'comp-full': '대체휴무', 'comp-half': '대체휴무',
};

/** 여러 날 연속 신청이 되는 종일 휴가 */
export const FULL_DAY_GROUPS: ReadonlySet<LeaveGroupId> = new Set(['full', 'sick', 'official', 'comp-full']);

export function groupOf(type: LeavePickType): LeaveGroupId {
  if (type === 'am-half' || type === 'pm-half') return 'half';
  if (type === 'am-quarter' || type === 'pm-quarter') return 'quarter';
  return type;
}

export interface WorkDay {
  workStartTime: string;
  workEndTime: string;
  breakStartTime: string;
  breakEndTime: string;
}

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const toClock = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** 근무시간·점심 — 정책 값이 맞지 않으면 화면설계서 값(08:30~17:30, 점심 11:30~12:30) */
export function dayFrame(p: WorkDay) {
  let ws = toMin(p.workStartTime || '08:30');
  let we = toMin(p.workEndTime || '17:30');
  if (!(ws < we)) { ws = 510; we = 1050; }
  let ls = toMin(p.breakStartTime || '');
  let le = toMin(p.breakEndTime || '');
  if (!(ls > ws && le > ls && le < we)) { ls = 690; le = 750; }
  return { ws, we, ls, le };
}

/** 시작 시각부터 근무 분만큼 더한 끝 시각(점심은 건너뜀) */
function addWork(start: number, minutes: number, f: ReturnType<typeof dayFrame>): number {
  let t = start;
  let left = minutes;
  if (t < f.ls) {
    const before = Math.min(left, f.ls - t);
    t += before;
    left -= before;
    if (left > 0) t = f.le;
  } else if (t < f.le) t = f.le;
  return t + left;
}

/** 고를 수 있는 시작 시각 */
export function leaveTimeOptions(type: LeavePickType, day: WorkDay): string[] {
  const f = dayFrame(day);
  const steps = (from: number, lastStart: number) => {
    const out: string[] = [];
    for (let t = from; t <= lastStart; t += 30) out.push(toClock(t));
    return out;
  };
  switch (type) {
    case 'am-half': return [toClock(f.ws)];
    case 'pm-half': return [toClock(f.ws + 240)];
    case 'am-quarter': return steps(f.ws, f.ls - 120);
    case 'pm-quarter': return steps(f.le, f.we - 120);
    case 'comp-half': return [toClock(f.ws), toClock(f.ws + 240)];
    default: return [toClock(f.ws)];
  }
}

/** 문서·화면에 보이는 휴가 시간대 [시작, 끝] */
export function leaveRange(pick: LeavePick, day: WorkDay): [string, string] {
  const f = dayFrame(day);
  const s = toMin(pick.start);
  switch (pick.type) {
    // 반차는 점심 위치와 상관없이 부재 5시간(점심 포함): 오전 = 퇴근 4시간 전 출근, 오후 = 출근 4시간 뒤 퇴근(근태 판정과 같음)
    case 'am-half': return [toClock(f.ws), toClock(f.we - 240)];
    case 'pm-half': return [toClock(f.ws + 240), toClock(f.we)];
    case 'am-quarter':
    case 'pm-quarter': return [pick.start, toClock(addWork(s, 120, f))];
    // 반일 대휴도 반차와 같은 부재 시간대(근태도 단위가 반차면 반차로 판정)
    case 'comp-half': return s === f.ws ? [toClock(f.ws), toClock(f.we - 240)] : [toClock(f.ws + 240), toClock(f.we)];
    default: return [toClock(f.ws), toClock(f.we)];
  }
}

/** 시간 선택 아래 안내 한 줄 */
export function timeNotice(pick: LeavePick, day: WorkDay): string {
  const f = dayFrame(day);
  const [a, b] = leaveRange(pick, day);
  switch (pick.type) {
    case 'am-half': return `${toClock(f.we - 240)} 출근 · ${toClock(f.ws + 240)}~${toClock(f.we - 240)} 휴게`;
    case 'pm-half': return `${toClock(f.ws + 240)} 퇴근 · 오전 4시간 근무`;
    case 'am-quarter': return toMin(b) >= f.ls ? `점심 후 ${toClock(f.le)} 업무 복귀` : `${b} 업무 복귀`;
    case 'pm-quarter': return toMin(b) >= f.we ? `${a} 퇴근` : `${b} 업무 복귀`;
    case 'comp-half': return toMin(a) === f.ws ? '실근로 4시간 차감 · 점심시간 제외' : '대체휴무 4시간 사용';
    default: return '종일 사용 시간 자동 선택 · 점심시간 1시간 제외';
  }
}

type Holidays = Array<{ date: string; name?: string }> | Map<string, string>;

/** 근무일 수(주말·공휴일 제외) */
export function workDaysBetween(from: string, to: string, holidays?: Holidays): number {
  if (!from || !to || to < from) return 0;
  return calculateLeaveDays({ leaveType: '연차', startDate: from, endDate: to, holidays });
}

export interface LeaveBalances {
  annualDays: number;
  substituteMin: number;
}

export interface RequestAmount {
  category: '연차' | '대체휴무';
  amount: number;
  unit: '일' | '분';
  available: number;
}

/** 잔여에서 빠지는 양 — 병가·공가는 없음(null) */
export function requestAmount(pick: LeavePick, from: string, to: string, holidays: Holidays | undefined, bal: LeaveBalances): RequestAmount | null {
  const days = workDaysBetween(from, to, holidays);
  const annual = (amount: number): RequestAmount => ({ category: '연차', amount, unit: '일', available: bal.annualDays });
  const sub = (amount: number): RequestAmount => ({ category: '대체휴무', amount, unit: '분', available: bal.substituteMin });
  switch (groupOf(pick.type)) {
    case 'full': return annual(days);
    case 'half': return annual(0.5);
    case 'quarter': return annual(0.25);
    case 'comp-full': return sub(days * DAY_MIN);
    case 'comp-half': return sub(DAY_MIN / 2);
    default: return null;
  }
}

/** 적용을 막는 이유(없으면 빈 문자열) */
export function pickerProblem(pick: LeavePick | null, from: string, to: string, holidays: Holidays | undefined, bal: LeaveBalances): string {
  if (!from || !to) return '';
  const n = workDaysBetween(from, to, holidays);
  if (n === 0) return '휴가를 사용할 근무일이 없습니다.';
  if (!pick) return '';
  if (n > 1 && !FULL_DAY_GROUPS.has(groupOf(pick.type))) return '연속 날짜 신청은 종일 휴가만 가능합니다. 반차·반반차·반일 대휴는 하루씩 신청해 주세요.';
  // 연차는 잔여가 모자라도 미리 당겨 쓸 수 있다(선사용 — 이후 생기는 연차에서 차감). 대체휴무만 막는다.
  const a = requestAmount(pick, from, to, holidays, bal);
  if (a && a.unit === '분' && a.amount > a.available) {
    return `대체휴무 잔여 ${formatMinutes(a.available)}보다 신청 ${formatMinutes(a.amount)}이(가) 많습니다.`;
  }
  return '';
}

/** 연차 잔여보다 많이 신청할 때 미리 당겨 쓰는 일수(막지 않고 알리기만), 없으면 0 */
export function advanceDays(pick: LeavePick | null, from: string, to: string, holidays: Holidays | undefined, bal: LeaveBalances): number {
  if (!pick || !from || !to) return 0;
  const a = requestAmount(pick, from, to, holidays, bal);
  if (!a || a.unit !== '일') return 0;
  return Math.max(0, a.amount - Math.max(0, a.available));
}

export interface LeaveDocValues {
  leaveType: string;
  period: string;
  period__end: string;
  startTime: string;
  endTime: string;
  /** 대체휴무 단위(종일·오전반차·오후반차), 다른 휴가는 빈 값 */
  leaveUnit: string;
  /** 반반차 시작 시각, 다른 휴가는 빈 값 */
  quarterStart: string;
  days: number;
}

/** 고른 값 → 휴가원 문서 값 */
export function docValuesOf(pick: LeavePick, from: string, to: string, day: WorkDay, holidays?: Holidays): LeaveDocValues {
  const [startTime, endTime] = leaveRange(pick, day);
  const g = groupOf(pick.type);
  const n = workDaysBetween(from, to, holidays);
  const f = dayFrame(day);
  const days = g === 'half' || g === 'comp-half' ? 0.5 : g === 'quarter' ? 0.25 : n;
  return {
    leaveType: DOC_LEAVE_TYPE[pick.type],
    period: from,
    period__end: FULL_DAY_GROUPS.has(g) ? to : from,
    startTime,
    endTime,
    leaveUnit: g === 'comp-full' ? '종일' : g === 'comp-half' ? (toMin(pick.start) === f.ws ? '오전반차' : '오후반차') : '',
    quarterStart: g === 'quarter' ? pick.start : '',
    days,
  };
}

/** 문서 값 → 고른 값(다시 열 때) */
export function pickOfDocValues(v: Record<string, unknown>, day: WorkDay): LeavePick | null {
  const lt = String(v.leaveType ?? '');
  const unit = String(v.leaveUnit ?? '');
  const st = String(v.startTime ?? '');
  const f = dayFrame(day);
  const s = /^\d{2}:\d{2}$/.test(st) ? st : toClock(f.ws);
  if (lt === '연차') return { type: 'full', start: toClock(f.ws) };
  if (lt === '오전반차') return { type: 'am-half', start: toClock(f.ws) };
  if (lt === '오후반차' || lt === '반차') return { type: 'pm-half', start: toClock(f.ws + 240) };
  if (lt === '반반차') {
    const q = String(v.quarterStart ?? '') || s;
    return { type: toMin(q) < f.ls ? 'am-quarter' : 'pm-quarter', start: q };
  }
  if (lt === '병가') return { type: 'sick', start: toClock(f.ws) };
  if (lt === '공가') return { type: 'official', start: toClock(f.ws) };
  if (lt === '대체휴무') {
    if (unit === '오전반차') return { type: 'comp-half', start: toClock(f.ws) };
    if (unit === '오후반차') return { type: 'comp-half', start: toClock(f.ws + 240) };
    return { type: 'comp-full', start: toClock(f.ws) };
  }
  return null;
}
