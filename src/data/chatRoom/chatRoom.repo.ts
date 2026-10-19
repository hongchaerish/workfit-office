import { collection, doc, getDocs, setDoc } from 'firebase/firestore';
import { db } from '@/shared/lib/firebase';
import { databases, APPWRITE_DATABASE_ID, Query, assertAppwriteId } from '@/shared/lib/appwrite';
import { dbDriver } from '@/shared/lib/dbDriver';
import { nowLocalIso } from '@/shared/lib/datetime';
import { chatRoomSchema, type ChatRoom, type ChatRoomType, type LastMessage } from '@/domain/chatRoom/schema';
import { CHAT_ROOM_SEED } from '@/data/seeds/chatRoom.seed';
import { departmentRepo } from '@/data/department/department.repo';
import { userRepo } from '@/data/user/user.repo';
import { deptIdOfRoom, planDeptRoomSync } from '@/domain/chatRoom/deptRoom';
import { appendSystemMessage } from '@/data/chatMessage/systemMessage';

/**
 * 채팅방 Repository — DB 접근을 캡슐화하는 유일한 계층.
 * ([[DB_이관_대비_설계원칙.md]] 원칙 1 / [[Firestore_Appwrite_이관_단계별_계획서]] Phase 1 PoC)
 *
 * 저장 백엔드(Firestore / Appwrite / in-memory)는 `VITE_DB_DRIVER` 로 결정되며,
 * 아래 ChatRoomBackend 어댑터 뒤에 격리된다. 파생 로직(부서방 개설·이름 따라가기·1:1 중복 방지·
 * 채번·멤버 관리·정렬)은 백엔드와 무관하게 공개 메서드에 그대로 남는다.
 */
const COLL = 'chatRooms';

/** 신규 방 색상 팔레트(생성 순서대로 순환). 시드 색과 톤 일치. */
const ROOM_COLORS = ['#e6960c', '#3a6ee0', '#17a89a', '#e0483b', '#8b5cf6', '#1f2f55', '#d9488b', '#0ea5a0'];

/** 저장소 무관 안전 파싱 — 불량 문서 하나가 전체 조회를 깨지 않도록 실패분만 건너뛴다. */
function safeParseRoom(raw: Record<string, unknown>): ChatRoom | null {
  const p = chatRoomSchema.safeParse(raw);
  return p.success ? p.data : null;
}

// ─────────────────────────────────────────────────────────────
// 백엔드 어댑터 인터페이스 — 저장소 원시 연산만(파생 로직 제외)
// ─────────────────────────────────────────────────────────────
interface ChatRoomBackend {
  loadAll(): Promise<ChatRoom[]>;
  /** id 기준 upsert(생성/갱신 공용). */
  save(room: ChatRoom): Promise<void>;
}

// 1) In-memory (미설정 폴백)
class MemoryBackend implements ChatRoomBackend {
  private rows: ChatRoom[] = CHAT_ROOM_SEED.map((r) => chatRoomSchema.parse(r));
  async loadAll() {
    return this.rows;
  }
  async save(room: ChatRoom) {
    const i = this.rows.findIndex((x) => x.id === room.id);
    if (i >= 0) this.rows[i] = room;
    else this.rows = [...this.rows, room];
  }
}

// 2) Firestore (현행)
class FirestoreBackend implements ChatRoomBackend {
  async loadAll() {
    const snap = await getDocs(collection(db!, COLL));
    const out: ChatRoom[] = [];
    for (const d of snap.docs) {
      const m = safeParseRoom(d.data());
      if (m) out.push(m);
    }
    return out;
  }
  async save(room: ChatRoom) {
    await setDoc(doc(db!, COLL, room.id), room);
  }
}

// 3) Appwrite (이관 목표) — 중첩 lastMessage 는 JSON 문자열, $id = 방 id
type AppwriteRow = Record<string, unknown> & { $id: string };

