import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { approvalReadRepo } from '@/data/approvalRead/approvalRead.repo';
import { useReceivedPostReads } from '@/features/gw/usePostReadShares';
import { getReadRejectedDocIds } from '@/domain/approvalDoc/engine';
import type { ApprovalBox, ApprovalDoc } from '@/domain/approvalDoc/schema';
import {
  baselineReadDocIds,
  isDocRead,
  UNREAD_TRACKED_BOXES,
  unreadByBox,
  type UnreadTrackedBox,
} from '@/domain/approvalDoc/unread';

const KEY = 'approvalReads';

/**
 * 전자결재 안읽음 — 웹·PWA 공용. 결재함 분류(byBox)는 화면이 이미 가진 것을 받는다
 * (결재 문서를 다시 불러오지 않게). 규칙은 domain/approvalDoc/unread.
 *
 * 처음 쓰는 사람은 기준선을 한 번 남긴다 — 대기·참조·수신함의 기존 문서와 이 브라우저에 남아 있던
 * 반려 열람 기록을 읽음으로. 기준선을 남기기 전에는 안읽음을 표시하지 않는다(전부 안읽음으로 번쩍이지 않게).
 */
export function useApprovalUnread(userId: string, byBox: Record<ApprovalBox, ApprovalDoc[]>, boxesLoading: boolean) {
  const qc = useQueryClient();
  const readQuery = useQuery({
    queryKey: [KEY, userId],
    queryFn: () => approvalReadRepo.readState(userId),
    enabled: Boolean(userId),
  });
  const { data: postReadShares = [] } = useReceivedPostReads(userId ? [userId] : []);

  // 처음 적용 기준선(한 사람당 한 번)
  const baselineStarted = useRef(false);
  useEffect(() => {
    const state = readQuery.data;
    if (!userId || !state || state.hasBaseline || boxesLoading || baselineStarted.current) return;
    baselineStarted.current = true;
    approvalReadRepo
      .applyBaseline(userId, baselineReadDocIds(byBox, getReadRejectedDocIds(userId)))
      .catch((err) => console.warn('[approvalReads] 기준선 기록 실패:', err))
      .finally(() => qc.invalidateQueries({ queryKey: [KEY, userId] }));
  }, [userId, readQuery.data, boxesLoading, byBox, qc]);

  const ready = Boolean(readQuery.data?.hasBaseline);
  const readDocIds = useMemo(() => readQuery.data?.readDocIds ?? new Set<string>(), [readQuery.data]);

  const unread = useMemo(() => {
    const empty = Object.fromEntries(UNREAD_TRACKED_BOXES.map((b) => [b, { ids: new Set<string>(), count: 0 }])) as ReturnType<typeof unreadByBox>;
    return ready ? unreadByBox(byBox, userId, readDocIds, postReadShares) : empty;
  }, [ready, byBox, userId, readDocIds, postReadShares]);

  /** 안읽음 여부 — 추적 결재함에 있는지와 무관하게 문서 단위로 */
  const isUnreadDoc = useCallback(
    (doc: ApprovalDoc) => ready && !isDocRead(doc, userId, readDocIds, postReadShares),
    [ready, userId, readDocIds, postReadShares],
  );

  /** 문서를 열었을 때 읽음으로 기록(즉시 화면 반영 후 저장) */
  const markRead = useCallback(
    (docId: string) => {
      if (!userId || !docId || readDocIds.has(docId)) return;
      qc.setQueryData([KEY, userId], (prev: { readDocIds: Set<string>; hasBaseline: boolean } | undefined) =>
        prev ? { ...prev, readDocIds: new Set(prev.readDocIds).add(docId) } : prev,
      );
      approvalReadRepo.markRead(userId, [docId]).catch((err) => console.warn('[approvalReads] 읽음 기록 실패:', err));
    },
    [userId, readDocIds, qc],
  );

  return {
    unread,
    unreadCount: (box: ApprovalBox) => (UNREAD_TRACKED_BOXES as readonly string[]).includes(box) ? unread[box as UnreadTrackedBox].count : 0,
    isUnreadInBox: (box: ApprovalBox | string, docId: string) =>
      (UNREAD_TRACKED_BOXES as readonly string[]).includes(box) && unread[box as UnreadTrackedBox].ids.has(docId),
    /** 추적 결재함 어디서든 안읽음인지(검색 결과처럼 결재함이 섞인 목록용) */
    isUnreadAnywhere: (docId: string) => UNREAD_TRACKED_BOXES.some((b) => unread[b].ids.has(docId)),
    isUnreadDoc,
    markRead,
  };
}

/**
 * 상세 화면을 열면 읽음으로 기록 — 푸시 알림 등으로 목록을 거치지 않고 바로 들어오는 경우용.
 * 결재함 분류 없이 기록만 한다(목록 화면이 다시 열리면 최신 기록을 읽는다).
 */
export function useMarkApprovalReadOnOpen(userId: string | undefined, docId: string | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!userId || !docId) return;
    approvalReadRepo
      .markRead(userId, [docId])
      .then(() => qc.invalidateQueries({ queryKey: [KEY, userId] }))
      .catch((err) => console.warn('[approvalReads] 읽음 기록 실패:', err));
  }, [userId, docId, qc]);
}
