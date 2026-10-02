/**
 * Appwrite 스키마 IaC — Firestore→Appwrite 이관 Phase 0.
 * Database·Collection·Attribute·Index·Permission 을 코드로 멱등 생성한다(재실행 안전).
 * 콘솔 수작업을 대체해 Phase 1 PoC(chatMessages·notifications) 실측을 즉시 가능케 한다.
 * ([[Firestore_Appwrite_이관_단계별_계획서]] Phase 0 산출물 / PoC 실행가이드 §2)
 *
 * 실행: npm run appwrite:schema   (내부적으로 tsx scripts/appwrite-schema.ts)
 *
 * 필요 env (.env.local 또는 프로세스 환경):
 *   APPWRITE_ENDPOINT     (없으면 VITE_APPWRITE_ENDPOINT)   예: https://appwrite.widdyax.com/v1
 *   APPWRITE_PROJECT_ID   (없으면 VITE_APPWRITE_PROJECT_ID) 예: 6a6bf85e002acb7f71d6
 *   APPWRITE_DATABASE_ID  (없으면 VITE_APPWRITE_DATABASE_ID) 예: workfit
 *   APPWRITE_API_KEY      ★서버 API 키(비밀). Console > 프로젝트 > API Keys 에서
 *                          databases.read/write + collections/attributes/indexes 스코프로 발급.
 *                          ⚠️ VITE_ 아님(번들 노출 금지). .env.local 에만 두고 Git 커밋 금지.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  Client,
  Databases,
  Permission,
  Query,
  Role,
  DatabasesIndexType,
  type Models,
} from 'node-appwrite';

/**
 * `listAttributes` 는 기본 25건만 돌려준다. 속성이 그보다 많은 컬렉션(예: resources 29개)에서
 * 뒤쪽 속성이 목록에 안 잡혀 "없는 것"으로 오인되고, 재생성 → 409 → available 대기가
 * 영원히 끝나지 않는다. 모든 조회에 상한을 명시한다.
 */
const ATTR_PAGE = [Query.limit(500)];

// ─────────────────────────────────────────────────────────────
// 스키마 정의 (데이터 주도) — Phase 3에서 컬렉션을 여기 추가하면 된다.
// ─────────────────────────────────────────────────────────────
type AttrDef =
  | { kind: 'string'; key: string; size: number; required?: boolean; array?: boolean }
  | { kind: 'enum'; key: string; elements: string[]; required?: boolean; xdefault?: string }
  | { kind: 'integer'; key: string; required?: boolean; array?: boolean; xdefault?: number; min?: number; max?: number }
  | { kind: 'float'; key: string; required?: boolean; array?: boolean }
  | { kind: 'boolean'; key: string; required?: boolean; xdefault?: boolean };

interface IndexDef {
  key: string;
  type: DatabasesIndexType;
  attributes: string[];
}

interface CollectionDef {
  id: string;
  name: string;
  attributes: AttrDef[];
  indexes: IndexDef[];
  /**
   * 생성 시 컬렉션 권한. 생략하면 `POC_PERMISSIONS`(누구나 CRUD)를 쓴다.
   *
   * **빈 배열이면 서버 전용** — 브라우저가 직접 붙으면 401이고 API 키를 가진 Function만
   * 읽고 쓸 수 있다. 개인정보나 자격 증명을 담는 컬렉션은 반드시 이쪽이어야 한다.
   */
  permissions?: string[];
}

// ── 빌더 헬퍼 (가독성) ──
const S = (key: string, size: number, required = false): AttrDef => ({ kind: 'string', key, size, required });
const SA = (key: string, size: number): AttrDef => ({ kind: 'string', key, size, array: true }); // 문자열 배열
const J = (key: string, size = 16000): AttrDef => ({ kind: 'string', key, size }); // 중첩/배열-of-객체 → JSON 문자열
const EN = (key: string, elements: string[], required = false): AttrDef => ({ kind: 'enum', key, elements, required });
/**
 * Appwrite 1.9.6 실측: integer 속성에 min/max 를 **생략하면 워커가 processing 에서 멈춘다**
 * (속성이 available 로 넘어오지 않아 뒤따르는 인덱스 생성까지 막힌다).
 * 그래서 호출부가 지정하지 않으면 안전한 전범위 기본값을 넣는다 — 의미상 무제한이되
 * "지정은 된" 상태로 만드는 것이 목적이다.
 */
const INT_MIN = Number.MIN_SAFE_INTEGER;
const INT_MAX = Number.MAX_SAFE_INTEGER;
const INT = (key: string, required = false, xdefault?: number, min?: number, max?: number): AttrDef =>
  ({ kind: 'integer', key, required, xdefault, min: min ?? INT_MIN, max: max ?? INT_MAX });
const BOOL = (key: string, xdefault?: boolean): AttrDef => ({ kind: 'boolean', key, xdefault });
const IX = (name: string, attributes: string[]): IndexDef => ({
  key: `idx_${name}`,
  type: DatabasesIndexType.Key,
  attributes,
});
/** 유일 인덱스 — 같은 값 조합의 문서가 둘 생기는 것을 DB에서 막는다. */
const UQ = (name: string, attributes: string[]): IndexDef => ({
  key: `uq_${name}`,
  type: DatabasesIndexType.Unique,
  attributes,
});

/**
 * 보존 대상 컬렉션 카탈로그(계획서 §1.4). 각 정의는 zod 도메인 스키마에서 파생.
 *
 * [required 판정 규칙 — 정밀 재검토 2026-08-12]
 *   required=true  ⟺  zod에 `.min(1)`(문자열)/`.min(n)`(숫자)이 있고
 *                     `.default()`/`.optional()`/`.nullable()` 가 없음.
 *                     + 각 컬렉션의 필수 FK/소유키(roomId·userId·documentId·executionId·seq)는 강제 true.
 *   그 외(bare z.string(), default/nullable/optional, **default 없는 enum**)는 false(ETL 관용).
 *   → enum은 required=false여도 Appwrite Enum이 값 자체는 제약하며, 누락 시 앱 zod가 기본값 보충.
 *
 * [size 규칙]  zod `.max(N)` 선언 시 그 값. 없으면 역할별: id/code 64 · name 128 · url 512 ·
 *   addr/homepage 256 · tel/bizNo 32 · detail/comment 1000 · body 8000 ·
 *   JSON(J) 기본 16000, 대형(fields/steps/fieldValues) 65535.
 *
 * [타입]  z.number().int()·금액(원)→Integer · z.boolean→Boolean ·
 *   z.array(string)→String[] · 중첩객체/배열-of-객체/record/tuple→JSON 문자열(J).
 *
 * 제외: localStorage 전용(approvalProcess·absence·succession), 폐기 대상(영업 8종).
 */
