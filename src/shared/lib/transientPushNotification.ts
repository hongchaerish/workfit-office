export const PUSH_NOTIFICATION_DURATION_MS = 10_000;

/** 같은 방의 다음 알림을 이전 타이머가 닫지 않도록 표시마다 구분한다. */
export async function showTransientPushNotification(
  registration: ServiceWorkerRegistration,
  title: string,
  options: NotificationOptions,
): Promise<void> {
  const id = `${Date.now()}-${Math.random()}`;
  await registration.showNotification(title, {
    ...options,
    requireInteraction: false,
    data: { ...options.data, workfitNotificationId: id },
  });
  registration.active?.postMessage({ type: 'workfit-expire-notification', id, tag: options.tag });
  // SW의 waitUntil이 최소화한 페이지의 타이머 제한을 피한다. 아래는 구버전 SW의 폴백.
  setTimeout(() => {
    void registration.getNotifications({ tag: options.tag }).then((notifications) => {
      for (const notification of notifications) {
        if (notification.data?.workfitNotificationId === id) notification.close();
      }
    }).catch((error) => console.warn('[push] 알림 닫기 실패', error));
  }, PUSH_NOTIFICATION_DURATION_MS);
}
