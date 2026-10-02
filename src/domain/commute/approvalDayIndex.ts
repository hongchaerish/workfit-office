import type { ApprovalDoc } from '@/domain/approvalDoc/schema';
import { extractScheduleInfo, type StandardScheduleInfo } from '@/domain/approvalDoc/scheduleEngine';
import { isQuarterDayLeave, QUARTER_LEAVE_SLOTS, type QuarterLeaveSlot } from '@/domain/leave/policy';
import type { ApprovedLeaveInfo } from './engine';

/** 날짜(YYYY-MM-DD) → 그날 승인된 휴가·외근·출장 목록. 같은 날 여러 건을 모두 담는다. */
export type ApprovalDayMap = Map<string, ApprovedLeaveInfo[]>;

export interface ApprovalDayIndex {
  /** 사람(사용자 id·이름)의 날짜별 승인 일정. id로 묶인 것과 이름으로 묶인 것을 합친다. */
  lookup(person: { id?: string | null; name?: string | null }): ApprovalDayMap;
}

const normName = (s?: string | null) => (s || '').replace(/\s+/g, '');
const pad = (v: number) => String(v).padStart(2, '0');

function eachDate(start: string, end: string, fn: (date: string) => void) {
  const cur = new Date(start + 'T00:00:00');
  const last = new Date((end || start) + 'T00:00:00');
  if (Number.isNaN(cur.getTime()) || Number.isNaN(last.getTime())) return;
  while (cur <= last) {
    fn(`${cur.getFullYear()}-${pad(cur.getMonth() + 1)}-${pad(cur.getDate())}`);
    cur.setDate(cur.getDate() + 1);
  }
}

function quarterSlotOf(doc: ApprovalDoc, s: StandardScheduleInfo): QuarterLeaveSlot['key'] | undefined {
  if (!isQuarterDayLeave(s.leaveType, s.docTitle)) return undefined;
  const fromField = QUARTER_LEAVE_SLOTS.find((slot) => slot.key === doc.fieldValues?.quarterSlot);
  if (fromField) return fromField.key;
  const fromTime = QUARTER_LEAVE_SLOTS.find((slot) => slot.startTime === s.startTime);
  return fromTime?.key ?? 'PM2';
}

function toInfo(doc: ApprovalDoc, s: StandardScheduleInfo): ApprovedLeaveInfo {
  return {
    leaveType:
      s.category === 'LEAVE'
        ? s.leaveType || '연차'
        : s.category === 'OUTSIDE'
        ? s.subType || '외근'
        : s.subType || '출장',
    category: s.category,
    docTitle: s.docTitle,
    docId: s.docId,
    quarterSlot: quarterSlotOf(doc, s),
  };
}

/**
 * 승인 완료된 결재(휴가·외근·출장)를 근태 판정용 인덱스로 만든다 — 웹·PWA 공용 단일 경로.
 * 기안자 id와 이름(공백 무시) 양쪽으로 색인해 계정 id가 달라도 이름으로 이어 붙인다.
 */
export function buildApprovalDayIndex(docs: ApprovalDoc[]): ApprovalDayIndex {
  const byKey = new Map<string, ApprovalDayMap>();
  const add = (key: string, date: string, info: ApprovedLeaveInfo) => {
    if (!key) return;
    let days = byKey.get(key);
    if (!days) byKey.set(key, (days = new Map()));
    const list = days.get(date) ?? [];
    if (!list.some((e) => e.docId === info.docId)) list.push(info);
    days.set(date, list);
  };

  for (const doc of docs) {
    if (doc.status !== '완료') continue;
    const s = extractScheduleInfo(doc);
    if (!s) continue;
    const info = toInfo(doc, s);
    const name = normName(s.drafterName || doc.drafterName);
    eachDate(s.startDate, s.endDate, (date) => {
      add(`id:${s.drafterId}`, date, info);
      if (doc.drafterId !== s.drafterId) add(`id:${doc.drafterId}`, date, info);
      if (name) add(`name:${name}`, date, info);
    });
  }

  return {
    lookup(person) {
      const merged: ApprovalDayMap = new Map();
      const sources = [
        person.id ? byKey.get(`id:${person.id}`) : undefined,
        person.name ? byKey.get(`name:${normName(person.name)}`) : undefined,
      ];
      for (const days of sources) {
        if (!days) continue;
        for (const [date, list] of days) {
          const target = merged.get(date) ?? [];
          for (const info of list) {
            if (!target.some((e) => e.docId === info.docId)) target.push(info);
          }
          merged.set(date, target);
        }
      }
      return merged;
    },
  };
}
