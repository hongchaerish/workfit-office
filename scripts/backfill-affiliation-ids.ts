/**
 * 인명관리 소속 ID 채우기 — 지금 저장된 이름으로 기준정보 ID를 찾아 **새 칸에만** 쓴다.
 * ([[docs/superpowers/specs/2026-10-19-affiliation-ids-design.md]] §7)
 *
 *   npx tsx scripts/backfill-affiliation-ids.ts            # 개발 DB, 확인만
 *   npx tsx scripts/backfill-affiliation-ids.ts --apply    # 개발 DB, 적용
 *   npx tsx scripts/backfill-affiliation-ids.ts --prod     # 운영 DB, 확인만
 *   npx tsx scripts/backfill-affiliation-ids.ts --prod --apply
 *
 * - employeeProfiles: deptId·positionId·jobTitleId 가 모두 비어 있는 프로필만. 이름은 프로필 → 없으면 계정.
 * - departmentMembers: jobTitleId 가 비어 있고 직책 이름이 있는 행만.
 * - 보내는 칸은 새 ID 칸뿐이다(Appwrite updateDocument 는 보낸 칸만 고친다). 이미 ID가 있으면 건드리지 않는다.
 * - 못 찾은 이름은 비워 두고 목록으로 알린다(읽을 때 미지정·사원·빈칸 규칙).
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client, Databases, Query, type Models } from 'node-appwrite';

const isProd = process.argv.includes('--prod');
const apply = process.argv.includes('--apply');

function readEnv(key: string): string | undefined {
  if (process.env[key]) return process.env[key];
  const p = resolve(process.cwd(), '.env.local');
  if (!existsSync(p)) return undefined;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(new RegExp(`^${key}\\s*=\\s*"?([^"#]*)"?`));
    if (m) return m[1].trim();
  }
  return undefined;
}

const endpoint = readEnv('APPWRITE_ENDPOINT') ?? readEnv('VITE_APPWRITE_ENDPOINT');
const projectId = isProd ? '6a6bf85e002acb7f71d6' : (readEnv('APPWRITE_PROJECT_ID') ?? readEnv('VITE_APPWRITE_PROJECT_ID'));
const apiKey = isProd ? readEnv('APPWRITE_API_KEY_PROD') : (readEnv('APPWRITE_API_KEY_DEV') ?? readEnv('APPWRITE_API_KEY'));
const DB = readEnv('APPWRITE_DATABASE_ID') ?? readEnv('VITE_APPWRITE_DATABASE_ID') ?? 'workfit';
if (!endpoint || !projectId || !apiKey) throw new Error('Appwrite 접속 정보가 .env.local 에 없습니다.');

const dbs = new Databases(new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey));
type Doc = Models.Document & Record<string, unknown>;

async function listAll(coll: string): Promise<Doc[]> {
  const out: Doc[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await dbs.listDocuments(DB, coll, [Query.limit(100), ...(cursor ? [Query.cursorAfter(cursor)] : [])]);
    out.push(...(page.documents as Doc[]));
    if (page.documents.length < 100) return out;
    cursor = page.documents[page.documents.length - 1].$id;
  }
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

async function main() {
  console.log(`[${isProd ? '운영' : '개발'} DB] ${apply ? '적용' : '확인만'} — ${DB}`);
  const [depts, positions, jobTitles, users, profiles, members] = await Promise.all(
    ['departments', 'positions', 'jobTitles', 'users', 'employeeProfiles', 'departmentMembers'].map(listAll),
  );
  const idByName = (list: Doc[], name: string) => (name ? list.find((x) => str(x.name) === name)?.$id ?? null : null);
  const userById = new Map(users.map((u) => [u.$id, u]));
  const missing: string[] = [];
  let profileCount = 0;
  let memberCount = 0;

  for (const p of profiles) {
    if (p.deptId || p.positionId || p.jobTitleId) continue; // 이미 채워짐
    const u = userById.get(str(p.userId));
    const who = str(p.name) || str(u?.name) || p.$id;
    const deptName = str(p.dept) || str(u?.dept);
    const positionName = str(p.position) || str(u?.position);
    const jobTitleName = str(p.jobTitle) || str(u?.jobTitle);
    const patch = {
      deptId: idByName(depts, deptName),
      positionId: idByName(positions, positionName),
      jobTitleId: idByName(jobTitles, jobTitleName),
    };
    if (deptName && !patch.deptId) missing.push(`${who}: 부서 '${deptName}'`);
    if (positionName && !patch.positionId) missing.push(`${who}: 직급 '${positionName}'`);
    if (jobTitleName && !patch.jobTitleId) missing.push(`${who}: 직책 '${jobTitleName}'`);
    if (!patch.deptId && !patch.positionId && !patch.jobTitleId) continue;
    profileCount++;
    console.log(`  프로필 ${who}: 부서 ${deptName || '-'}→${patch.deptId ?? '없음'}, 직급 ${positionName || '-'}→${patch.positionId ?? '없음'}, 직책 ${jobTitleName || '-'}→${patch.jobTitleId ?? '없음'}`);
    if (apply) await dbs.updateDocument(DB, 'employeeProfiles', p.$id, patch);
  }

  for (const m of members) {
    if (m.jobTitleId) continue;
    const name = str(m.jobTitle);
    if (!name) continue;
    const jobTitleId = idByName(jobTitles, name);
    if (!jobTitleId) {
      missing.push(`소속행 ${m.$id}: 직책 '${name}'`);
      continue;
    }
    memberCount++;
    console.log(`  소속행 ${m.$id}: 직책 ${name}→${jobTitleId}`);
    if (apply) await dbs.updateDocument(DB, 'departmentMembers', m.$id, { jobTitleId });
  }

  console.log(`\n${apply ? '적용' : '적용 예정'}: 프로필 ${profileCount}건, 소속행 ${memberCount}건`);
  console.log(`이름으로 못 찾음 ${missing.length}건${missing.length ? ' (비워 둠)' : ''}`);
  for (const line of missing) console.log(`  - ${line}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
