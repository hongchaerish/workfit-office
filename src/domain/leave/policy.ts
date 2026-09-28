/**
 * 사내 휴가 유형 및 정책 카탈로그 (Leave Policy Catalog)
 *
 * 워크핏 그룹웨어의 표준 휴가 유형, 차감 일수, 기준 시간대를 정의합니다.
 * 표준 근무시간: 08:30 ~ 17:30 (점심시간 12:30 ~ 13:30)
 *
 * @see docs/연차휴가_산정_및_관리_정책_설계서.md §5
 */

export type LeaveCategory =
  | 'ANNUAL_DEDUCT'   // 법정 연차 원장에서 차감
  | 'SUBSTITUTE'      // 대체휴무 원장에서 차감
  | 'SPECIAL_PAID'    // 회사 복리후생 유급 (경조사, 포상 등)
  | 'SICK'            // 병가
  | 'UNPAID';         // 무급 휴직/휴가

export interface LeavePolicy {
  code: string;                 // 고유 코드 (예: 'ANNUAL', 'AM_HALF', 'PM_HALF')
  label: string;                // UI 노출명 (예: '오전 반차')
  displayDetail: string;        // 상세 설명 (예: '08:30 ~ 12:30 (0.5일)')
  category: LeaveCategory;
  deductsAnnualLeave: boolean;  // 연차 차감 대상 여부
  deductDays: number;           // 차감 일수 (1.0, 0.5, 0.25, 0.0)
  
  timeWindow?: {
    defaultStart: string;       // "08:30"
    defaultEnd: string;         // "12:30"
  };

  isHalfDay?: boolean;          // 반차 여부
  isQuarterDay?: boolean;       // 반반차 여부
  paid: boolean;                // 유급 여부
  requiresProof: boolean;       // 증빙 첨부 필수 여부
  guideMessage: string;         // 근태/복무 가이드 문구
}

export const LEAVE_POLICIES: Record<string, LeavePolicy> = {
  ANNUAL: {
    code: 'ANNUAL',
    label: '종일 연차',
    displayDetail: '전일 부재 (1.0일)',
    category: 'ANNUAL_DEDUCT',
    deductsAnnualLeave: true,
    deductDays: 1.0,
    timeWindow: {
      defaultStart: '08:30',
      defaultEnd: '17:30',
    },
    paid: true,
    requiresProof: false,
    guideMessage: '08:30~17:30 종일 부재 처리됩니다.',
  },

  AM_HALF: {
    code: 'AM_HALF',
    label: '오전 반차',
    displayDetail: '08:30 ~ 12:30 (0.5일)',
    category: 'ANNUAL_DEDUCT',
    deductsAnnualLeave: true,
    deductDays: 0.5,
    isHalfDay: true,
    timeWindow: {
      defaultStart: '08:30',
      defaultEnd: '12:30',
    },
    paid: true,
    requiresProof: false,
    guideMessage: '점심시간(12:30~13:30) 후 13:30에 정상 출근하여 근무합니다.',
  },

  PM_HALF: {
    code: 'PM_HALF',
    label: '오후 반차',
    displayDetail: '13:30 ~ 17:30 (0.5일)',
    category: 'ANNUAL_DEDUCT',
    deductsAnnualLeave: true,
    deductDays: 0.5,
    isHalfDay: true,
    timeWindow: {
      defaultStart: '13:30',
      defaultEnd: '17:30',
    },
    paid: true,
    requiresProof: false,
    guideMessage: '오전 근무 후 12:30 점심시간 시작과 함께 퇴근(조퇴)합니다.',
  },

  QUARTER: {
    code: 'QUARTER',
    label: '반반차',
    displayDetail: '2시간 지정 부재 (0.25일)',
    category: 'ANNUAL_DEDUCT',
    deductsAnnualLeave: true,
    deductDays: 0.25,
    isQuarterDay: true,
    timeWindow: {
      defaultStart: '15:30',
      defaultEnd: '17:30',
    },
    paid: true,
    requiresProof: false,
    guideMessage: '지정된 2시간 동안 부재 처리됩니다. (예: 조기퇴근 시 15:30~17:30)',
  },

  SUBSTITUTE: {
    code: 'SUBSTITUTE',
    label: '대체휴무',
    displayDetail: '대체휴무 원장 차감 (1.0일)',
    category: 'SUBSTITUTE',
    deductsAnnualLeave: false,
    deductDays: 1.0,
    paid: true,
    requiresProof: false,
    guideMessage: '휴일근무로 적립된 대체휴무 잔여에서 차감됩니다.',
  },

  EVENT: {
    code: 'EVENT',
    label: '경조사 휴가',
    displayDetail: '사내 규정 일수 (유급)',
    category: 'SPECIAL_PAID',
    deductsAnnualLeave: false,
    deductDays: 0.0,
    paid: true,
    requiresProof: true,
    guideMessage: '취업규칙상 경조사 유급휴가가 적용되며, 청첩장/부고 등 증빙이 필수입니다.',
  },

  SICK_PAID: {
    code: 'SICK_PAID',
    label: '유급 병가',
    displayDetail: '회사 지원 병가 (진단서 첨부)',
    category: 'SICK',
    deductsAnnualLeave: false,
    deductDays: 0.0,
    paid: true,
    requiresProof: true,
    guideMessage: '진단서 또는 진료확인서 첨부가 필수입니다.',
  },

  PUBLIC: {
    code: 'PUBLIC',
    label: '공가',
    displayDetail: '예비군/민방위/법원출석 등 (유급)',
    category: 'SPECIAL_PAID',
    deductsAnnualLeave: false,
    deductDays: 0.0,
    paid: true,
    requiresProof: true,
    guideMessage: '소환장 또는 참석 확인서 첨부가 필수입니다.',
  },
};

