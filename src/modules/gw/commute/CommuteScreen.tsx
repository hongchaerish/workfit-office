import { useAuthz } from '@/features/authz/useAuthz';
import { useCallback, useMemo, useState } from 'react';
import { isTestAccount } from '@/domain/user/testAccount';
import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  summarizeCommuteMonth,
  type CommuteRecord,
} from '@/domain/commute/schema';
import {
  useCommuteBootstrap,
  useCommuteMonth,
  useCommuteMonthAll,
  useCommuteViewer,
} from '@/features/commute/useCommute';
import { useAuth } from '@/app/auth/AuthProvider';
import { useSecurityContext } from '@/features/auth/useSecurityContext';
import { commutePolicy } from '@/domain/security/policy/commutePolicy';
import { useCommuteRoster, normName } from '@/features/commute/useCommuteRoster';
import { useLeaveLedger, type LeaveLedgerMode } from '@/features/commute/useLeaveLedger';
import { GwHead } from '@/modules/gw/_gw';
import { Button } from '@/shared/ui/Button';
import { useCommuteEvaluation } from '@/features/commute/useCommuteEvaluation';
import { EmployeeDetailDrawer } from './components/EmployeeDetailDrawer';
import { CommuteMatrixView } from './components/CommuteMatrixView';
import { CommuteDeptView } from './components/CommuteDeptView';
import { CommuteAnomalyView } from './components/CommuteAnomalyView';
import { CommuteLeaveView } from './components/CommuteLeaveView';
import { MyCommuteLeaveTab } from './components/MyCommuteLeaveTab';
import { LeaveLedgerTable } from '../leave/components/LeaveLedgerTable';
import { LeaveLedgerSummary } from '../leave/components/LeaveLedgerSummary';
import { LeavePersonDetailModal } from '../leave/components/LeavePersonDetailModal';
import type { CommuteAdminTab, CommutePersonRow, DeptSummary, AnomalyItem } from './types';
import {
  Building2,
  AlertTriangle,
  Users,
  Search,
  CalendarCheck2,
  Filter,
  BookOpen,
} from 'lucide-react';

/** 탭 상수 */
const ME_TAB = 'me';
const TEAM_TAB = 'team';

const pad = (value: number) => String(value).padStart(2, '0');

const thisMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
};

function moveMonth(month: string, amount: number): string {
  const [year, mm] = month.split('-').map(Number);
  const next = new Date(year, mm - 1 + amount, 1);
  return `${next.getFullYear()}-${pad(next.getMonth() + 1)}`;
}

const monthTitle = (month: string): string => `${month.slice(0, 4)}년 ${Number(month.slice(5))}월`;

function StatCard({
  label,
  value,
  sub,
  tone,
  onClick,
  active,
}: {
  label: string;
  value: ReactNode;
  sub?: string;
  tone?: string;
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <div
      onClick={onClick}
      className={`min-w-0 flex-1 rounded-xl border px-4 py-3 shadow-2xs transition-all ${
        onClick ? 'cursor-pointer hover:border-teal/50 hover:shadow-sm' : ''
      } ${active ? 'ring-2 ring-teal border-teal bg-teal/10' : tone ?? 'border-border bg-panel'}`}
    >
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-bold text-ink3">{label}</div>
        {active && <span className="h-1.5 w-1.5 rounded-full bg-teal" />}
      </div>
      <div className="mt-1 truncate text-[19px] font-extrabold leading-tight text-ink">{value}</div>
      {sub && <div className="mt-0.5 truncate text-[10px] text-ink3">{sub}</div>}
    </div>
  );
}

const navButton = 'grid h-8 w-8 place-items-center rounded-lg border border-border text-ink2 hover:bg-panel-alt transition-colors';
const searchInput = 'h-8 rounded-lg border border-border bg-panel px-2.5 text-[11px] text-ink outline-none placeholder:text-ink3';
const toggleShell = 'flex items-center gap-0.5 self-center rounded-lg border border-border bg-panel p-0.5 shadow-2xs';

