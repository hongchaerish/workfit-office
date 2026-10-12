import { useState, useMemo } from 'react';
import {
  BarChart3,
  PhoneCall,
  Search,
  Phone,
  Mail,
  X,
  Briefcase,
  Copy,
  Check,
  ChevronRight,
  Shield,
  Layers,
} from 'lucide-react';
import { useOrgTree } from '@/features/gw/useOrgTree';
import { useEmployeeProfiles } from '@/features/employeeProfile/useEmployeeProfiles';
import type { User } from '@/domain/user/schema';
import MobileCommonHeader from './MobileCommonHeader';

// 테스트 계정 숨김은 사람 목록 repo 가 접속자 기준으로 처리한다([[testAccountVisibility]]).

export default function MobileOrgChartScreen() {
  const org = useOrgTree();
  const { data: employeeProfiles = [] } = useEmployeeProfiles();
  const profileMap = useMemo(() => {
    return new Map(employeeProfiles.map((p) => [p.userId || p.id, p]));
  }, [employeeProfiles]);

  const [viewMode, setViewMode] = useState<'visual' | 'emergency'>('visual');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  // 유효 부서 및 유효 사용자 목록
  const validDepts = org.depts;
  const validUsers = useMemo(
    () => org.users.filter((u) => u.status === '사용'),
    [org.users],
  );

  const selectedUser = validUsers.find((u) => u.id === selectedUserId) || org.users.find((u) => u.id === selectedUserId);
  const selectedProfile = selectedUserId ? profileMap.get(selectedUserId) : null;

  return (
    <div className="flex h-full flex-col select-none overflow-hidden" style={{ background: '#f2f8fc' }}>
      <MobileCommonHeader
        title="조직도"
        subtitle={`${validDepts.length}개 부서 · 총 ${validUsers.length}명`}
      />

      {/* 1. 상단 2단 뷰 모드 탭 바 (비주얼 차트 / 비상연락망) */}
      <div className="flex items-center justify-between gap-1 border-b border-border/70 bg-white px-3 py-2 shrink-0 shadow-2xs">
        <div className="grid grid-cols-2 w-full gap-1 rounded-xl bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => setViewMode('visual')}
            className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-[12px] font-bold transition-all ${
              viewMode === 'visual'
                ? 'bg-white text-teal shadow-xs'
                : 'text-ink3 hover:text-ink'
            }`}
          >
            <BarChart3 size={14} />
            <span>비주얼 조직도</span>
          </button>

          <button
            type="button"
            onClick={() => setViewMode('emergency')}
            className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-[12px] font-bold transition-all ${
              viewMode === 'emergency'
                ? 'bg-white text-teal shadow-xs'
                : 'text-ink3 hover:text-ink'
            }`}
          >
            <PhoneCall size={14} />
            <span>비상연락망</span>
          </button>
        </div>
      </div>

      {/* 2. 메인 콘텐츠 영역 */}
      <div className="flex-1 overflow-y-auto">
        {/* 모드 1: 모바일 최적화 세로형 비주얼 다이어그램 */}
        {viewMode === 'visual' && (
          <VerticalVisualOrgChart
            org={org}
            validUsers={validUsers}
            validDepts={validDepts}
            onSelectUserId={setSelectedUserId}
          />
        )}

        {/* 모드 2: 비상연락망 */}
        {viewMode === 'emergency' && (
          <EmergencyContactMobileView
            validUsers={validUsers}
            profileMap={profileMap}
            onSelectUserId={setSelectedUserId}
          />
        )}
      </div>

      {/* 3. 임직원 상세 정보 바텀시트 / 모달 */}
      {selectedUserId && selectedUser && (
        <EmployeeDetailModal
          user={selectedUser}
          profile={selectedProfile}
          directManager={org.directManagerOf(selectedUser.id)}
          onClose={() => setSelectedUserId(null)}
        />
      )}
    </div>
  );
}

