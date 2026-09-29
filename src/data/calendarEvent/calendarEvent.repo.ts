import { CALENDAR_EVENT_SEED } from '@/data/seeds/calendarEvent.seed';
import { createCrudBackend } from '@/data/_backend/crudBackend';
import { isValidCalendarDate } from '@/domain/calendarEvent/calendarDate';
import { canViewEvent, maskEventForSupervisor, isCompanyEvent, type CalendarAccessContext } from '@/domain/calendarEvent/engine';
import { calendarEventSchema, type CalendarEvent, type CalendarEventDraft, type CalendarEventType } from '@/domain/calendarEvent/schema';

/**
 * Appwrite calendarEvents 컬렉션 스키마에 정의되지 않은 속성(eventType, attendeeUserIds)을
 * memo 필드 내 [CAL_META:...] 태그로 안전하게 인코딩/디코딩합니다.
 * 이를 통해 Appwrite "Unknown attribute" 에러를 원천 차단하면서도 클라이언트의
 * 일정 유형(회의·사내행사 등)과 참여자 정보를 영속적으로 유지합니다.
 */
const CAL_META_REGEX = /\[CAL_META:(\{.*?\})\]/;

interface CalMeta {
  eventType?: CalendarEventType;
  attendeeUserIds?: string[];
}

function encodeEventForStorage(event: CalendarEvent): CalendarEvent {
  const meta: CalMeta = {};
  if (event.eventType && event.eventType !== 'GENERAL') {
    meta.eventType = event.eventType;
  }
  if (event.attendeeUserIds && event.attendeeUserIds.length > 0) {
    meta.attendeeUserIds = event.attendeeUserIds;
  }

  // 기존 메모에서 혹시 남아있는 CAL_META 태그 제거
  let cleanMemo = (event.memo || '').replace(CAL_META_REGEX, '').trim();

  // 메타 정보가 있는 경우에만 태그 추가 (길이 1800자 초과 방지)
  if (Object.keys(meta).length > 0) {
    cleanMemo = cleanMemo.slice(0, 1800);
    const metaStr = `[CAL_META:${JSON.stringify(meta)}]`;
    cleanMemo = cleanMemo ? `${cleanMemo}\n${metaStr}` : metaStr;
  }

  return {
    ...event,
    memo: cleanMemo,
  };
}

function decodeEventFromStorage(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const obj = { ...(raw as Record<string, unknown>) };

  let eventType = obj.eventType as CalendarEventType | undefined;
  let attendeeUserIds = Array.isArray(obj.attendeeUserIds) ? (obj.attendeeUserIds as string[]) : undefined;
  let memo = typeof obj.memo === 'string' ? obj.memo : '';

  const metaMatch = memo.match(CAL_META_REGEX);
  if (metaMatch) {
    try {
      const parsedMeta = JSON.parse(metaMatch[1]) as CalMeta;
      if (parsedMeta.eventType) eventType = parsedMeta.eventType;
      if (parsedMeta.attendeeUserIds) attendeeUserIds = parsedMeta.attendeeUserIds;
    } catch {
      // JSON 파싱 실패 시 무시
    }
    memo = memo.replace(CAL_META_REGEX, '').trim();
    obj.memo = memo;
  }

  // 메타 태그에도 없고 DB 필드에도 없는 경우: 제목/가시성으로부터 스마트 복원
  if (!eventType) {
    const title = typeof obj.title === 'string' ? obj.title : '';
    if (title.includes('[회의]') || title.includes('[미팅]')) {
      eventType = 'MEETING';
    } else if (title.includes('[사내행사]') || title.includes('[행사]')) {
      eventType = 'COMPANY_EVENT';
    } else if (obj.visibility === 'COMPANY') {
      eventType = 'COMPANY_EVENT';
    } else {
      eventType = 'GENERAL';
    }
  }

  obj.eventType = eventType;
  obj.attendeeUserIds = attendeeUserIds ?? [];

  return obj;
}

/**
 * 일정 조회·변경 주체.
 *
 * `deptId`·`projectIds`는 공유 판정에만 쓰인다. 넘기지 않으면 부서·프로젝트 공유 일정이
 * 안 보일 뿐 내 일정은 그대로 보인다 — 공유를 아직 안 쓰는 호출부는 고치지 않아도 된다.
 */
export interface CalendarEventActor extends Partial<Pick<CalendarAccessContext, 'deptId' | 'projectIds'>> {
  userId: string;
  active: boolean;
}

