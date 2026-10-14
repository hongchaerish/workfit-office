/**
 * 전자설문 Appwrite Function(`survey`) 배포 — esbuild 번들 → tar.gz → 배포.
 *
 * 규칙의 정본(`server/survey/**`, `src/domain/**`)을 그대로 묶어 올린다. 다른 함수처럼
 * 규칙을 JS 로 다시 적지 않으므로, 앱과 서버의 검사가 어긋나지 않는다.
 *
 * 실행: node scripts/deploy-survey.mjs [--prod] [--skip-vars] [--status]
 *   --prod      : 운영 프로젝트. **사용자 확인 후에만** 실행한다.
 *   --skip-vars : 코드만 올리고 함수 변수는 그대로 둔다(운영 코드 수정 반영 시).
 *   --status    : 배포 상태만 본다.
 *
 * 필요 env (.env.local):
 *   VITE_APPWRITE_ENDPOINT / VITE_APPWRITE_PROJECT_ID / VITE_APPWRITE_DATABASE_ID
 *   APPWRITE_API_KEY (dev, functions.read/write 스코프) · APPWRITE_API_KEY_PROD (--prod)
 *   WIDDY_TOKEN_SECRET (dev) · AUTH_TOKEN_SECRET_PROD (--prod) — widdy-login 과 같은 값
 *
 * 멱등: 함수가 있으면 갱신하고, 변수도 있으면 갱신한다.
 */
import { readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { build } from 'esbuild';

const { Client, Functions, ID } = await import('node-appwrite');
const { InputFile } = await import('node-appwrite/file');

const envText = existsSync('.env.local') ? readFileSync('.env.local', 'utf8') : '';
function env(key) {
  if (process.env[key]) return process.env[key];
  const m = envText.match(new RegExp(`^${key}\\s*=\\s*"?([^"\\n]*)"?`, 'm'));
  return m ? m[1].trim() : undefined;
}

const IS_PROD = process.argv.includes('--prod');
const SKIP_VARS = process.argv.includes('--skip-vars');
const ENDPOINT = env('APPWRITE_ENDPOINT') ?? env('VITE_APPWRITE_ENDPOINT');
const PROJECT = IS_PROD
  ? (env('APPWRITE_PROJECT_ID_PROD') ?? '6a6bf85e002acb7f71d6')
  : (env('APPWRITE_PROJECT_ID') ?? env('VITE_APPWRITE_PROJECT_ID'));
const DB_ID = env('APPWRITE_DATABASE_ID') ?? env('VITE_APPWRITE_DATABASE_ID') ?? 'workfit';
// 접미어 없는 키가 없으면 dev 로만 폴백한다 — 기본값이 운영이면 배포 사고가 난다.
const API_KEY = IS_PROD ? env('APPWRITE_API_KEY_PROD') : (env('APPWRITE_API_KEY') ?? env('APPWRITE_API_KEY_DEV'));
const TOKEN_SECRET = IS_PROD ? env('AUTH_TOKEN_SECRET_PROD') : env('WIDDY_TOKEN_SECRET');

const missing = Object.entries({ ENDPOINT, PROJECT, API_KEY, TOKEN_SECRET }).filter(([, v]) => !v).map(([k]) => k);
if (missing.length) {
  console.error(`✗ 필수 설정 누락: ${missing.join(', ')}`);
  process.exit(1);
}

const FUNCTION_ID = 'survey';
const DIR = 'appwrite/functions/survey';
const ENTRY = 'dist/main.js';
const client = new Client().setEndpoint(ENDPOINT).setProject(PROJECT).setKey(API_KEY);
const fn = new Functions(client);
const isCode = (e, c) => e && e.code === c;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 게이트웨이 일시 장애(502/503/504)만 재시도한다. */
async function retry(label, task, attempts = 3) {
  for (let i = 1; ; i += 1) {
    try {
      return await task();
    } catch (e) {
      const transient = [502, 503, 504].includes(e?.code);
      if (!transient || i >= attempts) throw e;
      console.log(`  … ${label} ${e.code} — ${i}/${attempts - 1} 재시도`);
      await sleep(3000 * i);
    }
  }
}

if (process.argv.includes('--status')) {
  const f = await fn.get({ functionId: FUNCTION_ID });
  const deps = await fn.listDeployments({ functionId: FUNCTION_ID });
  const active = deps.deployments.find((d) => d.$id === f.deploymentId) ?? deps.deployments[0];
  console.log(`[${FUNCTION_ID}] timeout ${f.timeout}s · enabled ${f.enabled}`);
  console.log(`  활성 배포: ${active ? `${active.$id} status=${active.status}` : '없음'}`);
  if (active && active.status !== 'ready' && active.buildLogs) console.log(`  빌드 로그: ${String(active.buildLogs).slice(0, 600)}`);
  process.exit(0);
}

// ── 1) 번들 ──
await build({
  entryPoints: [`${DIR}/src/main.ts`],
  outfile: `${DIR}/${ENTRY}`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  alias: { '@': resolve('src') },
  // ESM 번들 안의 CJS 의존성이 require 를 찾을 수 있게 한다.
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
  logLevel: 'info',
});

// ── 2) tar.gz — 번들과 package.json 만 ──
const BUNDLE_DIR = 'appwrite/_deploy_bundles';
mkdirSync(BUNDLE_DIR, { recursive: true });
const tar = resolve(BUNDLE_DIR, `${FUNCTION_ID}.tar.gz`);
rmSync(tar, { force: true });
// `--force-local`이 없으면 GNU tar가 `C:\...`의 콜론을 원격 호스트로 읽어 실패한다.
execFileSync('tar', ['--force-local', '-czf', tar, '-C', DIR, 'dist', 'package.json'], { stdio: 'inherit' });

// ── 3) 함수·변수·배포 ──
console.log(`▶ ${ENDPOINT} / project ${PROJECT} / db ${DB_ID}${IS_PROD ? '  [운영]' : ''}`);
const spec = {
  functionId: FUNCTION_ID,
  name: 'Survey',
  runtime: 'node-22',
  execute: ['any'],
  events: [],
  timeout: 30,
  enabled: true,
  logging: true,
  entrypoint: ENTRY,
  commands: '',
  scopes: ['databases.read', 'documents.read', 'documents.write'],
};
try {
  await retry('create', () => fn.create(spec));
  console.log('  ✓ function 생성');
} catch (e) {
  if (!isCode(e, 409)) throw e;
  await retry('update', () => fn.update(spec));
  console.log('  • function 존재 → 갱신');
}

async function setVar(key, value, secret) {
  try {
    await retry(`var ${key}`, () => fn.createVariable({ functionId: FUNCTION_ID, variableId: ID.unique(), key, value, secret }));
    console.log(`  ✓ var ${key}${secret ? ' (secret)' : ''}`);
  } catch (e) {
    if (!isCode(e, 409)) throw e;
    const list = await retry('listVariables', () => fn.listVariables({ functionId: FUNCTION_ID }));
    const found = list.variables.find((v) => v.key === key);
    if (!found) {
      console.warn(`  ⚠ var ${key} — 고아 변수(생성 409 · 목록에 없음). 콘솔에서 확인 필요, 계속 진행`);
      return;
    }
    await retry(`var ${key} 갱신`, () => fn.updateVariable({ functionId: FUNCTION_ID, variableId: found.$id, key, value, secret }));
    console.log(`  • var ${key} 갱신${secret ? ' (secret)' : ''}`);
  }
}

if (SKIP_VARS) {
  console.log('  • 변수 건드리지 않음 (--skip-vars)');
} else {
  await setVar('AUTH_TOKEN_SECRET', TOKEN_SECRET, true);
  await setVar('APPWRITE_DATABASE_ID', DB_ID, false);
  // 주입되는 APPWRITE_FUNCTION_API_ENDPOINT 가 평문 http 라 POST 가 GET 으로 바뀐다 — https 를 명시한다.
  await setVar('APPWRITE_ENDPOINT', ENDPOINT, false);
}

const dep = await retry('deployment', () => fn.createDeployment({
  functionId: FUNCTION_ID,
  code: InputFile.fromPath(tar, `${FUNCTION_ID}.tar.gz`),
  activate: true,
  entrypoint: ENTRY,
  commands: '',
}));
console.log(`  ✓ deployment ${dep.$id} (status=${dep.status})`);

// 빌드가 끝날 때까지 기다린다(최대 3분).
for (let i = 0; i < 36; i += 1) {
  const d = await retry('getDeployment', () => fn.getDeployment({ functionId: FUNCTION_ID, deploymentId: dep.$id }));
  if (d.status === 'ready') { console.log('  ✓ 빌드 완료 — status=ready'); process.exit(0); }
  if (d.status === 'failed') { console.error(`  ✗ 빌드 실패\n${String(d.buildLogs).slice(0, 1200)}`); process.exit(1); }
  await sleep(5000);
}
console.warn('  … 아직 빌드 중 — node scripts/deploy-survey.mjs --status 로 확인');
