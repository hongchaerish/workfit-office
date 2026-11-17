import type { ComponentType } from 'react';
import { MAX_ROWS, normalizeLayout, rowsFor, tierOf, TIER_COLS, TIERS, type Tier, type WidgetSlot } from './dashboard';
import {
  ApprovalWidget,
  AttendanceWidget,
  AwayTodayWidget,
  BirthdayWidget,
  NewHiresWidget,
  CalendarWidget,
  LeaveWidget,
  MyDraftsWidget,
  NoticeWidget,
  PendingApprovalWidget,
  ProjectWidget,
  RecentPostsWidget,
  ResourceTodayWidget,
  ResourceWidget,
  TeamWidget,
  TodayCommuteWidget,
  TodayWidget,
  WeekHoursWidget,
  WeekScheduleWidget,
} from './widgets';

/** 경영 현황 위젯 목록과 저장된 배치 읽기 — 웹(모눈 배치)과 모바일(차례로 쌓기)이 함께 쓴다 */

/**
 * tier — 처음 넣을 때 크기. min — 가장 작은 크기(담는 정보량에 맞춰 위젯마다 다르다). 그보다 큰 크기는 모두 고를 수 있다.
 * 높이는 모든 위젯·모든 단계가 같다(WIDGET_ROWS) — 끌어서 바꾸지 않는다.
 * mini — 휴대폰에서 반 칸(요약)으로 둘 수 있는가
 * autoHeight — 높이가 내용(일정 수 등)에 따라 바뀐다. 웹 모눈은 위젯이 알려 준 높이로 칸을 잡는다
 */
interface WidgetDef { title: string; module: string; tier: Tier; min: Tier; mini?: boolean; autoHeight?: boolean; Component: ComponentType }

/** 위젯 높이(세로 칸 수) — 모든 위젯이 같다. 6칸 = 368px */
export const WIDGET_ROWS = 6;

export const WIDGETS = {
  today: { title: '오늘 일정', module: '일정', tier: 'L', min: 'L', autoHeight: true, Component: TodayWidget },
  calendar: { title: '캘린더', module: '일정', tier: 'S', min: 'S', Component: CalendarWidget },
  weekSchedule: { title: '이번 주 내 일정', module: '일정', tier: 'M', min: 'S', Component: WeekScheduleWidget },
  attendance: { title: '내 근태', module: '근태', tier: 'M', min: 'S', Component: AttendanceWidget },
  todayCommute: { title: '오늘 출퇴근', module: '근태', tier: 'S', min: 'S', mini: true, Component: TodayCommuteWidget },
  weekHours: { title: '근무시간(주간·월간)', module: '근태', tier: 'S', min: 'S', mini: true, Component: WeekHoursWidget },
  leave: { title: '연차', module: '근태', tier: 'S', min: 'S', mini: true, Component: LeaveWidget },
  approval: { title: '전자결재 현황', module: '전자결재', tier: 'S', min: 'S', mini: true, Component: ApprovalWidget },
  approvalPending: { title: '결재 대기', module: '전자결재', tier: 'S', min: 'S', Component: PendingApprovalWidget },
  approvalMine: { title: '내가 올린 문서', module: '전자결재', tier: 'S', min: 'S', Component: MyDraftsWidget },
  resource: { title: '내 자원예약', module: '자원예약', tier: 'S', min: 'S', Component: ResourceWidget },
  resourceToday: { title: '오늘 자원 사용', module: '자원예약', tier: 'M', min: 'S', Component: ResourceTodayWidget },
  team: { title: '우리 부서', module: '조직도', tier: 'S', min: 'S', Component: TeamWidget },
  awayToday: { title: '오늘 휴가·외근', module: '조직도', tier: 'S', min: 'S', mini: true, Component: AwayTodayWidget },
  birthday: { title: '이달의 생일자', module: '조직도', tier: 'S', min: 'S', mini: true, Component: BirthdayWidget },
  newHires: { title: '이달의 입사자', module: '조직도', tier: 'S', min: 'S', mini: true, Component: NewHiresWidget },
  notice: { title: '공지사항', module: '게시판', tier: 'M', min: 'S', Component: NoticeWidget },
  recentPosts: { title: '최근 게시글', module: '게시판', tier: 'M', min: 'M', Component: RecentPostsWidget },
  project: { title: '프로젝트', module: '프로젝트', tier: 'S', min: 'S', Component: ProjectWidget },
} satisfies Record<string, WidgetDef>;

export type WidgetId = keyof typeof WIDGETS;
export const WIDGET_IDS = Object.keys(WIDGETS) as WidgetId[];
export const MODULES = [...new Set(WIDGET_IDS.map((id) => WIDGETS[id].module))];

