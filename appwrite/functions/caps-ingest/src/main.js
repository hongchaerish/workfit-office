/**
 * Appwrite Function — CAPS 근태 인제스트 수신.
 *
 * 사내 C# 에이전트가 ACCESS.mdb에서 뽑은 최근 N일 창을 주기적으로 POST한다.
 * 기존 Vercel 함수(api/ingest.ts, Firestore)를 Appwrite로 이관한 것이며,
 * 검증·ID 결정·멱등 규칙은 `server/caps/**`(TypeScript, 단위 테스트 보유)와 동일하다.
 * 배포 번들이 저장소 코드를 import할 수 없어 계약을 여기에 다시 적었다 —
 * **server/caps를 고치면 이 파일도 같이 고쳐야 한다.**
 *
 * 원본 계약: jwheo/CommuteRef/db_decryption/docs/ingest-api-and-schema.md
 *
 * 호출(에이전트 IngestUrl):
 *   POST https://<appwrite>/v1/functions/caps-ingest/executions
 *   헤더: x-caps-timestamp(유닉스초), x-caps-signature(hex HMAC-SHA256)
 *   서명 대상: `${timestamp}.${rawBody}` — **파싱 전 원문 문자열**
 *
 * 필요 env(함수 설정):
 *   CAPS_INGEST_SECRET   — 에이전트 secret.txt와 같은 값(secret 처리)
 *   APPWRITE_DATABASE_ID — 기본 'workfit'
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Client, Databases, Query } from 'node-appwrite';
import { z } from 'zod';
import { resolveUserId } from './token.js';
import { affiliationOf, headScope, matchesExecMapping } from './scope.js';

/* ------------------------------------------------------------------ 계약 §2 인증 */

const TIMESTAMP_SKEW_SEC = 300;

