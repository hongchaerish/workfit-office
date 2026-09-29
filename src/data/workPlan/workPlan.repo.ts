import { createCrudBackend, Query } from '@/data/_backend/crudBackend';
import { isValidCalendarDate } from '@/domain/calendarEvent/calendarDate';
import { workPlanSchema, type WorkPlan, type WorkPlanDraft } from '@/domain/workPlan/schema';
import { workPlanPolicy } from '@/domain/security/policy/workPlanPolicy';
import type { SecurityContext } from '@/domain/security/types';

export interface WorkPlanActor {
  userId: string;
  active: boolean;
}

export interface WorkPlanFilter {
  from?: string;
  to?: string;
}

export class WorkPlanError extends Error {
  constructor(public readonly code: 'FORBIDDEN' | 'NOT_FOUND' | 'INVALID_RANGE' | 'INVALID_INPUT' | 'CONFLICT', message: string) {
    super(message);
    this.name = 'WorkPlanError';
  }
}

function parsePlan(input: unknown): WorkPlan {
  const parsed = workPlanSchema.safeParse(input);
  if (parsed.success) return parsed.data;
  const first = parsed.error.issues[0];
  throw new WorkPlanError('INVALID_INPUT', first?.message || '입력값을 확인하세요.');
}

let mutationQueue = Promise.resolve();
function exclusiveMutation<T>(work: () => Promise<T>): Promise<T> {
  const next = mutationQueue.then(work, work);
  mutationQueue = next.then(() => undefined, () => undefined);
  return next;
}

function clonePlan(plan: WorkPlan): WorkPlan {
  return { ...plan };
}

/** 문서 ID = `WorkPlan.id`(`WP-20260826-0001`). 저장은 공유 CrudBackend(VITE_DB_DRIVER)로 위임. */
const backend = createCrudBackend<WorkPlan>({
  coll: 'workPlans',
  parse: (raw) => {
    const parsed = workPlanSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  },
  idOf: (row) => row.id,
  seed: [],
});

const loadAll = (): Promise<WorkPlan[]> => backend.loadAll();
const persist = (row: WorkPlan): Promise<void> => backend.save(row);
const drop = (id: string): Promise<void> => backend.remove(id);

function requireActive(actor: WorkPlanActor): void {
  if (!actor.active) throw new WorkPlanError('FORBIDDEN', '사용 중인 계정만 업무계획을 변경할 수 있습니다.');
}

function findTargetPlan(rows: WorkPlan[], _actor: WorkPlanActor, id: string): WorkPlan {
  const plan = rows.find((row) => row.id === id);
  if (!plan) {
    throw new WorkPlanError('NOT_FOUND', '업무계획을 찾을 수 없습니다.');
  }
  return plan;
}

function validateFilter(filter?: WorkPlanFilter): void {
  if (filter?.from && !isValidCalendarDate(filter.from)) throw new WorkPlanError('INVALID_RANGE', '조회 시작일이 올바르지 않습니다.');
  if (filter?.to && !isValidCalendarDate(filter.to)) throw new WorkPlanError('INVALID_RANGE', '조회 종료일이 올바르지 않습니다.');
  if (filter?.from && filter?.to && filter.from > filter.to) throw new WorkPlanError('INVALID_RANGE', '조회 종료일은 시작일보다 빠를 수 없습니다.');
}

