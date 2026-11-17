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

/**
 * PC 알림은 5초 뒤 스스로 닫는다(화면 구석에 쌓이지 않게).
 * 휴대폰 알림은 닫지 않는다 — 읽을 때까지 알림창에 남고, 읽으면 회수 신호·앱 복귀 때 정리된다.
 * (휴대폰은 화면이 꺼지면 서비스워커가 멈춰 타이머가 울리지 않기도 해서 믿을 수도 없었다)
 */
const DESKTOP_NOTIFICATION_MS = 5_000;

async function expireNotification(id, tag) {
  await new Promise((resolve) => setTimeout(resolve, DESKTOP_NOTIFICATION_MS));
  const notifications = await self.registration.getNotifications({ tag });
  for (const notification of notifications) {
    if (notification.data?.workfitNotificationId === id) notification.close();
  }
}

/**
 * 방별로 어디까지 읽었는지(메시지 시각 at) — 다른 기기에서 읽어 회수 신호가 온 값.
 * 회수 신호가 그 메시지의 알림보다 먼저 도착해도, 늦게 온 알림을 이것으로 거른다.
 */
const readUpToKey = (roomId) => `/read-up-to/${encodeURIComponent(roomId)}`;
async function readUpToOf(roomId) {
  try {
    const r = await (await caches.open('workfit-meta')).match(readUpToKey(roomId));
    return r ? await r.text() : '';
  } catch (e) {
    return '';
  }
}

/** 다른 기기에서 그 방을 readUpTo 까지 읽었다 — 기록하고, 그 시각까지의 그 방 알림을 닫는다. */
async function recallChat(roomId, readUpTo) {
  if (!roomId || !readUpTo) return;
  try {
    if (readUpTo > (await readUpToOf(roomId))) {
      await (await caches.open('workfit-meta')).put(readUpToKey(roomId), new Response(readUpTo));
    }
  } catch (e) {
    /* 기록 실패 — 지금 떠 있는 알림은 그래도 닫는다 */
  }
  // 대화 알림의 tag 는 메시지마다 다르다(아래 showChatNotification) — 방 번호로 찾는다(예전 알림은 tag = 방 번호)
  for (const old of await self.registration.getNotifications()) {
    if (old.data?.roomId !== roomId && old.tag !== roomId) continue;
    const at = old.data?.at || '';
    if (!at || at <= readUpTo) old.close();
  }
}

/**
 * 같은 대상(같은 방·같은 문서)의 예전 알림 닫기 — 새 알림을 띄운 '뒤에' 부른다.
 *
 * 알림 tag 는 메시지마다 다르게 준다(대상#알림id). 같은 tag 로 띄우면 휴대폰이 상단바의 같은 대상 알림을 '고친 알림'으로
 * 보고 진동·소리를 생략했다(renotify 를 줘도, 먼저 닫고 띄워도 휴대폰에 따라 그대로 — 알림 번호가 같아서).
 * 늘 새 알림으로 띄워 매번 울리고, 예전 것은 닫아 상단바엔 지금처럼 대상마다 최신 알림 하나만 남긴다
 */
async function closeOlderOfTarget(target, keepId) {
  if (!target) return;
  try {
    for (const old of await self.registration.getNotifications()) {
      const sameTarget = old.data?.workfitTarget === target || old.tag === target; // 예전 알림은 tag = 대상
      if (sameTarget && old.data?.workfitNotificationId !== keepId) old.close();
    }
  } catch (e) {
    /* 닫기 실패 — 새 알림은 이미 떴다 */
  }
}

// 백그라운드/종료 상태 수신 → 알림 표시.
messaging.onBackgroundMessage(async (payload) => {
  const n = payload.notification || {};
  const data = payload.data || {};
  /**
   * 회수 신호 — 다른 기기에서 읽은 대화방의 알림을 닫는다(새 알림이 아니다).
   * 안드로이드 휴대폰에만 온다(서버가 users.fcmTokensRecall 로 거른다. 아이폰은 받으면 권한이 끊길 수 있다).
   * 닫고 나서 떠 있는 알림이 하나도 없으면 크롬은 이 푸시를 '알림 없는 푸시'로 세고, 사이트별 허용량을 넘기면
   * "백그라운드에서 업데이트됨" 알림을 대신 띄운다. 그래서 화면이 신호를 몰아서 보낸다(messaging.ts).
   */
  if (data.type === 'recall-chat') {
    await recallChat(data.roomId, data.readUpTo);
    return;
  }
  // 이미 다른 기기에서 읽은 메시지(회수 신호가 먼저 도착) — 띄우지 않는다
  if (data.roomId && data.at && data.at <= (await readUpToOf(data.roomId))) return;
  const isChat = Boolean(data.roomId);
  const bodyText = n.body || data.body || (isChat ? '새로운 메시지가 도착했습니다.' : '');
  const id = `${Date.now()}-${Math.random()}`;
  const target = data.roomId || data.docId || data.linkUrl || '';
  // 메시지마다 다른 tag — 늘 새 알림이라 매번 울린다(closeOlderOfTarget 참고)
  const tag = target ? `${target}#${id}` : undefined;
  await self.registration.showNotification(n.title || data.title || '새 알림', {
    body: bodyText,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    // shownAt: 휴대폰 앱이 안 읽은 수로 알림을 정리할 때, 그 수를 받은 뒤에 뜬 알림은 건드리지 않게
    data: { ...data, workfitNotificationId: id, workfitTarget: target, shownAt: Date.now() },
    /**
     * 같은 대상의 알림은 겹쳐 쌓지 않고 하나로 합친다.
     *
     * 일정 알림은 roomId·docId 가 없어 tag 가 안 붙었고, 그래서 5분 주기 리마인더가
     * 배너를 계속 쌓았다. linkUrl 을 마지막 수단으로 써서 일정 알림도 병합되게 한다.
     */
    tag,
    requireInteraction: false,
    /**
     * 알림마다 진동 — tag 가 메시지마다 달라 늘 새 알림이다(closeOlderOfTarget).
     * 일정 리마인더(linkUrl tag)도 마찬가지. vibrate 는 안드로이드 크롬 PWA 에서 쓰이고(아이폰은 휴대폰 설정대로),
     * 실제로 울릴지는 휴대폰의 앱 알림 설정(소리·진동, 무음·방해금지)에도 달렸다
     */
    silent: false,
    vibrate: [200, 100, 200],
  });
  await closeOlderOfTarget(target, id);
  // FCM은 반환한 Promise를 push 이벤트의 waitUntil에 연결한다.
  if ((await getClientMode()) === 'desktop') await expireNotification(id, tag);
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
  // 앱이 화면에 있을 때 받은 회수 신호 — 페이지가 넘겨준다(messaging.ts onForegroundMessage)
  if (d.type === 'workfit-recall-chat') {
    event.waitUntil(recallChat(d.roomId, d.readUpTo));
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
      // 경로로 창을 가른다 — 관리자 콘솔(/admin)은 채팅·링크를 받을 셸이 없어 알림 대상에서 뺀다.
      // (예전엔 주소에 '/m' 이 없으면 모두 업무 창으로 봐서, 콘솔 창이 앞으로 나오기만 했다)
      const pathOf = (c) => { try { return new URL(c.url).pathname; } catch { return ''; } };
      const isAdmin = (p) => p === '/admin' || p.startsWith('/admin/');
      const isPwa = (p) => p === '/m' || p.startsWith('/m/');
      const desktop = focusable.find((c) => { const p = pathOf(c); return !isAdmin(p) && !isPwa(p); });
      const pwa = focusable.find((c) => isPwa(pathOf(c)));

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
