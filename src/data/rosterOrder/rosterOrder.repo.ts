import { z } from 'zod';
import { createCrudBackend } from '@/data/_backend/crudBackend';

/**
 * 인원 정렬 순서 — 전사 공용 설정(rosterOrders). key 별로 사용자 ID 를 순서대로 담는다.
 * 지금은 'all'(전 직원 순서) 하나만 쓴다. 근태·업무계획 등 모든 인원 목록에 적용된다([[rosterOrder]]).
 */
export interface RosterOrderSetting {
  key: string;
  userIds: string[];
  updatedBy?: string | null;
  updatedAt?: string | null;
}

export const ROSTER_ORDER_KEY = 'all';

const schema = z.object({
  key: z.string().min(1),
  userIds: z.array(z.string()).nullish().transform((v) => v ?? []),
  updatedBy: z.string().nullish(),
  updatedAt: z.string().nullish(),
});

const backend = createCrudBackend<RosterOrderSetting>({
  coll: 'rosterOrders',
  parse: (raw) => {
    const p = schema.safeParse(raw);
    return p.success ? p.data : null;
  },
  idOf: (x) => x.key,
  seed: [],
});

export const rosterOrderRepo = {
  /** key 의 순서(사용자 ID 목록). 저장된 적 없으면 빈 배열 — 기본 정렬을 따른다. */
  async get(key: string): Promise<string[]> {
    const all = await backend.loadAll();
    return all.find((x) => x.key === key)?.userIds ?? [];
  },

  async save(key: string, userIds: string[], updatedBy?: string): Promise<void> {
    await backend.save({ key, userIds, updatedBy: updatedBy ?? null, updatedAt: new Date().toISOString() });
  },
};