const COLLECTIONS: CollectionDef[] = [
  // ── 메신저 (PoC) ──
  {
    id: 'chatMessages',
    name: '채팅 메시지',
    attributes: [
      S('roomId', 64, true),
      S('senderId', 64),
      S('senderName', 128),
      S('text', 4000),
      EN('type', ['text', 'system', 'image', 'file', 'approval_bot']),
      S('at', 40),
      SA('readBy', 64),
      BOOL('isEdited', false), // 메시지 수정 여부(팀 기능)
      J('attachment', 4000), // url/name/size/mime
      J('replyTo', 2000),
      J('approvalPayload', 2000),
      // 메시지 삭제(모두에게서) 기록 — 삭제된 메시지에만 채운다(domain/chatMessage/deletion)
      S('deletedAt', 40),
      S('deletedBy', 64),
      S('deletedByName', 128),
    ],
    indexes: [IX('roomId', ['roomId']), IX('at', ['at'])],
  },
  {
    id: 'chatRooms',
    name: '채팅방',
    attributes: [
      S('id', 64, true),
      S('name', 128, true),
      S('type', 32),
      SA('members', 64),
      S('color', 16),
      S('createdAt', 40),
      S('createdBy', 64), // 방 생성자(팀 기능 — 생성자만 이름변경)
      S('deletedAt', 40),
      S('deletedBy', 64),
      J('lastMessage', 8000), // text/at/senderId
    ],
    indexes: [IX('type', ['type'])],
  },
  // ── 실시간 알림 (PoC) ──
  {
    id: 'notifications',
    name: '실시간 알림',
    attributes: [
      S('userId', 64, true), // FK/소유키 → 강제 required
      S('type', 20), // 결재/메신저/시스템 (한글 → String, enum-무default)
      S('title', 200),
      S('text', 2000),
      S('senderName', 128),
      S('linkUrl', 500),
      BOOL('read', false),
      S('createdAt', 40),
    ],
    indexes: [IX('userId', ['userId']), IX('createdAt', ['createdAt']), IX('userId_read', ['userId', 'read'])],
  },
  // ── 사용자 근무 상태 (Realtime 동기화) ──
  {
    id: 'user_presences',
    name: '사용자 실시간 근무 상태',
    attributes: [
      S('userId', 64, true),
      EN('status', ['ONLINE', 'OFFLINE', 'OUTSIDE', 'MEETING', 'FOCUS', 'LEAVE', 'AWAY']),
      S('message', 255),
      S('updatedAt', 40), // 사용자가 상태를 직접 바꾼 시각
      S('lastSeenAt', 40), // 마지막 접속 신호(창이 열려 있음) — 오프라인 판정
      S('lastActiveAt', 40), // 마지막 키보드·마우스 활동 — 자리비움 판정
    ],
    indexes: [IX('userId', ['userId'])],
  },

  // ── 마스터 / 조직 ──
  {
    id: 'users',
    name: '사용자',
    attributes: [
      S('id', 64, true),
      S('empNo', 20, true),
      S('name', 30, true),
      S('dept', 30, true),
      S('position', 20, true),
      S('jobTitle', 20),
      S('email', 128, true),
      S('status', 16),
      S('lastLogin', 40),
      S('managerId', 64),
      S('password', 128), // SHA-256 hex (자체 로그인)
      S('sealUrl', 512),
      S('signUrl', 512),
      S('signType', 16),
      S('photoUrl', 512),
      S('activeChatRoomId', 64),
      S('resignedAt', 40),
      S('fcmToken', 256),
    ],
    indexes: [IX('empNo', ['empNo']), IX('dept', ['dept'])],
  },
  {
    id: 'departments',
    name: '부서',
    attributes: [S('id', 64, true), S('name', 128, true), S('parentId', 64), S('headUserId', 64), S('deptType', 16), INT('order')],
    indexes: [IX('parentId', ['parentId'])],
  },
  {
    id: 'positions',
    name: '직급',
    attributes: [S('id', 64, true), S('name', 64, true), INT('rank', true), BOOL('isDeptHead', false)],
    indexes: [IX('rank', ['rank'])],
  },
  {
    id: 'jobTitles',
    name: '직책',
    attributes: [S('id', 64, true), S('name', 64, true)],
    indexes: [],
  },
  {
    id: 'departmentMembers',
    name: '부서 소속 및 겸직',
    attributes: [
      S('id', 64, true),
      S('userId', 64, true),
      S('deptId', 64, true),
      S('deptName', 128, true),
      BOOL('isPrimary', false),
      S('jobTitle', 64),
      INT('order', false, 0),
      S('assignedAt', 40),
      S('createdAt', 40),
      S('updatedAt', 40),
    ],
    indexes: [
      UQ('user_dept', ['userId', 'deptId']),
      IX('userId', ['userId']),
      IX('deptId', ['deptId']),
      IX('user_primary', ['userId', 'isPrimary']),
    ],
  },
  {
    id: 'companyInfo',
    name: '회사정보',
    attributes: [
      S('id', 64), // default('main') → false
      S('name', 128, true),
      S('nameEn', 128),
      S('bizNo', 32),
      S('corpNo', 32),
      S('ceo', 64, true),
      S('foundedDate', 40),
      S('bizType', 64),
      S('bizItem', 64),
      S('companyType', 16),
      S('fiscalStart', 8),
      BOOL('active', true),
      S('tel', 32),
      S('fax', 32),
      S('email', 128),
      S('homepage', 256),
      S('address', 256),
      S('sysName', 128),
      S('reportHeader', 256),
      S('docFooter', 256),
      S('logoUrl', 512),
      S('logoPath', 256),
      BOOL('mask', true),
    ],
    indexes: [],
  },
  {
    id: 'companySites',
    name: '사업장',
    attributes: [S('name', 128, true), S('kind', 32, true), S('addr', 256), S('tel', 32), S('mgr', 64), BOOL('active', true)],
    indexes: [],
  },
  {
    id: 'commonCodes',
    name: '공통코드',
    attributes: [
      S('groupCode', 64, true),
      S('groupName', 128),
      S('code', 64, true),
      S('name', 128, true),
      INT('order'),
      BOOL('use', true),
      S('regBy', 64),
    ],
    indexes: [IX('groupCode', ['groupCode'])],
  },

  // ── 권한 / 설정 ──
  {
    id: 'roleGroups',
    name: '역할그룹',
    attributes: [
      S('code', 64, true),
      S('name', 128, true),
      S('desc', 512),
      BOOL('use', true),
      BOOL('isSystem', false),
      J('menuPermissions'),
      J('members'),
      J('permissions'),
    ],
    indexes: [],
  },
  {
    id: 'roleMappings',
    name: '역할그룹 매핑',
    attributes: [
      S('roleCode', 64, true),
      S('targetType', 32, true),
      S('targetId', 64, true),
      S('targetName', 128, false),
    ],
    indexes: [],
  },
  {
    id: 'approvalPostReadShares',
    name: '결재 후열 전달',
    attributes: [
      S('id', 64, true),
      S('docId', 64, true),
      S('docNo', 64),
      S('docTitle', 256),
      S('fromUserId', 64, true),
      S('fromUserName', 128),
      S('toUserId', 64, true),
      S('toUserName', 128),
      S('toUserDept', 128),
      S('memo', 1000),
      S('sentAt', 40, true),
      S('readAt', 40),
    ],
    indexes: [IX('toUserId', ['toUserId']), IX('docId', ['docId'])],
  },
  {
    id: 'backupPolicies',
    name: '백업정책',
    attributes: [S('id', 64, true), S('name', 128, true), S('cycle', 32), S('keep', 32), S('after', 32), S('size', 32), BOOL('on', false)],
    indexes: [],
  },
  {
    id: 'interfaces',
    name: '시스템 인터페이스',
    attributes: [
      S('id', 64, true),
      S('name', 128, true),
      S('target', 32), // enum-무default → false
      S('dir', 32),
      S('cycle', 32),
      S('last', 40),
      S('status', 16), // enum-무default → false
      S('addr', 256),
      S('method', 32),
      S('remark', 256),
    ],
    indexes: [],
  },
  {
    id: 'approvalForms',
    name: '결재 서식',
    attributes: [
      S('id', 64, true),
      S('code', 64, true),
      S('name', 128, true),
      S('icon', 16),
      S('docTitle', 128),
      S('closing', 128),
      J('fields', 65535), // array of formField (대형)
      BOOL('active', true),
      INT('order'),
      BOOL('system', false),
      S('folderId', 64),
      S('recipientDeptId', 64),
      S('recipientUserId', 64),
      BOOL('recipientDrafter'),
      INT('allowedPositionFromRank'),
      INT('allowedPositionToRank'),
      SA('allowedDeptIds', 64),
      S('preservationPeriod', 32),
      S('securityLevel', 16),
      S('visibility', 16),
    ],
    indexes: [IX('code', ['code'])],
  },
  {
    id: 'approvalRouteRules',
    name: '결재선 룰',
    attributes: [
      S('id', 64, true),
      S('name', 128, true),
      INT('priority'),
      BOOL('active', true),
      S('docType', 32),
      S('conditionKey', 64),
      SA('conditionValues', 64),
      J('deptScope', 2000), // deptScope 중첩객체(kind/deptId/deptType)
      INT('positionFromRank'),
      INT('positionToRank'),
      INT('amountFrom'),
      INT('amountTo'),
      J('steps'), // array of routeStep
    ],
    indexes: [IX('docType', ['docType']), IX('priority', ['priority'])],
  },
  {
    id: 'approvalFolders',
    name: '결재 서식 폴더',
    attributes: [S('id', 64, true), S('name', 128, true), INT('order')],
    indexes: [],
  },

  // ── 거래처 / 품목 ──
  {
    id: 'vendors',
    name: '거래처',
    attributes: [
      S('code', 64, true),
      S('name', 128, true),
      S('type', 32),
      S('use', 16),
      S('bizNo', 32),
      S('ceo', 64),
      S('manager', 64),
      S('addr', 256),
      INT('creditLimit'),
      S('grade', 16),
    ],
    indexes: [IX('type', ['type'])],
  },
  {
    id: 'items',
    name: '품목',
    attributes: [
      S('code', 64, true),
      S('name', 128, true),
      S('spec', 128),
      S('unit', 16),
      S('type', 32),
      S('use', 16),
      INT('safetyStock'),
      S('remark', 256),
    ],
    indexes: [IX('type', ['type'])],
  },
  {
    id: 'creditLimits',
    name: '여신한도',
    attributes: [S('cust', 128, true), INT('limit'), INT('balance'), S('grade', 16)],
    indexes: [IX('cust', ['cust'])],
  },

  // ── 결재 (트랜잭션 보존) ──
  {
    // 필드가 40여개·깊은 중첩(steps·fieldValues·execution·postApproval*…)이라
    // **전체 문서를 payload(JSON)에 통짜 저장** + 쿼리/표시용 스칼라 컬럼만 별도.
    // 필드 유실 0, 스키마 진화에 안전. (로드 후 JS 필터가 정본이라 서버쿼리 불필요)
    id: 'approvalDocs',
    name: '전자결재 문서',
    attributes: [
      S('id', 64, true),
      S('docNo', 64, true),
      S('docType', 32, true),
      S('title', 200, true),
      S('drafterId', 64, true),
      S('status', 16),
      S('drafterName', 64),
      J('payload', 1000000), // ApprovalDoc 전체 JSON (SSOT)
    ],
    indexes: [IX('docNo', ['docNo']), IX('drafterId', ['drafterId']), IX('status', ['status'])],
  },
  {
    id: 'documentExecutions',
    name: '문서 시행(실행)',
    attributes: [
      S('id', 64), // = $id, bare z.string → false
      S('documentId', 64, true), // FK→approvalDocs → 강제 required
      S('docNo', 64),
      S('docTitle', 200),
      S('docType', 32),
      S('drafterId', 64),
      S('drafterName', 64),
      S('targetDeptId', 64),
      S('targetDeptNameSnapshot', 128),
      S('assigneeId', 64),
      S('assigneeNameSnapshot', 128),
      S('status', 16), // executionStatus enum
      S('visibility', 16),
      S('dispatchedAt', 40),
      S('receivedAt', 40),
      S('assignedAt', 40),
      S('completedAt', 40),
      S('updatedAt', 40),
      S('comment', 1000),
      S('returnReasonType', 32),
      INT('claimVersion', false, 0), // 원자 claim 낙관적 락(버전 증가). 도메인 무관 저장전용.
    ],
    indexes: [IX('documentId', ['documentId']), IX('targetDeptId', ['targetDeptId']), IX('status', ['status'])],
  },
  {
    // Firestore 서브컬렉션 documentExecutions/{id}/history 를 평탄화(executionId FK).
    id: 'executionHistory',
    name: '시행 이력',
    attributes: [
      S('eventId', 64), // = $id, bare → false
      S('executionId', 64, true), // FK→documentExecutions → 강제 required
      S('type', 32), // enum → false
      S('actorId', 64),
      S('actorName', 64),
      S('comment', 1000),
      S('createdAt', 40),
    ],
    indexes: [IX('executionId', ['executionId'])],
  },

  // ── 기타 ──
  {
    id: 'systemLogs',
    name: '시스템 로그',
    attributes: [S('id', 64, true), S('at', 40, true), S('user', 64, true), S('type', 32), S('screen', 128), S('detail', 1000), S('ip', 64)],
    indexes: [IX('at', ['at']), IX('user', ['user'])],
  },
  {
    // 채번 시퀀스. 문서 $id = 채널(예: AP-20260812). 전자결재 채번은 보존(SO-*는 폐기).
    id: 'counters',
    name: '채번 카운터',
    attributes: [INT('seq', true)],
    indexes: [],
  },

  // ── 영업 (fresh 전환 — 기존 데이터 폐기, 컬렉션만 신규) ──
  {
    id: 'salesOrders',
    name: '수주',
    attributes: [S('no', 64, true), S('customer', 128, true), S('orderDate', 40), S('reqDeliveryDate', 40), S('paymentTerms', 64), S('salesperson', 64), J('lines')],
    indexes: [],
  },
  {
    id: 'quotes',
    name: '견적',
    attributes: [S('no', 64, true), S('cust', 128, true), S('item', 128), INT('qty'), S('amt', 32), S('sent', 40), S('progress', 32)],
    indexes: [],
  },
  {
    id: 'shipments',
    name: '출하',
    attributes: [S('no', 64, true), S('salesOrder', 64, true), S('customer', 128), S('item', 64, true), S('itemName', 128), INT('qty'), S('location', 64), S('warehouse', 32), S('status', 16)],
    indexes: [],
  },
  {
    id: 'taxInvoices',
    name: '세금계산서',
    attributes: [S('no', 64, true), S('sale', 64, true), S('cust', 128, true), S('type', 32, true), INT('amt'), S('date', 40), S('status', 32, true), S('nts', 32)],
    indexes: [],
  },
  {
    id: 'salesRevenues',
    name: '매출',
    attributes: [S('no', 64, true), S('doNo', 64, true), S('cust', 128, true), S('date', 40), INT('supply'), INT('vat'), INT('total'), S('status', 16)],
    indexes: [],
  },
  {
    id: 'salesCollections',
    name: '수금',
    attributes: [S('no', 64, true), S('cust', 128, true), S('date', 40, true), S('method', 32, true), INT('amt'), S('doc', 64), S('match', 64)],
    indexes: [],
  },
  {
    id: 'accountsReceivable',
    name: '채권',
    attributes: [S('cust', 128, true), INT('limit'), INT('d30'), INT('d60'), INT('over'), S('status', 16)],
    indexes: [],
  },
  {
    id: 'posts',
    name: '게시판 게시글',
    attributes: [
      S('id', 64, true),
      S('boardId', 64, true),
      S('title', 200, true),
      S('content', 8000, true),
      S('author', 64, true),
      S('date', 40, true),
      INT('views', false, 0),
      BOOL('isPinned', false),
      BOOL('hasAttachment', false),
      J('attachedFiles', 8000),
    ],
    indexes: [IX('boardId', ['boardId'])],
  },

  // ── 업무 모듈 (일정관리 / 자원예약 / 업무관리 / 전자설문) ──
  // repo 7개를 crudBackend 로 전환하면서 필요해진 컬렉션들. 근태(employees·attendance)는
  // 서버 전용 권한이라 이 스크립트가 아니라 인제스트 쪽 프로비저닝이 담당한다.
  {
    id: 'calendarEvents',
    name: '일정',
    attributes: [
      S('id', 64, true),
      S('ownerUserId', 64, true),
      S('title', 100, true),
      S('date', 40, true),
      BOOL('allDay'),
      S('startTime', 8),
      S('endTime', 8),
      S('memo', 2000),
      /*
        공개 범위. 기존 문서에는 이 세 필드가 없고, 없으면 도메인 스키마가 `PRIVATE`로
        읽으므로 마이그레이션 없이도 예전 일정은 나만 보는 상태로 남는다.
        한글 값이 아니라 영문 코드라 enum도 가능하지만, 다른 컬렉션과 같이 String으로 둔다.
      */
      S('visibility', 16),
      S('deptId', 64),
      S('projectId', 64),
      S('createdAt', 40),
      S('updatedAt', 40),
      /*
        시작 10분 전 리마인더를 보냈는지. 기본값 false — 기존 문서는 전부 "아직 안 보냄"으로
        읽혀 리마인더 대상이 될 수 있지만, 이미 지난 일정이라 스케줄 쿼리(날짜=오늘) 밖이라
        실제로 걸리지 않는다. 한 번 보내면 true로 바꿔 같은 일정을 다시 보내지 않는다.
      */
      BOOL('reminded', false),
      S('eventType', 32),
      SA('attendeeUserIds', 64),
    ],
    /*
      공유 조회는 소유자 외에 부서·프로젝트로도 찾는다. 지금 repo는 전건을 읽어 거르지만
      서버측 질의로 옮길 때 필요하므로 인덱스를 미리 만들어 둔다.
    */
    indexes: [
      IX('calOwner', ['ownerUserId']),
      IX('calDate', ['date']),
      IX('calVisibility', ['visibility']),
      IX('calDept', ['deptId']),
      IX('calProject', ['projectId']),
      /* 리마인더 함수가 매 실행마다 던지는 질의와 같은 모양(날짜+미발송+시간 일정). */
      IX('calReminder', ['date', 'reminded', 'allDay']),
    ],
  },
  {
    id: 'workPlans',
    name: '업무계획',
    /*
      일정관리(calendarEvents)와 자매 컬렉션이지만 공유 범위 필드가 없다 — 전체 보기는
      항상 전원 공개고, 고치는 건 본인 것만(repo가 ownerUserId로 막는다). 시간 개념도
      없어 시작/종료 시각 필드가 없다. 제목/메모로도 안 나눈다 — 구글시트 한 칸에 적던
      습관 그대로 자유 형식 텍스트 한 덩어리(content)다.
    */
    attributes: [
      S('id', 64, true),
      S('ownerUserId', 64, true),
      S('date', 40, true),
      S('content', 1000, true),
      S('createdAt', 40),
      S('updatedAt', 40),
    ],
    indexes: [
      IX('wpOwner', ['ownerUserId']),
      IX('wpDate', ['date']),
    ],
  },
  {
    id: 'resources',
    name: '예약 자원',
    attributes: [
      S('id', 64, true),
      S('code', 30, true),
      S('name', 60, true),
      EN('typeCode', ['ROOM', 'VEHICLE', 'EQUIPMENT', 'SUPPLY']),
      EN('bookingMode', ['TIME_SLOT', 'QUANTITY']),
      S('location', 100, true),
      S('description', 300),
      INT('capacity'),
      INT('totalQuantity'),
      S('unitCode', 20),
      S('managerUserId', 64),
      S('ownerDeptId', 64),
      EN('approvalMode', ['INSTANT', 'APPROVAL']),
      INT('slotMinutes'),
      INT('minDurationMinutes'),
      INT('maxDurationMinutes'),
      INT('bufferBeforeMinutes'),
      INT('bufferAfterMinutes'),
      INT('maxAdvanceDays'),
      INT('cancelDeadlineMinutes'),
      S('availableFrom', 8),
      S('availableTo', 8),
      EN('status', ['ACTIVE', 'MAINTENANCE', 'INACTIVE']),
      S('imageUrl', 512),
      S('notes', 500),
      S('createdBy', 64, true),
      S('createdAt', 40),
      S('updatedBy', 64, true),
      S('updatedAt', 40),
    ],
    indexes: [IX('resCode', ['code']), IX('resStatus', ['status'])],
  },
  {
    id: 'resourceReservations',
    name: '자원 예약',
    attributes: [
      S('id', 64, true),
      S('resourceId', 64, true),
      S('resourceCodeSnapshot', 30, true),
      S('resourceNameSnapshot', 60, true),
      S('requesterUserId', 64, true),
      S('requesterDeptId', 64),
      S('title', 100, true),
      S('purpose', 500, true),
      S('startAt', 40),
      S('endAt', 40),
      INT('quantity'),
      INT('attendeeCount'),
      SA('attendeeUserIds', 64),
      EN('status', ['PENDING', 'CONFIRMED', 'REJECTED', 'CANCELLED', 'COMPLETED']),
      EN('approvalModeSnapshot', ['INSTANT', 'APPROVAL']),
      S('approverUserId', 64),
      S('approvedAt', 40),
      S('rejectedAt', 40),
      S('rejectionReason', 500),
      S('cancelledAt', 40),
      S('cancelReason', 500),
      INT('version'),
      S('createdAt', 40),
      S('updatedAt', 40),
    ],
    indexes: [
      IX('rsvResource', ['resourceId']),
      IX('rsvRequester', ['requesterUserId']),
      IX('rsvStatus', ['status']),
      IX('rsvStart', ['startAt']),
    ],
  },
  {
    id: 'workProjects',
    name: '업무 프로젝트',
    attributes: [
      S('id', 64, true),
      S('code', 30, true),
      S('name', 100, true),
      S('description', 2000),
      S('ownerUserId', 64, true),
      SA('memberUserIds', 64),
      S('deptId', 64),
      EN('visibility', ['PRIVATE', 'TEAM', 'COMPANY']),
      EN('status', ['PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED']),
      /*
        사업 유형 — 대분류는 **발주처가 있는가**로 가른다. 정산·검수·보고 의무, 매출 인식,
        산출물 소유권이 전부 이 경계에서 갈린다. 국책/민간은 그 아래 재원 속성이다.
        ([[프로젝트관리_고도화_계획서.md]] §1)
        자체사업이면 fundingType·clientName·contractNo 는 비어 있어야 한다(도메인 규칙).
      */
      EN('projectType', ['CONTRACT', 'INTERNAL']),
      EN('fundingType', ['GOVERNMENT', 'PRIVATE']),
      S('clientName', 100),
      S('contractNo', 60),
      S('contractStartAt', 40),
      S('contractEndAt', 40),
      S('startAt', 40),
      S('dueAt', 40),
      S('color', 16),
      S('chatRoomId', 64),
      S('createdBy', 64, true),
      S('createdAt', 40),
      S('updatedBy', 64, true),
      S('updatedAt', 40),
    ],
    indexes: [IX('prjOwner', ['ownerUserId']), IX('prjStatus', ['status']), IX('prjType', ['projectType'])],
  },
  {
    id: 'workTracks',
    name: '프로젝트 트랙',
    /*
      영업·사업관리·개발처럼 **동시에 도는 레인**. 이름은 코드에 박힌 enum이 아니라
      프로젝트마다 정하는 데이터다 — 영업팀도 사업관리팀도 각자 자체 사업을 하고, 어느
      구분에도 맞지 않는 사업도 있어서 유형(수주/자체)이 트랙 구성을 제약하지 않는다.
      개수는 0~N개고 0개면 대과업이 최상위가 된다.
      ([[프로젝트관리_고도화_계획서.md]] §2)

      트랙은 과업이 아니다 — 담당자·기간·진행률을 받지 않고 이름·순서·색만 가진다.
      트랙 진행률은 직속 대과업들에서 계산해 낸다.
    */
    attributes: [
      S('id', 64, true),
      S('projectId', 64, true),
      S('name', 40, true),
      INT('sortOrder', false, 0, 0, 9999),
      S('color', 16),
      S('createdBy', 64, true),
      S('createdAt', 40),
      S('updatedBy', 64, true),
      S('updatedAt', 40),
    ],
    indexes: [
      IX('trackProject', ['projectId', 'sortOrder']),
      /* 같은 프로젝트에 같은 이름 트랙이 둘이면 리포트에서 어느 쪽인지 구분할 수 없다. */
      UQ('trackName', ['projectId', 'name']),
    ],
  },
  {
    id: 'workPhases',
    name: 'WBS 단계',
    attributes: [
      S('id', 64, true),
      S('projectId', 64, true),
      S('name', 80, true),
      INT('sortOrder'),
      S('createdBy', 64, true),
      S('createdAt', 40),
      S('updatedBy', 64, true),
      S('updatedAt', 40),
    ],
    indexes: [IX('phaseProject', ['projectId'])],
  },
  {
    id: 'workTasks',
    name: 'WBS 작업',
    /*
      대→중→소 가변 깊이 과업 트리(최대 5단). `path`는 조상 순번을 이어 붙인 값으로
      **Appwrite에 재귀 쿼리·조인이 없어서** 둔다 — 없으면 "이 대과업 밑 전부"를 단계마다
      쿼리해야 해서 N+1로 터진다. 하위 전체는 `trackId` 일치 + `startsWith(path, ...)` 한 번,
      트리 정렬은 `path` 오름차순 하나로 끝난다.
      `path`는 같은 `trackId` 그룹 안에서만 유일하다.
      ([[프로젝트관리_고도화_계획서.md]] §3)

      진행률은 **리프에만** 저장한다. 상위 값은 저장하지 않고 읽은 뒤 계산한다 —
      저장하면 리프가 바뀔 때마다 조상 전부를 갱신해야 하는데 트랜잭션이 없어 한 번만
      실패해도 영구히 어긋난다(§4).
    */
    attributes: [
      S('id', 64, true),
      S('projectId', 64, true),
      S('trackId', 64),
      S('parentId', 64),
      INT('level', false, 1, 1, 5),
      S('path', 120),
      S('title', 150, true),
      S('description', 2000),
      S('assigneeUserId', 64, true),
      S('startAt', 40),
      S('dueAt', 40),
      EN('status', ['TODO', 'IN_PROGRESS', 'DONE']),
      INT('progress', false, undefined, 0, 100),
      INT('sortOrder'),
      S('completedAt', 40),
      INT('version'),
      S('createdBy', 64, true),
      S('createdAt', 40),
      S('updatedBy', 64, true),
      S('updatedAt', 40),
    ],
    indexes: [
      IX('taskProject', ['projectId']),
      IX('taskAssignee', ['assigneeUserId']),
      IX('taskTrack', ['projectId', 'trackId']),
      /* 하위 전체 조회(prefix)와 트리 정렬이 이 인덱스 하나로 해결된다. */
      IX('taskPath', ['projectId', 'trackId', 'path']),
    ],
  },
  {
    id: 'workTaskComments',
    name: '과업 댓글',
    /*
      taskId 가 null 이면 프로젝트 직속 댓글. 답글은 1단까지만(parentId) —
      무한 중첩하면 읽는 순서가 무너진다. ([[프로젝트관리_고도화_계획서.md]] §6)
    */
    attributes: [
      S('id', 64, true),
      S('projectId', 64, true),
      S('taskId', 64),
      S('parentId', 64),
      S('authorUserId', 64, true),
      S('body', 2000, true),
      S('createdAt', 40),
      S('updatedAt', 40),
    ],
    indexes: [
      IX('cmtProject', ['projectId', 'createdAt']),
      IX('cmtTask', ['taskId', 'createdAt']),
    ],
  },
  {
    id: 'workTaskFiles',
    name: '과업 첨부',
    /*
      실제 바이트는 fileStorage(VITE_STORAGE_DRIVER)가 들고 여기엔 메타만 남는다.
      storagePath 를 따로 두는 이유: 삭제할 때 URL 에서 경로를 되짚으면 드라이버마다
      규칙이 달라 깨진다. taskId 가 null 이면 과업에 묶이지 않은 프로젝트 직속 파일.
    */
    attributes: [
      S('id', 64, true),
      S('projectId', 64, true),
      S('taskId', 64),
      S('name', 255, true),
      S('url', 512, true),
      S('storagePath', 512),
      INT('size', false, 0, 0, 2_000_000_000),
      S('contentType', 100),
      S('uploadedBy', 64, true),
      S('uploadedAt', 40),
    ],
    indexes: [
      IX('fileProject', ['projectId', 'uploadedAt']),
      IX('fileTask', ['taskId']),
    ],
  },
  {
    id: 'surveys',
    name: '전자설문',
    attributes: [
      S('id', 64, true),
      S('title', 100, true),
      S('description', 1000),
      S('categoryCode', 64, true),
      S('ownerUserId', 64, true),
      EN('status', ['DRAFT', 'SCHEDULED', 'ACTIVE', 'CLOSED', 'ARCHIVED']),
      EN('audienceType', ['COMPANY', 'DEPARTMENT', 'USERS']),
      SA('audienceDeptIds', 64),
      SA('audienceUserIds', 64),
      BOOL('anonymous'),
      S('startsAt', 40),
      S('endsAt', 40),
      BOOL('showResultToRespondent'),
      INT('questionCount', false, 0),
      INT('responseCount', false, 0),
      S('publishedAt', 40),
      S('firstRespondedAt', 40),
      S('closedAt', 40),
      INT('version'),
      S('createdAt', 40),
      S('updatedAt', 40),
    ],
    indexes: [IX('surOwner', ['ownerUserId']), IX('surStatus', ['status'])],
  },
  {
    id: 'surveyQuestions',
    name: '설문 질문',
    attributes: [
      S('id', 64, true),
      S('surveyId', 64, true),
      EN('type', ['SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'SHORT_TEXT', 'LONG_TEXT', 'RATING']),
      S('title', 300, true),
      S('description', 500),
      BOOL('required'),
      INT('order'),
      J('options'), // array of surveyOption(id/label/order)
      S('ratingMinLabel', 30),
      S('ratingMaxLabel', 30),
      INT('maxLength'),
      S('createdAt', 40),
      S('updatedAt', 40),
    ],
    indexes: [IX('sqSurvey', ['surveyId'])],
  },
  {
    id: 'surveyResponses',
    name: '설문 응답',
    attributes: [
      S('id', 64, true),
      S('surveyId', 64, true),
      // 익명 설문에서는 두 필드가 비어 있다(응답자 역추적 불가가 설계 의도).
      S('respondentUserId', 64),
      S('respondentDeptId', 64),
      INT('surveyVersion'),
      S('submittedAt', 40),
    ],
    indexes: [IX('srSurvey', ['surveyId'])],
  },
  {
    id: 'surveyAnswers',
    name: '설문 답변',
    attributes: [
      S('id', 64, true),
      S('surveyId', 64, true),
      S('responseId', 64, true),
      S('questionId', 64, true),
      SA('selectedOptionIds', 64),
      S('textValue', 2000),
      INT('ratingValue', false, undefined, 1, 5),
      S('createdAt', 40),
    ],
    indexes: [
      IX('saSurvey', ['surveyId']),
      IX('saResponse', ['responseId']),
      IX('saQuestion', ['questionId']),
    ],
  },
  {
    id: 'surveyParticipations',
    name: '설문 참여기록',
    attributes: [
      // 문서 ID = `설문ID__사용자ID` — 중복 제출 경쟁에서 문서가 하나만 생기게 하는 결정적 키.
      S('id', 128, true),
      S('surveyId', 64, true),
      S('userId', 64, true),
      BOOL('responded'),
      S('respondedAt', 40),
    ],
    indexes: [IX('spSurvey', ['surveyId']), IX('spUser', ['userId'])],
  },

  // ── 메일 ──
  {
    id: 'mailAccounts',
    name: '메일 계정',
    /**
     * **서버 전용.** 브라우저는 이 컬렉션에 직접 붙지 못하고 mail Function만 API 키로 접근한다.
     *
     * 다른 컬렉션과 달리 `POC_PERMISSIONS`를 쓰면 안 된다. 누구나 read면 남의 메일 주소
     * 목록이 그대로 열리고, 누구나 update/delete면 남의 계정을 지우거나 서버 주소를 바꿔
     * 자격 증명을 탈취할 수 있다. `encryptedSecret`이 암호문이라는 것과는 별개 문제다.
     */
    permissions: [],
    attributes: [
      S('id', 64, true),
      /** 소유자. Function이 서명 토큰에서 도출한 uid와 대조해 남의 계정 접근을 막는다. */
      S('workfitUserId', 64, true),
      EN('provider', ['naver', 'daum', 'google', 'microsoft', 'custom']),
      S('email', 255, true),
      S('displayName', 50),
      /** IMAP·SMTP 인증 아이디. 주소와 다른 공급자가 있어 따로 둔다. */
      S('authUsername', 255),
      /**
       * 앱 비밀번호 암호문. `v1.{iv}.{authTag}.{ciphertext}`(AES-256-GCM, base64url).
       * 평문은 어디에도 저장하지 않고 Function이 인증 직전에만 푼다.
       */
      S('encryptedSecret', 1024, true),
      EN('authType', ['app_password', 'oauth2']),
      EN('transport', ['imap_smtp', 'gmail_api', 'microsoft_graph']),
      EN('status', ['active', 'error', 'disabled']),
      // custom 공급자용 접속 정보. 프리셋 공급자는 Function이 호스트를 알고 있어 비워 둔다.
      S('smtpHost', 255),
      INT('smtpPort'),
      EN('smtpSecurity', ['tls', 'starttls', 'plain']),
      S('imapHost', 255),
      INT('imapPort'),
      EN('imapSecurity', ['tls', 'starttls', 'plain']),
      S('signature', 1000),
      S('verifiedAt', 40),
      /** 실패 원인은 정규화된 코드만. 서버 내부 메시지는 남기지 않는다. */
      S('lastErrorCode', 64),
      S('createdAt', 40),
      S('updatedAt', 40),
    ],
    indexes: [
      IX('mailAcctOwner', ['workfitUserId']),
      // 같은 사용자가 같은 주소를 두 번 등록하지 못하게 DB에서 막는다(MailHub와 동일 제약).
      UQ('mailAcctOwnerEmail', ['workfitUserId', 'email']),
    ],
  },
  {
    /*
      발신 기록.

      보낸메일함은 IMAP 서버에 있고 거기엔 헤더뿐이라, 공용 메일 계정을 여럿이 쓰면
      "우리 팀 누가 보냈나"를 알 수 없다. From 표시 이름으로도 대개 갈리지만 그건
      문자열이라 동명이인이면 겹치고 공급자가 고쳐 쓸 수도 있다.
      `Message-ID`를 키로 확정 정보를 우리 쪽에 남긴다.

      우리 앱으로 보낸 메일만 기록된다 — 네이버 웹메일에서 직접 보낸 것은 여기 없고,
      그때는 화면이 From 헤더로 물러선다.
    */
    id: 'mailSentBy',
    name: '메일 발신 기록',
    /**
     * **서버 전용.** `mailAccounts`와 같은 이유다 — projectId는 브라우저 번들에 공개돼 있어
     * `Any` 권한이면 누구나 이 컬렉션을 읽고 **쓸 수 있다.** 발신자 표시의 근거가 되는
     * 기록을 아무나 위조할 수 있으면 기능 자체가 의미를 잃는다.
     * 화면은 이 컬렉션을 직접 읽지 않고 mail Function의 응답으로만 받는다.
     */
    permissions: [],
    attributes: [
      S('id', 64, true),
      /*
        조인 키는 Message-ID 자체가 아니라 그 해시(sha256 hex 64자)다. Message-ID는 길이가
        들쭉날쭉해 넉넉히 잡으면 인덱스 키 길이 상한에 걸리고(512로 만들었다가 실제로 걸렸다),
        짧게 자르면 잘린 뒤가 같은 메일끼리 뭉친다. 계산은 `sentBy.js`의 `messageIdKey`.
      */
      S('messageIdKey', 64, true),
      // 원본은 조회·디버깅용으로만 둔다. 인덱스를 걸지 않는다.
      S('messageId', 512),
      S('accountId', 64, true),
      S('workfitUserId', 64, true),
      // 보낸 시점의 이름 스냅샷. 사람이 나가거나 개명해도 그때 누가 보냈는지는 남는다.
      S('senderName', 30),
      S('sentAt', 40),
    ],
    indexes: [
      IX('sentByMessageKey', ['messageIdKey']),
      IX('sentByAccount', ['accountId']),
      IX('sentByUser', ['workfitUserId']),
    ],
  },
  {
    id: 'approvalProcessSettings',
    name: '결재 프로세스 설정',
    attributes: [
      S('key', 64, true),
      S('category', 64, true),
      S('name', 128, true),
      S('description', 500, true),
      BOOL('enabled', false),
      BOOL('isImplemented', false),
    ],
    indexes: [UQ('key', ['key'])],
  },
  // ── 갤러리 ──
  {
    id: 'gallery_folders',
    name: '갤러리 폴더',
    attributes: [
      S('id', 64, true),
      S('name', 255, true),
      S('description', 1000),
      S('parentId', 64),
      S('path', 1000),
      INT('depth', false, 0),
      INT('order', false, 0),
      S('coverImageUrl', 1000),
      BOOL('isSystem', false),
      S('createdBy', 64),
      S('creatorName', 64),
      S('creatorDept', 64),
      S('createdAt', 40, true),
      S('updatedAt', 40),
    ],
    indexes: [IX('parentId', ['parentId'])],
  },
  {
    id: 'gallery_photos',
    name: '갤러리 사진',
    attributes: [
      S('id', 64, true),
      S('folderId', 64, true),
      S('title', 255),
      S('caption', 2000),
      S('fileUrl', 1000, true),
      S('thumbnailUrl', 1000),
      S('fileName', 255),
      INT('fileSize', false, 0),
      S('mimeType', 64),
      INT('width', false),
      INT('height', false),
      S('eventDate', 40),
      S('authorId', 64),
      S('authorName', 64),
      S('authorDept', 64),
      S('createdAt', 40, true),
    ],
    indexes: [
      IX('folderId', ['folderId']),
      IX('createdAt', ['createdAt']),
    ],
  },
];

/** PoC 검증용 권한 — 누구나 CRUD. ⚠️ 운영 전 좁힐 것(계획서 §6). */
const POC_PERMISSIONS = [
  Permission.read(Role.any()),
  Permission.create(Role.any()),
  Permission.update(Role.any()),
  Permission.delete(Role.any()),
];

// ─────────────────────────────────────────────────────────────
// 유틸
// ─────────────────────────────────────────────────────────────
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

const isCode = (e: unknown, code: number) => (e as { code?: number })?.code === code;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────
// 멱등 연산
// ─────────────────────────────────────────────────────────────
async function ensureDatabase(dbs: Databases, dbId: string) {
  try {
    await dbs.get(dbId);
    console.log(`• database "${dbId}" 존재 — 건너뜀`);
  } catch (e) {
    if (!isCode(e, 404)) throw e;
    await dbs.create(dbId, 'workfit');
    console.log(`✓ database "${dbId}" 생성`);
  }
}

async function ensureCollection(dbs: Databases, dbId: string, c: CollectionDef) {
  try {
    await dbs.getCollection(dbId, c.id);
    console.log(`• collection "${c.id}" 존재 — 건너뜀`);
  } catch (e) {
    if (!isCode(e, 404)) throw e;
    await dbs.createCollection(dbId, c.id, c.name, c.permissions ?? POC_PERMISSIONS, /* documentSecurity */ false);
    console.log(`✓ collection "${c.id}" 생성`);
  }
}

async function existingAttrKeys(dbs: Databases, dbId: string, collId: string): Promise<Set<string>> {
  const res = await dbs.listAttributes(dbId, collId, ATTR_PAGE);
  return new Set(res.attributes.map((a) => (a as unknown as { key: string }).key));
}

async function ensureAttribute(dbs: Databases, dbId: string, collId: string, a: AttrDef, have: Set<string>) {
  if (have.has(a.key)) {
    // enum 은 값 목록이 늘어날 수 있다 — 정의에 새 값이 있으면 기존 값을 지우지 않고 추가만 한다.
    if (a.kind === 'enum') {
      const cur = (await dbs.getAttribute(dbId, collId, a.key)) as Models.AttributeEnum;
      const missing = a.elements.filter((el) => !cur.elements.includes(el));
      if (missing.length > 0) {
        // xdefault 는 생략할 수 없다(기본값이 없으면 null 을 명시)
        await dbs.updateEnumAttribute(dbId, collId, a.key, [...cur.elements, ...missing], cur.required, (cur.default ?? null) as unknown as string);
        console.log(`  ✓ attr "${a.key}" enum 값 추가: ${missing.join(', ')}`);
        return;
      }
    }
    console.log(`  • attr "${a.key}" 존재 — 건너뜀`);
    return;
  }
  try {
    if (a.kind === 'string') {
      await dbs.createStringAttribute(dbId, collId, a.key, a.size, a.required ?? false, undefined, a.array ?? false);
    } else if (a.kind === 'enum') {
      await dbs.createEnumAttribute(dbId, collId, a.key, a.elements, a.required ?? false, a.xdefault);
    } else if (a.kind === 'integer') {
      await dbs.createIntegerAttribute(dbId, collId, a.key, a.required ?? false, a.min, a.max, a.xdefault, a.array ?? false);
    } else if (a.kind === 'float') {
      await dbs.createFloatAttribute(dbId, collId, a.key, a.required ?? false, undefined, undefined, undefined, a.array ?? false);
    } else {
      await dbs.createBooleanAttribute(dbId, collId, a.key, a.required ?? false, a.xdefault);
    }
    console.log(`  ✓ attr "${a.key}" (${a.kind}) 생성`);
  } catch (e) {
    if (isCode(e, 409)) console.log(`  • attr "${a.key}" 이미 존재(409) — 건너뜀`);
    else throw e;
  }
}

/**
 * 속성은 서버에서 비동기 처리 — 인덱스 생성 전 전부 available 될 때까지 폴링.
 *
 * 대기 한도는 속성 수에 비례한다(과거 60초 고정). 큰 컬렉션일수록 워커가 오래 걸린다.
 * 단 `resources`(29개)에서 났던 무한 대기의 진짜 원인은 시간이 아니라 **위 ATTR_PAGE 의
 * 페이지네이션**이었다 — 25건 상한 밖의 속성은 목록에 없으니 status 판정이 영원히
 * pending 이었다. 시간 여유는 보조 수단일 뿐이라 상한 명시가 본질적인 수정이다.
 */
async function waitAttributesAvailable(dbs: Databases, dbId: string, collId: string, keys: string[]) {
  const deadline = Date.now() + Math.max(120_000, keys.length * 10_000);
  for (;;) {
    const res = await dbs.listAttributes(dbId, collId, ATTR_PAGE);
    const byKey = new Map(res.attributes.map((a) => [(a as unknown as { key: string }).key, a as unknown as { status: string }]));
    const pending = keys.filter((k) => byKey.get(k)?.status !== 'available');
    if (pending.length === 0) return;
    if (Date.now() > deadline) throw new Error(`속성 available 대기 시간 초과: ${pending.join(', ')}`);
    console.log(`  … 속성 처리 대기(${pending.length}개): ${pending.join(', ')}`);
    await sleep(1500);
  }
}

async function ensureIndex(dbs: Databases, dbId: string, collId: string, idx: IndexDef, haveIdx: Set<string>) {
  if (haveIdx.has(idx.key)) {
    console.log(`  • index "${idx.key}" 존재 — 건너뜀`);
    return;
  }
  try {
    await dbs.createIndex(dbId, collId, idx.key, idx.type, idx.attributes);
    console.log(`  ✓ index "${idx.key}" [${idx.attributes.join(', ')}] 생성`);
  } catch (e) {
    if (isCode(e, 409)) console.log(`  • index "${idx.key}" 이미 존재(409) — 건너뜀`);
    else throw e;
  }
}

// ─────────────────────────────────────────────────────────────
// 메인
// ─────────────────────────────────────────────────────────────
async function main() {
  const isProd = process.argv.includes('--prod');
  const endpoint = readEnv('APPWRITE_ENDPOINT') ?? readEnv('VITE_APPWRITE_ENDPOINT');
  const projectId = isProd
    ? '6a6bf85e002acb7f71d6'
    : (readEnv('APPWRITE_PROJECT_ID') ?? readEnv('VITE_APPWRITE_PROJECT_ID'));
  const databaseId = readEnv('APPWRITE_DATABASE_ID') ?? readEnv('VITE_APPWRITE_DATABASE_ID') ?? 'workfit';
  /**
   * `.env.local`은 dev·prod 키를 접미어로 구분해 둔다(`APPWRITE_API_KEY_DEV` / `_PROD`).
   * --prod 지정 시 APPWRITE_API_KEY_PROD 및 운영 프로젝트 ID(6a6bf85e002acb7f71d6) 자동 매핑.
   */
  const apiKey = isProd
    ? (readEnv('APPWRITE_API_KEY_PROD') ?? readEnv('APPWRITE_API_KEY'))
    : (readEnv('APPWRITE_API_KEY') ?? readEnv('APPWRITE_API_KEY_DEV'));

  const missing = [
    ['APPWRITE_ENDPOINT', endpoint],
    ['APPWRITE_PROJECT_ID', projectId],
    ['APPWRITE_DATABASE_ID', databaseId],
    ['APPWRITE_API_KEY', apiKey],
  ].filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    console.error(`필수 env 누락: ${missing.join(', ')}\n(.env.local 또는 환경변수에 설정하세요. API_KEY는 서버 비밀키)`);
    process.exit(1);
  }

  const client = new Client()
    .setEndpoint(endpoint as string)
    .setProject(projectId as string)
    .setKey(apiKey as string);
  const dbs = new Databases(client);
  const dbId = databaseId as string;

  /**
   * 적용 대상 한정 — `--only=coll1,coll2`.
   *
   * 이 스크립트는 기본적으로 **파일에 정의된 컬렉션 전부**를 만든다. dev에서는 그게 맞지만
   * 운영에 릴리스 한 건을 반영할 때는 이번에 필요한 것만 건드려야 한다. 운영에 아직 없는
   * 컬렉션까지 한꺼번에 생기면 그 순간부터 `Any` 권한 컬렉션이 늘어난다.
   */
  const onlyArg = process.argv.find((a) => a.startsWith('--only='));
  const only = onlyArg ? onlyArg.slice('--only='.length).split(',').map((s) => s.trim()).filter(Boolean) : null;
  const targets = only ? COLLECTIONS.filter((c) => only.includes(c.id)) : COLLECTIONS;
  if (only) {
    const unknown = only.filter((id) => !COLLECTIONS.some((c) => c.id === id));
    if (unknown.length) {
      console.error(`✗ 정의에 없는 컬렉션: ${unknown.join(', ')}`);
      process.exit(1);
    }
  }

  console.log(`▶ Appwrite 스키마 적용 — ${endpoint} / project ${projectId} / db ${dbId}`);
  console.log(only ? `  대상 한정: ${only.join(', ')}\n` : `  대상: 전체 ${targets.length}종\n`);

  await ensureDatabase(dbs, dbId);

  for (const c of targets) {
    console.log(`\n[${c.id}] ${c.name}`);
    await ensureCollection(dbs, dbId, c);

    const haveAttr = await existingAttrKeys(dbs, dbId, c.id);
    for (const a of c.attributes) await ensureAttribute(dbs, dbId, c.id, a, haveAttr);

    await waitAttributesAvailable(dbs, dbId, c.id, c.attributes.map((a) => a.key));

    const coll = await dbs.getCollection(dbId, c.id);
    const haveIdx = new Set((coll.indexes as Models.Index[]).map((i) => i.key));
    for (const idx of c.indexes) await ensureIndex(dbs, dbId, c.id, idx, haveIdx);
  }

  console.log('\n✅ 스키마 적용 완료. (재실행해도 안전 — 멱등)');
}

main().catch((e) => {
  console.error('\n✗ 실패:', e instanceof Error ? e.message : e);
  process.exit(1);
});
