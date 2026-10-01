/**
 * 업무계획 자동 연동으로 만들어진 캘린더 일정(`[WP-SYNC:…]`) 정리.
 * (docs/업무계획_회의등록_구현계획서.md §4.6 — 결정 h: 전부 삭제)
 *
 * 2026-10-01 자동 연동을 중단해 이 일정들은 더 이상 갱신되지 않는 낡은 사본이고, 중복도 쌓여 있다.
 * 원문은 업무계획 본문에 그대로 남아 있으므로 지워도 내용이 사라지지 않는다.
 *
 * 실행:
 *   npx tsx scripts/cleanup-workplan-sync-events.ts            # 개발, 건수·목록만(dry-run)
 *   npx tsx scripts/cleanup-workplan-sync-events.ts --apply    # 개발, 백업 후 삭제
 *   npx tsx scripts/cleanup-workplan-sync-events.ts --prod     # 운영 dry-run
 *   npx tsx scripts/cleanup-workplan-sync-events.ts --prod --apply   # 운영 삭제(별도 승인 후)
 *
 * 삭제 전 대상 원본을 migration-backup/ (gitignore)에 JSON으로 남긴다.
 * 대상은 메모에 `[WP-SYNC:` 태그가 있는 일정뿐이다 — 사람이 직접 만든 일정은 건드리지 않는다.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client, Databases, Query } from 'node-appwrite';

const IS_PROD = process.argv.includes('--prod');
const APPLY = process.argv.includes('--apply');

const envText = existsSync('.env.local') ? readFileSync('.env.local', 'utf8') : '';
function env(key: string): string | undefined {
  if (process.env[key]) return process.env[key];
  const m = envText.match(new RegExp(`^${key}\\s*=\\s*"?([^"\\n]*)"?`, 'm'));
  return m ? m[1].trim() : undefined;
}

const ENDPOINT = env('APPWRITE_ENDPOINT') ?? env('VITE_APPWRITE_ENDPOINT');
const PROJECT = IS_PROD
  ? (env('APPWRITE_PROJECT_ID_PROD') ?? '6a6bf85e002acb7f71d6')
  : (env('APPWRITE_PROJECT_ID') ?? env('VITE_APPWRITE_PROJECT_ID'));
const API_KEY = IS_PROD ? env('APPWRITE_API_KEY_PROD') : (env('APPWRITE_API_KEY') ?? env('APPWRITE_API_KEY_DEV'));
const DB = env('APPWRITE_DATABASE_ID') ?? env('VITE_APPWRITE_DATABASE_ID') ?? 'workfit';
const COLL = 'calendarEvents';
const SYNC_TAG = /\[WP-SYNC:([^:\]]+):(\d+)\]/;

if (!ENDPOINT || !PROJECT || !API_KEY) {
  console.error('✗ 필수 설정 누락(ENDPOINT/PROJECT/API_KEY) — .env.local 확인');
  process.exit(1);
}

const dbs = new Databases(new Client().setEndpoint(ENDPOINT).setProject(PROJECT).setKey(API_KEY));

interface Row {
  $id: string;
  ownerUserId?: string;
  title?: string;
  date?: string;
  memo?: string;
  [key: string]: unknown;
}

async function loadAll(): Promise<Row[]> {
  const out: Row[] = [];
  for (let offset = 0; ; offset += 100) {
    const page = await dbs.listDocuments(DB, COLL, [Query.limit(100), Query.offset(offset)]);
    out.push(...(page.documents as unknown as Row[]));
    if (page.documents.length < 100) break;
  }
  return out;
}

async function main() {
  console.log(`▶ ${IS_PROD ? '운영' : '개발'} ${ENDPOINT} / project ${PROJECT} / ${COLL} — ${APPLY ? '삭제 실행' : 'dry-run'}`);
  const all = await loadAll();
  const targets = all.filter((r) => SYNC_TAG.test(String(r.memo ?? '')));

  // 같은 계획·같은 줄 번호로 여러 건 = 중복
  const byKey = new Map<string, Row[]>();
  for (const r of targets) {
    const m = String(r.memo).match(SYNC_TAG)!;
    const key = `${m[1]}:${m[2]}`;
    byKey.set(key, [...(byKey.get(key) ?? []), r]);
  }
  const duplicateExtra = [...byKey.values()].reduce((n, rows) => n + Math.max(0, rows.length - 1), 0);

  console.log(`  전체 일정 ${all.length}건 중 업무계획 연동 일정 ${targets.length}건`);
  console.log(`  (계획·줄 기준 ${byKey.size}묶음, 그중 중복으로 더 생긴 것 ${duplicateExtra}건)`);
  for (const r of targets.slice(0, 15)) console.log(`   - ${r.$id}  ${r.date}  ${r.title}  (소유 ${r.ownerUserId})`);
  if (targets.length > 15) console.log(`   … 외 ${targets.length - 15}건`);

  if (!APPLY) {
    console.log('\n※ dry-run — 삭제하지 않았습니다. 지우려면 --apply');
    return;
  }
  if (targets.length === 0) {
    console.log('\n삭제할 일정이 없습니다.');
    return;
  }

  const dir = resolve('migration-backup');
  mkdirSync(dir, { recursive: true });
  const backup = resolve(dir, `wp-sync-events-${IS_PROD ? 'prod' : 'dev'}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(backup, JSON.stringify(targets, null, 2), 'utf8');
  console.log(`\n  백업: ${backup}`);

  let ok = 0;
  let failed = 0;
  for (const r of targets) {
    try {
      await dbs.deleteDocument(DB, COLL, r.$id);
      ok++;
    } catch (e) {
      failed++;
      console.error(`  ✗ ${r.$id}: ${(e as Error).message}`);
    }
  }
  console.log(`\n✅ 삭제 ${ok}건${failed ? `, 실패 ${failed}건(백업 파일로 복구 가능)` : ''}`);
}

main().catch((e) => {
  console.error('✗ 실패:', e instanceof Error ? e.message : e);
  process.exit(1);
});
