import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { userRepo } from '@/data/user/user.repo';
import { employeeProfileRepo } from '@/data/employeeProfile/employeeProfile.repo';
import { approvalDocRepo } from '@/data/approvalDoc/approvalDoc.repo';
import { isActiveApprover } from '@/domain/approvalDoc/engine';
import type { ApprovalDoc } from '@/domain/approvalDoc/schema';
import { employeeProfileSchema } from '@/domain/employeeProfile/schema';
import { chatRoomRepo } from '@/data/chatRoom/chatRoom.repo';
import { appendSystemMessage } from '@/data/chatMessage/systemMessage';
import { CHAT_ROOMS_KEY } from '@/features/chat/useChatRooms';

/**
 * 퇴직 처리 — 인명관리에서만 한다(사용자 관리는 계정만 다룬다, 2026-10-15 결정).
 * 계정 쪽(미사용·퇴사일·푸시 토큰 제거·상급자 재연결)과 인사 쪽(재직 상태 '퇴직')을 함께 바꾼다.
 */

/** 퇴직 대상자가 **현재 활성 결재자**인 진행 중 문서 — 퇴직 시 결재가 정체될 위험을 미리 알린다. */
export function useBlockingApprovals(userId: string | undefined) {
  return useQuery({
    queryKey: ['blockingApprovals', userId ?? null],
    queryFn: async (): Promise<ApprovalDoc[]> => {
      if (!userId) return [];
      const all = await approvalDocRepo.list();
      return all.filter((d) => d.status === '진행중' && isActiveApprover(d, userId));
    },
    enabled: !!userId,
  });
}

/** 퇴직 처리 실행. 계정 비활성화가 먼저 — 그게 실패하면 인사 상태도 바꾸지 않는다. */
export async function retireEmployee(userId: string): Promise<{ reconnectedReports: number }> {
  const result = await userRepo.resign(userId);
  const user = await userRepo.get(userId);
  // 테스트 계정도 놓치지 않게 전체에서 찾는다 — 못 찾으면 기본값으로 새로 만들어 기존 인사 정보를 덮게 된다.
  const existing = (await employeeProfileRepo.listIncludingTestAccounts()).find((p) => p.id === userId || p.userId === userId);
  const profile = employeeProfileSchema.parse({
    ...(existing ?? {
      id: userId,
      userId,
      empNo: user?.empNo || userId,
      name: user?.name || userId,
      dept: user?.dept || '미지정',
      position: user?.position || '사원',
      jobTitle: user?.jobTitle || '팀원',
    }),
    status: 'RETIRED',
    updatedAt: new Date().toISOString(),
  });
  await employeeProfileRepo.save(profile, { keepAttendanceTarget: true });
  // 부서방에서 제외 — 메신저 쪽 실패가 퇴직 처리(계정·인사) 자체를 실패시키지 않게 한다.
  try {
    const name = user?.name || userId;
    for (const roomId of await chatRoomRepo.removeMemberFromDeptRooms(userId)) {
      await appendSystemMessage(roomId, `퇴직 처리로 ${name}님이 제외되었습니다`);
    }
  } catch (e) {
    console.warn('퇴직자 부서방 제외 실패:', (e as Error)?.message || e);
  }
  return result;
}

export function useRetireEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: retireEmployee,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['employeeProfiles'] });
      qc.invalidateQueries({ queryKey: ['blockingApprovals'] });
      qc.invalidateQueries({ queryKey: [CHAT_ROOMS_KEY] });
    },
  });
}
