import { getMessaging, getToken, onMessage, isSupported, type Messaging } from 'firebase/messaging';
import { app, isFirebaseConfigured } from './firebase';
import { userRepo } from '@/data/user/user.repo';

/**
 * FCM 웹 푸시(PWA) — 알림 권한/토큰/수신.
 * iOS 16.4+ 는 "홈 화면에 추가"한 PWA 에서만 동작. Android/데스크톱은 브라우저에서도 동작.
 * VAPID 키(Web Push 인증서 공개키)는 Firebase 콘솔에서 발급 → VITE_FB_VAPID_KEY 로 주입.
 */
const VAPID_KEY = import.meta.env.VITE_FB_VAPID_KEY as string | undefined;

let _messaging: Messaging | null = null;
async function getMsg(): Promise<Messaging | null> {
  if (!isFirebaseConfigured || !app) return null;
  try {
    if (!(await isSupported())) return null;
  } catch {
    return null;
  }
  if (!_messaging) _messaging = getMessaging(app);
  return _messaging;
}

/**
 * 현재 창이 데스크톱 셸인지 모바일 PWA(/m)인지 SW에 알린다.
 * SW 는 알림 클릭 시 "열린 창이 없을 때"(콜드) 목적지(데스크톱 홈 vs /m)를 이 값으로 정한다.
 */
function signalClientMode(swReg: ServiceWorkerRegistration): void {
  try {
    const mode = window.location.pathname.startsWith('/m') ? 'pwa' : 'desktop';
    (navigator.serviceWorker.controller ?? swReg.active)?.postMessage({ type: 'workfit-mode', mode });
  } catch {
    /* noop */
  }
}

/** 이 브라우저/기기에서 웹푸시가 가능한 환경인가(+VAPID 설정 여부). */
export function isPushConfigured(): boolean {
  return (
    typeof window !== 'undefined' &&
    'Notification' in window &&
    'serviceWorker' in navigator &&
    !!VAPID_KEY
  );
}

/** 현재 알림 권한 상태. */
export function notificationPermission(): NotificationPermission | 'unsupported' {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

async function registerPushServiceWorker(): Promise<ServiceWorkerRegistration> {
  const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js', { updateViaCache: 'none' });
  // 화면을 다시 열지 않아도 최신 표시 코드를 설치한다. 실패해도 기존 푸시는 유지한다.
  try { await registration.update(); }
  catch (error) { console.warn('[push] 서비스워커 업데이트 확인 실패', error); }
  await navigator.serviceWorker.ready;
  return registration;
}

/**
 * 알림 권한 요청 + FCM 토큰 발급 + users.fcmToken 저장.
 * 성공 시 토큰, 실패/미지원/거부 시 null. (반드시 사용자 제스처에서 호출 — 특히 iOS)
 */
export async function enablePushForUser(userId: string): Promise<{ ok: boolean; error?: string }> {
  if (!VAPID_KEY) return { ok: false, error: 'VAPID 키(VITE_FB_VAPID_KEY) 미설정' };
  const msg = await getMsg();
  if (!msg) return { ok: false, error: '이 브라우저는 웹 푸시 미지원(iOS는 홈 화면 추가 후)' };
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return { ok: false, error: `알림 권한: ${permission}` };

    const swReg = await registerPushServiceWorker();
    signalClientMode(swReg);
    const token = await getToken(msg, { vapidKey: VAPID_KEY, serviceWorkerRegistration: swReg });
    if (!token) return { ok: false, error: '토큰 발급 실패(null)' };

    await userRepo.updateFcmToken(userId, token);
    console.log('[push] 토큰 저장 완료', token.slice(0, 20) + '…');
    return { ok: true };
  } catch (e) {
    console.error('[push] 활성화 실패', e);
    return { ok: false, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
  }
}

/**
 * 권한이 이미 허용된 기기에서 토큰을 조용히 재발급/저장(권한 팝업 없음).
 * 로그인 직후 앱 루트에서 호출 → 채팅 화면을 열지 않아도 결재 등 푸시를 받는다.
 * 권한이 아직 'default'/'denied' 면 아무 것도 하지 않는다(최초 허용은 사용자
 * 제스처의 enablePushForUser 로 처리 — 특히 iOS).
 */
export async function syncPushToken(userId: string): Promise<void> {
  if (!userId || !VAPID_KEY) return;
  if (!isPushConfigured() || Notification.permission !== 'granted') return;
  const msg = await getMsg();
  if (!msg) return;
  try {
    const swReg = await registerPushServiceWorker();
    signalClientMode(swReg);
    const token = await getToken(msg, { vapidKey: VAPID_KEY, serviceWorkerRegistration: swReg });
    if (token) await userRepo.updateFcmToken(userId, token);
  } catch (e) {
    console.warn('[push] 토큰 동기화 실패', e);
  }
}

/** 포그라운드(앱 사용 중) 수신 payload — 타입별 딥링크에 필요한 필드 포함. */
export interface ForegroundPushPayload {
  title: string;
  body: string;
  type?: string;
  roomId?: string;
  docId?: string;
  linkUrl?: string;
}

/** 포그라운드(앱 사용 중) 수신 콜백 등록. */
export async function onForegroundMessage(
  cb: (payload: ForegroundPushPayload) => void,
): Promise<void> {
  const msg = await getMsg();
  if (!msg) return;
  onMessage(msg, (payload) => {
    const n = payload.notification ?? {};
    const d = payload.data ?? {};
    cb({
      title: n.title ?? d.title ?? '새 알림',
      body: n.body ?? d.body ?? '',
      type: d.type,
      roomId: d.roomId,
      docId: d.docId,
      linkUrl: d.linkUrl,
    });
  });
}
