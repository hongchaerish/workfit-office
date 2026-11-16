import { userSchema, type User } from '@/domain/user/schema';

/**
 * 조직·기준 정보 실시간 반영 — 규칙만(연결은 useOrgRealtime).
 * 조직 정보는 5분 동안 받아 둔 값을 쓰는데(queryDefaults), 누가 고치면 서버 신호를 받아 그 데이터만 바로 다시 받는다.
 * 다시 받기는 캐시 무효화(invalidate)로만 한다 — 받아 둔 값은 새 값이 올 때까지 그대로 보이고(isLoading 안 켜짐),
 * 화면을 지우거나 새로 그리지 않는다.
 */

const PROFILE_BUNDLE = [['employeeProfiles'], ['users']];

/** 컬렉션 → 다시 받을 react-query 키(앞부분 일치). 인명 목록은 부서·직급·직책 이름을 붙여 오고, 사용자 목록은 인명을 붙여 온다. */
const REFRESH: Record<string, string[][]> = {
  users: [['users']],
  employeeProfiles: PROFILE_BUNDLE,
  attendanceTargets: PROFILE_BUNDLE,
  birthdaySettings: PROFILE_BUNDLE,
  departments: [['departments'], ...PROFILE_BUNDLE],
  positions: [['positions'], ...PROFILE_BUNDLE],
  jobTitles: [['jobTitles'], ...PROFILE_BUNDLE],
  departmentMembers: [['departmentMembers'], ['orgTree']],
  roleGroups: [['roleGroups']],
  roleMappings: [['roleGroups']],
  authRoles: [['authRoles']],
  authAssignments: [['authAssignments']],
  holidays: [['holidays']],
  commonCodes: [['commonCodes']],
};

export const ORG_COLLECTIONS = Object.keys(REFRESH);

export function keysToRefresh(collection: string): string[][] {
  return REFRESH[collection] ?? [];
}

/** `databases.{db}.collections.{coll}.documents.{id}.update` / `databases.{db}.tables.{coll}.rows.{id}.update` → coll */
export function collectionOfEvents(events: string[]): string | null {
  for (const e of events) {
    const m = /^databases\.[^.]+\.(?:collections|tables)\.([^.]+)\./.exec(e);
    if (m) return m[1];
  }
  return null;
}

/**
 * 화면과 상관없는 칸 — 사용자 문서는 이 칸들 때문에 자주 저장된다(로그인·메신저 방 열기·알림 기기 등록).
 * 소속·연락처는 계정의 옛 사본이라 화면은 인명관리 값을 쓴다. 비밀번호는 화면에 안 쓴다.
 */
const IGNORED_USER_FIELDS = new Set([
  'lastLogin', 'activeChatRoomId', 'fcmToken', 'fcmTokens', 'fcmTokensRecall', 'notificationPrefs', 'password',
  'dept', 'position', 'jobTitle', 'phone',
]);

/** 사용자 문서 신호가 화면에 보이는 내용을 바꿨는가. 모르면(받아 둔 적 없음·읽을 수 없음) 바뀐 것으로 본다. */
export function userChangeMatters(prev: User | undefined, payload: Record<string, unknown>): boolean {
  if (!prev) return true;
  const parsed = userSchema.safeParse({ ...payload, id: payload.id ?? payload.$id });
  if (!parsed.success) return true;
  const next = parsed.data as Record<string, unknown>;
  const before = prev as unknown as Record<string, unknown>;
  for (const k of Object.keys(next)) {
    if (IGNORED_USER_FIELDS.has(k)) continue;
    if (JSON.stringify(next[k] ?? null) !== JSON.stringify(before[k] ?? null)) return true;
  }
  return false;
}