/** 휴가 종류 한글 라벨 맵핑 (기존 서식 및 신규 서식 호환) */
export const LEAVE_TYPE_OPTIONS = [
  { value: '연차', policyCode: 'ANNUAL', label: '종일 연차 (08:30~17:30 / 1.0일)', deductDays: 1.0 },
  { value: '오전반차', policyCode: 'AM_HALF', label: '오전 반차 (08:30~12:30 / 0.5일)', deductDays: 0.5 },
  { value: '오후반차', policyCode: 'PM_HALF', label: '오후 반차 (13:30~17:30 / 0.5일)', deductDays: 0.5 },
  { value: '반차', policyCode: 'AM_HALF', label: '반차 (구버전 호환 / 0.5일)', deductDays: 0.5 },
  { value: '반반차', policyCode: 'QUARTER', label: '반반차 (2시간 지정 / 0.25일)', deductDays: 0.25 },
  { value: '대체휴무', policyCode: 'SUBSTITUTE', label: '대체휴무 (휴일근무 적립분 차감)', deductDays: 1.0 },
  { value: '경조', policyCode: 'EVENT', label: '경조사 휴가 (증빙 필수)', deductDays: 0.0 },
  { value: '병가', policyCode: 'SICK_PAID', label: '병가 (진단서 필수)', deductDays: 0.0 },
  { value: '공가', policyCode: 'PUBLIC', label: '공가 (훈련/법원 등 증빙 필수)', deductDays: 0.0 },
  { value: '기타', policyCode: 'UNPAID', label: '기타 휴가', deductDays: 0.0 },
] as const;

/** 반반차(0.25일 / 2시간) 세부 시간대 슬롯 */
export interface QuarterLeaveSlot {
  key: 'AM1' | 'AM2' | 'PM1' | 'PM2';
  label: string;
  startTime: string;
  endTime: string;
}

export const QUARTER_LEAVE_SLOTS: readonly QuarterLeaveSlot[] = [
  { key: 'AM1', label: '오전 1', startTime: '08:30', endTime: '10:30' },
  { key: 'AM2', label: '오전 2', startTime: '10:30', endTime: '12:30' },
  { key: 'PM1', label: '오후 1', startTime: '13:30', endTime: '15:30' },
  { key: 'PM2', label: '오후 2', startTime: '15:30', endTime: '17:30' },
] as const;

