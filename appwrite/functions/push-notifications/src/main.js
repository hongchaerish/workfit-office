/**
 * Appwrite Function — 워크핏 푸시 알림 트리거.
 * ([[Firestore_Appwrite_이관_단계별_계획서]] Phase 2 §5-C)
 *
 * 기존 Firebase Cloud Functions(onNewChatMessage·onNewNotification)를 Appwrite Function으로
 * 이식. **발송은 FCM 유지**(무료·무제한). 트리거만 Appwrite DB 이벤트로 전환.
 *
 * 트리거(이벤트) — 함수 설정에서 아래 2개 등록:
 *   databases.workfit.collections.chatMessages.documents.*.create
 *   databases.workfit.collections.notifications.documents.*.create
 *   (1.9 TablesDB 표기면 …tables.{coll}.rows.*.create 도 함께)
 *
 * 토큰 소스: **Appwrite users**(단일 SoT). Firestore 폴백은 이관 완료로 제거됨(2026-08-17).
 *
 * 필요 env(함수 설정):
 *   FCM_SERVICE_ACCOUNT   — Firebase 서비스계정 JSON 문자열(workfit-office-app). FCM 발송 전용.
 *   APPWRITE_API_KEY      — (선택) databases.read 스코프. 동적 키(x-appwrite-key) 있으면 불필요.
 *   APPWRITE_DATABASE_ID  — 기본 'workfit'
 */
import { Client, Databases } from 'node-appwrite';
import admin from 'firebase-admin';

// firebase-admin 1회 초기화(FCM 발송 전용).
function ensureAdmin() {
  if (!admin.apps.length) {
    const sa = JSON.parse(process.env.FCM_SERVICE_ACCOUNT);
    admin.initializeApp({ credential: admin.credential.cert(sa) });
  }
  return admin;
}

/** users.{id}.fcmToken 조회 — Appwrite(단일 SoT). */
async function getFcmToken(dbs, DB, uid, log) {
  try {
    const u = await dbs.getDocument(DB, 'users', uid);
    if (u && u.fcmToken) return { token: u.fcmToken, source: 'appwrite' };
  } catch (e) {
    if (e?.code !== 404) log(`appwrite user ${uid} 조회 오류: ${e.message}`);
  }
  return { token: '', source: 'none' };
}

/** 방 정보(members·name) 조회 — Appwrite(단일 SoT). */
async function getRoom(dbs, DB, roomId, log) {
  try {
    const r = await dbs.getDocument(DB, 'chatRooms', roomId);
    if (r) return { members: Array.isArray(r.members) ? r.members : [], name: r.name || '채팅방' };
  } catch (e) {
    if (e?.code !== 404) log(`appwrite room ${roomId} 조회 오류: ${e.message}`);
  }
  return null;
}

/** 알림 본문은 한 줄, 최대 80자로 제한한다. 첨부 내용 대신 종류만 표시한다. */
function chatPreview(msg) {
  if (msg.type === 'image') return '사진을 보냈습니다.';
  if (msg.type === 'file') return '파일을 보냈습니다.';
  const text = String(msg.text || '').replace(/\s+/g, ' ').trim();
  if (!text) return '새로운 메시지가 도착했습니다.';
  const chars = Array.from(text);
  return chars.length > 80 ? chars.slice(0, 80).join('') + '…' : text;
}