class AppwriteBackend implements ChatRoomBackend {
  private get dbs() {
    return databases!;
  }
  private toAttrs(r: ChatRoom): Record<string, unknown> {
    return {
      id: r.id, // chatRooms 스키마에 id 속성(required) 존재 → $id와 동일값 저장
      name: r.name,
      type: r.type,
      members: r.members,
      color: r.color,
      createdAt: r.createdAt,
      createdBy: r.createdBy,
      deletedAt: r.deletedAt,
      deletedBy: r.deletedBy,
      lastMessage: r.lastMessage ? JSON.stringify(r.lastMessage) : null,
    };
  }
  private fromRow(row: AppwriteRow): ChatRoom | null {
    const parseJson = (v: unknown) => (typeof v === 'string' && v ? JSON.parse(v) : null);
    return safeParseRoom({
      id: row.$id,
      name: row.name,
      type: row.type,
      members: row.members,
      color: row.color,
      createdAt: row.createdAt,
      createdBy: row.createdBy,
      deletedAt: row.deletedAt,
      deletedBy: row.deletedBy,
      lastMessage: parseJson(row.lastMessage),
    });
  }
  async loadAll() {
    const out: ChatRoom[] = [];
    const PAGE = 100;
    for (let offset = 0; ; offset += PAGE) {
      const res = await this.dbs.listDocuments(APPWRITE_DATABASE_ID, COLL, [
        Query.limit(PAGE),
        Query.offset(offset),
      ]);
      for (const row of res.documents as unknown as AppwriteRow[]) {
        const m = this.fromRow(row);
        if (m) out.push(m);
      }
      if (res.documents.length < PAGE) break;
    }
    return out;
  }
  async save(room: ChatRoom) {
    const id = assertAppwriteId(room.id);
    const attrs = this.toAttrs(room);
    try {
      await this.dbs.updateDocument(APPWRITE_DATABASE_ID, COLL, id, attrs);
    } catch (e) {
      if ((e as { code?: number })?.code === 404) {
        await this.dbs.createDocument(APPWRITE_DATABASE_ID, COLL, id, attrs);
      } else {
        throw e;
      }
    }
  }
}

function selectBackend(): ChatRoomBackend {
  switch (dbDriver) {
    case 'appwrite':
      return new AppwriteBackend();
    case 'firestore':
      return new FirestoreBackend();
    default:
      return new MemoryBackend();
  }
}
const backend: ChatRoomBackend = selectBackend();

