/**
 * 기결재된 기존 휴가 문서(Legacy Approvals) 런타임 호환 어댑터
 *
 * DB의 기존 레코드를 절대 수정하지 않고(rule-readonly.md 준수),
 * 조회 시점에 도메인 계층에서 표준 NormalizedLeaveRecord 형식으로 동적 정규화합니다.
 *
 * @see docs/연차휴가_산정_및_관리_정책_설계서.md §8
 */

import type { ApprovalDoc, DocStatus } from '@/domain/approvalDoc/schema';
import { getDefaultTimeWindow, calculateLeaveDays, type CalculateLeaveDaysOptions } from './policy';

export interface NormalizedLeaveRecord {
  docId: string;
  docNo: string;
  drafterId: string;
  drafterName?: string | null;
  drafterDept?: string | null;
  leaveType: string;              // '연차' | '오전반차' | '오후반차' | '반반차' | '대체휴무' 등
  startDate: string;              // "YYYY-MM-DD"
  endDate: string;                // "YYYY-MM-DD"
  startTime: string;              // "08:30" or "13:30"
  endTime: string;                // "12:30" or "17:30"
  days: number;                   // 1.0, 0.5, 0.25 (과거 수치 절대 보존)
  status: DocStatus;
  isLegacy: boolean;              // 구버전 결재문서 여부
  reason?: string | null;
  completedAt?: string | null;
  createdAt?: string | null;
}

/**
 * 결재 문서에서 텍스트(제목, 사유 등)를 분석하여 오전/오후 시간대를 휴리스틱으로 추론합니다.
 */
function inferHalfDayTimeWindow(title: string = '', body: string = '', defaultFallback: 'AM' | 'PM' = 'AM') {
  const combined = `${title} ${body}`.toLowerCase();
  
  // 오후 키워드 우선 검사
  if (combined.includes('오후') || combined.includes('pm') || combined.includes('afternoon')) {
    return {
      leaveType: '오후반차',
      startTime: '13:30',
      endTime: '17:30',
    };
  }

  // 오전 키워드 검사
  if (combined.includes('오전') || combined.includes('am') || combined.includes('morning')) {
    return {
      leaveType: '오전반차',
      startTime: '08:30',
      endTime: '12:30',
    };
  }

  // 키워드가 없는 순수 '반차'인 경우 폴백 (기본값: 오전반차 08:30~12:30)
  return defaultFallback === 'PM'
    ? { leaveType: '오후반차', startTime: '13:30', endTime: '17:30' }
    : { leaveType: '오전반차', startTime: '08:30', endTime: '12:30' };
}

/**
 * 단일 결재 문서를 표준 정규화 레코드로 변환 (Read-Only Adapter)
 */
export function normalizeLegacyLeaveDoc(
  doc: ApprovalDoc,
  opts?: { holidays?: CalculateLeaveDaysOptions['holidays'] },
): NormalizedLeaveRecord | null {
  // 휴가 문서가 아니거나 삭제된 문서 제외
  if (doc.docType !== '휴가') return null;

  const form = doc.form;
  const fieldValues = (doc as any).fieldValues;

  const rawLeaveType = form?.leaveType || fieldValues?.leaveType || (doc.title?.includes('반차') ? '반차' : '연차');
  const startDate = form?.startDate || fieldValues?.period || doc.createdAt?.slice(0, 10) || '';
  const endDate = form?.endDate || fieldValues?.period__end || startDate;

  // 단일 기준 휴가 일수 계산기(SSOT)를 통해 산출
  // (반차/반반차는 DB에 1일로 잘못 기표된 레거시 데이터도 0.5일/0.25일로 자동 교정 보장)
  const rawDays =
    typeof form?.days === 'number'
      ? form.days
      : typeof (form as any)?.daysCount === 'number'
      ? (form as any).daysCount
      : typeof fieldValues?.period__days === 'number'
      ? fieldValues.period__days
      : undefined;

  const days = calculateLeaveDays({
    leaveType: rawLeaveType,
    startDate,
    endDate,
    rawDays,
    title: doc.title,
    holidays: opts?.holidays,
  });

  // 시간대 및 신/구버전 판별
  let finalLeaveType = rawLeaveType;
  let startTime = (form as any)?.startTime || fieldValues?.startTime;
  let endTime = (form as any)?.endTime || fieldValues?.endTime;
  let isLegacy = false;

  if (!startTime || !endTime) {
    isLegacy = true;
    if (rawLeaveType === '반차' || doc.title?.includes('반차')) {
      const inferred = inferHalfDayTimeWindow(doc.title, doc.body || (doc as any).content || '');
      finalLeaveType = inferred.leaveType;
      startTime = inferred.startTime;
      endTime = inferred.endTime;
    } else {
      const defaultWin = getDefaultTimeWindow(rawLeaveType);
      startTime = defaultWin.startTime;
      endTime = defaultWin.endTime;
    }
  }

  return {
    docId: doc.id,
    docNo: doc.docNo,
    drafterId: doc.drafterId,
    drafterName: doc.drafterName,
    drafterDept: doc.drafterDept,
    leaveType: finalLeaveType,
    startDate,
    endDate,
    startTime,
    endTime,
    days,
    status: doc.status,
    isLegacy,
    reason: doc.body || (doc as any).content,
    completedAt: doc.completedAt,
    createdAt: doc.createdAt,
  };
}

/**
 * 결재 문서 목록 전체를 정규화하여 유효한 휴가 레코드 배열로 반환
 */
export function normalizeLeaveDocs(
  docs: ApprovalDoc[],
  opts?: { holidays?: CalculateLeaveDaysOptions['holidays'] },
): NormalizedLeaveRecord[] {
  return docs
    .map((doc) => normalizeLegacyLeaveDoc(doc, opts))
    .filter((d): d is NormalizedLeaveRecord => d !== null);
}
