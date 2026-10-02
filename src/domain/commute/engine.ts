import type { CommutePolicy } from '@/domain/commutePolicy/schema';
import type { CommuteRecord, CommuteStatus } from '@/domain/commute/schema';
import { isHalfDayLeave, isQuarterDayLeave, type QuarterLeaveSlot } from '@/domain/leave/policy';

/**
 * 주어진 날짜(YYYY-MM-DD)의 공휴일 명칭 반환 (공휴일이 아니면 null)
 *
 * 공휴일 데이터는 기준정보 > 공휴일 관리(HolidayScreen)에서 Appwrite DB로 관리하며,
 * 이 함수는 DB를 단일 소스(SSOT)로 사용합니다.
 *
 * - 1순위: 주입된 DB 실시간 공휴일 맵 (customMap)
 * - 2순위: 브라우저 localStorage 캐시 (workfit_holidays_v2) — DB 로드 전 폴백
 */
export function getKoreanHoliday(dateStr: string, customMap?: Map<string, string>): string | null {
  // 1순위: DB에서 주입된 실시간 공휴일 맵
  if (customMap && customMap.has(dateStr)) {
    return customMap.get(dateStr) ?? null;
  }
  // 2순위: localStorage 캐시 (holiday.repo.ts가 DB 조회 시 자동 미러링)
  try {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('workfit_holidays_v2') : null;
    if (saved) {
      const list = JSON.parse(saved);
      const match = list.find((h: any) => h.date === dateStr);
      if (match) return match.name;
    }
  } catch {
    // ignore
  }
  return null;
}


/** 주말(토/일) 여부 확인 */
export function isWeekend(dateStr: string): boolean {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay();
  return day === 0 || day === 6;
}

/**
 * 시각 문자열(HH:mm) 또는 ISO 문자열을 하루 기준 분(0~1440)으로 변환.
 */
export function timeToMinutes(timeStr?: string | null): number | null {
  if (!timeStr) return null;
  if (timeStr.includes('T')) {
    const d = new Date(timeStr);
    if (Number.isNaN(d.getTime())) return null;
    return d.getHours() * 60 + d.getMinutes();
  }
  const [h, m] = timeStr.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

export interface ApprovedLeaveInfo {
  leaveType: string;
  category?: 'LEAVE' | 'OUTSIDE' | 'TRIP';
  docTitle?: string;
  docId?: string;
  /** 반반차 시간대 슬롯 (반반차일 때만) */
  quarterSlot?: QuarterLeaveSlot['key'];
}


/** 하루 기준 분 단위 시간 구간 [시작, 끝) */
export type Window = [number, number];

/** 정책의 근무 구간 — 출근~점심 시작, 점심 끝~퇴근 (점심 제외 실근무 타임라인) */
function workSegments(policy: CommutePolicy): Window[] {
  const ws = timeToMinutes(policy.workStartTime) ?? 510;
  const we = timeToMinutes(policy.workEndTime) ?? 1050;
  const bs = timeToMinutes(policy.breakStartTime);
  const be = timeToMinutes(policy.breakEndTime);
  if (bs === null || be === null || bs >= be || bs <= ws || be >= we) return [[ws, we]];
  return [[ws, bs], [be, we]];
}

/** 실근무 타임라인의 [from, to)분 구간을 실제 시각 구간으로 변환 */
function netWindows(segments: Window[], from: number, to: number): Window[] {
  const out: Window[] = [];
  let offset = 0;
  for (const [s, e] of segments) {
    const len = e - s;
    const a = Math.max(from, offset);
    const b = Math.min(to, offset + len);
    if (a < b) out.push([s + (a - offset), s + (b - offset)]);
    offset += len;
  }
  return out;
}

/**
 * 반차 부재 구간.
 * ⚠️ 임시 규칙(2026-10-02): 반차 경계 = 점심시간. 오후반차는 점심 시작(11:30)에 퇴근,
 * 오전반차는 점심 끝(12:30)에 출근. 회사 규칙이 확정되면 이 함수만 바꾼다.
 */
function halfDayWindows(policy: CommutePolicy): { AM: Window[]; PM: Window[] } {
  const segments = workSegments(policy);
  if (segments.length === 2) return { AM: [segments[0]], PM: [segments[1]] };
  const [s, e] = segments[0];
  const mid = s + Math.floor((e - s) / 2);
  return { AM: [[s, mid]], PM: [[mid, e]] };
}

const QUARTER_SLOT_ORDER = ['AM1', 'AM2', 'PM1', 'PM2'] as const;

/** 반반차 부재 구간 — 실근무 타임라인을 2시간씩 나눈 슬롯 */
function quarterWindows(policy: CommutePolicy, slot: QuarterLeaveSlot['key']): Window[] {
  const i = QUARTER_SLOT_ORDER.indexOf(slot);
  return netWindows(workSegments(policy), i * 120, (i + 1) * 120);
}

function isAmHalf(info: ApprovedLeaveInfo): boolean {
  const t = (info.leaveType || '').trim();
  if (t === '오전반차' || t === 'AM_HALF') return true;
  if (t === '오후반차' || t === 'PM_HALF') return false;
  const title = info.docTitle || '';
  // 구버전 '반차'는 오전/오후 표기가 없으면 오후반차로 본다(기존 판정 유지)
  return title.includes('오전') && !title.includes('오후');
}

/** 휴가 결재 1건이 차지하는 부재 구간 */
function absenceWindowsOf(info: ApprovedLeaveInfo, policy: CommutePolicy): Window[] {
  if (isQuarterDayLeave(info.leaveType, info.docTitle)) return quarterWindows(policy, info.quarterSlot ?? 'PM2');
  if (isHalfDayLeave(info.leaveType, info.docTitle)) {
    const half = halfDayWindows(policy);
    return isAmHalf(info) ? half.AM : half.PM;
  }
  return workSegments(policy); // 연차 등 종일 휴가
}

function mergeWindows(windows: Window[]): Window[] {
  const sorted = [...windows].sort((a, b) => a[0] - b[0]);
  const out: Window[] = [];
  for (const w of sorted) {
    const last = out[out.length - 1];
    if (last && w[0] <= last[1]) last[1] = Math.max(last[1], w[1]);
    else out.push([w[0], w[1]]);
  }
  return out;
}

const totalLength = (windows: Window[]) => windows.reduce((sum, [s, e]) => sum + (e - s), 0);
const overlap = (a: Window, b: Window) => Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]));

