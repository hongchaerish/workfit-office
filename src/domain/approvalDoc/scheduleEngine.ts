import type { ApprovalDoc } from './schema';
import type { UserPresenceStatus } from '@/domain/userPresence/schema';
import { calculateLeaveDays } from '@/domain/leave/policy';

/**
 * 전사 표준 일정/근태 연동 정보 규격 (Single Source of Truth)
 * 전자결재(휴가·외근·출장) 승인 문서로부터 도출되는 공통 표준 데이터
 */
export interface StandardScheduleInfo {
  category: 'LEAVE' | 'OUTSIDE' | 'TRIP';
  docType: string;
  docId: string;
  docNo: string;
  docTitle: string;
  drafterId: string;
  drafterName?: string;
  drafterDept?: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  startTime?: string; // HH:mm
  endTime?: string;   // HH:mm
  days: number;
  leaveType?: string; // 휴가 세부 종류 (연차, 반차, 대체휴무 등)
  subType?: string;   // 외근/출장 세부 구분 (종일/오전/오후/시간, 국내/해외)
  destination?: string;
  purpose?: string;
  transportation?: string;
  emergencyContact?: string;
  companions?: string;
  substituteId?: string;
  substituteName?: string;
  amount?: number | null;
  body?: string;
}

/**
 * 단일 결재 문서로부터 표준 일정 정보를 안전하게 추출하는 순수 함수.
 * doc.form 및 doc.fieldValues 모두에서 안전하게 추출하며, 기존 DB 문서(Read-Only)와 100% 하위 호환됩니다.
 */
export function extractScheduleInfo(doc: ApprovalDoc): StandardScheduleInfo | null {
  // 취소 기안 문서는 원문서의 일정을 취소하기 위한 결재 문서이므로 자체 일정을 생성하지 않음
  if (doc.cancelTargetDocId) return null;

  const docType = doc.docType;
  let category: 'LEAVE' | 'OUTSIDE' | 'TRIP' | null = null;

  if (docType === '휴가') {
    category = 'LEAVE';
  } else if (docType === '외근') {
    category = 'OUTSIDE';
  } else if (docType === '국내출장' || docType === '해외출장' || docType.includes('출장')) {
    category = 'TRIP';
  }

  if (!category) return null;

  const fVals = doc.fieldValues ?? {};

  // 1. 기간(startDate, endDate, days) 추출
  let startDate = '';
  let endDate = '';
  let days = 1;

  if (category === 'LEAVE' && doc.form) {
    startDate = doc.form.startDate || '';
    endDate = doc.form.endDate || startDate;
    days = calculateLeaveDays({
      leaveType: doc.form.leaveType || (fVals['leaveType'] as string),
      startDate,
      endDate,
      rawDays: doc.form.days,
      title: doc.title,
    });
  }

  if (!startDate) {
    startDate = String(
      fVals['period'] ||
      fVals['startDate'] ||
      fVals['workDate'] ||
      fVals['date'] ||
      fVals['outDate'] ||
      fVals['tripDate'] ||
      ''
    );
    endDate = String(
      fVals['period__end'] ||
      fVals['endDate'] ||
      fVals['workDate__end'] ||
      startDate
    );
    days = category === 'LEAVE'
      ? calculateLeaveDays({
          leaveType: String(fVals['leaveType'] || ''),
          startDate,
          endDate,
          rawDays: Number(fVals['period__days']) || undefined,
          title: doc.title,
        })
      : Number(fVals['period__days'] || fVals['days']) || 1;
  }

  if (!startDate) return null;
  if (!endDate) endDate = startDate;

  // 2. 시간(startTime, endTime) 추출
  const startTime = doc.form?.startTime || (fVals['startTime'] ? String(fVals['startTime']) : undefined);
  const endTime = doc.form?.endTime || (fVals['endTime'] ? String(fVals['endTime']) : undefined);

  // 3. 목적지(destination)
  const destination = fVals['destination'] ? String(fVals['destination']) : undefined;

  // 4. 목적(purpose) 및 사유(body)
  const purpose = fVals['purpose'] ? String(fVals['purpose']) : undefined;
  const body = doc.body || (fVals['body'] ? String(fVals['body']) : undefined);

  // 5. 교통수단(transportation)
  const transportation = fVals['transportation'] ? String(fVals['transportation']) : undefined;

  // 6. 비상연락처(emergencyContact)
  const emergencyContact = fVals['emergencyContact']
    ? String(fVals['emergencyContact'])
    : fVals['contactNumber']
    ? String(fVals['contactNumber'])
    : undefined;

  // 7. 동행자(companions)
  const companions = fVals['companions'] ? String(fVals['companions']) : undefined;

  // 8. 업무대행자(substituteId)
  const substituteId = fVals['substituteId'] ? String(fVals['substituteId']) : undefined;

  // 9. 휴가종류(leaveType)
  const leaveType = category === 'LEAVE'
    ? doc.form?.leaveType || String(fVals['leaveType'] || '연차')
    : undefined;

  // 10. 세부 구분(subType)
  let subType: string | undefined = undefined;
  if (category === 'OUTSIDE') {
    subType = String(fVals['outsideType'] || '종일 외근');
  } else if (category === 'TRIP') {
    subType = String(fVals['overseasType'] || (docType === '해외출장' ? '해외출장' : '국내출장'));
  }

  return {
    category,
    docType,
    docId: doc.id,
    docNo: doc.docNo,
    docTitle: doc.title,
    drafterId: doc.drafterId,
    drafterName: doc.drafterName ?? undefined,
    drafterDept: doc.drafterDept,
    startDate,
    endDate,
    startTime,
    endTime,
    days,
    leaveType,
    subType,
    destination,
    purpose,
    transportation,
    emergencyContact,
    companions,
    substituteId,
    amount: doc.amount,
    body,
  };
}

