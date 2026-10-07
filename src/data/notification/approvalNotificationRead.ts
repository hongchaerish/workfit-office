import type { LiveNotification } from '@/domain/liveNotification/schema';

export function isOpenedDocumentNotification(n: LiveNotification, userId: string, docId: string, openedAt: number): boolean {
  if (n.read || n.userId !== userId || n.type !== '결재' || !n.linkUrl) return false;
  try {
    const link = new URL(n.linkUrl, 'https://workfit.invalid');
    const pathId = /^\/m\/approval\/([^/]+)\/?$/.exec(link.pathname)?.[1];
    const target = link.pathname === '/gw/approval' ? link.searchParams.get('doc')
      : pathId ? decodeURIComponent(pathId) : null;
    if (target !== docId) return false;
    const createdAt = new Date(n.createdAt).getTime();
    // 초 단위 저장 시각은 그 초가 끝난 것만 처리해 열람 후 도착한 알림을 보호한다.
    const precision = /:\d{2}(?:Z|[+-]\d{2}:\d{2})?$/.test(n.createdAt) ? 999 : 0;
    return Number.isFinite(createdAt) && createdAt + precision <= openedAt;
  } catch { return false; }
}

/** 한 건 저장 실패가 나머지 알림이나 문서 열람을 막지 않도록 분리한다. */
export async function markOpenedDocumentNotifications(
  backend: { listUnreadApprovals(userId: string): Promise<LiveNotification[]>; markAsRead(id: string): Promise<void> },
  userId: string, docId: string, openedAt: number, isCurrent: () => boolean = () => true,
): Promise<void> {
  if (!userId || !docId || !isCurrent()) return;
  const list = await backend.listUnreadApprovals(userId);
  const failures: unknown[] = [];
  for (const n of list) {
    if (!isCurrent()) break;
    if (!isOpenedDocumentNotification(n, userId, docId, openedAt)) continue;
    try { await backend.markAsRead(n.id); } catch (error) { failures.push(error); }
  }
  if (failures.length) throw new AggregateError(failures, '문서 알림 읽음 기록 일부 실패');
}
