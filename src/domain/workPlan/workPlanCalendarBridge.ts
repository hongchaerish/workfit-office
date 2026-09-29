import { calendarEventRepo, type CalendarEventActor } from '@/data/calendarEvent/calendarEvent.repo';
import type { CalendarEvent, CalendarEventDraft, CalendarEventType } from '@/domain/calendarEvent/schema';
import type { WorkPlan } from '@/domain/workPlan/schema';
import { parseWorkPlanItems } from './engine';

/**
 * 업무계획 연동 캘린더 이벤트 식별자 프리픽스
 * memo 필드에 [WP-SYNC:planId:itemIdx] 형태로 기록하여 1:1 양방향 동기화를 추적합니다.
 */
export const WP_SYNC_TAG_PREFIX = '[WP-SYNC:';

export function makeWpSyncTag(planId: string, itemIdx: number): string {
  return `${WP_SYNC_TAG_PREFIX}${planId}:${itemIdx}]`;
}

export function parseWpSyncTag(memo?: string | null): { planId: string; itemIdx: number } | null {
  if (!memo) return null;
  const match = memo.match(/\[WP-SYNC:([^:]+):(\d+)\]/);
  if (!match) return null;
  return { planId: match[1], itemIdx: Number(match[2]) };
}

export function isWorkPlanDerivedEvent(event: CalendarEvent): boolean {
  return Boolean(event.memo && event.memo.includes(WP_SYNC_TAG_PREFIX));
}

/**
 * 캘린더 공유 대상이 되는 대표적인 업무 태그 목록 (오직 회의 및 미팅만 캘린더 공유)
 */
export const SHAREABLE_TAGS = ['회의', '미팅'];

export function isShareableTag(tag?: string): boolean {
  if (!tag) return false;
  // 외근·출장, 휴가는 전자결재 전용이므로 업무계획에서 캘린더 이벤트로 직접 우회 생성하지 않음
  if (tag.includes('외근') || tag.includes('출장') || tag.includes('휴가')) return false;
  return SHAREABLE_TAGS.some((st) => tag.includes(st));
}

export function mapWorkPlanTagToCalendarEventType(tag?: string): CalendarEventType {
  if (!tag) return 'GENERAL';
  if (tag.includes('회의') || tag.includes('미팅')) return 'MEETING';
  return 'GENERAL';
}

/**
 * 텍스트에서 시간 패턴(HH:mm~HH:mm 또는 HH:mm)을 추출합니다.
 * 예: "거래처 미팅 (14:00~16:00)" -> { startTime: "14:00", endTime: "16:00" }
 * 예: "오전 10:00 회의" -> { startTime: "10:00", endTime: "11:00" }
 */
export function extractTimeFromText(text: string): { startTime: string | null; endTime: string | null; cleanText: string } {
  // 1. 범위 형식: HH:mm ~ HH:mm (또는 HH:mm-HH:mm)
  const rangeMatch = text.match(/[\(\[]?\s*([01]?\d|2[0-3]):([0-5]\d)\s*[-~]\s*([01]?\d|2[0-3]):([0-5]\d)\s*[\)\]]?/);
  if (rangeMatch) {
    const sH = rangeMatch[1].padStart(2, '0');
    const sM = rangeMatch[2];
    const eH = rangeMatch[3].padStart(2, '0');
    const eM = rangeMatch[4];
    const cleanText = text.replace(rangeMatch[0], '').trim().replace(/\s{2,}/g, ' ');
    return {
      startTime: `${sH}:${sM}`,
      endTime: `${eH}:${eM}`,
      cleanText,
    };
  }

  // 2. 단일 시각 형식: HH:mm
  const singleMatch = text.match(/[\(\[]?\s*([01]?\d|2[0-3]):([0-5]\d)\s*[\)\]]?/);
  if (singleMatch) {
    const sH = singleMatch[1].padStart(2, '0');
    const sM = singleMatch[2];
    const cleanText = text.replace(singleMatch[0], '').trim().replace(/\s{2,}/g, ' ');
    const endH = String(Math.min(23, Number(sH) + 1)).padStart(2, '0');
    return {
      startTime: `${sH}:${sM}`,
      endTime: `${endH}:${sM}`,
      cleanText,
    };
  }

  return { startTime: null, endTime: null, cleanText: text };
}

export interface ShareableItemDraft {
  itemIdx: number;
  draft: CalendarEventDraft;
}