/** 연차 차감 대상 여부 판정 */
export function isAnnualLeaveDeduction(leaveType?: string | null): boolean {
  if (!leaveType) return false;
  return ['연차', '오전반차', '오후반차', '반차', '반반차', 'ANNUAL', 'AM_HALF', 'PM_HALF', 'QUARTER'].includes(leaveType);
}

/** 반반차 여부 판별 (단일 기준) */
export function isQuarterDayLeave(leaveType?: string | null, title?: string | null): boolean {
  const t = (leaveType || '').trim();
  const h = (title || '').trim();
  if (t === '반반차' || t === 'QUARTER') return true;
  if (h.includes('반반차')) return true;
  return false;
}

/** 반차 여부 판별 (오전반차, 오후반차, 구버전 반차 통합) */
export function isHalfDayLeave(leaveType?: string | null, title?: string | null): boolean {
  if (isQuarterDayLeave(leaveType, title)) return false;
  const t = (leaveType || '').trim();
  const h = (title || '').trim();
  if (t === '반차' || t === '오전반차' || t === '오후반차' || t === 'AM_HALF' || t === 'PM_HALF') return true;
  if (h.includes('반차') || h.includes('오전반차') || h.includes('오후반차')) return true;
  return false;
}

/** 부분 일차(반차/반반차) 여부 판별 */
export function isPartDayLeave(leaveType?: string | null, title?: string | null): boolean {
  return isHalfDayLeave(leaveType, title) || isQuarterDayLeave(leaveType, title);
}

/**
 * 휴가 배지 표준 라벨 (단일화 기준)
 * - 오전반차 / 오후반차 -> '반차' (툴팁에 오전/오후 표기)
 * - 반반차 -> '반반'
 * - 기타 -> 원본 휴가명
 */
export function getLeaveBadgeLabel(leaveType?: string | null, title?: string | null): {
  label: string;
  tooltip: string;
} {
  if (isQuarterDayLeave(leaveType, title)) {
    return { label: '반반', tooltip: leaveType?.trim() || '반반차' };
  }
  if (isHalfDayLeave(leaveType, title)) {
    const raw = (leaveType || '').trim();
    const detail = raw.includes('오전') || (title || '').includes('오전')
      ? '오전반차'
      : raw.includes('오후') || (title || '').includes('오후')
      ? '오후반차'
      : '반차';
    return { label: '반차', tooltip: detail };
  }
  const clean = (leaveType || '연차').trim();
  return { label: clean, tooltip: clean };
}

export interface CalculateLeaveDaysOptions {
  leaveType?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  rawDays?: number | null;
  title?: string | null;
  /** 공휴일 목록 — 기간 기반 일수 계산 시 주말과 함께 자동 제외 */
  holidays?: Array<{ date: string; name?: string }> | Map<string, string>;
}

/**
 * 공휴일 날짜 Set 변환 (Holiday[] 또는 Map 모두 수용)
 */
function buildHolidaySet(
  holidays?: Array<{ date: string }> | Map<string, string>,
): Set<string> {
  const set = new Set<string>();
  if (!holidays) return set;
  if (holidays instanceof Map) {
    for (const key of holidays.keys()) set.add(key);
  } else {
    for (const h of holidays) set.add(h.date);
  }
  return set;
}

/**
 * 주어진 기간에서 제외되는 공휴일 날짜·명칭 목록 반환 (UI 안내용)
 * 주말에 해당하는 공휴일은 이미 주말로 제외되므로 별도 표기하지 않습니다.
 */
