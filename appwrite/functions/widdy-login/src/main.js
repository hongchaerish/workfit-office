/**
 * Appwrite Function — widdy-login: 자격증명 검증 → HMAC 서명 토큰 발급.
 * ([[Widdy_RAG_연계_개발_계획서.md]] uid 하드닝)
 *
 * 목적: Widdy 는 ACL 판정에 uid 를 쓰는데, 브라우저가 uid 를 자유로이 주장하면 위조=우회.
 *   이 함수가 서버측에서 비밀번호를 검증하고, uid 를 담은 '위조 불가 서명 토큰'을 발급한다.
 *   widdy-chat 이 그 토큰의 HMAC 서명을 검증해 신뢰된 uid 를 얻는다(클라이언트는 서명 못 함).
 *
 *   요청:  POST { loginId, password }
 *   응답:  { token, uid, name }   (token = base64url(payload).hex(hmac))
 *          payload = { uid, exp }  (exp: unix초, 기본 12h)
 *
 * env(함수 설정):
 *   WIDDY_TOKEN_SECRET   ★HMAC 시크릿(widdy-chat 과 동일). 강한 랜덤.
 *   APPWRITE_DATABASE_ID 기본 'workfit'
 * scopes: databases.read, documents.read (users 조회용, 동적 키 x-appwrite-key 사용)
 *
 * ※ 비밀번호 해시는 앱과 동일: SHA-256 hex(무염). (src/shared/lib/crypto.ts)
 */
import { Client, Databases, Query } from 'node-appwrite';
import crypto from 'crypto';
import { findLoginUser } from './match.js';

/**
 * 발급 토큰의 서명 키.
 *
 * 이 토큰은 이제 Widdy 전용이 아니다 — 메일 Function도 같은 토큰으로 요청자를 확인한다.
 * 그래서 중립적인 `AUTH_TOKEN_SECRET`을 먼저 보고, 기존 배포가 깨지지 않도록
 * `WIDDY_TOKEN_SECRET`으로 폴백한다. 둘 중 어느 쪽이든 검증하는 함수와 값이 같아야 한다.
 */
const SECRET = process.env.AUTH_TOKEN_SECRET || process.env.WIDDY_TOKEN_SECRET || '';
const DB = process.env.APPWRITE_DATABASE_ID || 'workfit';
const TTL = Number(process.env.WIDDY_TOKEN_TTL || 43200); // 초, 기본 12h

const sha256hex = (s) => crypto.createHash('sha256').update(s).digest('hex');

function sign(payload) {
  const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(p).digest('hex');
  return `${p}.${sig}`;
}

export default async ({ req, res, log, error }) => {
  try {
    if (!SECRET) return res.json({ error: 'server not configured' }, 500);
    const body = req.bodyJson || {};
    const loginId = String(body.loginId || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!loginId || !password) return res.json({ error: 'loginId/password 필요' }, 400);

    const endpoint = process.env.APPWRITE_FUNCTION_API_ENDPOINT || process.env.APPWRITE_ENDPOINT;
    const projectId = process.env.APPWRITE_FUNCTION_PROJECT_ID || process.env.APPWRITE_PROJECT_ID;
    const apiKey = req.headers['x-appwrite-key'] || process.env.APPWRITE_API_KEY;
    const dbs = new Databases(new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey));

    // 앱 로그인과 같은 규칙(사번·ID·이메일·이메일 앞부분)으로 찾는다(사용자 수 적음 → 전체 로드 후 매칭)
    const list = await dbs.listDocuments(DB, 'users', [Query.limit(100)]);
    const user = findLoginUser(list.documents, loginId);
    if (!user) return res.json({ error: '인증 실패' }, 401);
    if (user.status === '잠금' || user.status === '미사용') return res.json({ error: '계정 사용 불가' }, 403);
    if (user.password !== sha256hex(password)) return res.json({ error: '인증 실패' }, 401);

    const uid = user.id || user.$id;
    const exp = Math.floor(Date.now() / 1000) + TTL;
    return res.json({ token: sign({ uid, exp }), uid, name: user.name || '' });
  } catch (e) {
    error('widdy-login: ' + e.message);
    return res.json({ error: '로그인 처리 오류' }, 500);
  }
};
