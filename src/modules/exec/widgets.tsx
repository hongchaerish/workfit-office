import { formatMinutes } from '@/domain/leave/substituteLedger';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Megaphone } from 'lucide-react';
import { useAuth } from '@/app/auth/AuthProvider';
import { useBoardPosts } from '@/features/board/useBoardPosts';
import { useCommuteBootstrap, useCommuteEmployees, useCommuteMonth, useCommuteViewer } from '@/features/commute/useCommute';
import { useCommuteEvaluation } from '@/features/commute/useCommuteEvaluation';
import type { ApprovalDayMap } from '@/domain/commute/approvalDayIndex';
import { useDepartments } from '@/features/department/useDepartments';
import { useEmployeeProfiles } from '@/features/employeeProfile/useEmployeeProfiles';
import { useApprovalUnread } from '@/features/gw/useApprovalUnread';
import { useApprovalBoxes } from '@/features/gw/useApprovals';
import { useLeave } from '@/features/gw/useLeave';
import { useReservations } from '@/features/resource/useReservations';
import { useUsers } from '@/features/user/useUsers';
import { useAllUserPresences } from '@/features/userPresence/useUserPresence';
import { useDayEntryIndex } from '@/features/workPlan/useDayEntryIndex';
import { COMPANY_PLAN_OWNER } from '@/features/workPlan/useCompanyImportant';
import { stripInlineMarks } from '@/domain/workPlan/richText';
import { currentApproverIds } from '@/domain/approvalDoc/engine';
import { COMMUTE_STATUS_LABELS } from '@/domain/commute/schema';
import type { DayEntry } from '@/domain/workPlan/dayEntries';
import { EntryDetailModal, entryTimeKind } from './EntryDetailModal';
import { birthdaysInMonth } from '@/domain/birthday/engine';
import { hiresInMonth } from '@/domain/employeeProfile/hires';
import { sortPostsForList } from '@/domain/board/rules';
import { BOARDS_SEED } from '@/data/seeds/board.seed';
import { resolveDeptId } from '@/domain/department/engine';
import { USER_PRESENCE_META, type UserPresenceStatus } from '@/domain/userPresence/schema';
import { chipLook, entryDotClass } from '@/modules/gw/task/components/entryChipLook';
import { useHolidays } from '@/features/holiday/useHolidays';
import type { Post } from '@/domain/board/schema';
import {
  ATTENDANCE_BUCKETS,
  ATTENDANCE_LABELS,
  DAY_END_MIN,
  DAY_START_MIN,
  bucketOf,
  donutSlices,
  firstWeekday,
  hoursText,
  timeAgo,
  weekDates,
  monthDates,
  nowPercent,
  orderDayItems,
  shiftMonth,
  timelineSpan,
  todayKst,
  type AttendanceBucket,
  type Tier,
} from './dashboard';

/**
 * 경영 현황 위젯들 — 각 위젯이 자기 데이터를 직접 읽는다(숨긴 위젯은 읽지 않는다).
 * 모두 읽기 전용이며, 누르면 원래 화면으로 이동한다.
 */

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/** 근태 4분류 색 — 시안 색을 따르고 다크 모드는 같은 계열 반투명 */
const BUCKET_STROKE: Record<AttendanceBucket, string> = {
  work: '#49b1e1',
  pending: '#c4c8ce',
  late: '#f2a17e',
  leave: '#d9dd7a',
};
const BUCKET_CELL: Record<AttendanceBucket, string> = {
  work: 'bg-[#cdeefa] text-[#16658f] dark:bg-sky-500/25 dark:text-sky-200',
  pending: 'bg-panel-alt text-ink3',
  late: 'bg-[#fde2d6] text-[#a4492a] dark:bg-orange-500/25 dark:text-orange-200',
  leave: 'bg-[#f3f5c8] text-[#7a7d1f] dark:bg-yellow-500/20 dark:text-yellow-200',
};

