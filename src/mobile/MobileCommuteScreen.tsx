import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Clock,
  CalendarCheck2,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useAuth } from '@/app/auth/AuthProvider';
import { useMyPresence } from '@/features/userPresence/useUserPresence';
import { PresenceBadge } from '@/features/userPresence/PresenceIndicator';
import { useLeave } from '@/features/gw/useLeave';
import { useCommuteEmployees, useCommuteMonth } from '@/features/commute/useCommute';
import { useCommuteEvaluation } from '@/features/commute/useCommuteEvaluation';
import { getKoreanHoliday, requiredWorkSpan, timeToMinutes } from '@/domain/commute/engine';
import type { CommuteRecord } from '@/domain/commute/schema';
import MobileCommonHeader from './MobileCommonHeader';
import type { UserPresenceStatus } from '@/domain/userPresence/schema';

const pad = (v: number) => String(v).padStart(2, '0');

const timeOf = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '—';
  return `${pad(at.getHours())}:${pad(at.getMinutes())}`;
};

function moveMonth(m: string, delta: number): string {
  const [y, mm] = m.split('-').map(Number);
  const next = new Date(y, mm - 1 + delta, 1);
  return `${next.getFullYear()}-${pad(next.getMonth() + 1)}`;
}

/** 근태 상태 뱃지 판정 헬퍼 (시간은 숨기고 상태 라벨과 톤만 반환) */
function getCommuteStatusBadge(
  record: CommuteRecord | undefined,
  dateStr: string,
  todayStr: string,
  isHolidayOrWeekend: boolean
) {
  if (record?.status === 'late') {
    return {
      label: '지각',
      style: 'text-amber-700 bg-amber-50 border-amber-200/80 font-bold',
      tone: 'late',
    };
  }
  if (record?.leaveName || record?.status === 'leave') {
    return {
      label: record.leaveName || '휴가',
      style: 'text-teal bg-teal-soft/80 border-teal/30',
      tone: 'leave',
    };
  }
  if (record?.outsideName || record?.status === 'outside') {
    return {
      label: record.outsideName || '외근',
      style: 'text-blue-600 bg-blue-50 border-blue-200/70',
      tone: 'outside',
    };
  }
  if (record?.tripName || record?.status === 'trip') {
    return {
      label: record.tripName || '출장',
      style: 'text-indigo-600 bg-indigo-50 border-indigo-200/70',
      tone: 'trip',
    };
  }
  if (record?.inAt || record?.outAt || record?.status === 'normal') {
    return {
      label: '정상',
      style: 'text-emerald-700 bg-emerald-50 border-emerald-200/80 font-bold',
      tone: 'normal',
    };
  }
  if (isHolidayOrWeekend) {
    return null;
  }
  if (dateStr < todayStr) {
    return {
      label: '결근',
      style: 'text-rose-600 bg-rose-50 border-rose-200/70',
      tone: 'absent',
    };
  }
  return null;
}

/**
 * 모바일 PWA 개인 출퇴근·휴가 화면
 */
