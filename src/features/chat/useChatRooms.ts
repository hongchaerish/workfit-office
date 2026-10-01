import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { chatRoomRepo, type CreateRoomInput } from '@/data/chatRoom/chatRoom.repo';
import { chatMessageRepo } from '@/data/chatMessage/chatMessage.repo';
import { nowLocalIso } from '@/shared/lib/datetime';
import { CHAT_THREAD_KEY } from './useChatThread';

/**
 * 채팅방 목록 데이터 훅 — 화면이 repository 대신 호출하는 React 바인딩.
 * ([[data-layer-pattern]] 정본 패턴 / [[메신저_개발_계획서.md]] Phase 1)
 */
export const CHAT_ROOMS_KEY = 'chatRooms';
export const CHAT_UNREAD_KEY = 'chatUnread';

/**
 * 준실시간 폴링 주기(ms). 메신저 패널이 열려 있을 때만 쿼리가 마운트되므로
 * 유휴 비용은 없다. 탭 비활성 시 refetchInterval 은 자동 일시정지(기본값).
 * ([[메신저_개발_계획서.md]] Phase 2 — Option A 폴링)
 */
export const CHAT_POLL_MS = 4000;

/** 내가 참여한 방 목록(최근 메시지순). */
export function useChatRooms(userId?: string) {
  return useQuery({
    queryKey: [CHAT_ROOMS_KEY, userId ?? null],
    queryFn: () => chatRoomRepo.list(userId),
    enabled: !!userId,
    refetchInterval: CHAT_POLL_MS,
  });
}

/** 방별 미읽음 수 맵(도출). */
export function useUnreadCounts(userId?: string) {
  return useQuery({
    queryKey: [CHAT_UNREAD_KEY, userId ?? null],
    queryFn: () => chatMessageRepo.unreadByRoom(userId!),
    enabled: !!userId,
    refetchInterval: CHAT_POLL_MS,
  });
}

/** 신규 방 생성(1:1/그룹). 생성된 방을 반환 → 화면이 즉시 그 방을 연다. */
export function useCreateRoom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateRoomInput) => chatRoomRepo.create(input),
    // 목록이 새 방을 포함한 뒤 resolve 되도록 refetch 완료까지 await(생성 직후 열기 시 깜빡임 방지).
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: [CHAT_ROOMS_KEY] });
    },
  });
}

interface InviteVars {
  roomId: string;
  /** 초대할 users.id */
  userIds: string[];
  inviterName: string;
  inviteeNames: string[];
}

/** 그룹 초대 — 방 members 확장 + "○○님이 △△님을 초대했습니다" 시스템 메시지. */
export function useInviteMembers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ roomId, userIds, inviterName, inviteeNames }: InviteVars) => {
      await chatRoomRepo.addMembers(roomId, userIds);
      await chatMessageRepo.append({
        id: `${roomId}-sys-${Date.now()}`,
        roomId,
        senderId: '',
        senderName: '',
        text: `${inviterName}님이 ${inviteeNames.join(', ')}님을 초대했습니다`,
        type: 'system',
        attachment: null,
        replyTo: null,
        approvalPayload: null,
        at: nowLocalIso(),
        readBy: [],
        isEdited: false,
        reactions: {},
      });
    },
    onSuccess: (_data, { roomId }) => {
      qc.invalidateQueries({ queryKey: [CHAT_ROOMS_KEY] });
      qc.invalidateQueries({ queryKey: [CHAT_THREAD_KEY, roomId] });
    },
  });
}

/** 방 나가기(탈퇴) — members 에서 제거 + "○○님이 나갔습니다" 시스템 메시지. 대화는 보존. */
export function useLeaveRoom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ roomId, userId, userName }: { roomId: string; userId: string; userName: string }) => {
      await chatMessageRepo.append({
        id: `${roomId}-sys-${Date.now()}`,
        roomId,
        senderId: '',
        senderName: '',
        text: `${userName}님이 나갔습니다`,
        type: 'system',
        attachment: null,
        replyTo: null,
        approvalPayload: null,
        at: nowLocalIso(),
        readBy: [],
        isEdited: false,
        reactions: {},
      });
      await chatRoomRepo.leave(roomId, userId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [CHAT_ROOMS_KEY] });
      qc.invalidateQueries({ queryKey: [CHAT_UNREAD_KEY] });
    },
  });
}

/**
 * 단체방 내보내기 — 참여자 누구나 다른 참여자를 내보낼 수 있다.
 * 초대·이름 변경과 같이 "○○님이 △△님을 내보냈습니다" 시스템 메시지를 남긴다. 대화는 보존.
 */
export function useKickMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ roomId, targetId, targetName, kickerName }: { roomId: string; targetId: string; targetName: string; kickerName: string }) => {
      await chatMessageRepo.append({
        id: `${roomId}-sys-${Date.now()}`,
        roomId,
        senderId: '',
        senderName: '',
        text: `${kickerName}님이 ${targetName}님을 내보냈습니다`,
        type: 'system',
        attachment: null,
        replyTo: null,
        approvalPayload: null,
        at: nowLocalIso(),
        readBy: [],
        isEdited: false,
        reactions: {},
      });
      await chatRoomRepo.leave(roomId, targetId);
    },
    onSuccess: (_data, { roomId }) => {
      qc.invalidateQueries({ queryKey: [CHAT_ROOMS_KEY] });
      qc.invalidateQueries({ queryKey: [CHAT_THREAD_KEY, roomId] });
      qc.invalidateQueries({ queryKey: [CHAT_UNREAD_KEY] });
    },
  });
}

/**
 * 방 삭제(소프트/아카이브) — 관리자 전용. 목록에서 숨기되 대화(chatMessages)는 보존.
 * 삭제 이력을 보존 로그에 남기도록 시스템 메시지도 추가(어드민 감사용).
 */
export function useDeleteRoom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ roomId, adminId, adminName }: { roomId: string; adminId: string; adminName: string }) => {
      await chatMessageRepo.append({
        id: `${roomId}-sys-${Date.now()}`,
        roomId,
        senderId: '',
        senderName: '',
        text: `관리자 ${adminName}님이 이 방을 삭제했습니다`,
        type: 'system',
        attachment: null,
        replyTo: null,
        approvalPayload: null,
        at: nowLocalIso(),
        readBy: [],
        isEdited: false,
        reactions: {},
      });
      await chatRoomRepo.softDelete(roomId, adminId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [CHAT_ROOMS_KEY] });
      qc.invalidateQueries({ queryKey: [CHAT_UNREAD_KEY] });
    },
  });
}

/** 방 이름 변경 — 생성자 전용. */
export function useUpdateRoomName() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ roomId, name, userName }: { roomId: string; name: string; userName: string }) => {
      await chatRoomRepo.updateName(roomId, name);
      await chatMessageRepo.append({
        id: `${roomId}-sys-${Date.now()}`,
        roomId,
        senderId: '',
        senderName: '',
        text: `${userName}님이 대화방 이름을 '${name}'(으)로 변경했습니다`,
        type: 'system',
        attachment: null,
        replyTo: null,
        approvalPayload: null,
        at: nowLocalIso(),
        readBy: [],
        isEdited: false,
        reactions: {},
      });
    },
    onSuccess: (_data, { roomId }) => {
      qc.invalidateQueries({ queryKey: [CHAT_ROOMS_KEY] });
      qc.invalidateQueries({ queryKey: [CHAT_THREAD_KEY, roomId] });
    },
  });
}
