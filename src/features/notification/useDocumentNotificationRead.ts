import { useEffect } from 'react';
import { notificationRepo } from '@/data/notification/notification.repo';

/** 정상적으로 표시되는 문서에만 사용한다. 미리보기·권한 거부 화면에는 연결하지 않는다. */
export function useDocumentNotificationRead(userId?: string, docId?: string): void {
  useEffect(() => {
    if (!userId || !docId) return;
    let current = true;
    const openedAt = Date.now();
    void notificationRepo.markDocumentNotificationsRead(userId, docId, openedAt, () => current)
      .catch(error => console.warn('[notifications] 문서 열람 알림 읽음 기록 실패', error));
    return () => { current = false; };
  }, [userId, docId]);
}
