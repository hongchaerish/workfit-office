/**
 * 개인 연차/휴가 현황 커스텀 훅 (useLeave)
 *
 * 모든 연차 연산은 도메인 계층의 단일 공식 엔진인 calculateUserLeaveBalance에 위임하여
 * 전사 연차 원장(LeaveLedgerTable)과 100% 동일한 수치와 일관성을 보장합니다.
 *
 * @see docs/연차휴가_산정_및_관리_정책_설계서.md
 */

import { useMemo, useState, useEffect } from 'react';
import { useAllApprovals } from '@/features/gw/useApprovals';
import { useEmployeeProfiles } from '@/features/employeeProfile/useEmployeeProfiles';
import type { ApprovalDoc } from '@/domain/approvalDoc/schema';
import type { StatutoryLeaveResult, AdvanceOffsetResult } from '@/domain/leave/accrualEngine';
import { SUBSTITUTE_HOLIDAY_UPDATED_EVENT } from '@/domain/leave/substituteHolidayStore';
import { getStoredAdjustments } from '@/domain/leave/adjustmentStore';
import {
  calculateUserLeaveBalance,
  type SubstituteHolidayDetailItem,
} from '@/domain/leave/userLeaveBalance';
import { useHolidays } from '@/features/holiday/useHolidays';

export const FALLBACK_ANNUAL_GRANT = 15;

export type SubstituteHolidayItem = SubstituteHolidayDetailItem;

export interface LeaveBalance {
  /** 총 부여 연차 (법정 발생 + 수동 조정) */
  grant: number;
  /** 승인완료된 연차·반차 사용 합 (반차 0.5일 정확 반영) */
  used: number;
  /** 진행중(미확정) 연차·반차 합 */
  pending: number;
  /** 확정 잔여 연차 = 총부여 − 사용 */
  remaining: number;
  /** 가용 잔여 연차 = 총부여 − 사용 − 진행중 */
  available?: number;
  /** 연차 차감 제외 승인완료 휴가(공가·경조 등) 합 */
  otherUsed: number;

  /** 법정 연차 계산 상세 (입사일이 있는 경우) */
  statutory?: StatutoryLeaveResult;
  /** 연차 선사용 및 상계 판정 (입사일 및 사용일수 기반) */
  advanceOffset?: AdvanceOffsetResult;
  /** 입사일자 (YYYY-MM-DD) */
  hireDate?: string;

  /** 대체휴무(대휴) 현황 (FIFO 선입선출 분배) */
  substituteHoliday: {
    total: number;
    used: number;
    pending: number;
    remaining: number;
    expiringSoonCount: number;
    detailList: SubstituteHolidayItem[];
  };

  /** 내 휴가 문서(최근순) */
  myDocs: ApprovalDoc[];
  isLoading: boolean;
}

export function useLeave(userId: string | undefined): LeaveBalance {
  const q = useAllApprovals();
  const profilesQ = useEmployeeProfiles();

  // 대체휴무 및 수동 가감 실시간 동기화 리스너
  const [subUpdateVer, setSubUpdateVer] = useState(0);
  useEffect(() => {
    const onSubUpdate = () => setSubUpdateVer((v) => v + 1);
    if (typeof window !== 'undefined') {
      window.addEventListener(SUBSTITUTE_HOLIDAY_UPDATED_EVENT, onSubUpdate);
      window.addEventListener('workfit-leave-adjustment-updated', onSubUpdate);
      return () => {
        window.removeEventListener(SUBSTITUTE_HOLIDAY_UPDATED_EVENT, onSubUpdate);
        window.removeEventListener('workfit-leave-adjustment-updated', onSubUpdate);
      };
    }
  }, []);

  const { data: holidayList = [] } = useHolidays();

  return useMemo(() => {
    const allApprovals = q.data ?? [];
    const profiles = profilesQ.data ?? [];
    const adjustments = getStoredAdjustments();

    // 임직원 인사 프로필에서 대상 사용자 정보 조회
    const userProfile = profiles.find((p) => p.userId === userId || p.id === userId);
    const userName = userProfile?.name || '';
    const hireDate = userProfile?.hireDate || undefined;

    // 단일 공식 도메인 연차 계산 엔진 호출 (SSOT)
    const balance = calculateUserLeaveBalance({
      user: {
        userId,
        empNo: userProfile?.empNo ? String(userProfile.empNo) : null,
        name: userName,
        dept: userProfile?.dept,
        position: userProfile?.position,
        hireDate,
        isRetired: userProfile?.status === 'RETIRED',
      },
      approvalDocs: allApprovals,
      adjustments,
      holidays: holidayList,
    });

    return {
      grant: balance.totalGrantedDays,
      used: balance.usedDays,
      pending: balance.pendingDays,
      remaining: balance.remainingDays,
      available: balance.availableDays,
      otherUsed: balance.otherUsedDays,
      statutory: balance.statutory,
      advanceOffset: balance.advanceStatus,
      hireDate: balance.hireDate,
      substituteHoliday: balance.substituteHoliday,
      myDocs: balance.myDocs,
      isLoading: q.isLoading || profilesQ.isLoading,
    };
  }, [q.data, q.isLoading, profilesQ.data, profilesQ.isLoading, userId, subUpdateVer, holidayList]);
}
