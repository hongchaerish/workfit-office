import crypto from 'node:crypto';

/**
 * widdy-login 서명 토큰 → uid. 위조·만료·형식 오류는 ''.
 *
 * 형식: `base64url({uid, exp})` + "." + `hex(hmac_sha256(payload, secret))`
 * 규칙은 `appwrite/functions/mail/src/token.js` 와 같다. 설문은 익명 요청을 받지 않으므로
 * 호출부가 '' 를 반드시 401로 다룬다.
 */
export function verifyToken(token: string, secret: string, nowSec = Math.floor(Date.now() / 1000)): string {
  if (!token || !secret) return '';
  const dot = token.lastIndexOf('.');
  if (dot < 0) return '';

  const payloadPart = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(crypto.createHmac('sha256', secret).update(payloadPart).digest('hex'));
  // 타이밍 안전 비교. 길이가 다르면 timingSafeEqual 이 던지므로 먼저 거른다.
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return '';

  try {
    const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf-8')) as { uid?: string; exp?: number };
    if (payload.exp && nowSec > payload.exp) return '';
    return String(payload.uid || '');
  } catch {
    return '';
  }
}