/** 서명 검증. 반환값은 로그용이며 응답 본문에는 싣지 않는다(계약 §6). */
function verifyRequest(secret, timestamp, signature, rawBody, nowSec) {
  if (!secret || !timestamp || !signature) return 'missing';
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return 'missing';
  // 재전송 방지. 시계가 5분 넘게 어긋난 요청은 서명이 맞아도 받지 않는다.
  if (Math.abs(nowSec - ts) > TIMESTAMP_SKEW_SEC) return 'stale';

  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`, 'utf8').digest('hex');
  const left = Buffer.from(expected, 'utf8');
  const right = Buffer.from(String(signature).trim().toLowerCase(), 'utf8');
  // timingSafeEqual은 길이가 다르면 던진다. 길이 차이 자체는 비밀이 아니므로 먼저 거른다.
  if (left.length !== right.length) return 'mismatch';
  return timingSafeEqual(left, right) ? 'ok' : 'mismatch';
}

/* ------------------------------------------------------------------ 계약 §3 스키마 */

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD 형식이 아닙니다');
const monthDay = z.string().regex(/^\d{2}-\d{2}$/, 'MM-DD 형식이 아닙니다');
const isoDateTime = z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'ISO8601 일시가 아닙니다');

const CAPS_STATUS = [
  'normal', 'late', 'holiday_work', 'off', 'absent', 'missing_out', 'missing_in', 'unknown',
];

const payloadSchema = z.object({
  source: z.literal('caps'),
  generatedAt: isoDateTime,
  windowStart: dateOnly,
  attendance: z.array(z.object({
    empId: z.number().int(),
    name: z.string(),
    date: dateOnly,
    inAt: isoDateTime.nullable(),
    outAt: isoDateTime.nullable(),
    basicMin: z.number().int(),
    overMin: z.number().int(),
    nightMin: z.number().int(),
    lateMin: z.number().int(),
    totalMin: z.number().int(),
    status: z.enum(CAPS_STATUS),
    // raw는 원본 코드 보존용이라 모르는 키도 통과시킨다(status 재해석 안전망).
    raw: z.looseObject({
      decision: z.number().int(),
      inTime: z.number().int(),
      outTime: z.number().int(),
    }),
  })),
  employees: z.array(z.object({
    empId: z.number().int(),
    name: z.string(),
    active: z.boolean(),
    retireDate: dateOnly.nullable(),
  })),
  holidays: z.array(z.object({
    date: dateOnly.nullable(),
    monthDay: monthDay.nullable(),
    recurring: z.boolean(),
    name: z.string(),
  }).refine(
    (row) => (row.recurring ? row.monthDay !== null : row.date !== null),
    '반복 공휴일은 monthDay, 특정일 공휴일은 date가 필요합니다',
  )),
});

/** 계약 §6의 400 응답 detail 형식("attendance[3].date ...")으로 zod 오류를 줄인다. */
function formatIssue(error) {
  const issue = error.issues?.[0];
  if (!issue) return 'invalid payload';
  const path = issue.path
    .map((part) => (typeof part === 'number' ? `[${part}]` : `.${String(part)}`))
    .join('')
    .replace(/^\./, '');
  return path ? `${path} ${issue.message}` : issue.message;
}

/* ------------------------------------------------------------------ 계약 §4 문서 ID */

/** attendance 문서 ID: `{empId}_{YYYYMMDD}`. */
const attendanceDocId = (empId, date) => `${empId}_${date.replaceAll('-', '')}`;

/** holidays 문서 ID: 반복 `md_{MMDD}` / 특정일 `{YYYYMMDD}`. */
const holidayDocId = (h) =>
  h.recurring && h.monthDay ? `md_${h.monthDay.replace('-', '')}` : (h.date ?? '').replaceAll('-', '');

/* ------------------------------------------------------------------ 저장 */

/**
 * 멱등 upsert. 에이전트가 최근 N일 창을 통째로 다시 보내므로 몇 번을 받아도 결과가
 * 같아야 한다. 삭제는 하지 않는다(창 밖 데이터 보호).
 * Appwrite에는 map 타입이 없어 중첩 객체(raw·counts)는 JSON 문자열로 저장한다.
 */
async function upsert(dbs, DB, collection, id, data, log) {
  try {
    await dbs.createDocument(DB, collection, id, data);
  } catch (e) {
    if (e?.code !== 409) {
      log(`${collection}/${id} 생성 실패: ${e.message}`);
      throw e;
    }
    await dbs.updateDocument(DB, collection, id, data);
  }
}

async function storePayload(dbs, DB, payload, now, log) {
  const stamp = now.toISOString();

  for (const row of payload.employees) {
    await upsert(dbs, DB, 'employees', String(row.empId), {
      empId: row.empId,
      name: row.name,
      active: row.active,
      retireDate: row.retireDate,
      updatedAt: stamp,
    }, log);
  }

  for (const row of payload.attendance) {
    await upsert(dbs, DB, 'attendance', attendanceDocId(row.empId, row.date), {
      empId: row.empId,
      date: row.date,
      inAt: row.inAt,
      outAt: row.outAt,
      basicMin: row.basicMin,
      overMin: row.overMin,
      nightMin: row.nightMin,
      lateMin: row.lateMin,
      totalMin: row.totalMin,
      status: row.status,
      raw: JSON.stringify(row.raw),
      updatedAt: stamp,
    }, log);
  }

  for (const row of payload.holidays) {
    const id = holidayDocId(row);
    // 스키마가 걸러주지만 ID가 비면 저장하지 않는다.
    if (id === '' || id === 'md_') continue;
    await upsert(dbs, DB, 'holidays', id, {
      recurring: row.recurring,
      monthDay: row.monthDay,
      date: row.date,
      name: row.name,
    }, log);
  }

  const counts = {
    attendance: payload.attendance.length,
    employees: payload.employees.length,
    holidays: payload.holidays.length,
  };

  // 실행 메타는 마지막에. 본문 저장이 실패하면 여기까지 오지 않아 lastRunAt이 남지 않는다.
  await upsert(dbs, DB, 'syncMeta', 'caps', {
    lastRunAt: stamp,
    windowStart: payload.windowStart,
    counts: JSON.stringify(counts),
    lastError: null,
  }, log);

  return counts;
}

/* ------------------------------------------------------------------ 엔트리포인트 */

/** http로 주입된 엔드포인트를 https로 고정한다. 위 주석의 301 함정 대응. */
function normalizeEndpoint(value) {
  const raw = String(value || '').trim();
  if (raw === '') return raw;
  return raw.startsWith('http://') ? `https://${raw.slice('http://'.length)}` : raw;
}

/** 조회 응답 규약 — 메일 Function과 같다. 성공은 `{data}`, 실패는 `{error:{code,message}}`. */
const readFail = (res, code, message, status) => res.json({ error: { code, message } }, status);

