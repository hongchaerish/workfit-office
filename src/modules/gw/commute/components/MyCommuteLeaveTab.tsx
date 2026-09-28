import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/app/auth/AuthProvider';
import { usePermission } from '@/features/auth/usePermission';
import { useLeave } from '@/features/gw/useLeave';
import { getKoreanHoliday, isWeekend } from '@/domain/commute/engine';
import type { CommuteRecord } from '@/domain/commute/schema';
import type { ApprovalDoc } from '@/domain/approvalDoc/schema';
import { calculateLeaveDays, getLeaveBadgeLabel, isAnnualLeaveDeduction } from '@/domain/leave/policy';
import { Button } from '@/shared/ui/Button';
import {
  Calendar as CalendarIcon,
  List,
  PlusCircle,
  Clock,
  Briefcase,
  ExternalLink,
  ChevronRight,
  Info,
  X,
  CalendarCheck2,
} from 'lucide-react';

interface MyCommuteLeaveTabProps {
  month: string;
  setMonth: React.Dispatch<React.SetStateAction<string>>;
  monthRows: CommuteRecord[];
  isLoading: boolean;
  holidayMap: Map<string, string>;
  policyStartTime: string;
  policyEndTime: string;
  hireDate?: string | null;
}

const pad = (v: number) => String(v).padStart(2, '0');
const thisMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
};
const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};
function moveMonth(m: string, delta: number): string {
  const [y, mm] = m.split('-').map(Number);
  const next = new Date(y, mm - 1 + delta, 1);
  return `${next.getFullYear()}-${pad(next.getMonth() + 1)}`;
}
const monthTitle = (m: string): string => `${m.slice(0, 4)}년 ${Number(m.slice(5))}월`;
const timeOf = (iso: string | null): string => {
  if (!iso) return '—';
  const at = new Date(iso);
  return `${pad(at.getHours())}:${pad(at.getMinutes())}`;
};
const hourText = (min: number): string => (min === 0 ? '0h 0m' : `${Math.floor(min / 60)}h ${min % 60}m`);

const navButton = 'grid h-8 w-8 place-items-center rounded-lg border border-border text-ink2 hover:bg-panel-alt transition-colors disabled:opacity-40 disabled:pointer-events-none';
const toggleShell = 'flex items-center gap-0.5 rounded-lg border border-border bg-panel p-0.5 shadow-2xs';