/** 참여자 집합이 같은지(순서 무관) — 1:1 방 중복 판정용. */
function sameMembers(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

/** 최신 메시지가 위로 오도록 lastMessage.at 내림차순 정렬. */
function sortByRecent(rows: ChatRoom[]): ChatRoom[] {
  return [...rows].sort((a, b) => (b.lastMessage?.at ?? '').localeCompare(a.lastMessage?.at ?? ''));
}

/** 신규 방 채번 'RM-000X' — 기존 최대 번호 + 1. (user.repo nextId 패턴)
 *  ⚠ 데모 한정: 동시 생성 시 충돌 가능(counters 미사용). 시연 규모에선 무영향. */
function nextId(rows: ChatRoom[]): string {
  const max = rows.reduce((m, r) => {
    const n = Number(r.id.replace(/\D/g, ''));
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);
  return `RM-${String(max + 1).padStart(4, '0')}`;
}

/** 신규 방 생성 입력(시스템 필드 제외). */
export interface CreateRoomInput {
  name: string;
  type: ChatRoomType;
  /** "나"를 포함한 전체 참여자 users.id. */
  members: string[];
  createdBy?: string;
}

// 부서방 동기화 마지막 실행 시각 (최소 60초 간격으로 쓰기 제한하여 429 Rate Limit 원천 방지)
let lastDeptSyncAt = 0;
const DEPT_SYNC_THROTTLE_MS = 60 * 1000;

export const chatRoomRepo = {
  /**
   * 방 목록. memberId 지정 시 그 사용자가 참여한 방만.
   * 기본은 소프트삭제된 방 제외. includeDeleted=true 는 어드민 감사 조회용(삭제방 포함).
   */
  async list(memberId?: string, opts?: { includeDeleted?: boolean }): Promise<ChatRoom[]> {
    let rows = await backend.loadAll();

    // 부서방: 방 없는 부서에 한 번 개설 + 부서명 변경 시 이름 따라가기만 (참여자는 직접 관리, 60초 쓰로틀)
    const now = Date.now();
    if (now - lastDeptSyncAt > DEPT_SYNC_THROTTLE_MS) {
      lastDeptSyncAt = now;
      try {
        const depts = await departmentRepo.list();
        const users = await userRepo.listIncludingTestAccounts();
        const plan = planDeptRoomSync({
          depts,
          users,
          rooms: rows,
          now: nowLocalIso(),
          pickColor: (id) => ROOM_COLORS[Math.abs(id.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)) % ROOM_COLORS.length],
        });
        for (const room of plan.create) {
          await backend.save(room);
          rows.push(room);
        }
        for (const { roomId, name } of plan.rename) {
          const idx = rows.findIndex((r) => r.id === roomId);
          const updated = { ...rows[idx], name };
          await backend.save(updated);
          rows[idx] = updated;
          await appendSystemMessage(roomId, `부서명 변경으로 방 이름이 ${name}으로 바뀌었습니다`);
        }
      } catch (e) {
        // Appwrite 일시적 지연이나 한도 초과 시에도 조회 목록 표시 자체는 정상 유지
        console.warn('Background dept room sync skipped:', (e as Error)?.message || e);
      }
    }

    if (!opts?.includeDeleted) rows = rows.filter((r) => !r.deletedAt);
    const scoped = memberId ? rows.filter((r) => r.members.includes(memberId)) : rows;
    return sortByRecent(scoped);
  },

  async get(id: string): Promise<ChatRoom | null> {
    // 삭제방도 조회 가능해야 함(삭제 직후 시스템 메시지 append 등) → includeDeleted.
    const rows = await this.list(undefined, { includeDeleted: true });
    return rows.find((r) => r.id === id) ?? null;
  },

  /** 등록/수정(upsert). 문서 ID = 방 ID. 신규 방 생성·시드 적재 공용. */
  async save(room: ChatRoom): Promise<void> {
    const valid = chatRoomSchema.parse(room);
    await backend.save(valid);
  },

  /** 신규 방 생성. 1:1(direct)은 동일 참여자 조합이 이미 있으면 그 방을 재사용(중복 방지). */
  async create(input: CreateRoomInput): Promise<ChatRoom> {
    const all = await this.list(undefined, { includeDeleted: true });
    if (input.type === 'direct' && input.members.length === 2) {
      // 재사용은 살아있는 방만.
      const existing = all.find((r) => !r.deletedAt && r.type === 'direct' && sameMembers(r.members, input.members));
      if (existing) return existing;
    }

    const roomId =
      input.type === 'direct' && input.members.length === 2
        ? `RM-DIR-${[...input.members].sort().join('-')}`
        : nextId(all);

    const room = chatRoomSchema.parse({
      id: roomId,
      name: input.name,
      type: input.type,
      members: input.members,
      color: ROOM_COLORS[all.length % ROOM_COLORS.length],
      lastMessage: null,
      createdAt: nowLocalIso(),
      createdBy: input.createdBy || input.members[0] || '',
    });
    await this.save(room);
    return room;
  },

  /** 방 이름 변경 — 생성자 전용. */
  async updateName(id: string, name: string): Promise<void> {
    const room = await this.get(id);
    if (!room) throw new Error(`채팅방을 찾을 수 없습니다: ${id}`);
    await this.save({ ...room, name });
  },

  /** 그룹초대 — 기존 방 members 에 userIds 추가(중복 제거). */
  async addMembers(id: string, userIds: string[]): Promise<void> {
    const room = await this.get(id);
    if (!room) throw new Error(`채팅방을 찾을 수 없습니다: ${id}`);
    const merged = Array.from(new Set([...room.members, ...userIds]));
    await this.save({ ...room, members: merged });
  },

  /** 방 나가기(탈퇴) — members 에서 userId 제거. 대화 내용은 보존. */
  async leave(id: string, userId: string): Promise<void> {
    const room = await this.get(id);
    if (!room) throw new Error(`채팅방을 찾을 수 없습니다: ${id}`);
    await this.save({ ...room, members: room.members.filter((m) => m !== userId) });
  },

  /**
   * 방 소프트 삭제(아카이브) — 관리자 전용. deletedAt/deletedBy 만 세팅하고
   * 문서·chatMessages 는 그대로 보존한다(어드민 감사/조회용). 목록에서만 숨김.
   */
  async softDelete(id: string, adminId: string): Promise<void> {
    const room = await this.get(id);
    if (!room) throw new Error(`채팅방을 찾을 수 없습니다: ${id}`);
    await this.save({ ...room, deletedAt: nowLocalIso(), deletedBy: adminId });
  },

  /** 퇴직 — 살아있는 부서방에서 그 사람을 뺀다. 뺀 방 ID 목록을 돌려준다(시스템 메시지는 호출자 몫). */
  async removeMemberFromDeptRooms(userId: string): Promise<string[]> {
    const rows = await this.list(undefined, { includeDeleted: true });
    const targets = rows.filter((r) => r.type === 'dept' && !r.deletedAt && r.members.includes(userId));
    for (const r of targets) await this.save({ ...r, members: r.members.filter((m) => m !== userId) });
    return targets.map((r) => r.id);
  },

  /** 부서 삭제 — 그 부서방을 일반 단체방으로 바꾼다(이름·참여자·대화 유지). 바뀐 방 ID 목록을 돌려준다. */
  async detachDeptRoom(deptId: string): Promise<string[]> {
    const rows = await this.list(undefined, { includeDeleted: true });
    const targets = rows.filter((r) => deptIdOfRoom(r) === deptId);
    for (const r of targets) await this.save({ ...r, type: 'group', deptId: null });
    return targets.map((r) => r.id);
  },

  /** 새 메시지 전송 시 목록 표시용 lastMessage 갱신. */
  async updateLastMessage(id: string, last: LastMessage): Promise<void> {
    const room = await this.get(id);
    if (!room) throw new Error(`채팅방을 찾을 수 없습니다: ${id}`);
    await this.save({ ...room, lastMessage: last });
  },
};
