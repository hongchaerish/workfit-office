/**
 * 단일 기준 사용자별 연차/휴가 계산 엔진 (SSOT User Leave Balance Engine)
 *
 * 전사 연차 원장(LeaveLedgerTable), 마이 근태/연차(MyCommuteLeaveTab),
 * 결재 기안 작성기(ApprovalDraftScreen) 등 시스템의 모든 연차 잔여/사용량 연산을
 * 오직 이 하나의 도메인 함수에서 일원화하여 수행합니다.
 *
 * @see docs/연차휴가_산정_및_관리_정책_설계서.md
 */

import type { ApprovalDoc } from '@/domain/approvalDoc/schema';
import type { LeaveAdjustmentTransaction } from './adjustmentStore';
import {
  calculateEmploymentPeriod,
  calculateStatutoryEntitlement,
  calculateFiscalYearEntitlement,
  evaluateAdvanceLeaveOffset,
  currentLeaveYear,
  type LeaveYearWindow,
  type StatutoryLeaveResult,
  type AdvanceOffsetResult,
} from './accrualEngine';
import { isAnnualLeaveDeduction, type CalculateLeaveDaysOptions } from './policy';
import { normalizeLegacyLeaveDoc, type NormalizedLeaveRecord } from './legacyAdapter';
import {
  allocateSubstitute,
  substituteUseMinutes,
  type SubstituteDetail,
  type SubstituteLedgerEntry,
  type SubstituteSummary,
} from './substituteLedger';

export const FALLBACK_ANNUAL_GRANT = 15;

/** 대체휴무 지급 한 건(원장 지급 줄 기준) — 분 단위 */
export type SubstituteHolidayDetailItem = SubstituteDetail;

export interface UserLeaveBalance {
  // 기본 신원
  userId?: string | null;
  empId?: number | null;
  empNo: string;
  name: string;
  dept: string;
  position: string;
  hireDate: string; // YYYY-MM-DD
  isRetired: boolean;

  // 근속 정보
  serviceYears: number;
  serviceMonths: number;
  isUnderOneYear: boolean;

  // 연차 일수 계산 (SSOT) — 사용·신청중·조정은 지금 연차 기간(leaveYear) 안의 것만 센다
  leaveYear: LeaveYearWindow;
  entitledDays: number;       // 법정/회계연도 발생 연차
  adjustedDays: number;       // 수동 가감 일수 (+/-)
  totalGrantedDays: number;   // 총 부여 일수 (발생 + 조정)
  usedDays: number;           // 승인 완료 연차 사용 합 (반차 0.5일, 반반차 0.25일 정확 반영)
  pendingDays: number;        // 결재 진행 중인 연차 합
  remainingDays: number;      // 확정 잔여 연차 (총부여 - 사용)
  availableDays: number;      // 가용 잔여 연차 (총부여 - 사용 - 진행중)
  otherUsedDays: number;      // 연차 미차감 공가/병가/경조사 등 합
  usageRate: number;          // 소진율 (%)

  // 법정 연차 및 선사용 상계 상세
  statutory?: StatutoryLeaveResult;
  advanceStatus: AdvanceOffsetResult;

  // 대체휴무(대휴) 현황 — 분 단위, 원장 지급분을 오래된 것부터 사용(선입선출)
  substituteHoliday: SubstituteSummary;

  // 이력 데이터
  leaveHistory: Array<{
    docId: string;
    title: string;
    leaveType: string;
    startDate: string;
    endDate: string;
    daysCount: number;
    status: '완료' | '진행중';
    createdAt: string;
  }>;
  adjustmentHistory: LeaveAdjustmentTransaction[];
  myDocs: ApprovalDoc[];
}

export interface CalculateUserLeaveBalanceOptions {
  user: {
    userId?: string | null;
    empId?: number | null;
    empNo?: string | null;
    name: string;
    dept?: string | null;
    position?: string | null;
    hireDate?: string | null;
    isRetired?: boolean;
  };
  approvalDocs?: ApprovalDoc[];
  adjustments?: LeaveAdjustmentTransaction[];
  referenceDate?: Date;
  mode?: 'HIRE_DATE' | 'FISCAL_YEAR';
  /** 공휴일 목록 — 기간 기반 연차 일수 계산 시 자동 제외 */
  holidays?: CalculateLeaveDaysOptions['holidays'];
  /** 대체휴무 원장(전 직원) — 이 사람(userId) 줄만 쓴다 */
  substituteLedger?: readonly SubstituteLedgerEntry[];
}

const norm = (s?: string | null) => (s || '').replace(/\s+/g, '').toLowerCase();

/**
 * 단일 사용자의 연차 잔여 및 휴가 현황을 계산하는 단일 공식 함수
 */
