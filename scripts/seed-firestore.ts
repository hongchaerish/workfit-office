import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { encodeForFirestore } from '@/shared/lib/firestore-codec';

import { ITEM_SEED } from '@/data/seeds/item.seed';
import { VENDOR_SEED } from '@/data/seeds/vendor.seed';
import { COMMON_CODE_SEED } from '@/data/seeds/commonCode.seed';
import { ROLE_GROUP_SEED } from '@/data/seeds/roleGroup.seed';
import { SALES_ORDER_SEED } from '@/data/seeds/salesOrder.seed';
import { SHIPMENT_SEED } from '@/data/seeds/shipment.seed';
import { ISSUE_SEED } from '@/data/seeds/issue.seed';
import { QUOTE_SEED } from '@/data/seeds/quote.seed';
import { SALES_COLLECTION_SEED } from '@/data/seeds/salesCollection.seed';
import { ACCOUNTS_RECEIVABLE_SEED } from '@/data/seeds/accountsReceivable.seed';
import { CREDIT_LIMIT_SEED } from '@/data/seeds/creditLimit.seed';
import { SALES_REVENUE_SEED } from '@/data/seeds/salesRevenue.seed';
import { TAX_INVOICE_SEED } from '@/data/seeds/taxInvoice.seed';
import { AUTH_ROLE_SEED } from '@/data/seeds/authRole.seed';
import { BACKUP_POLICY_SEED } from '@/data/seeds/backupPolicy.seed';
import { COMPANY_SITE_SEED } from '@/data/seeds/companySite.seed';
import { DEPARTMENT_SEED } from '@/data/seeds/department.seed';
import { APPROVAL_DOC_SEED } from '@/data/seeds/approvalDoc.seed';
import { APPROVAL_RULE_SEED } from '@/data/seeds/approvalRule.seed';
import { POSITION_SEED } from '@/data/seeds/position.seed';
import { JOB_TITLE_SEED } from '@/data/seeds/jobTitle.seed';
import { APPROVAL_ROUTE_SEED } from '@/data/seeds/approvalRoute.seed';
import { APPROVAL_FORM_SEED } from '@/data/seeds/approvalForm.seed';
import { COMPANY_INFO_SEED } from '@/data/seeds/companyInfo.seed';
import { USER_SEED } from '@/data/seeds/user.seed';
import { SYS_INTERFACE_SEED } from '@/data/seeds/sysInterface.seed';
import { SYSTEM_LOG_SEED } from '@/data/seeds/systemLog.seed';
import { SYS_ADMIN_SEED } from '@/data/seeds/sysAdmin.seed';
import { CHAT_ROOM_SEED } from '@/data/seeds/chatRoom.seed';
import { CHAT_MESSAGE_SEED } from '@/data/seeds/chatMessage.seed';

interface SeedTable<T> {
  coll: string;
  docs: readonly T[];
  /** 문서 ID — 해당 repo의 setDoc(doc(db, COLL, <여기>)) 키와 동일해야 한다. */
  id: (d: T) => string;
}

/** 컬렉션 적재 순서 = repo의 doc-id 규칙과 1:1로 맞춤. */
const TABLES: SeedTable<any>[] = [
  { coll: 'items', docs: ITEM_SEED, id: (d) => d.code },
  { coll: 'vendors', docs: VENDOR_SEED, id: (d) => d.code },
  { coll: 'commonCodes', docs: COMMON_CODE_SEED, id: (d) => `${d.groupCode}__${d.code}` },
  { coll: 'roleGroups', docs: ROLE_GROUP_SEED, id: (d) => d.code },
  { coll: 'salesOrders', docs: SALES_ORDER_SEED, id: (d) => d.no },
  { coll: 'shipments', docs: SHIPMENT_SEED, id: (d) => d.no },
  { coll: 'issues', docs: ISSUE_SEED, id: (d) => d.no },
  { coll: 'quotes', docs: QUOTE_SEED, id: (d) => d.no },
  { coll: 'salesCollections', docs: SALES_COLLECTION_SEED, id: (d) => d.no },
  { coll: 'accountsReceivable', docs: ACCOUNTS_RECEIVABLE_SEED, id: (d) => d.cust },
  { coll: 'creditLimits', docs: CREDIT_LIMIT_SEED, id: (d) => d.cust },
  { coll: 'salesRevenues', docs: SALES_REVENUE_SEED, id: (d) => d.no },
  { coll: 'taxInvoices', docs: TAX_INVOICE_SEED, id: (d) => d.no },
  { coll: 'authRoles', docs: AUTH_ROLE_SEED, id: (d) => d.code },
  { coll: 'backupPolicies', docs: BACKUP_POLICY_SEED, id: (d) => d.id },
  { coll: 'companySites', docs: COMPANY_SITE_SEED, id: (d) => d.name },

  { coll: 'users', docs: USER_SEED, id: (d) => d.id },
  { coll: 'companyInfo', docs: COMPANY_INFO_SEED, id: (d) => d.id },
  { coll: 'interfaces', docs: SYS_INTERFACE_SEED, id: (d) => d.id },
  { coll: 'systemLogs', docs: SYSTEM_LOG_SEED, id: (d) => d.id },
  { coll: 'sysAdmins', docs: SYS_ADMIN_SEED, id: (d) => d.id },
  { coll: 'chatRooms', docs: CHAT_ROOM_SEED, id: (d) => d.id },
  { coll: 'chatMessages', docs: CHAT_MESSAGE_SEED, id: (d) => d.id },
  { coll: 'departments', docs: DEPARTMENT_SEED, id: (d) => d.id },
  { coll: 'positions', docs: POSITION_SEED, id: (d) => d.id },
  { coll: 'jobTitles', docs: JOB_TITLE_SEED, id: (d) => d.id },
  { coll: 'approvalDocs', docs: APPROVAL_DOC_SEED, id: (d) => d.id },
  { coll: 'approvalRules', docs: APPROVAL_RULE_SEED, id: (d) => d.id },
  { coll: 'approvalRouteRules', docs: APPROVAL_ROUTE_SEED, id: (d) => d.id },
  { coll: 'approvalForms', docs: APPROVAL_FORM_SEED, id: (d) => d.id },
];