/** 근무 구간 중 부재가 아닌 부분(출근해야 하는 시간) */
function requiredWindows(segments: Window[], absence: Window[]): Window[] {
  const out: Window[] = [];
  for (const [s, e] of segments) {
    let cursor = s;
    for (const [as, ae] of absence) {
      if (ae <= cursor || as >= e) continue;
      if (as > cursor) out.push([cursor, Math.min(as, e)]);
      cursor = Math.max(cursor, ae);
    }
    if (cursor < e) out.push([cursor, e]);
  }
  return out;
}

const toList = (v?: ApprovedLeaveInfo | ApprovedLeaveInfo[]) => (v ? (Array.isArray(v) ? v : [v]) : []);

/**
 * 승인 휴가의 부재 시간대(분, 병합). 연차 등 종일 휴가가 있으면 `fullDay`.
 * 외근·출장은 휴가가 아니므로 포함하지 않는다. 상태표시 등에서 '지금 휴가 중인지' 판정에 쓴다.
 */
export function approvedLeaveSpans(
  policy: CommutePolicy,
  entries: ApprovedLeaveInfo[],
): { fullDay: boolean; windows: Window[] } {
  const leaves = entries.filter((e) => (e.category ?? 'LEAVE') === 'LEAVE');
  const fullDay = leaves.some((e) => !isHalfDayLeave(e.leaveType, e.docTitle) && !isQuarterDayLeave(e.leaveType, e.docTitle));
  return { fullDay, windows: mergeWindows(leaves.flatMap((e) => absenceWindowsOf(e, policy))) };
}

/**
 * 그날 출근해야 하는 시간대(분) — 휴가 부재 구간을 뺀 첫 시작~마지막 끝.
 * 종일 휴가·외근·출장이면 null. 화면의 '퇴근 처리' 기준 시각 등에 쓴다.
 */
export function requiredWorkSpan(
  policy: CommutePolicy,
  entries: ApprovedLeaveInfo[],
): { start: number; end: number } | null {
  if (entries.some((e) => e.category === 'OUTSIDE' || e.category === 'TRIP')) return null;
  const leaves = entries.filter((e) => (e.category ?? 'LEAVE') === 'LEAVE');
  const required = requiredWindows(workSegments(policy), mergeWindows(leaves.flatMap((e) => absenceWindowsOf(e, policy))));
  if (required.length === 0) return null;
  return { start: required[0][0], end: required[required.length - 1][1] };
}

/**
 * 정책(CommutePolicy)과 출/퇴근 시각, 공휴일 및 승인 휴가/외근/출장을 기반으로 근태 레코드 상태 및 시간을 계산합니다.
 * 웹·PWA 공용 단일 판정 — CAPS가 저장한 status는 쓰지 않고 항상 여기서 다시 판정한다.
 * leaveMap 값은 그날의 결재 목록(같은 날 여러 건)이며, 기존 호출 호환을 위해 단일 객체도 받는다.
 */
