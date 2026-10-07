import { useCallback, useMemo, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  summarizeCommuteMonth,
  type CommuteRecord,
} from '@/domain/commute/schema';
import {
  useCommuteEmployees,
  useCommuteMonth,
  useCommuteMonthAll,
  useCommuteViewer,
} from '@/features/commute/useCommute';
import { useAuth } from '@/app/auth/AuthProvider';
import { usePermission } from '@/features/auth/usePermission';
import { resolveCommuteScope } from '@/features/auth/scopeHelper';
import { useOrgTree } from '@/features/gw/useOrgTree';
import { useUsers } from '@/features/user/useUsers';
import { useEmployeeProfiles } from '@/features/employeeProfile/useEmployeeProfiles';
import { GwHead } from '@/modules/gw/_gw';
import { Button } from '@/shared/ui/Button';
import { useCommutePolicy } from '@/features/commute/useCommutePolicy';
import { useCommuteEvaluation } from '@/features/commute/useCommuteEvaluation';
import { CommutePolicyModal } from './components/CommutePolicyModal';
import { EmployeeDetailDrawer } from './components/EmployeeDetailDrawer';
import { CommuteMatrixView } from './components/CommuteMatrixView';
import { CommuteDeptView } from './components/CommuteDeptView';
import { CommuteAnomalyView } from './components/CommuteAnomalyView';
import { CommuteLeaveView } from './components/CommuteLeaveView';
import { MyCommuteLeaveTab } from './components/MyCommuteLeaveTab';
import { LeaveLedgerTable } from '../leave/components/LeaveLedgerTable';
import { LeaveAdjustmentModal } from '../leave/components/LeaveAdjustmentModal';
import { BatchSubstituteHolidayModal } from '../leave/components/BatchSubstituteHolidayModal';
import {
  buildLeaveLedger,
  type LeaveLedgerEntry,
} from '@/domain/leave/ledger';
import {
  getStoredAdjustments,
  type LeaveAdjustmentTransaction,
} from '@/domain/leave/adjustmentStore';
import type { CommuteAdminTab, CommutePersonRow, DeptSummary, AnomalyItem } from './types';
import {
  Settings,
  Clock,
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
  const { userRoles, isAdmin } = usePermission();
  const org = useOrgTree();
  const { savePolicy } = useCommutePolicy();
  const { policy, holidays, holidayMap, approvals = [], approvalDaysOf, evaluate } = useCommuteEvaluation();
  const [isPolicyModalOpen, setIsPolicyModalOpen] = useState(false);


  const commuteScope = useMemo(() => resolveCommuteScope(user, userRoles, org), [user, userRoles, org]);
  // 보안 지침 준수: 비임원/비팀장 사원은 ADMIN 권한이 있더라도 전사 근태 관제 센터에 접근할 수 없으며, 오직 ALL 스코프 보유자만 canAll 부여
  const canAll = commuteScope === 'ALL';
  const canManagePolicy = isAdmin || canAll;

  const viewerQuery = useCommuteViewer();
  const viewer = viewerQuery.data;

  // 시스템 전체 사용자 목록
  const usersQuery = useUsers();
  const allUsers = useMemo(() => usersQuery.data ?? [], [usersQuery.data]);

  // 이름 공백 정규화 (예: '모 란' vs '모란' 동일인 처리)
  const normName = useCallback((s?: string | null) => (s || '').replace(/\s+/g, ''), []);

  // CAPS 연동 직원 목록
  const employeesQuery = useCommuteEmployees();
  const allEmployees = useMemo(() => employeesQuery.data ?? [], [employeesQuery.data]);

  // 사용자 검색 맵 (이름, 사번, ID 기준 빠른 매핑)
  const userByEmpMap = useMemo(() => {
    const map = new Map<string, typeof allUsers[0]>();
    for (const u of allUsers) {
      if (u.empNo) map.set(u.empNo.trim(), u);
      if (u.name) {
        map.set(u.name.trim(), u);
        map.set(normName(u.name), u);
      }
      if (u.id) map.set(u.id.trim(), u);
    }
    return map;
  }, [allUsers, normName]);

  const { data: employeeProfiles = [] } = useEmployeeProfiles();
  const profileByEmpMap = useMemo(() => {
    const map = new Map<string, typeof employeeProfiles[0]>();
    for (const p of employeeProfiles) {
      if (p.empNo) map.set(p.empNo.trim(), p);
      if (p.name) {
        map.set(p.name.trim(), p);
        map.set(normName(p.name), p);
      }
      if (p.userId) map.set(p.userId.trim(), p);
    }
    return map;
  }, [employeeProfiles, normName]);

  // 근태 관리 제외 대상 여부 단일 판정 헬퍼 (인명관리의 [근태 관리 대상] ON/OFF 스위치에 의해서만 결정)
  const isExcludedAttendance = useCallback(
    (
      u?: {
        id?: string;
        name?: string | null;
        empNo?: string | null;
        dept?: string | null;
        position?: string | null;
        jobTitle?: string | null;
      } | null,
      rowName?: string,
    ) => {
      const name = (u?.name || rowName || '').trim();
      const nName = normName(name);

      // 프로필에 근태 관리 대상 여부가 설정되어 있는 경우 반영 (기본값: true / 관리자가 OFF한 경우: false)
      const profile =
        (u?.id ? profileByEmpMap.get(u.id) : undefined) ??
        (u?.empNo ? profileByEmpMap.get(u.empNo) : undefined) ??
        (name ? profileByEmpMap.get(name) ?? profileByEmpMap.get(nName) : undefined);

      if (profile?.isAttendanceTarget === false) return true;
      return false;
    },
    [profileByEmpMap, normName],
  );

  // 직책/직급 서열 가중치 (1순위: 위원장/대표이사 -> 2순위: 부위원장 -> 3순위: 상무/손승원/본부장/이사/임원)
  const getJobTitleRank = useCallback((position?: string | null, name?: string | null, jobTitle?: string | null) => {
    const pos = (position || '').trim();
    const n = (name || '').trim();
    const title = (jobTitle || '').trim();

    if (
      n === '위원장' ||
      pos === '위원장' ||
      title === '위원장' ||
      ((n.includes('대표') || pos.includes('대표') || title.includes('대표') || title.includes('위원장')) &&
        !n.includes('부위원') && !pos.includes('부위원') && !title.includes('부위원'))
    ) {
      return 1;
    }
    if (n.includes('부위원') || pos.includes('부위원') || title.includes('부위원')) {
      return 2;
    }
    if (
      n.includes('손승원') ||
      pos.includes('상무') ||
      title.includes('상무') ||
      pos.includes('전무') ||
      title.includes('전무') ||
      pos.includes('부사장') ||
      title.includes('부사장') ||
      title.includes('본부장') ||
      title.includes('임원') ||
      pos.includes('이사')
    ) {
      return 3;
    }
    if (title.includes('센터장') || title.includes('소장') || title.includes('실장')) {
      return 4;
    }
    if (title.includes('팀장') || title.includes('부서장')) {
      return 5;
    }
    if (title.includes('부팀장') || title.includes('파트장') || title.includes('그룹장')) {
      return 6;
    }
    return 10;
  }, []);

  const compareEmployees = useCallback(
    (
      a: { name?: string | null; position?: string | null; jobTitle?: string | null },
      b: { name?: string | null; position?: string | null; jobTitle?: string | null },
    ) => {
      const nameA = (a.name || '').trim();
      const nameB = (b.name || '').trim();
      const posA = a.position || userByEmpMap.get(nameA)?.position || '';
      const posB = b.position || userByEmpMap.get(nameB)?.position || '';
      const titleA = a.jobTitle || userByEmpMap.get(nameA)?.jobTitle || '';
      const titleB = b.jobTitle || userByEmpMap.get(nameB)?.jobTitle || '';

      // 1순위: 최고위 임원급 서열 (1: 위원장/대표이사 -> 2: 부위원장 -> 3: 상무/손승원)
      const rankA = getJobTitleRank(posA, nameA, titleA);
      const rankB = getJobTitleRank(posB, nameB, titleB);
      if (rankA !== rankB) return rankA - rankB;

      // 2순위: 직급 순위 (org.rankOf)
      const posRankA = org.rankOf(posA);
      const posRankB = org.rankOf(posB);
      if (posRankA !== posRankB) return posRankA - posRankB;

      // 3순위: 이름 가나다순
      return nameA.localeCompare(nameB, 'ko');
    },
    [getJobTitleRank, userByEmpMap, org],
  );

  // CAPS DB 임직원과 시스템 전체 사용자(allUsers)를 통합 (임직원 DB 미등록자 및 근태관리 OFF 대상자 100% 원천 배제)
  const employees = useMemo(() => {
    const list = [
      ...allEmployees
        .filter((row) => row.active !== false && !row.retireDate)
        .filter((row) => {
          const n = row.name.trim();
          const norm = normName(n);

          // [규칙 1] 임직원 데이터베이스(users/allUsers)와 비교: 매칭되는 등록 임직원이 없으면 100% 배제
          const matchedUser = userByEmpMap.get(n) ?? userByEmpMap.get(norm) ?? userByEmpMap.get(String(row.empId));
          if (!matchedUser) return false;

          // [규칙 2] 퇴사자(미사용, resignedAt 기록자) 100% 배제
          if (matchedUser.status === '미사용' || Boolean(matchedUser.resignedAt)) return false;

          // [규칙 3] 인명관리에서 근태관리 대상 OFF로 지정된 경우 배제
          return !isExcludedAttendance(matchedUser, row.name);
        }),
    ];
    const existingNormNames = new Set(list.map((e) => normName(e.name)));
    const existingEmpIds = new Set(list.map((e) => e.empId));

    const isViewerTester = (user?.dept ?? '').includes('테스트') || (user?.name ?? '').toLowerCase().includes('test');

    for (const u of allUsers) {
      // 퇴사자(미사용, resignedAt 기록자) 100% 원천 배제
      if (u.status === '미사용' || Boolean(u.resignedAt)) continue;

      const name = (u.name || '').trim();
      const nName = normName(name);
      if (!name || !nName || existingNormNames.has(nName) || isExcludedAttendance(u, name)) continue;

      const isUserTester = (u.dept ?? '').includes('테스트') || name.toLowerCase().includes('test');
      if (isUserTester && !isViewerTester) continue;

      let empId = Number(u.empNo);
      if (Number.isNaN(empId) || empId <= 0 || existingEmpIds.has(empId)) {
        let hash = 0;
        const key = u.id || name;
        for (let i = 0; i < key.length; i++) {
          hash = ((hash << 5) - hash) + key.charCodeAt(i);
          hash |= 0;
        }
        empId = 10000 + (Math.abs(hash) % 80000);
        while (existingEmpIds.has(empId)) empId++;
      }

      existingNormNames.add(nName);
      existingEmpIds.add(empId);

      list.push({
        empId,
        name,
        active: true,
        retireDate: null,
      });
    }

    return list.sort(compareEmployees);
  }, [allEmployees, allUsers, userByEmpMap, user?.dept, user?.name, normName, isExcludedAttendance, compareEmployees]);

  const getHireDateForEmp = useCallback(
    (empName?: string | null, empId?: number | null) => {
      if (!empName && !empId) return null;
      const profile =
        (empName ? (profileByEmpMap.get(empName.trim()) ?? profileByEmpMap.get(normName(empName))) : undefined) ??
        (empId ? profileByEmpMap.get(String(empId)) : undefined);
      return profile?.hireDate ? profile.hireDate.trim() : null;
    },
    [profileByEmpMap, normName],
  );

  // 권한 판별: 전사 관리자(ALL) vs 팀장/부서장(TEAM) vs 일반 사원(MY_ONLY)
  const isExec = canAll;
  const isLeader = commuteScope === 'TEAM';
  const canManage = isExec || isLeader;

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
  const adminTab: CommuteAdminTab = urlAdminTab || 'all_matrix';

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

  // 연차 원장 산정 모드 & 수동 가감 상태
  const [ledgerMode, setLedgerMode] = useState<'HIRE_DATE' | 'FISCAL_YEAR'>('HIRE_DATE');
  const [adjustmentTarget, setAdjustmentTarget] = useState<LeaveLedgerEntry | null>(null);
  const [showBatchSubstituteModal, setShowBatchSubstituteModal] = useState(false);
  const [adjustments, setAdjustments] = useState<LeaveAdjustmentTransaction[]>(() => getStoredAdjustments());

  useEffect(() => {
    const handleUpdate = () => {
      setAdjustments(getStoredAdjustments());
    };
    window.addEventListener('workfit-leave-adjustment-updated', handleUpdate);
    return () => window.removeEventListener('workfit-leave-adjustment-updated', handleUpdate);
  }, []);

  // 필터 상태
  const [month, setMonth] = useState(thisMonth());
  const [selectedDept, setSelectedDept] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [onlyAnomaly, setOnlyAnomaly] = useState<boolean>(false);
  const [keyword, setKeyword] = useState('');
  const showRetired = false;

  // 테스트 계정일 때: 테스트 부서/계정 제외 토글 상태
  const isViewerTester = useMemo(
    () => (user?.dept ?? '').includes('테스트') || (user?.name ?? '').toLowerCase().includes('test'),
    [user?.dept, user?.name],
  );
  const [excludeTestDept, setExcludeTestDept] = useState(false);

  // 상세 슬라이드오버 상태
  const [selectedPersonDetail, setSelectedPersonDetail] = useState<CommutePersonRow | null>(null);

  const myEmpId = useMemo(() => {
    if (viewer?.empId) return viewer.empId;
    const uName = (user?.name ?? '').trim();
    const uEmpNo = user?.empNo ? Number(user.empNo) : null;
    const foundInCaps = allEmployees.find(
      (e) => (uName && normName(e.name) === normName(uName)) || (uEmpNo && e.empId === uEmpNo)
    );
    if (foundInCaps?.empId) return foundInCaps.empId;
    const foundInEmps = employees.find((e) => e.name.trim() === uName);
    return foundInEmps?.empId ?? uEmpNo ?? (user ? 99999 : null);
  }, [viewer?.empId, allEmployees, employees, user, normName]);

  // 내 근태 쿼리
  const myMonthQuery = useCommuteMonth(myEmpId, month);

  // 전사 한 달치 전 직원 쿼리 (캐시를 유지하여 탭 전환 시 깜빡임 방지)
  const monthAllQuery = useCommuteMonthAll(canManage ? month : null);

  // 내 휴가·외근·출장 승인 일정 (사용자 id·이름 합산)
  const myApprovalDays = useMemo(() => approvalDaysOf({ id: user?.id, name: user?.name }), [approvalDaysOf, user?.id, user?.name]);

  const myHireDate = useMemo(() => {
    return getHireDateForEmp(user?.name, user?.empNo ? Number(user.empNo) : null);
  }, [user, getHireDateForEmp]);

  // 전사 연차 원장 실시간 집계 (전사 권한자 전용)
  const { entries: leaveLedgerEntries, summary: leaveLedgerSummary } = useMemo(() => {
    if (!canAll) {
      return {
        entries: [],
        summary: {
          totalEmployees: 0,
          totalEntitled: 0,
          totalAdjusted: 0,
          totalGranted: 0,
          totalUsed: 0,
          totalPending: 0,
          totalRemaining: 0,
          avgUsageRate: 0,
          advanceEmployeeCount: 0,
        },
      };
    }

    const empInput = employees
      .filter((e) => {
        const u =
          userByEmpMap.get(e.name.trim()) ??
          userByEmpMap.get(normName(e.name)) ??
          userByEmpMap.get(String(e.empId));
        return !isExcludedAttendance(u, e.name);
      })
      .map((e) => {
        const u =
          userByEmpMap.get(e.name.trim()) ??
          userByEmpMap.get(normName(e.name)) ??
          userByEmpMap.get(String(e.empId));
        const hire = getHireDateForEmp(e.name, e.empId);
      const isRetired = !e.active || u?.status === '미사용' || Boolean(u?.resignedAt);
      return {
        empId: e.empId,
        empNo: u?.empNo ? String(u.empNo) : String(e.empId),
        name: e.name,
        dept: u?.dept || null,
        position: u?.position || null,
        hireDate: hire,
        isRetired,
      };
    });

    const result = buildLeaveLedger(
      empInput,
      employeeProfiles,
      approvals,
      adjustments,
      { mode: ledgerMode, holidays },
    );

    return {
      entries: result.entries.sort(compareEmployees),
      summary: result.summary,
    };
  }, [
    canAll,
    employees,
    userByEmpMap,
    normName,
    getHireDateForEmp,
    employeeProfiles,
    approvals,
    adjustments,
    ledgerMode,
    holidays,
    compareEmployees,
  ]);

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
        const isTester =
          (matchedUser?.dept ?? '').includes('테스트') ||
          (matchedUser?.name ?? '').toLowerCase().includes('test') ||
          emp.name.toLowerCase().includes('test');
        if (isTester) return false;
      }

      if (commuteScope === 'ALL') return true;

      if (commuteScope === 'TEAM') {
        const myDept = (user?.dept ?? '').trim();
        const empDept = (matchedUser?.dept ?? '').trim();
        return Boolean(myDept && empDept && myDept === empDept);
      }

      return false;
    });
  }, [employees, commuteScope, user?.dept, userByEmpMap, normName, excludeTestDept, isExcludedAttendance]);

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
          const hasNormal = row.records.some(
            (r) => r.status === 'normal' || r.status === 'outside' || r.status === 'trip'
          );
          if (!hasNormal) return false;
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
    let totalAnomaly = 0;

    for (const row of allPersonRows) {
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
          isExec ? '전사 관리' : '부서 관리',
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
      {adminTab !== 'leave_ledger' && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
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
            label="정상 출근"
            value={`${kpiStats.totalPresent}건`}
            sub="당월 누적 출근"
            onClick={() => {
              setStatusFilter('present');
              setOnlyAnomaly(false);
            }}
            active={statusFilter === 'present'}
          />
          <StatCard
            label="지각"
            value={`${kpiStats.totalLate}건`}
            sub="규정 시각 초과"
            onClick={() => {
              setStatusFilter('late');
              setOnlyAnomaly(false);
            }}
            active={statusFilter === 'late'}
          />
          <StatCard
            label="결근"
            value={`${kpiStats.totalAbsent}건`}
            sub="미승인 결근"
            onClick={() => {
              setStatusFilter('absent');
              setOnlyAnomaly(false);
            }}
            active={statusFilter === 'absent'}
          />
          <StatCard
            label="휴가"
            value={`${kpiStats.totalLeave}건`}
            sub="승인 완료 건수"
            onClick={() => {
              handleAdminTabChange('leave');
            }}
            active={adminTab === 'leave'}
          />
          <StatCard
            label="이상 근태"
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
            {toggleButton('all_matrix', isExec ? '전사 근태 현황' : '부서 근태 현황', adminTab === 'all_matrix', () => handleAdminTabChange('all_matrix'), <Users size={13} />)}
            {toggleButton('leave', isExec ? '전사 휴가 현황' : '부서 휴가 현황', adminTab === 'leave', () => handleAdminTabChange('leave'), <CalendarCheck2 size={13} />)}
            {isExec && (
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
        {adminTab !== 'leave_ledger' && (
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
      {monthAllQuery.isLoading ? (
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

          {adminTab === 'leave_ledger' && canAll && (
            <div className="space-y-3">
              {/* 전사 연차 KPI 통계 바 */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
                <StatCard
                  label="관리 인원"
                  value={`${leaveLedgerSummary.totalEmployees}명`}
                  sub="전사 임직원"
                />
                <StatCard
                  label="총 부여 연차"
                  value={`${leaveLedgerSummary.totalGranted}일`}
                  sub={`법정 ${leaveLedgerSummary.totalEntitled}일 + 조정`}
                  tone="border-teal/25 bg-teal/8"
                />
                <StatCard
                  label="총 사용 연차"
                  value={`${leaveLedgerSummary.totalUsed}일`}
                  sub="승인 완료 누적"
                  tone="border-emerald-500/25 bg-emerald-500/8"
                />
                <StatCard
                  label="평균 소진율"
                  value={`${leaveLedgerSummary.avgUsageRate}%`}
                  sub="부여 대비 사용"
                  tone="border-teal/25 bg-teal/8"
                />
                <StatCard
                  label="잔여 연차 합계"
                  value={`${leaveLedgerSummary.totalRemaining}일`}
                  sub={`신청중 ${leaveLedgerSummary.totalPending}일 제외`}
                />
              </div>

              {/* 전사 연차 원장 테이블 */}
              <LeaveLedgerTable
                entries={leaveLedgerEntries}
                calculationMode={ledgerMode}
                onToggleCalculationMode={setLedgerMode}
                onOpenAdjustment={(entry) => setAdjustmentTarget(entry)}
                onOpenBatchSubstitute={() => setShowBatchSubstituteModal(true)}
                isAdmin={canAll}
              />
            </div>
          )}
        </>
      )}

      {/* 4. 연차 수동 가감 모달 */}
      {adjustmentTarget && (
        <LeaveAdjustmentModal
          entry={adjustmentTarget}
          adminName={user?.name || '관리자'}
          onClose={() => setAdjustmentTarget(null)}
          onSuccess={() => {
            setAdjustments(getStoredAdjustments());
          }}
        />
      )}

      {/* 5. 대체휴무 일괄 및 개별 부여 관리 모달 */}
      {showBatchSubstituteModal && (
        <BatchSubstituteHolidayModal
          adminName={user?.name || '관리자'}
          employees={employees
            .filter((e) => e.active)
            .map((e) => ({
              ...e,
              hireDate: getHireDateForEmp(e.name, e.empId),
            }))}
          onClose={() => setShowBatchSubstituteModal(false)}
        />
      )}

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
            {canManagePolicy && (
              <button
                type="button"
                onClick={() => setIsPolicyModalOpen(true)}
                className="flex items-center gap-1.5 rounded-lg border border-border bg-panel px-3 py-1.5 text-[11.5px] font-bold text-ink hover:bg-panel-alt transition-colors shadow-2xs"
                title="출퇴근 시간 및 근무정책 설정"
              >
                <Clock size={13} className="text-amber-500" />
                <span>{policy.workStartTime}~{policy.workEndTime}</span>
                <Settings size={12} className="text-ink3" />
              </button>
            )}
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
            isLoading={myMonthQuery.isLoading}
            holidayMap={holidayMap}
            policyStartTime={policy.workStartTime}
            policyEndTime={policy.workEndTime}
            hireDate={myHireDate}
          />
        )}
      </div>

      <CommutePolicyModal
        isOpen={isPolicyModalOpen}
        onClose={() => setIsPolicyModalOpen(false)}
        policy={policy}
        onSave={savePolicy}
      />
    </div>
  );
}