export function getExcludedHolidaysInRange(
  startDate: string,
  endDate: string,
  holidays: Array<{ date: string; name?: string }> | Map<string, string>,
): Array<{ date: string; name: string; dayOfWeek: string }> {
  const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];
  const result: Array<{ date: string; name: string; dayOfWeek: string }> = [];
  const s = new Date(startDate.slice(0, 10) + 'T00:00:00');
  const e = new Date(endDate.slice(0, 10) + 'T00:00:00');
  if (isNaN(s.getTime()) || isNaN(e.getTime()) || s > e) return result;

  const holidayMap = new Map<string, string>();
  if (holidays instanceof Map) {
    holidays.forEach((name, date) => holidayMap.set(date, name));
  } else {
    for (const h of holidays) holidayMap.set(h.date, h.name || '공휴일');
  }

  const cur = new Date(s);
  while (cur <= e) {
    const day = cur.getDay();
    const dateStr = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`;
    // 평일인데 공휴일인 날만 표시 (주말은 이미 자동 제외)
    if (day !== 0 && day !== 6 && holidayMap.has(dateStr)) {
      result.push({
        date: dateStr,
        name: holidayMap.get(dateStr) || '공휴일',
        dayOfWeek: DAY_NAMES[day],
      });
    }
    cur.setDate(cur.getDate() + 1);
  }
  return result;
}

/**
 * 단일 기준 휴가 일수 계산기 (SSOT)
 *
 * - 반차('반차', '오전반차', '오후반차')는 DB/폼에 잘못된 수치(예: 1.0일)가 기록되어 있어도
 *   반드시 0.5일을 반환하여 왜곡을 원천 차단합니다.
 * - 반반차는 반드시 0.25일을 반환합니다.
 * - 종일 휴가는 기간(영업일) 또는 명시된 수치를 안전하게 반영합니다.
 * - 기간 기반 계산 시 주말 + 공휴일(holidays)을 자동 제외합니다.
 */
export function calculateLeaveDays(options: CalculateLeaveDaysOptions): number {
  const { leaveType, startDate, endDate, rawDays, title, holidays } = options;

  // 1. 반반차 최우선: 무조건 0.25일
  if (isQuarterDayLeave(leaveType, title)) {
    return 0.25;
  }

  // 2. 반차 최우선: DB에 1일로 잘못 저장된 레거시 데이터도 무조건 0.5일로 강제 보정
  if (isHalfDayLeave(leaveType, title)) {
    return 0.5;
  }

  // 3. 종일/기타 휴가: 명시된 수치가 양수이면 그대로 인정
  // rawDays는 이미 확정된 값이므로 공휴일 재계산하지 않음 (승인 시점에 확정된 일수 존중)
  if (typeof rawDays === 'number' && !isNaN(rawDays) && rawDays > 0) {
    return rawDays;
  }

  // 4. 기간(시작일, 종료일) 기반 영업일 일수 계산 (주말 + 공휴일 자동 제외)
  if (startDate) {
    const holidaySet = buildHolidaySet(holidays);
    const end = endDate || startDate;
    const s = new Date(startDate.slice(0, 10) + 'T00:00:00');
    const e = new Date(end.slice(0, 10) + 'T00:00:00');
    if (!isNaN(s.getTime()) && !isNaN(e.getTime()) && s <= e) {
      let count = 0;
      const cur = new Date(s);
      while (cur <= e) {
        const day = cur.getDay();
        const dateStr = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`;
        // 주말도 아니고 공휴일도 아닌 평일만 차감 대상
        if (day !== 0 && day !== 6 && !holidaySet.has(dateStr)) {
          count++;
        }
        cur.setDate(cur.getDate() + 1);
      }
      return Math.max(0, count);
    }
  }

  return 1.0;
}

/** 휴가 유형별 기본 시간대 반환 */
export function getDefaultTimeWindow(
  leaveType: string,
  quarterSlotKey?: string,
): { startTime: string; endTime: string } {
  if (leaveType === '오전반차' || leaveType === 'AM_HALF') {
    return { startTime: '08:30', endTime: '12:30' };
  }
  if (leaveType === '오후반차' || leaveType === 'PM_HALF') {
    return { startTime: '13:30', endTime: '17:30' };
  }
  if (leaveType === '반반차' || leaveType === 'QUARTER') {
    if (quarterSlotKey) {
      const slot = QUARTER_LEAVE_SLOTS.find((s) => s.key === quarterSlotKey);
      if (slot) return { startTime: slot.startTime, endTime: slot.endTime };
    }
    return { startTime: '15:30', endTime: '17:30' };
  }
  return { startTime: '08:30', endTime: '17:30' };
}
