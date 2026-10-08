import type { User } from '@/domain/user/schema';
import type { Resource } from '@/domain/resource/schema';
import {
  reservationSchema,
  type Reservation,
  type ReservationRequest,
  type ReservationStatus,
} from '@/domain/reservation/schema';
import {
  assertCancellationAllowed,
  assertNoConflict,
  assertRescheduleAllowed,
  assertReservationTransition,
  canApproveResource,
  deriveLifecycle,
  planReschedule,
  ReservationError,
  validateReservationRequest,
  type RescheduleInput,
} from '@/domain/reservation/engine';
import { RESERVATION_SEED } from '@/data/seeds/reservation.seed';
import { resourceRepo } from '@/data/resource/resource.repo';
import { createCrudBackend, DocumentExistsError } from '@/data/_backend/crudBackend';

export interface ReservationFilter {
  resourceId?: string;
  requesterUserId?: string;
  status?: ReservationStatus;
  from?: string;
  to?: string;
}

let mutationQueue: Promise<unknown> = Promise.resolve();

const clone = (row: Reservation): Reservation => ({ ...row, attendeeUserIds: [...row.attendeeUserIds] });

function exclusive<T>(work: () => Promise<T>): Promise<T> {
  const result = mutationQueue.then(work, work);
  mutationQueue = result.then(() => undefined, () => undefined);
  return result;
}

/**
 * 예약 컬렉션. 문서 ID = `Reservation.id`(`RSV-20260813-0001`).
 * 저장은 공유 CrudBackend(VITE_DB_DRIVER)로 위임하고 파생 로직만 여기 유지한다.
 * ([[Firestore_Appwrite_이관_단계별_계획서]] Phase 3)
 */
const backend = createCrudBackend<Reservation>({
  coll: 'resourceReservations',
  parse: (raw) => {
    const parsed = reservationSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  },
  idOf: (row) => row.id,
  seed: RESERVATION_SEED.map((row) => reservationSchema.parse(row)),
});

/**
 * 전체 예약 로드.
 *
 * 시간 경과에 따른 `COMPLETED`·`EXPIRED` 전이는 **저장하지 않고 읽을 때마다 파생**한다.
 * 상태를 되쓰면 조회만 해도 문서가 갱신돼 운영에서 불필요한 쓰기가 생긴다.
 */
async function loadAll(now = new Date()): Promise<Reservation[]> {
  const rows = await backend.loadAll();
  return rows.map((row) => deriveLifecycle(row, now));
}

/** 순번 채번이 다른 사용자와 겹칠 때 다시 시도하는 횟수. */
const MAX_ID_ATTEMPTS = 5;

/** 한 건 저장(신규·수정 공통). 문서 ID 를 키로 덮어쓴다. */
const persist = (row: Reservation): Promise<void> => backend.save(row);

/** 사람이 읽는 순번 ID. `offset` 은 채번 충돌 후 재시도할 때 건너뛸 칸 수. */
function nextId(rows: Reservation[], now: Date, offset = 0): string {
  const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const max = rows.reduce((value, row) => Math.max(value, Number(row.id.match(/(\d{4})$/)?.[1]) || 0), 0);
  return `RSV-${date}-${String(max + 1 + offset).padStart(4, '0')}`;
}

/**
 * 신규 예약 저장. 덮어쓰기 없는 `insert` 로 넣고, 다른 사용자가 같은 순번을 먼저 가져갔으면
 * 다음 순번으로 다시 시도한다. (`save` 는 update 우선이라 남의 예약을 조용히 덮었다.)
 */
async function insertWithNextId(rows: Reservation[], now: Date, build: (id: string) => Reservation): Promise<Reservation> {
  for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt += 1) {
    const row = build(nextId(rows, now, attempt));
    try {
      await backend.insert(row);
      return row;
    } catch (error) {
      if (!(error instanceof DocumentExistsError)) throw error;
    }
  }
  throw new ReservationError('CONFLICT', '예약 번호를 발급하지 못했습니다. 잠시 후 다시 시도하세요.');
}