export function calculateUserLeaveBalance(
  options: CalculateUserLeaveBalanceOptions
): UserLeaveBalance {
  const {
    user,
    approvalDocs = [],
    adjustments = [],
    referenceDate = new Date(),
    mode = 'HIRE_DATE',
    holidays,
    substituteLedger = [],
  } = options;

  const refDateStr = referenceDate.toISOString().slice(0, 10);
  const hireDate = (user.hireDate || '2026-01-01').slice(0, 10);
  const period = calculateEmploymentPeriod(hireDate, refDateStr);

  const targetName = (user.name || '').trim();
  const targetNormName = norm(targetName);
  const targetUserId = user.userId ? String(user.userId).trim() : null;
  const targetEmpNo = user.empNo ? String(user.empNo).trim() : null;
  const targetEmpIdStr = user.empId != null ? String(user.empId) : null;

  // 1. 법정 또는 회계연도 발생 일수 산출
  let entitledDays = 0;
  let statutory: StatutoryLeaveResult | undefined;

  if (mode === 'FISCAL_YEAR') {
    const fy = calculateFiscalYearEntitlement(hireDate, referenceDate.getFullYear());
    entitledDays = fy.regularGrantDays > 0 ? fy.regularGrantDays : fy.proRataGrantDays;
    statutory = calculateStatutoryEntitlement(hireDate, refDateStr);
  } else {
    statutory = calculateStatutoryEntitlement(hireDate, refDateStr);
    entitledDays = statutory.totalStatutoryGranted;
  }

  // 지금 연차 기간 — 이 기간에 생긴 연차에서 이 기간의 사용·조정만 뺀다/더한다(지난 기간 사용분은 내역에만 남는다)
  const leaveYear = currentLeaveYear(hireDate, refDateStr, mode);
  const inLeaveYear = (date?: string | null) => {
    const d = (date ?? '').slice(0, 10);
    // 날짜를 알 수 없는 기록은 예전처럼 센다(빠뜨려서 잔여가 늘어나는 쪽보다 낫다)
    return !d || (d >= leaveYear.start && d <= leaveYear.end);
  };

  // 2. 수동 조정 일수 합산 (사원명 일치) — 부여일이 이 연차 기간인 것만
  const empAdjustments = adjustments.filter((tx) => norm(tx.empName) === targetNormName);
  const adjustedDays = empAdjustments
    .filter((tx) => inLeaveYear(tx.grantedAt || tx.createdAt))
    .reduce((sum, tx) => sum + tx.deltaDays, 0);
  const totalGrantedDays = Math.max(0, entitledDays + adjustedDays);

  // 3. 해당 사원의 결재 문서 필터링 및 단일 정규화 (SSOT 보장)
  const matchedDocs: ApprovalDoc[] = [];
  const normalizedLeaves: NormalizedLeaveRecord[] = [];

  for (const doc of approvalDocs) {
    if (doc.cancelTargetDocId) continue; // 취소 기안 문서는 연차 차감 대상이 아님
    if (doc.docType !== '휴가') continue;
    if (doc.status !== '완료' && doc.status !== '진행중') continue;

    // 사원 매칭 (userId, 사번, 사원명 정규화 다중 대조)
    const docDrafterId = doc.drafterId ? String(doc.drafterId).trim() : null;
    const docDrafterName = doc.drafterName ? String(doc.drafterName).trim() : '';
    const docDrafterNormName = norm(docDrafterName);

    const isMatch =
      (targetUserId && docDrafterId === targetUserId) ||
      (targetNormName && docDrafterNormName === targetNormName) ||
      (targetEmpNo && (doc as any).drafterEmpNo === targetEmpNo) ||
      (targetEmpIdStr && (doc as any).drafterEmpNo === targetEmpIdStr);

    if (!isMatch) continue;

    const normalized = normalizeLegacyLeaveDoc(doc, { holidays });
    if (!normalized) continue;

    matchedDocs.push(doc);
    normalizedLeaves.push(normalized);
  }

  // 4. 연차 차감 대상 (isAnnualLeaveDeduction) vs 비차감 분리 집계
  let usedDays = 0;
  let pendingDays = 0;
  let otherUsedDays = 0;
  let approvedSubDays = 0;
  let pendingSubDays = 0;

  const leaveHistory: UserLeaveBalance['leaveHistory'] = [];

  for (const record of normalizedLeaves) {
    const isDeductible = isAnnualLeaveDeduction(record.leaveType);
    const isSub = record.leaveType === '대체휴무';

    if (isDeductible) {
      // 다른 연차 기간의 사용은 이번 기간 잔여에서 빼지 않고 내역에만 남긴다(첫해 월별 연차 ↔ 2년차 15일은 따로)
      const counts = inLeaveYear(record.startDate);
      if (counts && record.status === '완료') {
        usedDays += record.days;
      } else if (counts && record.status === '진행중') {
        pendingDays += record.days;
      }
    } else if (isSub) {
      if (record.status === '완료') {
        approvedSubDays += record.days;
      } else if (record.status === '진행중') {
        pendingSubDays += record.days;
      }
    } else {
      if (record.status === '완료') {
        otherUsedDays += record.days;
      }
    }

    leaveHistory.push({
      docId: record.docId,
      title: record.reason || `${record.leaveType} 신청의 건`,
      leaveType: record.leaveType,
      startDate: record.startDate,
      endDate: record.endDate,
      daysCount: record.days,
      status: record.status as '완료' | '진행중',
      createdAt: record.createdAt || '',
    });
  }

  // 소수점 2자리 정밀도 보정
  usedDays = Number(usedDays.toFixed(2));
  pendingDays = Number(pendingDays.toFixed(2));
  otherUsedDays = Number(otherUsedDays.toFixed(2));

  // 5. 잔여 연차 산출
  // remainingDays: 확정 잔여 연차 (총부여 - 사용)
  // availableDays: 가용 잔여 연차 (총부여 - 사용 - 신청중)
  const remainingDays = Number((totalGrantedDays - usedDays).toFixed(2));
  const availableDays = Math.max(0, Number((totalGrantedDays - usedDays - pendingDays).toFixed(2)));
  const usageRate =
    totalGrantedDays > 0 ? Math.min(100, Math.round((usedDays / totalGrantedDays) * 100)) : 0;

  // 6. 1년 미만 신입사원 선사용 상계 평가
  const advanceStatus = evaluateAdvanceLeaveOffset(hireDate, refDateStr, usedDays);

  // 7. 대체휴무(대휴) — 원장 지급분(분)에서 사용(종일 480·반일 240)을 오래된 지급부터 뺀다
  const myLedger = targetUserId ? substituteLedger.filter((e) => e.userId === targetUserId) : [];
  const substituteHoliday = allocateSubstitute(
    myLedger,
    substituteUseMinutes(approvedSubDays),
    substituteUseMinutes(pendingSubDays),
    refDateStr,
  );

  return {
    userId: targetUserId,
    empId: user.empId ?? null,
    empNo: String(user.empNo || '—'),
    name: targetName,
    dept: user.dept || '소속 미지정',
    position: user.position || '사원',
    hireDate,
    isRetired: Boolean(user.isRetired),

    serviceYears: period.fullYears,
    serviceMonths: period.fullMonths,
    isUnderOneYear: !period.isOverOneYear,

    leaveYear,
    entitledDays,
    adjustedDays,
    totalGrantedDays,
    usedDays,
    pendingDays,
    remainingDays,
    availableDays,
    otherUsedDays,
    usageRate,

    statutory,
    advanceStatus,

    substituteHoliday,

    leaveHistory: leaveHistory.sort((a, b) => b.startDate.localeCompare(a.startDate)),
    adjustmentHistory: empAdjustments.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    myDocs: matchedDocs,
  };
}

