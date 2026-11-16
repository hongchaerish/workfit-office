import { chatRoomSchema, type ChatRoom } from './schema';

/**
 * 부서 단체방 판정 — 순수 함수. ([[docs/superpowers/specs/2026-10-19-dept-room-design.md]])
 *
 * 부서방은 처음 한 번만 자동 개설하고, 이후 참여자는 사람이 직접 관리한다.
 * 자동으로 하는 일은 '방 없는 부서에 개설'과 '부서명 변경 시 방 이름 따라가기' 둘뿐이다.
 * Appwrite chatRooms 에는 deptId 칸이 없으므로 부서는 방 ID(`RM-DEPT-{부서ID}`)로 판별한다.
 */
const DEPT_ROOM_ID = /^(?:RM|ROOM)-DEPT-(.+)$/;

export function deptRoomId(deptId: string): string {
  return `RM-DEPT-${deptId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
}

export function deptRoomName(deptName: string): string {
  return `[${deptName}] 부서 단체방`;
}

/** 부서방이면 그 부서 ID, 아니면 null. */
export function deptIdOfRoom(room: Pick<ChatRoom, 'id' | 'type' | 'deptId'>): string | null {
  if (room.type !== 'dept') return null;
  return room.deptId ?? DEPT_ROOM_ID.exec(room.id)?.[1] ?? null;
}

interface PlanInput {
  depts: { id: string; name: string }[];
  users: { id: string; dept: string; status: string }[];
  rooms: ChatRoom[];
  now: string;
  pickColor: (roomId: string) => string;
}

export interface DeptRoomPlan {
  create: ChatRoom[];
  rename: { roomId: string; name: string }[];
}

export function planDeptRoomSync({ depts, users, rooms, now, pickColor }: PlanInput): DeptRoomPlan {
  const plan: DeptRoomPlan = { create: [], rename: [] };
  for (const dept of depts) {
    const id = deptRoomId(dept.id);
    // 같은 ID의 방은 타입·삭제 여부와 무관하게 '있음'으로 본다 — 저장이 upsert 라 새로 만들면 덮어쓴다.
    const existing =
      rooms.find((r) => r.id === id || r.id === `ROOM-DEPT-${dept.id}`) ??
      rooms.find((r) => deptIdOfRoom(r) === dept.id);
    const name = deptRoomName(dept.name);

    if (existing) {
      if (existing.type === 'dept' && !existing.deletedAt && existing.name !== name) {
        plan.rename.push({ roomId: existing.id, name });
      }
      continue;
    }

    const members = users.filter((u) => u.dept === dept.name && u.status === '사용').map((u) => u.id);
    if (members.length === 0) continue;
    plan.create.push(
      chatRoomSchema.parse({
        id,
        name,
        type: 'dept',
        deptId: dept.id,
        members,
        color: pickColor(id),
        lastMessage: { text: `${dept.name} 부서 단체방이 개설되었습니다.`, at: now, senderId: 'system' },
        createdAt: now,
        createdBy: 'system',
      }),
    );
  }
  return plan;
}

/**
 * 부서방 맞추기 주기 — 방 목록은 실시간·1분 주기로 자주 다시 받는데, 그때마다 맞추면
 * 부서·사용자·인명 전체(8건)를 매번 읽는다. 부서 개설·이름 변경은 드물어 접속 때 한 번, 그 뒤 30분마다면 된다.
 */
export const DEPT_ROOM_SYNC_INTERVAL_MS = 30 * 60_000;

export function isDeptRoomSyncDue(lastSyncAt: number, now: number): boolean {
  return now - lastSyncAt > DEPT_ROOM_SYNC_INTERVAL_MS;
}