/** 웹 기본 배치 — 오늘 일정(대), 내 근태·전자결재(중·중), 공지사항·이달의 생일자(중·중). 높이가 같아 빈칸 없이 맞물린다 */
export const DEFAULT_LAYOUT: WidgetSlot<WidgetId>[] = [
  { id: 'today', size: 12, x: 0, y: 0 },
  { id: 'attendance', size: 6, x: 0, y: 6 },
  { id: 'approval', size: 6, x: 6, y: 6 },
  { id: 'notice', size: 6, x: 0, y: 12 },
  { id: 'birthday', size: 6, x: 6, y: 12 },
];

/** 휴대폰 기본 — size 6 은 반 칸(요약), 12 는 한 줄 전체 */
export const MOBILE_DEFAULT_LAYOUT: WidgetSlot<WidgetId>[] = [
  { id: 'todayCommute', size: 6 },
  { id: 'approval', size: 6 },
  { id: 'today', size: 12 },
  { id: 'leave', size: 6 },
  { id: 'birthday', size: 6 },
  { id: 'notice', size: 12 },
];
/** 휴대폰에서 반 칸인가 — 요약을 지원하는 위젯만 */
export const isHalf = (slot: WidgetSlot<WidgetId>) => slot.size <= 6 && Boolean((WIDGETS[slot.id] as WidgetDef).mini);
export const mobileStorageKey = (userId: string) => `workfit.execDashboard.mobile.${userId}`;

export const storageKey = (userId: string) => `workfit.execDashboard.layout.${userId}`;

/** 이 브라우저에 저장된 배치 — 없거나 망가졌으면 fallback */
export function loadLayout(userId: string | undefined, fallback: WidgetSlot<WidgetId>[] = DEFAULT_LAYOUT, key = storageKey): WidgetSlot<WidgetId>[] {
  if (!userId) return fallback;
  try {
    const raw = localStorage.getItem(key(userId));
    return normalizeLayout(raw ? JSON.parse(raw) : null, WIDGET_IDS, fallback);
  } catch {
    return fallback;
  }
}

/** 위젯이 고를 수 있는 크기 — 최소 크기부터 대까지 */
export const tiersOf = (id: WidgetId): readonly Tier[] => TIERS.slice(TIERS.indexOf((WIDGETS[id] as WidgetDef).min));
/** 위젯의 크기 단계 — 저장된 폭(예전 배치의 4·8칸 등)도, 그 위젯이 고를 수 있는 크기 중 가장 가까운 것으로 */
export const tierOfSlot = (slot: WidgetSlot<WidgetId>): Tier => {
  const allowed = tiersOf(slot.id);
  const t = tierOf(slot.size);
  if (allowed.includes(t)) return t;
  return allowed.reduce((best, x) => (Math.abs(TIER_COLS[x] - slot.size) < Math.abs(TIER_COLS[best] - slot.size) ? x : best), allowed[0]);
};
/** 세로 칸 수 — 모든 위젯·모든 단계가 같다 */
export const rowsAt = (_id: WidgetId, _tier: Tier) => WIDGET_ROWS;
/** 위젯이 차지하는 세로 칸 수 */
export const rowsOf = (slot: WidgetSlot<WidgetId>) => rowsAt(slot.id, tierOfSlot(slot));
/** 처음 넣을 때 폭 */
export const defaultSizeOf = (id: WidgetId) => TIER_COLS[(WIDGETS[id] as WidgetDef).tier];
/** 웹 배치 정리 — 폭은 단계의 칸 수로, 끌어서 맞췄던 높이(rows)는 버린다 */
export const snapToTiers = (list: WidgetSlot<WidgetId>[]): WidgetSlot<WidgetId>[] =>
  list.map(({ rows: _rows, ...s }) => ({ ...s, size: TIER_COLS[tierOfSlot(s)] }));
/** 높이는 단계에 정한 칸 그대로 — 내용이 길면 위젯 안에서 들어가는 만큼만 보인다 */
export const placementsOf = (list: WidgetSlot<WidgetId>[], autoRows: AutoRows = {}) =>
  list.map((s) => ({ id: s.id, w: s.size, h: autoRows[s.id] ?? rowsOf(s), x: s.x, y: s.y }));
/** 높이가 바뀌는 위젯이 알려 준 세로 칸 수 */
export type AutoRows = Partial<Record<WidgetId, number>>;
export const isAutoHeight = (id: WidgetId) => Boolean((WIDGETS[id] as WidgetDef).autoHeight);
/** 내용 높이(px) → 세로 칸 수(최소 3칸) */
export const autoRowsFor = (px: number) => Math.min(MAX_ROWS, Math.max(3, rowsFor(px)));
