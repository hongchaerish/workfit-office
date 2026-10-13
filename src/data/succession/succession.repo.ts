import { z } from 'zod';
import type { ApprovalSuccession } from '../seeds/succession.seed';
import { createCrudBackend } from '@/data/_backend/crudBackend';
import { createSharedListStore } from '@/data/_backend/sharedListStore';

/** 예전 브라우저 저장 키 — DB 이전([[migrateLegacySharedSettings]]) 때만 읽는다. */
export const LEGACY_SUCCESSION_STORAGE_KEY = 'workfit_approval_successions';
export const SUCCESSION_UPDATED_EVENT = 'workfit-approval-succession-updated';

const successionSchema = z.object({
  id: z.string().min(1),
  predecessorId: z.string().min(1),
  successorId: z.string().min(1),
  effectiveDate: z.string().nullish().transform((v) => v ?? ''),
});

export function parseSuccession(raw: unknown): ApprovalSuccession | null {
  const p = successionSchema.safeParse(raw);
  return p.success ? p.data : null;
}

export const successionBackend = createCrudBackend<ApprovalSuccession>({
  coll: 'approvalSuccessions',
  parse: parseSuccession,
  idOf: (x) => x.id,
  seed: [],
  stripFields: ['id'], // id 는 문서 $id 로 저장되고 읽을 때 복원된다
});

/**
 * 결재 권한 승계(전임자 → 후임자) — 전 임직원 공용. DB(approvalSuccessions)가 원천이고,
 * 결재 엔진이 동기로 조회하므로 메모리에 캐시한다([[sharedListStore]]).
 */
const store = createSharedListStore<ApprovalSuccession>({
  backend: successionBackend,
  idOf: (x) => x.id,
  event: SUCCESSION_UPDATED_EVENT,
});

export const successionRepo = {
  store,

  /** 전체 승계 설정 목록 */
  getAll(): ApprovalSuccession[] {
    return store.getAll();
  },

  /** 특정 후임자(successorId)의 모든 대를 거친 전임자 ID 목록 재귀 조회 (영구적 권한 이관 보장) */
  getPredecessorsOf(userId: string): string[] {
    const list = this.getAll();
    const predecessors: string[] = [];
    const visited = new Set<string>();

    const traverse = (currentId: string) => {
      if (visited.has(currentId)) return;
      visited.add(currentId);

      const directPreds = list.filter((s) => s.successorId === currentId).map((s) => s.predecessorId);
      directPreds.forEach((predId) => {
        predecessors.push(predId);
        traverse(predId);
      });
    };

    traverse(userId);
    return Array.from(new Set(predecessors));
  },

  /** 특정 전임자(predecessorId)의 최종 후임자 ID를 재귀적으로 추적 */
  getSuccessorOf(userId: string): string | null {
    const list = this.getAll();
    const visited = new Set<string>();

    let currentId = userId;
    let finalSuccessor: string | null = null;

    while (currentId) {
      if (visited.has(currentId)) break;
      visited.add(currentId);

      const item = list.find((s) => s.predecessorId === currentId);
      if (item) {
        finalSuccessor = item.successorId;
        currentId = item.successorId;
      } else {
        break;
      }
    }
    return finalSuccessor;
  },

  /** 신규 인수인계(승계) 매핑 추가 — 같은 전임자의 기존 매핑은 지운다(1대1 매핑 원칙). */
  async add(predecessorId: string, successorId: string): Promise<ApprovalSuccession> {
    for (const old of this.getAll().filter((s) => s.predecessorId === predecessorId)) {
      await store.remove(old.id);
    }
    const newItem: ApprovalSuccession = {
      id: `succ_${Date.now()}`,
      predecessorId,
      successorId,
      effectiveDate: new Date().toISOString(),
    };
    await store.save(newItem);
    return newItem;
  },

  /** 승계 매핑 관계 삭제 */
  async delete(id: string): Promise<void> {
    await store.remove(id);
  },
};
