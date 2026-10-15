import type { StandardScheduleInfo } from '@/domain/approvalDoc/scheduleEngine';
import type { ApprovedLeaveInfo } from '@/domain/commute/engine';
import { OUTSIDE_WORK_CATEGORY_LABELS, type OutsideWork, type OutsideWorkCategory } from './schema';

/**
 * 외근·출장 한 건의 화면 표시 모델 — 결재 완료 건과 직접 등록 건을 같은 모양으로 다룬다.
 * 업무계획 칩·상세 창·캘린더가 이것만 보면 출처를 몰라도 된다.
 */
export interface OutsideScheduleView {
  /** 'appr-<docId>' | 'self-<id>' */
  key: string;
  source: 'APPROVAL' | 'SELF';
  ownerUserId: string;
  ownerName?: string;
  category: OutsideWorkCategory;
  subType: string;
  startDate: string;
  endDate: string;
  startTime?: string;
  endTime?: string;
  destination?: string;
  purpose?: string;
  companions?: string;
  transportation?: string;
  contact?: string;
  memo?: string;
  /** source === 'APPROVAL' */
  approval?: { docId: string; docNo: string; docTitle: string };
  /** source === 'SELF' — 수정·삭제할 원본 */
  self?: OutsideWork;
}

/** 결재 완료 일정 → 표시 모델. 휴가는 대상이 아니다(사유 비공개라 상세를 열지 않는다). */
export function fromApprovalSchedule(s: StandardScheduleInfo): OutsideScheduleView | null {
  if (s.category === 'LEAVE') return null;
  return {
    key: `appr-${s.docId}`,
    source: 'APPROVAL',
    ownerUserId: s.drafterId,
    ownerName: s.drafterName,
    category: s.category,
    subType: s.subType || OUTSIDE_WORK_CATEGORY_LABELS[s.category],
    startDate: s.startDate,
    endDate: s.endDate,
    startTime: s.startTime,
    endTime: s.endTime,
    destination: s.destination,
    purpose: s.purpose,
    companions: s.companions,
    transportation: s.transportation,
    contact: s.emergencyContact,
    memo: s.body,
    approval: { docId: s.docId, docNo: s.docNo, docTitle: s.docTitle },
  };
}

/** 직접 등록 → 표시 모델. 동행자는 id를 이름으로 바꿔 결재 건과 같은 문자열로 맞춘다. */
export function fromOutsideWork(w: OutsideWork, nameOf: (userId: string) => string | undefined = () => undefined): OutsideScheduleView {
  const companions = w.companionUserIds.map((id) => nameOf(id) ?? id).join(', ');
  return {
    key: `self-${w.id}`,
    source: 'SELF',
    ownerUserId: w.ownerUserId,
    ownerName: nameOf(w.ownerUserId),
    category: w.category,
    subType: w.subType,
    startDate: w.startDate,
    endDate: w.endDate,
    startTime: w.startTime ?? undefined,
    endTime: w.endTime ?? undefined,
    destination: w.destination,
    purpose: w.purpose || undefined,
    companions: companions || undefined,
    transportation: w.transportation || undefined,
    contact: w.contact || undefined,
    memo: w.memo || undefined,
    self: w,
  };
}

/** 근태·재실 인덱스에 넣을 항목 — 결재 완료 외근·출장과 같은 모양(docId 자리에 등록 id). */
export function outsideWorkToDayInfo(w: OutsideWork): ApprovedLeaveInfo {
  return {
    leaveType: w.subType,
    category: w.category,
    docTitle: `${OUTSIDE_WORK_CATEGORY_LABELS[w.category]} ${w.destination}`,
    docId: w.id,
  };
}

/** 범위(YYYY-MM-DD)와 겹치는지 */
export function overlapsRange(item: { startDate: string; endDate: string }, from: string, to: string): boolean {
  return item.startDate <= to && item.endDate >= from;
}
