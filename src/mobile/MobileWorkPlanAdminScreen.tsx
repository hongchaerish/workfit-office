import { useState, useMemo } from 'react';
import {
  Search,
  CheckCircle2,
  Circle,
  Calendar,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useSecurityContext } from '@/features/auth/useSecurityContext';
import { useUsers } from '@/features/user/useUsers';
import { useAllWorkPlans } from '@/features/workPlan/useWorkPlans';
import {
  parseWorkPlanItems,
  calculatePlanProgress,
  getWorkPlanTagMeta,
} from '@/domain/workPlan/engine';
import { useWorkPlanConfig } from '@/features/workPlan/useWorkPlanConfig';
import { useAllUserPresences } from '@/features/userPresence/useUserPresence';
import { workPlanPolicy } from '@/domain/security/policy/workPlanPolicy';
import MobileCommonHeader from './MobileCommonHeader';
import { WorkPlanInlineText } from '@/modules/gw/task/components/WorkPlanInlineText';

const pad = (v: number) => String(v).padStart(2, '0');
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function MobileWorkPlanAdminScreen() {
  const securityContext = useSecurityContext();

  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date());
  const selectedDateStr = useMemo(() => formatDate(selectedDate), [selectedDate]);
  const [searchQuery, setSearchQuery] = useState('');

  const { tagMap } = useWorkPlanConfig();

  // 1. 시스템 활성 임직원 목록
  const usersQuery = useUsers();
  const allUsers = useMemo(() => {
    return (usersQuery.data ?? []).filter((u) => u.status === '사용' && !u.resignedAt);
  }, [usersQuery.data]);

  // 2. 열람 대상 — 업무계획은 전사 공통 열람(workPlanPolicy.canViewUser)
  const targetUsers = useMemo(() => {
    return allUsers.filter((u) => workPlanPolicy.canViewUser(securityContext, {
      id: u.id,
      dept: u.dept,
      position: u.position,
      isLeader: (u as any).isLeader || u.position?.includes('팀장') || u.position?.includes('부서장'),
    }));
  }, [allUsers, securityContext]);

  // 3. 전사 업무계획 쿼리
  const workPlansQuery = useAllWorkPlans(undefined, true);
  const allWorkPlans = workPlansQuery.data ?? [];
  const presenceMap = useAllUserPresences();

  // 4. 선택 일자의 사원별 업무계획 매핑
  const rosterPlans = useMemo(() => {
    const planByUserId = new Map<string, typeof allWorkPlans[0]>();
    allWorkPlans
      .filter((p) => p.date === selectedDateStr)
      .forEach((p) => planByUserId.set(p.ownerUserId, p));

    return targetUsers.map((u) => {
      const plan = planByUserId.get(u.id);
      const items = plan ? parseWorkPlanItems(plan.content) : [];
      const progress = plan ? calculatePlanProgress(plan.content) : null;
      const userPresence = presenceMap[u.id];

      return {
        userId: u.id,
        name: u.name,
        dept: u.dept,
        position: u.position,
        plan,
        items,
        progress,
        hasPlan: !!plan && items.length > 0,
        presenceStatus: userPresence?.status ?? 'OFFLINE',
      };
    });
  }, [targetUsers, allWorkPlans, selectedDateStr, presenceMap]);

  // 5. 검색 필터
  const filteredRoster = useMemo(() => {
    const kw = searchQuery.trim().toLowerCase();
    if (!kw) return rosterPlans;
    return rosterPlans.filter(
      (p) =>
        p.name.toLowerCase().includes(kw) ||
        p.dept.toLowerCase().includes(kw) ||
        p.position.toLowerCase().includes(kw)
    );
  }, [rosterPlans, searchQuery]);

  // 진행률 요약
  const summary = useMemo(() => {
    let completedCount = 0;
    let inProgressCount = 0;
    let notStartedCount = 0;

    rosterPlans.forEach((p) => {
      if (!p.hasPlan || !p.progress) notStartedCount++;
      else if (p.progress.percent === 100) completedCount++;
      else inProgressCount++;
    });

    return { total: rosterPlans.length, completedCount, inProgressCount, notStartedCount };
  }, [rosterPlans]);

  const handleMoveDay = (amount: number) => {
    setSelectedDate((prev) => {
      const d = new Date(prev);
      d.setDate(d.getDate() + amount);
      return d;
    });
  };

  const dayWeekday = WEEKDAYS[selectedDate.getDay()];

  return (
    <div className="flex h-full flex-col select-none overflow-hidden" style={{ background: '#f2f8fc' }}>
      <MobileCommonHeader
        title="업무계획 종합 현황"
        subtitle="전사 임직원 업무계획(To-Do) 모니터링"
      />

      {/* 1. 일자 선택 네비게이터 */}
      <div className="flex items-center justify-between px-4 py-2 bg-white/90 border-b border-border/60 shrink-0">
        <button
          type="button"
          onClick={() => handleMoveDay(-1)}
          className="grid h-7 w-7 place-items-center rounded-lg border border-border bg-white text-ink2 hover:bg-panel-alt active:scale-95 transition-all"
        >
          <ChevronLeft size={16} />
        </button>
        <div className="flex items-center gap-1.5">
          <Calendar size={14} className="text-teal" />
          <span className="text-[13px] font-black text-ink font-mono">
            {selectedDateStr} ({dayWeekday})
          </span>
          {selectedDateStr === formatDate(new Date()) && (
            <span className="rounded bg-teal/15 px-1.5 py-0.2 text-[9.5px] font-bold text-teal">
              오늘
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => handleMoveDay(1)}
          className="grid h-7 w-7 place-items-center rounded-lg border border-border bg-white text-ink2 hover:bg-panel-alt active:scale-95 transition-all"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {/* 2. 요약 배지 바 */}
      <div className="grid grid-cols-3 gap-1.5 px-4 py-2.5 bg-white border-b border-border/50 shrink-0 text-center">
        <div className="rounded-xl bg-emerald-500/10 p-2 border border-emerald-500/20">
          <span className="text-[10px] text-emerald-700 block font-bold">100% 완료</span>
          <span className="text-[14px] font-black text-emerald-600">{summary.completedCount}명</span>
        </div>
        <div className="rounded-xl bg-blue-500/10 p-2 border border-blue-500/20">
          <span className="text-[10px] text-blue-700 block font-bold">진행 중</span>
          <span className="text-[14px] font-black text-blue-600">{summary.inProgressCount}명</span>
        </div>
        <div className="rounded-xl bg-panel-alt/60 p-2">
          <span className="text-[10px] text-ink3 block">계획 미등록</span>
          <span className="text-[14px] font-black text-ink3">{summary.notStartedCount}명</span>
        </div>
      </div>

      {/* 3. 검색창 */}
      <div className="px-4 py-2 bg-white/50 border-b border-border/40 shrink-0">
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

      {/* 4. 사원별 업무계획 카드 리스트 */}
      <div className="flex-1 overflow-y-auto px-4 py-2.5 space-y-2.5">
        {filteredRoster.length === 0 ? (
          <div className="py-12 text-center text-[12px] text-ink3">
            해당 조건에 부합하는 사원이 없습니다.
          </div>
        ) : (
          filteredRoster.map((item) => (
            <div
              key={item.userId}
              className="rounded-2xl border border-border/80 bg-white p-3.5 shadow-2xs space-y-2.5"
            >
              {/* 사원 정보 헤더 & 진척률 */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="grid h-8 w-8 place-items-center rounded-xl bg-panel-alt text-[12px] font-bold text-ink">
                    {item.name.slice(-2)}
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[13px] font-bold text-ink">{item.name}</span>
                      <span className="text-[11px] text-ink3">{item.position}</span>
                      <span className="rounded bg-panel-alt px-1.5 py-0.2 text-[9px] text-ink2">
                        {item.dept}
                      </span>
                    </div>
                  </div>
                </div>

                {item.hasPlan && item.progress && (
                  <div className="flex items-center gap-1.5 text-right">
                    <span className="text-[10px] text-ink3">
                      {item.progress.completed}/{item.progress.total}
                    </span>
                    <span
                      className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
                        item.progress.percent === 100
                          ? 'bg-emerald-500 text-white'
                          : 'bg-teal/15 text-teal'
                      }`}
                    >
                      {item.progress.percent}%
                    </span>
                  </div>
                )}
              </div>

              {/* To-Do 목록 리스트 */}
              {item.hasPlan ? (
                <div className="space-y-1.5 pt-1 border-t border-border/40">
                  {item.items.map((it) => {
                    const tagMeta = it.tag ? getWorkPlanTagMeta(it.tag, tagMap) : null;
                    return (
                      <div
                        key={it.id}
                        className="flex items-start gap-2 rounded-lg bg-panel-alt/40 px-2.5 py-1.5 text-[11px]"
                      >
                        <div className="mt-0.5 shrink-0">
                          {it.completed ? (
                            <CheckCircle2 size={13} className="text-emerald-600" />
                          ) : (
                            <Circle size={13} className="text-ink3" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <span
                            className={
                              it.completed
                                ? 'text-ink3 line-through'
                                : 'text-ink font-medium'
                            }
                          >
                            <WorkPlanInlineText text={it.text} />
                          </span>
                          {tagMeta && (
                            <span
                              className={`ml-1.5 rounded px-1.5 py-0.2 text-[9px] font-bold ${tagMeta.badgeClass}`}
                            >
                              {tagMeta.tag}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="py-2 text-center text-[10.5px] text-ink3 border-t border-border/40">
                  등록된 업무계획이 없습니다.
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
