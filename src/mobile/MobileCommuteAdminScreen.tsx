import { useState, useMemo } from 'react';
import {
  Search,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  CalendarCheck2,
} from 'lucide-react';
import { useAuth } from '@/app/auth/AuthProvider';
import { useSecurityContext } from '@/features/auth/useSecurityContext';
import { useAllUserPresences } from '@/features/userPresence/useUserPresence';
import { useCommuteEmployees, useCommuteDay } from '@/features/commute/useCommute';
import { useUsers } from '@/features/user/useUsers';
import { useCommuteEvaluation } from '@/features/commute/useCommuteEvaluation';
import { requiredWorkSpan, timeToMinutes } from '@/domain/commute/engine';
import { commutePolicy } from '@/domain/security/policy/commutePolicy';
import MobileCommonHeader from './MobileCommonHeader';

const pad = (v: number) => String(v).padStart(2, '0');

const timeOf = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return `${pad(at.getHours())}:${pad(at.getMinutes())}`;
};

type FilterTab = 'all' | 'anomaly' | 'leave';

export default function MobileCommuteAdminScreen() {
  const { user } = useAuth();
  const securityContext = useSecurityContext();

  const [selectedDateStr, setSelectedDateStr] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  });

  const todayStr = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }, []);

  const [filterTab, setFilterTab] = useState<FilterTab>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // 1. 시스템 활성 임직원 목록
  const usersQuery = useUsers();
  const allUsers = useMemo(() => {
    return (usersQuery.data ?? []).filter((u) => u.status === '사용' && !u.resignedAt);
  }, [usersQuery.data]);

  // 2. 내부 시야(Scope) 필터링: commutePolicy 정밀 판정
  //    - 임원 / 전사 인사담당자 ➔ 전사 임직원 (ALL)
  //    - 부서장 / 팀장 ➔ 소속 팀원만 (TEAM)
  const targetUsers = useMemo(() => {
    return allUsers.filter((u) => commutePolicy.canViewEmployee(securityContext, {
      name: u.name,
      dept: u.dept,
    }));
  }, [allUsers, securityContext]);

  // 3. 당일 출퇴근 기록 및 휴가/외근 일정
  const { data: dayRecords = [] } = useCommuteDay(selectedDateStr);
  const { data: employees = [] } = useCommuteEmployees();
  // 근태 판정(정책·공휴일·승인 결재) — 데스크톱과 같은 엔진으로 다시 판정한다
  const { policy, approvalDaysOf, evaluate } = useCommuteEvaluation();
  const presenceMap = useAllUserPresences();

  const empIdToNameMap = useMemo(() => {
    const map = new Map<number, string>();
    employees.forEach((e) => map.set(e.empId, (e.name || '').replace(/\s+/g, '')));
    allUsers.forEach((u) => {
      if (u.empNo) map.set(Number(u.empNo), (u.name || '').replace(/\s+/g, ''));
    });
    return map;
  }, [employees, allUsers]);

  // 4. 사원별 당일 근태 매핑
  const roster = useMemo(() => {
    const recordByEmpId = new Map(dayRecords.map((r) => [r.empId, r]));
    const recordByName = new Map<string, (typeof dayRecords)[0]>();
    dayRecords.forEach((r) => {
      const matchedName = empIdToNameMap.get(r.empId);
      if (matchedName) recordByName.set(matchedName, r);
    });

    return targetUsers.map((u) => {
      const normName = (u.name || '').replace(/\s+/g, '');
      // 이름 우선(데스크톱과 동일) — CAPS 사번과 워크핏 사번이 달라도 같은 사람에 연결
      const rec = recordByName.get(normName) ?? (u.empNo ? recordByEmpId.get(Number(u.empNo)) : undefined);
      const approvalDays = approvalDaysOf({ id: u.id, name: u.name });
      const entries = approvalDays.get(selectedDateStr) ?? [];
      const evaluated = evaluate(
        rec ?? { empId: 0, date: selectedDateStr, inAt: null, outAt: null },
        approvalDays,
      );
      const approvedLeaveType = evaluated.leaveName ?? evaluated.outsideName ?? evaluated.tripName;
      const userPresence = presenceMap[u.id];

      const inAt = timeOf(evaluated.inAt);
      const outAt = timeOf(evaluated.outAt);
      const totalMin = evaluated.totalMin;

      // 퇴근 기준 시각: 그날 근무 종료 시각(정책·반차 반영)
      const span = requiredWorkSpan(policy, entries);
      const targetEndMinutes = span?.end ?? timeToMinutes(policy.workEndTime) ?? 1050;

      let isActualOff = false;
      if (outAt) {
        // 과거 날짜는 태그가 있으면 퇴근, 오늘은 근무 종료 시각 이후로 찍힌 경우에만 퇴근
        isActualOff = selectedDateStr < todayStr || (timeToMinutes(outAt) ?? 0) >= targetEndMinutes;
      }

      let statusText = '미출근';
      let statusTone: 'normal' | 'late' | 'leave' | 'outside' | 'absent' = 'absent';

      if (evaluated.status === 'outside' || evaluated.status === 'trip') {
        statusText = evaluated.outsideName ?? evaluated.tripName ?? (evaluated.status === 'trip' ? '출장' : '외근');
        statusTone = 'outside';
      } else if (evaluated.status === 'leave') {
        statusText = evaluated.leaveName ?? '휴가';
        statusTone = 'leave';
      } else if (inAt) {
        const isLate = evaluated.status === 'late';
        if (isActualOff) {
          statusText = isLate ? '지각/퇴근' : '정상 퇴근';
        } else {
          statusText = isLate ? '지각 근무중' : '정상 근무중';
        }
        statusTone = isLate ? 'late' : 'normal';
      } else if (userPresence?.status === 'OUTSIDE') {
        statusText = '외근/출장';
        statusTone = 'outside';
      }

      return {
        userId: u.id,
        name: u.name,
        dept: u.dept,
        position: u.position,
        inAt,
        outAt,
        isActualOff,
        totalMin,
        statusText,
        statusTone,
        isAnomaly: statusTone === 'late' || (statusTone === 'absent' && !approvedLeaveType),
      };
    });
  }, [targetUsers, dayRecords, selectedDateStr, todayStr, presenceMap, empIdToNameMap, approvalDaysOf, evaluate, policy]);

  // 5. 검색 및 서브탭 필터링
  const filteredRoster = useMemo(() => {
    let list = roster;
    const kw = searchQuery.trim().toLowerCase();
    if (kw) {
      list = list.filter(
        (m) =>
          m.name.toLowerCase().includes(kw) ||
          m.dept.toLowerCase().includes(kw) ||
          m.position.toLowerCase().includes(kw)
      );
    }
    if (filterTab === 'anomaly') {
      list = list.filter((m) => m.isAnomaly);
    } else if (filterTab === 'leave') {
      list = list.filter((m) => m.statusTone === 'leave' || m.statusTone === 'outside');
    }
    return list;
  }, [roster, searchQuery, filterTab]);

  // 요약 카운트
  const summary = useMemo(() => {
    let working = 0;
    let late = 0;
    let leave = 0;
    let absent = 0;
    roster.forEach((m) => {
      if (m.statusTone === 'leave' || m.statusTone === 'outside') leave++;
      else if (m.statusTone === 'late') late++;
      else if (m.inAt) working++;
      else absent++;
    });
    return { total: roster.length, working, late, leave, absent };
  }, [roster]);

  const handleMoveDate = (days: number) => {
    const [y, m, d] = selectedDateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d + days);
    setSelectedDateStr(`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`);
  };

  return (
    <div className="flex h-full flex-col select-none overflow-hidden" style={{ background: '#f2f8fc' }}>
      <MobileCommonHeader
        title="근태·휴가 관제 센터"
        subtitle={
          commutePolicy.getScope(securityContext) === 'TEAM'
            ? `${user?.dept || '부서'} 팀원 근태 관제`
            : '전사 임직원 실시간 출퇴근 관제'
        }
      />

      {/* 1. 일자 네비게이터 */}
      <div className="flex items-center justify-between px-4 py-2 bg-white/90 border-b border-border/60 shrink-0">
        <button
          type="button"
          onClick={() => handleMoveDate(-1)}
          className="grid h-7 w-7 place-items-center rounded-lg border border-border bg-white text-ink2 hover:bg-panel-alt active:scale-95 transition-all"
        >
          <ChevronLeft size={16} />
        </button>
        <div className="flex items-center gap-1.5">
          <span className="text-[13px] font-black text-ink font-mono">{selectedDateStr}</span>
          {selectedDateStr === todayStr && (
            <span className="rounded bg-teal/15 px-1.5 py-0.2 text-[9.5px] font-bold text-teal">
              오늘
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => handleMoveDate(1)}
          className="grid h-7 w-7 place-items-center rounded-lg border border-border bg-white text-ink2 hover:bg-panel-alt active:scale-95 transition-all"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {/* 2. 요약 배지 바 */}
      <div className="grid grid-cols-4 gap-1.5 px-4 py-2.5 bg-white border-b border-border/50 shrink-0 text-center">
        <div className="rounded-xl bg-panel-alt/60 p-2">
          <span className="text-[10px] text-ink3 block">정상 출근</span>
          <span className="text-[14px] font-black text-emerald-600">{summary.working}명</span>
        </div>
        <div className="rounded-xl bg-amber-500/10 p-2 border border-amber-500/20">
          <span className="text-[10px] text-amber-600 block font-bold">지각</span>
          <span className="text-[14px] font-black text-amber-600">{summary.late}명</span>
        </div>
        <div className="rounded-xl bg-teal-soft/20 p-2 border border-teal/20">
          <span className="text-[10px] text-teal block font-bold">휴가/외근</span>
          <span className="text-[14px] font-black text-teal">{summary.leave}명</span>
        </div>
        <div className="rounded-xl bg-panel-alt/60 p-2">
          <span className="text-[10px] text-ink3 block">미체크</span>
          <span className="text-[14px] font-black text-ink3">{summary.absent}명</span>
        </div>
      </div>

      {/* 3. 서브 필터 탭 & 검색창 */}
      <div className="px-4 py-2 bg-white/50 border-b border-border/40 shrink-0 space-y-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setFilterTab('all')}
            className={`rounded-lg px-2.5 py-1 text-[11px] font-bold transition-all ${
              filterTab === 'all'
                ? 'bg-ink text-white shadow-2xs'
                : 'bg-white text-ink3 border border-border hover:bg-panel-alt'
            }`}
          >
            전체 ({roster.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterTab('anomaly')}
            className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-bold transition-all ${
              filterTab === 'anomaly'
                ? 'bg-rose-500 text-white shadow-2xs'
                : 'bg-white text-rose-500 border border-rose-200 hover:bg-rose-50'
            }`}
          >
            <AlertTriangle size={12} />
            <span>이상근태 ({summary.late + summary.absent})</span>
          </button>
          <button
            type="button"
            onClick={() => setFilterTab('leave')}
            className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-bold transition-all ${
              filterTab === 'leave'
                ? 'bg-teal text-white shadow-2xs'
                : 'bg-white text-teal border border-teal/30 hover:bg-teal/5'
            }`}
          >
            <CalendarCheck2 size={12} />
            <span>휴가자 ({summary.leave})</span>
          </button>
        </div>

        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink3" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="사원명, 부서, 직급 검색..."
            className="w-full rounded-xl border border-border bg-white pl-8 pr-3 py-1.5 text-[11.5px] text-ink outline-none placeholder:text-ink3 focus:border-teal"
          />
        </div>
      </div>

      {/* 4. 실시간 사원 근태 카드 리스트 */}
      <div className="flex-1 overflow-y-auto px-4 py-2.5 space-y-2">
        {filteredRoster.length === 0 ? (
          <div className="py-12 text-center text-[12px] text-ink3">
            해당 조건에 부합하는 사원이 없습니다.
          </div>
        ) : (
          filteredRoster.map((item) => (
            <div
              key={item.userId}
              className={`rounded-xl border bg-white p-3 shadow-2xs transition-all ${
                item.statusTone === 'late'
                  ? 'border-amber-300/80 bg-amber-500/5'
                  : item.statusTone === 'leave'
                    ? 'border-teal/30 bg-teal-soft/10'
                    : 'border-border/80'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="grid h-8 w-8 place-items-center rounded-lg bg-panel-alt text-[12px] font-bold text-ink">
                    {item.name.slice(-2)}
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[12.5px] font-bold text-ink">{item.name}</span>
                      <span className="text-[10.5px] text-ink3">{item.position}</span>
                      <span className="rounded bg-panel-alt px-1.5 py-0.2 text-[9px] text-ink2">
                        {item.dept}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-[10.5px] text-ink3 font-mono">
                      <span>출근: {item.inAt || '—'}</span>
                      <span>·</span>
                      <span>퇴근: {item.isActualOff ? item.outAt : item.inAt ? '근무 중' : '—'}</span>
                    </div>
                  </div>
                </div>

                <div className="text-right">
                  <span
                    className={`inline-block rounded-md px-2 py-0.5 text-[10px] font-bold ${
                      item.statusTone === 'normal'
                        ? 'bg-emerald-500/10 text-emerald-600'
                        : item.statusTone === 'late'
                          ? 'bg-amber-500 text-white'
                          : item.statusTone === 'leave'
                            ? 'bg-teal text-white'
                            : item.statusTone === 'outside'
                              ? 'bg-blue-600 text-white'
                              : 'bg-panel-alt text-ink3'
                    }`}
                  >
                    {item.statusText}
                  </span>
                  {item.totalMin > 0 && (
                    <span className="block text-[10px] text-ink3 mt-0.5 font-mono">
                      {Math.floor(item.totalMin / 60)}h {item.totalMin % 60}m
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
