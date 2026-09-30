import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client, Databases, Query } from 'node-appwrite';
import { DEPARTMENT_SEED } from '../src/data/seeds/department.seed';

function readEnv(key: string): string | undefined {
  if (process.env[key]) return process.env[key];
  const p = resolve(process.cwd(), '.env.local');
  if (!existsSync(p)) return undefined;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(new RegExp(`^${key}\\s*=\\s*"?([^"\\n\\r]*)"?`));
    if (m) return m[1].trim();
  }
  return undefined;
}

const endpoint = readEnv('VITE_APPWRITE_ENDPOINT')!;
const projectId = readEnv('VITE_APPWRITE_PROJECT_ID')!;
const dbId = readEnv('VITE_APPWRITE_DATABASE_ID')!;
const apiKey = readEnv('APPWRITE_API_KEY')!;

if (!endpoint || !projectId || !dbId || !apiKey) {
  console.error('필수 환경변수가 누락되었습니다 (.env.local 확인)');
  process.exit(1);
}

const client = new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey);
const dbs = new Databases(client);

async function run() {
  console.log('🔄 Appwrite DB departments 정렬번호 및 배치순 업데이트 시작...');
  const coll = 'departments';

  // 1. 현재 DB에 저장된 부서 목록 조회
  const res = await dbs.listDocuments(dbId, coll, [Query.limit(100)]);
  console.log(`총 ${res.documents.length}개 부서 조회됨.`);

  for (const doc of res.documents) {
    const seed = DEPARTMENT_SEED.find((s) => s.id === doc.$id || s.name === doc.name);
    if (seed) {
      console.log(`[업데이트] ${doc.name} (${doc.$id}) -> order: ${seed.order}, parentId: ${seed.parentId}`);
      await dbs.updateDocument(dbId, coll, doc.$id, {
        order: seed.order,
        parentId: seed.parentId,
        headUserId: seed.headUserId,
        deptType: seed.deptType,
      });
    } else {
      console.log(`[유지] ${doc.name} (${doc.$id})`);
    }
  }

  // 혹시 SEED에 있는데 DB에 없는 부서가 있다면 추가
  for (const seed of DEPARTMENT_SEED) {
    const exists = res.documents.find((d) => d.$id === seed.id || d.name === seed.name);
    if (!exists) {
      console.log(`[신규 생성] ${seed.name} (${seed.id})`);
      await dbs.createDocument(dbId, coll, seed.id, {
        id: seed.id,
        name: seed.name,
        parentId: seed.parentId,
        headUserId: seed.headUserId,
        deptType: seed.deptType,
        order: seed.order,
      });
    }
  }

  console.log('✅ departments DB 업데이트 완료!');
}

run().catch((err) => {
  console.error('❌ 업데이트 실패:', err);
  process.exit(1);
});
