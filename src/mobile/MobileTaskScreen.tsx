import { useState, useMemo } from 'react';
import {
  CheckSquare,
  Square,
  Plus,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Trash2,
  Users,
  User as UserIcon,
} from 'lucide-react';
import { useAuth } from '@/app/auth/AuthProvider';
import { usePermission } from '@/features/auth/usePermission';
import { useOrgTree } from '@/features/gw/useOrgTree';
import { useUsers } from '@/features/user/useUsers';
import {
  useMyWorkPlans,
  useAllWorkPlans,
  useCreateWorkPlan,
  useUpdateWorkPlan,
} from '@/features/workPlan/useWorkPlans';
import {
  parseWorkPlanItems,
  calculatePlanProgress,
  toggleWorkPlanItem,
  removeWorkPlanItem,
  getWorkPlanTagMeta,
} from '@/domain/workPlan/engine';
import { useWorkPlanConfig } from '@/features/workPlan/useWorkPlanConfig';
import { resolveWorkPlanScope, canViewWorkPlan } from '@/features/auth/scopeHelper';
import MobileCommonHeader from './MobileCommonHeader';

const pad = (n: number) => String(n).padStart(2, '0');
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function MobileTaskScreen() {
  const { user } = useAuth();
  const { userRoles } = usePermission();
  const org = useOrgTree();
  const usersQuery = useUsers();
  const { tagMap } = useWorkPlanConfig();

  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date());
  const selectedDateStr = useMemo(() => formatDate(selectedDate), [selectedDate]);

  const [newTodoText, setNewTodoText] = useState('');
  const [selectedTag, setSelectedTag] = useState('');
  const [teamInputText, setTeamInputText] = useState<Record<string, string>>({});
  const [deptFilter, setDeptFilter] = useState<string>('all');

  const workActor = useMemo(
    () => ({ userId: user?.id ?? '__anonymous__', active: user?.status === '사용' }),
    [user],
  );

  // 1. 내 업무계획 쿼리
  const myWorkPlansQuery = useMyWorkPlans(workActor);
  const myWorkPlans = myWorkPlansQuery.data ?? [];

  const createPlan = useCreateWorkPlan();
  const updatePlan = useUpdateWorkPlan();

  // 선택 날짜의 내 업무계획
  const myTodayPlan = useMemo(() => {
    return myWorkPlans.find((p) => p.date === selectedDateStr);
  }, [myWorkPlans, selectedDateStr]);

  const myRawContent = myTodayPlan?.content ?? '';
  const myParsedItems = useMemo(() => parseWorkPlanItems(myRawContent), [myRawContent]);
  const myProgress = useMemo(() => calculatePlanProgress(myRawContent), [myRawContent]);

  // 2. 팀원 목록 및 팀원 업무계획 쿼리
  const allUsers = useMemo(() => {
    return (usersQuery.data ?? []).filter((u) => u.status === '사용' && !u.resignedAt);
  }, [usersQuery.data]);

  const actorScope = useMemo(() => {
    return resolveWorkPlanScope(user, userRoles, org);
  }, [user, userRoles, org]);

  // 정책상 열람 가능한 팀원 목록 (본인 제외, 같은 부서/팀원 등)
  const teamMembers = useMemo(() => {
    if (!user) return [];
    return allUsers
      .filter((u) => u.id !== user.id)
      .filter((u) => canViewWorkPlan(user, u, actorScope, org))
      .sort((a, b) => {
        const rankDiff = org.rankOf(a.position) - org.rankOf(b.position);
        if (rankDiff !== 0) return rankDiff;
        return a.name.localeCompare(b.name, 'ko');
      });
  }, [allUsers, user, actorScope, org]);

  // 해당 날짜 전체 업무계획 쿼리 (팀원들의 계획 포함)
  const allPlansQuery = useAllWorkPlans(
    { from: selectedDateStr, to: selectedDateStr },
    teamMembers.length > 0,
  );
  const teamPlans = allPlansQuery.data ?? [];

  // 사용자 ID -> 오늘 날짜의 업무계획 맵
  const teamPlansMap = useMemo(() => {
    const map = new Map<string, typeof teamPlans[0]>();
    teamPlans.forEach((plan) => {
      if (plan.date === selectedDateStr) {
        map.set(plan.ownerUserId, plan);
      }
    });
    return map;
  }, [teamPlans, selectedDateStr]);

  // ── 내 업무 To-Do 완료 토글 ──
  const handleToggleMyTodo = async (idx: number) => {
    const nextContent = toggleWorkPlanItem(myRawContent, idx);
    if (myTodayPlan) {
      await updatePlan.mutateAsync({
        actor: workActor,
        id: myTodayPlan.id,
        draft: { date: myTodayPlan.date, content: nextContent },
      });
    } else {
      await createPlan.mutateAsync({
        actor: workActor,
        draft: { date: selectedDateStr, content: nextContent },
      });
    }
  };

  // ── 내 업무 To-Do 삭제 ──
  const handleRemoveMyTodo = async (idx: number) => {
    const nextContent = removeWorkPlanItem(myRawContent, idx);
    if (myTodayPlan) {
      await updatePlan.mutateAsync({
        actor: workActor,
        id: myTodayPlan.id,
        draft: { date: myTodayPlan.date, content: nextContent },
      });
    }
  };

  // ── 내 업무 신규 To-Do 추가 ──
  const handleAddMyTodo = async () => {
    const text = newTodoText.trim();
    if (!text) return;

    const tagPart = selectedTag ? `[${selectedTag}] ` : '';
    const newLine = `- [ ] ${tagPart}${text}`;
    const nextContent = myRawContent.trim() ? `${myRawContent.trim()}\n${newLine}` : newLine;

    if (myTodayPlan) {
      await updatePlan.mutateAsync({
        actor: workActor,
        id: myTodayPlan.id,
        draft: { date: myTodayPlan.date, content: nextContent },
      });
    } else {
      await createPlan.mutateAsync({
        actor: workActor,
        draft: { date: selectedDateStr, content: nextContent },
      });
    }

    setNewTodoText('');
  };

  // 고유 부서 목록
  const deptList = useMemo(() => {
    const s = new Set<string>();
    teamMembers.forEach((m) => {
      if (m.dept && !m.dept.includes('테스트')) s.add(m.dept);
    });
    return Array.from(s).sort((a, b) => a.localeCompare(b, 'ko'));
  }, [teamMembers]);

  // 부서 필터가 적용된 대상 멤버 목록
  const displayedMembers = useMemo(() => {
    if (deptFilter === 'all') return teamMembers;
    return teamMembers.filter((m) => m.dept === deptFilter);
  }, [teamMembers, deptFilter]);

  // ── 팀원 업무 To-Do 완료 토글 ──
  const handleToggleTeamTodo = async (member: (typeof teamMembers)[0], idx: number) => {
    const plan = teamPlansMap.get(member.id);
    if (!plan) return;
    const nextContent = toggleWorkPlanItem(plan.content, idx);
    await updatePlan.mutateAsync({
      actor: workActor,
      id: plan.id,
      draft: { date: plan.date, content: nextContent },
    });
  };

  // ── 팀원 업무 To-Do 삭제 ──
  const handleRemoveTeamTodo = async (member: (typeof teamMembers)[0], idx: number) => {
    const plan = teamPlansMap.get(member.id);
    if (!plan) return;
    const nextContent = removeWorkPlanItem(plan.content, idx);
    await updatePlan.mutateAsync({
      actor: workActor,
      id: plan.id,
      draft: { date: plan.date, content: nextContent },
    });
  };

  // ── 팀원 업무 신규 To-Do 추가 ──
  const handleAddTeamTodo = async (member: (typeof teamMembers)[0]) => {
    const text = (teamInputText[member.id] || '').trim();
    if (!text) return;

    const plan = teamPlansMap.get(member.id);
    const currentContent = plan?.content ?? '';
    const newLine = `- [ ] ${text}`;
    const nextContent = currentContent.trim() ? `${currentContent.trim()}\n${newLine}` : newLine;

    if (plan) {
      await updatePlan.mutateAsync({
        actor: workActor,
        id: plan.id,
        draft: { date: plan.date, content: nextContent },
      });
    } else {
      await createPlan.mutateAsync({
        actor: workActor,
        draft: { date: selectedDateStr, content: nextContent, ownerUserId: member.id },
      });
    }

    setTeamInputText((prev) => ({ ...prev, [member.id]: '' }));
  };

  // ── 날짜 이동 핸들러 ──
  const handlePrevDay = () => {
    setSelectedDate((prev) => {
      const d = new Date(prev);
      d.setDate(d.getDate() - 1);
      return d;
    });
  };

  const handleNextDay = () => {
    setSelectedDate((prev) => {
      const d = new Date(prev);
      d.setDate(d.getDate() + 1);
      return d;
    });
  };

  const handleToday = () => {
    setSelectedDate(new Date());
  };

  const dateTitle = useMemo(() => {
    const y = selectedDate.getFullYear();
    const m = selectedDate.getMonth() + 1;
    const d = selectedDate.getDate();
    const day = WEEKDAYS[selectedDate.getDay()];
    return `${y}년 ${m}월 ${d}일 (${day})`;
  }, [selectedDate]);

  return (
    <div className="flex h-full flex-col select-none overflow-hidden" style={{ background: '#f2f8fc' }}>
      <MobileCommonHeader title="업무계획" subtitle={dateTitle} />

      {/* 1. 상단 날짜 이동 툴바 */}
      <div className="flex items-center justify-between border-b border-border/70 bg-white px-3 py-2 shadow-2xs shrink-0">
        <button
          type="button"
          onClick={handlePrevDay}
          className="grid h-8 w-8 place-items-center rounded-xl hover:bg-panel-alt transition-colors text-ink2"
          title="이전 날"
        >
          <ChevronLeft size={18} />
        </button>

        <button
          type="button"
          onClick={handleToday}
          className="text-[13px] font-bold text-ink hover:text-teal transition-colors flex items-center gap-1.5"
        >
          <Calendar size={14} className="text-teal" />
          <span>{dateTitle}</span>
        </button>

        <button
          type="button"
          onClick={handleNextDay}
          className="grid h-8 w-8 place-items-center rounded-xl hover:bg-panel-alt transition-colors text-ink2"
          title="다음 날"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      {/* 2. 전체 스크롤 본문: 최상단 내 업무 편집 + 그 아래 팀원 업무 계획 */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-4">
        {/* ── [섹션 1: 최상단 내 업무 계획 편집 & 추가] ── */}
        <div className="rounded-2xl border border-teal/40 bg-white p-4 shadow-xs space-y-3">
          {/* 내 업무 헤더 & 달성률 */}
          <div className="flex items-center justify-between border-b border-border/50 pb-2.5">
            <div className="flex items-center gap-1.5">
              <span className="grid h-6 w-6 place-items-center rounded-lg bg-teal-soft/40 text-teal">
                <CheckSquare size={14} />
              </span>
              <span className="text-[13px] font-black text-ink">내 업무 계획</span>
              <span className="rounded bg-teal-soft/30 px-1.5 py-0.2 text-[10px] font-bold text-teal">
                {user?.dept || '내 부서'}
              </span>
            </div>

            {myProgress && myProgress.total > 0 && (
              <span className="text-[11px] font-extrabold text-teal">
                {myProgress.completed}/{myProgress.total}건 ({myProgress.percent}%)
              </span>
            )}
          </div>

          {/* 진행률 바 */}
          {myProgress && myProgress.total > 0 && (
            <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
              <div
                className="h-full rounded-full bg-teal transition-all duration-300"
                style={{ width: `${myProgress.percent}%` }}
              />
            </div>
          )}

          {/* 신규 할 일 추가 입력 폼 */}
          <div className="rounded-xl bg-slate-50 p-2.5 border border-border/60 space-y-2">
            {/* 태그 선택 칩 */}
            <div className="flex items-center gap-1 overflow-x-auto pb-0.5 no-scrollbar">
              {['회의', '미팅', '보고', '집중', '마감', '외근'].map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setSelectedTag(selectedTag === t ? '' : t)}
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold transition-all shrink-0 ${
                    selectedTag === t
                      ? 'bg-teal text-white shadow-2xs'
                      : 'bg-white text-ink3 border border-border/80 hover:border-teal'
                  }`}
                >
                  +{t}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={newTodoText}
                onChange={(e) => setNewTodoText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddMyTodo();
                  }
                }}
                placeholder="오늘의 할 일 추가 (Enter 또는 +)"
                className="flex-1 rounded-xl border border-border bg-white px-3 py-2 text-[12px] text-ink outline-none focus:border-teal placeholder:text-ink3 shadow-2xs"
              />

              <button
                type="button"
                onClick={handleAddMyTodo}
                disabled={!newTodoText.trim()}
                className="grid h-8.5 w-8.5 place-items-center rounded-xl bg-teal text-white shadow-2xs hover:opacity-90 disabled:opacity-40 active:scale-95 transition-all shrink-0"
              >
                <Plus size={18} strokeWidth={2.2} />
              </button>
            </div>
          </div>

          {/* 내 To-Do 항목 목록 */}
          <div className="space-y-1.5 pt-1">
            {myParsedItems.length === 0 ? (
              <div className="py-4 text-center text-ink3 text-[11.5px] italic">
                등록된 할 일이 없습니다. 위 입력창에서 추가해보세요.
              </div>
            ) : (
              myParsedItems.map((item, idx) => {
                const tagMeta = item.tag ? getWorkPlanTagMeta(item.tag, tagMap) : null;
                return (
                  <div
                    key={idx}
                    className="flex items-center justify-between gap-2 rounded-xl bg-slate-50/70 p-2.5 border border-border/60 hover:bg-slate-50 transition-colors"
                  >
                    <div
                      onClick={() => handleToggleMyTodo(idx)}
                      className="flex items-center gap-2.5 min-w-0 flex-1 cursor-pointer"
                    >
                      <button
                        type="button"
                        className={`grid h-5 w-5 shrink-0 place-items-center rounded-lg border transition-all ${
                          item.completed
                            ? 'border-teal bg-teal text-white shadow-2xs'
                            : 'border-border-hi bg-white hover:border-teal'
                        }`}
                      >
                        {item.completed ? (
                          <CheckSquare size={13} strokeWidth={2.5} />
                        ) : (
                          <Square size={13} className="text-slate-300" />
                        )}
                      </button>

                      {tagMeta && (
                        <span
                          className={`shrink-0 rounded px-1.5 py-0.2 text-[9.5px] font-bold ${tagMeta.badgeClass}`}
                        >
                          {item.tag}
                        </span>
                      )}

                      <span
                        className={`text-[12px] font-medium truncate ${
                          item.completed ? 'line-through text-ink3' : 'text-ink'
                        }`}
                      >
                        {item.text}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleRemoveMyTodo(idx)}
                      className="p-1 text-ink3 hover:text-rose-500 transition-colors shrink-0"
                      title="삭제"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ── [섹션 2: 팀원들의 업무 계획 (To-Do 현황 & 자유 편집)] ── */}
        <div className="space-y-3">
          {/* 팀 섹션 헤더 */}
          <div className="flex items-center justify-between px-0.5">
            <div className="flex items-center gap-1.5">
              <span className="grid h-6 w-6 place-items-center rounded-lg bg-indigo-500/10 text-indigo-600">
                <Users size={14} />
              </span>
              <span className="text-[13px] font-black text-ink">팀 업무 현황</span>
              <span className="rounded-full bg-slate-200 px-2 py-0.2 text-[10px] font-bold text-slate-700">
                {displayedMembers.length}명
              </span>
            </div>

            {deptList.length > 1 && (
              <select
                value={deptFilter}
                onChange={(e) => setDeptFilter(e.target.value)}
                className="rounded-lg border border-border bg-white px-2 py-1 text-[11px] font-bold text-ink outline-none shadow-2xs"
              >
                <option value="all">전체 부서 ({teamMembers.length}명)</option>
                {deptList.map((d) => (
                  <option key={d} value={d}>
                    {d} ({teamMembers.filter((m) => m.dept === d).length}명)
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* 팀원 카드 목록 */}
          {displayedMembers.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/80 bg-white/70 p-8 text-center text-ink3">
              <UserIcon size={24} className="mx-auto mb-1 text-ink3/40" />
              <p className="text-[12px] font-bold text-ink">표시할 팀원이 없습니다.</p>
            </div>
          ) : (
            displayedMembers.map((member) => {
              const plan = teamPlansMap.get(member.id);
              const raw = plan?.content ?? '';
              const items = parseWorkPlanItems(raw);
              const progress = calculatePlanProgress(raw);

              return (
                <div
                  key={member.id}
                  className="rounded-2xl border border-border/80 bg-white p-3.5 shadow-2xs space-y-2.5"
                >
                  {/* 팀원 프로필 & 달성률 */}
                  <div className="flex items-center justify-between border-b border-border/50 pb-2">
                    <div className="flex items-center gap-2">
                      <div className="grid h-7 w-7 place-items-center rounded-full bg-slate-700 text-[10.5px] font-black text-white shrink-0">
                        {member.name.slice(-2)}
                      </div>
                      <div>
                        <div className="flex items-center gap-1">
                          <span className="text-[12.5px] font-black text-ink">{member.name}</span>
                          <span className="text-[10.5px] text-ink3">{member.position}</span>
                          {member.jobTitle && (
                            <span className="rounded bg-slate-100 px-1 py-0.2 text-[9px] font-semibold text-slate-600">
                              {member.jobTitle}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {progress && progress.total > 0 ? (
                      <span className="text-[10.5px] font-extrabold text-indigo-600">
                        {progress.completed}/{progress.total}건 ({progress.percent}%)
                      </span>
                    ) : (
                      <span className="text-[10px] text-ink3 font-medium">To-Do 없음</span>
                    )}
                  </div>

                  {/* 팀원 미니 진행률 바 */}
                  {progress && progress.total > 0 && (
                    <div className="h-1 w-full rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-indigo-500 transition-all duration-300"
                        style={{ width: `${progress.percent}%` }}
                      />
                    </div>
                  )}

                  {/* 팀원의 To-Do 항목 목록 (클릭하여 체크 토글 및 삭제 가능) */}
                  <div className="space-y-1">
                    {items.length === 0 ? (
                      <div className="py-2 text-center text-[11px] text-ink3 italic">
                        등록된 업무 계획이 없습니다. 아래에서 할 일을 추가해보세요.
                      </div>
                    ) : (
                      items.map((it, idx) => {
                        const tagMeta = it.tag ? getWorkPlanTagMeta(it.tag, tagMap) : null;
                        return (
                          <div
                            key={idx}
                            className="flex items-center justify-between gap-1.5 py-1 px-1 rounded-lg hover:bg-slate-50 transition-colors"
                          >
                            <div
                              onClick={() => handleToggleTeamTodo(member, idx)}
                              className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer"
                            >
                              <button
                                type="button"
                                className={`grid h-4.5 w-4.5 shrink-0 place-items-center rounded border transition-all ${
                                  it.completed
                                    ? 'border-indigo-600 bg-indigo-600 text-white shadow-2xs'
                                    : 'border-slate-300 bg-white hover:border-indigo-500'
                                }`}
                                title={it.completed ? '완료 취소' : '완료 처리'}
                              >
                                {it.completed ? (
                                  <CheckSquare size={12} strokeWidth={2.5} />
                                ) : (
                                  <Square size={12} className="text-slate-200" />
                                )}
                              </button>

                              {tagMeta && (
                                <span
                                  className={`shrink-0 rounded px-1.5 py-0.2 text-[9px] font-bold ${tagMeta.badgeClass}`}
                                >
                                  {it.tag}
                                </span>
                              )}

                              <span
                                className={`text-[11.5px] truncate font-medium ${
                                  it.completed ? 'line-through text-ink3' : 'text-slate-800'
                                }`}
                              >
                                {it.text}
                              </span>
                            </div>

                            <button
                              type="button"
                              onClick={() => handleRemoveTeamTodo(member, idx)}
                              className="p-1 text-ink3/60 hover:text-rose-500 transition-colors shrink-0"
                              title="삭제"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>

                  {/* 팀원 업무 신규 To-Do 추가 인라인 폼 */}
                  <div className="flex items-center gap-1.5 pt-2 border-t border-border/40">
                    <input
                      type="text"
                      value={teamInputText[member.id] || ''}
                      onChange={(e) =>
                        setTeamInputText((prev) => ({ ...prev, [member.id]: e.target.value }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddTeamTodo(member);
                        }
                      }}
                      placeholder={`${member.name}님에게 할 일 추가 (Enter 또는 +)`}
                      className="flex-1 rounded-lg border border-border/70 bg-slate-50/80 px-2.5 py-1.5 text-[11px] text-ink outline-none focus:border-indigo-500 focus:bg-white placeholder:text-ink3 shadow-2xs"
                    />
                    <button
                      type="button"
                      onClick={() => handleAddTeamTodo(member)}
                      disabled={!teamInputText[member.id]?.trim()}
                      className="grid h-7 w-7 place-items-center rounded-lg bg-indigo-600 text-white shadow-2xs hover:opacity-90 disabled:opacity-30 active:scale-95 transition-all shrink-0"
                      title="할 일 추가"
                    >
                      <Plus size={14} strokeWidth={2.5} />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
