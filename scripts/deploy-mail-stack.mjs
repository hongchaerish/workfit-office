/**
 * 메일 스택 Appwrite Function 배포 — `widdy-login`(토큰 발급) + `mail`(계정·IMAP/SMTP).
 *
 * 왜 둘을 같이 올리는가: 메일 Function은 요청자의 신원을 서명 토큰으로만 판단하는데,
 * 그 토큰을 발급하는 게 `widdy-login`이다. 발급자가 없는 프로젝트에 메일만 올리면 모든
 * 요청이 401로 떨어진다. 두 함수는 같은 `AUTH_TOKEN_SECRET`을 써야 서명이 검증된다.
 *
 * ⚠ 함수를 지웠다 다시 만들면 옛 변수가 고아로 남아 같은 키를 다시 못 만든다(409
 *   variable_already_exists, listVariables 에도 안 잡힌다). 키 이름을 바꾸는 것 말고
 *   되살릴 방법을 못 찾았으니 함수 삭제는 피할 것.
 *
 * 실행: node scripts/deploy-mail-stack.mjs [--only=mail|widdy-login] [--prod] [--skip-vars]
 *   --skip-vars : 코드만 올리고 함수 변수는 그대로 둔다. 이미 돌고 있는 운영에 코드 수정만
 *                 반영할 때 쓴다(시크릿을 덮어쓰면 복구가 어렵다).
 *
 * 필요 env (.env.local):
 *   VITE_APPWRITE_ENDPOINT / VITE_APPWRITE_PROJECT_ID / VITE_APPWRITE_DATABASE_ID
 *   APPWRITE_API_KEY (없으면 APPWRITE_API_KEY_DEV) — functions.read/write 스코프 필요
 *   MAIL_CREDENTIALS_KEY  앱 비밀번호 암호화 키(base64url 32바이트)
 *   WIDDY_TOKEN_SECRET    신원 토큰 HMAC 시크릿(두 함수 공통). 함수에는 AUTH_TOKEN_SECRET 으로 올린다.
 *
 * 멱등: 함수가 있으면 갱신하고, 변수도 있으면 갱신한다. 재실행해도 안전하다.
 */
import { readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const { Client, Functions, ID } = await import('node-appwrite');
const { InputFile } = await import('node-appwrite/file');

// ── env ──
const envText = existsSync('.env.local') ? readFileSync('.env.local', 'utf8') : '';
function env(key) {
  if (process.env[key]) return process.env[key];
  const m = envText.match(new RegExp(`^${key}\\s*=\\s*"?([^"\\n]*)"?`, 'm'));
  return m ? m[1].trim() : undefined;
}

const IS_PROD = process.argv.includes('--prod');
/** 코드만 배포하고 함수 변수는 그대로 둔다. 아래 `--skip-vars` 주석 참조. */
const SKIP_VARS = process.argv.includes('--skip-vars');
const ENDPOINT = env('APPWRITE_ENDPOINT') ?? env('VITE_APPWRITE_ENDPOINT');
const PROJECT = IS_PROD
  ? (env('APPWRITE_PROJECT_ID_PROD') ?? '6a6bf85e002acb7f71d6')
  : (env('APPWRITE_PROJECT_ID') ?? env('VITE_APPWRITE_PROJECT_ID'));
const DB_ID = env('APPWRITE_DATABASE_ID') ?? env('VITE_APPWRITE_DATABASE_ID') ?? 'workfit';
// 접미어 없는 키가 없으면 dev 로만 폴백한다 — 기본값이 운영이면 배포 사고가 난다.
const API_KEY = IS_PROD
  ? env('APPWRITE_API_KEY_PROD')
  : (env('APPWRITE_API_KEY') ?? env('APPWRITE_API_KEY_DEV'));
/**
 * 환경별 비밀.
 *
 * `--prod`를 주면 `*_PROD` 접미어 값을 쓴다. dev와 운영이 **같은 키를 쓰면 안 된다** —
 * dev 키가 새면 운영 메일함까지 열린다. 접미어 없는 이름은 dev 용이다.
 */
const PROD = process.argv.includes('--prod');
const MAIL_KEY = PROD ? env('MAIL_CREDENTIALS_KEY_PROD') : env('MAIL_CREDENTIALS_KEY');
const TOKEN_SECRET = PROD ? env('AUTH_TOKEN_SECRET_PROD') : env('WIDDY_TOKEN_SECRET');

// --skip-vars·--status 는 변수를 올리지 않으므로 키·시크릿 없이도 돈다.
const NO_VARS = SKIP_VARS || process.argv.includes('--status');
const missing = Object.entries(NO_VARS ? { ENDPOINT, PROJECT, API_KEY } : { ENDPOINT, PROJECT, API_KEY, MAIL_KEY, TOKEN_SECRET })
  .filter(([, v]) => !v).map(([k]) => k);
if (missing.length) {
  console.error(`✗ 필수 설정 누락: ${missing.join(', ')}`);
  process.exit(1);
}
if (!NO_VARS && Buffer.from(MAIL_KEY, 'base64url').length !== 32) {
  console.error('✗ MAIL_CREDENTIALS_KEY 는 base64url 인코딩된 32바이트여야 합니다.');
  process.exit(1);
}

// ── 배포 대상 ──
const TARGETS = [
  {
    id: 'widdy-login',
    name: 'Widdy Login',
    dir: 'appwrite/functions/widdy-login',
    // users 조회만 한다. 쓰기 스코프를 주지 않는다.
    scopes: ['databases.read', 'documents.read'],
    timeout: 30,
    /*
      두 이름에 같은 값을 넣는다. 저장소 코드는 AUTH_TOKEN_SECRET 을 먼저 보지만, 운영에
      돌고 있는 예전 코드는 WIDDY_TOKEN_SECRET 만 읽는다. 어느 쪽이 떠 있든 맞도록 둘 다 건다.
    */
    vars: { AUTH_TOKEN_SECRET: TOKEN_SECRET, WIDDY_TOKEN_SECRET: TOKEN_SECRET, APPWRITE_DATABASE_ID: DB_ID },
    secrets: ['AUTH_TOKEN_SECRET', 'WIDDY_TOKEN_SECRET'],
  },
  {
    id: 'widdy-chat',
    name: 'Widdy Chat',
    dir: 'appwrite/functions/widdy-chat',
    // RAG 게이트웨이로 나가기만 한다. DB 스코프 없음(운영 실측값과 동일).
    scopes: [],
    timeout: 120,
    /*
      WIDDY_RAG_URL 은 건드리지 않는다 — secret 이라 값을 읽을 수 없고, 변수는 배포와
      무관하게 함수에 남으므로 재배포해도 유지된다. 여기서 덮으면 복구할 방법이 없다.
    */
    vars: { AUTH_TOKEN_SECRET: TOKEN_SECRET, WIDDY_TOKEN_SECRET: TOKEN_SECRET },
    secrets: ['AUTH_TOKEN_SECRET', 'WIDDY_TOKEN_SECRET'],
  },
  {
    id: 'mail',
    name: 'Mail',
    dir: 'appwrite/functions/mail',
    scopes: ['databases.read', 'databases.write', 'documents.read', 'documents.write'],
    // 발송의 SMTP 소켓 타임아웃이 120초라 함수가 그보다 길어야 한다. 함수가 먼저
    // 끊기면 발송이 실제로는 나갔는데 화면에는 실패로 뜨는 최악의 상황이 생긴다.
    timeout: 150,
    vars: {
      MAIL_CREDENTIALS_KEY: MAIL_KEY,
      AUTH_TOKEN_SECRET: TOKEN_SECRET,
      APPWRITE_DATABASE_ID: DB_ID,
      // 주입되는 APPWRITE_FUNCTION_API_ENDPOINT 가 평문 http 라서 POST 가 301 로
      // GET 으로 바뀐다(생성이 조회로 둔갑). https 를 명시해 덮어쓴다.
      // ※ 정적 APPWRITE_API_KEY 는 원인 규명 중의 임시 우회였고 https 확정 후 제거했다.
      //   함수는 스코프 제한된 동적 키(x-appwrite-key)로 붙는다.
      APPWRITE_ENDPOINT: ENDPOINT,
    },
    secrets: ['MAIL_CREDENTIALS_KEY', 'AUTH_TOKEN_SECRET'],
  },
];

// ── 상태 조회 모드 ──
if (process.argv.includes('--status')) {
  const fnStatus = new Functions(
    new (await import('node-appwrite')).Client().setEndpoint(ENDPOINT).setProject(PROJECT).setKey(API_KEY),
  );
  for (const t of TARGETS) {
    try {
      const f = await fnStatus.get({ functionId: t.id });
      const deps = await fnStatus.listDeployments({ functionId: t.id });
      const active = deps.deployments.find((d) => d.$id === f.deploymentId) ?? deps.deployments[0];
      console.log(`[${t.id}] timeout ${f.timeout}s · enabled ${f.enabled}`);
      console.log(`  활성 배포: ${active ? `${active.$id} status=${active.status}` : '없음'}`);
      // 빌드가 깨지면 로그에만 원인이 남는다. 앞부분만 보여 준다.
      if (active && active.status !== 'ready' && active.buildLogs) {
        console.log(`  빌드 로그: ${String(active.buildLogs).slice(0, 600)}`);
      }
    } catch (e) {
      console.log(`[${t.id}] 조회 실패: ${e.message}`);
    }
  }
  process.exit(0);
}

const only = process.argv.find((a) => a.startsWith('--only='))?.split('=')[1];
let targets = only ? TARGETS.filter((t) => t.id === only) : TARGETS;
/*
  운영에서는 `widdy-login`을 기본 대상에서 뺀다. 이미 돌고 있는 토큰 발급자라 시크릿을
  덮으면 사용 중인 Widdy 토큰이 전부 무효화된다. 회전이 필요하면 `--only=widdy-login`
  으로 의도를 명시해야 한다.
*/
if (IS_PROD && !only) targets = targets.filter((t) => !t.id.startsWith('widdy-'));
if (targets.length === 0) {
  console.error(`✗ --only=${only} 에 해당하는 대상이 없습니다.`);
  process.exit(1);
}

const client = new Client().setEndpoint(ENDPOINT).setProject(PROJECT).setKey(API_KEY);
const fn = new Functions(client);
const isCode = (e, c) => e && e.code === c;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 게이트웨이 일시 장애 재시도.
 *
 * 이 인스턴스는 간헐적으로 nginx 504(60초 타임아웃)를 뱉는다. 배포 중간에 한 번 나면
 * 함수만 생기고 변수·코드가 안 올라간 어중간한 상태가 남아 원인 찾기가 번거롭다.
 * 502/503/504만 재시도한다 — 4xx는 재시도해도 같은 결과다.
 */
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

const BUNDLE_DIR = 'appwrite/_deploy_bundles';

/** 함수 디렉터리 → tar.gz. 테스트 파일은 런타임에 쓰지 않으므로 뺀다. */
function bundle(target) {
  if (!existsSync(target.dir)) throw new Error(`디렉터리 없음: ${target.dir}`);
  mkdirSync(BUNDLE_DIR, { recursive: true });
  const out = resolve(BUNDLE_DIR, `${target.id}.tar.gz`);
  rmSync(out, { force: true });
  // `--force-local`이 없으면 GNU tar가 `C:\...`의 콜론을 원격 호스트로 읽어 실패한다.
  execFileSync(
    'tar',
    ['--force-local', '-czf', out, '--exclude=*.test.js', '--exclude=node_modules', '-C', target.dir, '.'],
    { stdio: 'inherit' },
  );
  return out;
}

async function setVar(functionId, key, value, secret) {
  try {
    await retry(`var ${key}`, () => fn.createVariable({ functionId, variableId: ID.unique(), key, value, secret }));
    console.log(`  ✓ var ${key}${secret ? ' (secret)' : ''}`);
  } catch (e) {
    if (!isCode(e, 409)) throw e;
    const list = await retry(`listVariables ${functionId}`, () => fn.listVariables({ functionId }));
    const found = list.variables.find((v) => v.key === key);

    if (!found) {
      /**
       * 고아 변수 — 만들 수도(409) 고칠 수도(목록에 없음) 없는 상태.
       *
       * 함수를 삭제하고 같은 ID로 다시 만들면 옛 변수가 이 상태로 남는다. 값을 확인할
       * 방법이 없어 배포를 멈추는 대신 경고만 남긴다. 함수 코드에 기본값이 있는 키라면
       * 그대로 두어도 되지만, 값이 달라야 하는 키라면 콘솔에서 직접 지워야 한다.
       */
      console.warn(`  ⚠ var ${key} — 고아 변수(생성 409 · 목록에 없음). 콘솔에서 확인 필요, 계속 진행`);
      return;
    }

    await retry(`var ${key} 갱신`, () => fn.updateVariable({ functionId, variableId: found.$id, key, value, secret }));
    console.log(`  • var ${key} 갱신${secret ? ' (secret)' : ''}`);
  }
}

console.log(`▶ ${ENDPOINT} / project ${PROJECT} / db ${DB_ID}${IS_PROD ? '  [운영]' : ''}`);
console.log(`  대상: ${targets.map((t) => t.id).join(', ')}\n`);

for (const t of targets) {
  console.log(`[${t.id}] ${t.name}`);

  const spec = {
    functionId: t.id,
    name: t.name,
    runtime: 'node-22',
    execute: ['any'],
    events: [],
    timeout: t.timeout,
    enabled: true,
    logging: true,
    entrypoint: 'src/main.js',
    commands: 'npm install',
    scopes: t.scopes,
  };

  try {
    await retry(`${t.id} create`, () => fn.create(spec));
    console.log(`  ✓ function 생성 (timeout ${t.timeout}s)`);
  } catch (e) {
    if (!isCode(e, 409)) throw e;
    await retry(`${t.id} update`, () => fn.update(spec));
    console.log(`  • function 존재 → 갱신 (timeout ${t.timeout}s)`);
  }

  /*
    `--skip-vars` — 코드만 올리고 변수는 손대지 않는다.

    이 스크립트는 변수를 **덮어쓴다.** 이미 돌고 있는 운영에 코드 수정만 반영할 때는
    그게 위험하다. `MAIL_CREDENTIALS_KEY`가 어긋나면 등록된 앱 비밀번호가 전부 복호화
    불능이 되고, `AUTH_TOKEN_SECRET`이 어긋나면 발급자(widdy-login)와 서명이 갈려
    모든 요청이 401이 된다. 둘 다 secret이라 API로 현재 값을 읽어 대조할 수 없다.
    값을 바꿀 의도가 없으면 이 플래그를 쓰는 편이 안전하다.
  */
  if (SKIP_VARS) {
    console.log('  • 변수 건드리지 않음 (--skip-vars)');
  } else {
    for (const [key, value] of Object.entries(t.vars)) {
      await setVar(t.id, key, value, t.secrets.includes(key));
    }
  }

  const tar = bundle(t);
  const dep = await retry(`${t.id} deployment`, () => fn.createDeployment({
    functionId: t.id,
    code: InputFile.fromPath(tar, `${t.id}.tar.gz`),
    activate: true,
    entrypoint: 'src/main.js',
    commands: 'npm install',
  }));
  console.log(`  ✓ deployment ${dep.$id} (status=${dep.status})\n`);
}

console.log('배포 요청 완료 — 빌드가 끝나야 실행된다. 상태 확인: node scripts/deploy-mail-stack.mjs --status');
