import { createCrudBackend, type CrudBackend } from '@/data/_backend/crudBackend';
import {
  commutePolicySchema,
  DEFAULT_COMMUTE_POLICY,
  type CommutePolicy,
} from '@/domain/commutePolicy/schema';
import { nowLocalIso } from '@/shared/lib/datetime';

/** Appwrite commutePolicies 컬렉션에 속성이 없는 필드 — id 는 문서 $id 로 저장되고 읽을 때 복원된다. */
export const COMMUTE_POLICY_STRIP_FIELDS = ['id'];

const appBackend = createCrudBackend<CommutePolicy>({
  coll: 'commutePolicies',
  parse: (raw) => {
    const p = commutePolicySchema.safeParse(raw);
    return p.success ? p.data : null;
  },
  idOf: (item) => item.id,
  seed: [DEFAULT_COMMUTE_POLICY],
  stripFields: COMMUTE_POLICY_STRIP_FIELDS,
});

const LOCAL_STORAGE_KEY = 'workfit.commutePolicy';

function loadLocalPolicy(): CommutePolicy | null {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = commutePolicySchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function saveLocalPolicy(policy: CommutePolicy): void {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(policy));
  } catch {
    /* noop */
  }
}

/**
 * 근무시간 정책 저장소. DB가 단일 원천이고 localStorage 는 DB를 못 읽을 때의 마지막 폴백 캐시다.
 * 저장은 DB에 반영돼야 성공 — 실패를 삼키면 저장한 사람 브라우저에서만 바뀐 것처럼 보이고
 * 다른 사람·PWA는 옛 정책으로 판정하게 된다.
 */
export function createCommutePolicyRepo(backend: CrudBackend<CommutePolicy>) {
  return {
    async list(): Promise<CommutePolicy[]> {
      try {
        const list = await backend.loadAll();
        if (list.length > 0) return list;
      } catch (e) {
        // 컬렉션이 없거나 일시 오류인 경우 로컬 캐시 또는 기본 정책으로 폴백
        console.warn('commutePolicies backend load failed, fallback to local/default:', e);
      }
      const local = loadLocalPolicy();
      return [local || DEFAULT_COMMUTE_POLICY];
    },

    async getDefault(): Promise<CommutePolicy> {
      const list = await this.list();
      const found = list.find((p) => p.isDefault) || list[0];
      return found || DEFAULT_COMMUTE_POLICY;
    },

    async save(policy: CommutePolicy, actorName?: string): Promise<CommutePolicy> {
      const updated: CommutePolicy = commutePolicySchema.parse({
        ...policy,
        updatedAt: nowLocalIso(),
        updatedBy: actorName || '관리자',
      });
      await backend.save(updated);
      saveLocalPolicy(updated);
      return updated;
    },
  };
}

export const commutePolicyRepo = createCommutePolicyRepo(appBackend);