function applyFilter(rows: Reservation[], filter?: ReservationFilter): Reservation[] {
  if (!filter) return rows;
  return rows.filter((row) =>
    (!filter.resourceId || row.resourceId === filter.resourceId)
    && (!filter.requesterUserId || row.requesterUserId === filter.requesterUserId)
    && (!filter.status || row.status === filter.status)
    && (!filter.from || row.endAt > filter.from)
    && (!filter.to || row.startAt < filter.to),
  );
}

function assertActiveActor(actor: User): void {
  if (actor.status !== '사용') throw new ReservationError('FORBIDDEN', '사용 중인 계정만 예약할 수 있습니다.');
}

async function requireResource(resourceId: string): Promise<Resource> {
  const resource = await resourceRepo.get(resourceId);
  if (!resource) throw new ReservationError('INVALID_INPUT', '자원을 찾을 수 없습니다.');
  return resource;
}

/** 조회해 둔 행에 변경을 적용하고 저장한다. 호출부가 이미 행을 갖고 있어 다시 읽지 않는다. */
async function applyUpdate(current: Reservation, updater: (row: Reservation) => Reservation): Promise<Reservation> {
  const updated = reservationSchema.parse(updater(current));
  await persist(updated);
  return clone(updated);
}

/**
 * 예약 Repository — 저장소 접근을 캡슐화하는 유일한 계층.
 * ([[DB_이관_대비_설계원칙.md]] 원칙 1 / [[data-layer-pattern]] 정본 패턴)
 * Firebase 미설정 시 in-memory seed 로 graceful degrade.
 *
 * ⚠ `exclusive` 는 **한 브라우저 세션 안에서만** mutation 을 직렬화한다. Firestore 를
 * 쓰더라도 다른 사용자가 같은 슬롯을 동시에 잡는 것은 막지 못한다. 읽고-검증하고-쓰는
 * 사이에 틈이 있기 때문이다. 실제 다중 사용자 동시성은 Firestore transaction 또는
 * Cloud Function 이관 전까지 보장하지 않는다.
 */