export function evaluateCommuteRecord(
  raw: {
    empId: number;
    date: string;
    inAt: string | null;
    outAt: string | null;
    status?: CommuteStatus;
  },
  policy: CommutePolicy,
  leaveMap?: Map<string, ApprovedLeaveInfo | ApprovedLeaveInfo[]>,
  hireDate?: string | null,
  customHolidayMap?: Map<string, string>
): CommuteRecord {
  const { inAt, outAt, empId, date } = raw;
  const holiday = getKoreanHoliday(date, customHolidayMap);
  const weekend = isWeekend(date);
  const entries = toList(leaveMap?.get(date));

  const now = new Date();
  const pad = (v: number) => String(v).padStart(2, '0');
  const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const isFuture = date > todayStr;
  const isBeforeHire = Boolean(hireDate && hireDate.trim() && date < hireDate.trim());

  const base = { empId, date, basicMin: 0, overMin: 0, nightMin: 0, lateMin: 0, totalMin: 0 };

  // 0. 입사일 이전 → 'unknown'(— 표시)
  if (isBeforeHire) {
    return { ...base, inAt: null, outAt: null, status: 'unknown', holidayName: holiday ?? (weekend ? '주말 휴무' : undefined) };
  }

  const workEntry = entries.find((e) => e.category === 'OUTSIDE' || e.category === 'TRIP');
  const workStatus: CommuteStatus | null = workEntry ? (workEntry.category === 'OUTSIDE' ? 'outside' : 'trip') : null;
  const leaveEntries = entries.filter((e) => (e.category ?? 'LEAVE') === 'LEAVE');
  const names = {
    leaveName: leaveEntries[0]?.leaveType,
    outsideName: entries.find((e) => e.category === 'OUTSIDE')?.leaveType,
    tripName: entries.find((e) => e.category === 'TRIP')?.leaveType,
    holidayName: holiday ?? undefined,
  };

  const segments = workSegments(policy);
  const absence = mergeWindows(leaveEntries.flatMap((e) => absenceWindowsOf(e, policy)));
  const leaveCreditMin = totalLength(absence);
  const required = requiredWindows(segments, absence);
  const dayStart = segments[0][0];
  const dayEnd = segments[segments.length - 1][1];

  // 1. 출/퇴근 태그가 모두 없는 날
  if (!inAt && !outAt) {
    if (workStatus) {
      return { ...base, inAt: null, outAt: null, basicMin: 480, totalMin: 480, status: workStatus, ...names };
    }
    if (leaveEntries.length) {
      return { ...base, inAt: null, outAt: null, status: 'leave', ...names, outsideName: undefined, tripName: undefined };
    }
    if (weekend || holiday) {
      return { ...base, inAt: null, outAt: null, status: 'off', holidayName: holiday ?? (weekend ? '주말 휴무' : undefined) };
    }
    if (isFuture) {
      return { ...base, inAt: null, outAt: null, status: 'unknown', holidayName: holiday ?? undefined };
    }
    return {
      ...base,
      inAt: null,
      outAt: null,
      status: raw.status === 'holiday_work' ? 'holiday_work' : raw.status === 'off' ? 'off' : 'absent',
      holidayName: holiday ?? undefined,
    };
  }

  // 2. 한쪽 태그만 있는 날 — 외근/출장이거나, 휴가가 하루의 시작/끝을 덮어 그 태그가 필요 없는 경우 보정
  if (!inAt || !outAt) {
    const leaveCoversEnd = required.length > 0 && required[required.length - 1][1] < dayEnd;
    const leaveCoversStart = required.length > 0 && required[0][0] > dayStart;
    const forgiven = inAt ? leaveCoversEnd : leaveCoversStart;
    if (workStatus || forgiven) {
      return {
        ...base,
        inAt,
        outAt,
        basicMin: 480,
        totalMin: 480,
        status: workStatus ?? 'normal',
        ...names,
      };
    }
    return { ...base, inAt, outAt, status: inAt ? 'missing_out' : 'missing_in', ...names, outsideName: undefined, tripName: undefined };
  }

  // 3. 출/퇴근 모두 있는 날
  const inMin = timeToMinutes(inAt)!;
  const outMin = timeToMinutes(outAt)!;

  let status: CommuteStatus = 'normal';
  let lateMin = 0;
  if (weekend || holiday) {
    status = 'holiday_work';
  } else if (workStatus) {
    status = workStatus; // 외근/출장 승인일은 지각 면제
  } else if (required.length > 0) {
    const requiredStart = required[0][0];
    if (inMin > requiredStart + (policy.lateGraceMin || 0)) {
      lateMin = inMin - requiredStart;
      status = 'late';
    }
  }

  // 근무시간: 체류 시간에서 점심시간과 겹친 만큼만 빼고, 휴가 인정 시간을 더한다(최대 8시간)
  const earlyLimitMin = timeToMinutes(policy.earlyInLimitTime) ?? 420;
  const stay: Window = [Math.max(inMin, earlyLimitMin), outMin];
  const lunch: Window = segments.length === 2 ? [segments[0][1], segments[1][0]] : [0, 0];
  let totalMin = Math.max(0, stay[1] - stay[0] - overlap(stay, lunch));
  if (leaveCreditMin > 0) totalMin = Math.min(480, totalMin + leaveCreditMin);
  if (workStatus) totalMin = Math.max(totalMin, 480);

  // 야간근무(nightMin) 판정 (22:00 = 1320분 이후)
  const nightStartMin = timeToMinutes(policy.nightStartTime) ?? 1320;
  const nightMin = outMin > nightStartMin ? outMin - nightStartMin : 0;

  return {
    ...base,
    inAt,
    outAt,
    basicMin: totalMin,
    nightMin,
    lateMin,
    totalMin,
    status,
    ...names,
  };
}
