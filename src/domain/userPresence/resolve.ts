import type { CommutePolicy } from '@/domain/commutePolicy/schema';
import { approvedLeaveSpans, timeToMinutes, type ApprovedLeaveInfo } from '@/domain/commute/engine';
import type { UserPresenceStatus } from './schema';

/** 접속 신호가 이 시간 안에 있으면 접속 중(업무중)으로 본다. */
export const ONLINE_WINDOW_MS = 3 * 60 * 1000;

export interface StoredPresence {
  status: UserPresenceStatus;
  message: string;
  /** 사용자가 상태를 직접 바꾼 시각 */
  updatedAt: string;
  /** 마지막 접속 신호(하트비트) 시각 */
  lastSeenAt?: string | null;
}

export interface PresenceMeeting {
  date: string; // YYYY-MM-DD (KST)
  startTime: string | null; // HH:mm
  endTime: string | null;
}

export interface PresenceInputs {
  stored: StoredPresence | null;
  /** 날짜 → 그날 승인된 휴가·외근·출장 (approvalDayIndex.lookup 결과) */
  approvalDays: Map<string, ApprovedLeaveInfo[]>;
  /** 이 사람이 주최·참석하는 회의 */
  meetings: PresenceMeeting[];
  policy: CommutePolicy;
  now: Date;
}

export type PresenceSource = 'LEAVE_APPROVAL' | 'OUTSIDE_APPROVAL' | 'MEETING' | 'MANUAL' | 'CONNECTION';

export interface ResolvedPresence {
  status: UserPresenceStatus;
  message: string;
  source: PresenceSource;
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const pad = (v: number) => String(v).padStart(2, '0');

/** Date → KST 날짜키와 하루 기준 분 */
function kstParts(d: Date): { date: string; minutes: number } {
  const k = new Date(d.getTime() + KST_OFFSET_MS);
  return {
    date: `${k.getUTCFullYear()}-${pad(k.getUTCMonth() + 1)}-${pad(k.getUTCDate())}`,
    minutes: k.getUTCHours() * 60 + k.getUTCMinutes(),
  };
}

/** KST 날짜 + 분 → 절대 시각(ms) */
const kstInstant = (date: string, minutes: number) =>
  new Date(`${date}T${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}:00+09:00`).getTime();

interface AutoStatus extends ResolvedPresence {
  /** 이 자동 상태가 시작된 시각 — 직접 설정이 이보다 나중이면 직접 설정이 이긴다 */
  since: number;
}

/** 지금 적용되는 자동 상태(결재·회의) 중 우선순위가 가장 높은 것 */
function autoStatusAt(inputs: PresenceInputs, date: string, minutes: number): AutoStatus | null {
  const entries = inputs.approvalDays.get(date) ?? [];

  const leaveSpans = approvedLeaveSpans(inputs.policy, entries);
  const leaveName = entries.find((e) => (e.category ?? 'LEAVE') === 'LEAVE')?.leaveType ?? '휴가';
  if (leaveSpans.fullDay) {
    return { status: 'LEAVE', message: leaveName, source: 'LEAVE_APPROVAL', since: kstInstant(date, 0) };
  }
  const leaveNow = leaveSpans.windows.find(([s, e]) => s <= minutes && minutes < e);
  if (leaveNow) {
    return { status: 'LEAVE', message: leaveName, source: 'LEAVE_APPROVAL', since: kstInstant(date, leaveNow[0]) };
  }

  const work = entries.find((e) => e.category === 'OUTSIDE' || e.category === 'TRIP');
  if (work) {
    return { status: 'OUTSIDE', message: work.leaveType, source: 'OUTSIDE_APPROVAL', since: kstInstant(date, 0) };
  }

  for (const m of inputs.meetings) {
    if (m.date !== date) continue;
    const start = timeToMinutes(m.startTime);
    const end = timeToMinutes(m.endTime);
    if (start === null || end === null) continue;
    if (start <= minutes && minutes < end) {
      return { status: 'MEETING', message: '', source: 'MEETING', since: kstInstant(date, start) };
    }
  }
  return null;
}

/**
 * 화면에 보일 근무 상태를 정한다 — 웹·PWA·메신저 공용 단일 규칙.
 *
 * 우선순위: ① 승인 휴가(반차는 해당 시간대만) ② 승인 외근·출장 ③ 참석 회의 시간
 * ④ 오늘 직접 정한 상태 ⑤ 접속 여부(최근 3분 신호 → 업무중, 아니면 오프라인).
 * 직접 정한 상태와 자동 상태가 겹치면 **더 최근 것이 이긴다** — 외근일에 복귀해 업무중으로
 * 바꾸면 업무중, 아침에 집중근무로 해 둔 뒤 회의가 시작되면 회의중.
 * 직접 정한 '업무중'은 "자리에 있음"이라는 뜻이라, 실제 표시는 접속 여부를 따른다.
 */
export function resolvePresence(inputs: PresenceInputs): ResolvedPresence {
  const { stored, now } = inputs;
  const { date, minutes } = kstParts(now);

  const connected = Boolean(
    stored?.lastSeenAt && now.getTime() - new Date(stored.lastSeenAt).getTime() <= ONLINE_WINDOW_MS,
  );
  const connection: ResolvedPresence = {
    status: connected ? 'ONLINE' : 'OFFLINE',
    message: connected ? stored?.message ?? '' : '',
    source: 'CONNECTION',
  };

  const manualAt = stored?.updatedAt ? new Date(stored.updatedAt) : null;
  const manualToday = Boolean(manualAt && !Number.isNaN(manualAt.getTime()) && kstParts(manualAt).date === date);
  const manual: ResolvedPresence | null =
    stored && manualToday
      ? stored.status === 'ONLINE'
        ? connection
        : { status: stored.status, message: stored.message, source: 'MANUAL' }
      : null;

  const auto = autoStatusAt(inputs, date, minutes);
  if (auto && !(manual && manualAt && manualAt.getTime() >= auto.since)) {
    return { status: auto.status, message: auto.message, source: auto.source };
  }
  return manual ?? connection;
}
