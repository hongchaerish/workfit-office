/**
 * ETL — Firestore → Appwrite 데이터 이관. ([[Firestore_Appwrite_이관_단계별_계획서]] Phase 4)
 *
 * 보존 대상 컬렉션(§1.4)만 이관. 영업 8종·counters/SO-* 는 폐기(제외).
 * 각 문서를 repo의 Appwrite 어댑터와 동일하게 변환:
 *   - $id = safeDocId(Firestore 문서ID)   (Firestore 문서ID = repo 자연키)
 *   - 중첩 필드 → JSON 문자열(jsonFields)
 *   - authRole/roleGroup 은 Firestore 코덱 decode 후 저장
 *   - approvalDocs 는 payload(JSON 통짜) 방식
 *   - documentExecutions/{id}/history 서브컬렉션 → executionHistory(FK)
 *   - Appwrite 컬럼에 없는 필드는 자동 제외(listAttributes 기준)
 *
 * 실행:
 *   npx tsx scripts/etl-firestore-to-appwrite.ts            # DRY-RUN(건수만, 쓰기 없음)
 *   npx tsx scripts/etl-firestore-to-appwrite.ts --commit   # 실제 적재(upsert)
 *
 * env(.env.local): VITE_APPWRITE_ENDPOINT / VITE_APPWRITE_PROJECT_ID /
 *   VITE_APPWRITE_DATABASE_ID / APPWRITE_API_KEY.  Firebase: repo 루트 *-adminsdk-*.json.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { Client, Databases } from 'node-appwrite';
import { decodeFromFirestore } from '@/shared/lib/firestore-codec';

const COMMIT = process.argv.includes('--commit');
const SEED_ONLY = process.argv.includes('--seed-only');

// ── env ──
function readEnv(key: string): string | undefined {
  if (process.env[key]) return process.env[key];
  const p = resolve(process.cwd(), '.env.local');
  if (!existsSync(p)) return undefined;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(new RegExp(`^${key}\\s*=\\s*"?([^"\\n]*)"?`));
    if (m) return m[1].trim();
  }
  return undefined;
}

// ── safeDocId (앱과 동일 규칙) ──
const ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$/;
function cyrb53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
const safeDocId = (k: string) => (ID_RE.test(k) ? k : 'h' + cyrb53(k).toString(36) + cyrb53(k, 1).toString(36));

// ── 이관 대상 컬렉션 카탈로그(Firestore명 = Appwrite명) ──
interface CollSpec {
  coll: string;
  jsonFields?: string[];
  decode?: boolean; // Firestore 코덱 decode(authRole/roleGroup)
  payload?: boolean; // 전체 문서 payload(JSON)로 저장(approvalDocs)
  payloadCols?: string[]; // payload 모드에서 함께 저장할 스칼라 컬럼
  history?: boolean; // documentExecutions/{id}/history → executionHistory
  filter?: (id: string) => boolean; // 문서ID 필터(counters AP-* 만)
}
const COLLECTIONS: CollSpec[] = [
  { coll: 'users' },
  { coll: 'departments' },
  { coll: 'positions' },
  { coll: 'jobTitles' },
  { coll: 'companyInfo' },
  { coll: 'companySites' },
  { coll: 'commonCodes' },
  { coll: 'roleGroups', jsonFields: ['members', 'permissions'], decode: true },
  { coll: 'backupPolicies' },
  { coll: 'interfaces' },
  { coll: 'approvalForms', jsonFields: ['fields'] },
  { coll: 'approvalFolders' },
  { coll: 'approvalRouteRules', jsonFields: ['steps', 'deptScope'] },
  { coll: 'vendors' },
  { coll: 'items' },
  { coll: 'creditLimits' },
  { coll: 'systemLogs' },
  { coll: 'chatRooms', jsonFields: ['lastMessage'] },
  { coll: 'chatMessages', jsonFields: ['attachment', 'replyTo', 'approvalPayload'] },
  { coll: 'notifications' },
  {
    coll: 'approvalDocs',
    payload: true,
    payloadCols: ['id', 'docNo', 'docType', 'title', 'drafterId', 'status', 'drafterName'],
  },
  { coll: 'documentExecutions', history: true },
  { coll: 'counters', filter: (id) => id.startsWith('AP-') }, // SO-* 폐기
];

type Row = Record<string, unknown>;
const isCode = (e: unknown, code: number) => (e as { code?: number })?.code === code;

async function main() {
  const endpoint = readEnv('VITE_APPWRITE_ENDPOINT');
  const projectId = readEnv('VITE_APPWRITE_PROJECT_ID');
  const DB = readEnv('VITE_APPWRITE_DATABASE_ID') ?? 'workfit';
  const apiKey = readEnv('APPWRITE_API_KEY');
  if (!endpoint || !projectId || !apiKey) {
    console.error('env 누락: VITE_APPWRITE_ENDPOINT / VITE_APPWRITE_PROJECT_ID / APPWRITE_API_KEY');
    process.exit(1);
  }

  // Appwrite (쓰기)
  const dbs = new Databases(new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey));

  // Firebase 계정 키가 없어도 로컬 시드로 결재선 규칙만 즉시 채울 수 있는 특례 모드
  if (SEED_ONLY) {
    console.log(`▶ [SEED-ONLY] 로컬 결재선 시드 데이터를 Appwrite(${DB}) 결재선 규칙에 적재합니다...\n`);
    const { APPROVAL_ROUTE_SEED } = await import('../src/data/seeds/approvalRoute.seed');
    for (const rule of APPROVAL_ROUTE_SEED) {
      const id = rule.id;
      const row = {
        id: rule.id,
        name: rule.name,
        priority: rule.priority,
        active: rule.active,
        docType: rule.docType,
        conditionKey: rule.conditionKey,
        conditionValues: rule.conditionValues,
        deptScope: JSON.stringify(rule.deptScope),
        positionFromRank: rule.positionFromRank,
        positionToRank: rule.positionToRank,
        amountFrom: rule.amountFrom,
        amountTo: rule.amountTo,
        steps: JSON.stringify(rule.steps),
      };

      if (COMMIT) {
        try {
          await dbs.createDocument(DB, 'approvalRouteRules', id, row);
          console.log(`  [추가 완료] ${id} (${rule.name})`);
        } catch (e) {
          if (isCode(e, 409)) {
            await dbs.updateDocument(DB, 'approvalRouteRules', id, row);
            console.log(`  [업데이트 완료] ${id} (${rule.name})`);
          } else {
            console.error(`  [실패] ${id}:`, e instanceof Error ? e.message : e);
          }
        }
      } else {
        console.log(`  [적재예정] ${id} (${rule.name})`);
      }
    }
    console.log(COMMIT ? '\n✅ 결재선 룰 시드 적재 완료.' : '\n(DRY-RUN) 실제 적재하려면 --commit 플래그로 재실행.');
    process.exit(0);
  }

  // Firebase admin (Firestore 읽기)
  // const keyFile = readdirSync(process.cwd()).find((f) => /-adminsdk-.*\.json$/.test(f)); // (기존 코드 보존)
  const keyFile = readdirSync(process.cwd()).find((f) => /(-adminsdk-.*\.json|service-account\.json)$/.test(f));
  if (!keyFile) {
    console.error('Firebase 서비스계정 키(*-adminsdk-*.json)를 repo 루트에서 못 찾음');
    process.exit(1);
  }
  initializeApp({ credential: cert(JSON.parse(readFileSync(resolve(process.cwd(), keyFile), 'utf8'))) });
  const fs = getFirestore();

  console.log(`▶ ETL Firestore → Appwrite(${DB})  [${COMMIT ? 'COMMIT(실제 적재)' : 'DRY-RUN(건수만)'}]\n`);

  const jsonify = (raw: Row, jsonFields: string[]): Row => {
    const out: Row = { ...raw };
    for (const f of jsonFields) out[f] = raw[f] == null ? null : JSON.stringify(raw[f]);
    return out;
  };

  let grandRead = 0;
  let grandWrote = 0;
  const report: string[] = [];

  for (const spec of COLLECTIONS) {
    let read = 0;
    let wrote = 0;
    let skipped = 0;
    let cols: Set<string> | null = null;
    try {
      if (!spec.payload) {
        const attrs = await dbs.listAttributes(DB, spec.coll);
        cols = new Set(attrs.attributes.map((a) => (a as unknown as { key: string }).key));
      }
      const snap = await fs.collection(spec.coll).get();
      for (const doc of snap.docs) {
        read++;
        if (spec.filter && !spec.filter(doc.id)) {
          skipped++;
          continue;
        }
        let raw = doc.data() as Row;
        if (spec.decode) raw = decodeFromFirestore(raw) as Row;

        let row: Row;
        if (spec.payload) {
          row = { payload: JSON.stringify(raw) };
          for (const c of spec.payloadCols ?? []) if (raw[c] != null) row[c] = raw[c];
        } else {
          // Appwrite 컬럼에 있는 필드만 + 중첩 JSON
          const filtered: Row = {};
          for (const k of Object.keys(raw)) if (cols!.has(k)) filtered[k] = raw[k];
          row = jsonify(filtered, spec.jsonFields ?? []);
        }
        const id = safeDocId(doc.id);

        if (COMMIT) {
          try {
            await dbs.createDocument(DB, spec.coll, id, row);
          } catch (e) {
            if (isCode(e, 409)) await dbs.updateDocument(DB, spec.coll, id, row);
            else throw e;
          }

          // documentExecutions 서브컬렉션 history → executionHistory
          if (spec.history) {
            const hist = await fs.collection('documentExecutions').doc(doc.id).collection('history').get();
            for (const h of hist.docs) {
              const hd = h.data() as Row;
              const hid = safeDocId(String(hd.eventId ?? h.id));
              const hrow: Row = {
                eventId: hd.eventId ?? h.id,
                executionId: doc.id,
                type: hd.type,
                actorId: hd.actorId ?? null,
                actorName: hd.actorName ?? null,
                comment: hd.comment ?? null,
                createdAt: hd.createdAt ?? null,
              };
              try {
                await dbs.createDocument(DB, 'executionHistory', hid, hrow);
              } catch (e) {
                if (isCode(e, 409)) await dbs.updateDocument(DB, 'executionHistory', hid, hrow);
                else throw e;
              }
            }
          }
        }
        wrote++;
      }
      report.push(`  ${spec.coll.padEnd(20)} 읽기 ${read}${skipped ? ` (필터제외 ${skipped})` : ''} → ${COMMIT ? '적재' : '적재예정'} ${wrote}`);
      grandRead += read;
      grandWrote += wrote;
    } catch (e) {
      report.push(`  ${spec.coll.padEnd(20)} ✗ ${e instanceof Error ? e.message : e}`);
    }
  }

  console.log(report.join('\n'));
  console.log(`\n합계: 읽기 ${grandRead} / ${COMMIT ? '적재' : '적재예정'} ${grandWrote}`);
  console.log(COMMIT ? '\n✅ ETL 적재 완료(멱등 upsert).' : '\n(DRY-RUN) 실제 적재하려면 --commit 플래그로 재실행.');
  process.exit(0);
}

main().catch((e) => {
  console.error('\n✗ ETL 실패:', e instanceof Error ? e.message : e);
  process.exit(1);
});