/**
 * 단일 업무계획 내용으로부터 캘린더 공유용 CalendarEventDraft 배열을 도출합니다.
 */
export function buildShareableCalendarDrafts(
  plan: WorkPlan,
  deptId: string | null,
): ShareableItemDraft[] {
  const items = parseWorkPlanItems(plan.content);
  const drafts: ShareableItemDraft[] = [];

  items.forEach((item, idx) => {
    const { startTime, endTime, cleanText } = extractTimeFromText(item.text);

    // 캘린더에는 무조건 회의나 미팅만 연동 (자잘한 개인업무나 일반 To-Do는 연동하지 않음)
    const isMeeting = isShareableTag(item.tag) || item.text.includes('회의') || item.text.includes('미팅');
    if (!isMeeting) return;

    const isAllDay = !startTime || !endTime || startTime >= endTime;
    const eventType = mapWorkPlanTagToCalendarEventType(item.tag);
    const cleanItemText = cleanText || item.text;
    const textWithoutTag = cleanItemText.replace(/^\[(회의|미팅)\]\s*/, '').trim();
    const tagPrefix = item.tag ? `[${item.tag}] ` : '';
    const title = `${tagPrefix}${textWithoutTag}`.slice(0, 100);

    const syncTag = makeWpSyncTag(plan.id, idx);
    const memo = `업무계획 연동 일정\n${syncTag}`;

    const draft: CalendarEventDraft = {
      title,
      date: plan.date,
      allDay: isAllDay,
      startTime: isAllDay ? null : startTime,
      endTime: isAllDay ? null : endTime,
      memo,
      visibility: deptId ? 'TEAM' : 'PRIVATE',
      eventType,
      deptId: deptId || null,
      projectId: null,
      attendeeUserIds: [],
    };

    drafts.push({ itemIdx: idx, draft });
  });

  return drafts;
}

/**
 * 업무계획 저장(생성/수정) 시 캘린더 일정과 1:1 동기화하는 엔진 함수
 */
export async function syncWorkPlanToCalendar(
  actor: CalendarEventActor,
  plan: WorkPlan,
  enabled = true,
): Promise<void> {
  if (!actor.active || !enabled) return;

  try {
    // 1. 해당 날짜에 본인이 등록한 캘린더 이벤트 조회
    const existingEvents = await calendarEventRepo.list(actor, { from: plan.date, to: plan.date });

    // 2. 현재 plan.id로 발행된 기존 연동 이벤트들만 필터링
    const myPlanEvents = existingEvents.filter((e) => {
      const parsed = parseWpSyncTag(e.memo);
      return parsed && parsed.planId === plan.id;
    });

    // 3. 새 업무계획 내용에서 도출된 공유 대상 draft 목록
    const desiredDrafts = buildShareableCalendarDrafts(plan, actor.deptId ?? null);
    const desiredMap = new Map<number, CalendarEventDraft>();
    desiredDrafts.forEach((d) => desiredMap.set(d.itemIdx, d.draft));

    // 4. 기존 이벤트 중 유지/업데이트할 것과 삭제할 것 분류
    for (const oldEvent of myPlanEvents) {
      const parsed = parseWpSyncTag(oldEvent.memo);
      if (!parsed) continue;

      const newDraft = desiredMap.get(parsed.itemIdx);
      if (newDraft) {
        // 내용 변경 여부 확인 후 업데이트
        const isChanged =
          oldEvent.title !== newDraft.title ||
          oldEvent.allDay !== newDraft.allDay ||
          oldEvent.startTime !== newDraft.startTime ||
          oldEvent.endTime !== newDraft.endTime ||
          oldEvent.eventType !== newDraft.eventType ||
          oldEvent.visibility !== newDraft.visibility;

        if (isChanged) {
          await calendarEventRepo.update(actor, oldEvent.id, newDraft);
        }
        // 처리 완료된 항목은 맵에서 제거
        desiredMap.delete(parsed.itemIdx);
      } else {
        // 더 이상 존재하지 않는 항목은 캘린더에서 자동 삭제
        await calendarEventRepo.remove(actor, oldEvent.id);
      }
    }

    // 5. 새로 추가된 항목들 캘린더에 생성
    for (const [_, draft] of desiredMap) {
      await calendarEventRepo.create(actor, draft);
    }
  } catch (error) {
    console.error('[workPlanCalendarBridge] 캘린더 동기화 중 오류 발생:', error);
  }
}

