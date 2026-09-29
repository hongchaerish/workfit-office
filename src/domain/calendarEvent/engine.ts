import type { CalendarEvent } from './schema';
import type { Department } from '@/domain/department/schema';
import type { User } from '@/domain/user/schema';

/**
 * 일정 접근 판정에 필요한 사용자 정보.
 *
 * 업무관리 `ProjectAccessContext`와 같은 모양에 `projectIds`만 더했다. 프로젝트 공유는
 * "이 사람이 그 프로젝트 참여자인가"를 물어야 하는데, 판정 함수가 프로젝트를 직접 조회하면
 * 순수 함수가 아니게 되고 테스트도 못 한다. 참여 프로젝트는 부르는 쪽에서 한 번 모아 넘긴다.
 */
export interface CalendarAccessContext {
  userId: string;
  /** 소속 부서 ID. `user.dept`(이름)를 부서 목록으로 옮긴 값이다. 없으면 null. */
  deptId: string | null;
  /** 참여 중인 프로젝트 ID 목록. */
  projectIds: string[];
  active: boolean;
}

/**
 * 이 일정을 볼 수 있는가.
 *
 * 소유자는 공개 범위와 무관하게 항상 본다. 그 외에는 범위별로 갈린다.
 * `deptId`·`projectId`는 해당 범위일 때만 본다 — 범위를 바꿔도 예전 값이 남아 있을 수 있어서,
 * 범위를 먼저 확인하지 않으면 `PRIVATE`인데 부서에 새는 일이 생긴다.
 */
export function canViewEvent(actor: CalendarAccessContext, event: CalendarEvent): boolean {
  if (!actor.active) return false;
  // 본인 일정이면 항상 허용
  if (event.ownerUserId === actor.userId) return true;

  // 참여자(attendee)로 등록된 회의/일정이면 항상 허용
  if (event.attendeeUserIds && event.attendeeUserIds.includes(actor.userId)) return true;

  // 사내행사는 전 직원 공통 일정으로 항상 허용
  if (event.eventType === 'COMPANY_EVENT') return true;

  switch (event.visibility) {
    case 'PRIVATE':
      return false;
    case 'COMPANY':
      return true;
    case 'TEAM':
      return actor.deptId !== null && actor.deptId === event.deptId;
    case 'PROJECT':
      return event.projectId !== null && actor.projectIds.includes(event.projectId);
    default:
      // 모르는 범위는 닫는다. 새 범위가 생겼는데 여기를 안 고쳤다면 안 보이는 편이 낫다.
      return false;
  }
}

/**
 * 이 일정을 고치거나 지울 수 있는가.
 *
 * 소유자만이다. 공유는 **보여주기**까지이고 남의 일정을 고치지는 못한다 —
 * 부서 공유 일정을 부서원 아무나 지울 수 있으면 공유를 못 쓰게 된다.
 */
export function canManageEvent(actor: CalendarAccessContext, event: CalendarEvent): boolean {
  return actor.active && event.ownerUserId === actor.userId;
}

/** 내가 만든 일정인가. 화면이 공유받은 일정과 내 일정을 다르게 그리는 데 쓴다. */
export const isOwnEvent = (actor: CalendarAccessContext, event: CalendarEvent): boolean =>
  event.ownerUserId === actor.userId;

/** 사용자가 참여자로 초대된 일정인가 */
export const isAttendeeEvent = (actor: CalendarAccessContext, event: CalendarEvent): boolean =>
  Boolean(event.attendeeUserIds && event.attendeeUserIds.includes(actor.userId) && event.ownerUserId !== actor.userId);

/** 사내행사 일정인가 (휴가·외근·출장은 사내행사가 아님) */
export const isCompanyEvent = (event: CalendarEvent): boolean =>
  event.eventType === 'COMPANY_EVENT' || (event.visibility === 'COMPANY' && event.eventType !== 'VACATION' && event.eventType !== 'OUTSIDE');

/**
 * 캘린더 노출 대상 일정 판정:
 * "일정 관리에 뜨는 일정은 무조건 회의나 미팅, 또는 전자결재를 통해 완료된 출장/외근/연차 등의 내용만 나와야해. 그밖의 자잘한 개인업무는 뜰 필요 없어."
 *
 * 1. 전자결재 승인 건 (출장·외근·휴가/연차 등): CAL-APPR- 또는 approval- 접두사, 또는 OUTSIDE/VACATION 유형
 * 2. 회의·미팅: eventType === 'MEETING' 또는 제목에 '회의'·'미팅' 포함
 * 3. 사내행사: eventType === 'COMPANY_EVENT'
 *
 * 그 밖의 자잘한 개인 업무(GENERAL)나 단순 To-Do는 캘린더 노출에서 제외합니다.
 */
export function isOfficialCalendarEvent(event: CalendarEvent): boolean {
  // 1. 전자결재 승인 일정 (외근/출장/휴가 등)
  if (
    event.id.startsWith('CAL-APPR-') ||
    event.id.startsWith('approval-') ||
    event.eventType === 'OUTSIDE' ||
    event.eventType === 'VACATION'
  ) {
    return true;
  }
  // 2. 회의 및 미팅
  if (event.eventType === 'MEETING' || event.title.includes('회의') || event.title.includes('미팅')) {
    return true;
  }
  // 3. 사내행사
  if (event.eventType === 'COMPANY_EVENT') {
    return true;
  }
  return false;
}

/* ------------------------------------------------------------- 관리자 종합 조회 */

