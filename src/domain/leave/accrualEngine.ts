/**
 * 순수 연차 산정 엔진 (Pure Leave Accrual Engine)
 *
 * 대한민국 근로기준법 제60조, 고용노동부 행정해석, 대법원 판례(2021다227100)를 충실히 반영한
 * 결정론적(Deterministic) 순수 연차 산정 함수 모음입니다.
 * 외부 I/O, DB, 네트워크에 일체 의존하지 않습니다.
 *
 * @see docs/01_대한민국_연차휴가_법정기준_핵심요약.md
 * @see docs/02_연차휴가_법률_도메인_모델_명세서.md
 * @see docs/03_순수_연차_산정_엔진_설계계획서.md
 */

export interface EmploymentPeriod {
  hireDate: string;           // "YYYY-MM-DD"
  asOfDate: string;           // "YYYY-MM-DD"
  fullYears: number;          // 만 근속 연수 (예: 2025-12-31 입사, 2026-01-01 기준 = 0년)
  fullMonths: number;         // 만 근속 개월수 (0 ~ N)
  daysWorked: number;         // 총 근무일수 (D-Day, 시작일 포함)
  isOverOneYear: boolean;     // 만 1년(365일) 초과 여부
  hasRetainedOnDay366: boolean;// 366일째 근로관계 유지 여부 (대법원 2021다227100 판례)
}

export interface MonthlyLeaveAccrualItem {
  accrualNumber: number;      // 1 ~ 11회차
  accrualDate: string;        // 발생일 ("YYYY-MM-DD", 1개월 만근 익일/도래일)
  amount: number;             // 1.0일
  expirationDate: string;     // 소멸일 (입사일로부터 만 1년이 되는 날 자정, 2020년 개정법)
  isAccrued: boolean;         // 기준일(asOfDate) 현재 발생 완료 여부
  isExpired: boolean;         // 기준일 현재 유효기간 만료 여부
}

export interface StatutoryLeaveResult {
  period: EmploymentPeriod;
  isUnderOneYear: boolean;    // 1년 미만자 여부 (fullYears === 0)
  
  // 발생 일수 내역
  monthlyAccruedTotal: number;// 1년 미만 월별 개근 발생 누적 (최대 11일)
  monthlyLeaveItems: MonthlyLeaveAccrualItem[]; // 11회차 상세
  annualGrantDays: number;    // 1년 이상 정기 기본/가산 연차 (15 ~ 25일, 1년 미만은 0)
  totalStatutoryGranted: number; // 현재 시점 법적으로 유효한 총 부여 일수

  // 가산 연차 정보
  seniorityYears: number;     // 계속근로연수 (만 연수)
  seniorityBonusDays: number; // 최초 1년 초과 매 2년마다 +1일 가산 일수
}

export interface AdvanceOffsetResult {
  totalUsed: number;          // 실제 결재 승인 사용량 (예: 5.0일)
  currentAccrued: number;     // 현재까지 발생한 법정 일수 (예: 2.0일)
  balance: number;            // 현재 잔고 (currentAccrued - totalUsed, 예: -3.0일)
  isAdvanceUsed: boolean;     // 선사용 발생 여부 (totalUsed > currentAccrued)
  offsetCompletedDays: number;// 상계 완료된 일수 (예: 2.0일)
  offsetRemainingDays: number;// 향후 추가 상계되어야 할 잔여 일수 (예: 3.0일)
  estimatedFullOffsetDate: string | null; // 정상화(잔여 0일 완제) 예상 일자 (예: "2026-11-22")
}

export interface FiscalYearLeaveResult {
  targetYear: number;
  hireDate: string;
  daysWorkedInPrevYear: number; // 전년도 재직일수
  proRataGrantDays: number;     // 신년 1/1 비례 연차 일수 (소수점 첫째자리 올림)
  regularGrantDays: number;     // 1년 이상 정기 연차 일수
}

/** 날짜 문자열 YYYY-MM-DD를 안전하게 연/월/일 숫자로 분해 */
function parseDateParts(dateStr: string): { year: number; month: number; day: number } {
  const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number);
  return { year: y, month: m, day: d };
}

