/**
 * 전사 임직원 연차 원장 빌더 (Leave Ledger Builder)
 *
 * 모든 연산은 단일 엔진인 calculateUserLeaveBalance(SSOT)에 위임하여
 * 전사 연차 원장과 개인 연차 잔여의 100% 일치를 보장합니다.
 *
 * @see docs/연차휴가_산정_및_관리_정책_설계서.md
 */

import type { ApprovalDoc } from '@/domain/approvalDoc/schema';
import type { EmployeeProfile } from '@/domain/employeeProfile/schema';
import type { LeaveAdjustmentTransaction } from './adjustmentStore';
import type { AdvanceOffsetResult } from './accrualEngine';
import { calculateUserLeaveBalance, type UserLeaveBalance } from './userLeaveBalance';

export interface LeaveLedgerEntry {
  empId?: number | null;
  empNo: string;
  name: string;
  dept: string;
  position: string;
  hireDate: string; // YYYY-MM-DD
  serviceYears: number;
  serviceMonths: number;
  isUnderOneYear: boolean;

  // 연차 일수 계산 (SSOT)
  entitledDays: number; // 법정 발생 연차
  adjustedDays: number; // 수동 가감 (+/-)
  totalGrantedDays: number; // 총 부여 (발생 + 조정)
  usedDays: number; // 결재 승인 완료
  pendingDays: number; // 결재 진행 중
  remainingDays: number; // 확정 잔여 일수 (총부여 - 사용)
  availableDays?: number; // 가용 잔여 일수 (총부여 - 사용 - 신청중)
  usageRate: number; // 소진율 (%)

  // 선사용/상계 상태
  advanceStatus: AdvanceOffsetResult;

  // 상세 이력 링크
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
  /** 퇴사 여부 (기본값: false, 퇴사자는 기본 연차원장 화면에서 숨김) */
  isRetired?: boolean;
}

export interface LeaveLedgerSummary {
  totalEmployees: number;
  totalEntitled: number;
  totalAdjusted: number;
  totalGranted: number;
  totalUsed: number;
  totalPending: number;
  totalRemaining: number;
  avgUsageRate: number;
  advanceEmployeeCount: number;
}

export interface BuildLedgerOptions {
  referenceDate?: Date; // 기준일 (기본값: 오늘)
  mode?: 'HIRE_DATE' | 'FISCAL_YEAR'; // 산정 방식 (기본값: HIRE_DATE 입사일 기준)
  holidays?: Array<{ date: string; name?: string }> | Map<string, string>; // 공휴일 목록 (연차 차감 시 공휴일 자동 제외)
}

const norm = (s?: string | null) => (s || '').replace(/\s+/g, '').toLowerCase();

/**
 * 전사 임직원 연차 원장 빌더 (순수 함수)
 *
 * DB 불변성을 유지하며, 사원 목록 + 프로필 + 결재 문서 + 수동 가감을 결합하여
 * calculateUserLeaveBalance 단일 기준 함수를 통해 일괄 생성합니다.
 */
