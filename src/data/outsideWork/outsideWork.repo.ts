import { createCrudBackend, DocumentExistsError } from '@/data/_backend/crudBackend';
import { isValidCalendarDate } from '@/domain/calendarEvent/calendarDate';
import { outsideWorkSchema, type OutsideWork, type OutsideWorkDraft } from '@/domain/outsideWork/schema';
import { overlapsRange } from '@/domain/outsideWork/view';

export interface OutsideWorkActor {
  userId: string;
  active: boolean;
}

export interface OutsideWorkFilter {
  from?: string;
  to?: string;
}

export class OutsideWorkError extends Error {
  constructor(public readonly code: 'FORBIDDEN' | 'NOT_FOUND' | 'INVALID_RANGE' | 'INVALID_INPUT' | 'CONFLICT', message: string) {
    super(message);
    this.name = 'OutsideWorkError';
  }
}

function parseWork(input: unknown): OutsideWork {
  const parsed = outsideWorkSchema.safeParse(input);
  if (parsed.success) return parsed.data;
  const first = parsed.error.issues[0];
  throw new OutsideWorkError('INVALID_INPUT', first?.message || '입력값을 확인하세요.');
}

/** 문서 ID = `OutsideWork.id`(`OW-20261020-0001`, 날짜는 시작일). 결재 문서와 별개 컬렉션이다. */
const backend = createCrudBackend<OutsideWork>({
  coll: 'outsideWorks',
  parse: (raw) => {
    const parsed = outsideWorkSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  },
  idOf: (row) => row.id,
  seed: [],
});

const MAX_ID_ATTEMPTS = 5;

function requireActive(actor: OutsideWorkActor): void {
  if (!actor.active) throw new OutsideWorkError('FORBIDDEN', '사용 중인 계정만 외근·출장을 등록할 수 있습니다.');
}

/** 고치고 지우는 건 등록한 본인만 — 근태에 반영되는 기록이라 남이 대신 바꾸지 못하게 한다. */
function findOwned(rows: OutsideWork[], actor: OutsideWorkActor, id: string): OutsideWork {
  const row = rows.find((r) => r.id === id);
  if (!row) throw new OutsideWorkError('NOT_FOUND', '외근·출장 기록을 찾을 수 없습니다.');
  if (row.ownerUserId !== actor.userId) throw new OutsideWorkError('FORBIDDEN', '본인이 등록한 외근·출장만 고칠 수 있습니다.');
  return row;
}

function validateFilter(filter?: OutsideWorkFilter): void {
  if (filter?.from && !isValidCalendarDate(filter.from)) throw new OutsideWorkError('INVALID_RANGE', '조회 시작일이 올바르지 않습니다.');
  if (filter?.to && !isValidCalendarDate(filter.to)) throw new OutsideWorkError('INVALID_RANGE', '조회 종료일이 올바르지 않습니다.');
  if (filter?.from && filter?.to && filter.from > filter.to) throw new OutsideWorkError('INVALID_RANGE', '조회 종료일은 시작일보다 빠를 수 없습니다.');
}

function nextId(rows: OutsideWork[], startDate: string, offset: number): string {
  const prefix = `OW-${startDate.replaceAll('-', '')}-`;
  const max = rows.filter((r) => r.id.startsWith(prefix)).reduce((v, r) => Math.max(v, Number(r.id.slice(-4)) || 0), 0);
  return `${prefix}${String(max + 1 + offset).padStart(4, '0')}`;
}

const sortWorks = (rows: OutsideWork[]) =>
  rows.sort((a, b) => a.startDate.localeCompare(b.startDate) || (a.startTime ?? '').localeCompare(b.startTime ?? '') || a.id.localeCompare(b.id));

export const outsideWorkRepo = {
  /** 전사 공개 — 기간이 범위와 겹치는 전원의 외근·출장. 범위가 없으면 전부. */
  async listAll(filter?: OutsideWorkFilter): Promise<OutsideWork[]> {
    validateFilter(filter);
    const rows = await backend.loadAll();
    const from = filter?.from ?? '0000-01-01';
    const to = filter?.to ?? '9999-12-31';
    return sortWorks(rows.filter((r) => overlapsRange(r, from, to)).map((r) => ({ ...r })));
  },

  async create(actor: OutsideWorkActor, draft: OutsideWorkDraft): Promise<OutsideWork> {
    requireActive(actor);
    const rows = await backend.loadAll();
    const now = new Date().toISOString();
    for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt += 1) {
      const row = parseWork({ ...draft, id: nextId(rows, draft.startDate, attempt), ownerUserId: actor.userId, createdAt: now, updatedAt: now });
      try {
        await backend.insert(row);
        return { ...row };
      } catch (error) {
        if (!(error instanceof DocumentExistsError)) throw error;
      }
    }
    throw new OutsideWorkError('CONFLICT', '등록 번호를 발급하지 못했습니다. 잠시 후 다시 시도하세요.');
  },

  async update(actor: OutsideWorkActor, id: string, draft: OutsideWorkDraft): Promise<OutsideWork> {
    requireActive(actor);
    const current = findOwned(await backend.loadAll(), actor, id);
    const updated = parseWork({ ...current, ...draft, id: current.id, ownerUserId: current.ownerUserId, createdAt: current.createdAt, updatedAt: new Date().toISOString() });
    await backend.save(updated);
    return { ...updated };
  },

  async remove(actor: OutsideWorkActor, id: string): Promise<OutsideWork> {
    requireActive(actor);
    const current = findOwned(await backend.loadAll(), actor, id);
    await backend.remove(id);
    return { ...current };
  },
};
