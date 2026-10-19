import { nowLocalIso } from '@/shared/lib/datetime';
import { chatMessageRepo } from './chatMessage.repo';

/**
 * 방 안 시스템 메시지(가운데 캡슐) — 초대·나가기·내보내기·부서방 자동 처리 기록.
 * 보낸 사람이 없어(senderId '') 아무도 지울 수 없고, 방을 지워도 남는다 → 변경 이력(로그) 역할.
 */
export async function appendSystemMessage(roomId: string, text: string): Promise<void> {
  await chatMessageRepo.append({
    id: `${roomId}-sys-${Date.now()}`,
    roomId,
    senderId: '',
    senderName: '',
    text,
    type: 'system',
    attachment: null,
    replyTo: null,
    approvalPayload: null,
    at: nowLocalIso(),
    readBy: [],
    isEdited: false,
    reactions: {},
  });
}