export function buildLeaveLedger(
  employees: Array<{
    empId?: number | null;
    empNo?: string | null;
    name: string;
    dept?: string | null;
    position?: string | null;
    hireDate?: string | null;
    isRetired?: boolean;
  }>,
  profiles: EmployeeProfile[] = [],
  approvalDocs: ApprovalDoc[] = [],
  adjustments: LeaveAdjustmentTransaction[] = [],
  options: BuildLedgerOptions = {},
): { entries: LeaveLedgerEntry[]; summary: LeaveLedgerSummary } {
  const refDate = options.referenceDate ?? new Date();
  const mode = options.mode ?? 'HIRE_DATE';

  // 1. 프로필 맵 (이름/사번 기준 매핑)
  const profileMap = new Map<string, EmployeeProfile>();
  for (const p of profiles) {
    if (p.name) profileMap.set(norm(p.name), p);
    if (p.empNo) profileMap.set(String(p.empNo), p);
  }

  // 2. 사원별 연차 원장 엔트리 생성 (단일 계산 엔진에 위임)
  const entries: LeaveLedgerEntry[] = [];

  for (const emp of employees) {
    const empName = (emp.name || '').trim();
    if (!empName) continue;
    const key = norm(empName);

    const profile = profileMap.get(key) ?? (emp.empNo ? profileMap.get(String(emp.empNo)) : undefined);
    const hireDate = (emp.hireDate || profile?.hireDate || '2026-01-01').slice(0, 10);

    const balance: UserLeaveBalance = calculateUserLeaveBalance({
      user: {
        userId: profile?.userId,
        empId: emp.empId,
        empNo: emp.empNo || (profile?.empNo ? String(profile.empNo) : null),
        name: empName,
        dept: emp.dept || profile?.dept,
        position: emp.position || profile?.position,
        hireDate,
        isRetired: Boolean(emp.isRetired || profile?.status === 'RETIRED'),
      },
      approvalDocs,
      adjustments,
      referenceDate: refDate,
      mode,
      holidays: options.holidays,
    });

    entries.push({
      empId: balance.empId,
      empNo: balance.empNo,
      name: balance.name,
      dept: balance.dept,
      position: balance.position,
      hireDate: balance.hireDate,
      serviceYears: balance.serviceYears,
      serviceMonths: balance.serviceMonths,
      isUnderOneYear: balance.isUnderOneYear,
      entitledDays: balance.entitledDays,
      adjustedDays: balance.adjustedDays,
      totalGrantedDays: balance.totalGrantedDays,
      usedDays: balance.usedDays,
      pendingDays: balance.pendingDays,
      remainingDays: balance.remainingDays,
      availableDays: balance.availableDays,
      usageRate: balance.usageRate,
      advanceStatus: balance.advanceStatus,
      leaveHistory: balance.leaveHistory,
      adjustmentHistory: balance.adjustmentHistory,
      isRetired: balance.isRetired,
    });
  }

  // 3. 부서명 및 성명 순 정렬
  entries.sort((a, b) => {
    const deptCmp = a.dept.localeCompare(b.dept, 'ko');
    if (deptCmp !== 0) return deptCmp;
    return a.name.localeCompare(b.name, 'ko');
  });

  // 4. 전사 요약 통계 집계 (재직자 우선)
  const activeEntries = entries.filter((e) => !e.isRetired);
  const targetEntries = activeEntries.length > 0 ? activeEntries : entries;

  const totalEmployees = targetEntries.length;
  const totalEntitled = Number(targetEntries.reduce((s, e) => s + e.entitledDays, 0).toFixed(2));
  const totalAdjusted = Number(targetEntries.reduce((s, e) => s + e.adjustedDays, 0).toFixed(2));
  const totalGranted = Number(targetEntries.reduce((s, e) => s + e.totalGrantedDays, 0).toFixed(2));
  const totalUsed = Number(targetEntries.reduce((s, e) => s + e.usedDays, 0).toFixed(2));
  const totalPending = Number(targetEntries.reduce((s, e) => s + e.pendingDays, 0).toFixed(2));
  const totalRemaining = Number(targetEntries.reduce((s, e) => s + e.remainingDays, 0).toFixed(2));
  const avgUsageRate = totalGranted > 0 ? Math.round((totalUsed / totalGranted) * 100) : 0;
  const advanceEmployeeCount = targetEntries.filter((e) => e.advanceStatus.isAdvanceUsed).length;

  const summary: LeaveLedgerSummary = {
    totalEmployees,
    totalEntitled,
    totalAdjusted,
    totalGranted,
    totalUsed,
    totalPending,
    totalRemaining,
    avgUsageRate,
    advanceEmployeeCount,
  };

  return { entries: activeEntries, summary };
}