function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00`).getDay();
}

/** ISO 시각 → 한국 시간 'HH:MM' */
function kstTime(iso: string): string {
  return new Date(Date.parse(iso) + 9 * 3600_000).toISOString().slice(11, 16);
}
function kstDate(iso: string): string {
  return new Date(Date.parse(iso) + 9 * 3600_000).toISOString().slice(0, 10);
}


/** 위젯 링크 바꾸기 — 모바일에서는 웹 주소를 모바일 화면 주소로 바꿔 연다 */
const LinkMapContext = createContext<((path: string) => string) | null>(null);
export const WidgetLinkProvider = LinkMapContext.Provider;
function useGo() {
  const navigate = useNavigate();
  const map = useContext(LinkMapContext);
  return (path: string) => navigate(map ? map(path) : path);
}

/** 카드 머리 — 제목과 오른쪽 이동 버튼만 */
export function Head({ title, note, to, toLabel = '전체 보기' }: { title: string; note?: ReactNode; to?: () => void; toLabel?: string }) {
  return (
    <div className="mb-4 flex items-baseline justify-between gap-3">
      <div className="flex min-w-0 items-baseline gap-2.5">
        <h2 className="text-[15px] font-extrabold tracking-tight text-ink">{title}</h2>
        {note && <span className="truncate text-[11.5px] text-ink3">{note}</span>}
      </div>
      {to && (
        <button type="button" onClick={to} className="shrink-0 cursor-pointer text-[11.5px] font-bold text-[#2f86c4] hover:underline">
          {toLabel}
        </button>
      )}
    </div>
  );
}

export function Panel({ className = '', children }: { className?: string; children: ReactNode }) {
  return <section className={`flex h-full min-w-0 flex-col rounded-[20px] border border-border bg-panel p-5 ${className}`}>{children}</section>;
}

/**
 * 높이가 정해진 위젯의 목록 — 칸에 다 들어가는 줄까지만 보이고 나머지는 숨는다(스크롤 없음).
 * 세로 flex 를 줄바꿈시켜 넘치는 줄을 오른쪽 보이지 않는 열로 보낸다. 높이가 자유로운 모바일에서는 다 보인다.
 */
const FIT_LIST =
  'min-h-0 flex-1 flex flex-col flex-wrap content-start overflow-hidden [&>li]:w-full in-data-[tier=L]:gap-x-10 in-data-[tier=L]:[&>li]:w-[calc(50%-20px)]';

/** 위젯 크기 단계(소·중·대) — 웹 모눈에서만 정해 준다. 없으면(휴대폰 등) 위젯 기본 모양.
 *  대(한 줄 전체)에서는 목록이 두 단으로 흐른다(FIT_LIST) */
const TierContext = createContext<Tier | null>(null);
export const WidgetTierProvider = TierContext.Provider;
const useTier = () => useContext(TierContext);

/** 높이가 내용에 따라 바뀌는 위젯 — 웹 모눈이 내용 높이(px)를 받아 칸 수를 맞춘다. 없으면(휴대폰 등) 그냥 늘어난다 */
const AutoHeightContext = createContext<((px: number) => void) | null>(null);
export const WidgetAutoHeightProvider = AutoHeightContext.Provider;
/** 위젯 판 위아래 안쪽 여백 + 테두리(sm:p-6) */
const PANEL_PAD_Y = 50;
/** 내용을 감싼 요소에 ref 로 붙이면 그 높이(+위젯 안쪽 여백)를 알린다 */
function useAutoHeight() {
  const report = useContext(AutoHeightContext);
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!report || !el) return;
    const send = () => report(el.offsetHeight + PANEL_PAD_Y);
    send();
    const ro = new ResizeObserver(send);
    ro.observe(el);
    return () => ro.disconnect();
  }, [report, el]);
  return setEl;
}

/** 작게 보기 — 모바일에서 반 칸짜리 위젯. 지원하는 위젯은 요약만 크게 보여 준다 */
const MiniContext = createContext(false);
export const WidgetMiniProvider = MiniContext.Provider;
const useMini = () => useContext(MiniContext);

/** 작은 위젯 틀 — 위에 제목, 아래에 큰 숫자. 누르면 그 화면으로 */
function MiniPanel({ title, onClick, children }: { title: string; onClick?: () => void; children: ReactNode }) {
  return (
    <section className="h-full min-w-0 rounded-[20px] border border-border bg-panel">
      <button type="button" onClick={onClick} className="flex h-full w-full cursor-pointer flex-col justify-between p-4 text-left">
        <span className="truncate text-[12.5px] font-extrabold text-ink2">{title}</span>
        <span className="flex min-w-0 flex-col gap-1">{children}</span>
      </button>
    </section>
  );
}
const MINI_BIG = 'text-[26px] leading-none font-black tracking-[-.03em] tabular-nums text-ink';
const MINI_SUB = 'truncate text-[11.5px] font-semibold text-ink3';

function Empty({ children }: { children: ReactNode }) {
  return <div className="py-6 text-[12px] text-ink3">{children}</div>;
}

function useDeptId() {
  const { user: me } = useAuth();
  const departmentsQuery = useDepartments();
  return useMemo(() => resolveDeptId(departmentsQuery.data ?? [], me?.dept), [departmentsQuery.data, me?.dept]);
}

/* ───────────────────────── 오늘 일정 ───────────────────────── */

interface DayRow {
  key: string;
  title: string;
  start: string | null;
  end: string | null;
  allDay: boolean;
  /** 일정 색(업무계획과 같은 색) — 점과 시간 막대 */
  color: string;
  /** 종일(외근·출장·휴가 종일) / 시각 있음 / 시간 미정(시각 없는 업무) */
  kind: 'allDay' | 'timed' | 'undecided';
  entry: DayEntry;
}

/**
 * 줄 종류 — 업무계획과 같은 규칙: 시각 없는 업무는 '시간 미정'(업무계획도 종일로 저장하고 '미정'으로 보인다),
 * 외근·출장·휴가·회의 등의 시각 없는 일정은 '종일'.
 */
function rowKindOf(e: DayEntry): DayRow['kind'] {
  return entryTimeKind(e);
}

/** 줄의 시간 글자 */
function timeLabel(r: DayRow): string {
  if (r.kind === 'allDay') return '종일';
  if (r.kind === 'undecided') return '시간 미정';
  return `${r.start!.slice(0, 5)}${r.end ? `~${r.end.slice(0, 5)}` : ''}`;
}

/**
 * 오늘 일정 — 왼쪽에 업무 제목, 오른쪽에 시간 막대(08~20시). 한 줄에 일정 하나.
 * 종일이 맨 위, 그다음 시작 시각 순(외근·출장도 같은 규칙), 시간 미정은 맨 아래.
 * 막대: 종일은 꽉 찬 색 막대('종일'), 시간 미정은 점선 빈 칸('시간 미정')으로 구분한다.
 * 일정 수만큼 높이가 늘어난다(웹 모눈에서는 내용 높이를 알려 칸 수를 맞춘다).
 * 일정 줄을 누르면 업무계획으로 가지 않고 그 일정의 상세를 읽기 전용으로 띄운다.
 */
export function TodayWidget() {
  const navigate = useGo();
  const { user: me } = useAuth();
  const deptId = useDeptId();
  const today = todayKst();
  const todayDates = useMemo(() => [today], [today]);
  const members = useMemo(() => (me ? [me] : []), [me]);
  const { cellOf, workPlans } = useDayEntryIndex({ actor: me, deptId, members, dates: todayDates });
  const myEntries = me ? cellOf(me.id, today).entries : [];
  const companyImportant = workPlans.find((p) => p.ownerUserId === COMPANY_PLAN_OWNER && p.date === today && p.content?.trim())?.content?.trim();
  // 전사 주요 일정 — 업무계획 '중요 일정' 줄. 줄마다 서식 기호·목록 기호를 걷어 한 줄로
  const companyLines = (companyImportant ?? '')
    .split('\n')
    .map((l) => stripInlineMarks(l).replace(/^\s*(?:[-*]\s*(?:\[[ xX]\]\s*)?|\d+[.)]\s*)/, '').trim())
    .filter(Boolean);

  const rows: DayRow[] = orderDayItems(
    myEntries.map((e) => {
      const kind = rowKindOf(e);
      return {
        key: e.key,
        title: chipLook(e).label,
        color: entryDotClass(e),
        kind,
        // 정렬용 — 종일은 맨 위, 시간 미정은 시각을 비워 맨 아래로
        allDay: kind === 'allDay',
        start: kind === 'timed' ? e.startTime : null,
        end: kind === 'timed' ? e.endTime : null,
        entry: e,
      };
    }),
  );

  // 지금 시각 선 — 1분마다 옮긴다
  const [now, setNow] = useState(() => nowPercent());
  useEffect(() => {
    const t = setInterval(() => setNow(nowPercent()), 60_000);
    return () => clearInterval(t);
  }, []);
  const hours = Array.from({ length: (DAY_END_MIN - DAY_START_MIN) / 60 + 1 }, (_, i) => DAY_START_MIN / 60 + i);
  const bodyRef = useAutoHeight();
  /** 누른 일정 — 읽기 전용 상세 창 */
  const [picked, setPicked] = useState<DayEntry | null>(null);
  const open = () => navigate('/gw/work-plan');
  /** 왼쪽 제목 칸 · 오른쪽 시간 막대 칸 */
  const COLS = 'grid grid-cols-[minmax(120px,38%)_minmax(0,1fr)] gap-x-4 sm:grid-cols-[minmax(200px,320px)_minmax(0,1fr)]';

  return (
    <Panel className="sm:p-6">
      <div ref={bodyRef}>
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div className="flex items-end gap-3 sm:gap-4">
            <div className="text-[40px] sm:text-[52px] leading-[0.9] font-black tracking-[-.06em] text-[#0876c8] tabular-nums">{Number(today.slice(8))}</div>
            <div className="pb-0.5">
              <div className="text-[13px] font-bold text-ink2">{Number(today.slice(0, 4))}년 {Number(today.slice(5, 7))}월 {WEEKDAYS[weekdayOf(today)]}요일</div>
              <h1 className="mt-0.5 text-[17px] sm:text-[22px] font-extrabold tracking-[-.04em] text-ink">
                {me?.name ? `${me.name}님, 오늘 일정은 ${rows.length}건입니다` : `오늘 일정은 ${rows.length}건입니다`}
              </h1>
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => navigate('/gw/calendar')} className="cursor-pointer rounded-lg border border-border px-3 py-1.5 text-[12px] font-bold text-ink2 hover:border-[#0876c8] hover:text-[#0876c8]">캘린더</button>
            <button type="button" onClick={open} className="cursor-pointer rounded-lg bg-[#0876c8] px-3 py-1.5 text-[12px] font-bold text-white hover:bg-[#066aaf]">업무계획</button>
          </div>
        </div>
        {companyLines.length > 0 && (
          <button
            type="button"
            onClick={open}
            title={companyLines.join('\n')}
            className="-mt-1 mb-3 flex w-full cursor-pointer items-center gap-2.5 rounded-r-lg border-l-[3px] border-[#0876c8] bg-[#f2f8fd] px-3 py-1.5 text-left hover:bg-[#e8f2fb] dark:bg-sky-500/10 dark:hover:bg-sky-500/15"
          >
            <Megaphone size={14} className="shrink-0 text-[#0876c8]" />
            <span className="shrink-0 text-[11.5px] font-extrabold text-[#0876c8]">전사 주요 일정</span>
            <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-ink">{companyLines.join('  ·  ')}</span>
          </button>
        )}

        {rows.length === 0 ? (
          <div className="py-6 text-center text-[13px] text-ink3">오늘 일정이 없습니다.</div>
        ) : (
          <div className="flex flex-col">
            {/* 시간 눈금 */}
            <div className={`${COLS} mb-1`}>
              <span />
              <div className="relative h-4">
                {hours.map((h, i) => (
                  <span key={h} className="absolute -translate-x-1/2 text-[10px] tabular-nums text-ink3" style={{ left: `${(i / (hours.length - 1)) * 100}%` }}>
                    {h}
                  </span>
                ))}
              </div>
            </div>
            <div className="relative">
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {rows.map((r) => {
                  const sp = r.kind === 'timed' ? timelineSpan(r.start, r.end) : null;
                  return (
                    <li key={r.key}>
                      <button type="button" onClick={() => setPicked(r.entry)} title={`${timeLabel(r)} ${r.title}`} className={`${COLS} group w-full cursor-pointer items-center rounded-lg py-1 text-left hover:bg-panel-alt/60`}>
                        <span className="flex min-w-0 items-center gap-2 pl-1">
                          <i className={`h-2 w-2 shrink-0 rounded-full ${r.color}`} />
                          <span className="min-w-0 truncate text-[13px] font-semibold text-ink group-hover:text-[#0876c8]">{r.title}</span>
                          <span className="ml-auto shrink-0 pl-2 text-[11px] tabular-nums text-ink3">{timeLabel(r)}</span>
                        </span>
                        {r.kind === 'undecided' ? (
                          // 시간 미정 — 색 없이 점선 빈 칸
                          <span className="grid h-7 place-items-center rounded-md border border-dashed border-border-hi text-[11px] font-bold text-ink3">시간 미정</span>
                        ) : r.kind === 'allDay' ? (
                          // 종일 — 하루 전체를 채운 색 막대
                          <span className="relative block h-7 rounded-md bg-panel-alt">
                            <span className="absolute inset-1 grid place-items-center overflow-hidden rounded">
                              <span className={`absolute inset-0 opacity-35 ${r.color}`} />
                              <span className="relative text-[11px] font-bold text-ink2">종일</span>
                            </span>
                          </span>
                        ) : (
                          <span className="relative block h-7 rounded-md bg-panel-alt">
                            {sp && <span className={`absolute top-1.5 bottom-1.5 rounded opacity-45 ${r.color}`} style={{ left: `calc(${sp.left}% + 1px)`, width: `calc(${sp.width}% - 2px)` }} />}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {/* 지금 시각 선 — 시간 막대 칸 위에만 */}
              {now !== null && (
                <div className={`${COLS} pointer-events-none absolute inset-0`}>
                  <span />
                  <div className="relative">
                    <div className="absolute inset-y-[-4px] w-0.5 rounded-full bg-[#e5484d]" style={{ left: `${now}%` }}>
                      <span className="absolute -top-1 -left-[3px] h-2 w-2 rounded-full bg-[#e5484d]" />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      <EntryDetailModal entry={picked} date={today} all={rows.map((r) => r.entry)} onPick={setPicked} onClose={() => setPicked(null)} />
    </Panel>
  );
}


/* ───────────────────────── 내 근태 ───────────────────────── */

function Donut({ counts, centerTop, centerBottom }: { counts: Record<AttendanceBucket, number>; centerTop: string; centerBottom: string }) {
  const slices = donutSlices(ATTENDANCE_BUCKETS.map((k) => ({ key: k, value: counts[k] })));
  const R = 52;
  const C = 2 * Math.PI * R;
  const GAP = slices.length > 1 ? 2 : 0; // 조각 사이 2px 틈
  return (
    <svg viewBox="0 0 132 132" className="h-[104px] w-[104px] shrink-0" role="img" aria-label={`이번 달 근태 ${ATTENDANCE_BUCKETS.map((k) => `${ATTENDANCE_LABELS[k]} ${counts[k]}일`).join(', ')}`}>
      <circle cx="66" cy="66" r={R} fill="none" strokeWidth="14" className="stroke-panel-alt" />
      {slices.map((s) => (
        <circle
          key={s.key}
          cx="66"
          cy="66"
          r={R}
          fill="none"
          stroke={BUCKET_STROKE[s.key]}
          strokeWidth="14"
          strokeDasharray={`${Math.max(0, (s.to - s.from) * C - GAP)} ${C}`}
          strokeDashoffset={-s.from * C}
          transform="rotate(-90 66 66)"
        >
          <title>{`${ATTENDANCE_LABELS[s.key]} ${s.value}일`}</title>
        </circle>
      ))}
      <text x="66" y="63" textAnchor="middle" className="fill-ink text-[20px] font-extrabold">{centerTop}</text>
      <text x="66" y="81" textAnchor="middle" className="fill-ink3 text-[10px]">{centerBottom}</text>
    </svg>
  );
}

/** 일별 근무시간 막대 — 4·8·12시간 기준선 */
/** 오늘 출근·퇴근 시각 — 내 근태 위젯의 도넛 옆 */
function TodayClock({ rec }: { rec?: { inAt: string | null; outAt: string | null; bucket: AttendanceBucket; status: string } }) {
  const inClock = clockOf(rec?.inAt);
  const outClock = clockOf(rec?.outAt);
  // 외근·출장·휴가처럼 기록 없이 인정된 날은 그 상태를 적는다
  const note = rec && !rec.inAt && rec.bucket !== 'pending' && rec.status !== 'unknown' ? COMMUTE_STATUS_LABELS[rec.status as keyof typeof COMMUTE_STATUS_LABELS] : null;
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <span className="text-[11px] font-bold text-ink3">오늘</span>
      {[
        { label: '출근', value: inClock, late: rec?.bucket === 'late' },
        { label: '퇴근', value: outClock, late: false },
      ].map((x) => (
        <div key={x.label} className="flex items-center justify-between gap-2 rounded-lg bg-panel-alt px-3 py-1.5">
          <span className="text-[11.5px] font-bold text-ink3">{x.label}</span>
          <span className={`text-[17px] leading-tight font-black tabular-nums ${x.value ? (x.late ? 'text-[#c4602f]' : 'text-ink') : 'text-ink3'}`}>{x.value ?? '--:--'}</span>
        </div>
      ))}
      {note && <span className="text-[11px] font-bold text-ink2">{note}</span>}
    </div>
  );
}

type AwayKind = 'outside' | 'trip' | null;
const NO_APPROVALS: ApprovalDayMap = new Map();
/** 외근·출장 영역 — 근무 막대(꽉 찬 파랑)와 헷갈리지 않게 빗금 */
const AWAY_LOOK: Record<'outside' | 'trip', { label: string; stripe: string }> = {
  outside: { label: '외근', stripe: 'repeating-linear-gradient(135deg, rgb(20 184 166 / 0.42) 0 3px, rgb(20 184 166 / 0.16) 3px 6px)' },
  trip: { label: '출장', stripe: 'repeating-linear-gradient(135deg, rgb(139 92 246 / 0.42) 0 3px, rgb(139 92 246 / 0.16) 3px 6px)' },
};
const minText = (m: number) => `${Math.floor(m / 60)}시간 ${m % 60}분`;

/**
 * 하루 막대 한 칸 — 근무 막대(지각한 날은 주황). 외근·출장 날은 칸 높이 전체를 그 색 빗금으로 칠하고,
 * 실제 출퇴근 기록이 있으면 그 시간만 근무 막대로 얹는다(외근·출장으로 인정된 8시간은 막대로 그리지 않는다).
 */
function DayHoursColumn({ d, max, show, radius, dim, label }: {
  d: { minutes: number; actualMin?: number; leaveMin?: number; workedMin?: number; away?: AwayKind; bucket?: AttendanceBucket; late?: boolean };
  max: number;
  show: boolean;
  radius: string;
  dim?: boolean;
  label: string;
}) {
  const late = d.late ?? d.bucket === 'late';
  // 반차·반반차 날은 반차 시간(4·2시간)을 휴가 색으로 실제 근무 위에 얹는다 — 8시간을 넘어 보일 수 있다
  const leave = d.away ? 0 : Math.max(0, d.leaveMin ?? 0);
  const work = d.away ? d.actualMin ?? 0 : leave > 0 ? Math.max(0, d.workedMin ?? d.minutes - leave) : d.minutes;
  const title = d.away
    ? `${label} ${AWAY_LOOK[d.away].label}${work > 0 ? ` · 출퇴근 기록 ${minText(work)}` : ' (출퇴근 기록 없음)'}`
    : leave > 0
      ? `${label} 근무 ${minText(work)} · 휴가 ${minText(leave)}`
      : `${label} ${minText(d.minutes)}`;
  const pct = (m: number) => `${(Math.min(m, max) / max) * 100}%`;
  return (
    <div className="group relative flex h-full flex-1 items-end" title={title}>
      {show && d.away && <div className={`absolute inset-0 ${radius}`} style={{ background: AWAY_LOOK[d.away].stripe }} />}
      {show && (work > 0 || leave > 0) && (
        <div className={`relative flex w-full flex-col-reverse overflow-hidden ${radius} ${dim ? 'opacity-80 group-hover:opacity-100' : ''}`} style={{ height: pct(work + leave) }}>
          {work > 0 && <div className={`w-full shrink-0 ${late && !d.away ? 'bg-[#f2a17e]' : 'bg-[#0876c8]'}`} style={{ height: `${(work / (work + leave)) * 100}%` }} />}
          {leave > 0 && <div className="w-full shrink-0" style={{ height: `${(leave / (work + leave)) * 100}%`, background: BUCKET_STROKE.leave }} />}
        </div>
      )}
    </div>
  );
}

/** 막대 색 설명 — 근무·지각, 외근·출장은 그 기간에 있을 때만 */
function HoursLegend({ days, late = true }: { days: Array<{ away?: AwayKind }>; late?: boolean }) {
  const kinds = (['outside', 'trip'] as const).filter((k) => days.some((d) => d.away === k));
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[10.5px] text-ink3">
      <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-[3px] bg-[#0876c8]" />근무</span>
      {late && <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-[3px] bg-[#f2a17e]" />지각한 날</span>}
      {kinds.map((k) => (
        <span key={k} className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-[3px]" style={{ background: AWAY_LOOK[k].stripe }} />{AWAY_LOOK[k].label}</span>
      ))}
    </div>
  );
}

function HoursBars({ days, today }: { days: Array<{ date: string; minutes: number; actualMin?: number; leaveMin?: number; workedMin?: number; away?: AwayKind; bucket: AttendanceBucket }>; today: string }) {
  const MAX = 12 * 60;
  return (
    <div className="pl-[26px]">
      <div className="relative h-[96px]">
        {[4, 8, 12].map((h) => (
          <div key={h} className="absolute inset-x-0 border-t border-dashed border-border" style={{ bottom: `${(h * 60 / MAX) * 100}%` }}>
            <span className="absolute -top-[7px] -left-[26px] w-[22px] text-right text-[9.5px] tabular-nums text-ink3">{h}h</span>
          </div>
        ))}
        <div className="absolute inset-0 flex items-end gap-[2px]">
          {days.map((d) => (
            <DayHoursColumn key={d.date} d={d} max={MAX} show={d.date <= today} radius="rounded-t-[4px]" dim={d.date !== today} label={`${Number(d.date.slice(8))}일`} />
          ))}
        </div>
      </div>
      <div className="mt-1.5 flex gap-[2px]">
        {days.map((d) => {
          const n = Number(d.date.slice(8));
          return (
            <span key={d.date} className={`flex-1 text-center text-[9.5px] tabular-nums ${d.date === today ? 'font-extrabold text-[#0876c8]' : 'text-ink3'}`}>
              {n === 1 || n % 5 === 0 || d.date === today ? n : ''}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/** 연차·대체휴무 — 한 줄 두 칸 요약과 휴가원 작성 바로가기 */
function LeaveBar({ standalone = false }: { standalone?: boolean }) {
  const navigate = useGo();
  const { user: me } = useAuth();
  const leave = useLeave(me?.id);
  if (leave.isLoading) return null;
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  const sub = leave.substituteHoliday;
  const subRemain = Math.max(0, sub.remainingMin);
  const over = leave.remaining < 0;
  const cells = [
    {
      key: 'annual',
      label: '연차',
      value: <><b className={over ? 'text-[#c4432f] dark:text-red-300' : 'text-ink'}>{fmt(leave.remaining)}</b><span className="ml-0.5 text-[10.5px] text-ink3">/{fmt(leave.grant)}일</span></>,
      total: Math.max(leave.grant, leave.used + leave.pending),
      used: leave.used,
      pending: leave.pending,
      // 파스텔 하늘 — 사용 / 신청 중
      colors: ['#9cc5f2', '#d3e6fa'],
    },
    {
      key: 'sub',
      label: '대체휴무',
      value: <b className="text-ink">{subRemain ? formatMinutes(subRemain) : '0시간'}</b>,
      total: Math.max(sub.totalMin, sub.usedMin + sub.pendingMin),
      used: sub.usedMin,
      pending: sub.pendingMin,
      // 파스텔 민트 — 사용 / 신청 중
      colors: ['#9ed9c3', '#d4efe5'],
    },
  ];
  return (
    <div className={standalone ? '' : 'mt-3 border-t border-border pt-3'}>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className={`font-bold text-ink ${standalone ? 'text-[15px] font-extrabold' : 'text-[12.5px]'}`}>휴가</span>
        <button type="button" onClick={() => navigate(`/gw/approval/new?type=휴가&date=${todayKst()}`)} className="cursor-pointer text-[11.5px] font-bold text-[#2f86c4] hover:underline">
          휴가원 작성
        </button>
      </div>
      <div className="grid grid-cols-2 divide-x divide-border rounded-xl border border-border">
        {cells.map((c) => (
          <button key={c.key} type="button" onClick={() => navigate('/gw/leave')} className="min-w-0 cursor-pointer px-3 py-2.5 text-left first:rounded-l-xl last:rounded-r-xl hover:bg-panel-alt">
            <span className="flex items-baseline justify-between gap-2 whitespace-nowrap">
              <span className="text-[11px] font-bold text-ink3">{c.label}</span>
              <span className="text-[15px] tabular-nums">{c.value}</span>
            </span>
            <span className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-[#eef1f5] dark:bg-white/10">
              {c.total > 0 && <span style={{ width: `${(c.used / c.total) * 100}%`, background: c.colors[0] }} />}
              {c.total > 0 && <span style={{ width: `${(c.pending / c.total) * 100}%`, background: c.colors[1] }} />}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** 내 근태 한 달 — 근태 위젯들이 함께 쓴다(같은 달은 한 번만 읽는다) */
function useMyCommuteDays(month: string) {
  const { user: me } = useAuth();
  const today = todayKst();
  const boot = useCommuteBootstrap(month, false);
  const viewer = useCommuteViewer({ enabled: boot.isSettled }).data;
  const employees = useCommuteEmployees({ enabled: boot.isSettled }).data ?? [];
  const myEmpId = useMemo(() => {
    if (!viewer) return null;
    if (viewer.empId) return viewer.empId;
    const norm = (s?: string | null) => (s ?? '').replace(/\s+/g, '');
    const found = employees.find((e) => (me?.name && norm(e.name) === norm(me.name)) || (me?.empNo && e.empId === Number(me.empNo)));
    return found?.empId ?? null;
  }, [viewer, employees, me]);
  const { evaluate, approvalDaysOf } = useCommuteEvaluation();
  const myMonthQuery = useCommuteMonth(myEmpId, month, { enabled: boot.isSettled });
  const myDays = useMemo(() => {
    const approvalDays = approvalDaysOf({ id: me?.id, name: me?.name });
    const rows = new Map((myMonthQuery.data ?? []).map((r) => [r.date, r]));
    return monthDates(month).map((date) => {
      const raw = rows.get(date);
      const rec = evaluate({ empId: myEmpId ?? 0, date, inAt: raw?.inAt ?? null, outAt: raw?.outAt ?? null }, approvalDays);
      let bucket = bucketOf(rec.status);
      if (date > today && bucket !== 'leave') bucket = 'pending';
      /*
        외근·출장 날 — 근태 계산은 8시간을 쳐 주지만(결재로 인정) 실제 출퇴근 기록과는 다르다.
        막대에는 외근·출장 색 영역으로 따로 보이고, 기록이 있으면 그 시간(결재 없이 계산한 시간)만 근무 막대로 얹는다.
      */
      const away: AwayKind = rec.status === 'outside' || rec.status === 'trip' ? rec.status : null;
      const actualMin = away ? (raw?.inAt && raw?.outAt ? evaluate({ empId: myEmpId ?? 0, date, inAt: raw.inAt, outAt: raw.outAt }, NO_APPROVALS).totalMin ?? 0 : 0) : rec.totalMin ?? 0;
      return { date, bucket, status: rec.status, minutes: rec.totalMin ?? 0, leaveMin: rec.leaveMin ?? 0, workedMin: rec.workedMin, actualMin, away, inAt: rec.inAt, outAt: rec.outAt };
    });
  }, [month, myMonthQuery.data, evaluate, approvalDaysOf, me?.id, me?.name, myEmpId, today]);
  return { myDays, myEmpId, settled: boot.isSettled };
}

export function AttendanceWidget() {
  const navigate = useGo();
  const today = todayKst();
  const [month, setMonth] = useState(today.slice(0, 7));
  const { myDays, myEmpId, settled } = useMyCommuteDays(month);
  const passed = myDays.filter((d) => d.date <= today);
  const counts = ATTENDANCE_BUCKETS.reduce((acc, k) => ({ ...acc, [k]: passed.filter((d) => d.bucket === k).length }), {} as Record<AttendanceBucket, number>);
  const workedDays = passed.filter((d) => d.minutes > 0);
  const avgMin = workedDays.length ? Math.round(workedDays.reduce((s, d) => s + d.minutes, 0) / workedDays.length) : 0;
  const todayRec = myDays.find((d) => d.date === today);
  const isThisMonth = month === today.slice(0, 7);
  const tier = useTier();
  // 오늘 출퇴근 — 다른 달을 보고 있어도 오늘 것(같은 달 조회는 한 번만 읽는다)
  const cur = useMyCommuteDays(today.slice(0, 7));
  const nowRec = cur.myDays.find((d) => d.date === today);

  if (tier === 'S') {
    const stats = [
      { label: '출근', value: counts.work + counts.late, unit: '일' },
      { label: '지각', value: counts.late, unit: '일', warn: counts.late > 0 },
      { label: '휴가', value: counts.leave, unit: '일' },
    ];
    return (
      <Panel>
        <Head
          title="내 근태"
          note={todayRec?.inAt ? `오늘 ${new Date(todayRec.inAt).toTimeString().slice(0, 5)} 출근` : '오늘 출근 기록 없음'}
          to={() => navigate('/gw/commute')}
          toLabel="근태 화면"
        />
        {myEmpId === null && settled ? (
          <Empty>근태 기록과 연결된 사번이 없습니다.</Empty>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-1.5">
              {stats.map((t) => (
                <div key={t.label} className="rounded-xl bg-panel-alt px-2 py-2.5 text-center">
                  <div className={`text-[20px] leading-none font-black tabular-nums ${t.warn ? 'text-[#e0703f]' : 'text-ink'}`}>
                    {t.value}<span className="ml-0.5 text-[11px] font-bold text-ink3">{t.unit}</span>
                  </div>
                  <div className="mt-1.5 text-[10.5px] font-bold text-ink3">{t.label}</div>
                </div>
              ))}
            </div>
            <div className="mt-auto flex items-baseline justify-between pt-3 text-[11.5px] text-ink3">
              <span>{Number(month.slice(5))}월 하루 평균</span>
              <strong className="text-[13px] tabular-nums text-ink">{Math.floor(avgMin / 60)}시간 {avgMin % 60}분</strong>
            </div>
          </>
        )}
      </Panel>
    );
  }

  return (
    <Panel>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-extrabold tracking-tight text-ink">내 근태</h2>
        <div className="flex items-center gap-1.5">
          <button type="button" aria-label="지난달" onClick={() => setMonth((m) => shiftMonth(m, -1))} className="grid h-7 w-7 cursor-pointer place-items-center rounded-lg text-ink3 hover:bg-panel-alt"><ChevronLeft size={15} /></button>
          <span className="min-w-[78px] text-center text-[13px] font-extrabold tabular-nums text-ink">{month.replace('-', '. ')}</span>
          <button type="button" aria-label="다음달" onClick={() => setMonth((m) => shiftMonth(m, 1))} className="grid h-7 w-7 cursor-pointer place-items-center rounded-lg text-ink3 hover:bg-panel-alt"><ChevronRight size={15} /></button>
          {!isThisMonth && (
            <button type="button" onClick={() => setMonth(today.slice(0, 7))} className="ml-1 cursor-pointer rounded-md px-2 py-1 text-[11px] font-bold text-[#2f86c4] hover:bg-panel-alt">이번 달</button>
          )}
          <button type="button" onClick={() => navigate('/gw/commute')} className="ml-2 cursor-pointer text-[11.5px] font-bold text-[#2f86c4] hover:underline">근태 화면</button>
        </div>
      </div>

      {myEmpId === null && settled ? (
        <Empty>근태 기록과 연결된 사번이 없어 근태를 불러오지 못했습니다. 인사 담당자에게 사번 연결을 요청하세요.</Empty>
      ) : (
        <div className={`grid gap-6 ${tier ? 'min-h-0 flex-1 grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]' : 'lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]'}`}>
          {/* 왼쪽: 도넛 + 범례, 달력(달력 칸은 남은 높이에 맞춰 줄어든다) */}
          <div className="flex min-h-0 flex-col">
            <div className="mb-3 flex items-center gap-4">
              <Donut counts={counts} centerTop={`${counts.work + counts.late}일`} centerBottom="출근한 날" />
              <TodayClock rec={nowRec} />
            </div>
            {/* 도넛 색 설명 — 작게 한 줄(휴무/기타는 회색 칸이라 설명하지 않는다) */}
            <ul className="m-0 -mt-1 mb-3 flex list-none flex-wrap gap-x-3 gap-y-1 p-0">
              {ATTENDANCE_BUCKETS.filter((k) => k !== 'pending').map((k) => (
                <li key={k} className="flex items-center gap-1 whitespace-nowrap text-[10.5px] text-ink3">
                  <i className="h-2 w-2 shrink-0 rounded-[2px]" style={{ background: BUCKET_STROKE[k] }} />
                  {ATTENDANCE_LABELS[k]}
                  <strong className="tabular-nums text-ink2">{counts[k]}</strong>
                </li>
              ))}
            </ul>
            <div className="mb-1 grid grid-cols-7 gap-1">
              {WEEKDAYS.map((w, i) => (
                <span key={w} className={`text-center text-[10px] font-bold ${i === 0 ? 'text-[#d97a7a]' : i === 6 ? 'text-[#6f9cc4]' : 'text-ink3'}`}>{w}</span>
              ))}
            </div>
            <div className="grid min-h-0 flex-1 auto-rows-fr grid-cols-7 gap-1">
              {Array.from({ length: firstWeekday(month) }, (_, i) => <div key={`e${i}`} />)}
              {myDays.map((d) => (
                <button
                  key={d.date}
                  type="button"
                  onClick={() => navigate('/gw/commute')}
                  title={`${Number(d.date.slice(8))}일 ${d.date > today && d.bucket === 'pending' ? '' : ATTENDANCE_LABELS[d.bucket]}`}
                  className={`h-full max-h-8 min-h-[22px] cursor-pointer rounded-md text-[11px] font-bold tabular-nums ${BUCKET_CELL[d.bucket]} ${d.date === today ? 'ring-2 ring-[#0876c8] ring-offset-1 ring-offset-panel' : ''} ${d.date > today ? 'opacity-50' : ''}`}
                >
                  {Number(d.date.slice(8))}
                </button>
              ))}
            </div>
          </div>

          {/* 오른쪽: 일별 근무시간, 연차 */}
          <div className="flex min-w-0 flex-col">
            <div className="mb-3 flex items-baseline justify-between">
              <span className="text-[12.5px] font-bold text-ink">일별 근무시간</span>
              <span className="text-[11.5px] text-ink3">
                하루 평균 <strong className="tabular-nums text-ink">{Math.floor(avgMin / 60)}시간 {avgMin % 60}분</strong>
              </span>
            </div>
            <HoursBars days={myDays} today={today} />
            <LeaveBar />
          </div>
        </div>
      )}
    </Panel>
  );
}

/* ───────────────────────── 전자결재 ───────────────────────── */

export function ApprovalWidget() {
  const navigate = useGo();
  const { user: me } = useAuth();
  const { byBox, counts, isLoading: boxesLoading } = useApprovalBoxes(me?.id);
  const unreadState = useApprovalUnread(me?.id ?? '', byBox, boxesLoading);
  const pending = useMemo(
    () => (me ? (byBox['대기'] ?? []).filter((d) => currentApproverIds(d).includes(me.id)) : []),
    [byBox, me],
  );
  const inProgressDocs = useMemo(() => (byBox['상신'] ?? []).filter((d) => d.status === '진행중'), [byBox]);
  const mineInProgress = inProgressDocs.length;
  // 수신 — 남에게서 받은 문서 중 안 읽은 것만(내가 기안해 수신으로 잡힌 문서는 뺀다)
  const receivedUnread = useMemo(
    () => (byBox['수신'] ?? []).filter((d) => d.drafterId !== me?.id && unreadState.unread['수신'].ids.has(d.id)),
    [byBox, me?.id, unreadState.unread],
  );
  // 카드를 누르면 화면을 옮기지 않고 아래 목록이 그 문서함으로 바뀐다
  const tiles = [
    { key: '대기', label: '결재 대기', value: pending.length, docs: pending, empty: '결재할 문서가 없습니다.' },
    { key: '상신', label: '진행 중', value: mineInProgress, docs: inProgressDocs, empty: '진행 중인 문서가 없습니다.' },
    { key: '반려', label: '반려', value: counts['반려'] ?? 0, docs: byBox['반려'] ?? [], empty: '반려된 문서가 없습니다.' },
    { key: '수신', label: '수신', value: receivedUnread.length, docs: receivedUnread, empty: '새로 받은 문서가 없습니다.' },
  ];
  const [boxKey, setBoxKey] = useState('대기');
  const active = tiles.find((t) => t.key === boxKey) ?? tiles[0];
  const dateOf = (d: (typeof pending)[number]) => (d.submittedAt ?? d.createdAt ?? '').slice(5, 10).replace('-', '.');
  if (useMini()) {
    return (
      <MiniPanel title="결재 대기" onClick={() => navigate('/gw/approval?box=대기')}>
        <span className={`${MINI_BIG} ${pending.length ? '!text-[#0876c8]' : ''}`}>
          {pending.length}<span className="ml-0.5 text-[14px] font-bold text-ink3">건</span>
        </span>
        <span className={MINI_SUB}>진행 중 {mineInProgress}건</span>
      </MiniPanel>
    );
  }
  return (
    <Panel>
      <Head title="전자결재" to={() => navigate(`/gw/approval?box=${encodeURIComponent(active.key)}`)} />
      <div className="mb-4 grid grid-cols-4 gap-1.5" role="tablist" aria-label="문서함">
        {tiles.map((t) => {
          const on = t.key === active.key;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setBoxKey(t.key)}
              className={`cursor-pointer rounded-xl px-2 py-2.5 text-center transition-colors ${on ? 'bg-[#0876c8] text-white' : 'bg-panel-alt text-ink hover:bg-[#e6eef8] dark:hover:bg-white/10'}`}
            >
              <div className="text-[20px] leading-none font-black tabular-nums">{t.value}</div>
              <div className={`mt-1.5 text-[10.5px] font-bold whitespace-nowrap ${on ? 'text-white/85' : 'text-ink3'}`}>{t.label}</div>
            </button>
          );
        })}
      </div>
      {active.docs.length === 0 ? (
        <Empty>{active.empty}</Empty>
      ) : (
        <ul className={`m-0 list-none p-0 ${FIT_LIST}`} role="tabpanel">
          {active.docs.map((d) => (
            <li key={d.id}>
              <button type="button" onClick={() => navigate(`/gw/approval?doc=${encodeURIComponent(d.id)}`)} className="group flex w-full cursor-pointer items-center gap-3 py-1.5 text-left">
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink group-hover:text-[#0876c8]">{d.title}</span>
                <span className="shrink-0 text-[11px] text-ink3">
                  {active.key === '대기' || active.key === '수신' ? d.drafterName ?? '' : dateOf(d)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* ───────────────────────── 자원예약 ───────────────────────── */

export function ResourceWidget() {
  const navigate = useGo();
  const { user: me } = useAuth();
  const today = todayKst();
  const query = useReservations(me ? { requesterUserId: me.id } : undefined);
  const upcoming = useMemo(() => {
    const nowIso = new Date().toISOString();
    return (query.data ?? [])
      .filter((r) => (r.status === 'CONFIRMED' || r.status === 'PENDING') && r.endAt >= nowIso)
      .sort((a, b) => a.startAt.localeCompare(b.startAt))
      .slice(0, 4);
  }, [query.data]);
  return (
    <Panel>
      <Head title="내 자원예약" to={() => navigate('/gw/resource')} toLabel="예약하기" />
      {upcoming.length === 0 ? (
        <Empty>다가오는 예약이 없습니다.</Empty>
      ) : (
        <ul className={`m-0 list-none gap-2 p-0 ${FIT_LIST}`}>
          {upcoming.map((r) => {
            const date = kstDate(r.startAt);
            const isToday = date === today;
            return (
              <li key={r.id}>
                <button type="button" onClick={() => navigate('/gw/resource')} className="group grid w-full cursor-pointer grid-cols-[46px_minmax(0,1fr)] items-center gap-3 rounded-xl bg-panel-alt px-3 py-2 text-left hover:bg-[#e6eef8] dark:hover:bg-white/10">
                  <span className={`text-center leading-tight ${isToday ? 'text-[#0876c8]' : 'text-ink2'}`}>
                    <span className="block text-[10px] font-bold">{isToday ? '오늘' : `${Number(date.slice(5, 7))}.${Number(date.slice(8))}`}</span>
                    <span className="block text-[13px] font-extrabold tabular-nums">{kstTime(r.startAt)}</span>
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[12.5px] font-bold text-ink group-hover:text-[#0876c8]">{r.resourceNameSnapshot}</span>
                    <span className="block truncate text-[11px] text-ink3">
                      {kstTime(r.startAt)}~{kstTime(r.endAt)} {r.title}{r.status === 'PENDING' ? ' (승인 대기)' : ''}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

/* ───────────────────────── 우리 부서 ───────────────────────── */

const PRESENCE_ORDER: UserPresenceStatus[] = ['ONLINE', 'MEETING', 'FOCUS', 'OUTSIDE', 'AWAY', 'LEAVE', 'OFFLINE'];

export function TeamWidget() {
  const navigate = useGo();
  const { user: me } = useAuth();
  const users = useUsers(me?.dept ? { dept: me.dept, status: '사용' } : undefined).data ?? [];
  const presences = useAllUserPresences();
  const members = useMemo(
    () => users
      .map((u) => ({ u, status: (presences[u.id]?.status ?? 'OFFLINE') as UserPresenceStatus }))
      .sort((a, b) => PRESENCE_ORDER.indexOf(a.status) - PRESENCE_ORDER.indexOf(b.status) || a.u.name.localeCompare(b.u.name, 'ko')),
    [users, presences],
  );
  const groups = PRESENCE_ORDER.map((s) => ({ s, n: members.filter((m) => m.status === s).length })).filter((g) => g.n > 0);
  return (
    <Panel>
      <Head title={me?.dept && me.dept !== '미지정' ? me.dept : '우리 부서'} note={members.length ? `${members.length}명` : undefined} to={() => navigate('/gw/orgchart')} toLabel="조직도" />
      {members.length === 0 ? (
        <Empty>부서원이 없습니다.</Empty>
      ) : (
        <>
          <div className="mb-1.5 flex h-2 gap-[2px] overflow-hidden rounded-full">
            {groups.map((g) => (
              <div key={g.s} className={`${USER_PRESENCE_META[g.s].dotColor} first:rounded-l-full last:rounded-r-full`} style={{ width: `${(g.n / members.length) * 100}%` }} title={`${USER_PRESENCE_META[g.s].label} ${g.n}명`} />
            ))}
          </div>
          <div className="mb-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink2">
            {groups.map((g) => (
              <span key={g.s} className="flex items-center gap-1.5"><i className={`h-2 w-2 rounded-full ${USER_PRESENCE_META[g.s].dotColor}`} />{USER_PRESENCE_META[g.s].label} <strong className="tabular-nums text-ink">{g.n}</strong></span>
            ))}
          </div>
          <ul className="m-0 grid list-none grid-cols-2 gap-x-3 gap-y-1 p-0">
            {members.slice(0, 8).map(({ u, status }) => (
              <li key={u.id} className="flex min-w-0 items-center gap-2 py-1">
                <span className="relative shrink-0">
                  {u.photoThumbUrl || u.photoUrl ? (
                    <img src={u.photoThumbUrl || u.photoUrl} alt="" className="h-7 w-7 rounded-full object-cover" />
                  ) : (
                    <span className="grid h-7 w-7 place-items-center rounded-full bg-panel-alt text-[11px] font-bold text-ink2">{u.name.slice(0, 1)}</span>
                  )}
                  <i className={`absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-panel ${USER_PRESENCE_META[status].dotColor}`} />
                </span>
                <span className="min-w-0 truncate text-[12px] text-ink">
                  {u.name}<span className="ml-1 text-[11px] text-ink3">{u.position}</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}

/* ───────────────────────── 공지사항 ───────────────────────── */

export function NoticeWidget() {
  const navigate = useGo();
  const posts = useBoardPosts().data ?? [];
  const notices = useMemo(() => sortPostsForList(posts.filter((p) => p.boardId === 'notice')).slice(0, 6), [posts]);
  const openPost = (p: Post) => navigate(`/gw/board?board=${p.boardId}&postId=${encodeURIComponent(p.id)}`);
  return (
    <Panel>
      <Head title="공지사항" to={() => navigate('/gw/board?board=notice')} />
      {notices.length === 0 ? (
        <Empty>등록된 공지사항이 없습니다.</Empty>
      ) : (
        <ul className={`m-0 list-none p-0 ${FIT_LIST}`}>
          {notices.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => openPost(p)} className="group grid w-full cursor-pointer grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-3 rounded-lg py-2 text-left">
                <span className="text-[11px] tabular-nums text-ink3">{p.date.slice(5, 10).replace('-', '.')}</span>
                <span className="flex min-w-0 items-center gap-2">
                  {p.isPinned && <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-extrabold text-[#c4432f] ring-1 ring-[#f3b8a6] dark:text-red-300 dark:ring-red-400/40">필독</span>}
                  <span className="truncate text-[13px] text-ink group-hover:text-[#0876c8]">{p.title}</span>
                </span>
                <span className="max-w-[88px] truncate text-[11px] text-ink3">{p.author}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* ───────────────────────── 프로젝트(준비 중) ───────────────────────── */

export function ProjectWidget() {
  return (
    <Panel className="flex flex-col">
      <Head title="프로젝트" />
      <div className="grid min-h-[120px] flex-1 place-items-center rounded-2xl border border-dashed border-border bg-panel-alt/60" aria-disabled="true">
        <div className="text-[14px] font-bold text-ink3">준비 중</div>
      </div>
    </Panel>
  );
}

/* ───────────────────────── 연차(따로) ───────────────────────── */

export function LeaveWidget() {
  const navigate = useGo();
  const { user: me } = useAuth();
  const leave = useLeave(me?.id);
  if (useMini()) {
    const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
    return (
      <MiniPanel title="남은 연차" onClick={() => navigate('/gw/leave')}>
        <span className={`${MINI_BIG} ${leave.remaining < 0 ? '!text-[#c4432f]' : ''}`}>
          {leave.isLoading ? '-' : fmt(leave.remaining)}<span className="ml-0.5 text-[14px] font-bold text-ink3">일</span>
        </span>
        <span className={MINI_SUB}>총 {fmt(leave.grant)}일 중 {fmt(leave.used)}일 사용</span>
      </MiniPanel>
    );
  }
  return (
    <Panel>
      <LeaveBar standalone />
    </Panel>
  );
}

/* ───────────────────────── 근태: 오늘 출퇴근 ───────────────────────── */

const DAY_GOAL_MIN = 8 * 60;

function clockOf(iso: string | null | undefined): string | null {
  return iso ? new Date(iso).toTimeString().slice(0, 5) : null;
}

/** 진행 고리 — 0~1 */
function Ring({ value, size = 104, stroke = 10, children }: { value: number; size?: number; stroke?: number; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full -rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-panel-alt" />
        {value > 0 && <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} stroke="#0876c8" strokeLinecap="round" strokeDasharray={`${Math.min(1, value) * c} ${c}`} />}
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
    </div>
  );
}

export function TodayCommuteWidget() {
  const navigate = useGo();
  const today = todayKst();
  const { myDays, myEmpId, settled } = useMyCommuteDays(today.slice(0, 7));
  const rec = myDays.find((d) => d.date === today);
  // 아직 퇴근 전이면 지금까지 일한 시간
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  const inClock = clockOf(rec?.inAt);
  const outClock = clockOf(rec?.outAt);
  const worked = rec?.inAt && !rec.outAt ? Math.max(0, Math.round((nowMs - Date.parse(rec.inAt)) / 60_000)) : rec?.minutes ?? 0;
  if (useMini()) {
    const status = rec && rec.bucket !== 'pending' && rec.status !== 'unknown' && !rec.inAt ? COMMUTE_STATUS_LABELS[rec.status] : null;
    return (
      <MiniPanel title="오늘 출퇴근" onClick={() => navigate('/gw/commute')}>
        <span className={`${MINI_BIG} ${rec?.bucket === 'late' ? '!text-[#c4602f]' : ''}`}>{inClock ?? status ?? '--:--'}</span>
        <span className={MINI_SUB}>{outClock ? `퇴근 ${outClock}` : `${hoursText(worked)} 근무`}</span>
      </MiniPanel>
    );
  }
  return (
    <Panel>
      <Head title="오늘 출퇴근" to={() => navigate('/gw/commute')} toLabel="근태 화면" />
      {myEmpId === null && settled ? (
        <Empty>근태 기록과 연결된 사번이 없습니다.</Empty>
      ) : (
        <div className="flex items-center gap-5">
          <Ring value={worked / DAY_GOAL_MIN}>
            <div>
              <div className="text-[16px] leading-tight font-extrabold tabular-nums text-ink">{hoursText(worked)}</div>
              <div className="text-[10px] text-ink3">/ 8시간</div>
            </div>
          </Ring>
          <dl className="m-0 grid min-w-0 flex-1 gap-2">
            {[
              { label: '출근', value: inClock, late: rec?.bucket === 'late' },
              { label: '퇴근', value: outClock, late: false },
            ].map((x) => (
              <div key={x.label} className="flex items-center justify-between gap-2 rounded-xl bg-panel-alt px-3 py-2">
                <dt className="shrink-0 text-[11.5px] font-bold text-ink3">{x.label}</dt>
                <dd className={`m-0 text-[20px] leading-tight font-black whitespace-nowrap tabular-nums ${x.value ? (x.late ? 'text-[#c4602f]' : 'text-ink') : 'text-ink3'}`}>
                  {x.value ?? '--:--'}
                </dd>
              </div>
            ))}
            {/* 외근·출장·휴가처럼 출퇴근 기록 없이 인정된 날은 그 상태를 적는다 */}
            {rec && rec.bucket !== 'pending' && rec.status !== 'unknown' && (rec.bucket !== 'work' || !rec.inAt) && (
              <div className="text-[11.5px] font-bold text-ink2">{COMMUTE_STATUS_LABELS[rec.status]}</div>
            )}
          </dl>
        </div>
      )}
    </Panel>
  );
}

/* ───────────────────────── 근태: 근무시간(주간·월간) ───────────────────────── */

type HoursMode = 'week' | 'month';
const HOURS_MODE_KEY = 'workfit.home.hoursMode';
function loadHoursMode(): HoursMode {
  try {
    return localStorage.getItem(HOURS_MODE_KEY) === 'month' ? 'month' : 'week';
  } catch {
    return 'week';
  }
}

/** 주간·월간 고르기 */
function HoursModeSwitch({ mode, onChange }: { mode: HoursMode; onChange: (m: HoursMode) => void }) {
  return (
    <div role="radiogroup" aria-label="기간" className="flex rounded-lg bg-panel-alt p-0.5">
      {(['week', 'month'] as const).map((m) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={mode === m}
          onClick={() => onChange(m)}
          className={`cursor-pointer rounded-md px-2 py-0.5 text-[11px] font-bold ${mode === m ? 'bg-panel text-ink shadow-[0_1px_2px_rgba(0,0,0,.08)]' : 'text-ink3 hover:text-ink2'}`}
        >
          {m === 'week' ? '주간' : '월간'}
        </button>
      ))}
    </div>
  );
}

/**
 * 근무시간 — 주간(이번 주 월~일, 기준 40시간)과 월간(이번 달, 기준 = 이번 달 평일(공휴일 뺌) × 8시간)을 오간다.
 * 고른 보기는 이 브라우저에 기억한다.
 */
export function WeekHoursWidget() {
  const navigate = useGo();
  const today = todayKst();
  const month = today.slice(0, 7);
  const week = weekDates(today);
  const [mode, setModeState] = useState<HoursMode>(loadHoursMode);
  const setMode = (m: HoursMode) => {
    setModeState(m);
    try {
      localStorage.setItem(HOURS_MODE_KEY, m);
    } catch {
      /* 기억 못 해도 보기는 바뀐다 */
    }
  };
  // 주가 두 달에 걸칠 수 있어 두 달을 읽는다(같은 달이면 한 번만 읽는다)
  const a = useMyCommuteDays(week[0].slice(0, 7));
  const b = useMyCommuteDays(month);
  const byDate = new Map([...a.myDays, ...b.myDays].map((d) => [d.date, d]));
  const holidays = useHolidays(month.slice(0, 4)).data ?? [];
  const holidaySet = new Set(holidays.map((h) => h.date));

  const weekDays = week.map((date) => {
    const d = date <= today ? byDate.get(date) : undefined;
    return { date, minutes: d?.minutes ?? 0, actualMin: d?.actualMin ?? 0, away: d?.away ?? null, late: d?.bucket === 'late' };
  });
  const monthDays = b.myDays;
  const isWorkday = (d: string) => weekdayOf(d) !== 0 && weekdayOf(d) !== 6 && !holidaySet.has(d);
  const isWeek = mode === 'week';
  const total = isWeek ? weekDays.reduce((s, d) => s + d.minutes, 0) : monthDays.filter((d) => d.date <= today).reduce((s, d) => s + d.minutes, 0);
  const goal = isWeek ? 40 * 60 : monthDates(month).filter(isWorkday).length * DAY_GOAL_MIN;
  // 오늘까지 채웠어야 할 시간 — 월간에서 앞섰는지·뒤졌는지
  const dueSoFar = monthDates(month).filter((d) => d <= today && isWorkday(d)).length * DAY_GOAL_MIN;
  const worked = monthDays.filter((d) => d.date <= today && d.minutes > 0);
  const avg = worked.length ? Math.round(worked.reduce((s, d) => s + d.minutes, 0) / worked.length) : 0;
  const MAX = 12 * 60;

  if (useMini()) {
    return (
      <MiniPanel title={isWeek ? '이번 주 근무' : '이번 달 근무'} onClick={() => setMode(isWeek ? 'month' : 'week')}>
        <span className={MINI_BIG}>{hoursText(total)}</span>
        <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-panel-alt">
          <span className="block h-full rounded-full bg-[#0876c8]" style={{ width: `${goal ? Math.min(100, (total / goal) * 100) : 0}%` }} />
        </span>
      </MiniPanel>
    );
  }
  return (
    <Panel>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-[15px] font-extrabold tracking-tight text-ink">근무시간</h2>
        <div className="flex items-center gap-2">
          <HoursModeSwitch mode={mode} onChange={setMode} />
          <button type="button" onClick={() => navigate('/gw/commute')} className="shrink-0 cursor-pointer text-[11.5px] font-bold text-[#2f86c4] hover:underline">근태 화면</button>
        </div>
      </div>
      <div className="mb-1 flex items-baseline gap-2">
        <span className="text-[24px] leading-none font-black tabular-nums text-ink">{hoursText(total)}</span>
        <span className="text-[12px] text-ink3">/ {hoursText(goal)}</span>
        <span className="ml-auto text-[11px] text-ink3">{isWeek ? '이번 주' : `${Number(month.slice(5))}월`}</span>
      </div>
      <div className="mb-1.5 h-1.5 overflow-hidden rounded-full bg-panel-alt">
        <div className="h-full rounded-full bg-[#0876c8]" style={{ width: `${goal ? Math.min(100, (total / goal) * 100) : 0}%` }} />
      </div>
      <div className="mb-3 flex justify-between text-[11px] text-ink3">
        {isWeek ? (
          <span>남은 시간 <strong className="tabular-nums text-ink2">{hoursText(Math.max(0, goal - total))}</strong></span>
        ) : (
          <span>
            오늘까지 기준보다{' '}
            <strong className={`tabular-nums ${total >= dueSoFar ? 'text-[#0876c8]' : 'text-[#c4602f]'}`}>
              {hoursText(Math.abs(total - dueSoFar))} {total >= dueSoFar ? '더' : '덜'}
            </strong>
          </span>
        )}
        <span>하루 평균 <strong className="tabular-nums text-ink2">{hoursText(avg)}</strong></span>
      </div>
      {isWeek ? (
        <>
          <div className="relative flex h-[84px] items-end gap-2">
            <div className="absolute inset-x-0 border-t border-dashed border-border" style={{ bottom: `${(DAY_GOAL_MIN / MAX) * 100}%` }} />
            {weekDays.map((d) => (
              <DayHoursColumn key={d.date} d={d} max={MAX} show radius="rounded-t-[5px]" label={WEEKDAYS[weekdayOf(d.date)]} />
            ))}
          </div>
          <div className="mt-1.5 flex gap-2">
            {weekDays.map((d) => (
              <span key={d.date} className={`flex-1 text-center text-[10.5px] font-bold ${d.date === today ? 'text-[#0876c8]' : 'text-ink3'}`}>{WEEKDAYS[weekdayOf(d.date)]}</span>
            ))}
          </div>
        </>
      ) : (
        <HoursBars days={monthDays} today={today} />
      )}
      {/* 이 위젯은 원래 색 설명이 없다 — 외근·출장 날이 있을 때만 붙인다 */}
      {(isWeek ? weekDays : monthDays.filter((d) => d.date <= today)).some((d) => d.away) && (
        <HoursLegend days={isWeek ? weekDays : monthDays.filter((d) => d.date <= today)} />
      )}
    </Panel>
  );
}

/* ───────────────────────── 일정: 달력 ───────────────────────── */

/** 한 달 달력 — 날마다 내 일정을 색 점으로, 날짜를 누르면 그날 일정이 아래에 */
export function CalendarWidget() {
  const navigate = useGo();
  const { user: me } = useAuth();
  const deptId = useDeptId();
  const today = todayKst();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [picked, setPicked] = useState(today);
  const dates = useMemo(() => monthDates(month), [month]);
  const members = useMemo(() => (me ? [me] : []), [me]);
  const { cellOf } = useDayEntryIndex({ actor: me, deptId, members, dates });
  const holidays = useHolidays(month.slice(0, 4)).data ?? [];
  const holidayOf = new Map(holidays.map((h) => [h.date, h.name]));
  const lead = firstWeekday(month);
  const entriesOf = (date: string) => (me ? cellOf(me.id, date).entries : []);
  const pickedEntries = picked.startsWith(month) ? entriesOf(picked) : [];
  const move = (delta: number) => {
    const next = shiftMonth(month, delta);
    setMonth(next);
    setPicked(today.startsWith(next) ? today : `${next}-01`);
  };
  return (
    <Panel>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => move(-1)} aria-label="이전 달" className="grid h-7 w-7 cursor-pointer place-items-center rounded-lg text-ink3 hover:bg-panel-alt"><ChevronLeft size={16} /></button>
          <h2 className="min-w-[86px] text-center text-[15px] font-extrabold tracking-tight text-ink tabular-nums">{Number(month.slice(0, 4))}. {Number(month.slice(5))}월</h2>
          <button type="button" onClick={() => move(1)} aria-label="다음 달" className="grid h-7 w-7 cursor-pointer place-items-center rounded-lg text-ink3 hover:bg-panel-alt"><ChevronRight size={16} /></button>
          {month !== today.slice(0, 7) && (
            <button type="button" onClick={() => { setMonth(today.slice(0, 7)); setPicked(today); }} className="ml-1 cursor-pointer text-[11.5px] font-bold text-ink3 hover:text-[#0876c8]">오늘</button>
          )}
        </div>
        <button type="button" onClick={() => navigate('/gw/calendar')} className="shrink-0 cursor-pointer text-[11.5px] font-bold text-[#2f86c4] hover:underline">캘린더</button>
      </div>
      <div className="grid grid-cols-7 text-center">
        {WEEKDAYS.map((w, i) => (
          <span key={w} className={`pb-1.5 text-[10.5px] font-bold ${i === 0 ? 'text-[#d97a7a]' : i === 6 ? 'text-[#6f9cc4]' : 'text-ink3'}`}>{w}</span>
        ))}
        {Array.from({ length: lead }, (_, i) => <span key={`b${i}`} />)}
        {dates.map((date) => {
          const wd = weekdayOf(date);
          const holiday = holidayOf.get(date);
          const dots = entriesOf(date);
          const isToday = date === today;
          const isPicked = date === picked;
          return (
            <button
              key={date}
              type="button"
              onClick={() => setPicked(date)}
              title={holiday}
              className={`flex h-9 cursor-pointer flex-col items-center gap-0.5 rounded-lg pt-0.5 ${isPicked ? 'bg-[#e6f1fb] dark:bg-sky-500/15' : 'hover:bg-panel-alt'}`}
            >
              <span
                className={`grid h-6 w-6 place-items-center rounded-full text-[12px] font-bold tabular-nums ${
                  isToday ? 'bg-[#0876c8] text-white' : holiday || wd === 0 ? 'text-[#d97a7a]' : wd === 6 ? 'text-[#6f9cc4]' : 'text-ink'
                }`}
              >
                {Number(date.slice(8))}
              </span>
              <span className="flex h-1.5 items-center gap-[3px]">
                {dots.slice(0, 3).map((e) => <i key={e.key} className={`h-1.5 w-1.5 rounded-full ${entryDotClass(e)}`} />)}
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex min-h-0 flex-1 flex-col border-t border-border pt-3">
        <div className="mb-2 text-[12px] font-bold text-ink2">
          {Number(picked.slice(5, 7))}월 {Number(picked.slice(8))}일 {WEEKDAYS[weekdayOf(picked)]}요일
          {holidayOf.get(picked) && <span className="ml-1.5 text-[#d97a7a]">{holidayOf.get(picked)}</span>}
        </div>
        {pickedEntries.length === 0 ? (
          <div className="text-[12px] text-ink3">일정이 없습니다.</div>
        ) : (
          <ul className={`m-0 list-none gap-1.5 p-0 ${FIT_LIST}`}>
            {pickedEntries.map((e) => {
              const look = chipLook(e);
              return (
                <li key={e.key}>
                  <button type="button" onClick={() => navigate('/gw/work-plan')} className="group flex w-full cursor-pointer items-center gap-2 text-left">
                    <i className={`h-2 w-2 shrink-0 rounded-full ${entryDotClass(e)}`} />
                    <span className="w-[74px] shrink-0 text-[11px] font-semibold tabular-nums text-ink3">
                      {e.startTime && !e.allDay ? `${e.startTime.slice(0, 5)}${e.endTime ? `~${e.endTime.slice(0, 5)}` : ''}` : '종일'}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink group-hover:text-[#0876c8]">{look.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Panel>
  );
}

/* ───────────────────────── 일정: 이번 주 내 일정 ───────────────────────── */

export function WeekScheduleWidget() {
  const navigate = useGo();
  const { user: me } = useAuth();
  const deptId = useDeptId();
  const today = todayKst();
  const week = useMemo(() => weekDates(today), [today]);
  const members = useMemo(() => (me ? [me] : []), [me]);
  const { cellOf } = useDayEntryIndex({ actor: me, deptId, members, dates: week });
  return (
    <Panel>
      <Head title="이번 주 내 일정" to={() => navigate('/gw/work-plan')} toLabel="업무계획" />
      <ul className={`m-0 list-none p-0 ${FIT_LIST}`}>
        {week.map((date) => {
          const entries = me ? cellOf(me.id, date).entries : [];
          const isToday = date === today;
          const wd = weekdayOf(date);
          return (
            <li key={date} className={`grid grid-cols-[52px_minmax(0,1fr)] items-start gap-3 border-b border-border py-2 last:border-b-0 ${date < today ? 'opacity-55' : ''}`}>
              <span className={`text-[12px] font-bold tabular-nums ${isToday ? 'text-[#0876c8]' : wd === 0 ? 'text-[#d97a7a]' : wd === 6 ? 'text-[#6f9cc4]' : 'text-ink2'}`}>
                {Number(date.slice(8))}일 {WEEKDAYS[wd]}
              </span>
              <span className="flex min-w-0 flex-wrap gap-1">
                {entries.length === 0 && <span className="text-[12px] text-ink3">-</span>}
                {entries.slice(0, 3).map((e) => {
                  const look = chipLook(e);
                  return (
                    <span key={e.key} className={`flex max-w-full items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-bold ${look.badgeClass}`}>
                      {look.dotClass && <i className={`h-1.5 w-1.5 shrink-0 rounded-full ${look.dotClass}`} />}
                      <span className="truncate">{e.startTime && !e.allDay ? `${e.startTime.slice(0, 5)} ` : ''}{look.label}</span>
                    </span>
                  );
                })}
                {entries.length > 3 && <span className="px-1 text-[11px] font-bold text-ink3">+{entries.length - 3}</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

/* ───────────────────────── 전자결재: 결재 대기 목록 ───────────────────────── */

export function PendingApprovalWidget() {
  const navigate = useGo();
  const { user: me } = useAuth();
  const { byBox } = useApprovalBoxes(me?.id);
  const pending = useMemo(
    () => (me ? (byBox['대기'] ?? []).filter((d) => currentApproverIds(d).includes(me.id)) : [])
      .slice()
      .sort((a, b) => (a.submittedAt ?? '').localeCompare(b.submittedAt ?? '')),
    [byBox, me],
  );
  return (
    <Panel>
      <Head title="결재 대기" note={pending.length ? `${pending.length}건` : undefined} to={() => navigate('/gw/approval?box=대기')} />
      {pending.length === 0 ? (
        <Empty>결재할 문서가 없습니다.</Empty>
      ) : (
        <ul className={`m-0 list-none gap-1.5 p-0 ${FIT_LIST}`}>
          {pending.slice(0, 6).map((d) => (
            <li key={d.id}>
              <button type="button" onClick={() => navigate(`/gw/approval?doc=${encodeURIComponent(d.id)}`)} className="group flex w-full cursor-pointer items-center gap-3 rounded-xl bg-panel-alt px-3 py-2 text-left hover:bg-[#e6eef8] dark:hover:bg-white/10">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-bold text-ink group-hover:text-[#0876c8]">{d.title}</span>
                  <span className="block truncate text-[11px] text-ink3">{d.drafterName ?? ''}{d.drafterDept ? ` ${d.drafterDept}` : ''}</span>
                </span>
                <span className="shrink-0 text-[11px] font-bold text-[#c4602f] tabular-nums">{timeAgo(d.submittedAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* ───────────────────────── 전자결재: 내가 올린 문서 ───────────────────────── */

export function MyDraftsWidget() {
  const navigate = useGo();
  const { user: me } = useAuth();
  const { byBox } = useApprovalBoxes(me?.id);
  const docs = useMemo(
    () => (byBox['상신'] ?? []).filter((d) => d.status === '진행중').slice().sort((a, b) => (b.submittedAt ?? '').localeCompare(a.submittedAt ?? '')),
    [byBox],
  );
  return (
    <Panel>
      <Head title="내가 올린 문서" note={docs.length ? `진행 중 ${docs.length}건` : undefined} to={() => navigate('/gw/approval?box=상신')} />
      {docs.length === 0 ? (
        <Empty>진행 중인 문서가 없습니다.</Empty>
      ) : (
        <ul className={`m-0 list-none gap-3 p-0 ${FIT_LIST}`}>
          {docs.slice(0, 5).map((d) => {
            const line = d.steps.filter((s) => s.kind !== '참조').slice().sort((a, b) => a.seq - b.seq);
            const done = line.filter((s) => s.decision === '승인').length;
            return (
              <li key={d.id}>
                <button type="button" onClick={() => navigate(`/gw/approval?doc=${encodeURIComponent(d.id)}`)} className="group block w-full cursor-pointer text-left">
                  <div className="mb-1.5 flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-[12.5px] font-bold text-ink group-hover:text-[#0876c8]">{d.title}</span>
                    <span className="shrink-0 text-[11px] font-bold text-ink3 tabular-nums">{done}/{line.length}</span>
                  </div>
                  <div className="flex gap-1">
                    {line.map((s, i) => (
                      <span
                        key={`${s.seq}-${i}`}
                        title={`${s.approverName ?? ''} ${s.decision}`}
                        className={`h-1.5 flex-1 rounded-full ${s.decision === '승인' ? 'bg-[#0876c8]' : s.decision === '반려' ? 'bg-[#e5484d]' : i === done ? 'bg-[#7cc4ec]' : 'bg-panel-alt'}`}
                      />
                    ))}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

/* ───────────────────────── 자원예약: 오늘 자원 사용 현황 ───────────────────────── */

export function ResourceTodayWidget() {
  const navigate = useGo();
  const today = todayKst();
  const range = useMemo(() => ({
    from: new Date(`${today}T00:00:00+09:00`).toISOString(),
    to: new Date(`${today}T23:59:59+09:00`).toISOString(),
  }), [today]);
  const rows = useReservations(range).data ?? [];
  const byResource = useMemo(() => {
    const map = new Map<string, { name: string; items: typeof rows }>();
    for (const r of rows) {
      if (r.status !== 'CONFIRMED' && r.status !== 'PENDING' && r.status !== 'COMPLETED') continue;
      const g = map.get(r.resourceId) ?? { name: r.resourceNameSnapshot, items: [] };
      g.items.push(r);
      map.set(r.resourceId, g);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'ko')).slice(0, 6);
  }, [rows]);
  const now = nowPercent();
  const hours = [8, 10, 12, 14, 16, 18, 20];
  const tier = useTier();
  if (tier === 'S') {
    return (
      <Panel>
        <Head title="오늘 자원 사용" to={() => navigate('/gw/resource')} toLabel="예약하기" />
        {byResource.length === 0 ? (
          <Empty>오늘 예약이 없습니다.</Empty>
        ) : (
          <ul className={`m-0 list-none p-0 ${FIT_LIST}`}>
            {byResource.map((g) => (
              <li key={g.name} className="flex items-center gap-3 py-1.5">
                <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-ink2" title={g.name}>{g.name}</span>
                <span className="shrink-0 truncate text-[11.5px] tabular-nums text-ink3">
                  {g.items.slice(0, 2).map((r) => kstTime(r.startAt)).join(' · ')}
                  {g.items.length > 2 ? ` 외 ${g.items.length - 2}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    );
  }
  return (
    <Panel>
      <Head title="오늘 자원 사용" to={() => navigate('/gw/resource')} toLabel="예약하기" />
      {byResource.length === 0 ? (
        <Empty>오늘 예약이 없습니다.</Empty>
      ) : (
        <div className="grid grid-cols-[minmax(80px,120px)_minmax(0,1fr)] gap-x-3 gap-y-2">
          <span />
          <div className="relative h-3.5">
            {hours.map((h) => (
              <span key={h} className="absolute -translate-x-1/2 text-[9.5px] tabular-nums text-ink3" style={{ left: `${((h * 60 - DAY_START_MIN) / (DAY_END_MIN - DAY_START_MIN)) * 100}%` }}>{h}</span>
            ))}
          </div>
          {byResource.map((g) => (
            <div key={g.name} className="contents">
              <span className="truncate pt-1 text-[12px] font-bold text-ink2" title={g.name}>{g.name}</span>
              <div className="relative h-7 rounded-md bg-panel-alt">
                {g.items.map((r) => {
                  const sp = timelineSpan(kstTime(r.startAt), kstTime(r.endAt));
                  if (!sp) return null;
                  return (
                    <span
                      key={r.id}
                      title={`${kstTime(r.startAt)}~${kstTime(r.endAt)} ${r.title}`}
                      className={`absolute top-1 bottom-1 overflow-hidden rounded px-1 text-[10px] leading-[20px] font-bold whitespace-nowrap ${r.status === 'PENDING' ? 'border border-dashed border-[#7cc4ec] bg-[#eef7fd] text-[#2f86c4] dark:bg-sky-500/10' : 'bg-[#0876c8] text-white'}`}
                      style={{ left: `${sp.left}%`, width: `${sp.width}%` }}
                    >
                      {r.title}
                    </span>
                  );
                })}
                {now !== null && <span className="pointer-events-none absolute inset-y-0 w-0.5 bg-[#e5484d]" style={{ left: `${now}%` }} />}
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

/* ───────────────────────── 조직도: 오늘 휴가·외근 ───────────────────────── */

const AWAY_STATUSES: UserPresenceStatus[] = ['LEAVE', 'OUTSIDE'];

export function AwayTodayWidget() {
  const navigate = useGo();
  const users = useUsers({ status: '사용' }).data ?? [];
  const presences = useAllUserPresences();
  const groups = AWAY_STATUSES.map((s) => ({
    s,
    people: users.filter((u) => presences[u.id]?.status === s).sort((a, b) => a.name.localeCompare(b.name, 'ko')),
  }));
  const total = groups.reduce((n, g) => n + g.people.length, 0);
  if (useMini()) {
    const people = groups.flatMap((g) => g.people);
    return (
      <MiniPanel title="오늘 휴가·외근" onClick={() => navigate('/gw/orgchart')}>
        <span className={MINI_BIG}>{total}<span className="ml-0.5 text-[14px] font-bold text-ink3">명</span></span>
        <span className="flex h-6 items-center -space-x-1.5">
          {people.slice(0, 5).map((u) => <span key={u.id} className="rounded-full ring-2 ring-panel"><MiniAvatar user={u} size={22} /></span>)}
        </span>
      </MiniPanel>
    );
  }
  return (
    <Panel>
      <Head title="오늘 휴가·외근" note={total ? `${total}명` : undefined} to={() => navigate('/gw/orgchart')} toLabel="조직도" />
      {total === 0 ? (
        <Empty>오늘 휴가나 외근 중인 사람이 없습니다.</Empty>
      ) : (
        <div className="flex flex-col gap-3">
          {groups.filter((g) => g.people.length).map((g) => (
            <div key={g.s}>
              <div className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-bold text-ink2">
                <i className={`h-2 w-2 rounded-full ${USER_PRESENCE_META[g.s].dotColor}`} />
                {USER_PRESENCE_META[g.s].label} <span className="tabular-nums text-ink">{g.people.length}</span>
              </div>
              <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                {g.people.slice(0, 12).map((u) => (
                  <li key={u.id} className="flex items-center gap-1.5 rounded-full bg-panel-alt py-1 pr-2.5 pl-1">
                    <MiniAvatar user={u} />
                    <span className="text-[11.5px] text-ink">{u.name}</span>
                    <span className="text-[10.5px] text-ink3">{u.dept}</span>
                  </li>
                ))}
                {g.people.length > 12 && <li className="px-1 py-1 text-[11px] font-bold text-ink3">+{g.people.length - 12}</li>}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

/** 작은 얼굴 — 사진이 없으면 이름 첫 글자 */
function MiniAvatar({ user, size = 20 }: { user: { name: string; photoUrl?: string | null; photoThumbUrl?: string | null }; size?: number }) {
  const src = user.photoThumbUrl || user.photoUrl;
  return src ? (
    <img src={src} alt="" className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
  ) : (
    <span className="grid shrink-0 place-items-center rounded-full bg-panel-alt font-bold text-ink2" style={{ width: size, height: size, fontSize: size * 0.48 }}>
      {user.name.slice(0, 1)}
    </span>
  );
}

/* ───────────────────────── 조직도: 이달의 생일 ───────────────────────── */

/** 이번 달 생일인 사람 — 공개한 사람만, 날짜순. 오늘 생일은 강조, 지난 생일은 흐리게 */
export function BirthdayWidget() {
  const users = useUsers({ status: '사용' }).data ?? [];
  const profiles = useEmployeeProfiles().data ?? [];
  const today = todayKst();
  const month = today.slice(0, 7);
  const byId = new Map(users.map((u) => [u.id, u]));
  const list = birthdaysInMonth(profiles.filter((p) => byId.has(p.userId)), month);
  if (useMini()) {
    const next = list.find((x) => x.date >= today);
    const nextUser = next ? byId.get(next.person.userId) : undefined;
    return (
      <MiniPanel title="이달의 생일자">
        <span className={MINI_BIG}>{list.length}<span className="ml-0.5 text-[14px] font-bold text-ink3">명</span></span>
        <span className={`${MINI_SUB} ${next?.date === today ? '!text-[#d6336c]' : ''}`}>
          {nextUser ? (next!.date === today ? `오늘 ${nextUser.name}` : `${Number(next!.date.slice(8))}일 ${nextUser.name}`) : '남은 생일 없음'}
        </span>
      </MiniPanel>
    );
  }
  return (
    <Panel>
      <Head title="이달의 생일자" note={list.length ? `${list.length}명` : undefined} />
      {list.length === 0 ? (
        <Empty>이번 달 생일인 사람이 없습니다.</Empty>
      ) : (
        <ul className={`m-0 list-none gap-0.5 p-0 ${FIT_LIST}`}>
          {list.map(({ person, date }) => {
            const u = byId.get(person.userId)!;
            const isToday = date === today;
            return (
              <li
                key={person.userId}
                className={`flex items-center gap-2.5 rounded-xl px-2.5 py-1.5 ${isToday ? 'bg-[#fdeef3] dark:bg-pink-500/15' : ''} ${date < today ? 'opacity-45' : ''}`}
              >
                <span className={`w-10 shrink-0 text-[15px] font-black tabular-nums ${isToday ? 'text-[#d6336c]' : 'text-ink'}`}>
                  {Number(date.slice(8))}
                  <span className="ml-0.5 text-[10.5px] font-bold text-ink3">일</span>
                </span>
                <MiniAvatar user={u} size={24} />
                <span className="truncate text-[12.5px] font-bold text-ink">{u.name}</span>
                <span className="truncate text-[11px] text-ink3">{u.dept}</span>
                {isToday && <span className="ml-auto shrink-0 rounded-full bg-[#d6336c] px-2 py-0.5 text-[10.5px] font-bold text-white">오늘</span>}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

/* ───────────────────────── 조직도: 이달의 입사자 ───────────────────────── */

/** 이번 달 입사한 사람 — 재직 중인 사람만, 날짜순. 오늘 입사는 강조, 아직 오지 않은 날은 그대로 */
export function NewHiresWidget() {
  const users = useUsers({ status: '사용' }).data ?? [];
  const profiles = useEmployeeProfiles().data ?? [];
  const today = todayKst();
  const byId = new Map(users.map((u) => [u.id, u]));
  const list = hiresInMonth(profiles.filter((p) => byId.has(p.userId)), today.slice(0, 7));
  if (useMini()) {
    const next = list.find((x) => x.date >= today) ?? list[list.length - 1];
    const nextUser = next ? byId.get(next.person.userId) : undefined;
    return (
      <MiniPanel title="이달의 입사자">
        <span className={MINI_BIG}>{list.length}<span className="ml-0.5 text-[14px] font-bold text-ink3">명</span></span>
        <span className={`${MINI_SUB} ${next?.date === today ? '!text-[#0876c8]' : ''}`}>
          {nextUser ? (next!.date === today ? `오늘 ${nextUser.name}` : `${Number(next!.date.slice(8))}일 ${nextUser.name}`) : '입사자 없음'}
        </span>
      </MiniPanel>
    );
  }
  return (
    <Panel>
      <Head title="이달의 입사자" note={list.length ? `${list.length}명` : undefined} />
      {list.length === 0 ? (
        <Empty>이번 달 입사한 사람이 없습니다.</Empty>
      ) : (
        <ul className={`m-0 list-none gap-0.5 p-0 ${FIT_LIST}`}>
          {list.map(({ person, date }) => {
            const u = byId.get(person.userId)!;
            const isToday = date === today;
            return (
              <li key={person.userId} className={`flex items-center gap-2.5 rounded-xl px-2.5 py-1.5 ${isToday ? 'bg-[#e8f3fc] dark:bg-sky-500/15' : ''}`}>
                <span className={`w-10 shrink-0 text-[15px] font-black tabular-nums ${isToday ? 'text-[#0876c8]' : 'text-ink'}`}>
                  {Number(date.slice(8))}
                  <span className="ml-0.5 text-[10.5px] font-bold text-ink3">일</span>
                </span>
                <MiniAvatar user={u} size={24} />
                <span className="truncate text-[12.5px] font-bold text-ink">{u.name}</span>
                <span className="truncate text-[11px] text-ink3">{[u.dept, u.position].filter(Boolean).join(' · ')}</span>
                {isToday && <span className="ml-auto shrink-0 rounded-full bg-[#0876c8] px-2 py-0.5 text-[10.5px] font-bold text-white">오늘</span>}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

/* ───────────────────────── 게시판: 최근 게시글 ───────────────────────── */

const BOARD_NAMES: Record<string, string> = Object.fromEntries(BOARDS_SEED.map((b) => [b.id, b.name]));

export function RecentPostsWidget() {
  const navigate = useGo();
  const posts = useBoardPosts().data ?? [];
  const recent = useMemo(() => [...posts].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6), [posts]);
  return (
    <Panel>
      <Head title="최근 게시글" to={() => navigate('/gw/board')} />
      {recent.length === 0 ? (
        <Empty>게시글이 없습니다.</Empty>
      ) : (
        <ul className={`m-0 list-none p-0 ${FIT_LIST}`}>
          {recent.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => navigate(`/gw/board?board=${p.boardId}&postId=${encodeURIComponent(p.id)}`)} className="group grid w-full cursor-pointer grid-cols-[60px_minmax(0,1fr)_40px] items-center gap-2.5 py-2 text-left">
                <span className="truncate rounded-md bg-panel-alt px-1.5 py-0.5 text-center text-[10.5px] font-bold text-ink2">{BOARD_NAMES[p.boardId] ?? '게시판'}</span>
                <span className="truncate text-[13px] text-ink group-hover:text-[#0876c8]">{p.title}</span>
                <span className="text-right text-[11px] tabular-nums text-ink3">{p.date.slice(5, 10).replace('-', '.')}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
