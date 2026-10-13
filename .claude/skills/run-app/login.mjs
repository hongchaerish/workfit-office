/**
 * run-app 드라이버 공용 로그인 정보.
 * 우선순위: 환경변수 LOGIN_ID/LOGIN_PW → login.local.json(gitignore, 관리자 계정) → seed 기본값.
 * login.local.json 형식: { "id": "...", "pw": "..." }
 */
import { readFileSync } from 'node:fs';

let local = {};
try {
  local = JSON.parse(readFileSync(new URL('./login.local.json', import.meta.url), 'utf8'));
} catch {
  /* 파일 없음 — seed 기본값 사용 */
}

export const LOGIN_ID = process.env.LOGIN_ID ?? local.id ?? 'seunggi.kim@workfit.co.kr';
export const LOGIN_PW = process.env.LOGIN_PW ?? local.pw ?? 'mes1234';