/**
 * 전 직원 근태를 볼 수 있는 직급·직책.
 *
 * `position`(직급)과 `jobTitle`(직책) 어느 쪽에 적혀 있어도 인정한다 — 조직마다 대표를
 * 직급에 두기도 하고 직책에 두기도 한다. 부분 일치라 '대표이사'·'상무이사'·'위원장님'처럼
 * 접미어가 붙어도 걸린다. 인사가 바뀌어도 코드를 고칠 일이 없는 것이 이 방식의 목적이다.
 */
const FULL_ACCESS_TITLES = ['대표', '상무', '전무', '위원장', '부사장', '사장', '이사', '임원'];

/**
 * 직급으로는 안 걸리지만 전 직원 근태를 봐야 하는 사람(인사·총무 담당).
 * 레거시 호환용 백업 명단.
 */
const FULL_ACCESS_USER_IDS = new Set([
  'U003', // 손승원
  'U011', // 김승기
  'U012', // 홍채원
  'U018', // 허진욱
]);

/** 직급·직책이 전체 열람 대상인지. */
function hasFullAccessTitle(user) {
  const text = `${user?.position ?? ''} ${user?.jobTitle ?? ''}`;
  return FULL_ACCESS_TITLES.some((title) => text.includes(title));
}

/**
 * 요청자의 열람 범위.
 *
 * 1. 시스템 역할 그룹: roleMappings/roleGroups 컬렉션에서 'EXEC'(임원) 또는 'OPERATOR'(운영자/관리자)에 바인딩된 사용자 -> 전사 열람 (`empIds: null`)
 * 2. 임원 직급(대표, 상무 등) 또는 레거시 화이트리스트 -> 전사 열람 (`empIds: null`)
 * 3. 부서장(`departments.headUserId` 또는 팀장 직책) -> 소속 부서 임직원만 (`empIds: Set(...)`)
 * 4. 일반 사원 -> 본인만
 */
async function resolveViewerScope(dbs, DB, uid, log) {
  const me = (await dbs.listDocuments(DB, 'users', [Query.equal('id', uid), Query.limit(1)])).documents[0];
  const myName = me ? String(me.name).trim() : '';

  // 소속은 인명관리(기준정보 ID)로 판단한다 — 계정의 dept·position·jobTitle 칸은 옛 사본이라 보지 않는다.
  const [employees, users, profiles, depts, positions, jobTitles] = await Promise.all([
    listAll(dbs, DB, 'employees', [], log),
    listAll(dbs, DB, 'users', [], log),
    listAll(dbs, DB, 'employeeProfiles', [], log),
    listAll(dbs, DB, 'departments', [], log),
    listAll(dbs, DB, 'positions', [], log),
    listAll(dbs, DB, 'jobTitles', [], log),
  ]);
  const aff = affiliationOf(uid, profiles, { depts, positions, jobTitles });
  const matched = employees.find((e) => String(e.name).trim() === myName && myName !== '');
  const myEmpId = matched === undefined ? null : Number(matched.empId);

  // 1. roleMappings 컬렉션에서 EXEC(임원) 또는 OPERATOR(시스템 관리자) 매핑 검사
  try {
    const mappings = await dbs.listDocuments(DB, 'roleMappings', [
      Query.equal('roleCode', ['EXEC', 'OPERATOR']),
      Query.limit(100),
    ]);
    if (mappings.documents.some((m) => matchesExecMapping(m, { uid, empNo: me?.empNo, myName, aff }))) {
      log(`scope uid=${uid} kind=admin (roleMappings EXEC/OPERATOR matched) empId=${myEmpId ?? '(없음)'}`);
      return { empIds: null, kind: 'admin', deptNames: [], myEmpId, myName };
    }
  } catch (err) {
    log(`roleMappings 조회 스킵/실패: ${err?.message || err}`);
  }

  // 2. 직급/직책에 임원 명칭 포함 또는 레거시 화이트리스트
  if (FULL_ACCESS_USER_IDS.has(uid) || hasFullAccessTitle(aff)) {
    log(`scope uid=${uid} kind=admin (title/whitelist matched) empId=${myEmpId ?? '(없음)'}`);
    return { empIds: null, kind: 'admin', deptNames: [], myEmpId, myName };
  }
  if (!me) return { empIds: new Set(), kind: 'self', deptNames: [], myEmpId: null, myName: '' };

  // 3. 부서장이면 맡은 부서(인명관리 부서 ID 기준) 소속 전원, 아니면 나 하나.
  const { deptNames, memberNames } = headScope({ uid, aff, depts, profiles, users });
  const names = deptNames.length > 0 ? memberNames : new Set([myName]);

  const empIds = new Set(employees.filter((e) => names.has(String(e.name).trim())).map((e) => Number(e.empId)));
  const kind = deptNames.length > 0 ? 'head' : 'self';
  log(`scope uid=${uid} kind=${kind} 부서=${deptNames.join(',') || '-'} 대상 ${empIds.size}명 empId=${myEmpId ?? '(없음)'}`);
  return { empIds, kind, deptNames, myEmpId, myName };
}