function nextId(rows: WorkPlan[], date: string): string {
  const prefix = `WP-${date.replaceAll('-', '')}-`;
  const max = rows.filter((row) => row.id.startsWith(prefix)).reduce((value, row) => Math.max(value, Number(row.id.slice(-4)) || 0), 0);
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

function sortPlans(rows: WorkPlan[]): WorkPlan[] {
  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

function byRange(rows: WorkPlan[], filter?: WorkPlanFilter): WorkPlan[] {
  return rows
    .filter((row) => !filter?.from || row.date >= filter.from)
    .filter((row) => !filter?.to || row.date <= filter.to);
}

export const workPlanRepo = {
  /** 내 업무계획만. */
  async list(actor: WorkPlanActor, filter?: WorkPlanFilter): Promise<WorkPlan[]> {
    validateFilter(filter);
    if (!actor.active) return [];
    const rows = await loadAll();
    return sortPlans(byRange(rows.filter((row) => row.ownerUserId === actor.userId), filter).map(clonePlan));
  },

  /**
   * 보안 컨텍스트의 DataScope를 백엔드 쿼리에 직접 주입하여 조회 (Server-Side Query Injection)
   */
  async listByScope(context: SecurityContext, filter?: WorkPlanFilter): Promise<WorkPlan[]> {
    validateFilter(filter);
    if (!context.user || context.user.status === '미사용') return [];

    const scope = workPlanPolicy.getScope(context);
    const queries: string[] = [];

    // 1. 날짜 범위 쿼리 주입
    if (filter?.from) queries.push(Query.greaterThanEqual('date', filter.from));
    if (filter?.to) queries.push(Query.lessThanEqual('date', filter.to));

    // 2. 스코프별 서버 쿼리 주입
    if (scope === 'MY_ONLY') {
      queries.push(Query.equal('ownerUserId', context.userId));
    }

    const rows = await backend.loadWithQueries(queries);
    return sortPlans(byRange(rows, filter).map(clonePlan));
  },

  /**
   * 전체 보기 — 공유 범위가 없어서 판정 없이 그대로 반환한다. 고치는 건 본인 것만
   * 가능하니(`update`/`remove`), 조회를 다 열어도 남의 것을 건드릴 길은 없다.
   */
  async listAll(filter?: WorkPlanFilter): Promise<WorkPlan[]> {
    validateFilter(filter);
    const rows = await loadAll();
    return sortPlans(byRange(rows, filter).map(clonePlan));
  },

  create(actor: WorkPlanActor, draft: WorkPlanDraft): Promise<WorkPlan> {
    return exclusiveMutation(async () => {
      requireActive(actor);
      const rows = await loadAll();
      const targetOwnerId = draft.ownerUserId || actor.userId;

      // 동시 신규 생성 시 중복 방어
      const existing = rows.find((r) => r.ownerUserId === targetOwnerId && r.date === draft.date);
      if (existing) {
        throw new WorkPlanError('CONFLICT', '다른 사용자가 방금 이 날짜의 계획을 먼저 등록했습니다.');
      }

      const now = new Date().toISOString();
      const created = parsePlan({ ...draft, id: nextId(rows, draft.date), ownerUserId: targetOwnerId, createdAt: now, updatedAt: now });
      await persist(created);
      return clonePlan(created);
    });
  },

  update(actor: WorkPlanActor, id: string, draft: WorkPlanDraft, expectedUpdatedAt?: string): Promise<WorkPlan> {
    return exclusiveMutation(async () => {
      requireActive(actor);
      const rows = await loadAll();
      const current = findTargetPlan(rows, actor, id);

      // 낙관적 동시성 제어: 편집 시작 시점의 타임스탬프와 DB 최신 타임스탬프 비교
      if (expectedUpdatedAt && current.updatedAt !== expectedUpdatedAt) {
        throw new WorkPlanError('CONFLICT', '다른 사용자가 방금 이 계획을 먼저 수정했습니다.');
      }

      const updated = parsePlan({ ...current, ...draft, id: current.id, ownerUserId: current.ownerUserId, createdAt: current.createdAt, updatedAt: new Date().toISOString() });
      await persist(updated);
      return clonePlan(updated);
    });
  },

  remove(actor: WorkPlanActor, id: string): Promise<WorkPlan> {
    return exclusiveMutation(async () => {
      requireActive(actor);
      const rows = await loadAll();
      const current = findTargetPlan(rows, actor, id);
      await drop(id);
      return clonePlan(current);
    });
  },
};