const accessContextOf = (actor: CalendarEventActor): CalendarAccessContext => ({
  userId: actor.userId,
  deptId: actor.deptId ?? null,
  projectIds: actor.projectIds ?? [],
  active: actor.active,
});

export interface CalendarEventFilter {
  from?: string;
  to?: string;
}

export class CalendarEventError extends Error {
  constructor(public readonly code: 'FORBIDDEN' | 'NOT_FOUND' | 'INVALID_RANGE' | 'INVALID_INPUT', message: string) {
    super(message);
    this.name = 'CalendarEventError';
  }
}

/**
 * 스키마 검증 → 사람이 읽는 오류.
 *
 * `schema.parse`가 던지는 `ZodError`의 `message`는 이슈 배열을 통째로 담은 JSON이다.
 * 화면이 그걸 그대로 띄우면 "일정 제목을 입력하세요" 대신 대괄호와 코드가 나온다.
 * 이슈 메시지 자체는 이미 사람이 읽을 문장이라, 첫 번째 것만 꺼내 쓴다 — 한 번에 하나씩
 * 고치게 하는 편이 여러 줄을 한꺼번에 보여 주는 것보다 낫다.
 */
function parseEvent(input: unknown): CalendarEvent {
  const decoded = decodeEventFromStorage(input);
  const parsed = calendarEventSchema.safeParse(decoded);
  if (parsed.success) return parsed.data;
  const first = parsed.error.issues[0];
  throw new CalendarEventError('INVALID_INPUT', first?.message || '입력값을 확인하세요.');
}

let mutationQueue = Promise.resolve();

function cloneEvent(event: CalendarEvent): CalendarEvent {
  return { ...event };
}

function exclusiveMutation<T>(work: () => Promise<T>): Promise<T> {
  const next = mutationQueue.then(work, work);
  mutationQueue = next.then(() => undefined, () => undefined);
  return next;
}

/**
 * 일정 컬렉션. 문서 ID = `CalendarEvent.id`(`CAL-20260813-0001`).
 * 저장은 공유 CrudBackend(VITE_DB_DRIVER)로 위임하고 파생 로직만 여기 유지한다.
 * ([[Firestore_Appwrite_이관_단계별_계획서]] Phase 3)
 *
 * ⚠ 개인 일정이지만 **전건을 읽어 와서 소유자로 거른다.** 조회 규모가 커지면
 * `ownerUserId` 로 좁히는 질의가 필요하고 그때 인덱스도 함께 걸어야 한다.
 * 지금은 다른 repo 와 같은 모양을 유지해 이관 난이도를 낮춘다.
 */
const backend = createCrudBackend<CalendarEvent>({
  coll: 'calendarEvents',
  parse: (raw) => {
    const decoded = decodeEventFromStorage(raw);
    const parsed = calendarEventSchema.safeParse(decoded);
    return parsed.success ? parsed.data : null;
  },
  idOf: (row) => row.id,
  seed: CALENDAR_EVENT_SEED.map(cloneEvent),
  stripFields: ['eventType', 'attendeeUserIds'],
});

const loadAll = (): Promise<CalendarEvent[]> => backend.loadAll();
const persist = (row: CalendarEvent): Promise<void> => backend.save(encodeEventForStorage(row));
const drop = (id: string): Promise<void> => backend.remove(id);

function requireActive(actor: CalendarEventActor): void {
  if (!actor.active) throw new CalendarEventError('FORBIDDEN', '사용 중인 계정만 일정을 변경할 수 있습니다.');
}

function requireOwned(rows: CalendarEvent[], actor: CalendarEventActor, id: string): CalendarEvent {
  const event = rows.find((row) => row.id === id);
  if (!event || event.ownerUserId !== actor.userId) {
    throw new CalendarEventError('NOT_FOUND', '일정을 찾을 수 없거나 접근 권한이 없습니다.');
  }
  return event;
}

function validateFilter(filter?: CalendarEventFilter): void {
  if (filter?.from && !isValidCalendarDate(filter.from)) {
    throw new CalendarEventError('INVALID_RANGE', '조회 시작일이 올바르지 않습니다.');
  }
  if (filter?.to && !isValidCalendarDate(filter.to)) {
    throw new CalendarEventError('INVALID_RANGE', '조회 종료일이 올바르지 않습니다.');
  }
  if (filter?.from && filter.to && filter.from > filter.to) {
    throw new CalendarEventError('INVALID_RANGE', '조회 종료일은 시작일보다 빠를 수 없습니다.');
  }
}

