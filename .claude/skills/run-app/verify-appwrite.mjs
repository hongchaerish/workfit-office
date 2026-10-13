/**
 * Appwrite 연결 검증 — 데모(memory)가 아니라 실제 Appwrite dev에서 읽는지 확인한다.
 *
 * 로그인 게이트를 통과한 뒤 THEIRS 화면(조직도)과 업무 모듈 5종을 차례로 열고,
 * 화면마다 **어느 컬렉션에 요청이 나갔는지**를 집계한다. 컬렉션 이름이 찍히는 것이
 * "그 repo가 실제로 Appwrite를 읽는다"는 증거다. 요청 0건이면 아직 미배선이다.
 *
 * 데이터가 비어 있어 화면이 "0건"으로 뜨는 것은 정상이다. 판정 기준은
 * (1) 해당 컬렉션에 요청이 나갔는가 (2) 콘솔 에러 없이 렌더됐는가 두 가지다.
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:3000';
const SHOT_DIR = process.env.SHOT_DIR ?? './.screenshots';
const CHROME = process.env.CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
import { LOGIN_ID, LOGIN_PW } from './login.mjs';

/**
 * 업무 모듈 → 그 화면이 **첫 진입에** 읽어야 하는 컬렉션.
 *
 * 주의: 목록 화면만 열어서는 안 나가는 요청이 있다. 업무관리의 workPhases/workTasks 는
 * `useProjectWbs` 훅이 담당해서 **프로젝트 상세로 들어가야** 비로소 나가고, 근태의
 * attendance 는 직원을 골라야 나간다. 그래서 그 둘은 기대값에서 뺐다(2026-08-18 실측 확인:
 * 상세 보기 클릭 시 workPhases:200, workTasks:200 정상).
 *
 * 근태의 employees 는 서버 전용 권한(permissions:[])이라 브라우저 익명 클라이언트에서
 * **401 이 나는 것이 현재 설계상 정상**이다. Appwrite Auth 나 서버 경유 조회 도입 전까지 그렇다.
 */
const MODULES = [
  { slug: 'calendar', name: '일정관리', expect: ['calendarEvents'] },
  { slug: 'resource', name: '자원예약', expect: ['resources', 'resourceReservations'] },
  { slug: 'task', name: '업무관리', expect: ['workProjects'] },
  { slug: 'survey', name: '전자설문', expect: ['surveys', 'surveyQuestions'] },
  { slug: 'commute', name: '근태', expect: ['employees'], expectAuthFail: true },
];

mkdirSync(SHOT_DIR, { recursive: true });

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

let errors = [];
let calls = []; // {coll, status}
const seenColl = () => [...new Set(calls.map((c) => c.coll))];

page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('response', (r) => {
  const u = r.url();
  if (!u.includes('appwrite')) return;
  // .../databases/<db>/collections/<coll>/documents...
  const m = u.match(/\/collections\/([^/?]+)/);
  calls.push({ coll: m ? m[1] : '(기타)', status: r.status() });
});

// ── 로그인 ──
await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(1500);

const gateText = await page.evaluate(() => document.body.innerText);
if (/로그인|아이디|사번/.test(gateText) && gateText.length < 900) {
  const inputs = await page.$$('input');
  if (inputs.length >= 2) {
    await inputs[0].fill(LOGIN_ID);
    await inputs[1].fill(LOGIN_PW);
    const btn = (await page.$('button[type=submit]')) ?? (await page.$$('button'))[0];
    if (btn) await btn.click();
    await page.waitForTimeout(3500);
  }
  const after = await page.evaluate(() => document.body.innerText);
  const stillGate = /로그인/.test(after) && after.length < 900;
  console.log(`로그인: ${stillGate ? '실패(게이트 유지)' : '성공'}`);
  if (stillGate) {
    console.log(`  화면: ${after.trim().slice(0, 200).replace(/\s+/g, ' ')}`);
    await page.screenshot({ path: `${SHOT_DIR}/aw-00-login-failed.png` });
    await browser.close();
    process.exit(1);
  }
} else {
  console.log('로그인 게이트 없음 (VITE_AUTH_ENABLED=false 이거나 이미 세션)');
}
await page.screenshot({ path: `${SHOT_DIR}/aw-01-shell.png` });

// ── 기준점: THEIRS 화면이 Appwrite를 읽는가 ──
calls = []; errors = [];
await page.goto(`${BASE}/gw/orgchart`, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${SHOT_DIR}/aw-02-orgchart.png` });
console.log(`\n[기준점] 조직도 — Appwrite 요청 ${calls.length}건: ${seenColl().join(', ') || '없음'}`);
if (errors.length) console.log(`  콘솔 에러 ${errors.length}건`);

// ── 업무 모듈 5종 ──
const report = [];
for (const mod of MODULES) {
  calls = []; errors = [];
  await page.goto(`${BASE}/gw/${mod.slug}`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOT_DIR}/aw-03-${mod.slug}.png` });

  const hit = seenColl();
  const bad = calls.filter((c) => c.status >= 400);
  const missing = mod.expect.filter((e) => !hit.includes(e));
  const text = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').trim();

  report.push({ mod, hit, bad, missing, errors: [...errors], text });

  console.log(`\n[${mod.name}] /gw/${mod.slug}`);
  console.log(`  요청 ${calls.length}건 → ${hit.join(', ') || '(Appwrite 요청 없음)'}`);
  if (bad.length) {
    const by = {};
    for (const b of bad) (by[`${b.coll} ${b.status}`] ??= 0), by[`${b.coll} ${b.status}`]++;
    console.log(`  ⚠ 실패 응답: ${Object.entries(by).map(([k, v]) => `${k} x${v}`).join(', ')}`);
  }
  if (missing.length) console.log(`  ⚠ 기대했으나 요청 없음: ${missing.join(', ')}`);
  if (errors.length) {
    console.log(`  ⚠ 콘솔 에러 ${errors.length}건`);
    for (const e of [...new Set(errors)].slice(0, 3)) console.log(`      - ${e.slice(0, 180)}`);
  }
  console.log(`  화면: ${text.slice(0, 110)}`);
}

// ── 요약 ──
console.log('\n' + '='.repeat(68));
console.log('요약  (OK = 기대 컬렉션 전부 요청됨 + 4xx/5xx 없음 + 콘솔 에러 없음)');
console.log('='.repeat(68));
let pass = 0;
for (const r of report) {
  // 근태는 401 이 예상된 결과다 — 컬렉션에 요청이 나갔다는 것 자체가 배선 증거다.
  const authFailOnly = r.mod.expectAuthFail && r.bad.every((b) => b.status === 401);
  const ok = r.missing.length === 0 && (r.bad.length === 0 || authFailOnly)
    && (r.errors.length === 0 || authFailOnly);
  if (ok) pass++;
  const note = ok && authFailOnly ? '  (401 = 서버 전용 권한, 설계상 정상)' : '';
  console.log(`  ${ok ? 'OK ' : '!! '} ${r.mod.name.padEnd(6)} /gw/${r.mod.slug.padEnd(9)} ${r.hit.join(', ') || '요청 없음'}${note}`);
}
console.log(`\n${pass}/${report.length} 통과`);

await browser.close();
