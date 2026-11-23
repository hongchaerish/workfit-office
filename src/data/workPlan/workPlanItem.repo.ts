import { createCrudBackend, DocumentExistsError } from '@/data/_backend/crudBackend';
import { isValidCalendarDate } from '@/domain/calendarEvent/calendarDate';
import { workPlanItemSchema, type WorkPlanItem, type WorkPlanItemDraft } from '@/domain/workPlan/item';
import type { Routine } from '@/domain/workPlan/routine';

export interface WorkPlanItemActor {
  userId: string;
  active: boolean;
}

export class WorkPlanItemError extends Error {
  constructor(public readonly code: 'FORBIDDEN' | 'NOT_FOUND' | 'INVALID_INPUT' | 'INVALID_RANGE' | 'CONFLICT', message: string) {
    super(message);
    this.name = 'WorkPlanItemError';
  }
}

function parseItem(input: unknown): WorkPlanItem {
  const parsed = workPlanItemSchema.safeParse(input);
  if (parsed.success) return parsed.data;
  throw new WorkPlanItemError('INVALID_INPUT', parsed.error.issues[0]?.message || '입력값을 확인하세요.');
}

/*
  루틴은 저장소에 JSON 글로 둔다. 루틴이 없는 항목은 칸 자체를 보내지 않는다 — 운영 DB에 routine 칸이
  아직 없어도 보통 항목 저장은 그대로 된다(루틴 저장만 칸이 필요하다).
*/
function decodeRow(raw: unknown): WorkPlanItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = { ...(raw as Record<string, unknown>) };
  if (typeof obj.routine === 'string') {
    try {
      obj.routine = obj.routine ? JSON.parse(obj.routine) : null;
    } catch {
      obj.routine = null;
    }
  }
  const parsed = workPlanItemSchema.safeParse(obj);
  return parsed.success ? parsed.data : null;
}

function encodeRow(row: WorkPlanItem): WorkPlanItem {
  const { routine, ...rest } = row;
  return (routine ? { ...rest, routine: JSON.stringify(routine) } : rest) as WorkPlanItem;
}

/** 문서 ID = `WorkPlanItem.id`(`WI-20261021-0001`, 날짜는 항목 날짜). 기존 workPlans와 별개 컬렉션이다. */
const backend = createCrudBackend<WorkPlanItem>({
  coll: 'workPlanItems',
  parse: decodeRow,
  idOf: (row) => row.id,
  seed: [],
});

const MAX_ID_ATTEMPTS = 5;

/** 메모리 드라이버는 저장한 그대로(루틴 JSON 글) 돌려주므로 읽을 때 늘 푼다. 이미 풀린 행은 그대로다. */
const loadAll = async (): Promise<WorkPlanItem[]> =>
  (await backend.loadAll()).map((row) => decodeRow(row)).filter((row): row is WorkPlanItem => row !== null);

/** 같은 루틴에서 이 항목과 그 뒤 날짜 것(본인 것만) */
function followingOf(rows: WorkPlanItem[], current: WorkPlanItem): WorkPlanItem[] {
  const routineId = current.routine?.id;
  if (!routineId) return [current];
  return rows.filter((r) => r.routine?.id === routineId && r.ownerUserId === current.ownerUserId && r.date >= current.date);
}

function requireActive(actor: WorkPlanItemActor): void {
  if (!actor.active) throw new WorkPlanItemError('FORBIDDEN', '사용 중인 계정만 업무계획을 변경할 수 있습니다.');
}

/** 고치고 지우는 건 본인 항목만. */
function findOwned(rows: WorkPlanItem[], actor: WorkPlanItemActor, id: string): WorkPlanItem {
  const row = rows.find((r) => r.id === id);
  if (!row) throw new WorkPlanItemError('NOT_FOUND', '업무계획 항목을 찾을 수 없습니다.');
  if (row.ownerUserId !== actor.userId) throw new WorkPlanItemError('FORBIDDEN', '본인 업무계획만 고칠 수 있습니다.');
  return row;
}

function nextId(rows: WorkPlanItem[], date: string, offset: number): string {
  const prefix = `WI-${date.replaceAll('-', '')}-`;
  const max = rows.filter((r) => r.id.startsWith(prefix)).reduce((v, r) => Math.max(v, Number(r.id.slice(-4)) || 0), 0);
  return `${prefix}${String(max + 1 + offset).padStart(4, '0')}`;
}

const sortItems = (rows: WorkPlanItem[]) =>
  rows.sort((a, b) => a.date.localeCompare(b.date) || Number(b.allDay) - Number(a.allDay) || (a.startTime ?? '').localeCompare(b.startTime ?? '') || a.id.localeCompare(b.id));

