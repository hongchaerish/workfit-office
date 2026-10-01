import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { approvalPostReadRepo, type SharePostReadInput } from '@/data/approvalPostRead/approvalPostRead.repo';
import { parseLegacyShares } from '@/domain/approvalPostRead/engine';

/** 후열(공람) 전달 훅. 실시간 구독이 없어 포커스 복귀·60초 주기로 다시 읽는다(즉시 인지는 알림/푸시). */
const KEY = 'approvalPostReads';

export function useReceivedPostReads(userIds: string[]) {
  const ids = [...new Set(userIds.filter(Boolean))].sort();
  return useQuery({
    queryKey: [KEY, 'recv', ...ids],
    queryFn: () => approvalPostReadRepo.listByRecipients(ids),
    enabled: ids.length > 0,
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
  });
}

export function useDocPostReads(docId: string) {
  return useQuery({
    queryKey: [KEY, 'doc', docId],
    queryFn: () => approvalPostReadRepo.listByDoc(docId),
    enabled: Boolean(docId),
  });
}

export function useSharePostRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SharePostReadInput) => approvalPostReadRepo.share(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

/** 수신자가 문서를 열면 본인 앞 미확인 전달을 확인 처리. 전임자 앞 건은 건드리지 않는다. 실패는 무음(다음 열람 때 재시도). */
export function useAutoMarkPostRead(docId: string, me: string) {
  const qc = useQueryClient();
  const { data: shares = [] } = useDocPostReads(docId);
  const tried = useRef(new Set<string>());
  useEffect(() => {
    const mine = shares.filter((s) => s.toUserId === me && !s.readAt && !tried.current.has(s.id));
    if (mine.length === 0) return;
    mine.forEach((s) => tried.current.add(s.id));
    Promise.all(mine.map((s) => approvalPostReadRepo.markRead(s.id)))
      .then(() => qc.invalidateQueries({ queryKey: [KEY] }))
      .catch((e) => console.error('[approvalPostRead] 후열 자동 확인 실패', e));
  }, [shares, me, qc]);
}

/** 예전 localStorage 전달 기록을 DB 로 1회 이관. 전부 성공했을 때만 키를 지운다. */
export function useLegacyPostReadImport(me: string, enabled: boolean) {
  const qc = useQueryClient();
  const done = useRef(false);
  useEffect(() => {
    if (!enabled || !me || done.current) return;
    done.current = true;
    const keys = [`workfit_post_read_shares_${me}`, 'workfit_post_read_shares'];
    let raw: unknown[] = [];
    try {
      for (const k of keys) {
        const v = localStorage.getItem(k);
        if (v) raw = raw.concat(JSON.parse(v));
      }
    } catch (e) {
      console.warn('[approvalPostRead] 레거시 후열 기록 읽기 실패', e);
      return;
    }
    if (raw.length === 0) return;
    approvalPostReadRepo
      .importLegacy(parseLegacyShares(raw))
      .then((r) => {
        if (r.failed === 0) keys.forEach((k) => localStorage.removeItem(k));
        if (r.imported > 0) void qc.invalidateQueries({ queryKey: [KEY] });
      })
      .catch((e) => console.error('[approvalPostRead] 레거시 후열 기록 이관 실패', e));
  }, [me, enabled, qc]);
}
