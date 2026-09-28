import type { CommutePolicy } from '@/domain/commutePolicy/schema';
import type { CommuteRecord, CommuteStatus } from '@/domain/commute/schema';
import { isHalfDayLeave, isQuarterDayLeave } from '@/domain/leave/policy';

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
}

/**
 * 정책(CommutePolicy)과 출/퇴근 시각, 공휴일 및 승인 휴가/외근/출장을 기반으로 근태 레코드 상태 및 시간을 정밀 계산합니다.
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
  leaveMap?: Map<string, ApprovedLeaveInfo>,
  hireDate?: string | null,
  customHolidayMap?: Map<string, string>
): CommuteRecord {
  const { inAt, outAt, empId, date } = raw;
  const holiday = getKoreanHoliday(date, customHolidayMap);
  const weekend = isWeekend(date);
  const approvedLeave = leaveMap?.get(date);

  const now = new Date();
  const pad = (v: number) => String(v).padStart(2, '0');
  const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const isFuture = date > todayStr;
  const isBeforeHire = Boolean(hireDate && hireDate.trim() && date < hireDate.trim());

  // 0. 입사일 이전인 경우 -> 과거 사번/카드 재사용 태그가 있더라도 입사 전이므로 'unknown'(— 표시) 처리
  if (isBeforeHire) {
    return {
      empId,
      date,
      inAt: null,
      outAt: null,
      basicMin: 0,
      overMin: 0,
      nightMin: 0,
      lateMin: 0,
      totalMin: 0,
      status: 'unknown',
      holidayName: holiday ?? (weekend ? '주말 휴무' : undefined),
    };
  }

  // 1. 미출근 / 미기록 처리 (출/퇴근 모두 없는 날)
  if (!inAt && !outAt) {

    // 1-1. 승인된 휴가/외근/출장이 존재하는 경우 -> 결근이 아닌 인정 상태로 확정 (미래 일정도 예정으로 표시)
    if (approvedLeave) {
      const cat = approvedLeave.category ?? 'LEAVE';
      const status: CommuteStatus = cat === 'OUTSIDE' ? 'outside' : cat === 'TRIP' ? 'trip' : 'leave';
      const isWorkApproved = status === 'outside' || status === 'trip';
      return {
        empId,
        date,
        inAt: null,
        outAt: null,
        basicMin: isWorkApproved ? 8 * 60 : 0,
        overMin: 0,
        nightMin: 0,
        lateMin: 0,
        totalMin: isWorkApproved ? 8 * 60 : 0,
        status,
        leaveName: status === 'leave' ? approvedLeave.leaveType : undefined,
        outsideName: status === 'outside' ? approvedLeave.leaveType : undefined,
        tripName: status === 'trip' ? approvedLeave.leaveType : undefined,
        holidayName: holiday ?? undefined,
      };
    }

    // 1-2. 주말 또는 법정 공휴일인 경우 -> 'off'(휴무/공휴일)로 확정
    if (weekend || holiday) {
      return {
        empId,
        date,
        inAt: null,
        outAt: null,
        basicMin: 0,
        overMin: 0,
        nightMin: 0,
        lateMin: 0,
        totalMin: 0,
        status: 'off',
        holidayName: holiday ?? (weekend ? '주말 휴무' : undefined),
      };
    }

    // 1-3. 미래 날짜(오늘 이후)인 경우 -> 결근이 아닌 'unknown'(미도래/예정) 처리
    if (isFuture) {
      return {
        empId,
        date,
        inAt: null,
        outAt: null,
        basicMin: 0,
        overMin: 0,
        nightMin: 0,
        lateMin: 0,
        totalMin: 0,
        status: 'unknown',
        holidayName: holiday ?? undefined,
      };
    }

    // 1-4. 과거 또는 오늘 평일이면서 휴가 신청도 없는 경우에만 -> 'absent'(결근)
    return {
      empId,
      date,
      inAt: null,
      outAt: null,
      basicMin: 0,
      overMin: 0,
      nightMin: 0,
      lateMin: 0,
      totalMin: 0,
      status: raw.status === 'holiday_work' ? 'holiday_work' : raw.status === 'off' ? 'off' : 'absent',
      holidayName: holiday ?? undefined,
    };
  }

  // 2. 출근 또는 퇴근 한쪽만 있는 경우 (미기록 또는 외근/출장/오후반차 보정)
  const isLeaveHalf = isHalfDayLeave(approvedLeave?.leaveType, approvedLeave?.docTitle);
  const isLeaveQuarter = isQuarterDayLeave(approvedLeave?.leaveType, approvedLeave?.docTitle);
  const rawLeaveStr = `${approvedLeave?.leaveType || ''} ${approvedLeave?.docTitle || ''}`;
  const isPmHalf = isLeaveHalf && (rawLeaveStr.includes('오후') || !rawLeaveStr.includes('오전'));
  const isAmHalf = isLeaveHalf && rawLeaveStr.includes('오전');

  if (inAt && !outAt) {
    if (approvedLeave && (approvedLeave.category === 'OUTSIDE' || approvedLeave.category === 'TRIP')) {
      const status: CommuteStatus = approvedLeave.category === 'OUTSIDE' ? 'outside' : 'trip';
      return {
        empId,
        date,
        inAt,
        outAt: null,
        basicMin: 8 * 60,
        overMin: 0,
        nightMin: 0,
        lateMin: 0,
        totalMin: 8 * 60,
        status,
        outsideName: status === 'outside' ? approvedLeave.leaveType : undefined,
        tripName: status === 'trip' ? approvedLeave.leaveType : undefined,
        holidayName: holiday ?? undefined,
      };
    }

    // 오후반차인 경우 오전 근무 후 퇴근 태그 누락이더라도 정상 근무(4시간)로 인정
    if (isPmHalf) {
      return {
        empId,
        date,
        inAt,
        outAt: null,
        basicMin: 8 * 60,
        overMin: 0,
        nightMin: 0,
        lateMin: 0,
        totalMin: 8 * 60,
        status: 'normal',
        leaveName: approvedLeave?.leaveType,
        holidayName: holiday ?? undefined,
      };
    }

    return {
      empId,
      date,
      inAt,
      outAt: null,
      basicMin: 0,
      overMin: 0,
      nightMin: 0,
      lateMin: 0,
      totalMin: 0,
      status: 'missing_out',
      leaveName: approvedLeave?.leaveType,
      holidayName: holiday ?? undefined,
    };
  }

  if (!inAt && outAt) {
    if (approvedLeave && (approvedLeave.category === 'OUTSIDE' || approvedLeave.category === 'TRIP')) {
      const status: CommuteStatus = approvedLeave.category === 'OUTSIDE' ? 'outside' : 'trip';
      return {
        empId,
        date,
        inAt: null,
        outAt,
        basicMin: 8 * 60,
        overMin: 0,
        nightMin: 0,
        lateMin: 0,
        totalMin: 8 * 60,
        status,
        outsideName: status === 'outside' ? approvedLeave.leaveType : undefined,
        tripName: status === 'trip' ? approvedLeave.leaveType : undefined,
        holidayName: holiday ?? undefined,
      };
    }

    // 오전반차인 경우 오후 출근 태그 누락 후 정상 퇴근 시 인정
    if (isAmHalf) {
      return {
        empId,
        date,
        inAt: null,
        outAt,
        basicMin: 8 * 60,
        overMin: 0,
        nightMin: 0,
        lateMin: 0,
        totalMin: 8 * 60,
        status: 'normal',
        leaveName: approvedLeave?.leaveType,
        holidayName: holiday ?? undefined,
      };
    }

    return {
      empId,
      date,
      inAt: null,
      outAt,
      basicMin: 0,
      overMin: 0,
      nightMin: 0,
      lateMin: 0,
      totalMin: 0,
      status: 'missing_in',
      leaveName: approvedLeave?.leaveType,
      holidayName: holiday ?? undefined,
    };
  }

  const inMin = timeToMinutes(inAt)!;
  const outMin = timeToMinutes(outAt)!;

  // 오전반차인 경우 출근 기준 시각을 점심 종료 시각(breakEndTime, 기본 13:00)으로 시프트
  const policyStartMin = isAmHalf
    ? (timeToMinutes(policy.breakEndTime) ?? 780)
    : timeToMinutes(policy.workStartTime)!;
  const policyLateThreshold = policyStartMin + (policy.lateGraceMin || 0);

  // 3. 지각(late) 판정 (주말/공휴일 출근 시는 휴일근무로 처리)
  let lateMin = 0;
  let status: CommuteStatus = 'normal';

  if (weekend || holiday) {
    status = 'holiday_work';
  } else if (inMin > policyLateThreshold) {
    lateMin = inMin - policyStartMin;
    status = 'late';
  }

  // 4. 총 근무시간(totalMin) 및 근무시간(basicMin)
  const earlyLimitMin = timeToMinutes(policy.earlyInLimitTime) ?? 420;
  const effectiveInMin = Math.max(inMin, earlyLimitMin);
  const stayMin = Math.max(0, outMin - effectiveInMin);
  const breakMin = stayMin >= 240 ? policy.breakMin : 0;
  let totalMin = Math.max(0, stayMin - breakMin);

  // 반차(240분) 또는 반반차(120분) 인정 가산 (최대 8시간 480분)
  if (isLeaveHalf) {
    totalMin = Math.min(8 * 60, totalMin + 240);
  } else if (isLeaveQuarter) {
    totalMin = Math.min(8 * 60, totalMin + 120);
  }
  const basicMin = totalMin;
  const overMin = 0;

  // 5. 야간근무(nightMin) 판정 (22:00 = 1320분 이후)
  const nightStartMin = timeToMinutes(policy.nightStartTime) ?? 1320;
  let nightMin = 0;
  if (outMin > nightStartMin) {
    nightMin = outMin - nightStartMin;
  }

  return {
    empId,
    date,
    inAt,
    outAt,
    basicMin,
    overMin,
    nightMin,
    lateMin,
    totalMin,
    status,
    leaveName: approvedLeave?.leaveType,
    holidayName: holiday ?? undefined,
  };
}
