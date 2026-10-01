import { calendarEventRepo, type CalendarEventActor } from '@/data/calendarEvent/calendarEvent.repo';
import type { CalendarEvent } from '@/domain/calendarEvent/schema';
import { parseWorkPlanItems } from './engine';

/**
 * 업무계획 연동 캘린더 이벤트 식별자 프리픽스
 * memo 필드에 [WP-SYNC:planId:itemIdx] 형태로 기록하여 1:1 양방향 동기화를 추적합니다.
 */
export const WP_SYNC_TAG_PREFIX = '[WP-SYNC:';

export function parseWpSyncTag(memo?: string | null): { planId: string; itemIdx: number } | null {
  if (!memo) return null;
  const match = memo.match(/\[WP-SYNC:([^:]+):(\d+)\]/);
  if (!match) return null;
  return { planId: match[1], itemIdx: Number(match[2]) };
}

export function isWorkPlanDerivedEvent(event: CalendarEvent): boolean {
  return Boolean(event.memo && event.memo.includes(WP_SYNC_TAG_PREFIX));
}

/*
  업무계획 → 캘린더 자동 생성(syncWorkPlanToCalendar)은 2026-10-01 중단했다.
  본문에 '회의'·'미팅' 글자만 있어도 일정이 생기고, 같은 회의가 참석자 수만큼·동시 저장 횟수만큼
  중복 생성됐다. 회의는 [회의 등록]으로 캘린더 일정 1건 + 참석자로 만드는 구조로 바꾼다
  (docs/업무계획_고도화_및_회의연동_개선안.md). 이미 만들어진 연동 일정은 [WP-SYNC:…] 태그로
  식별해 업무계획 삭제 시 정리만 한다.
*/

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
