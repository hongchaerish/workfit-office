import type { User } from '@/domain/user/schema';
import {
  resourceSchema,
  type Resource,
  type ResourceDraft,
  type ResourceStatus,
  type ResourceType,
} from '@/domain/resource/schema';
import { canManageResources, ReservationError } from '@/domain/reservation/engine';
import { RESOURCE_SEED } from '@/data/seeds/resource.seed';
import { createCrudBackend } from '@/data/_backend/crudBackend';

export interface ResourceFilter {
  typeCode?: ResourceType;
  status?: ResourceStatus;
  q?: string;
}

/**
 * 자원 마스터 컬렉션. 문서 ID = `Resource.id`(`RES-0001`).
 * 저장은 공유 CrudBackend(VITE_DB_DRIVER)로 위임하고 파생 로직만 여기 유지한다.
 * ([[Firestore_Appwrite_이관_단계별_계획서]] Phase 3)
 *
 * 문서별 안전 파싱이다. 스키마에 맞지 않는 문서 하나 때문에 목록 전체가
 * 예외로 죽지 않도록 실패한 문서만 건너뛴다.
 */
const backend = createCrudBackend<Resource>({
  coll: 'resources',
  parse: (raw) => {
    const parsed = resourceSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  },
  idOf: (row) => row.id,
  seed: RESOURCE_SEED.map((row) => resourceSchema.parse(row)),
});

const loadAll = (): Promise<Resource[]> => backend.loadAll();
const persist = (row: Resource): Promise<void> => backend.save(row);

const clone = (row: Resource): Resource => ({ ...row });

function nextId(rows: Resource[]): string {
  const max = rows.reduce((value, row) => Math.max(value, Number(row.id.replace(/\D/g, '')) || 0), 0);
  return `RES-${String(max + 1).padStart(4, '0')}`;
}

function applyFilter(rows: Resource[], filter?: ResourceFilter): Resource[] {
  if (!filter) return rows;
  const keyword = filter.q?.trim().toLowerCase() ?? '';
  return rows.filter((row) =>
    (!filter.typeCode || row.typeCode === filter.typeCode)
    && (!filter.status || row.status === filter.status)
    && (!keyword || [row.code, row.name, row.location].some((value) => value.toLowerCase().includes(keyword))),
  );
}

/**
 * 자원 Repository — 저장소 접근을 캡슐화하는 유일한 계층.
 * ([[DB_이관_대비_설계원칙.md]] 원칙 1 / [[data-layer-pattern]] 정본 패턴)
 * Firebase 미설정 시 in-memory seed 로 graceful degrade.
 */
export const resourceRepo = {
  async list(filter?: ResourceFilter): Promise<Resource[]> {
    const rows = await loadAll();
    return applyFilter(rows, filter).map(clone).sort((a, b) => a.code.localeCompare(b.code));
  },

  async get(id: string): Promise<Resource | null> {
    const rows = await loadAll();
    const found = rows.find((row) => row.id === id);
    return found ? clone(found) : null;
  },

  /** `canManage`: 관리자 또는 `S_GW_RESOURCE.update` 권한 — 호출부가 판정해 넘긴다. */
  async save(actor: User, draft: ResourceDraft, id?: string, canManage = false): Promise<Resource> {
    if (!canManageResources(actor, canManage)) {
      throw new ReservationError('FORBIDDEN', '관리자만 자원을 등록하거나 수정할 수 있습니다.');
    }
    // 코드 중복·채번·기존 문서 조회가 모두 같은 스냅샷을 봐야 하므로 한 번만 읽는다.
    const rows = await loadAll();
    const duplicate = rows.find(
      (row) => row.id !== id && row.code.toLowerCase() === draft.code.trim().toLowerCase(),
    );
    if (duplicate) throw new ReservationError('INVALID_INPUT', '이미 사용 중인 자원 코드입니다.');

    const now = new Date().toISOString();
    const existing = id ? rows.find((row) => row.id === id) : null;
    if (id && !existing) throw new ReservationError('INVALID_INPUT', '수정할 자원을 찾을 수 없습니다.');

    const valid = resourceSchema.parse({
      ...draft,
      id: existing?.id ?? nextId(rows),
      createdBy: existing?.createdBy ?? actor.id,
      createdAt: existing?.createdAt ?? now,
      updatedBy: actor.id,
      updatedAt: now,
    });
    await persist(valid);
    return clone(valid);
  },

  /**
   * 자원 삭제. 예정 예약(대기·확정)이 남아 있으면 막는다 — 지우면 그 예약은 자원을 찾지 못해
   * 승인·반려·취소가 모두 불가능한 고아가 된다. 지난 예약은 자원명 스냅샷이 있어 남아도 된다.
   */
  async delete(actor: User, id: string, canManage = false): Promise<void> {
    if (!canManageResources(actor, canManage)) {
      throw new ReservationError('FORBIDDEN', '관리자만 자원을 삭제할 수 있습니다.');
    }
    // reservation.repo 가 이 모듈을 import 하므로 순환을 피해 호출 시점에 불러온다.
    const { reservationRepo } = await import('@/data/reservation/reservation.repo');
    const upcoming = await reservationRepo.listUpcomingByResource(id);
    if (upcoming.length > 0) {
      throw new ReservationError(
        'INVALID_STATUS',
        `예정된 예약 ${upcoming.length}건이 있어 삭제할 수 없습니다. 자원을 '미사용'으로 바꾸거나 예약을 먼저 정리하세요.`,
      );
    }
    await backend.remove(id);
  },
};