/** 지난 연차 기간 한 칸 — 그 기간 마지막 날 기준으로 다시 계산한 값 */
export interface PastLeaveYear {
  start: string;
  end: string;
  grantedDays: number; // 발생 + 조정
  adjustedDays: number;
  usedDays: number;
  expiredDays: number; // 쓰지 않고 기간이 끝나 소멸한 일수(연차수당 정산 참고)
  overUsedDays: number; // 그 기간에 발생분보다 더 쓴 일수
  /** 휴가 기록이 시작되기 전부터의 기간 — 기록 밖 사용이 있을 수 있어 소멸 일수가 확정이 아니다 */
  beforeRecords: boolean;
}

const dayBefore = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

/**
 * 지금 연차 기간 전의 기간들(최근 것부터) — 기간 마지막 날을 기준일로 calculateUserLeaveBalance 를 다시 돌린다.
 * 휴가 기록(문서 중 가장 이른 시작일)이 생기기 전에 끝난 기간은 뺀다 — 기록이 없어 전부 소멸로 보이지 않게.
 */
export function calculatePastLeaveYears(options: CalculateUserLeaveBalanceOptions): PastLeaveYear[] {
  const { approvalDocs = [], referenceDate = new Date(), mode = 'HIRE_DATE' } = options;
  const hireDate = (options.user.hireDate || '2026-01-01').slice(0, 10);
  const starts = approvalDocs
    .filter((d) => d.docType === '휴가')
    .map((d) => String((d.form as { startDate?: string } | null | undefined)?.startDate ?? '').slice(0, 10))
    .filter(Boolean)
    .sort();
  const since = starts[0];
  if (!since) return [];

  const out: PastLeaveYear[] = [];
  let current = currentLeaveYear(hireDate, referenceDate.toISOString().slice(0, 10), mode);
  // 한 사람당 기간 수는 근속 연수만큼이라 넉넉히 50 칸에서 멈춘다
  for (let i = 0; i < 50; i++) {
    const end = dayBefore(current.start);
    if (end < hireDate || end < since) break;
    const b = calculateUserLeaveBalance({ ...options, mode, referenceDate: new Date(`${end}T12:00:00Z`) });
    const start = b.leaveYear.start < hireDate ? hireDate : b.leaveYear.start;
    out.push({
      start,
      end,
      grantedDays: b.totalGrantedDays,
      adjustedDays: b.adjustedDays,
      usedDays: b.usedDays,
      expiredDays: Math.max(0, b.remainingDays),
      overUsedDays: Math.max(0, Number((-b.remainingDays).toFixed(2))),
      beforeRecords: start < since,
    });
    current = b.leaveYear;
  }
  return out;
}