const DRY = process.argv.includes('--dry');
/** --only=chatRooms,chatMessages → 지정 컬렉션만 적재(그 외 스킵). 미지정 시 전체. */
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const ONLY = onlyArg
  ? onlyArg.slice('--only='.length).split(',').map((s) => s.trim()).filter(Boolean)
  : null;

async function main() {
  if (ONLY) {
    const known = new Set(TABLES.map((t) => t.coll));
    const unknown = ONLY.filter((c) => !known.has(c));
    if (unknown.length) throw new Error(`알 수 없는 컬렉션(--only): ${unknown.join(', ')}`);
  }
  const tables = ONLY ? TABLES.filter((t) => ONLY.includes(t.coll)) : TABLES;
  const total = tables.reduce((n, t) => n + t.docs.length, 0);
  console.log(`시드 ${tables.length}개 컬렉션 · 문서 ${total}건${ONLY ? ` (--only: ${ONLY.join(', ')})` : ''}`);

  if (DRY) {
    for (const t of tables) console.log(`  ${t.coll.padEnd(16)} ${t.docs.length}건`);
    console.log('[dry] Firestore 접근 없이 검증만 수행했습니다.');
    return;
  }

  const projectId = readEnv('VITE_FB_PROJECT_ID');
  const databaseId = readEnv('VITE_FB_FIRESTORE_DB_ID');
  if (!projectId) throw new Error('VITE_FB_PROJECT_ID 를 찾을 수 없습니다 (.env.local).');

  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS ?? resolve(process.cwd(), 'service-account.json');
  if (!existsSync(keyPath)) {
    throw new Error(
      `서비스 계정 키를 찾을 수 없습니다: ${keyPath}\n` +
        'Firebase 콘솔 → 프로젝트 설정 → 서비스 계정 → 새 비공개 키 생성 후 ' +
        './service-account.json 로 저장하거나 GOOGLE_APPLICATION_CREDENTIALS 로 경로를 지정하세요.',
    );
  }
  const serviceAccount = JSON.parse(readFileSync(keyPath, 'utf8'));

  const app = initializeApp({ credential: cert(serviceAccount), projectId });
  // named database( (default) 아님 )를 명시적으로 타깃팅.
  const db = databaseId ? getFirestore(app, databaseId) : getFirestore(app);
  console.log(`타깃: project=${projectId} db=${databaseId ?? '(default)'}`);

  for (const t of tables) {
    // 해당 컬렉션에서 이미 존재하는 문서 ID 목록을 select()로 빠르게 로드
    const snap = await db.collection(t.coll).select().get();
    const existingIds = new Set(snap.docs.map((doc) => doc.id));

    // 존재하지 않는 신규 데이터만 필터링
    const docsToAdd = t.docs.filter((d) => !existingIds.has(t.id(d)));

    if (docsToAdd.length === 0) {
      console.log(`  ✔ ${t.coll.padEnd(16)} 0건 (기존 데이터와 모두 중복되어 스킵됨)`);
      continue;
    }

    // Firestore batch 최대 500건 → 청크로 분할.
    for (let i = 0; i < docsToAdd.length; i += 450) {
      const batch = db.batch();
      for (const d of docsToAdd.slice(i, i + 450)) {
        // 중첩 배열(배열의 배열)을 맵으로 감싸 Firestore 제약 우회. 없으면 무영향.
        batch.set(db.collection(t.coll).doc(t.id(d)), encodeForFirestore(d) as Record<string, unknown>);
      }
      await batch.commit();
    }
    console.log(`  ✔ ${t.coll.padEnd(16)} ${docsToAdd.length}건 적재 완료 (기존 ${existingIds.size}건 보존됨)`);
  }
  console.log('완료.');
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

/** .env.local 의 VITE_FB_* 값을 읽어 named DB를 타깃팅한다. */
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