function nextId(rows: CalendarEvent[], date: string): string {
  const prefix = `CAL-${date.replaceAll('-', '')}-`;
  const max = rows
    .filter((row) => row.id.startsWith(prefix))
    .reduce((value, row) => Math.max(value, Number(row.id.slice(-4)) || 0), 0);
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

/**
 * 공유 대상에게 새 일정 알림을 보낸다.
 *
 * 결재(`approvalDoc.repo.ts`)와 같은 자리 — 저장이 끝난 뒤, 실패해도 저장 자체는
 * 그대로 두는 try/catch로 감싼다. 알림은 부가 효과지 일정 저장의 전제조건이 아니다.
 * 대상 조회에 필요한 user·department·project repo는 동적 import로 끌어와
 * calendarEvent.repo가 그 모듈들을 상시로 물지 않게 한다.
 *
 * 수정(update)은 대상으로 삼지 않는다 — "공유로 바뀐 것"과 "공유인 채 내용만 바뀐 것"을
 * 가르려면 이전 값과 비교해야 하는데, 지금은 생성 시점만으로 충분하다.
 */
async function notifyRecipients(actor: CalendarEventActor, event: CalendarEvent): Promise<void> {
  const { userRepo } = await import('@/data/user/user.repo');
  let recipientIds: string[] = [];

  // 참여자가 지정되어 있으면 참여자들에게도 알림
  if (event.attendeeUserIds && event.attendeeUserIds.length > 0) {
    recipientIds.push(...event.attendeeUserIds);
  }

  if (event.visibility === 'COMPANY' || event.eventType === 'COMPANY_EVENT') {
    recipientIds.push(...(await userRepo.list({ status: '사용' })).map((row) => row.id));
  } else if (event.visibility === 'TEAM' && event.deptId) {
    const { departmentRepo } = await import('@/data/department/department.repo');
    const dept = (await departmentRepo.list()).find((row) => row.id === event.deptId);
    if (dept) recipientIds.push(...(await userRepo.list({ dept: dept.name, status: '사용' })).map((row) => row.id));
  } else if (event.visibility === 'PROJECT' && event.projectId) {
    const { workProjectRepo } = await import('@/data/workProject/workProject.repo');
    const project = await workProjectRepo.get(
      { userId: actor.userId, deptId: actor.deptId ?? null, active: actor.active },
      event.projectId,
    );
    if (project) recipientIds.push(project.ownerUserId, ...project.memberUserIds);
  }

  const uniqueRecipients = [...new Set(recipientIds)].filter((id) => id !== event.ownerUserId);
  if (uniqueRecipients.length === 0) return;

  const owner = (await userRepo.list()).find((row) => row.id === event.ownerUserId);
  const { notificationRepo } = await import('@/data/notification/notification.repo');
  const when = event.allDay ? `${event.date} 종일` : `${event.date} ${event.startTime}`;

  const titlePrefix = event.eventType === 'COMPANY_EVENT' ? '사내행사 안내' : event.eventType === 'MEETING' ? '회의 참여 요청' : '새 일정 공유';

  await Promise.all(uniqueRecipients.map((userId) => notificationRepo.create({
    userId,
    type: '일정',
    title: titlePrefix,
    text: `[${event.title}] ${when}${scopeLabel(event)}`,
    senderName: owner?.name ?? '동료',
    linkUrl: `/gw/calendar?date=${event.date}`,
  })));
}

function scopeLabel(event: CalendarEvent): string {
  if (event.eventType === 'COMPANY_EVENT') return ' · 사내행사';
  if (event.eventType === 'MEETING') return ' · 회의 일정';
  if (event.visibility === 'TEAM') return ' · 부서 공유';
  if (event.visibility === 'PROJECT') return ' · 프로젝트 공유';
  if (event.visibility === 'COMPANY') return ' · 전사 공개';
  return '';
}

function sortEvents(rows: CalendarEvent[]): CalendarEvent[] {
  return rows.sort((a, b) => (
    a.date.localeCompare(b.date)
    || Number(b.allDay) - Number(a.allDay)
    || (a.startTime ?? '').localeCompare(b.startTime ?? '')
    || a.id.localeCompare(b.id)
  ));
}

export const calendarEventRepo = {
  /** 내 일정 + 나에게 공유된 일정. 공개 범위 판정은 도메인 `canViewEvent`가 맡는다. */
  async list(actor: CalendarEventActor, filter?: CalendarEventFilter): Promise<CalendarEvent[]> {
    validateFilter(filter);
    if (!actor.active) return [];
    const access = accessContextOf(actor);
    const rows = await loadAll();
    return sortEvents(rows
      .filter((event) => canViewEvent(access, event))
      .filter((event) => !filter?.from || event.date >= filter.from)
      .filter((event) => !filter?.to || event.date <= filter.to)
      .map(cloneEvent));
  },

  /**
   * 관리자 종합 조회 — 지정한 소유자들의 일정 전부(공개 범위 무관).
   *
   * **호출 전에 열람 범위 판정(`resolveCalendarSupervisor`)을 통과했어야 한다.** 여기는
   * 판정하지 않는다 — 판정에 필요한 부서·사용자 정보를 repo가 다시 모으면 화면과 이중
   * 조회가 되고, 이 저장소는 어차피 UI-게이트 모델이라(클라이언트가 컬렉션을 직접 읽음)
   * repo 검사가 보안 경계도 아니다. 남의 '나만 보기' 일정은 제목·메모를 가려서 돌려준다.
   *
   * `ownerUserIds`가 null이면 전 직원(all 범위), 배열이면 그 소유자들만(부서 범위).
   */
  async listTeam(
    viewer: { userId: string; active: boolean },
    ownerUserIds: string[] | null,
    filter?: CalendarEventFilter,
  ): Promise<CalendarEvent[]> {
    validateFilter(filter);
    if (!viewer.active) return [];
    const owners = ownerUserIds === null ? null : new Set(ownerUserIds);
    const rows = await loadAll();
    return sortEvents(rows
      .filter((event) => owners === null || owners.has(event.ownerUserId) || isCompanyEvent(event))
      .filter((event) => !filter?.from || event.date >= filter.from)
      .filter((event) => !filter?.to || event.date <= filter.to)
      .map((event) => maskEventForSupervisor(viewer.userId, cloneEvent(event))));
  },

  async get(actor: CalendarEventActor, id: string): Promise<CalendarEvent | null> {
    if (!actor.active) return null;
    const access = accessContextOf(actor);
    const rows = await loadAll();
    const event = rows.find((row) => row.id === id && canViewEvent(access, row));
    return event ? cloneEvent(event) : null;
  },

  create(actor: CalendarEventActor, draft: CalendarEventDraft): Promise<CalendarEvent> {
    return exclusiveMutation(async () => {
      requireActive(actor);
      const rows = await loadAll();
      const now = new Date().toISOString();
      const created = parseEvent({
        ...draft,
        id: nextId(rows, draft.date),
        ownerUserId: actor.userId,
        createdAt: now,
        updatedAt: now,
        reminded: false,
      });
      await persist(created);
      try {
        await notifyRecipients(actor, created);
      } catch (e) {
        console.error('일정 공유 알림 전송 실패:', e);
      }
      return cloneEvent(created);
    });
  },

  update(actor: CalendarEventActor, id: string, draft: CalendarEventDraft): Promise<CalendarEvent> {
    return exclusiveMutation(async () => {
      requireActive(actor);
      const rows = await loadAll();
      const current = requireOwned(rows, actor, id);
      /*
        시작 시각이 바뀌면 리마인더도 다시 대상이 돼야 한다. 3시 회의를 3시 50분에 이미
        리마인더 받은 뒤 5시로 옮기면, reminded=true가 그대로 남아 새 시각엔 영영 안 온다.
        날짜·시작 시각 중 하나라도 바뀌면 플래그를 되돌린다.
      */
      const timeChanged = draft.date !== current.date || draft.startTime !== current.startTime;
      const updated = parseEvent({
        ...current,
        ...draft,
        id: current.id,
        ownerUserId: current.ownerUserId,
        createdAt: current.createdAt,
        updatedAt: new Date().toISOString(),
        reminded: timeChanged ? false : current.reminded,
      });
      await persist(updated);
      return cloneEvent(updated);
    });
  },

  remove(actor: CalendarEventActor, id: string): Promise<CalendarEvent> {
    return exclusiveMutation(async () => {
      requireActive(actor);
      const rows = await loadAll();
      const current = requireOwned(rows, actor, id);
      await drop(id);
      return cloneEvent(current);
    });
  },
};
