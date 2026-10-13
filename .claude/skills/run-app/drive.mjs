/**
 * WorkfitOffice 앱 스모크 드라이버 — 로그인 후 조직도·사용자관리를 캡처.
 *
 * 사전조건: dev 서버가 BASE(기본 http://localhost:3000)에서 떠 있어야 함.
 *   npm run dev &   (포트 3000, vite.config.ts)
 *
 * playwright-core + 시스템 Chrome 사용(브라우저 다운로드 불필요):
 *   npm i -D playwright-core --no-save
 *   node .claude/skills/run-app/drive.mjs
 *
 * 환경변수(선택):
 *   BASE       기본 http://localhost:3000
 *   SHOT_DIR   스크린샷 저장 경로(기본 ./.screenshots — gitignore 권장)
 *   LOGIN_ID   기본: login.local.json → seed seunggi.kim@workfit.co.kr
 *   LOGIN_PW   기본: login.local.json → seed mes1234
 *   CHROME     Chrome 실행 파일 경로(기본 macOS Google Chrome)
 *
 * ⚠ 인증 세션이 인메모리라, 로그인 후 전체 새로고침(page.goto)을 하면 로그아웃되어
 *   로그인 화면으로 튕긴다. /gw/* 딥링크 goto 는 세션이 유지되지만, /base/* 등 일부
 *   경로는 앱 내 클릭(SPA 네비게이션)으로 이동해야 안전하다. 아래처럼 상단 메뉴를 클릭한다.
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:3000';
const OUT = process.env.SHOT_DIR ?? './.screenshots';
import { LOGIN_ID, LOGIN_PW } from './login.mjs';
const CHROME = process.env.CHROME ?? (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');

mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log('[drive]', ...a);

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const shot = (p) => page.screenshot({ path: `${OUT}/${p}`, fullPage: true });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

try {
  // 1) 로그인 — 단일 ID(사번 또는 이메일) + 비밀번호
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[autocomplete="username"]', { timeout: 20000 });
  await page.fill('input[autocomplete="username"]', LOGIN_ID);
  await page.fill('input[autocomplete="current-password"]', LOGIN_PW);
  await page.click('button:has-text("로그인")');
  await page.waitForSelector('input[autocomplete="current-password"]', { state: 'detached', timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1200);
  log('logged in');

  // 2) 조직도 — /gw/* 딥링크는 goto 로 세션 유지됨
  await page.goto(`${BASE}/gw/orgchart`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('text=조직도', { timeout: 20000 });
  await page.waitForTimeout(1500);
  // AX사업본부 펼치기 → S/W 개발팀 선택(직책·직급 확인)
  const hqToggle = page.locator('div:has(> span.truncate:text-is("AX사업본부")) > button').first();
  if (await hqToggle.count()) { await hqToggle.click(); await page.waitForTimeout(700); }
  await shot('01-orgchart.png');
  const sw = page.locator('span.truncate:text-is("S/W 개발팀")').first();
  if (await sw.count()) { await sw.click(); await page.waitForTimeout(800); await shot('02-orgchart-team.png'); }
  log('orgchart captured');

  // 3) 사용자관리 — 앱 내 클릭 이동(전체 새로고침 금지: 세션 유지)
  await page.click('text=기준 정보');
  await page.waitForTimeout(700);
  await page.locator('text=사용자관리').first().click();
  await page.waitForSelector('h1:has-text("사용자관리")', { timeout: 20000 });
  await page.waitForTimeout(1200);
  await shot('03-user-list.png');
  log('user management captured');

  log('console errors:', errors.length ? JSON.stringify(errors.slice(0, 8)) : 'none');
  log('screenshots in', OUT);
} catch (e) {
  log('ERROR', e.message);
  await page.screenshot({ path: `${OUT}/zz-error.png`, fullPage: true }).catch(() => {});
  log('errors:', JSON.stringify(errors.slice(0, 8)));
  process.exitCode = 1;
} finally {
  await browser.close();
}
