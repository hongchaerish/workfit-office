import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/app/auth/AuthProvider';
import { useAllApprovals } from '@/features/gw/useApprovals';
import { useUsers } from '@/features/user/useUsers';
import { useCommutePolicy } from '@/features/commute/useCommutePolicy';
import { calendarEventRepo } from '@/data/calendarEvent/calendarEvent.repo';
import { DEFAULT_COMMUTE_POLICY } from '@/domain/commutePolicy/schema';
import { buildApprovalDayIndex } from '@/domain/commute/approvalDayIndex';
import { resolvePresence, type PresenceMeeting, type StoredPresence } from '@/domain/userPresence/resolve';
import {
  USER_PRESENCE_STATUSES,
  type UserPresence,
  type UserPresenceStatus,
} from '@/domain/userPresence/schema';
import {
  client as appwriteClient,
  databases as appwriteDatabases,
  APPWRITE_DATABASE_ID,
  isAppwriteConfigured,
  safeDocId,
  Query,
} from '@/shared/lib/appwrite';

const COLLECTION_ID = 'user_presences';
const CACHE_KEY = 'workfit:user_presence_stored';
/** 화면의 '지금'을 다시 계산하는 주기 — 회의·반차 시작/끝, 접속 만료를 반영 */
const CLOCK_MS = 30 * 1000;
/** 내 접속 신호 주기(화면이 보일 때만) */
const HEARTBEAT_MS = 60 * 1000;

const kstToday = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

function readCache(): Record<string, StoredPresence> {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}
function writeCache(map: Record<string, StoredPresence>) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(map));
  } catch {
    /* 캐시는 첫 화면용 — 실패해도 동작에 지장 없음 */
  }
}

function parseStored(doc: Record<string, unknown>): { userId: string; stored: StoredPresence } {
  const raw = String(doc.status || '');
  const status = (USER_PRESENCE_STATUSES.includes(raw as UserPresenceStatus) ? raw : 'OFFLINE') as UserPresenceStatus;
  return {
    userId: String(doc.userId || doc.$id || ''),
    stored: {
      status,
      message: String(doc.message || ''),
      updatedAt: String(doc.updatedAt || ''),
      lastSeenAt: doc.lastSeenAt ? String(doc.lastSeenAt) : null,
    },
  };
}

/** 문서가 없으면 만든다. updatedAt 을 비워 두어 '직접 설정'으로 오인되지 않게 한다. */
async function writeMyDoc(userId: string, patch: Partial<StoredPresence>) {
  if (!isAppwriteConfigured || !appwriteDatabases || !APPWRITE_DATABASE_ID) return;
  const docId = safeDocId(userId);
  try {
    await appwriteDatabases.updateDocument(APPWRITE_DATABASE_ID, COLLECTION_ID, docId, patch);
  } catch (err) {
    if ((err as { code?: number })?.code !== 404) throw err;
    await appwriteDatabases.createDocument(APPWRITE_DATABASE_ID, COLLECTION_ID, docId, {
      userId,
      status: 'ONLINE',
      message: '',
      updatedAt: '',
      lastSeenAt: null,
      ...patch,
    });
  }
}

interface PresenceContextValue {
  presences: Record<string, UserPresence>;
  setMyPresence: (status: UserPresenceStatus, message?: string) => Promise<void>;
}

const PresenceContext = createContext<PresenceContextValue | null>(null);

/**
 * 근무 상태 공급자 — 앱에 하나. 저장된 상태(직접 설정·접속 신호)를 실시간 구독 1개로 받고,
 * 승인 결재·회의 시간대·근무시간 정책과 함께 `resolvePresence` 로 화면 상태를 계산한다.
 * 예전에는 상태를 쓰는 컴포넌트마다 구독과 결재 전체 로딩을 따로 열었다.
 */