// ── 채팅 메시지 → 방 멤버(발신자 제외)에게 푸시 ──
async function handleChatMessage(msg, dbs, DB, log) {
  if (!msg || msg.type === 'system') return { skipped: 'system' };
  const roomId = msg.roomId;
  const senderId = msg.senderId || '';
  if (!roomId) return { skipped: 'no-room' };

  const room = await getRoom(dbs, DB, roomId, log);
  if (!room) return { skipped: 'room-not-found' };

  const recipientIds = room.members.filter((id) => id && id !== senderId);
  const tokens = [];
  await Promise.all(
    recipientIds.map(async (uid) => {
      const { token } = await getFcmToken(dbs, DB, uid, log);
      if (token) tokens.push(token);
    }),
  );
  if (tokens.length === 0) return { skipped: 'no-tokens', room: roomId };

  const senderName = String(msg.senderName || '').replace(/\s+/g, ' ').trim();
  const title = senderName ? `${senderName} · ${room.name}` : room.name;
  const body = chatPreview(msg);

  const res = await ensureAdmin()
    .messaging()
    .sendEachForMulticast({
      tokens,
      // 웹은 data-only → FCM 자동표시 없이 서비스워커(onBackgroundMessage)가 단일 표시(중복·아이콘·유지 통제).
      // 모바일은 android.notification / apns.alert 로 백그라운드 알림 표시.
      data: { roomId: String(roomId), roomName: String(room.name), title: String(title), body: String(body) },
      android: { priority: 'high', notification: { title, body, channelId: 'workfit_messages' } },
      apns: { payload: { aps: { alert: { title, body }, sound: 'default' } } },
    });
  log(`chat push: ${res.successCount}/${tokens.length} room ${roomId}`);
  return { sent: res.successCount, total: tokens.length };
}

// ── 인앱 알림(결재 등) → 대상자에게 푸시 ──
async function handleNotification(noti, dbs, DB, log) {
  const userId = noti?.userId;
  if (!userId) return { skipped: 'no-user' };

  const { token } = await getFcmToken(dbs, DB, userId, log);
  if (!token) return { skipped: 'no-token', user: userId };

  const type = noti.type || '시스템';
  const title = noti.title || '새 알림';
  const body = noti.text || '';
  const linkUrl = noti.linkUrl || '';
  const docMatch = /[?&]doc=([^&]+)/.exec(linkUrl);
  const docId = docMatch ? decodeURIComponent(docMatch[1]) : '';
  const channelId = type === '결재'
    ? 'workfit_approvals'
    : type === '메신저'
      ? 'workfit_messages'
      : 'workfit_general';

  try {
    await ensureAdmin()
      .messaging()
      .send({
        token,
        // 웹 data-only(SW 단일 표시), 모바일은 android/apns.
        data: {
          type: String(type),
          docId: String(docId),
          linkUrl: String(linkUrl),
          title: String(title),
          body: String(body),
        },
        android: { priority: 'high', notification: { title, body, channelId } },
        apns: { payload: { aps: { alert: { title, body }, sound: 'default' } } },
      });
    log(`noti push → ${userId} (${type})`);
    return { sent: 1, user: userId };
  } catch (e) {
    const code = e?.errorInfo?.code;
    if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
      // 만료 토큰 정리(Appwrite).
      try {
        await dbs.updateDocument(DB, 'users', userId, { fcmToken: '' });
      } catch {
        /* noop */
      }
      log(`cleared stale token for ${userId}`);
    } else {
      log(`noti push failed for ${userId}: ${e.message}`);
    }
    return { error: e.message, user: userId };
  }
}

// ── 엔트리포인트: 이벤트로 라우팅 ──
export default async ({ req, res, log, error }) => {
  try {
    ensureAdmin();
    const endpoint = process.env.APPWRITE_FUNCTION_API_ENDPOINT || process.env.APPWRITE_ENDPOINT;
    const projectId = process.env.APPWRITE_FUNCTION_PROJECT_ID || process.env.APPWRITE_PROJECT_ID;
    const apiKey = req.headers['x-appwrite-key'] || process.env.APPWRITE_API_KEY;
    const DB = process.env.APPWRITE_DATABASE_ID || 'workfit';

    const client = new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey);
    const dbs = new Databases(client);

    const event = req.headers['x-appwrite-event'] || '';
    const doc = req.bodyJson || {};

    if (!event.endsWith('.create')) return res.json({ skipped: 'not-create', event });

    let result;
    if (event.includes('.chatMessages.')) {
      result = await handleChatMessage(doc, dbs, DB, log);
    } else if (event.includes('.notifications.')) {
      result = await handleNotification(doc, dbs, DB, log);
    } else {
      result = { skipped: 'unmatched', event };
    }
    return res.json({ ok: true, event, result });
  } catch (e) {
    error(`push function error: ${e.message}`);
    return res.json({ ok: false, error: e.message }, 500);
  }
};
