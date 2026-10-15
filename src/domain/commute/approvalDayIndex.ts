import type { ApprovalDoc } from '@/domain/approvalDoc/schema';
import { extractScheduleInfo, type StandardScheduleInfo } from '@/domain/approvalDoc/scheduleEngine';
import { isQuarterDayLeave, QUARTER_LEAVE_SLOTS, type QuarterLeaveSlot } from '@/domain/leave/policy';
import type { ApprovedLeaveInfo } from './engine';
import type { OutsideWork } from '@/domain/outsideWork/schema';
import { outsideWorkToDayInfo } from '@/domain/outsideWork/view';

/** 날짜(YYYY-MM-DD) → 그날 승인된 휴가·외근·출장·휴일근무 목록. 같은 날 여러 건을 모두 담는다. */
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
 * 휴일근무 신청 서식 — 별도 서식이 생기면 그 code 를 여기에 더한다. 지금은 연장근로 신청서로 신청한다.
 * 근태 판정은 이 승인이 있는 **주말·공휴일**만 휴일근무로 인정한다(평일 연장근로는 근태 상태를 바꾸지 않는다).
 */
export const HOLIDAY_WORK_DOC_TYPES: readonly string[] = ['휴일근무', '휴일근무신청', '연장근로'];

/** 휴일근무 신청 문서의 근무 일자 범위. 일자가 없거나 취소 기안이면 null. */
function holidayWorkRange(doc: ApprovalDoc): { start: string; end: string } | null {
  if (doc.cancelTargetDocId || !HOLIDAY_WORK_DOC_TYPES.includes(doc.docType)) return null;
  const f = doc.fieldValues ?? {};
  const start = String(f['workDate'] || f['period'] || f['startDate'] || f['date'] || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return null;
  const rawEnd = String(f['workDate__end'] || f['period__end'] || f['endDate'] || start);
  return { start, end: /^\d{4}-\d{2}-\d{2}$/.test(rawEnd) && rawEnd >= start ? rawEnd : start };
}

/**
 * 승인 완료된 결재(휴가·외근·출장·휴일근무)를 근태 판정용 인덱스로 만든다 — 웹·PWA 공용 단일 경로.
 * 기안자 id와 이름(공백 무시) 양쪽으로 색인해 계정 id가 달라도 이름으로 이어 붙인다.
 *
 * `outsideWorks`(결재 없이 직접 등록한 외근·출장)도 결재 완료 외근·출장과 같은 효력으로 넣는다.
 * 근태 판정과 재실 상태가 모두 이 인덱스를 보므로 한 곳에서 넣으면 둘 다 반영된다.
 */
export function buildApprovalDayIndex(docs: ApprovalDoc[], outsideWorks: readonly OutsideWork[] = []): ApprovalDayIndex {
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
    const holidayWork = holidayWorkRange(doc);
    if (holidayWork) {
      const info: ApprovedLeaveInfo = { leaveType: '휴일근무', category: 'HOLIDAY_WORK', docTitle: doc.title, docId: doc.id };
      const name = normName(doc.drafterName);
      eachDate(holidayWork.start, holidayWork.end, (date) => {
        add(`id:${doc.drafterId}`, date, info);
        if (name) add(`name:${name}`, date, info);
      });
      continue;
    }
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

  for (const w of outsideWorks) {
    const info = outsideWorkToDayInfo(w);
    eachDate(w.startDate, w.endDate, (date) => add(`id:${w.ownerUserId}`, date, info));
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