/** YYYY-MM-DD 포맷팅 */
function formatDate(year: number, month: number, day: number): string {
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

/** 해당 월의 마지막 날짜 구하기 (윤년 자동 반영) */
function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** 특정 일자로부터 N개월 후의 날짜 계산 (월말 보정 포함) */
function addMonths(dateStr: string, monthsToAdd: number): string {
  const { year, month, day } = parseDateParts(dateStr);
  let targetYear = year + Math.floor((month - 1 + monthsToAdd) / 12);
  let targetMonth = ((month - 1 + monthsToAdd) % 12) + 1;
  if (targetMonth <= 0) {
    targetMonth += 12;
    targetYear -= 1;
  }
  const maxDay = getDaysInMonth(targetYear, targetMonth);
  const targetDay = Math.min(day, maxDay);
  return formatDate(targetYear, targetMonth, targetDay);
}

/** 두 날짜 사이의 일수 차이 (start 포함, end 포함: D-Day = end - start + 1) */
function getDaysDifference(startStr: string, endStr: string): number {
  const start = new Date(startStr.slice(0, 10) + 'T00:00:00Z');
  const end = new Date(endStr.slice(0, 10) + 'T00:00:00Z');
  const diffMs = end.getTime() - start.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1;
}

/**
 * 1. 달력 기준 만 근속기간 계산 (Calendar-exact Employment Period)
 *
 * 단순 연도 빼기(2026 - 2025 = 1)나 30.5일 나눗셈이 아닌,
 * 실제 달력 일자(Day)를 엄격히 대조하여 만 근속연수와 개월수를 계산합니다.
 */
export function calculateEmploymentPeriod(hireDateStr: string, asOfDateStr: string): EmploymentPeriod {
  const hire = parseDateParts(hireDateStr);
  const asOf = parseDateParts(asOfDateStr);

  const daysWorked = getDaysDifference(hireDateStr, asOfDateStr);

  // 만 연수 계산
  let fullYears = asOf.year - hire.year;
  const monthDiff = asOf.month - hire.month;
  if (monthDiff < 0 || (monthDiff === 0 && asOf.day < hire.day)) {
    fullYears--;
  }
  fullYears = Math.max(0, fullYears);

  // 만 개월수 계산 (1년 미만 월별 발생 판정용)
  let fullMonths = (asOf.year - hire.year) * 12 + (asOf.month - hire.month);
  if (asOf.day < hire.day) {
    fullMonths--;
  }
  fullMonths = Math.max(0, fullMonths);

  const isOverOneYear = daysWorked >= 365;
  // 366일째 근로관계 유지 여부 (대법원 2021다227100 판례: 만 1년 계약만료 시 15일 미발생, 366일째 재직 중이어야 확정)
  const hasRetainedOnDay366 = daysWorked >= 366;

  return {
    hireDate: hireDateStr.slice(0, 10),
    asOfDate: asOfDateStr.slice(0, 10),
    fullYears,
    fullMonths,
    daysWorked,
    isOverOneYear,
    hasRetainedOnDay366,
  };
}

/**
 * 2. 근로기준법 제60조 기준 법정 연차 산정 (Statutory Leave Entitlement)
 *
 * - 1년 미만: 1개월 개근 시 1일씩 최대 11회차 발생 (입사 만 1년 시점에 일괄 소멸, 2020년 개정법)
 * - 1년 이상: 직전 1년간 80% 이상 출근 시 15일 부여 + 3년차부터 2년마다 1일 가산 (최대 25일 캡)
 * - 80% 미만 출근자: 개근 월수만큼 부여
 */
export function calculateStatutoryEntitlement(
  hireDateStr: string,
  asOfDateStr: string,
  attendanceRate: number = 1.0,
): StatutoryLeaveResult {
  const period = calculateEmploymentPeriod(hireDateStr, asOfDateStr);
  const isUnderOneYear = period.fullYears === 0;

  // 1년 미만 신입사원 월별 1일 발생 항목 (총 11회차 스케줄 생성)
  // 소멸일은 입사일로부터 만 1년이 되는 날의 전날 자정(365일째 자정)
  const oneYearAnniversary = addMonths(hireDateStr, 12);
  const monthlyLeaveItems: MonthlyLeaveAccrualItem[] = [];

  for (let n = 1; n <= 11; n++) {
    const accrualDate = addMonths(hireDateStr, n);
    const isAccrued = accrualDate <= period.asOfDate;
    const isExpired = period.asOfDate >= oneYearAnniversary;

    monthlyLeaveItems.push({
      accrualNumber: n,
      accrualDate,
      amount: 1.0,
      expirationDate: oneYearAnniversary,
      isAccrued,
      isExpired,
    });
  }

  // 기준일 현재 유효하게 발생한 월별 연차 총합 (만료된 것은 제외)
  let monthlyAccruedTotal = 0;
  if (isUnderOneYear) {
    monthlyAccruedTotal = monthlyLeaveItems.filter((item) => item.isAccrued && !item.isExpired).length;
  }

  // 1년 이상 정기 연차 산정
  let annualGrantDays = 0;
  let seniorityBonusDays = 0;

  if (period.fullYears >= 1 && period.hasRetainedOnDay366) {
    if (attendanceRate >= 0.8) {
      // 가산연차: 3년 이상 근속 시 1년을 초과하는 매 2년마다 1일 가산 (15 + floor((N-1)/2), 최대 25일 캡)
      seniorityBonusDays = Math.floor((period.fullYears - 1) / 2);
      annualGrantDays = Math.min(25, 15 + seniorityBonusDays);
    } else {
      // 80% 미만 출근자: 1개월 개근 시 1일
      annualGrantDays = Math.floor(attendanceRate * 12);
    }
  }

  const totalStatutoryGranted = isUnderOneYear ? monthlyAccruedTotal : annualGrantDays;

  return {
    period,
    isUnderOneYear,
    monthlyAccruedTotal,
    monthlyLeaveItems,
    annualGrantDays,
    totalStatutoryGranted,
    seniorityYears: period.fullYears,
    seniorityBonusDays,
  };
}

/**
 * 3. 신입사원 연차 선사용(Advance Leave) 및 개근 누적 자동 상계 분석
 *
 * 입사 1년 미만자가 하계휴가 5일 등으로 현재 발생량을 초과하여 사용한 경우,
 * 음수 잔고와 함께 향후 매월 개근(+1일) 도래에 따른 자동 상계 일정 및 완제일을 도출합니다.
 */
export function evaluateAdvanceLeaveOffset(
  hireDateStr: string,
  asOfDateStr: string,
  totalUsedDays: number,
): AdvanceOffsetResult {
  const statutory = calculateStatutoryEntitlement(hireDateStr, asOfDateStr);
  // 선사용은 1년 미만 월별 발생분을 앞당겨 쓴 경우만이다. 1년이 지나면 월별 발생분이 0이 되므로
  // 같은 식으로 견주면 휴가를 쓴 모든 사람이 선사용으로 잡힌다(정기 연차를 넘겨 쓴 것은 '마이너스 연차'로 따로 본다).
  if (!statutory.isUnderOneYear) {
    return {
      totalUsed: totalUsedDays,
      currentAccrued: statutory.totalStatutoryGranted,
      balance: statutory.totalStatutoryGranted - totalUsedDays,
      isAdvanceUsed: false,
      offsetCompletedDays: Math.min(statutory.totalStatutoryGranted, totalUsedDays),
      offsetRemainingDays: 0,
      estimatedFullOffsetDate: null,
    };
  }
  const currentAccrued = statutory.monthlyAccruedTotal;
  const balance = currentAccrued - totalUsedDays;
  const isAdvanceUsed = totalUsedDays > currentAccrued;

  const offsetCompletedDays = Math.min(currentAccrued, totalUsedDays);
  const offsetRemainingDays = Math.max(0, totalUsedDays - currentAccrued);

  let estimatedFullOffsetDate: string | null = null;
  if (isAdvanceUsed) {
    // totalUsedDays 회차(예: 5일 사용 시 5회차)가 발생하는 날짜가 완제일
    const targetAccrualNumber = Math.min(11, Math.ceil(totalUsedDays));
    estimatedFullOffsetDate = addMonths(hireDateStr, targetAccrualNumber);
  }

  return {
    totalUsed: totalUsedDays,
    currentAccrued,
    balance,
    isAdvanceUsed,
    offsetCompletedDays,
    offsetRemainingDays,
    estimatedFullOffsetDate,
  };
}

export interface LeaveYearWindow {
  start: string; // 연차 기간 첫날 "YYYY-MM-DD"
  end: string; // 연차 기간 마지막 날(포함)
}

/** 하루 앞 날짜 */
function previousDay(dateStr: string): string {
  const d = new Date(dateStr.slice(0, 10) + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * 기준일이 속한 연차 기간 — 이 기간에 생긴 연차에서 이 기간의 사용만 뺀다(근로기준법 제60조).
 * - 입사일 기준: 1년 미만은 입사일부터 만 1년 전날까지(월별 발생분), 그 뒤로는 입사 기념일부터 1년.
 *   첫해 월별 연차와 1년 뒤 15일은 따로라(2020년 개정법) 첫해 사용분은 2년차 15일에서 빼지 않는다.
 * - 회계연도 기준: 그해 1월 1일 ~ 12월 31일.
 */
export function currentLeaveYear(
  hireDateStr: string,
  asOfDateStr: string,
  mode: 'HIRE_DATE' | 'FISCAL_YEAR',
): LeaveYearWindow {
  if (mode === 'FISCAL_YEAR') {
    const year = asOfDateStr.slice(0, 4);
    return { start: `${year}-01-01`, end: `${year}-12-31` };
  }
  let { fullYears } = calculateEmploymentPeriod(hireDateStr, asOfDateStr);
  // 2월 29일 입사자는 평년 기념일이 2월 28일로 당겨진다 — 그날이 어느 기간에도 안 들어가는 일이 없게
  if (addMonths(hireDateStr, (fullYears + 1) * 12) <= asOfDateStr.slice(0, 10)) fullYears += 1;
  return {
    start: addMonths(hireDateStr, fullYears * 12),
    end: previousDay(addMonths(hireDateStr, (fullYears + 1) * 12)),
  };
}

/**
 * 4. 회계연도 기준(1월 1일) 비례 연차 계산 (Fiscal Year Pro-Rata Accrual)
 *
 * 전년도 중도입사자의 신년 1/1 비례연차 공식:
 * Pro-Rata = 15 * (전년도 재직일수 / 365)
 * (근로자 유리 원칙에 따라 소수점 첫째자리 올림 처리)
 */
export function calculateFiscalYearEntitlement(
  hireDateStr: string,
  targetFiscalYear: number,
): FiscalYearLeaveResult {
  const hire = parseDateParts(hireDateStr);
  const prevYear = targetFiscalYear - 1;

  // 전년도 재직일수 계산
  let daysWorkedInPrevYear = 0;
  if (hire.year < prevYear) {
    daysWorkedInPrevYear = 365; // 전전년도 이전 입사자는 전년도 풀 근무
  } else if (hire.year === prevYear) {
    const prevYearEnd = `${prevYear}-12-31`;
    daysWorkedInPrevYear = getDaysDifference(hireDateStr, prevYearEnd);
  } else {
    // 해당 회계연도 이후 입사자
    daysWorkedInPrevYear = 0;
  }

  // 비례 연차 = 15 * (재직일수 / 365), 0.1일 단위 올림
  let proRataGrantDays = 0;
  if (daysWorkedInPrevYear > 0 && hire.year === prevYear) {
    const raw = 15 * (daysWorkedInPrevYear / 365);
    proRataGrantDays = Math.ceil(raw * 10) / 10;
  }

  // 1년 이상 계속근로 시의 정기 부여 연차
  const period = calculateEmploymentPeriod(hireDateStr, `${targetFiscalYear}-01-01`);
  let regularGrantDays = 0;
  if (period.fullYears >= 1) {
    const seniorityBonus = Math.floor((period.fullYears - 1) / 2);
    regularGrantDays = Math.min(25, 15 + seniorityBonus);
  }

  return {
    targetYear: targetFiscalYear,
    hireDate: hireDateStr.slice(0, 10),
    daysWorkedInPrevYear,
    proRataGrantDays,
    regularGrantDays,
  };
}