/** 한 번에 가져올 수 있는 상한. Appwrite `limit`의 최댓값이다. */
const PAGE = 100;

/**
 * 전량 조회 — 커서로 끝까지 넘긴다.
 *
 * `limit`만 크게 잡으면 그 수를 넘긴 순간부터 **조용히 잘린다.** 직원이 늘면 목록 끝사람이
 * 아무 표시 없이 사라지고, 근태는 "그날 안 온 사람"과 구분이 안 된다. 잘림을 만들지 않는다.
 * 안전장치로 상한을 둔다 — 넘으면 잘린 사실을 로그에 남긴다.
 */
async function listAll(dbs, DB, collection, queries, log, cap = 5000) {
  const out = [];
  let cursor = null;
  for (;;) {
    const page = await dbs.listDocuments(DB, collection, [
      ...queries,
      Query.limit(PAGE),
      ...(cursor ? [Query.cursorAfter(cursor)] : []),
    ]);
    out.push(...page.documents);
    if (page.documents.length < PAGE) break;
    if (out.length >= cap) {
      log(`⚠ ${collection} 조회가 상한(${cap})에 걸려 잘렸다. 화면이 전부를 보여주지 못한다.`);
      break;
    }
    cursor = page.documents[page.documents.length - 1].$id;
  }
  return out;
}

/**
 * 그룹웨어 화면의 근태 조회.
 *
 * 신원은 `widdy-login`이 발급한 서명 토큰에서만 나온다. 본문의 사용자 ID를 믿으면 아무나
 * 남의 근태를 열 수 있다. 검증 실패는 익명 강등이 아니라 401이다.
 *
 * ⚠ 지금은 **인증된 사용자면 전 직원 근태를 조회할 수 있다.** `userMap`(empId↔uid)이 비어
 * 있어 "내 근태"를 가릴 근거가 없기 때문이다. 매핑이 채워지면 여기서 본인·관리자만 통과하게
 * 좁혀야 한다 — 그 전까지는 화면 노출 범위로 관리한다.
 */