export default function CommuteScreen() {
  const { user } = useAuth();
  const { policy, holidays, holidayMap, approvals = [], approvalDaysOf, evaluate } = useCommuteEvaluation();


  const { commuteScope: authzCommuteScope, commuteDeptNames } = useAuthz();
  const commuteScope = authzCommuteScope();
  // 보안 지침 준수: 비임원/비팀장 사원은 ADMIN 권한이 있더라도 전사 근태 관제 센터에 접근할 수 없으며, 오직 ALL 스코프 보유자만 canAll 부여
  const canAll = commuteScope === 'ALL';

  // 조회 월 — 화면을 열 때 한 번에 받는 요청(useCommuteBootstrap)이 써서 여기서 정한다
  const [month, setMonth] = useState(thisMonth());

  /*
    화면을 열 때(월을 바꿀 때) 내 범위·직원·내 한 달·(팀장·관리자면) 전 직원 한 달을 요청 하나로 받는다.
    따로 부르면 요청 4~5개가 동시에 서버를 붙잡고 기다려 30초씩 멈췄다. 아래 각 조회는 이게 끝난 뒤에 켜지고,
    채워 둔 캐시를 쓰므로 서버에 다시 묻지 않는다. includeAll 은 아래 canManage 와 같은 조건이다.
  */
  const boot = useCommuteBootstrap(month, commuteScope === 'ALL' || commuteScope === 'TEAM');

  const viewerQuery = useCommuteViewer({ enabled: boot.isSettled });
  const viewer = viewerQuery.data;

  // 근태 관리 대상 명단(CAPS 직원 + 사용자 + 인사 프로필) — PWA 근태 관제와 같은 훅
  const roster = useCommuteRoster(boot.isSettled);
  const { allEmployees, employees, userByEmpMap, profileByEmpMap, isExcludedAttendance, compareEmployees, getHireDateForEmp } = roster;

  // 권한 판별: 전사 관리자(ALL) vs 팀장/부서장(TEAM) vs 일반 사원(MY_ONLY)
  const isExec = canAll;
  const isLeader = commuteScope === 'TEAM';
  /*
    연차 원장·전사 휴가 현황은 인사담당자(HR_ADMIN·근태 관제 메뉴 권한)도 본다 — PWA 근태 관제와 같은 commutePolicy 기준.
    다만 서버의 출퇴근 기록 권한은 인사담당자를 전사로 보지 않으므로(caps-ingest), 임원·팀장이 아닌 인사담당자에게는
    출퇴근 표 대신 휴가 현황·연차 원장만 연다(다른 사람 기록이 비어 결근처럼 보이지 않게).
  */
  const securityContext = useSecurityContext();
  const canLedger = canAll || commutePolicy.getScope(securityContext) === 'ALL';
  const isHrOnly = canLedger && !isExec && !isLeader;
  const canManage = isExec || isLeader || canLedger;

  // 상위 탭 상태: URL searchParams를 단일 원천(Single Source of Truth)으로 사용
  const [searchParams, setSearchParams] = useSearchParams();
  const urlTab = searchParams.get('tab');
  const activeTab = (urlTab === TEAM_TAB && canManage) ? TEAM_TAB : ME_TAB;
  const isTeam = activeTab === TEAM_TAB;

  const handleTabChange = useCallback((nextTab: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (nextTab === ME_TAB) {
        next.delete('tab');
      } else {
        next.set('tab', nextTab);
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // 관제 서브 View 탭 상태
  const urlAdminTab = searchParams.get('adminTab') as CommuteAdminTab | null;
  // 인사담당자는 출퇴근 표가 없어 연차 원장부터
  const adminTab: CommuteAdminTab =
    isHrOnly && (!urlAdminTab || !['leave', 'leave_ledger'].includes(urlAdminTab)) ? 'leave_ledger' : urlAdminTab || 'all_matrix';

  const handleAdminTabChange = useCallback((nextAdminTab: CommuteAdminTab) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (nextAdminTab === 'all_matrix') {
        next.delete('adminTab');
      } else {
        next.set('adminTab', nextAdminTab);
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // 연차 원장 산정 모드 & 직원 상세(보기 전용 — 연차 조정은 관리자 콘솔 › 연차 관리)
  const [ledgerMode, setLedgerMode] = useState<LeaveLedgerMode>('HIRE_DATE');
  const [ledgerDetailKey, setLedgerDetailKey] = useState<string | null>(null);
  // 필터 상태
  const [selectedDept, setSelectedDept] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [onlyAnomaly, setOnlyAnomaly] = useState<boolean>(false);
  const [keyword, setKeyword] = useState('');
  const showRetired = false;

  // 테스트 계정일 때: 테스트 부서/계정 제외 토글 상태
  const isViewerTester = useMemo(
    () => isTestAccount(user),
    [user?.dept, user?.name],
  );
  const [excludeTestDept, setExcludeTestDept] = useState(false);

  // 상세 슬라이드오버 상태
  const [selectedPersonDetail, setSelectedPersonDetail] = useState<CommutePersonRow | null>(null);

  /*
    내 근태 사번 — 서버가 알려준 사번(viewer.empId)을 먼저 쓰고, 없으면 받은 CAPS 직원 목록에서 이름(공백 무시)·사번으로 찾는다.
    서버의 답이 오기 전에는 묻지 않는다(null). 예전에는 계정 사번이나 99999 를 짐작해 먼저 물어, 남의 사번이라
    거절(403)되고 다시 묻는 요청이 화면을 열 때마다 생겼다. 끝내 못 찾으면 내 근태는 비어 있다.
    화면용 직원 목록(employees)에서는 찾지 않는다 — CAPS 에 없는 계정에 지어 붙인 사번이 섞여 있어 근태가 있을 수 없다.
  */
  const myEmpId = useMemo(() => {
    if (!viewer) return null;
    if (viewer.empId) return viewer.empId;
    const uName = (user?.name ?? '').trim();
    const uEmpNo = user?.empNo ? Number(user.empNo) : null;
    const foundInCaps = allEmployees.find(
      (e) => (uName && normName(e.name) === normName(uName)) || (uEmpNo && e.empId === uEmpNo)
    );
    return foundInCaps?.empId ?? null;
  }, [viewer, allEmployees, user, normName]);

  // 내 근태 쿼리
  const myMonthQuery = useCommuteMonth(myEmpId, month, { enabled: boot.isSettled });

  // 전사 한 달치 전 직원 쿼리 (캐시를 유지하여 탭 전환 시 깜빡임 방지)
  const monthAllQuery = useCommuteMonthAll(canManage ? month : null, { enabled: boot.isSettled });

  // 내 휴가·외근·출장 승인 일정 (사용자 id·이름 합산)
  const myApprovalDays = useMemo(() => approvalDaysOf({ id: user?.id, name: user?.name }), [approvalDaysOf, user?.id, user?.name]);

  const myHireDate = useMemo(() => {
    return getHireDateForEmp(user?.name, user?.empNo ? Number(user.empNo) : null);
  }, [user, getHireDateForEmp]);

  // 전사 연차 원장 실시간 집계 (전사 권한자 전용) — PWA 근태 관제와 같은 훅
  const {
    entries: leaveLedgerEntries,
    summary: leaveLedgerSummary,
  } = useLeaveLedger({ enabled: canLedger, mode: ledgerMode, roster, approvals, holidays });

  // 내 근태 한 달치 레코드
  const myMonthRows = useMemo(() => {
    const rawMap = new Map<string, CommuteRecord>();
    for (const r of myMonthQuery.data ?? []) {
      rawMap.set(r.date, r);
    }

    const [y, m] = month.split('-').map(Number);
    if (!y || !m) return [];

    const daysInMonth = new Date(y, m, 0).getDate();
    const records: CommuteRecord[] = [];

    for (let dayNum = 1; dayNum <= daysInMonth; dayNum++) {
      const dateStr = `${month}-${pad(dayNum)}`;
      const raw =
        rawMap.get(dateStr) ?? {
          empId: myEmpId ?? 0,
          date: dateStr,
          inAt: null,
          outAt: null,
        };
      records.push(evaluate(raw, myApprovalDays, myHireDate));
    }
    return records;
  }, [myMonthQuery.data, month, myEmpId, evaluate, myApprovalDays, myHireDate]);

  // 관제 대상 직원 필터링 (권한 범위 기반 및 비대상자/퇴사자 제외)
  const scopedEmployees = useMemo(() => {
    return employees.filter((emp) => {
      const matchedUser = userByEmpMap.get(emp.name.trim()) ?? userByEmpMap.get(normName(emp.name)) ?? userByEmpMap.get(String(emp.empId));
      const profile = matchedUser ? profileByEmpMap.get(matchedUser.id) : undefined;

      // 퇴사자 100% 원천 배제
      if (
        !emp.active ||
        Boolean(emp.retireDate) ||
        matchedUser?.status === '미사용' ||
        Boolean(matchedUser?.resignedAt) ||
        profile?.status === 'RETIRED'
      ) {
        return false;
      }

      // 경영기술전략위원회, 상무이사 이상 임원 및 인명관리 [근태 관리 대상 OFF] 직원 제외
      if (isExcludedAttendance(matchedUser, emp.name)) {
        return false;
      }

      // 테스트 부서 제외 옵션 활성화 시 테스트 계정 및 테스트 부서 제외
      if (excludeTestDept) {
        const isTester = isTestAccount(matchedUser) || isTestAccount({ name: emp.name });
        if (isTester) return false;
      }

      if (commuteScope === 'ALL') return true;

      if (commuteScope === 'TEAM') {
        const empDept = (matchedUser?.dept ?? '').trim();
        // 새 권한 체계: 역할 지정의 범위(본인 부서·하위 부서·지정 조직)
        if (commuteDeptNames) return commuteDeptNames.has(empDept);
        const myDept = (user?.dept ?? '').trim();
        return Boolean(myDept && empDept && myDept === empDept);
      }

      return false;
    });
  }, [employees, commuteScope, commuteDeptNames, user?.dept, userByEmpMap, normName, excludeTestDept, isExcludedAttendance]);

  // 부서 목록 추출
  const deptList = useMemo(() => {
    const set = new Set<string>();
    for (const emp of scopedEmployees) {
      const u = userByEmpMap.get(emp.name.trim()) ?? userByEmpMap.get(normName(emp.name)) ?? userByEmpMap.get(String(emp.empId));
      if (u?.dept && u.dept.trim()) set.add(u.dept.trim());
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'ko'));
  }, [scopedEmployees, userByEmpMap, normName]);

  // 전사 직원들의 한 달치 데이터 매트릭스 구성
  const allPersonRows = useMemo(() => {
    // CAPS DB 사번과 사원명 매핑 (CAPS ID와 워크핏 사번 불일치 시 실데이터 누락 방지)
    const capsEmpIdByName = new Map<string, number>();
    for (const ce of allEmployees) {
      capsEmpIdByName.set(ce.name.trim(), ce.empId);
      const n = normName(ce.name);
      if (n) capsEmpIdByName.set(n, ce.empId);
    }

    const rawByEmp = new Map<number, Map<string, CommuteRecord>>();
    for (const row of monthAllQuery.data ?? []) {
      if (!rawByEmp.has(row.empId)) rawByEmp.set(row.empId, new Map());
      rawByEmp.get(row.empId)!.set(row.date, row);
    }

    const [y, m] = month.split('-').map(Number);
    const totalDays = y && m ? new Date(y, m, 0).getDate() : 0;

    const list: CommutePersonRow[] = [];

    for (const emp of scopedEmployees) {
      const u = userByEmpMap.get(emp.name.trim()) ?? userByEmpMap.get(normName(emp.name)) ?? userByEmpMap.get(String(emp.empId));
      const hireDate = getHireDateForEmp(emp.name, emp.empId);
      const personApprovalDays = approvalDaysOf({ id: u?.id, name: u?.name ?? emp.name });
      
      const capsId = capsEmpIdByName.get(emp.name.trim()) ?? capsEmpIdByName.get(normName(emp.name));
      const rawMap = rawByEmp.get(emp.empId) ?? (capsId !== undefined ? rawByEmp.get(capsId) : undefined);

      const records: CommuteRecord[] = [];
      const recordsMap = new Map<string, CommuteRecord>();

      for (let dayNum = 1; dayNum <= totalDays; dayNum++) {
        const dateStr = `${month}-${pad(dayNum)}`;
        const raw =
          rawMap?.get(dateStr) ?? {
            empId: emp.empId,
            date: dateStr,
            inAt: null,
            outAt: null,
          };
        const evaluated = evaluate(raw, personApprovalDays, hireDate);
        records.push(evaluated);
        recordsMap.set(dateStr, evaluated);
      }

      // 입사일 이전 달이라 유효 출퇴근 기록이 없는 사원은 해당 월 명단에서 제외 (외근, 출장도 유효 근무로 인정)
      const hasValidWork = records.some(
        (r) =>
          r.status === 'normal' ||
          r.status === 'late' ||
          r.status === 'holiday_work' ||
          r.status === 'leave' ||
          r.status === 'outside' ||
          r.status === 'trip',
      );
      const hireMonth = hireDate ? hireDate.slice(0, 7) : null;
      const isPreHireMonth = Boolean(hireMonth && month < hireMonth) || records.every((r) => r.status === 'unknown' || r.status === 'off');
      if (!hasValidWork && isPreHireMonth) {
        continue;
      }

      const summary = summarizeCommuteMonth(records);

      const anomalyRecords = records.filter(
        (rec) =>
          rec.status === 'late' ||
          rec.status === 'absent' ||
          rec.status === 'missing_in' ||
          rec.status === 'missing_out',
      );

      list.push({
        empId: emp.empId,
        name: u?.name?.trim() || emp.name,
        empNo: u?.empNo,
        dept: u?.dept ?? '부서 미지정',
        position: u?.position ?? '사원',
        hireDate,
        active: emp.active,
        records,
        recordsMap,
        summary,
        anomalyRecords,
        anomalyCount: anomalyRecords.length,
      });
    }

    return list.sort(compareEmployees);
  }, [scopedEmployees, monthAllQuery.data, month, evaluate, approvalDaysOf, getHireDateForEmp, userByEmpMap, normName, allEmployees, compareEmployees]);

  // 글로벌 필터 적용된 PersonRows
  const filteredPersonRows = useMemo(() => {
    return allPersonRows.filter((row) => {
      if (!showRetired && !row.active) return false;

      if (selectedDept !== 'ALL' && row.dept !== selectedDept) return false;

      const q = keyword.trim().toLowerCase();
      if (q) {
        const matchName = row.name.toLowerCase().includes(q);
        const matchEmpNo = (row.empNo ?? '').toLowerCase().includes(q);
        const matchDept = row.dept.toLowerCase().includes(q);
        if (!matchName && !matchEmpNo && !matchDept) return false;
      }

      if (onlyAnomaly && row.anomalyCount === 0) return false;

      if (statusFilter !== 'ALL') {
        if (statusFilter === 'missing') {
          const hasMissing = row.records.some(
            (r) => r.status === 'missing_in' || r.status === 'missing_out',
          );
          if (!hasMissing) return false;
        } else if (statusFilter === 'present' || statusFilter === 'normal') {
          // 정상 출근만 — 외근·출장은 따로 거른다
          if (!row.records.some((r) => r.status === 'normal' && !r.leaveName)) return false;
        } else if (statusFilter === 'outside') {
          if (!row.records.some((r) => r.status === 'outside' || r.status === 'trip')) return false;
        } else if (statusFilter === 'leave') {
          // 종일 휴가 + 반차·반반차(출근한 날)까지
          if (!row.records.some((r) => r.status === 'leave' || Boolean(r.leaveName))) return false;
        } else {
          const hasStatus = row.records.some((r) => r.status === statusFilter);
          if (!hasStatus) return false;
        }
      }

      return true;
    });
  }, [allPersonRows, showRetired, selectedDept, keyword, onlyAnomaly, statusFilter]);

  // 상단 KPI 통계 집계
  const kpiStats = useMemo(() => {
    const totalMembers = allPersonRows.length;
    let totalPresent = 0;
    let totalLate = 0;
    let totalAbsent = 0;
    let totalLeave = 0;
    let totalOutside = 0;
    let totalAnomaly = 0;

    for (const row of allPersonRows) {
      totalOutside += row.summary.outsideDays;
      totalPresent += row.summary.workDays;
      totalLate += row.summary.lateDays;
      totalAbsent += row.summary.absentDays;
      totalLeave += row.summary.leaveDays;
      totalAnomaly += row.anomalyCount;
    }

    return {
      totalMembers,
      totalPresent,
      totalLate,
      totalAbsent,
      totalLeave,
      totalOutside,
      totalAnomaly,
    };
  }, [allPersonRows]);

  // 부서별 통계 집계
  const deptSummaries: DeptSummary[] = useMemo(() => {
    const map = new Map<string, CommutePersonRow[]>();
    for (const row of allPersonRows) {
      const d = row.dept || '부서 미지정';
      if (!map.has(d)) map.set(d, []);
      map.get(d)!.push(row);
    }

    const summaries: DeptSummary[] = [];
    for (const [dept, members] of map.entries()) {
      let presentDays = 0;
      let lateCount = 0;
      let absentCount = 0;
      let leaveCount = 0;
      let anomalyCount = 0;

      for (const m of members) {
        presentDays += m.summary.workDays;
        lateCount += m.summary.lateDays;
        absentCount += m.summary.absentDays;
        leaveCount += m.summary.leaveDays;
        anomalyCount += m.anomalyCount;
      }

      const totalWorkTarget = members.length * 20;
      const attendanceRate =
        totalWorkTarget > 0 ? Math.min(100, Math.round((presentDays / totalWorkTarget) * 100)) : 100;

      summaries.push({
        dept,
        memberCount: members.length,
        presentDays,
        lateCount,
        absentCount,
        leaveCount,
        anomalyCount,
        attendanceRate,
      });
    }

    return summaries.sort((a, b) => b.memberCount - a.memberCount);
  }, [allPersonRows]);

  // 전체 이상 근태 항목 목록
  const anomalyItems: AnomalyItem[] = useMemo(() => {
    const items: AnomalyItem[] = [];
    for (const row of allPersonRows) {
      if (selectedDept !== 'ALL' && row.dept !== selectedDept) continue;
      if (keyword.trim()) {
        const q = keyword.trim().toLowerCase();
        if (!row.name.toLowerCase().includes(q) && !(row.empNo ?? '').includes(q)) continue;
      }

      for (const rec of row.anomalyRecords) {
        let typeLabel = '이상';
        let note = '';
        if (rec.status === 'late') {
          typeLabel = '지각';
          note = `규정 시각(${policy.workStartTime}) 대비 ${rec.lateMin}분 지각`;
        } else if (rec.status === 'absent') {
          typeLabel = '결근';
          note = '출근 기록 없음 (미승인 결근)';
        } else if (rec.status === 'missing_in') {
          typeLabel = '출근 누락';
          note = '퇴근 태그만 기록됨';
        } else if (rec.status === 'missing_out') {
          typeLabel = '퇴근 누락';
          note = '퇴근 미체크 (출근만 기록)';
        }

        items.push({
          id: `${row.empId}-${rec.date}`,
          date: rec.date,
          empId: row.empId,
          name: row.name,
          dept: row.dept,
          position: row.position,
          status: rec.status,
          typeLabel,
          inAt: rec.inAt,
          outAt: rec.outAt,
          lateMin: rec.lateMin,
          note,
          record: rec,
        });
      }
    }

    return items.sort((a, b) => b.date.localeCompare(a.date));
  }, [allPersonRows, selectedDept, keyword, policy.workStartTime]);

  const personMap = useMemo(() => {
    const map = new Map<number, CommutePersonRow>();
    for (const p of allPersonRows) map.set(p.empId, p);
    return map;
  }, [allPersonRows]);

  // 부서 클릭 시 드릴다운 처리
  const handleDrillDownDept = useCallback((dept: string) => {
    setSelectedDept(dept);
    handleAdminTabChange('all_matrix');
  }, [handleAdminTabChange]);

  const toggleButton = (key: string, label: string, active: boolean, onClick: () => void, icon?: ReactNode) => (
    <button
      key={key}
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11.5px] font-bold transition-all ${
        active ? 'bg-teal text-white shadow-2xs' : 'text-ink3 hover:text-ink2 hover:bg-panel-alt/60'
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );

  const tabToggle = (
    <div className={toggleShell}>
      {toggleButton(ME_TAB, '내 근태·휴가', activeTab === ME_TAB, () => handleTabChange(ME_TAB))}
      {canManage && (
        toggleButton(
          TEAM_TAB,
          isExec || isHrOnly ? '전사 관리' : '부서 관리',
          isTeam,
          () => handleTabChange(TEAM_TAB),
        )
      )}
    </div>
  );

  /** 전사 근태 관제 대시보드 패널 */
  const adminControlPanel = (
    <div className="space-y-3">
      {/* 1. 상단 KPI 관제 카드 (출퇴근 관리 탭일 때만 노출, 연차 원장 대장일 때는 분리) */}
      {adminTab !== 'leave_ledger' && !isHrOnly && (
        // 4개로 단순화(2026-10-13): 인원 · 휴가 · 외근·출장 · 확인 필요. 지각·결근 등 세부는 상태 필터로 본다
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <StatCard
            label="전체 인원"
            value={`${kpiStats.totalMembers}명`}
            sub={commuteScope === 'ALL' ? '전사 전 임직원' : `${user?.dept || '부서'} 기준`}
            onClick={() => {
              setStatusFilter('ALL');
              setOnlyAnomaly(false);
            }}
            active={statusFilter === 'ALL' && !onlyAnomaly}
          />
          <StatCard
            label="휴가"
            value={`${kpiStats.totalLeave}일`}
            sub="당월 사용 (반차 포함)"
            onClick={() => {
              setStatusFilter('leave');
              setOnlyAnomaly(false);
              handleAdminTabChange('all_matrix');
            }}
            active={statusFilter === 'leave'}
          />
          <StatCard
            label="외근·출장"
            value={`${kpiStats.totalOutside}일`}
            sub="당월 승인 일수"
            onClick={() => {
              setStatusFilter('outside');
              setOnlyAnomaly(false);
              handleAdminTabChange('all_matrix');
            }}
            active={statusFilter === 'outside'}
          />
          <StatCard
            label="확인 필요"
            value={
              kpiStats.totalAnomaly > 0 ? (
                <span className="text-rose-600 dark:text-rose-400">{kpiStats.totalAnomaly}건</span>
              ) : (
                `${kpiStats.totalAnomaly}건`
              )
            }
            sub="지각 · 결근 · 미기록"
            onClick={() => {
              setOnlyAnomaly((prev) => !prev);
              setStatusFilter('ALL');
              handleAdminTabChange('all_matrix');
            }}
            active={onlyAnomaly}
          />
        </div>
      )}

      {/* 2. 글로벌 필터 바 & 관제 탭 */}
      <section className="rounded-xl border border-border bg-panel p-3 shadow-2xs space-y-3">
        {/* 상단 뷰 탭 & 기간 컨트롤러 */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
          <div className="flex flex-wrap items-center gap-1 bg-panel-alt p-0.5 rounded-lg border border-border shadow-2xs">
            {!isHrOnly && toggleButton('all_matrix', isExec ? '전사 근태 현황' : '부서 근태 현황', adminTab === 'all_matrix', () => handleAdminTabChange('all_matrix'), <Users size={13} />)}
            {toggleButton('leave', isExec || isHrOnly ? '전사 휴가 현황' : '부서 휴가 현황', adminTab === 'leave', () => handleAdminTabChange('leave'), <CalendarCheck2 size={13} />)}
            {canLedger && (
              toggleButton(
                'leave_ledger',
                '전사 연차 원장',
                adminTab === 'leave_ledger',
                () => handleAdminTabChange('leave_ledger'),
                <BookOpen size={13} />,
              )
            )}
          </div>

          {adminTab !== 'leave_ledger' ? (
            <div className="flex items-center gap-1.5 shrink-0">
              <button type="button" onClick={() => setMonth((v) => moveMonth(v, -1))} aria-label="이전 달" className={navButton}>‹</button>
              <Button size="sm" onClick={() => setMonth(thisMonth())}>이번 달</Button>
              <button type="button" onClick={() => setMonth((v) => moveMonth(v, 1))} aria-label="다음 달" className={navButton}>›</button>
              <h2 className="ml-1 text-[13.5px] font-extrabold text-ink">{monthTitle(month)}</h2>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-[11.5px] font-extrabold text-teal shrink-0">
              <span>📅 {new Date().getFullYear()}년도 전사 연차 원장</span>
            </div>
          )}
        </div>

        {/* 하단 상세 필터 툴바 (근태 전용) */}
        {adminTab !== 'leave_ledger' && !isHrOnly && (
        <div className="flex flex-wrap items-center gap-2">
          {/* 부서 필터 */}
          <div className="flex items-center gap-1.5 text-xs text-ink3">
            <Building2 size={13} className="text-teal" />
            <select
              value={selectedDept}
              onChange={(e) => setSelectedDept(e.target.value)}
              className="h-8 rounded-lg border border-border bg-panel px-2 text-[11px] font-bold text-ink outline-none"
            >
              <option value="ALL">전체 부서 ({allPersonRows.length}명)</option>
              {deptList.map((d) => (
                <option key={d} value={d}>
                  {d} ({allPersonRows.filter((p) => p.dept === d).length}명)
                </option>
              ))}
            </select>
          </div>

          {/* 상태 필터 */}
          <div className="flex items-center gap-1.5 text-xs text-ink3">
            <Filter size={13} className="text-teal" />
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setOnlyAnomaly(false);
              }}
              className="h-8 rounded-lg border border-border bg-panel px-2 text-[11px] font-bold text-ink outline-none"
            >
              <option value="ALL">전체 근태 상태</option>
              <option value="present">정상 출근</option>
              <option value="late">지각 발생</option>
              <option value="absent">결근</option>
              <option value="leave">휴가 사용</option>
              <option value="outside">외근·출장</option>
              <option value="holiday_work">휴일근무</option>
              <option value="missing">출·퇴근 미기록</option>
            </select>
          </div>

          {/* 확인 필요(이상 근태)만 보기 토글 버튼 */}
          <button
            type="button"
            onClick={() => setOnlyAnomaly((prev) => !prev)}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-bold transition-all ${
              onlyAnomaly
                ? 'bg-rose-500 text-white border-rose-600 shadow-2xs ring-2 ring-rose-500/30'
                : 'border-border text-ink2 hover:border-rose-500/50 hover:bg-rose-500/10'
            }`}
          >
            <AlertTriangle size={12} className={onlyAnomaly ? 'text-white' : 'text-rose-500'} />
            <span>확인 필요 ({kpiStats.totalAnomaly}건)</span>
          </button>

          {/* 테스트 계정으로 조회 시에만 노출되는 테스트 부서 제외 토글 */}
          {isViewerTester && (
            <label className="flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] font-bold text-amber-700 dark:text-amber-400 cursor-pointer select-none ml-1 transition-colors hover:bg-amber-500/15">
              <input
                type="checkbox"
                checked={excludeTestDept}
                onChange={(e) => setExcludeTestDept(e.target.checked)}
                className="rounded border-amber-500/40 text-amber-600 focus:ring-amber-500/30"
              />
              <span>테스트 부서 제외</span>
            </label>
          )}

          {/* 검색창 */}
          <div className="ml-auto flex items-center gap-1.5">
            <div className="relative">
              <input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="이름 · 사번 · 부서 검색"
                className={`${searchInput} w-44 pl-7`}
              />
              <Search size={12} className="absolute left-2.5 top-2.5 text-ink3" />
            </div>
            {(selectedDept !== 'ALL' || statusFilter !== 'ALL' || onlyAnomaly || keyword) && (
              <button
                type="button"
                onClick={() => {
                  setSelectedDept('ALL');
                  setStatusFilter('ALL');
                  setOnlyAnomaly(false);
                  setKeyword('');
                }}
                className="text-[10.5px] font-bold text-ink3 hover:text-teal underline"
              >
                필터 초기화
              </button>
            )}
          </div>
        </div>
        )}
      </section>

      {/* 3. 4대 관제 View 전환 렌더링 */}
      {monthAllQuery.isLoading || !boot.isSettled ? (
        <div className="grid min-h-72 place-items-center rounded-xl border border-border bg-panel text-xs text-ink3">
          전사 근태 데이터를 정밀 집계 중입니다…
        </div>
      ) : (
        <>
          {adminTab === 'all_matrix' && (
            <CommuteMatrixView
              month={month}
              rows={filteredPersonRows}
              onSelectPerson={(person) => setSelectedPersonDetail(person)}
              holidayMap={holidayMap}
            />
          )}

          {adminTab === 'dept_summary' && (
            <CommuteDeptView
              deptSummaries={deptSummaries}
              onDrillDownDept={handleDrillDownDept}
            />
          )}

          {adminTab === 'anomaly' && (
            <CommuteAnomalyView
              anomalies={anomalyItems}
              personMap={personMap}
              onSelectPerson={(person) => setSelectedPersonDetail(person)}
            />
          )}

          {adminTab === 'leave' && (
            <CommuteLeaveView
              month={month}
              approvals={approvals}
              personMap={personMap}
              onSelectPerson={(person) => setSelectedPersonDetail(person)}
            />
          )}

          {adminTab === 'leave_ledger' && canLedger && (
            <div className="space-y-3">
              {/* 전사 연차 요약 */}
              <LeaveLedgerSummary summary={leaveLedgerSummary} />

              {/* 전사 연차 원장 테이블 */}
              <LeaveLedgerTable
                entries={leaveLedgerEntries}
                calculationMode={ledgerMode}
                onToggleCalculationMode={setLedgerMode}
                onSelectPerson={(entry) => setLedgerDetailKey(`${entry.empNo}-${entry.name}`)}
                isAdmin={false}
              />
            </div>
          )}
        </>
      )}

      {/* 4. 직원 연차 상세 (보기 전용) */}
      <LeavePersonDetailModal
        entry={ledgerDetailKey ? leaveLedgerEntries.find((e) => `${e.empNo}-${e.name}` === ledgerDetailKey) ?? null : null}
        onClose={() => setLedgerDetailKey(null)}
      />

      {/* 4. 직원 상세 슬라이드오버 (Drawer) */}
      <EmployeeDetailDrawer
        person={selectedPersonDetail}
        onClose={() => setSelectedPersonDetail(null)}
        month={month}
        holidayMap={holidayMap}
      />
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-[1560px] px-3 py-4 sm:px-5 sm:py-5 min-w-0 overflow-x-hidden">
      <GwHead
        icon="⏱️"
        name="근태·휴가"
        desc="출퇴근 기록 및 개인 연차·휴가 잔여 조회와 신청 내역을 통합 관리합니다."
        right={
          <div className="flex flex-wrap items-center justify-end gap-2 shrink-0">
            {tabToggle}
          </div>
        }
      />

      <div className="mt-4">
        {activeTab === TEAM_TAB ? (
          adminControlPanel
        ) : (
          <MyCommuteLeaveTab
            month={month}
            setMonth={setMonth}
            monthRows={myMonthRows}
            isLoading={myMonthQuery.isLoading || !boot.isSettled}
            holidayMap={holidayMap}
            policyStartTime={policy.workStartTime}
            policyEndTime={policy.workEndTime}
            hireDate={myHireDate}
          />
        )}
      </div>
    </div>
  );
}
