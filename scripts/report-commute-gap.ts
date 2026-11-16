import { Query } from 'node-appwrite';
import { connect, listAll } from './lib-substitute';

/**
 * 한 직원의 근태 기록 빈 날 확인 — 읽기만 한다.
 * 실행: npx tsx scripts/report-commute-gap.ts <이름> <YYYY-MM> [--prod]
 */
const [name, month] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const { dbs, dbId, isProd } = connect();
console.log(`대상: ${isProd ? '운영' : '개발'} — 읽기만`);
const emps = (await listAll(dbs, dbId, 'employees')).filter((e) => e.name === name);
console.log('CAPS 직원:', emps.map((e) => ({ empId: e.empId, name: e.name, dept: e.dept, active: e.active, $updatedAt: e.$updatedAt })));
for (const e of emps) {
  const rows = await listAll(dbs, dbId, 'attendance', [Query.equal('empId', e.empId), Query.greaterThanEqual('date', `${month}-01`), Query.lessThanEqual('date', `${month}-31`)]);
  rows.sort((a, b) => a.date.localeCompare(b.date));
  console.log(`empId ${e.empId} ${month} 기록 ${rows.length}일`);
  for (const r of rows) console.log(' ', r.date, r.inAt ?? '-', r.outAt ?? '-', r.$updatedAt);
}
const meta = await listAll(dbs, dbId, 'syncMeta');
console.log('syncMeta:', meta.map(({ $id, $updatedAt, ...rest }) => ({ $id, $updatedAt, ...Object.fromEntries(Object.entries(rest).filter(([k]) => !k.startsWith('$'))) })));
