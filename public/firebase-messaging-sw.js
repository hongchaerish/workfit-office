/* Workfit 메신저 PWA — FCM 백그라운드 푸시 서비스워커.
 * 서비스워커는 ES 모듈/환경변수를 못 쓰므로 compat SDK + 클라이언트 설정을 직접 사용한다.
 * (클라이언트 Firebase 설정은 앱 번들에도 노출되는 공개 값) */
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyCnYjXcWwbwl4ETLBtwfk0G79zsn02ofWE',
  authDomain: 'workfit-office-app.firebaseapp.com',
  projectId: 'workfit-office-app',
  storageBucket: 'workfit-office-app.firebasestorage.app',
  messagingSenderId: '34440992629',
  appId: '1:34440992629:web:3f1d6ea4a3e14c5780653c',
});

const messaging = firebase.messaging();

// 알림 표시 코드만 즉시 갱신하며, 사용자 화면은 다시 로드하지 않는다.
self.addEventListener('install', (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

async function expireNotification(id, tag) {
  await new Promise((resolve) => setTimeout(resolve, 10_000));
  const notifications = await self.registration.getNotifications({ tag });
  for (const notification of notifications) {
    if (notification.data?.workfitNotificationId === id) notification.close();
  }
}

// 백그라운드/종료 상태 수신 → 알림 표시.
messaging.onBackgroundMessage(async (payload) => {
  const n = payload.notification || {};
  const data = payload.data || {};
  const isChat = Boolean(data.roomId);
  const bodyText = n.body || data.body || (isChat ? '새로운 메시지가 도착했습니다.' : '');
  const id = `${Date.now()}-${Math.random()}`;
  const tag = data.roomId || data.docId || data.linkUrl || undefined;
  await self.registration.showNotification(n.title || data.title || '새 알림', {
    body: bodyText,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { ...data, workfitNotificationId: id },
    /**
     * 같은 대상의 알림은 겹쳐 쌓지 않고 하나로 합친다.
     *
     * 일정 알림은 roomId·docId 가 없어 tag 가 안 붙었고, 그래서 5분 주기 리마인더가
     * 배너를 계속 쌓았다. linkUrl 을 마지막 수단으로 써서 일정 알림도 병합되게 한다.
     */
    tag,
    requireInteraction: false,
    renotify: Boolean(data.roomId || data.docId),
  });
  // FCM은 반환한 Promise를 push 이벤트의 waitUntil에 연결한다.
  await expireNotification(id, tag);
});

// 기기 모드(desktop/pwa) 저장 — 열린 창이 없는 "콜드 클릭"의 목적지를 정한다.
// 페이지(messaging.ts)가 토큰 등록 시 postMessage('workfit-mode') 로 알려준다.
let clientMode = null;
self.addEventListener('message', (event) => {
  const d = event.data || {};
  if (d.type === 'workfit-expire-notification' && typeof d.id === 'string') {
    event.waitUntil(expireNotification(d.id, d.tag));
    return;
  }
  if (d.type === 'workfit-mode' && d.mode) {
    clientMode = d.mode;
    event.waitUntil(caches.open('workfit-meta').then((c) => c.put('/mode', new Response(d.mode))));
  }
});
async function getClientMode() {
  if (clientMode) return clientMode;
  try {
    const c = await caches.open('workfit-meta');
    const r = await c.match('/mode');
    if (r) return (await r.text()) || 'pwa';
  } catch (e) {
    /* noop */
  }
  return 'pwa'; // 기본: 설치형 PWA(start_url=/m)
}

// 알림 탭 → 창 종류별 처리. 데스크톱은 /m 으로 보내지 않고 그 창에서(도크/결재) 처리한다.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  event.waitUntil(
    (async () => {
      const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const focusable = list.filter((c) => 'focus' in c);
      const desktop = focusable.find((c) => !c.url.includes('/m'));
      const pwa = focusable.find((c) => c.url.includes('/m'));

      /**
       * 1) 데스크톱 창이 열려 있으면: **앱에 넘겨 SPA 라우팅으로 이동한다.**
       *
       * 예전에는 채팅만 postMessage 로 넘기고 나머지(결재·일정)는 `client.navigate()` 를
       * 불렀다. 그건 라우트 이동이 아니라 **페이지 전체를 다시 여는 하드 내비게이션**이라,
       * 알림을 누른 순간 작성 중이던 내용이 사라졌다. 주석은 "라우트 이동 없이"라고
       * 적혀 있었지만 코드가 그 반대였다.
       *
       * 목적지로 가는 건 앱이 한다(AppShell 의 workfit-open-link 처리).
       */
      if (desktop) {
        if (data.roomId) {
          desktop.postMessage({ type: 'workfit-open-chat', roomId: data.roomId });
        } else if (data.linkUrl) {
          desktop.postMessage({ type: 'workfit-open-link', linkUrl: data.linkUrl });
        }
        return desktop.focus();
      }

      // 2) PWA 창이 열려 있으면: 같은 이유로 앱에 넘긴다.
      if (pwa) {
        let target = '/m';
        if (data.roomId) {
          target = `/m/room/${data.roomId}`;
        } else if (data.docId) {
          target = `/m/approval/${data.docId}`;
        } else if (data.linkUrl) {
          target = data.linkUrl.replace(/^\/gw/, '/m');
        }
        pwa.postMessage({ type: 'workfit-open-link', linkUrl: target });
        return pwa.focus();
      }

      // 3) 열린 창 없음(콜드): 기기 모드에 맞춰 새 창.
      const mode = await getClientMode();
      let fallback = '/';
      if (mode === 'desktop') {
        if (data.roomId) {
          fallback = `/?openChat=${encodeURIComponent(data.roomId)}`;
        } else if (data.linkUrl) {
          fallback = data.linkUrl;
        }
      } else {
        fallback = '/m';
        if (data.roomId) {
          fallback = `/m/room/${data.roomId}`;
        } else if (data.docId) {
          fallback = `/m/approval/${data.docId}`;
        } else if (data.linkUrl) {
          fallback = data.linkUrl.replace(/^\/gw/, '/m');
        }
      }
      return self.clients.openWindow(fallback);
    })(),
  );
});
