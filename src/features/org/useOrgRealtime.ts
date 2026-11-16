import { useEffect } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { User } from '@/domain/user/schema';
import { client as appwriteClient, APPWRITE_DATABASE_ID, isAppwriteConfigured } from '@/shared/lib/appwrite';
import { dbDriver } from '@/shared/lib/dbDriver';
import { forgetSharedRead } from '@/data/_backend/sharedReads';
import { collectionOfEvents, keysToRefresh, ORG_COLLECTIONS, userChangeMatters } from './orgRealtime';

/** 한꺼번에 여러 건 바뀌면(일괄 발령 등) 모아서 한 번만 다시 받는다 */
const BATCH_MS = 300;

function cachedUser(qc: QueryClient, id: string): User | undefined {
  for (const [, data] of qc.getQueriesData<User[]>({ queryKey: ['users'] })) {
    const found = Array.isArray(data) ? data.find((u) => u?.id === id) : undefined;
    if (found) return found;
  }
  return undefined;
}

/**
 * 조직·기준 정보가 바뀌면 바로 다시 받는다 — 접속 중일 때만, 앱 전체에서 한 번.
 * 다시 받기는 invalidate 라서 받아 둔 값은 새 값이 올 때까지 그대로 보이고, 화면·작성 중 내용은 건드리지 않는다.
 * 실시간이 끊겨 있어도 5분 캐시가 지나면 다시 받는다(queryDefaults).
 */
export function useOrgRealtime(userId: string | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!userId || dbDriver !== 'appwrite' || !isAppwriteConfigured || !appwriteClient || !APPWRITE_DATABASE_ID) return;
    const db = APPWRITE_DATABASE_ID;
    const channels = ORG_COLLECTIONS.flatMap((c) => [`databases.${db}.collections.${c}.documents`, `databases.${db}.tables.${c}.rows`]);
    const pending = new Map<string, string[]>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      timer = null;
      for (const key of pending.values()) void qc.invalidateQueries({ queryKey: key }, { cancelRefetch: false });
      pending.clear();
    };
    let unsubscribe: (() => void) | null = null;
    try {
      unsubscribe = appwriteClient.subscribe(channels, (response) => {
        const coll = collectionOfEvents(response.events ?? []);
        if (!coll) return;
        const payload = (response.payload ?? {}) as Record<string, unknown>;
        const removed = (response.events ?? []).some((e) => e.endsWith('.delete'));
        if (coll === 'users' && !removed && !userChangeMatters(cachedUser(qc, String(payload.$id ?? payload.id ?? '')), payload)) return;
        forgetSharedRead(coll);
        for (const key of keysToRefresh(coll)) pending.set(JSON.stringify(key), key);
        if (!timer) timer = setTimeout(flush, BATCH_MS);
      });
    } catch (err) {
      console.warn('[org] 조직 정보 실시간 연결 실패 — 5분마다 다시 받습니다', err);
    }
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe?.();
    };
  }, [userId, qc]);
}
