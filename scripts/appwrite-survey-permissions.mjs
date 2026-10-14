/**
 * 설문 컬렉션 권한 잠금 — 설계 §5 (docs/superpowers/specs/2026-10-14-survey-server-design.md).
 *
 *   surveys · surveyQuestions                          → 읽기만 공개(쓰기는 Function survey)
 *   surveyResponses · surveyAnswers · surveyParticipations → 권한 없음(Function survey 만)
 *
 * `appwrite-schema.ts` 는 컬렉션을 **새로 만들 때만** 권한을 적용하므로 기존 컬렉션은 이 스크립트로 바꾼다.
 *
 * 실행: node scripts/appwrite-survey-permissions.mjs [--apply] [--prod]
 *   기본은 dry-run(현재 → 바뀔 권한만 출력). --apply 로 적용.
 *   운영(--prod)은 **새 앱이 배포된 뒤에만** 적용한다 — 먼저 잠그면 옛 앱이 직접 쓰기를 해서 깨진다.
 */
import { readFileSync } from 'node:fs';
import { Client, Databases, Permission, Role } from 'node-appwrite';

const env = readFileSync('.env.local', 'utf8');
const g = (k) => (env.match(new RegExp(`^${k}\\s*=\\s*"?([^"\\n#]*)`, 'm')) || [])[1]?.trim();
const PROD = process.argv.includes('--prod');
const APPLY = process.argv.includes('--apply');
const project = PROD ? (g('APPWRITE_PROJECT_ID_PROD') ?? '6a6bf85e002acb7f71d6') : g('VITE_APPWRITE_PROJECT_ID');
const key = PROD ? g('APPWRITE_API_KEY_PROD') : (g('APPWRITE_API_KEY') ?? g('APPWRITE_API_KEY_DEV'));
const databaseId = g('VITE_APPWRITE_DATABASE_ID') ?? 'workfit';
if (!project || !key) {
  console.error('✗ 프로젝트 ID 또는 API 키가 없습니다.');
  process.exit(1);
}
const dbs = new Databases(new Client().setEndpoint(g('VITE_APPWRITE_ENDPOINT')).setProject(project).setKey(key));

const PLAN = {
  surveys: [Permission.read(Role.any())],
  surveyQuestions: [Permission.read(Role.any())],
  surveyResponses: [],
  surveyAnswers: [],
  surveyParticipations: [],
};

console.log(`▶ ${PROD ? '운영' : '개발'} ${project} — ${APPLY ? '적용' : 'dry-run'}`);
for (const [collectionId, permissions] of Object.entries(PLAN)) {
  const c = await dbs.getCollection({ databaseId, collectionId });
  console.log(`  ${collectionId}: ${JSON.stringify(c.$permissions)} → ${JSON.stringify(permissions)}`);
  if (APPLY) {
    await dbs.updateCollection({ databaseId, collectionId, name: c.name, permissions, documentSecurity: false, enabled: c.enabled });
    console.log('    ✓ 적용');
  }
}
