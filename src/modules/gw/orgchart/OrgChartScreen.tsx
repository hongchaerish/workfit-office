import { useMemo, useState } from 'react';
import { X, Download, Printer, Building2, BarChart3, PhoneCall, Briefcase, Mail, Phone, Check, Copy, Armchair } from 'lucide-react';
import { SeatLayoutView } from './SeatLayoutView';
import { useOrgTree } from '@/features/gw/useOrgTree';
import { useEmployeeProfiles } from '@/features/employeeProfile/useEmployeeProfiles';
import type { User } from '@/domain/user/schema';
import { Button } from '@/shared/ui/Button';


/** 테스트 부서 및 테스트 계정 예외처리 */
const isExcludedUser = (user: User) =>
  user.dept.includes('테스트') ||
  user.name.includes('테스터') ||
  user.name.includes('테스트') ||
  user.name.includes('허진욱2') ||
  user.name === 'ㅎ테스터';

const isExcludedDept = (deptName: string) =>
  deptName.includes('테스트');

/**
 * 조직도 (그룹웨어)
 * - [📊 비주얼 차트]: 워크핏 공식 엑셀 조직도 스타일(피치/그린/블루 3열 격자 다이어그램)
 * - [📋 리스트로 보기]: 전사 임직원 직급·직책·부서·상급자·연락처 일괄 조회 및 검색 리스트
 * - [📞 비상연락망]: 공식 비상연락망 사번·소속·직급·연락처·이메일 표
 * - [🪑 좌석배치도]: 배치도 이미지 위 자리별 이름·직급·부서·근태 (운영자·임원만 배치 수정)
 */