/**
 * 업무계획 삭제 시 해당 계획에서 생성된 모든 캘린더 일정을 일괄 삭제하는 헬퍼
 */
export async function cleanupWorkPlanCalendarEvents(
  actor: CalendarEventActor,
  planId: string,
  date?: string,
): Promise<void> {
  if (!actor.active) return;

  try {
    const filter = date ? { from: date, to: date } : undefined;
    const existingEvents = await calendarEventRepo.list(actor, filter);
    const toDelete = existingEvents.filter((e) => {
      const parsed = parseWpSyncTag(e.memo);
      return parsed && parsed.planId === planId;
    });

    for (const ev of toDelete) {
      await calendarEventRepo.remove(actor, ev.id);
    }
  } catch (error) {
    console.error('[workPlanCalendarBridge] 캘린더 정리 중 오류 발생:', error);
  }
}

/**
 * 캘린더 이벤트 목록을 현재 업무계획 마크다운 텍스트에 멱등(Idempotent)하게 병합합니다.
 *
 * 멱등성 보장 원칙:
 * 1. 업무계획에서 캘린더로 역생성된 이벤트(isWorkPlanDerivedEvent)는 제외합니다.
 * 2. 이미 현재 content 내에 동일한 제목이나 시간대가 존재하는 이벤트는 건너뜁니다.
 * 3. 연속으로 몇 번을 호출하더라도 중복 항목이 단 1건도 생성되지 않습니다.
 */
export function importCalendarEventsToWorkPlanContent(
  currentContent: string,
  events: CalendarEvent[],
): { nextContent: string; addedCount: number } {
  const cleanBase = (str: string) => str.replace(/[\s\(\)\[\]\-_:·🏖️🏃🚗👥🎉📝]/g, '').toLowerCase();

  const existingItems = parseWorkPlanItems(currentContent);
  const existingNormalizedList = existingItems
    .map((item) => cleanBase(item.raw))
    .filter(Boolean);

  const linesToAdd: string[] = [];

  for (const ev of events) {
    // 1. 업무계획에서 복제된 역방향 이벤트는 제외
    if (isWorkPlanDerivedEvent(ev)) continue;

    // 2. 제목 정제 및 태그/시간 도출
    let rawTitle = ev.title.trim();
    // 기호나 이모지 프리픽스 제거 (예: 🏖️ [휴가] 연차 -> 연차)
    rawTitle = rawTitle.replace(/^[🏖️🏃🚗👥🎉📝\s]+/, '');

    let tag = '일정';
    if (ev.eventType === 'MEETING') tag = '회의';
    else if (ev.eventType === 'OUTSIDE') tag = '외근·출장';
    else if (ev.eventType === 'VACATION') tag = '휴가';
    else if (ev.eventType === 'COMPANY_EVENT') tag = '사내행사';

    // 이미 대괄호 태그가 붙어있는 경우 처리
    const titleTagMatch = rawTitle.match(/^\[([^\]]+)\]\s*(.*)$/);
    if (titleTagMatch) {
      tag = titleTagMatch[1];
      rawTitle = titleTagMatch[2];
    }

    const timeStr = !ev.allDay && ev.startTime && ev.endTime
      ? `(${ev.startTime}~${ev.endTime})`
      : !ev.allDay && ev.startTime
      ? `(${ev.startTime})`
      : '';

    const newFormattedLine = `[${tag}] ${timeStr ? `${timeStr} ` : ''}${rawTitle}`.trim();
    const newNorm = cleanBase(rawTitle);

    // 3. 멱등성 검사: 기존 항목 중 제목 핵심 단어가 매칭되는지 확인
    const isAlreadyPresent = existingNormalizedList.some((ex) => {
      if (!newNorm) return false;
      return ex.includes(newNorm) || newNorm.includes(ex);
    });

    if (!isAlreadyPresent) {
      linesToAdd.push(newFormattedLine);
      existingNormalizedList.push(newNorm);
    }
  }

  if (linesToAdd.length === 0) {
    return { nextContent: currentContent, addedCount: 0 };
  }

  const trimmed = currentContent.trim();
  const nextContent = trimmed
    ? `${trimmed}\n${linesToAdd.join('\n')}`
    : linesToAdd.join('\n');

  return { nextContent, addedCount: linesToAdd.length };
}