async function handleAppRead({ req, res, log, error, endpoint, projectId, apiKey, DB }) {
  let body;
  try {
    // 빈 본문에서 bodyJson은 접근하는 순간 던진다. 새면 본문 없는 500이 되고 호출부가 성공으로 오해한다.
    body = req.bodyJson || {};
  } catch {
    return readFail(res, 'INVALID_INPUT', '요청을 읽지 못했습니다.', 400);
  }

  const uid = resolveUserId(body);
  const action = String(body.action || '(없음)');
  log(`read action=${action} uid=${uid || '(미인증)'} endpoint=${endpoint}`);
  if (!uid) return readFail(res, 'UNAUTHORIZED', '로그인이 필요합니다. 다시 로그인해 주세요.', 401);

  const payload = body.payload || {};
  const dbs = new Databases(new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey));

  try {
    /*
      볼 수 있는 범위를 **서버에서** 정한다. 화면이 보내는 값으로 정하면 요청을 고쳐 남의
      근태를 열 수 있다. null이면 제한 없음(관리자).
    */
    const scope = await resolveViewerScope(dbs, DB, uid, log);
    const canSee = (empId) => scope.empIds === null || scope.empIds.has(Number(empId));

    switch (action) {
      /*
        화면이 자기 권한을 스스로 판정하지 않게 서버가 알려준다. 같은 규칙을 프런트에
        복제해 두면 언젠가 한쪽만 바뀌어 어긋난다 — 판정은 여기 한 곳에만 둔다.
        `empId`는 "내 근태"가 쓸 본인 사번이고, 이름이 안 맞으면 null이다.
      */
      case 'viewerScope': {
        return res.json({
          data: {
            empId: scope.myEmpId,
            name: scope.myName,
            kind: scope.kind,
            deptNames: scope.deptNames,
          },
        });
      }

      case 'listEmployees': {
        const rows = (await listAll(dbs, DB, 'employees', [], log)).filter((d) => canSee(d.empId));
        return res.json({
          data: rows.map((d) => ({
            empId: Number(d.empId),
            name: String(d.name ?? ''),
            active: Boolean(d.active),
            retireDate: d.retireDate ?? null,
          })),
        });
      }

      case 'listMonth': {
        const empId = Number(payload.empId);
        const month = String(payload.month || '');
        if (!Number.isInteger(empId) || !/^\d{4}-\d{2}$/.test(month)) {
          return readFail(res, 'INVALID_INPUT', '사번과 조회 월(YYYY-MM)이 필요합니다.', 400);
        }
        if (!canSee(empId)) return readFail(res, 'FORBIDDEN', '이 직원의 근태를 볼 권한이 없습니다.', 403);
        /*
          `idx_empId_date`를 그대로 타는 질의다. 전건을 받아 화면에서 거르면 근태처럼
          직원×일수로 늘어나는 데이터에서 조회 상한에 먼저 걸린다.
        */
        const rows = await listAll(dbs, DB, 'attendance', [
          Query.equal('empId', empId),
          Query.greaterThanEqual('date', `${month}-01`),
          Query.lessThanEqual('date', `${month}-31`),
        ], log);
        return res.json({
          data: rows.map((d) => ({
            empId: Number(d.empId),
            date: String(d.date),
            inAt: d.inAt ?? null,
            outAt: d.outAt ?? null,
            basicMin: Number(d.basicMin ?? 0),
            overMin: Number(d.overMin ?? 0),
            nightMin: Number(d.nightMin ?? 0),
            lateMin: Number(d.lateMin ?? 0),
            totalMin: Number(d.totalMin ?? 0),
            status: String(d.status || 'unknown'),
          })),
        });
      }

      case 'listDay': {
        const date = String(payload.date || '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          return readFail(res, 'INVALID_INPUT', '조회 날짜(YYYY-MM-DD)가 필요합니다.', 400);
        }
        /*
          하루치 전 직원. `idx_empId_date`는 empId가 앞이라 날짜만으로는 못 탄다 —
          `idx_date`를 따로 둔다(프로비저닝 스크립트 참조).
          직원이 몇 명이든 전량을 가져온다 — 잘리면 "그날 안 온 사람"과 구분이 안 된다.
        */
        const rows = (await listAll(dbs, DB, 'attendance', [Query.equal('date', date)], log)).filter((d) => canSee(d.empId));
        return res.json({
          data: rows.map((d) => ({
            empId: Number(d.empId),
            date: String(d.date),
            inAt: d.inAt ?? null,
            outAt: d.outAt ?? null,
            basicMin: Number(d.basicMin ?? 0),
            overMin: Number(d.overMin ?? 0),
            nightMin: Number(d.nightMin ?? 0),
            lateMin: Number(d.lateMin ?? 0),
            totalMin: Number(d.totalMin ?? 0),
            status: String(d.status || 'unknown'),
          })),
        });
      }

      case 'listMonthAll': {
        const month = String(payload.month || '');
        if (!/^\d{4}-\d{2}$/.test(month)) {
          return readFail(res, 'INVALID_INPUT', '조회 월(YYYY-MM)이 필요합니다.', 400);
        }
        /*
          한 달치 전 직원. 직원 수 × 일수라 셋 중 가장 크다(300명이면 6천 건대). 그래도
          커서로 전량을 가져온다 — 집계 화면에서 잘리면 합계가 조용히 틀린다.
        */
        const rows = (await listAll(dbs, DB, 'attendance', [
          Query.greaterThanEqual('date', `${month}-01`),
          Query.lessThanEqual('date', `${month}-31`),
        ], log, 20000)).filter((d) => canSee(d.empId));
        return res.json({
          data: rows.map((d) => ({
            empId: Number(d.empId),
            date: String(d.date),
            inAt: d.inAt ?? null,
            outAt: d.outAt ?? null,
            basicMin: Number(d.basicMin ?? 0),
            overMin: Number(d.overMin ?? 0),
            nightMin: Number(d.nightMin ?? 0),
            lateMin: Number(d.lateMin ?? 0),
            totalMin: Number(d.totalMin ?? 0),
            status: String(d.status || 'unknown'),
          })),
        });
      }

      default:
        return readFail(res, 'UNKNOWN_ACTION', `알 수 없는 요청입니다: ${action}`, 400);
    }
  } catch (e) {
    // 원문에는 컬렉션·키 정보가 섞일 수 있어 로그에만 남긴다.
    error(`caps read(${action}): ${e?.message || e}`);
    return readFail(res, 'INTERNAL', '근태 조회 중 오류가 발생했습니다.', 500);
  }
}