export const workPlanItemRepo = {
  /** 전사 공개 — 날짜 범위 안 전원의 항목. */
  async listRange(filter: { from: string; to: string }): Promise<WorkPlanItem[]> {
    if (!isValidCalendarDate(filter.from) || !isValidCalendarDate(filter.to)) throw new WorkPlanItemError('INVALID_RANGE', '조회 기간이 올바르지 않습니다.');
    if (filter.from > filter.to) throw new WorkPlanItemError('INVALID_RANGE', '조회 종료일은 시작일보다 빠를 수 없습니다.');
    const rows = await loadAll();
    return sortItems(rows.filter((r) => r.date >= filter.from && r.date <= filter.to).map((r) => ({ ...r })));
  },

  /** 본인 칸에만 만든다. 남의 칸(회의 초대 등)은 이 함수가 아니라 일정 쪽이 맡는다. */
  async create(actor: WorkPlanItemActor, ownerUserId: string, draft: WorkPlanItemDraft): Promise<WorkPlanItem> {
    requireActive(actor);
    if (ownerUserId !== actor.userId) throw new WorkPlanItemError('FORBIDDEN', '본인 칸에만 계획을 만들 수 있습니다.');
    const rows = await loadAll();
    const now = new Date().toISOString();
    for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt += 1) {
      const row = parseItem({ ...draft, id: nextId(rows, draft.date, attempt), ownerUserId, createdBy: actor.userId, createdAt: now, updatedAt: now });
      try {
        await backend.insert(encodeRow(row));
        return { ...row };
      } catch (error) {
        if (!(error instanceof DocumentExistsError)) throw error;
      }
    }
    throw new WorkPlanItemError('CONFLICT', '항목 번호를 발급하지 못했습니다. 잠시 후 다시 시도하세요.');
  },

  async update(actor: WorkPlanItemActor, id: string, draft: WorkPlanItemDraft): Promise<WorkPlanItem> {
    requireActive(actor);
    const current = findOwned(await loadAll(), actor, id);
    const updated = parseItem({ ...current, ...draft, id: current.id, ownerUserId: current.ownerUserId, createdBy: current.createdBy, createdAt: current.createdAt, updatedAt: new Date().toISOString() });
    await backend.save(encodeRow(updated));
    return { ...updated };
  },

  /**
   * 루틴 만들기 — 날짜마다 항목 하나(같은 루틴 id). 하나라도 실패하면 이미 만든 것을 지우고 던진다.
   */
  async createRoutine(actor: WorkPlanItemActor, ownerUserId: string, drafts: WorkPlanItemDraft[], routine: Routine): Promise<WorkPlanItem[]> {
    requireActive(actor);
    if (ownerUserId !== actor.userId) throw new WorkPlanItemError('FORBIDDEN', '본인 칸에만 계획을 만들 수 있습니다.');
    const rows = await loadAll();
    const now = new Date().toISOString();
    const created: WorkPlanItem[] = [];
    try {
      for (const draft of drafts) {
        let done = false;
        for (let attempt = 0; attempt < MAX_ID_ATTEMPTS && !done; attempt += 1) {
          const row = parseItem({ ...draft, routine, id: nextId([...rows, ...created], draft.date, attempt), ownerUserId, createdBy: actor.userId, createdAt: now, updatedAt: now });
          try {
            await backend.insert(encodeRow(row));
            created.push(row);
            done = true;
          } catch (error) {
            if (!(error instanceof DocumentExistsError)) throw error;
          }
        }
        if (!done) throw new WorkPlanItemError('CONFLICT', '항목 번호를 발급하지 못했습니다. 잠시 후 다시 시도하세요.');
      }
    } catch (error) {
      await Promise.allSettled(created.map((row) => backend.remove(row.id)));
      throw error;
    }
    return created.map((row) => ({ ...row }));
  },

  /** 루틴 '이후 모두' 고치기 — 날짜는 그대로 두고 제목·태그·시간·메모만 바꾼다 */
  async updateFollowing(actor: WorkPlanItemActor, id: string, draft: WorkPlanItemDraft): Promise<WorkPlanItem[]> {
    requireActive(actor);
    const rows = await loadAll();
    const current = findOwned(rows, actor, id);
    const updatedAt = new Date().toISOString();
    const targets = followingOf(rows, current).map((row) =>
      parseItem({ ...row, ...draft, date: row.date, id: row.id, ownerUserId: row.ownerUserId, createdBy: row.createdBy, createdAt: row.createdAt, routine: row.routine, updatedAt }),
    );
    for (const row of targets) await backend.save(encodeRow(row));
    return targets.map((row) => ({ ...row }));
  },

  /** 루틴 '이후 모두' 지우기 */
  async removeFollowing(actor: WorkPlanItemActor, id: string): Promise<WorkPlanItem[]> {
    requireActive(actor);
    const rows = await loadAll();
    const current = findOwned(rows, actor, id);
    const targets = followingOf(rows, current);
    for (const row of targets) await backend.remove(row.id);
    return targets.map((row) => ({ ...row }));
  },

  async remove(actor: WorkPlanItemActor, id: string): Promise<WorkPlanItem> {
    requireActive(actor);
    const current = findOwned(await loadAll(), actor, id);
    await backend.remove(id);
    return { ...current };
  },
};