/**
 * 승인 완료(`status === '완료'`)된 문서들 중 표준 일정 데이터만 추출하는 순수 함수
 */
export function extractApprovedSchedules(docs: ApprovalDoc[]): StandardScheduleInfo[] {
  const list: StandardScheduleInfo[] = [];
  for (const doc of docs) {
    if (doc.status !== '완료') continue;
    const schedule = extractScheduleInfo(doc);
    if (schedule) list.push(schedule);
  }
  return list;
}

/**
 * 특정 날짜(YYYY-MM-DD)가 스케줄 기간 내에 포함되는지 검사하는 순수 함수
 */
export function isDateInSchedule(dateStr: string, schedule: StandardScheduleInfo): boolean {
  return schedule.startDate <= dateStr && dateStr <= schedule.endDate;
}

/**
 * 특정 사용자의 당일(targetDate) 승인된 스케줄을 바탕으로 실시간 상태(UserPresenceStatus)를 자동 도출하는 순수 함수.
 * - 휴가 중: 'LEAVE'
 * - 외근/출장 중: 'OUTSIDE'
 * - 해당 없음: null (온라인/오프라인 등 기본 상태 유지)
 */
export function derivePresenceFromSchedules(
  userId: string,
  targetDate: string,
  approvedSchedules: StandardScheduleInfo[],
): UserPresenceStatus | null {
  const userSchedules = approvedSchedules.filter(
    (s) => s.drafterId === userId && isDateInSchedule(targetDate, s),
  );

  if (userSchedules.length === 0) return null;

  // 1순위: 휴가
  if (userSchedules.some((s) => s.category === 'LEAVE')) {
    return 'LEAVE';
  }

  // 2순위: 외근 또는 출장
  if (userSchedules.some((s) => s.category === 'OUTSIDE' || s.category === 'TRIP')) {
    return 'OUTSIDE';
  }

  return null;
}