export function PresenceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const myId = user?.id ?? null;
  const [stored, setStored] = useState<Record<string, StoredPresence>>(() => readCache());
  const [now, setNow] = useState(() => new Date());

  const applyStored = useCallback((updates: Array<{ userId: string; stored: StoredPresence }>) => {
    setStored((prev) => {
      const next = { ...prev };
      for (const u of updates) if (u.userId) next[u.userId] = u.stored;
      writeCache(next);
      return next;
    });
  }, []);

  // 저장된 상태: 최초 조회 + 실시간 구독
  useEffect(() => {
    if (!isAppwriteConfigured || !appwriteClient || !appwriteDatabases || !APPWRITE_DATABASE_ID) return;
    let unsubscribe: (() => void) | null = null;
    let cancelled = false;
    void (async () => {
      try {
        const res = await appwriteDatabases!.listDocuments(APPWRITE_DATABASE_ID, COLLECTION_ID, [Query.limit(500)]);
        if (!cancelled) applyStored(res.documents.map((d) => parseStored(d as unknown as Record<string, unknown>)));
        const channel = `databases.${APPWRITE_DATABASE_ID}.collections.${COLLECTION_ID}.documents`;
        unsubscribe = appwriteClient!.subscribe(channel, (response) => {
          const payload = response.payload as Record<string, unknown> | undefined;
          if (payload) applyStored([parseStored(payload)]);
        });
      } catch (err) {
        console.warn('[userPresence] 상태 조회/구독 실패 — 캐시로 표시합니다:', err);
      }
    })();
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [applyStored]);

  // 화면 시계
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), CLOCK_MS);
    return () => clearInterval(id);
  }, []);

  // 내 접속 신호 — 화면이 보일 때만 1분마다, 다시 보이면 즉시
  useEffect(() => {
    if (!myId || user?.status !== '사용') return;
    const beat = () => {
      if (document.visibilityState !== 'visible') return;
      const lastSeenAt = new Date().toISOString();
      setStored((prev) => {
        const mine = prev[myId] ?? { status: 'ONLINE', message: '', updatedAt: '' };
        return { ...prev, [myId]: { ...mine, lastSeenAt } };
      });
      writeMyDoc(myId, { lastSeenAt }).catch((err) => console.warn('[userPresence] 접속 신호 저장 실패:', err));
    };
    beat();
    const id = setInterval(beat, HEARTBEAT_MS);
    document.addEventListener('visibilitychange', beat);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', beat);
    };
  }, [myId, user?.status]);

  // 자동 상태 근거: 승인 결재·오늘 회의·근무시간 정책
  const approvalsQuery = useAllApprovals();
  const approvalIndex = useMemo(() => buildApprovalDayIndex(approvalsQuery.data ?? []), [approvalsQuery.data]);
  const { data: users = [] } = useUsers();
  const { policy = DEFAULT_COMMUTE_POLICY } = useCommutePolicy();
  const today = kstToday();
  const { data: meetingSlots = [] } = useQuery({
    queryKey: ['presence', 'meetingSlots', today],
    queryFn: () => calendarEventRepo.listMeetingSlots(today),
    refetchInterval: 5 * 60 * 1000,
  });

  const presences = useMemo(() => {
    const meetingsByUser = new Map<string, PresenceMeeting[]>();
    for (const slot of meetingSlots) {
      for (const uid of slot.userIds) {
        const list = meetingsByUser.get(uid) ?? [];
        list.push(slot);
        meetingsByUser.set(uid, list);
      }
    }
    const nameById = new Map(users.map((u) => [u.id, u.name]));
    const ids = new Set([...Object.keys(stored), ...users.map((u) => u.id)]);
    const out: Record<string, UserPresence> = {};
    for (const userId of ids) {
      const s = stored[userId] ?? null;
      const r = resolvePresence({
        stored: s,
        approvalDays: approvalIndex.lookup({ id: userId, name: nameById.get(userId) }),
        meetings: meetingsByUser.get(userId) ?? [],
        policy,
        now,
      });
      out[userId] = { userId, status: r.status, message: r.message, updatedAt: s?.updatedAt ?? '', lastSeenAt: s?.lastSeenAt ?? null };
    }
    return out;
  }, [stored, approvalIndex, users, meetingSlots, policy, now]);

  const setMyPresence = useCallback(
    async (status: UserPresenceStatus, message?: string) => {
      if (!myId) return;
      const current = presences[myId];
      const mine = stored[myId] ?? { status: 'ONLINE' as const, message: '', updatedAt: '', lastSeenAt: null };
      // 지금 보이는 상태를 그대로 넘기면 메시지만 바꾼다 — 자동 상태(회의중 등)를 직접 설정으로 굳히지 않는다.
      const messageOnly = current?.status === status && message !== undefined;
      const patch: Partial<StoredPresence> = messageOnly
        ? { message: message.trim() }
        : { status, message: message !== undefined ? message.trim() : mine.message, updatedAt: new Date().toISOString() };
      applyStored([{ userId: myId, stored: { ...mine, ...patch } }]);
      setNow(new Date());
      try {
        await writeMyDoc(myId, patch);
      } catch (err) {
        console.warn('[userPresence] 상태 저장 실패:', err);
      }
    },
    [myId, presences, stored, applyStored],
  );

  const value = useMemo(() => ({ presences, setMyPresence }), [presences, setMyPresence]);
  return <PresenceContext.Provider value={value}>{children}</PresenceContext.Provider>;
}

export function usePresenceContext(): PresenceContextValue {
  const ctx = useContext(PresenceContext);
  if (!ctx) throw new Error('PresenceProvider 안에서만 근무 상태를 쓸 수 있습니다.');
  return ctx;
}