export function MyCommuteLeaveTab({
  month,
  setMonth,
  monthRows,
  isLoading,
  holidayMap,
  policyStartTime,
  policyEndTime,
  hireDate,
}: MyCommuteLeaveTabProps) {
  const { user } = useAuth();
  const nav = useNavigate();
  const { canAction } = usePermission();
  const canCreateLeave = canAction('S_GW_LEAVE', 'create');

  // 개인 연차/휴가 산정 훅
  const bal = useLeave(user?.id);

  // 입사일: prop으로 넘어온 값 우선, 없으면 bal.hireDate 사용
  const effectiveHireDate = hireDate || bal?.hireDate || null;
  const minMonth = useMemo(() => {
    return effectiveHireDate ? effectiveHireDate.slice(0, 7) : null;
  }, [effectiveHireDate]);

  // 달력 / 목록 표 전환 상태
  const [displayMode, setDisplayMode] = useState<'calendar' | 'table'>('calendar');

  // 하단 세부 탭 상태
  const [historyTab, setHistoryTab] = useState<'annual' | 'requests'>('annual');
  const [requestFilter, setRequestFilter] = useState<'전체' | '진행중' | '완료' | '반려'>('전체');
  const [showSubModal, setShowSubModal] = useState(false);

  // 1. 오늘의 출퇴근 및 근무 상태
  const todayStr = today();
  const todayRecord = useMemo(() => {
    return monthRows.find((r) => r.date === todayStr) ?? null;
  }, [monthRows, todayStr]);

  // 2. 이번 달 근무 집계
  const monthSummary = useMemo(() => {
    let workDays = 0;
    let leaveDays = 0;
    let lateDays = 0;
    let absentDays = 0;
    let totalMin = 0;

    for (const r of monthRows) {
      const isPreHire = Boolean(effectiveHireDate && r.date < effectiveHireDate);
      if (isPreHire) continue;

      if (r.status === 'normal' || r.status === 'holiday_work') workDays++;
      if (r.status === 'leave') leaveDays++;
      if (r.status === 'late') {
        workDays++;
        lateDays++;
      }
      if (r.status === 'absent') absentDays++;
      totalMin += r.totalMin;
    }

    return { workDays, leaveDays, lateDays, absentDays, totalMin };
  }, [monthRows, effectiveHireDate]);

  // 3. 다가오는 예정 일정
  const upcomingDoc = useMemo(() => {
    const activeLeaves = bal.myDocs.filter(
      (d) => (d.status === '완료' || d.status === '진행중') && d.form && d.form.startDate >= todayStr,
    );
    return [...activeLeaves].sort((a, b) => a.form!.startDate.localeCompare(b.form!.startDate))[0] ?? null;
  }, [bal.myDocs, todayStr]);

  const upcomingDDayText = useMemo(() => {
    if (!upcomingDoc?.form) return '';
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const start = new Date(upcomingDoc.form.startDate);
    start.setHours(0, 0, 0, 0);
    const diffDays = Math.round((start.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return '오늘';
    if (diffDays === 1) return '내일';
    return `D-${diffDays}`;
  }, [upcomingDoc]);

  // 4. 연차 및 휴가 결재 문서들
  const goDoc = (d: ApprovalDoc) => nav(`/gw/approval?doc=${d.docNo || d.id}`);

  const annualLeaveHistoryDocs = useMemo(() => {
    return bal.myDocs.filter((d) => d.status === '완료' && (isAnnualLeaveDeduction(d.form?.leaveType) || d.form?.leaveType === '대체휴무'));
  }, [bal.myDocs]);

  const filteredRequests = useMemo(() => {
    if (requestFilter === '전체') return bal.myDocs;
    return bal.myDocs.filter((d) => d.status === requestFilter);
  }, [bal.myDocs, requestFilter]);

  if (!user) {
    return <div className="p-10 text-center text-[13px] text-ink3">로그인이 필요합니다.</div>;
  }

  return (
    <div className="space-y-4">
      {/* ─────────────────────────────────────────────────────────────
          1. 상단 마이 요약 대시보드 (오늘 근태 + 연차 잔여 + 당월 근무)
         ───────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* 카드 1: 오늘의 근태 */}
        <div className="rounded-xl border border-border bg-panel p-4 shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[11.5px] font-bold text-ink2 flex items-center gap-1.5">
              <Clock size={14} className="text-teal" />
              <span>오늘의 근태</span>
            </span>
            <span className="rounded bg-panel-alt px-2 py-0.5 text-[10px] font-bold text-ink3">
              정규 {policyStartTime}~{policyEndTime}
            </span>
          </div>

          <div className="my-2.5">
            {todayRecord?.inAt ? (
              <div className="space-y-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-[20px] font-extrabold text-teal tabular-nums">
                    {timeOf(todayRecord.inAt)} 출근
                  </span>
                  <span className="text-[11px] font-semibold text-ink3">
                    {todayRecord.outAt ? `· ${timeOf(todayRecord.outAt)} 퇴근` : '· 근무 중'}
                  </span>
                </div>
                <div className="text-[11px] text-ink2">
                  금일 인정 근무: <strong className="text-ink">{hourText(todayRecord.totalMin)}</strong>
                </div>
              </div>
            ) : todayRecord?.status === 'leave' ? (
              <div className="py-1">
                <div className="text-[18px] font-extrabold text-ink flex items-center gap-1.5">
                  <CalendarCheck2 size={16} className="text-teal" />
                  <span>{todayRecord.leaveName || '휴가 중'}</span>
                </div>
                <div className="text-[11px] text-ink3">승인된 휴가 일정이 적용되었습니다.</div>
              </div>
            ) : todayRecord?.status === 'outside' ? (
              <div className="py-1">
                <div className="text-[18px] font-extrabold text-ink flex items-center gap-1.5">
                  <Briefcase size={16} className="text-teal" />
                  <span>{todayRecord.outsideName || '외근 중'}</span>
                </div>
                <div className="text-[11px] text-ink3">승인된 외근 일정이 적용되어 정상 인정됩니다.</div>
              </div>
            ) : todayRecord?.status === 'trip' ? (
              <div className="py-1">
                <div className="text-[18px] font-extrabold text-ink flex items-center gap-1.5">
                  <Briefcase size={16} className="text-teal" />
                  <span>{todayRecord.tripName || '출장 중'}</span>
                </div>
                <div className="text-[11px] text-ink3">승인된 출장 일정이 적용되어 정상 인정됩니다.</div>
              </div>
            ) : isWeekend(todayStr) ? (
              <div className="py-1">
                <div className="text-[18px] font-extrabold text-ink3">주말 휴무</div>
                <div className="text-[11px] text-ink3">편안한 주말 보내세요.</div>
              </div>
            ) : (
              <div className="py-1">
                <div className="text-[18px] font-extrabold text-ink">미체크 / 출근 전</div>
                <div className="text-[11px] text-ink3">CAPS 출입 리더기에 태그해 주세요.</div>
              </div>
            )}
          </div>

          <div className="pt-2 border-t border-border/60 flex items-center justify-between text-[11px] text-ink3">
            <span>기준일: {todayStr}</span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => nav(`/gw/approval/new?type=외근&date=${todayStr}`)}
                className="text-[10.5px] font-bold text-ink2 hover:text-teal hover:underline"
              >
                외근 신청
              </button>
              <span>·</span>
              <button
                type="button"
                onClick={() => nav(`/gw/approval/new?type=국내출장&date=${todayStr}`)}
                className="text-[10.5px] font-bold text-ink2 hover:text-teal hover:underline"
              >
                출장 신청
              </button>
            </div>
          </div>
        </div>

        {/* 카드 2: 내 연차 잔여 & 휴가 신청 퀵 액션 */}
        <div className="rounded-xl border border-border bg-panel p-4 shadow-2xs flex flex-col justify-between relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-[11.5px] font-bold text-ink2 flex items-center gap-1.5">
              <CalendarCheck2 size={14} className="text-teal" />
              <span>내 연차 현황</span>
            </span>
            {canCreateLeave && (
              <button
                type="button"
                onClick={() => nav(`/gw/approval/new?type=휴가&date=${todayStr}`)}
                className="flex items-center gap-1 rounded-md bg-teal px-2.5 py-1 text-[11px] font-bold text-white shadow-2xs hover:bg-teal/90 transition-all"
              >
                <PlusCircle size={12} />
                <span>휴가 신청</span>
              </button>
            )}
          </div>

          <div className="my-2">
            <div className="flex items-baseline gap-1.5">
              <span className="text-[26px] font-extrabold tabular-nums text-teal">{bal.remaining}</span>
              <span className="text-[12px] font-bold text-ink3">/ {bal.grant}일 잔여</span>
            </div>
            <div className="w-full bg-border/70 rounded-full h-1.5 overflow-hidden my-2">
              <div
                className="bg-teal h-1.5 rounded-full transition-all duration-500"
                style={{ width: `${bal.grant > 0 ? Math.min(100, Math.max(0, (bal.remaining / bal.grant) * 100)) : 0}%` }}
              />
            </div>
            <div className="flex justify-between text-[10.5px] text-ink3 font-medium">
              <span>사용 완료: <strong>{bal.used}일</strong></span>
              {bal.pending > 0 && <span className="text-amber font-bold">결재 대기: {bal.pending}일</span>}
              <button
                type="button"
                onClick={() => setShowSubModal(true)}
                className="hover:text-teal hover:underline transition-colors group cursor-pointer"
                title="내 대체휴무 상세 내역 보기"
              >
                <span>대체휴무: </span>
                <strong className="text-teal group-hover:underline">{bal.substituteHoliday.remaining}일</strong>
              </button>
            </div>
          </div>

          <div className="pt-2 border-t border-teal/20 flex items-center justify-between text-[10.5px] text-teal font-medium">
            <span>법정 발생 기준 적용</span>
            {bal.substituteHoliday.expiringSoonCount > 0 && (
              <button
                type="button"
                onClick={() => setShowSubModal(true)}
                className="text-amber font-bold hover:underline cursor-pointer"
              >
                ⚠️ 대휴 만료임박 {bal.substituteHoliday.expiringSoonCount}건
              </button>
            )}
          </div>
        </div>

        {/* 카드 3: 이번 달 근무 요약 & 예정 일정 */}
        <div className="rounded-xl border border-border bg-panel p-4 shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[11.5px] font-bold text-ink2 flex items-center gap-1.5">
              <Briefcase size={14} className="text-teal" />
              <span>{monthTitle(month)} 근무 요약</span>
            </span>
            {upcomingDoc && (
              <span className="rounded bg-purple-500/15 px-2 py-0.5 text-[9.5px] font-extrabold text-purple-600 border border-purple-500/25">
                {upcomingDDayText} 예정
              </span>
            )}
          </div>

          <div className="my-2 space-y-1 text-[11.5px]">
            <div className="flex justify-between py-0.5">
              <span className="text-ink3">출근 일수 / 인정 시간</span>
              <span className="font-extrabold text-ink tabular-nums">
                {monthSummary.workDays}일 ({hourText(monthSummary.totalMin)})
              </span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-ink3">사용한 휴가</span>
              <span className="font-bold text-emerald-600 tabular-nums">{monthSummary.leaveDays}일</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-ink3">지각 / 결근</span>
              <span className="font-bold tabular-nums">
                <span className={monthSummary.lateDays > 0 ? 'text-amber' : 'text-ink'}>{monthSummary.lateDays}회</span> /{' '}
                <span className={monthSummary.absentDays > 0 ? 'text-rose-500' : 'text-ink'}>{monthSummary.absentDays}일</span>
              </span>
            </div>
          </div>

          <div className="pt-2 border-t border-border/60 text-[10.5px] text-ink3 truncate">
            {upcomingDoc ? (
              <span className="text-purple-600 font-semibold">
                예정: [{upcomingDoc.form?.leaveType}] {upcomingDoc.form?.startDate} ({upcomingDoc.form?.days}일)
              </span>
            ) : (
              <span>예정된 휴가 일정이 없습니다.</span>
            )}
          </div>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          2. 스마트 캘린더 영역 (출퇴근 시각 + 연차/휴가 결합)
         ───────────────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-border bg-panel shadow-sm overflow-hidden">
        {/* 달력 헤더 툴바 */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3 bg-panel">
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={Boolean(minMonth && month <= minMonth)}
              onClick={() => setMonth((v) => moveMonth(v, -1))}
              aria-label="이전 달"
              title={minMonth && month <= minMonth ? `입사월(${minMonth}) 이전으로는 이동할 수 없습니다.` : '이전 달'}
              className={navButton}
            >
              ‹
            </button>
            <Button size="sm" onClick={() => setMonth(thisMonth())}>이번 달</Button>
            <button type="button" onClick={() => setMonth((v) => moveMonth(v, 1))} aria-label="다음 달" className={navButton}>›</button>
            <h2 className="ml-1 text-[13.5px] font-extrabold text-ink">
              {monthTitle(month)} · {user.name}
            </h2>
          </div>

          <div className="flex items-center gap-2">
            <div className={toggleShell}>
              <button
                type="button"
                onClick={() => setDisplayMode('calendar')}
                className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-bold transition-all ${
                  displayMode === 'calendar' ? 'bg-teal text-white shadow-2xs' : 'text-ink3 hover:text-ink2'
                }`}
              >
                <CalendarIcon size={12} />
                <span>달력 보기</span>
              </button>
              <button
                type="button"
                onClick={() => setDisplayMode('table')}
                className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-bold transition-all ${
                  displayMode === 'table' ? 'bg-teal text-white shadow-2xs' : 'text-ink3 hover:text-ink2'
                }`}
              >
                <List size={12} />
                <span>목록 표</span>
              </button>
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="grid min-h-64 place-items-center text-[11.5px] text-ink3">근태 기록을 불러오는 중…</div>
        ) : monthRows.length === 0 ? (
          <div className="grid min-h-64 place-items-center text-[11.5px] text-ink3">이 달의 기록이 없습니다.</div>
        ) : displayMode === 'calendar' ? (
          /* 캘린더 그리드 렌더러 */
          <div className="p-3">
            <div className="grid grid-cols-7 gap-1.5 text-center text-[11px] font-bold pb-2 border-b border-border mb-1.5">
              <div className="text-rose-500">일 (Sun)</div>
              <div className="text-ink">월 (Mon)</div>
              <div className="text-ink">화 (Tue)</div>
              <div className="text-ink">수 (Wed)</div>
              <div className="text-ink">목 (Thu)</div>
              <div className="text-ink">금 (Fri)</div>
              <div className="text-blue-500">토 (Sat)</div>
            </div>

            <div className="grid grid-cols-7 gap-1.5">
              {(() => {
                const [y, m] = month.split('-').map(Number);
                const firstDayOfWeek = new Date(y, m - 1, 1).getDay();
                return Array.from({ length: firstDayOfWeek }).map((_, idx) => (
                  <div key={`empty-${idx}`} className="min-h-[86px] rounded-lg border border-transparent p-1.5 bg-panel-alt/15" />
                ));
              })()}

              {monthRows.map((row) => {
                const dayNum = Number(row.date.slice(8));
                const holiday = getKoreanHoliday(row.date, holidayMap);
                const isSun = isWeekend(row.date) && new Date(row.date).getDay() === 0;
                const isSat = isWeekend(row.date) && new Date(row.date).getDay() === 6;
                const isCurToday = row.date === todayStr;

                const isBeforeHireDay = Boolean(effectiveHireDate && row.date < effectiveHireDate);

                return (
                  <div
                    key={row.date}
                    className={`flex min-h-[86px] flex-col rounded-lg border p-1.5 transition-all ${
                      isBeforeHireDay
                        ? 'border-border/40 bg-panel-alt/10 opacity-40'
                        : isCurToday
                        ? 'border-teal bg-teal/5 shadow-2xs ring-1 ring-teal/50'
                        : holiday || isSun
                        ? 'border-rose-500/20 bg-rose-500/5'
                        : isSat
                        ? 'border-blue-500/20 bg-blue-500/5'
                        : 'border-border bg-panel hover:bg-panel-alt/40'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1">
                        <span
                          className={`text-[12px] font-extrabold ${
                            isBeforeHireDay ? 'text-ink3/50' : holiday || isSun ? 'text-rose-500' : isSat ? 'text-blue-500' : 'text-ink'
                          }`}
                        >
                          {dayNum}
                        </span>
                        {isCurToday && (
                          <span className="rounded bg-teal px-1 py-0.2 text-[8.5px] font-bold text-white">
                            오늘
                          </span>
                        )}
                      </div>
                      {holiday && (
                        <span className="text-[8.5px] font-bold text-rose-500 truncate max-w-[55px]" title={holiday}>
                          {holiday}
                        </span>
                      )}
                    </div>

                    <div className="mt-auto space-y-1">
                      {/* 휴가 상태인 경우 */}
                      {row.status === 'leave' ? (() => {
                        const badge = getLeaveBadgeLabel(row.leaveName);
                        return (
                          <div className="rounded-md bg-panel-alt p-1 text-center border border-border">
                            <div className="text-[10px] font-bold text-ink flex items-center justify-center gap-1">
                              <span className="truncate">{badge.label}</span>
                            </div>
                            <div className="text-[8.5px] font-medium text-ink3">{badge.tooltip}</div>
                          </div>
                        );
                      })() : row.status === 'outside' ? (
                        <div className="rounded-md bg-panel-alt p-1 text-center border border-border">
                          <div className="text-[10px] font-bold text-ink flex items-center justify-center gap-1">
                            <span className="truncate">{row.outsideName || '외근'}</span>
                          </div>
                          <div className="text-[8.5px] font-medium text-ink3">승인 완료</div>
                        </div>
                      ) : row.status === 'trip' ? (
                        <div className="rounded-md bg-panel-alt p-1 text-center border border-border">
                          <div className="text-[10px] font-bold text-ink flex items-center justify-center gap-1">
                            <span className="truncate">{row.tripName || '출장'}</span>
                          </div>
                          <div className="text-[8.5px] font-medium text-ink3">승인 완료</div>
                        </div>
                      ) : row.inAt || row.outAt ? (
                        /* 출퇴근 기록이 있는 경우 */
                        <>
                          <div className="rounded bg-panel-alt/80 px-1.5 py-0.5 text-[9.5px] font-semibold text-ink2 tabular-nums">
                            <div className="flex justify-between">
                              <span className="text-ink3 text-[8.5px]">출근</span>
                              <span className="font-bold text-ink">{timeOf(row.inAt)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-ink3 text-[8.5px]">퇴근</span>
                              <span className="font-bold text-ink">{timeOf(row.outAt)}</span>
                            </div>
                          </div>
                          <div className="flex items-center justify-between text-[9px] px-0.5">
                            <span className="text-teal font-bold">{hourText(row.totalMin)}</span>
                            {row.lateMin > 0 && <span className="text-amber font-extrabold">지각 {row.lateMin}m</span>}
                          </div>
                        </>
                      ) : (
                        /* 기록 없음 / 휴무 */
                        <div className="py-1 text-center text-[9px] text-ink3/70">
                          {isBeforeHireDay || row.status === 'unknown' ? (
                            <span className="text-ink3/40 font-mono">—</span>
                          ) : holiday || isSun || isSat || row.status === 'off' ? (
                            '휴무'
                          ) : row.date >= todayStr ? (
                            <button
                              type="button"
                              onClick={() => nav(`/gw/approval/new?type=휴가&date=${row.date}`)}
                              className="text-teal hover:underline font-bold"
                            >
                              + 신청
                            </button>
                          ) : (
                            <span className="text-rose-500/80 font-medium">결근/미체크</span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          /* 테이블 목록 렌더러 */
          <div className="overflow-x-auto p-2">
            <table className="w-full border-collapse text-left text-[11px]">
              <thead>
                <tr className="border-b border-border text-[10px] font-bold text-ink2 bg-panel-alt/40">
                  <th className="p-2">날짜</th>
                  <th className="p-2">출근</th>
                  <th className="p-2">퇴근</th>
                  <th className="p-2">인정 근무시간</th>
                  <th className="p-2">지각</th>
                  <th className="p-2">상태 / 휴가·외근</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {monthRows.map((row) => {
                  const isSun = isWeekend(row.date) && new Date(row.date).getDay() === 0;
                  const isSat = isWeekend(row.date) && new Date(row.date).getDay() === 6;
                  const holiday = getKoreanHoliday(row.date, holidayMap);
                  const isBeforeHireDay = Boolean(effectiveHireDate && row.date < effectiveHireDate);

                  return (
                    <tr key={row.date} className={`hover:bg-panel-alt/30 transition-colors ${isBeforeHireDay ? 'opacity-40' : ''}`}>
                      <td className="p-2 font-semibold">
                        <span className={isBeforeHireDay ? 'text-ink3/50' : holiday || isSun ? 'text-rose-500' : isSat ? 'text-blue-500' : 'text-ink'}>
                          {row.date.slice(5).replace('-', '/')}
                        </span>
                        {holiday && !isBeforeHireDay && <span className="ml-1 text-[9px] text-rose-500 font-bold">({holiday})</span>}
                      </td>
                      <td className="p-2 font-medium tabular-nums">{timeOf(row.inAt)}</td>
                      <td className="p-2 font-medium tabular-nums">{timeOf(row.outAt)}</td>
                      <td className="p-2 text-ink2 font-medium">{hourText(row.totalMin)}</td>
                      <td className="p-2 text-ink2">{row.lateMin > 0 ? `${row.lateMin}분` : '—'}</td>
                      <td className="p-2">
                        {isBeforeHireDay || row.status === 'unknown' ? (
                          <span className="text-ink3/40 text-[10px]">—</span>
                        ) : row.status === 'leave' ? (() => {
                          const badge = getLeaveBadgeLabel(row.leaveName);
                          return (
                            <span className="inline-flex items-center rounded bg-panel-alt border border-border px-2 py-0.5 text-[9.5px] font-bold text-ink2" title={badge.tooltip}>
                              {badge.label}
                            </span>
                          );
                        })() : row.status === 'outside' ? (
                          <span className="inline-flex items-center rounded bg-panel-alt border border-border px-2 py-0.5 text-[9.5px] font-bold text-ink2">
                            {row.outsideName || '외근'}
                          </span>
                        ) : row.status === 'trip' ? (
                          <span className="inline-flex items-center rounded bg-panel-alt border border-border px-2 py-0.5 text-[9.5px] font-bold text-ink2">
                            {row.tripName || '출장'}
                          </span>
                        ) : row.status === 'normal' ? (
                          <span className="rounded bg-teal/15 px-2 py-0.5 text-[9.5px] font-bold text-teal">정상 출근</span>
                        ) : row.status === 'late' ? (
                          <span className="rounded bg-amber/20 px-2 py-0.5 text-[9.5px] font-bold text-amber">지각</span>
                        ) : row.status === 'absent' ? (
                          <span className="rounded bg-rose-500/15 px-2 py-0.5 text-[9.5px] font-bold text-rose-600">결근</span>
                        ) : (
                          <span className="text-ink3 text-[10px]">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center gap-1.5 px-4 py-2.5 text-[10.5px] text-ink3 border-t border-border bg-panel-alt/20">
          <Info size={12} className="text-teal shrink-0" />
          <span>CAPS 게이트 태그 기록과 전자결재 승인 휴가가 자동 취합된 공식 근태 내역입니다.</span>
        </div>
      </section>

      {/* ─────────────────────────────────────────────────────────────
          3. 하단 상세 내역: 연차/휴가 증감 및 전자결재 신청 이력
         ───────────────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-border bg-panel shadow-sm overflow-hidden">
        <div className="flex border-b border-border bg-panel-alt/30">
          <button
            type="button"
            onClick={() => setHistoryTab('annual')}
            className={`px-4 py-2.5 text-[12px] font-bold transition-all border-b-2 -mb-[2px] ${
              historyTab === 'annual' ? 'border-teal text-teal bg-panel' : 'border-transparent text-ink3 hover:text-ink'
            }`}
          >
            연차·휴가 변동 및 사용 내역
          </button>
          <button
            type="button"
            onClick={() => setHistoryTab('requests')}
            className={`px-4 py-2.5 text-[12px] font-bold transition-all border-b-2 -mb-[2px] ${
              historyTab === 'requests' ? 'border-teal text-teal bg-panel' : 'border-transparent text-ink3 hover:text-ink'
            }`}
          >
            휴가 신청 및 전자결재 이력 ({bal.myDocs.length})
          </button>
        </div>

        <div className="p-4">
          {historyTab === 'annual' ? (
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-[12px] font-bold text-ink">연차·휴가 변동 상세 내역</span>
                <span className="text-[11px] text-ink3">
                  연차 총 부여: <strong className="text-teal">{bal.grant}일</strong>
                  {bal.substituteHoliday.total > 0 && (
                    <> · 대체휴무 총 부여: <strong className="text-teal">+{bal.substituteHoliday.total}일</strong> (잔여 {bal.substituteHoliday.remaining}일)</>
                  )}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-[11px]">
                  <thead>
                    <tr className="border-b border-border bg-panel-alt/50 text-ink2 font-semibold">
                      <th className="p-2">일자/기간</th>
                      <th className="p-2">종류</th>
                      <th className="p-2">일수</th>
                      <th className="p-2">적요 / 사유</th>
                      <th className="p-2 text-right">전자결재 문서</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    <tr className="hover:bg-panel-alt/20">
                      <td className="p-2 text-ink3">2026-01-01</td>
                      <td className="p-2"><span className="rounded bg-teal/15 px-1.5 py-0.5 font-bold text-teal">정기부여</span></td>
                      <td className="p-2 text-teal font-extrabold">+{bal.grant}일</td>
                      <td className="p-2 text-ink2">신년도 기본 연차 일수 자동 부여</td>
                      <td className="p-2 text-right text-ink3">—</td>
                    </tr>
                    {/* 관리자가 부여한 대체휴무 발생 내역 */}
                    {bal.substituteHoliday.detailList.map((subItem) => (
                      <tr key={`sub-${subItem.id}`} className="hover:bg-panel-alt/20 transition-colors">
                        <td className="p-2 text-ink3 font-medium">{subItem.occurrenceDate}</td>
                        <td className="p-2">
                          <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-extrabold text-emerald-600 border border-emerald-500/25">
                            대체휴무
                          </span>
                        </td>
                        <td className="p-2 text-emerald-600 font-extrabold">+{subItem.days}일</td>
                        <td className="p-2 text-ink">
                          <span>{subItem.reason}</span>
                          <span className="text-[10px] text-ink3 ml-2">(만료: ~{subItem.expirationDate})</span>
                        </td>
                        <td className="p-2 text-right text-[10.5px] text-ink3 font-medium">관리자 부여</td>
                      </tr>
                    ))}
                    {annualLeaveHistoryDocs.length === 0 && bal.substituteHoliday.detailList.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="p-6 text-center text-ink3">사용 완료된 연차가 없습니다.</td>
                      </tr>
                    ) : (
                      annualLeaveHistoryDocs.map((d) => {
                        const usedDays = calculateLeaveDays({
                          leaveType: d.form?.leaveType,
                          startDate: d.form?.startDate,
                          endDate: d.form?.endDate,
                          rawDays: d.form?.days,
                          title: d.title,
                          holidays: holidayMap,
                        });
                        return (
                        <tr key={d.id} className="hover:bg-panel-alt/30 transition-colors">
                          <td className="p-2 text-ink2 font-medium">{d.form?.startDate} ~ {d.form?.endDate}</td>
                          <td className="p-2">
                            {(() => {
                              const badge = getLeaveBadgeLabel(d.form?.leaveType, d.title);
                              return (
                                <span className="rounded bg-panel-alt border border-border px-1.5 py-0.5 font-bold text-ink2" title={badge.tooltip}>
                                  {badge.label}
                                </span>
                              );
                            })()}
                          </td>
                          <td className="p-2 text-rose-500 font-extrabold">-{usedDays}일</td>
                          <td className="p-2 text-ink truncate max-w-[240px]">{d.body || d.title}</td>
                          <td className="p-2 text-right">
                            <button
                              type="button"
                              onClick={() => goDoc(d)}
                              className="inline-flex items-center gap-1 text-[10.5px] font-bold text-teal hover:underline"
                            >
                              <span>{d.docNo || '문서보기'}</span>
                              <ExternalLink size={11} />
                            </button>
                          </td>
                        </tr>
                      );})
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[12px] font-bold text-ink">휴가 신청 결재 문서</span>
                <div className="flex items-center gap-1 text-[10.5px]">
                  {(['전체', '진행중', '완료', '반려'] as const).map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setRequestFilter(st)}
                      className={`rounded px-2 py-0.5 font-bold transition-all ${
                        requestFilter === st ? 'bg-teal text-white' : 'bg-panel-alt text-ink3 hover:text-ink'
                      }`}
                    >
                      {st}
                    </button>
                  ))}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-[11px]">
                  <thead>
                    <tr className="border-b border-border bg-panel-alt/50 text-ink2 font-semibold">
                      <th className="p-2">문서번호</th>
                      <th className="p-2">휴가 종류</th>
                      <th className="p-2">신청 기간</th>
                      <th className="p-2">신청 일수</th>
                      <th className="p-2">상태</th>
                      <th className="p-2 text-right">상세</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {filteredRequests.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="p-6 text-center text-ink3">신청 내역이 없습니다.</td>
                      </tr>
                    ) : (
                      filteredRequests.map((d) => (
                        <tr
                          key={d.id}
                          onClick={() => goDoc(d)}
                          className="hover:bg-panel-alt/30 transition-colors cursor-pointer"
                        >
                          <td className="p-2 text-ink3 font-mono">{d.docNo || d.id.slice(0, 8)}</td>
                          <td className="p-2 font-bold text-ink">
                            {(() => {
                              const badge = getLeaveBadgeLabel(d.form?.leaveType, d.title);
                              return (
                                <span className="rounded bg-panel-alt border border-border px-1.5 py-0.5 text-[10px] font-bold text-ink2" title={badge.tooltip}>
                                  {badge.label}
                                </span>
                              );
                            })()}
                          </td>
                          <td className="p-2 text-ink2">{d.form?.startDate} ~ {d.form?.endDate}</td>
                          <td className="p-2 font-extrabold text-ink tabular-nums">{d.form?.days}일</td>
                          <td className="p-2">
                            <span
                              className={`rounded px-1.5 py-0.5 text-[9.5px] font-bold ${
                                d.status === '완료'
                                  ? 'bg-emerald-500/15 text-emerald-600'
                                  : d.status === '반려'
                                  ? 'bg-rose-500/15 text-rose-600'
                                  : 'bg-amber/20 text-amber'
                              }`}
                            >
                              {d.status}
                            </span>
                          </td>
                          <td className="p-2 text-right text-teal font-bold">
                            <span className="inline-flex items-center gap-0.5 text-[10.5px]">
                              <span>열기</span>
                              <ChevronRight size={11} />
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* 내 대체휴무 상세 내역 팝업 모달 */}
      {showSubModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="w-full max-w-lg rounded-2xl border border-border bg-panel shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
            {/* 헤더 */}
            <div className="flex items-center justify-between border-b border-border bg-panel-alt/50 px-5 py-4 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="grid h-8 w-8 place-items-center rounded-xl bg-teal/15 text-teal shadow-2xs">
                  <CalendarCheck2 size={18} />
                </div>
                <div>
                  <h3 className="text-[14px] font-extrabold text-ink">내 대체휴무 상세 현황</h3>
                  <p className="text-[11px] text-ink3">
                    잔여: <strong className="text-teal">{bal.substituteHoliday.remaining}일</strong> / 
                    사용: <strong>{bal.substituteHoliday.used}일</strong> / 
                    총 발생: <strong>{bal.substituteHoliday.total}일</strong>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowSubModal(false)}
                className="rounded-lg p-1.5 text-ink3 hover:bg-panel-alt hover:text-ink transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* 목록 내용 */}
            <div className="p-5 overflow-y-auto space-y-3">
              {bal.substituteHoliday.detailList.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border p-8 text-center text-xs text-ink3 space-y-1">
                  <p>현재 부여된 대체휴무 내역이 없습니다.</p>
                  <p className="text-[10.5px]">
                    관리자가 휴일/공휴일 특근에 대한 대체휴무를 일괄 부여하면 여기에 자동으로 표시됩니다.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-border/60 rounded-xl border border-border bg-panel overflow-hidden text-[11.5px]">
                  {bal.substituteHoliday.detailList.map((item) => {
                    const isAvailable = item.status === 'AVAILABLE';
                    const isUsed = item.status === 'USED';
                    const isExpired = item.status === 'EXPIRED';

                    return (
                      <div key={item.id} className="p-3.5 space-y-1.5 hover:bg-panel-alt/40 transition-colors">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="font-extrabold text-ink text-[12px]">{item.reason}</span>
                            <span className="rounded bg-teal/15 px-1.5 py-0.5 text-[10px] font-extrabold text-teal">
                              +{item.days}일
                            </span>
                          </div>
                          <div>
                            {isAvailable && (
                              <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-[10px] font-extrabold text-emerald-600 border border-emerald-500/25">
                                사용 가능
                              </span>
                            )}
                            {isUsed && (
                              <span className="rounded-md bg-panel-alt px-2 py-0.5 text-[10px] font-bold text-ink3 border border-border">
                                사용 완료
                              </span>
                            )}
                            {isExpired && (
                              <span className="rounded-md bg-rose-500/15 px-2 py-0.5 text-[10px] font-extrabold text-rose-500 border border-rose-500/25">
                                기간 만료
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-ink3 pt-1">
                          <div className="flex items-center gap-3">
                            <span>발생일: <strong className="text-ink">{item.occurrenceDate}</strong></span>
                            <span>만료일: <strong className="text-ink">{item.expirationDate}</strong></span>
                          </div>
                          <div className="flex items-center gap-2 font-medium">
                            <span>사용: {item.used}일</span>
                            {item.pending > 0 && <span className="text-amber font-bold">신청중: {item.pending}일</span>}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="rounded-xl border border-teal/20 bg-teal/5 p-3 text-[11px] text-ink2 leading-relaxed">
                💡 <strong>대체휴무 사용 안내:</strong> 휴가 신청 시 휴가 종류를 [대체휴무]로 선택하면, 
                가장 먼저 만료되는 대체휴무부터 <strong>선입선출(FIFO)</strong> 방식으로 자동 차감됩니다.
              </div>
            </div>

            {/* 푸터 */}
            <div className="border-t border-border bg-panel-alt/30 px-5 py-3 flex justify-end">
              <Button size="sm" onClick={() => setShowSubModal(false)}>
                확인
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