export default function MobileCommuteScreen() {
  const { user } = useAuth();
  const nav = useNavigate();

  const { presence, updatePresence } = useMyPresence();
  const [currentTime, setCurrentTime] = useState(new Date());

  // 1초마다 시계 갱신
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // 오늘 날짜 및 현재 월
  const currentMonthStr = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  }, []);

  const todayStr = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }, []);

  // 달력 탐색 월 및 선택된 일자
  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonthStr);
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);

  // 사원 정보 매핑 (commute empId)
  const { data: employees = [] } = useCommuteEmployees();
  const currentEmp = useMemo(() => {
    const norm = (s?: string | null) => (s || '').replace(/\s+/g, '');
    const empNo = user?.empNo ? Number(user.empNo) : null;
    return employees.find((e) => (user?.name && norm(e.name) === norm(user.name)) || (empNo !== null && e.empId === empNo));
  }, [employees, user?.name]);

  // 오늘이 속한 달의 기록 (오늘 요약 카드용)
  const { data: currentMonthRows = [] } = useCommuteMonth(
    currentEmp?.empId ?? null,
    currentMonthStr
  );

  // 달력에서 선택한 월의 근태 기록
  const { data: selectedMonthRows = [] } = useCommuteMonth(
    currentEmp?.empId ?? null,
    selectedMonth
  );

  // 근태 판정(정책·공휴일·승인 결재) — 데스크톱과 같은 엔진으로 다시 판정한다
  const { policy, holidayMap, approvalDaysOf, evaluate } = useCommuteEvaluation();
  const myApprovalDays = useMemo(() => approvalDaysOf({ id: user?.id, name: user?.name }), [approvalDaysOf, user?.id, user?.name]);
  const evaluateDate = useCallback(
    (dateStr: string, rows: CommuteRecord[]) =>
      evaluate(
        rows.find((r) => r.date === dateStr) ?? { empId: currentEmp?.empId ?? 0, date: dateStr, inAt: null, outAt: null },
        myApprovalDays,
      ),
    [evaluate, myApprovalDays, currentEmp?.empId],
  );

  // 휴가 밸런스 조회
  const leaveBalance = useLeave(user?.id);

  // 오늘 근태 기록
  const todayRecord = useMemo(() => evaluateDate(todayStr, currentMonthRows), [evaluateDate, currentMonthRows, todayStr]);

  const checkInTime = todayRecord?.inAt ? timeOf(todayRecord.inAt) : null;
  const checkOutTime = todayRecord?.outAt ? timeOf(todayRecord.outAt) : null;

  // 그날 근무 종료 시각(정책·반차 반영) 이후로 찍힌 경우에만 실제 퇴근으로 처리
  const isActualOff = useMemo(() => {
    if (!checkOutTime) return false;
    const span = requiredWorkSpan(policy, myApprovalDays.get(todayStr) ?? []);
    const endMin = span?.end ?? timeToMinutes(policy.workEndTime) ?? 1050;
    return (timeToMinutes(checkOutTime) ?? 0) >= endMin;
  }, [checkOutTime, policy, myApprovalDays, todayStr]);

  // 원클릭 상태 전환 핸들러
  const handleQuickStatus = async (newStatus: UserPresenceStatus, defaultMsg?: string) => {
    await updatePresence(newStatus, defaultMsg);
  };

  // 달력 그리드 데이터 생성 (1일부터 말일까지 빈 날짜 없이 완벽 빌드)
  const calendarData = useMemo(() => {
    const [y, m] = selectedMonth.split('-').map(Number);
    if (!y || !m) return { firstDayOfWeek: 0, list: [] };
    const daysInMonth = new Date(y, m, 0).getDate();
    const firstDayOfWeek = new Date(y, m - 1, 1).getDay();

    const list = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${selectedMonth}-${pad(d)}`;
      const dateObj = new Date(y, m - 1, d);
      const dayOfWeek = dateObj.getDay();
      const holiday = getKoreanHoliday(dateStr, holidayMap);
      const isSun = dayOfWeek === 0;
      const isSat = dayOfWeek === 6;
      const isToday = dateStr === todayStr;

      list.push({
        date: dateStr,
        dayNum: d,
        dayOfWeek,
        record: evaluateDate(dateStr, selectedMonthRows),
        holiday,
        isSun,
        isSat,
        isToday,
      });
    }

    return { firstDayOfWeek, list };
  }, [selectedMonth, selectedMonthRows, holidayMap, todayStr, evaluateDate]);

  // 선택한 월의 통계 (출근일, 지각일, 휴가일)
  const monthStats = useMemo(() => {
    let workDays = 0;
    let lateDays = 0;
    let leaveDays = 0;

    for (const item of calendarData.list) {
      const rec = item.record;
      if (rec?.status === 'leave') {
        leaveDays += 1;
      } else if (rec?.inAt || rec?.outAt || rec?.status === 'outside' || rec?.status === 'trip') {
        workDays += 1;
        if (rec.status === 'late' || (rec.lateMin ?? 0) > 0) {
          lateDays += 1;
        }
      }
    }

    return { workDays, lateDays, leaveDays };
  }, [calendarData.list]);

  // 선택한 날짜의 상세 정보
  const selectedDayDetail = useMemo(() => {
    return calendarData.list.find((item) => item.date === selectedDate);
  }, [calendarData.list, selectedDate]);

  const selectedDayBadge = useMemo(() => {
    if (!selectedDayDetail) return null;
    return getCommuteStatusBadge(
      selectedDayDetail.record,
      selectedDayDetail.date,
      todayStr,
      Boolean(selectedDayDetail.holiday || selectedDayDetail.isSun || selectedDayDetail.isSat)
    );
  }, [selectedDayDetail, todayStr]);

  return (
    <div className="flex h-full flex-col select-none overflow-hidden" style={{ background: '#f2f8fc' }}>
      <MobileCommonHeader title="근태·휴가" subtitle={user ? `${user.name} (${user.dept})` : ''} />

      <div className="flex-1 overflow-y-auto px-4 py-3.5 space-y-4">
        {/* 1. 디지털 시계 및 상태 카드 */}
        <div className="rounded-2xl border border-border/80 bg-white p-4 shadow-xs text-center">
          <span className="text-[11px] font-bold text-ink3">
            {currentTime.toLocaleDateString('ko-KR', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              weekday: 'short',
            })}
          </span>

          <div className="text-[32px] font-black text-ink tracking-tight font-mono my-0.5">
            {pad(currentTime.getHours())}:{pad(currentTime.getMinutes())}:
            <span className="text-teal text-[24px]">{pad(currentTime.getSeconds())}</span>
          </div>

          <div className="flex items-center justify-center gap-1.5 my-2">
            <PresenceBadge status={presence.status} />
            {presence.message && (
              <span className="text-[11px] font-medium text-ink2 truncate max-w-[200px]">
                {presence.message}
              </span>
            )}
          </div>

          {/* 원클릭 근무 상태 변경 퀵 버튼 바 */}
          <div className="grid grid-cols-4 gap-1.5 mt-3 pt-3 border-t border-border/60">
            <button
              type="button"
              onClick={() => handleQuickStatus('ONLINE', '')}
              className={`rounded-xl py-2 text-[11px] font-bold transition-all ${
                presence.status === 'ONLINE'
                  ? 'bg-emerald-500 text-white shadow-xs'
                  : 'bg-panel-alt text-ink2 hover:bg-emerald-500/10 hover:text-emerald-600'
              }`}
            >
              🏢 업무 중
            </button>
            <button
              type="button"
              onClick={() => handleQuickStatus('FOCUS', '')}
              className={`rounded-xl py-2 text-[11px] font-bold transition-all ${
                presence.status === 'FOCUS'
                  ? 'bg-amber-500 text-white shadow-xs'
                  : 'bg-panel-alt text-ink2 hover:bg-amber-500/10 hover:text-amber-600'
              }`}
            >
              🎯 집중 근무
            </button>
            {/* 외근·회의·휴가는 전자결재·캘린더로만 정해진다 — 직접 고를 수 있는 건 업무중·자리비움·집중근무·오프라인 */}
            <button
              type="button"
              onClick={() => handleQuickStatus('AWAY', '')}
              className={`rounded-xl py-2 text-[11px] font-bold transition-all ${
                presence.status === 'AWAY'
                  ? 'bg-yellow-400 text-white shadow-xs'
                  : 'bg-panel-alt text-ink2 hover:bg-yellow-400/10 hover:text-yellow-700'
              }`}
            >
              ☕ 자리비움
            </button>
            <button
              type="button"
              onClick={() => handleQuickStatus('OFFLINE', '퇴근')}
              className={`rounded-xl py-2 text-[11px] font-bold transition-all ${
                presence.status === 'OFFLINE'
                  ? 'bg-slate-700 text-white shadow-xs'
                  : 'bg-panel-alt text-ink2 hover:bg-slate-700/10 hover:text-slate-700'
              }`}
            >
              🏠 퇴근
            </button>
          </div>
        </div>

        {/* 2. 오늘 출퇴근 기록 요약 */}
        <div className="rounded-2xl border border-teal/30 bg-teal-soft/15 p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="grid h-8 w-8 place-items-center rounded-xl bg-teal text-white shadow-xs">
                <Clock size={16} />
              </div>
              <div>
                <span className="text-[12px] font-bold text-ink">오늘의 근태 기록</span>
                <p className="text-[10.5px] text-ink3">
                  {todayRecord ? (isActualOff ? '퇴근 완료' : '정상 근무 중') : '출근 기록 대기'}
                </p>
              </div>
            </div>

            <div className="text-right">
              <span className="text-[10px] text-ink3 block">인정 근무시간</span>
              <span className="text-[13px] font-black text-teal">
                {todayRecord?.totalMin ? `${Math.floor(todayRecord.totalMin / 60)}시간 ${todayRecord.totalMin % 60}분` : '—'}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-teal/20 text-center">
            <div className="rounded-xl bg-white/80 p-2 border border-teal/10">
              <span className="text-[10px] text-ink3 block">출근 시각</span>
              <span className="text-[14px] font-black text-ink">{checkInTime || '—'}</span>
            </div>
            <div className="rounded-xl bg-white/80 p-2 border border-teal/10">
              <span className="text-[10px] text-ink3 block">퇴근 시각</span>
              <span className="text-[14px] font-black text-ink">
                {isActualOff ? checkOutTime : checkInTime ? '근무 중' : '—'}
              </span>
            </div>
          </div>
        </div>

        {/* 3. 연차 / 휴가 밸런스 카드 */}
        <div className="rounded-2xl border border-border/80 bg-white p-4 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <CalendarCheck2 size={16} className="text-teal" />
              <h3 className="text-[13px] font-bold text-ink">연차 및 휴가 현황</h3>
            </div>
            <button
              type="button"
              onClick={() => nav('/m/approval')}
              className="flex items-center gap-1 text-[11px] font-bold text-teal hover:underline"
            >
              <span>휴가 신청하기</span>
              <ExternalLink size={12} />
            </button>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-panel-alt/50 p-2.5 border border-border/50">
              <span className="text-[10.5px] text-ink3 block">총 부여 연차</span>
              <span className="text-[14px] font-black text-ink">
                {leaveBalance?.grant ?? 15}일
              </span>
            </div>
            <div className="rounded-xl bg-panel-alt/50 p-2.5 border border-border/50">
              <span className="text-[10.5px] text-ink3 block">사용 연차</span>
              <span className="text-[14px] font-black text-rose-500">
                {leaveBalance?.used ?? 0}일
              </span>
            </div>
            <div className="rounded-xl bg-teal-soft/20 p-2.5 border border-teal/30">
              <span className="text-[10.5px] text-teal block font-bold">잔여 연차</span>
              <span className="text-[14px] font-black text-teal">
                {leaveBalance?.remaining ?? 15}일
              </span>
            </div>
          </div>
        </div>

        {/* 4. 월간 근태 달력 뷰 (컴팩트 상태 뷰: 시간 표시 없이 정상/지각 등 상태만 표기) */}
        <div className="rounded-2xl border border-border/80 bg-white p-3.5 shadow-xs space-y-2.5 pb-6">
          {/* 달력 헤더: 월 이동 네비게이션 & 통계 요약 */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setSelectedMonth((m) => moveMonth(m, -1))}
                className="grid h-7 w-7 place-items-center rounded-lg border border-border bg-panel-alt/60 text-ink2 hover:bg-panel-alt active:scale-95 transition-transform"
                aria-label="이전 달"
              >
                <ChevronLeft size={15} />
              </button>
              <span className="text-[13px] font-extrabold text-ink px-1 font-mono">
                {selectedMonth.slice(0, 4)}년 {Number(selectedMonth.slice(5))}월
              </span>
              <button
                type="button"
                onClick={() => setSelectedMonth((m) => moveMonth(m, 1))}
                className="grid h-7 w-7 place-items-center rounded-lg border border-border bg-panel-alt/60 text-ink2 hover:bg-panel-alt active:scale-95 transition-transform"
                aria-label="다음 달"
              >
                <ChevronRight size={15} />
              </button>
              {selectedMonth !== currentMonthStr && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedMonth(currentMonthStr);
                    setSelectedDate(todayStr);
                  }}
                  className="ml-1 rounded-md bg-teal/10 px-1.5 py-0.5 text-[10px] font-bold text-teal"
                >
                  이번달
                </button>
              )}
            </div>

            {/* 이번 달 요약 통계 */}
            <div className="text-[10.5px] font-bold text-ink3 flex items-center gap-1.5">
              <span>출근 <strong className="text-emerald-600">{monthStats.workDays}</strong></span>
              <span>·</span>
              <span>휴가 <strong className="text-teal">{monthStats.leaveDays}</strong></span>
              {monthStats.lateDays > 0 && (
                <>
                  <span>·</span>
                  <span>지각 <strong className="text-amber">{monthStats.lateDays}</strong></span>
                </>
              )}
            </div>
          </div>

          {/* 요일 헤더 */}
          <div className="grid grid-cols-7 gap-1 text-center text-[10.5px] font-bold text-ink3 border-b border-border/60 pb-1.5">
            <div className="text-rose-500">일</div>
            <div>월</div>
            <div>화</div>
            <div>수</div>
            <div>목</div>
            <div>금</div>
            <div className="text-blue-500">토</div>
          </div>

          {/* 날짜 그리드 */}
          <div className="grid grid-cols-7 gap-1">
            {/* 첫째 주 빈 셀 */}
            {Array.from({ length: calendarData.firstDayOfWeek }).map((_, idx) => (
              <div key={`empty-${idx}`} className="h-13 rounded-lg bg-panel-alt/15" />
            ))}

            {/* 날짜 셀들 */}
            {calendarData.list.map((item) => {
              const badge = getCommuteStatusBadge(
                item.record,
                item.date,
                todayStr,
                Boolean(item.holiday || item.isSun || item.isSat)
              );
              const isSelected = item.date === selectedDate;

              return (
                <button
                  type="button"
                  key={item.date}
                  onClick={() => setSelectedDate(item.date)}
                  className={`h-13 rounded-lg border p-1 flex flex-col justify-between text-left transition-all relative ${
                    isSelected
                      ? 'border-teal bg-teal/10 shadow-2xs ring-1.5 ring-teal'
                      : item.isToday
                      ? 'border-teal/50 bg-teal/5 ring-1 ring-teal/30'
                      : item.holiday || item.isSun
                      ? 'border-rose-500/15 bg-rose-500/3'
                      : item.isSat
                      ? 'border-blue-500/15 bg-blue-500/3'
                      : 'border-border/70 bg-white hover:bg-panel-alt/50'
                  }`}
                >
                  {/* 상단: 일자 번호 & 공휴일 점 */}
                  <div className="flex items-center justify-between w-full">
                    <span
                      className={`text-[11px] font-bold leading-none ${
                        item.isToday
                          ? 'flex h-4 w-4 items-center justify-center rounded-full bg-teal text-white text-[9.5px]'
                          : item.holiday || item.isSun
                          ? 'text-rose-500'
                          : item.isSat
                          ? 'text-blue-500'
                          : 'text-ink'
                      }`}
                    >
                      {item.dayNum}
                    </span>
                    {item.holiday && (
                      <span className="h-1.5 w-1.5 rounded-full bg-rose-500" title={item.holiday} />
                    )}
                  </div>

                  {/* 하단: 상태 뱃지 (시간 표시는 숨김) */}
                  <div className="w-full flex items-center justify-center pt-0.5">
                    {badge ? (
                      <span
                        className={`text-[8.5px] px-1 py-0.2 rounded border leading-none truncate max-w-full text-center ${badge.style}`}
                      >
                        {badge.label}
                      </span>
                    ) : item.holiday ? (
                      <span className="text-[7.5px] font-medium text-rose-500 truncate max-w-full leading-none text-center">
                        {item.holiday}
                      </span>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>

          {/* 선택한 날짜의 미니 상세 카드 (탭 시 출퇴근 시간 확인 가능) */}
          {selectedDayDetail && (
            <div className="mt-2.5 rounded-xl border border-teal/25 bg-teal-soft/15 p-2.5 text-[11.5px] space-y-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 font-bold text-ink">
                  <span>{selectedDayDetail.date}</span>
                  <span className="text-[10px] text-ink3 font-normal">
                    ({['일', '월', '화', '수', '목', '금', '토'][new Date(selectedDayDetail.date).getDay()]})
                  </span>
                  {selectedDayDetail.holiday && (
                    <span className="rounded bg-rose-50 px-1 py-0.2 text-[9.5px] font-bold text-rose-500 border border-rose-200">
                      {selectedDayDetail.holiday}
                    </span>
                  )}
                </div>
                <div>
                  {selectedDayBadge ? (
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${selectedDayBadge.style}`}>
                      {selectedDayBadge.label}
                    </span>
                  ) : selectedDayDetail.holiday || selectedDayDetail.isSun || selectedDayDetail.isSat ? (
                    <span className="text-[10px] font-medium text-ink3">휴무</span>
                  ) : (
                    <span className="text-[10px] font-medium text-ink3">기록 없음</span>
                  )}
                </div>
              </div>

              {selectedDayDetail.record?.inAt || selectedDayDetail.record?.outAt ? (
                <div className="flex items-center justify-between pt-1 border-t border-teal/15 text-ink2">
                  <div className="flex items-center gap-2">
                    <span>
                      출근 <strong className="text-ink font-mono">{timeOf(selectedDayDetail.record.inAt)}</strong>
                    </span>
                    <span>·</span>
                    <span>
                      퇴근 <strong className="text-ink font-mono">
                        {selectedDayDetail.date === todayStr
                          ? isActualOff
                            ? timeOf(selectedDayDetail.record.outAt)
                            : '근무 중'
                          : timeOf(selectedDayDetail.record.outAt) || '—'}
                      </strong>
                    </span>
                  </div>
                  <span className="font-bold text-teal font-mono">
                    {selectedDayDetail.record.totalMin ? `${Math.floor(selectedDayDetail.record.totalMin / 60)}h ${selectedDayDetail.record.totalMin % 60}m` : '—'}
                  </span>
                </div>
              ) : selectedDayDetail.record?.leaveName ? (
                <div className="pt-1 border-t border-teal/15 text-[11px] text-teal font-medium">
                  승인된 휴가 일정이 적용되었습니다. ({selectedDayDetail.record.leaveName})
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