/**
 * 팀 일정(관리자 종합 조회)의 열람 범위.
 *
 * - `all`: 전 직원 일정. 경영진(대표·상무)과 개발 담당자.
 * - `depts`: 이름이 나열된 부서 소속의 일정만. 부서장(팀장).
 * - `null`(함수 반환): 팀 일정 화면 자체가 열리지 않는다.
 *
 * ⚠ 일정 컬렉션은 브라우저가 직접 읽는 UI-게이트 모델이라(다른 업무 모듈과 동일,
 * DEPLOY_PREP §2.4) 이 판정은 화면 노출 제어다. 서버 강제까지 가려면 근태처럼
 * Function 경유로 조회를 옮겨야 하고, 그때 이 규칙을 서버로 그대로 옮기면 된다.
 */
export type CalendarSupervisorScope =
  | { kind: 'all' }
  | { kind: 'depts'; deptNames: string[] };

/**
 * 전 직원 일정을 볼 수 있는 직급·직책. 근태(caps-ingest)의 FULL_ACCESS_TITLES와 같은
 * 목록 — 두 화면의 "경영진" 기준이 달라지면 사용자가 규칙을 신뢰할 수 없다.
 * 부분 일치라 '대표이사'·'상무이사'처럼 접미어가 붙어도 걸린다.
 */
const FULL_ACCESS_TITLES = ['대표', '상무', '전무', '위원장'];

/**
 * 직급으로 안 걸리지만 전 직원 일정을 봐야 하는 사람 — 지정 인원 하드코딩.
 *
 * 시드(U003 등)와 운영 실데이터의 사용자 ID가 다를 수 있어 ID와 이름 어느 쪽이 걸려도
 * 인정한다. 손승원(상무)·김경일(대표)은 직급 규칙으로도 걸리지만, "이 두 사람은 반드시"
 * 라는 지시가 있었으므로 직급 표기가 바뀌어도 깨지지 않게 명단에도 둔다.
 * 권한 그룹 개념이 생기면 이 명단을 지우고 그 값으로 판정할 것.
 */
const FULL_ACCESS_IDS = new Set(['U003', 'U011', 'U012', 'U018']);
const FULL_ACCESS_NAMES = new Set(['손승원', '김경일', '김승기', '홍채원', '허진욱']);

/**
 * 이 사용자의 팀 일정 열람 범위. 없으면 null — 화면은 탭을 그리지 않는다.
 *
 * 부서장 판정은 `departments.headUserId`가 정본이고(근태 서버와 동일), 직책 '팀장' 폴백은
 * **본인 소속 부서에 headUserId가 아직 안 채워진 경우에만** 동작한다 — 데이터 미비로
 * 팀장이 조용히 권한을 잃지 않게 하는 안전망이지, 정본을 이기는 규칙이 아니다.
 * headUserId가 딴 사람으로 채워져 있는데도 직책만으로 부여하면, 부서장이 교체된 뒤
 * 전 팀장의 직책이 정리되지 않은 동안 그 사람이 부서 범위를 계속 갖게 된다.
 */
export function resolveCalendarSupervisor(
  user: Pick<User, 'id' | 'name' | 'dept' | 'position' | 'jobTitle' | 'status'>,
  departments: Pick<Department, 'name' | 'headUserId'>[],
): CalendarSupervisorScope | null {
  if (user.status !== '사용') return null;

  const title = `${user.position} ${user.jobTitle}`;
  if (
    FULL_ACCESS_IDS.has(user.id)
    || FULL_ACCESS_NAMES.has(user.name.trim())
    || FULL_ACCESS_TITLES.some((keyword) => title.includes(keyword))
  ) {
    return { kind: 'all' };
  }

  const headed = departments.filter((dept) => dept.headUserId === user.id).map((dept) => dept.name);
  if (headed.length > 0) return { kind: 'depts', deptNames: headed };
  if (user.jobTitle.trim() === '팀장' && user.dept) {
    const own = departments.find((dept) => dept.name === user.dept);
    // 부서 레코드가 없는 것도 데이터 미비다 — 안전망 취지대로 부여한다.
    if (!own || !own.headUserId) return { kind: 'depts', deptNames: [user.dept] };
  }
  return null;
}

/** 팀 일정 화면에서 가린 일정의 표시 제목. 화면이 이 값으로 "클릭 무시"도 판단하지 않는다 — 판정은 아래 함수로. */
export const MASKED_EVENT_TITLE = '비공개 일정';

/** 팀 일정 화면에서 내용 없이 시간만 보여야 하는 일정인가 — 남의 '나만 보기' 일정. */
export const isMaskedForSupervisor = (viewerId: string, event: CalendarEvent): boolean =>
  event.visibility === 'PRIVATE' && event.ownerUserId !== viewerId;

/**
 * 관리자 종합 조회용 가림 처리.
 *
 * 남의 '나만 보기' 일정은 **있다는 사실(시간대)만** 보이고 제목·메모는 가린다 — 아웃룩의
 * "바쁨" 표시와 같은 관행이다. 관리자라도 개인 일정의 내용까지 볼 이유는 없고, 일정이
 * 겹치는지(그 시간에 바쁜지)만 알면 종합 조회의 목적은 충분하다.
 * 부서·프로젝트·전사 공유는 이미 집단에 공개된 것이라 그대로 보여 준다.
 */
export function maskEventForSupervisor(viewerId: string, event: CalendarEvent): CalendarEvent {
  if (!isMaskedForSupervisor(viewerId, event)) return event;
  return { ...event, title: MASKED_EVENT_TITLE, memo: '' };
}