/** ── 모바일 세로형 비주얼 조직도 다이어그램 컴포넌트 ── */
function VerticalVisualOrgChart({
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
  // 1. 대표이사 (피치 핑크)
  const ceoUser = validUsers.find((u) => u.position.includes('대표') || u.dept === '대표이사') ?? validUsers[0];

  // 2. 부서별 소속 멤버 맵
  const deptMembersMap = useMemo(() => {
    const map = new Map<string, typeof org.roots[0]['members']>();
    const traverse = (node: typeof org.roots[0]) => {
      map.set(node.dept.name, node.members);
      node.children.forEach(traverse);
    };
    org.roots.forEach(traverse);
    return map;
  }, [org.roots]);

  // 부서원 정렬 헬퍼
  const sortDeptMembers = (members: typeof org.roots[0]['members'], dept?: ReturnType<typeof useOrgTree>['depts'][0]) => {
    return [...members].sort((a, b) => {
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

      const isAMid = a.jobTitle?.includes('파트장') || a.jobTitle?.includes('실장');
      const isBMid = b.jobTitle?.includes('파트장') || b.jobTitle?.includes('실장');
      if (isAMid && !isBMid) return -1;
      if (!isAMid && isBMid) return 1;

      const rankDiff = org.rankOf(a.position) - org.rankOf(b.position);
      if (rankDiff !== 0) return rankDiff;

      return a.name.localeCompare(b.name, 'ko');
    });
  };

  // 위원회 멤버 정렬
  const sortCommitteeMembers = (members: typeof org.roots[0]['members']) => {
    const getOrder = (m: typeof members[0]) => {
      const name = m.name || '';
      const pos = m.position || '';
      const duty = m.jobTitle || '';

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
      if (name.includes('부위원') || pos.includes('부위원') || duty.includes('부위원')) {
        return 2;
      }
      if (name.includes('손승원')) {
        return 3;
      }
      return 10 + org.rankOf(m.position);
    };

    return [...members].sort((a, b) => getOrder(a) - getOrder(b) || a.name.localeCompare(b.name, 'ko'));
  };

  // 대표이사 직속 기구
  const committeeDept = validDepts.find((d) => d.name.includes('위원회'));
  const rawCommitteeMembers = deptMembersMap.get(committeeDept?.name ?? '') ?? [];
  const committeeMembers = useMemo(() => {
    const list = [...rawCommitteeMembers];
    const hasChairman = list.some(
      (m) => m.name === '위원장' || m.position === '위원장' || m.jobTitle === '위원장'
    );
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

  // 주력 본부
  const hqDept = validDepts.find((d) => d.name.includes('본부')) ?? validDepts[0];
  const hqHead = validUsers.find((u) => u.id === hqDept?.headUserId || (u.dept === hqDept?.name && u.jobTitle.includes('본부장'))) ?? null;

  // 본부 산하 팀 목록
  const teamDepts = validDepts.filter(
    (d) =>
      d.name !== '대표이사' &&
      d.name !== '대표이사 직속' &&
      !d.name.includes('위원회') &&
      !d.name.includes('연구소') &&
      !d.name.includes('경영기획') &&
      !d.name.includes('본부'),
  );

  return (
    <div className="p-3.5 pb-12 space-y-0">
      {/* ── [1단계] 최상단 대표이사 (피치 핑크 #FCE4D6) ── */}
      {ceoUser && (
        <div className="flex flex-col items-center">
          <div className="w-full max-w-[340px] overflow-hidden rounded-xl border border-[#DFA89B] bg-white shadow-xs">
            <div className="bg-[#FCE4D6] px-3 py-1.5 border-b border-[#DFA89B] text-center">
              <span className="text-[12px] font-black text-slate-800 tracking-tight">
                {ceoUser.position || '대표이사'}
              </span>
            </div>
            <div
              onClick={() => onSelectUserId(ceoUser.id)}
              className="flex items-center justify-between p-3 cursor-pointer hover:bg-slate-50 active:scale-98 transition-all"
            >
              <div className="flex items-center gap-2.5">
                <div className="grid h-8 w-8 place-items-center rounded-lg bg-[#FCE4D6] text-slate-800 text-[12px] font-black border border-[#DFA89B]">
                  {ceoUser.name.slice(-2)}
                </div>
                <div>
                  <div className="text-[13px] font-extrabold text-slate-900">{ceoUser.name}</div>
                  <div className="text-[10.5px] text-ink3 font-medium">최고경영자 (CEO)</div>
                </div>
              </div>
              <ChevronRight size={16} className="text-ink3" />
            </div>
          </div>

          {/* 세로 연결선 1 */}
          <div className="h-6 w-0.5 bg-slate-300" />
        </div>
      )}

      {/* ── [2단계] 대표이사 직속 기구 & 위원회 섹션 (그린 #E2EFDA) ── */}
      <div className="relative rounded-2xl border border-[#A9D18E]/80 bg-white p-3.5 shadow-2xs">
        {/* 섹션 라벨 */}
        <div className="mb-3 flex items-center justify-between border-b border-[#A9D18E]/50 pb-2">
          <div className="flex items-center gap-1.5">
            <span className="grid h-6 w-6 place-items-center rounded-md bg-[#E2EFDA] text-slate-800">
              <Shield size={13} className="text-emerald-700" />
            </span>
            <span className="text-[12px] font-extrabold text-slate-800">직속 기구 & 전략위원회</span>
          </div>
          <span className="rounded bg-[#E2EFDA] px-2 py-0.5 text-[10px] font-bold text-slate-700 border border-[#A9D18E]">
            직속 체계
          </span>
        </div>

        {/* 직속 산하 3개 부서 세로 목록 (위원회, 연구소, 경영기획팀) */}
        <div className="space-y-3">
          {/* 1. 기술경영전략위원회 */}
          {committeeDept && (
            <div className="overflow-hidden rounded-xl border border-[#A9D18E] bg-white shadow-2xs">
              <div className="bg-[#E2EFDA] px-3 py-1.5 border-b border-[#A9D18E] flex items-center justify-between">
                <span className="text-[11.5px] font-bold text-slate-800">{committeeDept.name}</span>
                <span className="text-[10px] text-slate-600 font-semibold">{committeeMembers.length}명</span>
              </div>
              <div className="divide-y divide-[#A9D18E]/40">
                {committeeMembers.map((m: any) => {
                  const isVirtual = m.isVirtual || m.id === 'virtual-chairman';
                  return (
                    <div
                      key={m.id}
                      onClick={isVirtual ? undefined : () => onSelectUserId(m.id)}
                      className={`flex items-center justify-between px-3 py-2 ${
                        isVirtual ? 'cursor-default select-none' : 'hover:bg-slate-50 cursor-pointer active:scale-99 transition-all'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-slate-600 font-medium">위원</span>
                        <span className="text-[12px] font-extrabold text-slate-900">{m.name}</span>
                        {m.isConcurrent && !isVirtual && (
                          <span className="rounded bg-slate-100 px-1 py-0.2 text-[8.5px] font-bold text-slate-600 border border-slate-300">
                            겸직
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-ink3 font-medium">{m.position}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 2. 부설기술연구소 */}
          {labDept && (
            <div className="overflow-hidden rounded-xl border border-[#A9D18E] bg-white shadow-2xs">
              <div className="bg-[#E2EFDA] px-3 py-1.5 border-b border-[#A9D18E] flex items-center justify-between">
                <span className="text-[11.5px] font-bold text-slate-800">{labDept.name}</span>
                <span className="text-[10px] text-slate-600 font-semibold">{labMembers.length}명</span>
              </div>
              <div className="divide-y divide-[#A9D18E]/40">
                {labMembers.map((m) => (
                  <div
                    key={m.id}
                    onClick={() => onSelectUserId(m.id)}
                    className="flex items-center justify-between px-3 py-2 hover:bg-slate-50 cursor-pointer active:scale-99 transition-all"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-emerald-700 font-semibold">{m.jobTitle || '연구원'}</span>
                      <span className="text-[12px] font-extrabold text-slate-900">{m.name}</span>
                      {m.isConcurrent && (
                        <span className="rounded bg-slate-100 px-1 py-0.2 text-[8.5px] font-bold text-slate-600 border border-slate-300">
                          겸직
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] text-ink3 font-medium">{m.position}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 3. 경영기획팀 */}
          {planningDept && (
            <div className="overflow-hidden rounded-xl border border-[#A9D18E] bg-white shadow-2xs">
              <div className="bg-[#E2EFDA] px-3 py-1.5 border-b border-[#A9D18E] flex items-center justify-between">
                <span className="text-[11.5px] font-bold text-slate-800">{planningDept.name}</span>
                <span className="text-[10px] text-slate-600 font-semibold">{planningMembers.length}명</span>
              </div>
              <div className="divide-y divide-[#A9D18E]/40">
                {planningMembers.map((m) => (
                  <div
                    key={m.id}
                    onClick={() => onSelectUserId(m.id)}
                    className="flex items-center justify-between px-3 py-2 hover:bg-slate-50 cursor-pointer active:scale-99 transition-all"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-emerald-700 font-semibold">{m.jobTitle || '팀원'}</span>
                      <span className="text-[12px] font-extrabold text-slate-900">{m.name}</span>
                      {m.isConcurrent && (
                        <span className="rounded bg-slate-100 px-1 py-0.2 text-[8.5px] font-bold text-slate-600 border border-slate-300">
                          겸직
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] text-ink3 font-medium">{m.position}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 세로 연결선 2 */}
      <div className="flex justify-center">
        <div className="h-6 w-0.5 bg-slate-300" />
      </div>

      {/* ── [3단계] 주력 본부 (스카이블루 #DDEBF7, 테두리 #8EA9DB) ── */}
      {hqDept && (
        <div className="relative rounded-2xl border border-[#8EA9DB] bg-white p-3.5 shadow-2xs">
          {/* 본부 헤더 */}
          <div className="mb-3 flex items-center justify-between border-b border-[#8EA9DB]/50 pb-2">
            <div className="flex items-center gap-1.5">
              <span className="grid h-6 w-6 place-items-center rounded-md bg-[#DDEBF7] text-slate-800">
                <Layers size={13} className="text-blue-700" />
              </span>
              <span className="text-[13px] font-extrabold text-slate-800">{hqDept.name}</span>
            </div>
            <span className="rounded bg-[#DDEBF7] px-2 py-0.5 text-[10px] font-bold text-blue-800 border border-[#8EA9DB]">
              사업 총괄 본부
            </span>
          </div>

          {/* 본부장 카드 */}
          {hqHead && (
            <div
              onClick={() => onSelectUserId(hqHead.id)}
              className="mb-3 flex items-center justify-between rounded-xl bg-[#DDEBF7]/40 border border-[#8EA9DB] p-2.5 cursor-pointer hover:bg-[#DDEBF7]/70 active:scale-98 transition-all"
            >
              <div className="flex items-center gap-2">
                <span className="rounded bg-[#8EA9DB] px-1.5 py-0.5 text-[10px] font-bold text-white">
                  {hqHead.jobTitle || '본부장'}
                </span>
                <span className="text-[12.5px] font-extrabold text-slate-900">{hqHead.name}</span>
                <span className="text-[11px] text-ink3">({hqHead.position})</span>
              </div>
              <ChevronRight size={15} className="text-ink3" />
            </div>
          )}

          {/* 세로 트리 분기선 라벨 */}
          <div className="text-[11px] font-bold text-slate-600 mb-2 flex items-center gap-1">
            <span>산하 팀 편제 ({teamDepts.length}개 팀)</span>
          </div>

          {/* ── [4단계] 본부 산하 4개 팀 세로 트리 배치 ── */}
          <div className="space-y-2.5">
            {teamDepts.map((d) => {
              const teamMembers = sortDeptMembers(deptMembersMap.get(d.name) ?? [], d);

              return (
                <div
                  key={d.id}
                  className="overflow-hidden rounded-xl border border-[#8EA9DB]/80 bg-white shadow-2xs"
                >
                  {/* 팀 헤더 바 */}
                  <div className="bg-[#DDEBF7] px-3 py-1.5 border-b border-[#8EA9DB] flex items-center justify-between">
                    <span className="text-[11.5px] font-black text-slate-800">{d.name}</span>
                    <span className="text-[10px] text-blue-900 font-bold">{teamMembers.length}명</span>
                  </div>

                  {/* 팀원 목록 */}
                  <div className="divide-y divide-slate-100">
                    {teamMembers.length > 0 ? (
                      teamMembers.map((m) => (
                        <div
                          key={m.id}
                          onClick={() => onSelectUserId(m.id)}
                          className="flex items-center justify-between px-3 py-1.5 hover:bg-slate-50 cursor-pointer active:scale-99 transition-all"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-[10.5px] text-blue-700 font-semibold w-12 shrink-0">
                              {m.jobTitle || '팀원'}
                            </span>
                            <span className="text-[12px] font-bold text-slate-900">{m.name}</span>
                            {m.isConcurrent && (
                              <span className="rounded bg-slate-100 px-1 py-0.2 text-[8.5px] font-bold text-slate-600 border border-slate-300">
                                겸직
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] text-ink3 font-medium">{m.position}</span>
                        </div>
                      ))
                    ) : (
                      <div className="py-2.5 text-center text-[11px] text-ink3 italic">
                        소속 인원 없음
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/** ── 비상연락망 모바일 뷰 ── */
function EmergencyContactMobileView({
  validUsers,
  profileMap,
  onSelectUserId,
}: {
  validUsers: User[];
  profileMap: Map<string, any>;
  onSelectUserId: (id: string) => void;
}) {
  const [keyword, setKeyword] = useState('');

  const contactList = useMemo(() => {
    return validUsers
      .map((u) => {
        const profile = profileMap.get(u.id);
        const isPrivate =
          u.position.includes('대표') ||
          u.dept === '대표이사' ||
          u.dept.includes('위원회') ||
          u.name === '대표이사';
        const phone = isPrivate ? '' : (profile?.phone || (u as any).phone || '');
        const email = isPrivate ? '' : (u.email || '');

        return {
          id: u.id,
          name: u.name,
          dept: u.dept,
          position: u.position,
          jobTitle: u.jobTitle || '',
          empNo: u.empNo || '—',
          phone,
          email,
          isPrivate,
        };
      })
      .filter((u) => {
        if (!keyword.trim()) return true;
        const kw = keyword.trim().toLowerCase();
        return (
          u.name.toLowerCase().includes(kw) ||
          u.dept.toLowerCase().includes(kw) ||
          u.position.toLowerCase().includes(kw) ||
          u.phone.includes(kw)
        );
      });
  }, [validUsers, profileMap, keyword]);

  return (
    <div className="p-3 space-y-2.5">
      <div className="relative">
        <input
          type="text"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="성명, 부서, 전화번호 검색…"
          className="h-9 w-full rounded-xl border border-border bg-white px-3 pl-8.5 text-[12px] text-ink outline-none focus:border-teal placeholder:text-ink3 shadow-2xs"
        />
        <Search size={14} className="absolute left-2.5 top-2.5 text-ink3 pointer-events-none" />
      </div>

      <div className="space-y-2">
        {contactList.map((c) => (
          <div
            key={c.id}
            onClick={() => onSelectUserId(c.id)}
            className="flex items-center justify-between rounded-2xl border border-border/80 bg-white p-3 shadow-2xs cursor-pointer active:scale-98 transition-transform"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[13px] font-extrabold text-ink">{c.name}</span>
                <span className="text-[11px] font-semibold text-teal">{c.dept}</span>
                <span className="text-[10.5px] text-ink3">({c.position})</span>
              </div>
              <div className="mt-1 flex items-center gap-2 text-[11px] font-mono text-ink2">
                {c.phone ? (
                  <span className="flex items-center gap-1 text-slate-700">
                    <Phone size={11} className="text-teal" />
                    {c.phone}
                  </span>
                ) : (
                  <span className="text-ink3 italic">연락처 미등록</span>
                )}
              </div>
            </div>

            {c.phone && (
              <a
                href={`tel:${c.phone}`}
                onClick={(e) => e.stopPropagation()}
                className="grid h-8 w-8 place-items-center rounded-xl bg-teal text-white shadow-xs shrink-0"
              >
                <Phone size={14} />
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** ── 사원 상세 정보 바텀시트 / 모달 ── */
function EmployeeDetailModal({
  user,
  profile,
  directManager,
  onClose,
}: {
  user: User;
  profile: any;
  directManager?: User | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const isPrivate =
    user.position.includes('대표') ||
    user.dept === '대표이사' ||
    user.dept.includes('위원회') ||
    user.name === '대표이사';

  const phone = isPrivate ? '' : (profile?.phone || (user as any).phone || '');
  const email = isPrivate ? '' : (user.email || '');

  const handleCopyEmpNo = () => {
    if (!user.empNo) return;
    void navigator.clipboard.writeText(user.empNo);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      <div
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-xs transition-opacity animate-in fade-in"
      />
      <div className="fixed inset-x-0 bottom-0 z-50 max-h-[85vh] overflow-y-auto rounded-t-3xl border-t border-border bg-white p-5 shadow-2xl animate-in slide-in-from-bottom duration-200">
        {/* 헤더 */}
        <div className="flex items-center justify-between border-b border-border/60 pb-3">
          <div className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-teal-soft/40 text-teal">
              <Briefcase size={14} />
            </span>
            <span className="text-[13px] font-extrabold text-ink">임직원 상세 정보</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-ink3 hover:bg-slate-100 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* 프로필 카드 상단 */}
        <div className="mt-4 flex items-center gap-3.5 rounded-2xl bg-slate-50 p-4 border border-border/60">
          <div className="grid h-14 w-14 place-items-center rounded-2xl bg-teal text-xl font-black text-white shadow-sm shrink-0">
            {user.name.slice(-2)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="text-[16px] font-black text-ink">{user.name}</h3>
              {profile?.engName && (
                <span className="text-[11px] text-ink3 font-normal font-mono">({profile.engName})</span>
              )}
            </div>
            <div className="mt-0.5 text-[12px] font-bold text-teal">
              {user.dept} · {user.position} {user.jobTitle && `(${user.jobTitle})`}
            </div>
            {user.empNo && (
              <button
                type="button"
                onClick={handleCopyEmpNo}
                className="mt-1 flex items-center gap-1 text-[10px] text-ink3 font-mono hover:text-ink transition-colors"
              >
                <span>사번: #{user.empNo}</span>
                {copied ? <Check size={11} className="text-teal" /> : <Copy size={11} />}
              </button>
            )}
          </div>
        </div>

        {/* 상세 정보 표 */}
        <div className="mt-4 space-y-3 text-[12px]">
          <div className="grid grid-cols-2 gap-2.5">
            <div className="rounded-xl border border-border/60 bg-white p-3">
              <span className="text-[10.5px] text-ink3 block">소속 부서</span>
              <span className="mt-0.5 font-bold text-ink block">{user.dept}</span>
            </div>

            <div className="rounded-xl border border-border/60 bg-white p-3">
              <span className="text-[10.5px] text-ink3 block">직급 / 직책</span>
              <span className="mt-0.5 font-bold text-ink block">
                {user.position} {user.jobTitle && `· ${user.jobTitle}`}
              </span>
            </div>

            <div className="rounded-xl border border-border/60 bg-white p-3">
              <span className="text-[10.5px] text-ink3 block">직속 상급자</span>
              <span className="mt-0.5 font-bold text-ink block">
                {directManager ? `${directManager.name} (${directManager.position})` : '—'}
              </span>
            </div>

            <div className="rounded-xl border border-border/60 bg-white p-3">
              <span className="text-[10.5px] text-ink3 block">계정 상태</span>
              <span className="mt-0.5 inline-block font-bold text-teal">
                {user.status}
              </span>
            </div>
          </div>

          {/* 연락처 & 이메일 */}
          <div className="space-y-2 pt-1">
            <div className="flex items-center justify-between rounded-xl border border-border/70 bg-white p-3">
              <div className="flex items-center gap-2">
                <Phone size={14} className="text-teal" />
                <div>
                  <span className="text-[10px] text-ink3 block">전화번호</span>
                  <span className="font-mono font-bold text-ink text-[12.5px]">
                    {phone || (isPrivate ? '비공개' : '미등록')}
                  </span>
                </div>
              </div>
              {phone && (
                <a
                  href={`tel:${phone}`}
                  className="rounded-xl bg-teal px-3 py-1.5 text-[11px] font-bold text-white shadow-xs"
                >
                  통화하기
                </a>
              )}
            </div>

            <div className="flex items-center justify-between rounded-xl border border-border/70 bg-white p-3">
              <div className="flex items-center gap-2 min-w-0">
                <Mail size={14} className="text-teal shrink-0" />
                <div className="min-w-0">
                  <span className="text-[10px] text-ink3 block">이메일</span>
                  <span className="font-mono font-bold text-ink text-[12px] truncate block">
                    {email || (isPrivate ? '비공개' : '미등록')}
                  </span>
                </div>
              </div>
              {email && (
                <a
                  href={`mailto:${email}`}
                  className="rounded-xl bg-slate-100 px-3 py-1.5 text-[11px] font-bold text-slate-700 hover:bg-slate-200 shrink-0"
                >
                  메일쓰기
                </a>
              )}
            </div>
          </div>
        </div>

        {/* 닫기 버튼 */}
        <div className="mt-5">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-xl bg-slate-800 py-3 text-[13px] font-bold text-white shadow-sm"
          >
            닫기
          </button>
        </div>
      </div>
    </>
  );
}