export default function OrgChartScreen() {
  const org = useOrgTree();
  const { data: employeeProfiles = [] } = useEmployeeProfiles();
  const profileMap = useMemo(() => {
    return new Map(employeeProfiles.map((p) => [p.userId || p.id, p]));
  }, [employeeProfiles]);

  const [viewMode, setViewMode] = useState<'visual' | 'emergency' | 'seat'>('visual');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const selectedUser = org.users.find((u) => u.id === selectedUserId);
  const selectedProfile = selectedUserId ? profileMap.get(selectedUserId) : null;

  // 유효 부서 및 유효 사용자 목록
  const validDepts = useMemo(() => org.depts.filter((d) => !isExcludedDept(d.name)), [org.depts]);
  const validUsers = useMemo(
    () => org.users.filter((u) => u.status === '사용' && !isExcludedUser(u) && !isExcludedDept(u.dept)),
    [org.users],
  );

  return (
    <div className={`mx-auto pb-12 ${viewMode === 'seat' ? 'max-w-[1500px] px-4 sm:px-6' : 'max-w-6xl'}`}>
      {/* 브레드크럼 + 타이틀 & 뷰 모드 탭 */}
      <div className="mb-1 text-xs font-medium text-ink3">
        그룹웨어 <span className="px-1">/</span> 조직도
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-teal-soft text-teal">
            <Building2 size={18} />
          </span>
          <h1 className="text-xl font-bold text-ink">조직도</h1>
          <span className="ml-2 text-[12px] text-ink3">
            {validDepts.length}개 부서 · {validUsers.length}명
          </span>
        </div>

        {/* 뷰 모드 전환 버튼 (비주얼 차트 / 비상연락망 / 좌석배치도) */}
        <div className="flex items-center gap-1 rounded-xl border border-border bg-panel-alt/60 p-1 shadow-xs">
          <button
            type="button"
            onClick={() => setViewMode('visual')}
            className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[11.5px] font-bold transition-all ${
              viewMode === 'visual'
                ? 'bg-panel text-teal shadow-xs'
                : 'text-ink3 hover:text-ink'
            }`}
          >
            <BarChart3 size={14} />
            <span>비주얼 차트</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode('emergency')}
            className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[11.5px] font-bold transition-all ${
              viewMode === 'emergency'
                ? 'bg-panel text-teal shadow-xs'
                : 'text-ink3 hover:text-ink'
            }`}
          >
            <PhoneCall size={14} />
            <span>비상연락망</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode('seat')}
            className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[11.5px] font-bold transition-all ${
              viewMode === 'seat'
                ? 'bg-panel text-teal shadow-xs'
                : 'text-ink3 hover:text-ink'
            }`}
          >
            <Armchair size={14} />
            <span>좌석배치도</span>
          </button>
        </div>
      </div>

      {/* ── 1. 비주얼 차트 뷰 (엑셀 원본 스타일 다이어그램) ── */}
      {viewMode === 'visual' && (
        <div className="mt-5">
          <VisualDiagramOrgChart org={org} validUsers={validUsers} validDepts={validDepts} onSelectUserId={setSelectedUserId} />
        </div>
      )}


      {/* ── 2. 비상연락망 뷰 (실제 데이터베이스 기반 표출) ── */}
      {viewMode === 'emergency' && (
        <div className="mt-5">
          <EmergencyContactView
            validUsers={validUsers}
            profileMap={profileMap}
            onSelectUserId={setSelectedUserId}
          />
        </div>
      )}


      {/* ── 3. 좌석배치도 뷰 ── */}
      {viewMode === 'seat' && (
        <div className="mt-5">
          <SeatLayoutView users={validUsers} onSelectUserId={setSelectedUserId} />
        </div>
      )}

      {selectedUserId && selectedUser && (
        <>
          <div
            onClick={() => setSelectedUserId(null)}
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-xs transition-opacity"
          />

          <div className="fixed inset-0 z-50 m-auto flex h-[460px] w-[700px] max-h-[calc(90vh/var(--font-scale,1))] max-w-[95vw] overflow-hidden rounded-3xl border border-border bg-panel text-left shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            {/* 좌측 프로필 카드 영역 */}
            <div className="flex w-[230px] shrink-0 select-none flex-col items-center justify-between border-r border-border bg-gradient-to-b from-teal-soft/10 to-panel-alt/5 p-6">
              <div className="mt-4 flex w-full flex-col items-center">
                <div className="grid h-20 w-20 place-items-center rounded-full border-2 border-panel bg-teal text-3xl font-black text-white shadow-md">
                  {selectedUser.name[0]}
                </div>

                <div className="mt-3.5 text-center text-base font-extrabold text-ink flex items-center justify-center gap-1.5 flex-wrap">
                  <span>{selectedUser.name}</span>
                  {(selectedProfile as any)?.engName && (
                    <span className="text-xs text-ink3 font-normal">
                      ({(selectedProfile as any).engName})
                    </span>
                  )}
                </div>
                <div className="mt-1 rounded border border-border bg-panel-alt px-2 py-0.5 font-mono text-[10px] font-bold text-ink2">
                  사번: {selectedUser.position.includes('대표') || selectedUser.dept === '대표이사' || selectedUser.dept.includes('위원회') ? '비공개' : (selectedUser.empNo ? `#${selectedUser.empNo}` : '-')}
                </div>

                <div className="mt-4 space-y-1 text-center">
                  <div className="text-xs font-bold text-teal">{selectedUser.dept}</div>
                  <div className="text-[11px] font-semibold text-ink3">
                    {selectedUser.position} {selectedUser.jobTitle && `· ${selectedUser.jobTitle}`}
                  </div>
                </div>
              </div>

              <div className="w-full rounded-xl border border-border/40 bg-panel-alt/20 py-2 text-center text-[10.5px] text-ink3 flex items-center justify-center gap-1">
                <Building2 size={12} className="text-ink3 shrink-0" />
                <span>{selectedUser.dept} · {selectedUser.position}</span>
              </div>
            </div>

            {/* 우측 상세정보 영역 */}
            <div className="flex flex-1 flex-col justify-between overflow-hidden bg-panel">
              <div className="flex shrink-0 items-center justify-between border-b border-border bg-panel-alt/5 p-3.5">
                <span className="text-[12px] font-extrabold text-ink">임직원 상세 정보</span>
                <button
                  type="button"
                  onClick={() => setSelectedUserId(null)}
                  className="rounded p-1 text-ink3 hover:bg-panel-alt hover:text-ink transition-colors"
                >
                  <X size={15} />
                </button>
              </div>

              <div className="flex-1 space-y-4 overflow-y-auto p-6 text-[12px]">
                <h2 className="flex items-center gap-1.5 border-b border-border pb-2 text-sm font-extrabold text-ink">
                  <Briefcase size={15} className="text-teal" />
                  <span>인사 및 소속 정보</span>
                </h2>

                <div className="grid grid-cols-2 gap-x-3.5 gap-y-4">
                  <div>
                    <span className="block text-[11px] text-ink3">성명</span>
                    <span className="mt-1 block font-semibold text-ink">{selectedUser.name}</span>
                  </div>

                  <div>
                    <span className="block text-[11px] text-ink3">소속 부서</span>
                    <span className="mt-1 block font-semibold text-ink">{selectedUser.dept}</span>
                  </div>

                  <div>
                    <span className="block text-[11px] text-ink3">직급 / 직책</span>
                    <span className="mt-1 block font-semibold text-ink">
                      {selectedUser.position} {selectedUser.jobTitle && `(${selectedUser.jobTitle})`}
                    </span>
                  </div>

                  <div>
                    <span className="block text-[11px] text-ink3">업무 이메일</span>
                    {selectedUser.position.includes('대표') || selectedUser.dept === '대표이사' || selectedUser.dept.includes('위원회') ? (
                      <span className="mt-1 block font-mono text-[11px] text-ink3 italic">비공개</span>
                    ) : (
                      <a
                        href={`mailto:${selectedUser.email}`}
                        className="mt-1 flex items-center gap-1 font-mono font-semibold text-teal hover:underline break-all"
                      >
                        <Mail size={12} className="shrink-0" />
                        <span>{selectedUser.email || '-'}</span>
                      </a>
                    )}
                  </div>

                  <div>
                    <span className="block text-[11px] text-ink3">업무 연락처</span>
                    {selectedUser.position.includes('대표') || selectedUser.dept === '대표이사' || selectedUser.dept.includes('위원회') ? (
                      <span className="mt-1 block font-mono text-[11px] text-ink3 italic">비공개</span>
                    ) : (
                      <span className="mt-1 flex items-center gap-1 font-mono font-semibold text-ink">
                        {selectedProfile?.phone ? (
                          <>
                            <Phone size={12} className="shrink-0 text-ink3" />
                            <span>{selectedProfile.phone}</span>
                          </>
                        ) : '—'}
                      </span>
                    )}
                  </div>

                  <div>
                    <span className="block text-[11px] text-ink3">계정 상태</span>
                    <span
                      className={`mt-1 inline-block rounded border px-1.5 py-0.5 text-[10px] font-bold ${
                        selectedUser.status === '사용'
                          ? 'border-teal/20 bg-teal-soft/20 text-teal'
                          : 'border-border bg-panel-alt text-ink3'
                      }`}
                    >
                      {selectedUser.status}
                    </span>
                  </div>

                  <div>
                    <span className="block text-[11px] text-ink3">직속 상급자</span>
                    <span className="mt-1 block font-semibold text-ink">
                      {(() => {
                        const mgr = org.directManagerOf(selectedUser.id);
                        if (!mgr) return '—';
                        return `${mgr.name} (${mgr.position || mgr.jobTitle || '부서장'})`;
                      })()}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex shrink-0 justify-end border-t border-border bg-panel-alt/10 p-4">
                <Button size="sm" onClick={() => setSelectedUserId(null)}>
                  닫기
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** ── 워크핏 공식 엑셀 조직도 스타일 비주얼 다이어그램 (실제 DB 데이터 동적 매핑) ── */
function VisualDiagramOrgChart({
  org,
  validUsers,
  validDepts,
  onSelectUserId,
}: {
  org: ReturnType<typeof useOrgTree>;
  validUsers: User[];
  validDepts: ReturnType<typeof useOrgTree>['depts'];
  onSelectUserId: (id: string) => void;
}) {
  // 1. 대표이사 / 최고경영진 (실제 DB에서 직급/부서 매칭)
  const ceoUser = validUsers.find((u) => u.position.includes('대표') || u.dept === '대표이사') ?? validUsers[0];

  // 2. 전체 부서별 소속 멤버 맵 (겸직자 포함)
  const deptMembersMap = useMemo(() => {
    const map = new Map<string, typeof org.roots[0]['members']>();
    const traverse = (node: typeof org.roots[0]) => {
      map.set(node.dept.name, node.members);
      node.children.forEach(traverse);
    };
    org.roots.forEach(traverse);
    return map;
  }, [org.roots]);

  // 부서원 정렬 헬퍼 (팀장/부서장 최우선 > 파트장/실장 > 직급 서열 > 이름순)
  const sortDeptMembers = (members: typeof org.roots[0]['members'], dept?: ReturnType<typeof useOrgTree>['depts'][0]) => {
    return [...members].sort((a, b) => {
      // 1. 부서장/팀장/소장 등 부서 리더 최우선
      const isALeader =
        (dept && dept.headUserId === a.id) ||
        a.jobTitle?.includes('팀장') ||
        a.jobTitle?.includes('부서장') ||
        a.jobTitle?.includes('소장') ||
        a.jobTitle?.includes('본부장') ||
        a.jobTitle?.includes('위원장');
      const isBLeader =
        (dept && dept.headUserId === b.id) ||
        b.jobTitle?.includes('팀장') ||
        b.jobTitle?.includes('부서장') ||
        b.jobTitle?.includes('소장') ||
        b.jobTitle?.includes('본부장') ||
        b.jobTitle?.includes('위원장');

      if (isALeader && !isBLeader) return -1;
      if (!isALeader && isBLeader) return 1;

      // 2. 파트장/실장 등 중간 관리자
      const isAMid = a.jobTitle?.includes('파트장') || a.jobTitle?.includes('실장');
      const isBMid = b.jobTitle?.includes('파트장') || b.jobTitle?.includes('실장');
      if (isAMid && !isBMid) return -1;
      if (!isAMid && isBMid) return 1;

      // 3. 직급 서열
      const rankDiff = org.rankOf(a.position) - org.rankOf(b.position);
      if (rankDiff !== 0) return rankDiff;

      // 4. 이름 가나다순
      return a.name.localeCompare(b.name, 'ko');
    });
  };

  // 위원회 멤버 전용 정렬 헬퍼 (1. 위원장/대표이사 -> 2. 부위원장 -> 3. 손승원 -> 4. 기타)
  const sortCommitteeMembers = (members: typeof org.roots[0]['members']) => {
    const getOrder = (m: typeof members[0]) => {
      const name = m.name || '';
      const pos = m.position || '';
      const duty = m.jobTitle || '';

      // 1순위: 위원장 (이름, 직급, 직책) 또는 대표이사
      if (
        name === '위원장' ||
        pos === '위원장' ||
        duty === '위원장' ||
        (!name.includes('부위원') && !pos.includes('부위원') && !duty.includes('부위원') && (
          name.includes('대표') || pos.includes('대표') || duty.includes('대표') || duty.includes('위원장')
        ))
      ) {
        return 1;
      }
      // 2순위: 부위원장 (이름, 직급, 직책)
      if (name.includes('부위원') || pos.includes('부위원') || duty.includes('부위원')) {
        return 2;
      }
      // 3순위: 손승원
      if (name.includes('손승원')) {
        return 3;
      }
      // 4순위: 기타 임원 및 직급 순
      return 10 + org.rankOf(m.position);
    };

    return [...members].sort((a, b) => getOrder(a) - getOrder(b) || a.name.localeCompare(b.name, 'ko'));
  };

  // 직속 부서 및 위원회 (대표이사 직속, 기술경영전략위원회, 경영기획팀 등)
  const committeeDept = validDepts.find((d) => d.name.includes('위원회'));
  const rawCommitteeMembers = deptMembersMap.get(committeeDept?.name ?? '') ?? [];
  const committeeMembers = useMemo(() => {
    const list = [...rawCommitteeMembers];
    const hasChairman = list.some(
      (m) => m.name === '위원장' || m.position === '위원장' || m.jobTitle === '위원장'
    );
    // 실제 위원장 계정이 없는 경우 조직도 상 표시를 위해 가상 위원장 엔트리 추가
    if (!hasChairman) {
      list.unshift({
        id: 'virtual-chairman',
        name: '위원장',
        position: '위원장',
        jobTitle: '위원장',
        dept: committeeDept?.name ?? '기술경영전략위원회',
        email: '',
        isConcurrent: false,
        status: '사용',
        isVirtual: true,
      } as any);
    }
    return sortCommitteeMembers(list);
  }, [rawCommitteeMembers, committeeDept?.name]);

  const labDept = validDepts.find((d) => d.name.includes('연구소'));
  const labMembers = sortDeptMembers(deptMembersMap.get(labDept?.name ?? '') ?? [], labDept);

  const planningDept = validDepts.find((d) => d.name.includes('경영기획'));
  const planningMembers = sortDeptMembers(deptMembersMap.get(planningDept?.name ?? '') ?? [], planningDept);

  // 3. 주력 본부 (AX지능화본부 또는 사업본부)
  const hqDept = validDepts.find((d) => d.name.includes('본부')) ?? validDepts[0];
  const hqHead = validUsers.find((u) => u.id === hqDept?.headUserId || (u.dept === hqDept?.name && u.jobTitle.includes('본부장'))) ?? null;

  // 4. 하위 팀 목록 (본부 산하 팀들 또는 일반 팀들)
  const teamDepts = validDepts.filter(
    (d) =>
      d.name !== '대표이사' &&
      d.name !== '대표이사 직속' &&
      !d.name.includes('위원회') &&
      !d.name.includes('연구소') &&
      !d.name.includes('경영기획') &&
      !d.name.includes('본부') &&
      !isExcludedDept(d.name),
  );

  return (
    <div className="rounded-2xl border border-border bg-panel p-6 shadow-sm overflow-x-auto">
      {/* 엑셀 차트 메타 헤더 */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
        <div className="flex items-center gap-2">
          <span className="text-base font-black text-ink tracking-tight">워크핏 조직도</span>
          <span className="rounded bg-teal-soft px-2 py-0.5 text-[10.5px] font-bold text-teal">공식 조직 체계</span>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-ink2">
          <div className="rounded border border-border bg-panel-alt px-2.5 py-1">
            <span className="text-ink3 mr-1.5 font-semibold">총원</span>
            <span className="font-extrabold text-teal">{validUsers.length}명</span>
          </div>
          <div className="rounded border border-border bg-panel-alt px-2.5 py-1">
            <span className="text-ink3 mr-1.5 font-semibold">부서수</span>
            <span className="font-mono font-bold text-ink">{validDepts.length}개</span>
          </div>
        </div>
      </div>

      {/* 엑셀 스타일 다이어그램 바디 (실제 DB 데이터 렌더링) */}
      <div className="min-w-[920px] flex flex-col items-center select-none">
        {/* 1. 최상위 대표이사 박스 (피치 핑크 #FCE4D6) */}
        {ceoUser && (
          <div className="flex flex-col items-center">
            <div className="overflow-hidden rounded-md border border-[#DFA89B] shadow-xs">
              <table className="border-collapse text-center text-[11px] font-bold">
                <tbody>
                  <tr className="bg-[#FCE4D6] text-slate-800">
                    {/* 실명이 별도로 등록된 경우: [대표이사] [성명] 2열 / 이름이 '대표이사'인 경우: [대표이사] 단독 표출 */}
                    {ceoUser.name && ceoUser.name !== '대표이사' && ceoUser.name !== ceoUser.position ? (
                      <>
                        <td className="border-r border-[#DFA89B] px-5 py-1.5 font-bold">
                          {ceoUser.position || '대표이사'}
                        </td>
                        <td
                          onClick={() => onSelectUserId(ceoUser.id)}
                          className="cursor-pointer px-6 py-1.5 text-slate-900 font-extrabold hover:bg-white/40 transition-colors"
                        >
                          {ceoUser.name}
                        </td>
                      </>
                    ) : (
                      <td
                        onClick={() => onSelectUserId(ceoUser.id)}
                        className="cursor-pointer px-8 py-1.5 text-slate-900 font-extrabold hover:bg-white/40 transition-colors"
                      >
                        대표이사
                      </td>
                    )}
                  </tr>
                </tbody>
              </table>
            </div>

            {/* 중앙 수직선 1 */}
            <div className="h-5 w-px bg-slate-400" />
          </div>
        )}

        {/* 2. 중앙 척추 섹션: 기술경영전략위원회 + 우측 분기(연구소, 기획팀) */}
        <div className="relative w-full max-w-[860px] flex flex-col items-center">
          {/* 기술경영전략위원회 박스 (그린 #E2EFDA, 직책칸 없이 '위원회 / 사용자명' 2열 표시) */}
          <div className="overflow-hidden rounded-md border border-[#A9D18E] shadow-xs">
            <div className="bg-[#E2EFDA] border-b border-[#A9D18E] py-1 px-6 text-center text-[11px] font-extrabold text-slate-800">
              {committeeDept?.name ?? '기술경영전략위원회'}
            </div>
            <table className="border-collapse text-center text-[10.5px]">
              <tbody className="divide-y divide-[#A9D18E]/60 bg-white/60 dark:bg-panel">
                {committeeMembers.length > 0 ? (
                  committeeMembers.map((m: any) => {
                    const isVirtual = m.isVirtual || m.id === 'virtual-chairman';
                    return (
                      <tr
                        key={m.id}
                        onClick={isVirtual ? undefined : () => onSelectUserId(m.id)}
                        className={isVirtual ? 'cursor-default select-none' : 'cursor-pointer hover:bg-teal-soft/30 transition-colors'}
                      >
                        <td className="border-r border-[#A9D18E] px-4 py-1 text-slate-700 font-medium">위원회</td>
                        <td className="px-5 py-1 font-bold text-slate-900">
                          <span>{m.name}</span>
                          {m.isConcurrent && !isVirtual && (
                            <span className="ml-1.5 rounded bg-slate-200 dark:bg-slate-700 px-1 py-0.2 text-[8.5px] font-bold text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-slate-600">
                              겸직
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={2} className="px-6 py-2 text-ink3 text-[10px] italic">
                      소속 인원 없음
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* 중앙 연결 척추선 & 우측 분기선 영역 */}
          <div className="relative w-full h-44 flex justify-center">
            {/* 중앙 수직 척추선 */}
            <div className="h-full w-px bg-slate-400" />

            {/* 우측 1차 분기선 ➔ 부설기술연구소 */}
            <div className="absolute top-6 left-1/2 w-28 h-px bg-slate-400" />
            <div className="absolute top-1 left-[calc(50%+112px)]">
              <div className="overflow-hidden rounded-md border border-[#A9D18E] shadow-xs">
                <div className="bg-[#E2EFDA] border-b border-[#A9D18E] py-0.5 px-3 text-center text-[10.5px] font-extrabold text-slate-800">
                  {labDept?.name ?? '부설기술연구소'} ({labMembers.length}명)
                </div>
                <table className="border-collapse text-center text-[10px]">
                  <tbody className="divide-y divide-[#A9D18E]/60 bg-white/60 dark:bg-panel">
                    {labMembers.length > 0 ? (
                      labMembers.map((m) => (
                        <tr
                          key={m.id}
                          onClick={() => onSelectUserId(m.id)}
                          className="cursor-pointer hover:bg-teal-soft/30 transition-colors"
                        >
                          <td className="border-r border-[#A9D18E] px-2.5 py-0.5 text-slate-700">{m.jobTitle || '연구원'}</td>
                          <td className="border-r border-[#A9D18E] px-2.5 py-0.5 text-slate-600">{m.position}</td>
                          <td className="px-3.5 py-0.5 font-bold text-slate-900">
                            <span>{m.name}</span>
                            {m.isConcurrent && (
                              <span className="ml-1 rounded bg-slate-200 dark:bg-slate-700 px-1 py-0.2 text-[8.5px] font-bold text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-slate-600">
                                겸직
                              </span>
                            )}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={3} className="px-4 py-1.5 text-ink3 text-[10px] italic">
                          소속 인원 없음
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 우측 2차 분기선 ➔ 경영기획팀 */}
            <div className="absolute top-28 left-1/2 w-28 h-px bg-slate-400" />
            <div className="absolute top-23 left-[calc(50%+112px)]">
              <div className="overflow-hidden rounded-md border border-[#A9D18E] shadow-xs">
                <div className="bg-[#E2EFDA] border-b border-[#A9D18E] py-0.5 px-3 text-center text-[10.5px] font-extrabold text-slate-800">
                  {planningDept?.name ?? '경영기획팀'} ({planningMembers.length}명)
                </div>
                <table className="border-collapse text-center text-[10px]">
                  <tbody className="divide-y divide-[#A9D18E]/60 bg-white/60 dark:bg-panel">
                    {planningMembers.length > 0 ? (
                      planningMembers.map((m) => (
                        <tr
                          key={m.id}
                          onClick={() => onSelectUserId(m.id)}
                          className="cursor-pointer hover:bg-teal-soft/30 transition-colors"
                        >
                          <td className="border-r border-[#A9D18E] px-2.5 py-0.5 text-slate-700">{m.jobTitle || '팀원'}</td>
                          <td className="border-r border-[#A9D18E] px-2.5 py-0.5 text-slate-600">{m.position}</td>
                          <td className="px-3.5 py-0.5 font-bold text-slate-900">
                            <span>{m.name}</span>
                            {m.isConcurrent && (
                              <span className="ml-1 rounded bg-slate-200 dark:bg-slate-700 px-1 py-0.2 text-[8.5px] font-bold text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-slate-600">
                                겸직
                              </span>
                            )}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={3} className="px-4 py-1.5 text-ink3 text-[10px] italic">
                          소속 인원 없음
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        {/* 3. AX지능화본부 헤더 박스 (스카이블루 #DDEBF7, 인원수 표시 제외) */}
        {hqDept && (
          <div className="flex flex-col items-center">
            <div className="overflow-hidden rounded-md border border-[#8EA9DB] shadow-xs">
              <div className="bg-[#DDEBF7] border-b border-[#8EA9DB] py-1 px-8 text-center text-[11px] font-extrabold text-slate-800">
                {hqDept.name}
              </div>
              {hqHead && (
                <table className="border-collapse text-center text-[10.5px]">
                  <tbody className="bg-white/60 dark:bg-panel">
                    <tr
                      onClick={() => onSelectUserId(hqHead.id)}
                      className="cursor-pointer hover:bg-teal-soft/30 transition-colors"
                    >
                      <td className="border-r border-[#8EA9DB] px-4 py-1 text-slate-700 font-semibold">{hqHead.jobTitle || '본부장'}</td>
                      <td className="border-r border-[#8EA9DB] px-4 py-1 text-slate-600">{hqHead.position}</td>
                      <td className="px-6 py-1 font-extrabold text-slate-900">{hqHead.name}</td>
                    </tr>
                  </tbody>
                </table>
              )}
            </div>

            {/* 본부 아래 수직 연결선 */}
            <div className="h-6 w-px bg-slate-400" />
          </div>
        )}

        {/* 4. 산하 팀들 수평 분기선 & 하위 팀 박스들 (실제 DB에 등록된 팀 목록) */}
        <div className="relative w-full max-w-[960px] pt-4">
          {/* 수평 분기선 */}
          {teamDepts.length > 1 && (
            <div className="absolute top-0 left-[11%] right-[11%] h-px bg-slate-400" />
          )}

          {/* 팀 목록 그리드 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5 items-start">
            {teamDepts.map((d) => {
              const teamMembers = sortDeptMembers(deptMembersMap.get(d.name) ?? [], d);

              return (
                <div key={d.id} className="flex flex-col items-center">
                  <div className="h-4 w-px bg-slate-400 -mt-4 mb-0" />
                  <div className="w-full overflow-hidden rounded-md border border-[#8EA9DB] shadow-xs">
                    <div className="bg-[#DDEBF7] border-b border-[#8EA9DB] py-1 px-1.5 text-center text-[10.5px] font-extrabold text-slate-800">
                      {d.name} ({teamMembers.length}명)
                    </div>
                    <table className="w-full border-collapse text-center text-[10px]">
                      <tbody className="divide-y divide-[#8EA9DB]/60 bg-white/60 dark:bg-panel">
                        {teamMembers.length > 0 ? (
                          teamMembers.map((m) => (
                            <tr
                              key={m.id}
                              onClick={() => onSelectUserId(m.id)}
                              className="cursor-pointer hover:bg-teal-soft/30 transition-colors"
                            >
                              <td className="border-r border-[#8EA9DB] py-1 text-slate-700">{m.jobTitle || '팀원'}</td>
                              <td className="border-r border-[#8EA9DB] py-1 text-slate-600">{m.position}</td>
                              <td className="py-1 font-bold text-slate-900">
                                <span>{m.name}</span>
                                {m.isConcurrent && (
                                  <span className="ml-1 rounded bg-slate-200 dark:bg-slate-700 px-1 py-0.2 text-[8.5px] font-bold text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-slate-600">
                                    겸직
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={3} className="py-2 text-ink3 italic">
                              소속 인원 없음
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/** ── 비상연락망 컴포넌트 (실제 Appwrite 데이터베이스 100% 기반) ── */
function EmergencyContactView({
  validUsers,
  profileMap,
  onSelectUserId,
}: {
  validUsers: User[];
  profileMap: Map<string, any>;
  onSelectUserId: (userId: string) => void;
}) {
  const [keyword, setKeyword] = useState('');
  const [copiedText, setCopiedText] = useState<string | null>(null);

  // 실제 Appwrite 데이터베이스의 임직원만을 부서 편제 및 직급 순서로 정렬
  const contactList = useMemo(() => {
    const deptRank = (dept: string) => {
      if (dept.includes('대표이사')) return 1;
      if (dept.includes('위원회')) return 2;
      if (dept.includes('경영기획')) return 3;
      if (dept.includes('본부')) return 4;
      if (dept.includes('연구소')) return 5;
      if (dept.includes('컨설팅')) return 6;
      if (dept.includes('PMO')) return 7;
      if (dept.includes('품질')) return 8;
      if (dept.includes('데이터') || dept.includes('개발')) return 9;
      return 50;
    };

    const isHead = (u: User) =>
      u.jobTitle?.includes('대표') ||
      u.jobTitle?.includes('본부장') ||
      u.jobTitle?.includes('위원장') ||
      u.jobTitle?.includes('소장') ||
      u.jobTitle?.includes('팀장') ||
      u.jobTitle?.includes('실장');

    const posRank = (position: string) => {
      if (position.includes('대표')) return 1;
      if (position.includes('부대표')) return 2;
      if (position.includes('총괄부사장')) return 3;
      if (position.includes('전무')) return 4;
      if (position.includes('상무')) return 5;
      if (position.includes('이사')) return 6;
      if (position.includes('소장')) return 7;
      if (position.includes('실장')) return 7;
      if (position.includes('부장')) return 8;
      if (position.includes('차장')) return 9;
      if (position.includes('과장')) return 10;
      if (position.includes('대리')) return 11;
      if (position.includes('주임')) return 12;
      if (position.includes('사원') || position.includes('연구원')) return 13;
      return 99;
    };

    const sorted = [...validUsers].sort((a, b) => {
      // 1. 부서 위계 순서
      const dA = deptRank(a.dept);
      const dB = deptRank(b.dept);
      if (dA !== dB) return dA - dB;

      // 2. 부서장(대표/팀장/본부장 등) 우선
      const hA = isHead(a) ? 0 : 1;
      const hB = isHead(b) ? 0 : 1;
      if (hA !== hB) return hA - hB;

      // 3. 직급 서열
      const pA = posRank(a.position);
      const pB = posRank(b.position);
      if (pA !== pB) return pA - pB;

      // 4. 사번 순
      if (a.empNo && b.empNo) return a.empNo.localeCompare(b.empNo);
      return a.name.localeCompare(b.name, 'ko');
    });

    return sorted.map((u, idx) => {
      const profile = profileMap.get(u.id);
      const isPrivate =
        u.position.includes('대표') ||
        u.dept === '대표이사' ||
        u.dept.includes('위원회') ||
        u.name === '대표이사';

      const phone = profile?.phone || (u as any).phone || '';
      const email = u.email || '';
      const engName = (profile as any)?.engName || (u as any).engName || '';

      return {
        userId: u.id,
        no: idx + 1,
        empNo: u.empNo || '—',
        name: u.name,
        engName: engName || '—',
        department: u.dept,
        position: u.position,
        duty: u.jobTitle || '',
        phone: isPrivate ? '' : phone,
        email: isPrivate ? '' : email,
        isTopLeader: idx === 0 || u.position.includes('대표') || u.dept === '대표이사',
      };
    });
  }, [validUsers, profileMap]);

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    if (!q) return contactList;
    return contactList.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.engName.toLowerCase().includes(q) ||
        c.empNo.toLowerCase().includes(q) ||
        c.department.toLowerCase().includes(q) ||
        c.position.toLowerCase().includes(q) ||
        c.duty.toLowerCase().includes(q) ||
        (c.phone && c.phone.includes(q)) ||
        (c.email && c.email.toLowerCase().includes(q)),
    );
  }, [contactList, keyword]);

  const handleCopy = (text: string, label: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedText(`${label} 복사됨!`);
    setTimeout(() => setCopiedText(null), 1800);
  };

  const handleExportCsv = () => {
    const headers = ['번호', '사번', '이름', '영문이름', '소속', '직급', '연락처', '전자메일'];
    const rows = filtered.map((c) => [
      c.no,
      `"${c.empNo}"`,
      c.name,
      c.engName,
      `"${c.department.replace(/"/g, '""')}"`,
      `"${c.position.replace(/"/g, '""')}"`,
      c.phone || '',
      c.email || '',
    ]);
    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `워크핏_비상연락망_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      {/* 툴바 & 검색 & 액션 */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-panel p-4 shadow-xs">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-teal-soft text-teal shadow-xs">
            <PhoneCall size={20} />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-ink">전사 공식 비상연락망</h2>
              <span className="rounded-full bg-teal/10 px-2 py-0.5 text-[11px] font-bold text-teal font-mono">
                실제 등록 임직원 {contactList.length}명
              </span>
            </div>
            <p className="text-[11.5px] text-ink3 mt-0.5">
              임직원을 클릭하면 상세 프로필 카드가 표시됩니다.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* 복사 안내 알림 토스트 */}
          {copiedText && (
            <span className="rounded-lg bg-teal px-2.5 py-1 text-[11px] font-bold text-white shadow-xs animate-in fade-in flex items-center gap-1">
              <Check size={12} /> {copiedText}
            </span>
          )}

          {/* 검색 입력창 */}
          <div className="relative">
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="이름, 부서, 직급, 연락처 검색..."
              className="h-9 w-60 rounded-xl border border-border bg-panel-alt/50 pl-3 pr-8 text-[12px] text-ink placeholder:text-ink3 outline-none focus:border-teal transition-colors"
            />
            {keyword && (
              <button
                type="button"
                onClick={() => setKeyword('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink3 hover:text-ink p-0.5"
              >
                <X size={13} />
              </button>
            )}
          </div>

          {/* CSV 내보내기 & 인쇄 */}
          <Button size="sm" variant="secondary" onClick={handleExportCsv}>
            <span className="flex items-center gap-1.5"><Download size={13} /> CSV 저장</span>
          </Button>
          <Button size="sm" variant="secondary" onClick={() => window.print()}>
            <span className="flex items-center gap-1.5"><Printer size={13} /> 인쇄</span>
          </Button>
        </div>
      </div>

      {/* ── 비상연락망 정통 표 (실제 Appwrite 데이터베이스 100% 반영) ── */}
      <div className="overflow-hidden rounded-2xl border border-border bg-panel shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-[12px]">
            <thead>
              <tr className="border-b-2 border-slate-300 bg-panel-alt/80 text-[11.5px] font-extrabold text-ink">
                <th className="py-3 px-3 text-center w-14">번호</th>
                <th className="py-3 px-3 text-center w-24">사번</th>
                <th className="py-3 px-3 w-36">이름</th>
                <th className="py-3 px-3 w-32">영문이름</th>
                <th className="py-3 px-4 min-w-[220px]">소속</th>
                <th className="py-3 px-3 w-28">직급</th>
                <th className="py-3 px-4 w-40">연락처</th>
                <th className="py-3 px-4 w-52">전자메일</th>
                <th className="py-3 px-3 text-center w-24">상세</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border font-medium">
              {filtered.map((item) => {
                return (
                  <tr
                    key={item.userId}
                    onClick={() => onSelectUserId(item.userId)}
                    className={`transition-colors cursor-pointer ${
                      item.isTopLeader
                        ? 'bg-panel-alt/30 hover:bg-teal-soft/25'
                        : 'hover:bg-teal-soft/15'
                    }`}
                  >
                    {/* 번호 (1번부터 순차 부여) */}
                    <td className="py-3 px-3 text-center font-mono text-[11.5px] text-ink3">
                      {item.no}
                    </td>

                    {/* 사번 */}
                    <td className="py-3 px-3 text-center font-mono text-[11.5px] font-semibold text-ink2">
                      {item.empNo}
                    </td>

                    {/* 이름 (프로필 아바타 없이 텍스트만 깔끔하게) */}
                    <td className="py-3 px-3">
                      <span className="font-bold text-ink group-hover:text-teal group-hover:underline">
                        {item.name}
                      </span>
                    </td>

                    {/* 영문이름 */}
                    <td className="py-3 px-3 font-sans text-ink3 text-[11px]">
                      {item.engName}
                    </td>

                    {/* 소속 부서 */}
                    <td className="py-3 px-4 text-ink">
                      {item.department.includes(' / ') ? (
                        <div className="space-y-0.5 leading-snug">
                          {item.department.split(' / ').map((dept: string, idx: number) => (
                            <div key={idx} className="flex items-center gap-1">
                              <span className="text-[10px] text-teal">▪</span>
                              <span className="font-semibold text-ink2">{dept}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span className="font-semibold text-ink2">{item.department}</span>
                      )}
                    </td>

                    {/* 직급 (및 직책) */}
                    <td className="py-3 px-3">
                      <div className="font-semibold text-ink">
                        <span>{item.position}</span>
                        {item.duty && item.duty !== item.position && (
                          <span className="ml-1 text-[11px] text-ink3 font-normal">
                            ({item.duty})
                          </span>
                        )}
                      </div>
                    </td>

                    {/* 연락처 */}
                    <td className="py-3 px-4 font-mono text-[11.5px]">
                      {item.phone ? (
                        <div className="flex items-center gap-1.5 group">
                          <a
                            href={`tel:${item.phone}`}
                            onClick={(e) => e.stopPropagation()}
                            className="text-teal font-bold hover:underline"
                            title="전화 걸기"
                          >
                            {item.phone}
                          </a>
                          <button
                            type="button"
                            onClick={(e) => handleCopy(item.phone, '전화번호', e)}
                            title="전화번호 복사"
                            className="opacity-0 group-hover:opacity-100 p-1 text-ink3 hover:text-ink transition-opacity"
                          >
                            <Copy size={12} />
                          </button>
                        </div>
                      ) : (
                        <span className="text-ink3 text-[11px] italic">비공개</span>
                      )}
                    </td>

                    {/* 전자메일 */}
                    <td className="py-3 px-4 font-mono text-[11.5px]">
                      {item.email ? (
                        <div className="flex items-center gap-1.5 group">
                          <a
                            href={`mailto:${item.email}`}
                            onClick={(e) => e.stopPropagation()}
                            className="text-ink2 hover:text-teal hover:underline"
                            title="이메일 작성"
                          >
                            {item.email}
                          </a>
                          <button
                            type="button"
                            onClick={(e) => handleCopy(item.email, '이메일', e)}
                            title="이메일 복사"
                            className="opacity-0 group-hover:opacity-100 p-1 text-ink3 hover:text-ink transition-opacity"
                          >
                            <Copy size={12} />
                          </button>
                        </div>
                      ) : (
                        <span className="text-ink3 text-[11px] italic">비공개</span>
                      )}
                    </td>

                    {/* 카드 상세 버튼 */}
                    <td className="py-3 px-3 text-center">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectUserId(item.userId);
                        }}
                        className="rounded-lg border border-border bg-panel-alt/60 px-2 py-1 text-[11px] font-bold text-ink2 hover:bg-teal hover:text-white hover:border-teal transition-all shadow-2xs"
                      >
                        상세 정보
                      </button>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-ink3">
                    등록된 실제 임직원 데이터가 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

