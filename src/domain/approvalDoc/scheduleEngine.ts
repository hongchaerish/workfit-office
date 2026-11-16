import type { ApprovalDoc } from './schema';
import { calculateLeaveDays, effectiveLeaveKind, halfDayAbsenceRange } from '@/domain/leave/policy';
import type { ScheduleChange } from '@/domain/scheduleChange/schema';

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
  /**
   * 동행자 사용자 id — 서식의 '다중사용자' 필드(key 'companions')로 고른 사람.
   * 기안자와 같이 업무계획·캘린더·근태(외근·출장 인정)에 반영된다. 예전 글자 동행자는 이름이라 어느 계정과도 맞지 않는다.
   */
  companionIds?: string[];
  /** 결재 후 일정을 바꿨으면 문서에 적힌 원래 일정 — [[scheduleChange]] */
  changedFrom?: { startDate: string; endDate: string; startTime?: string; endTime?: string; reason: string; changedAt: string };
  substituteId?: string;
  substituteName?: string;
  amount?: number | null;
  body?: string;
}

/**
 * 단일 결재 문서로부터 표준 일정 정보를 안전하게 추출하는 순수 함수.
 * doc.form 및 doc.fieldValues 모두에서 안전하게 추출하며, 기존 DB 문서(Read-Only)와 100% 하위 호환됩니다.
 */
export function extractScheduleInfo(doc: ApprovalDoc, changes?: ReadonlyMap<string, ScheduleChange>): StandardScheduleInfo | null {
  const s = extractRawScheduleInfo(doc);
  return s ? applyScheduleChange(s, changes?.get(doc.id)) : null;
}

/** 다중사용자 값('id1,id2') → id 목록. 빈 칸·중복은 뺀다 */
export function splitUserIds(v: unknown): string[] {
  if (v == null || v === '') return [];
  return [...new Set(String(v).split(',').map((x) => x.trim()).filter(Boolean))];
}

/** 날짜 두 개 사이 일수(양끝 포함) */
function dayCount(start: string, end: string): number {
  const a = Date.parse(start + 'T00:00:00Z');
  const b = Date.parse(end + 'T00:00:00Z');
  return Number.isNaN(a) || Number.isNaN(b) ? 1 : Math.round((b - a) / 86_400_000) + 1;
}

/**
 * 결재 후 바뀐 일정을 덮어쓴다 — 외근·출장만. 휴가는 연차와 묶여 있어 바꾸지 않는다.
 * 행선지·목적 등 나머지는 문서 그대로.
 */
export function applyScheduleChange(s: StandardScheduleInfo, change: ScheduleChange | undefined): StandardScheduleInfo {
  if (!change || s.category === 'LEAVE') return s;
  const days = change.startDate === change.endDate ? (s.startDate === s.endDate ? s.days : 1) : dayCount(change.startDate, change.endDate);
  return {
    ...s,
    startDate: change.startDate,
    endDate: change.endDate,
    startTime: change.startTime ?? undefined,
    endTime: change.endTime ?? undefined,
    days,
    changedFrom: { startDate: s.startDate, endDate: s.endDate, startTime: s.startTime, endTime: s.endTime, reason: change.reason, changedAt: change.createdAt },
  };
}

/** 문서에 적힌 그대로의 일정 */
function extractRawScheduleInfo(doc: ApprovalDoc): StandardScheduleInfo | null {
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
  let startTime = doc.form?.startTime || (fVals['startTime'] ? String(fVals['startTime']) : undefined);
  let endTime = doc.form?.endTime || (fVals['endTime'] ? String(fVals['endTime']) : undefined);

  // 3. 목적지(destination)
  const destination = fVals['destination'] ? String(fVals['destination']) : undefined;

  // 4. 목적(purpose) 및 사유(body)
  const purpose = fVals['purpose'] ? String(fVals['purpose']) : undefined;
  // fieldValues.body 는 표 등 다른 필드일 수 있으니(표는 JSON 문자열) 글 본문일 때만 쓴다
  const rawBody = fVals['body'] ? String(fVals['body']) : '';
  const body = doc.body || (rawBody && !rawBody.trim().startsWith('{') ? rawBody : undefined);

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
  const companionIds = category === 'LEAVE' ? [] : splitUserIds(fVals['companions']).filter((id) => id !== doc.drafterId);

  // 8. 업무대행자(substituteId)
  const substituteId = fVals['substituteId'] ? String(fVals['substituteId']) : undefined;

  // 9. 휴가종류(leaveType)
  const leaveType = category === 'LEAVE'
    ? doc.form?.leaveType || String(fVals['leaveType'] || '연차')
    : undefined;

  // 반차는 실제 부재 시각(점심 포함 5시간)으로 — 예전 문서는 사용 4시간만 적혀 있다
  if (category === 'LEAVE') {
    const unit = (doc.form as { leaveUnit?: string } | undefined)?.leaveUnit || (fVals['leaveUnit'] ? String(fVals['leaveUnit']) : undefined);
    ({ startTime, endTime } = halfDayAbsenceRange(effectiveLeaveKind(leaveType, unit), startTime, endTime));
  }

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
    companionIds,
    substituteId,
    amount: doc.amount,
    body,
  };
}

/**
 * 승인 완료(`status === '완료'`)된 문서들 중 표준 일정 데이터만 추출하는 순수 함수
 */
export function extractApprovedSchedules(docs: ApprovalDoc[], changes?: ReadonlyMap<string, ScheduleChange>): StandardScheduleInfo[] {
  const list: StandardScheduleInfo[] = [];
  for (const doc of docs) {
    if (doc.status !== '완료') continue;
    const schedule = extractScheduleInfo(doc, changes);
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