export default async ({ req, res, log, error }) => {
  if (req.method !== 'POST') {
    return res.json({ ok: false, error: 'method_not_allowed' }, 405);
  }

  /*
    ⚠ Appwrite가 주입하는 `APPWRITE_FUNCTION_API_ENDPOINT`는 평문 http다. 서버가 https로
    301 하면서 POST가 GET으로 바뀌어 문서 생성이 조용히 목록 조회로 둔갑한다(예외도 안 난다).
    메일 Function에서 며칠을 태운 함정이라 여기서도 https를 우선하고 마지막에 강제한다.
  */
  const endpoint = normalizeEndpoint(process.env.APPWRITE_ENDPOINT || process.env.APPWRITE_FUNCTION_API_ENDPOINT);
  const projectId = process.env.APPWRITE_FUNCTION_PROJECT_ID || process.env.APPWRITE_PROJECT_ID;
  const apiKey = req.headers['x-appwrite-key'] || process.env.APPWRITE_API_KEY;
  const DB = process.env.APPWRITE_DATABASE_ID || 'workfit';

  /*
    두 종류의 호출이 한 함수로 들어온다.

    - 사내 에이전트의 **적재**: HMAC 서명 헤더를 붙인다(아래 기존 경로)
    - 그룹웨어 화면의 **조회**: `widdy-login`이 발급한 토큰을 본문에 싣는다

    서명 헤더 유무로 가른다. 조회를 같은 함수에 두는 이유는 배포·시크릿·DB 접근을 한 벌로
    유지하기 위해서다. 근태 컬렉션은 서버 전용 권한이라 브라우저가 직접 못 읽는다 —
    이 조회 경로가 유일한 통로다.
  */
  if (!req.headers['x-caps-signature']) {
    return handleAppRead({ req, res, log, error, endpoint, projectId, apiKey, DB });
  }

  // 서명 대상은 파싱 전 원문이다. req.bodyRaw를 쓰고 절대 재직렬화하지 않는다.
  const rawBody = req.bodyRaw ?? '';
  const verdict = verifyRequest(
    process.env.CAPS_INGEST_SECRET ?? '',
    req.headers['x-caps-timestamp'],
    req.headers['x-caps-signature'],
    rawBody,
    Math.floor(Date.now() / 1000),
  );
  if (verdict !== 'ok') {
    // 401 본문은 최소화한다 — 서명이 왜 틀렸는지는 공격자에게도 힌트가 된다.
    log(`unauthorized: ${verdict}`);
    return res.json({ ok: false, error: 'unauthorized' }, 401);
  }

  let parsedJson;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch {
    return res.json({ ok: false, error: 'invalid_payload', detail: 'body is not valid JSON' }, 400);
  }

  const parsed = payloadSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return res.json({ ok: false, error: 'invalid_payload', detail: formatIssue(parsed.error) }, 400);
  }

  const client = new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey);
  const dbs = new Databases(client);

  try {
    const upserted = await storePayload(dbs, DB, parsed.data, new Date(), log);
    log(`ingested ${JSON.stringify(upserted)}`);
    return res.json({ ok: true, upserted });
  } catch (e) {
    error(`ingest failed: ${e.message}`);
    // 실패 사유를 syncMeta에 남긴다(계약 §4). 이것마저 실패하면 응답만 남긴다.
    try {
      await upsert(dbs, DB, 'syncMeta', 'caps', { lastError: e.message }, log);
    } catch {
      /* noop — 대응은 5xx를 본 에이전트의 재시도가 한다. */
    }
    return res.json({ ok: false, error: 'internal' }, 500);
  }
};