export const reservationRepo = {
  async list(filter?: ReservationFilter): Promise<Reservation[]> {
    const rows = await loadAll();
    return applyFilter(rows, filter).map(clone).sort((a, b) => b.startAt.localeCompare(a.startAt));
  },

  async get(id: string): Promise<Reservation | null> {
    const rows = await loadAll();
    const found = rows.find((row) => row.id === id);
    return found ? clone(found) : null;
  },

  create(actor: User, request: ReservationRequest): Promise<Reservation> {
    return exclusive(async () => {
      assertActiveActor(actor);
      const rows = await loadAll();
      const resource = await requireResource(request.resourceId);
      const input = validateReservationRequest(resource, request, rows);
      const now = new Date();
      const status: ReservationStatus = resource.approvalMode === 'INSTANT' ? 'CONFIRMED' : 'PENDING';
      const valid = await insertWithNextId(rows, now, (id) => reservationSchema.parse({
        id,
        resourceId: resource.id,
        resourceCodeSnapshot: resource.code,
        resourceNameSnapshot: resource.name,
        requesterUserId: actor.id,
        requesterDeptId: input.requesterDeptId,
        title: input.title,
        purpose: input.purpose,
        startAt: input.startAt,
        endAt: input.endAt,
        quantity: input.quantity,
        attendeeCount: input.attendeeCount,
        attendeeUserIds: input.attendeeUserIds,
        status,
        approvalModeSnapshot: resource.approvalMode,
        approverUserId: resource.approvalMode === 'APPROVAL' ? resource.managerUserId : null,
        approvedAt: status === 'CONFIRMED' ? now.toISOString() : null,
        rejectedAt: null,
        rejectionReason: null,
        cancelledAt: null,
        cancelReason: null,
        version: 1,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      }));
      return clone(valid);
    });
  },

  approve(actor: User, id: string, isAdmin = false): Promise<Reservation> {
    return exclusive(async () => {
      assertActiveActor(actor);
      const rows = await loadAll();
      const row = rows.find((item) => item.id === id);
      if (!row) throw new ReservationError('INVALID_INPUT', '예약을 찾을 수 없습니다.');
      const resource = await requireResource(row.resourceId);
      if (!canApproveResource(actor, resource, isAdmin)) throw new ReservationError('FORBIDDEN', '이 자원의 승인 권한이 없습니다.');
      if (resource.status !== 'ACTIVE') throw new ReservationError('RESOURCE_UNAVAILABLE', '사용 중인 자원만 승인할 수 있습니다.');
      if (new Date(row.startAt).getTime() <= Date.now()) throw new ReservationError('PAST_TIME', '시작 시간이 지난 예약은 승인할 수 없습니다.');
      // 신청 규칙(슬롯·이용시간·운영시간·인원)은 신청 때 이미 통과했다. 그 뒤 자원 설정이
      // 바뀌어도 대기 예약을 확정할 수 있도록 승인에서는 점유 충돌만 다시 본다.
      assertReservationTransition(row.status, 'CONFIRMED');
      assertNoConflict(resource, row, rows.filter((item) => item.id !== row.id));
      const now = new Date().toISOString();
      return applyUpdate(row, (current) => ({
        ...current, status: 'CONFIRMED', approverUserId: actor.id, approvedAt: now,
        version: current.version + 1, updatedAt: now,
      }));
    });
  },

  reject(actor: User, id: string, reason: string, isAdmin = false): Promise<Reservation> {
    return exclusive(async () => {
      assertActiveActor(actor);
      const rows = await loadAll();
      const trimmed = reason.trim();
      if (!trimmed) throw new ReservationError('INVALID_INPUT', '반려 사유를 입력하세요.');
      const row = rows.find((item) => item.id === id);
      if (!row) throw new ReservationError('INVALID_INPUT', '예약을 찾을 수 없습니다.');
      const resource = await requireResource(row.resourceId);
      if (!canApproveResource(actor, resource, isAdmin)) throw new ReservationError('FORBIDDEN', '이 자원의 승인 권한이 없습니다.');
      if (new Date(row.startAt).getTime() <= Date.now()) throw new ReservationError('PAST_TIME', '시작 시간이 지난 예약은 반려할 수 없습니다.');
      assertReservationTransition(row.status, 'REJECTED');
      const now = new Date().toISOString();
      return applyUpdate(row, (current) => ({
        ...current, status: 'REJECTED', approverUserId: actor.id, rejectedAt: now,
        rejectionReason: trimmed, version: current.version + 1, updatedAt: now,
      }));
    });
  },

  cancel(actor: User, id: string, reason: string, isAdmin = false): Promise<Reservation> {
    return exclusive(async () => {
      assertActiveActor(actor);
      const rows = await loadAll();
      const trimmed = reason.trim();
      if (!trimmed) throw new ReservationError('INVALID_INPUT', '취소 사유를 입력하세요.');
      const row = rows.find((item) => item.id === id);
      if (!row) throw new ReservationError('INVALID_INPUT', '예약을 찾을 수 없습니다.');
      const resource = await requireResource(row.resourceId);
      assertCancellationAllowed(actor, resource, row, new Date(), isAdmin);
      assertReservationTransition(row.status, 'CANCELLED');
      const now = new Date().toISOString();
      return applyUpdate(row, (current) => ({
        ...current, status: 'CANCELLED', cancelledAt: now, cancelReason: trimmed,
        version: current.version + 1, updatedAt: now,
      }));
    });
  },

  /**
   * 예약 시간 변경. 신청 규칙을 현재 자원 설정으로 다시 검사하고(자기 자신은 충돌 대상에서 제외),
   * 승인형 자원이면 재승인을 받는다 — 단, 확정 예약을 기존 시간 범위 안으로 줄이면 승인을 유지한다.
   */
  reschedule(actor: User, id: string, next: RescheduleInput, isAdmin = false): Promise<Reservation> {
    return exclusive(async () => {
      assertActiveActor(actor);
      const rows = await loadAll();
      const row = rows.find((item) => item.id === id);
      if (!row) throw new ReservationError('INVALID_INPUT', '예약을 찾을 수 없습니다.');
      const resource = await requireResource(row.resourceId);
      const now = new Date();
      assertRescheduleAllowed(actor, resource, row, now, isAdmin);
      if (row.startAt === next.startAt && row.endAt === next.endAt) {
        throw new ReservationError('INVALID_INPUT', '변경된 시간이 없습니다.');
      }
      validateReservationRequest(resource, {
        resourceId: row.resourceId,
        requesterDeptId: row.requesterDeptId,
        title: row.title,
        purpose: row.purpose,
        startAt: next.startAt,
        endAt: next.endAt,
        quantity: row.quantity,
        attendeeCount: row.attendeeCount,
        attendeeUserIds: row.attendeeUserIds,
      }, rows.filter((item) => item.id !== row.id), now);
      const plan = planReschedule(resource, row, next);
      if (plan.status !== row.status) assertReservationTransition(row.status, plan.status);
      const stamp = now.toISOString();
      return applyUpdate(row, (current) => ({
        ...current,
        startAt: next.startAt,
        endAt: next.endAt,
        status: plan.status,
        approvalModeSnapshot: resource.approvalMode,
        approverUserId: plan.keepsApproval
          ? current.approverUserId
          : resource.approvalMode === 'APPROVAL' ? resource.managerUserId : null,
        approvedAt: plan.keepsApproval ? current.approvedAt : plan.status === 'CONFIRMED' ? stamp : null,
        version: current.version + 1,
        updatedAt: stamp,
      }));
    });
  },

  /** 아직 시작하지 않은 점유 예약(대기·확정). 자원 점검 전환·삭제 전 영향 확인용. */
  async listUpcomingByResource(resourceId: string, now = new Date()): Promise<Reservation[]> {
    const rows = await loadAll(now);
    return rows
      .filter((row) => row.resourceId === resourceId
        && (row.status === 'PENDING' || row.status === 'CONFIRMED')
        && new Date(row.startAt).getTime() > now.getTime())
      .map(clone)
      .sort((a, b) => a.startAt.localeCompare(b.startAt));
  },

  /**
   * 자원의 예정 예약을 한꺼번에 취소한다(관리자 전용 — 자원 점검·미사용 전환 시).
   * 이미 시작한 예약은 건드리지 않는다. 취소한 건수를 돌려준다.
   */
  cancelUpcomingByResource(actor: User, resourceId: string, reason: string, canManage = false): Promise<number> {
    return exclusive(async () => {
      assertActiveActor(actor);
      if (!canManage) throw new ReservationError('FORBIDDEN', '관리자만 예약을 일괄 취소할 수 있습니다.');
      const trimmed = reason.trim();
      if (!trimmed) throw new ReservationError('INVALID_INPUT', '취소 사유를 입력하세요.');
      const now = new Date();
      const targets = (await loadAll(now)).filter((row) => row.resourceId === resourceId
        && (row.status === 'PENDING' || row.status === 'CONFIRMED')
        && new Date(row.startAt).getTime() > now.getTime());
      const stamp = now.toISOString();
      for (const row of targets) {
        await applyUpdate(row, (current) => ({
          ...current, status: 'CANCELLED', cancelledAt: stamp, cancelReason: trimmed,
          version: current.version + 1, updatedAt: stamp,
        }));
      }
      return targets.length;
    });
  },
};
