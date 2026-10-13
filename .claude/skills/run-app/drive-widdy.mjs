/**
 * Widdy(위디) 챗봇 드라이버 — 로그인 → 위디 도크 열기 → 질문 전송 → 응답 캡처.
 * 사전조건: dev 서버(BASE) 기동. playwright-core + 시스템 Chrome.
 *   node .claude/skills/run-app/drive-widdy.mjs
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:3000';
const OUT = process.env.SHOT_DIR ?? './.screenshots';
import { LOGIN_ID, LOGIN_PW } from './login.mjs';
const CHROME = process.env.CHROME ?? (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');

mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log('[widdy]', ...a);

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
// 인증 비활성(VITE_AUTH_ENABLED=false) 환경: 세션에 유효 사용자 id 를 심어
// useAuth().user.id(=Widdy uid, ACL 판정용)가 채워지게 한다. U001=관리자.
await page.addInitScript(() => { try { sessionStorage.setItem('mes.auth.uid', 'U001'); } catch {} });
const shot = (p) => page.screenshot({ path: `${OUT}/${p}`, fullPage: false });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

try {
  // 1) 진입 — 로그인 게이트가 있으면 로그인, 없으면(VITE_AUTH_ENABLED=false) 바로 셸.
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  const userInput = page.locator('input[autocomplete="username"]');
  if (await userInput.count().then((n) => n > 0).catch(() => false) &&
      await userInput.first().isVisible().catch(() => false)) {
    await userInput.first().fill(LOGIN_ID);
    await page.fill('input[autocomplete="current-password"]', LOGIN_PW);
    await page.click('button:has-text("로그인")');
    await page.waitForSelector('input[autocomplete="current-password"]', { state: 'detached', timeout: 20000 }).catch(() => {});
    log('logged in');
  } else {
    log('no login gate (auth disabled) — proceeding to shell');
  }
  await page.waitForSelector('nav', { timeout: 20000 });
  await page.waitForTimeout(1000);

  // 2) 위디 도크 열기 — 상단 위디 버튼 클릭
  const widdyBtn = page.getByRole('button').filter({ hasText: /위디|widdy/i }).first();
  await widdyBtn.click({ timeout: 10000 });
  // ChatbotPanel: 입력창 placeholder 로 패널 렌더 확인
  await page.waitForSelector('input[placeholder="메시지를 입력하세요…"]', { timeout: 15000 });
  await page.waitForTimeout(600);
  await shot('widdy-01-open.png');
  log('widdy dock opened');

  // 3) 질문 입력·전송 (실제 RAG 함수 경유)
  const box = page.locator('input[placeholder="메시지를 입력하세요…"]');
  await box.fill('워크핏 개발 일정 계획서 내용 알려줘');
  await shot('widdy-02-typed.png');
  await page.getByRole('button', { name: '전송' }).click();
  log('question sent — RAG 함수 응답 대기(최대 40s)');

  // 4) 실제 응답 대기 — 타이핑 인디케이터(pending) 사라질 때까지(RAG ~수초~수십초)
  await page.waitForSelector('[aria-label="응답 작성 중"]', { timeout: 8000 }).catch(() => {});
  await page.waitForSelector('[aria-label="응답 작성 중"]', { state: 'detached', timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(1000);
  await shot('widdy-03-answer.png');
  log('answer rendered');

  // 대화 메시지 개수(간이 검증)
  const bubbles = await page.locator('div.whitespace-pre-line').count();
  log('bubble count:', bubbles);
  log('console errors:', errors.length ? JSON.stringify(errors.slice(0, 8)) : 'none');
} catch (e) {
  log('ERROR', e.message);
  await page.screenshot({ path: `${OUT}/widdy-zz-error.png`, fullPage: true }).catch(() => {});
  log('errors:', JSON.stringify(errors.slice(0, 8)));
  process.exitCode = 1;
} finally {
  await browser.close();
}
