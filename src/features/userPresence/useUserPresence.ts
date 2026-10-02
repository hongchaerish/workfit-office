import { useAuth } from '@/app/auth/AuthProvider';
import {
  type UserPresence,
  type UserPresenceStatus,
  USER_PRESENCE_META,
} from '@/domain/userPresence/schema';
import { usePresenceContext } from './PresenceProvider';

/**
 * 근무 상태 hook — 계산은 `PresenceProvider`(앱에 하나)가 하고 여기서는 읽기만 한다.
 * 상태 결정 규칙은 `domain/userPresence/resolve.ts` 참고.
 */

const offline = (userId: string): UserPresence => ({ userId, status: 'OFFLINE', message: '', updatedAt: '' });

/** 전사 사용자들의 화면 상태 맵 */
export function useAllUserPresences(): Record<string, UserPresence> {
  return usePresenceContext().presences;
}

/** 로그인한 사용자의 상태와 변경 함수. 지금 보이는 상태를 그대로 넘기면 메시지만 바뀐다. */
export function useMyPresence() {
  const { user } = useAuth();
  const userId = user?.id ?? 'guest';
  const { presences, setMyPresence } = usePresenceContext();
  const presence = presences[userId] ?? offline(userId);
  return {
    presence,
    meta: USER_PRESENCE_META[presence.status] ?? USER_PRESENCE_META.OFFLINE,
    updatePresence: (status: UserPresenceStatus, message?: string) => setMyPresence(status, message),
  };
}

/** 특정 사용자의 상태 */
export function useUserPresence(userId?: string | null) {
  const { presences } = usePresenceContext();
  if (!userId) return null;
  const presence = presences[userId] ?? offline(userId);
  return {
    presence,
    meta: USER_PRESENCE_META[presence.status] ?? USER_PRESENCE_META.OFFLINE,
  };
}
