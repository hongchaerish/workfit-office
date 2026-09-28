import { useMemo, useState, useCallback } from 'react';
import type { User } from '@/domain/user/schema';
import type { WorkPlan } from '@/domain/workPlan/schema';
import { useAllWorkPlans, useUpdateWorkPlan } from '@/features/workPlan/useWorkPlans';
import {
  parseWorkPlanItems,
  calculatePlanProgress,
  getWorkPlanTagMeta,
  toggleWorkPlanItem,
} from '@/domain/workPlan/engine';
import { useWorkPlanConfig } from '@/features/workPlan/useWorkPlanConfig';
import { USER_PRESENCE_META } from '@/domain/userPresence/schema';
import type { UserPresence } from '@/domain/userPresence/schema';
import { useAllApprovals } from '@/features/gw/useApprovals';
import { extractApprovedSchedules, isDateInSchedule } from '@/domain/approvalDoc/scheduleEngine';
import { useCalendarEvents } from '@/features/calendar/useCalendarEvents';
import {
  isWorkPlanDerivedEvent,
  syncWorkPlanToCalendar,
  extractTimeFromText,
} from '@/domain/workPlan/workPlanCalendarBridge';
import {
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Edit3,
  Plus,
  CalendarPlus,
  Settings,
} from 'lucide-react';

const WEEKDAYS_KO = ['월', '화', '수', '목', '금'];

function parseDateUtc(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function formatDateStr(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getWorkWeekDays(refDateStr: string): string[] {
  const date = parseDateUtc(refDateStr);
  const day = date.getUTCDay(); // 0(일) ~ 6(토)
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(date.getTime() + diffToMonday * 86400000);

  const days: string[] = [];
  for (let i = 0; i < 5; i++) {
    const current = new Date(monday.getTime() + i * 86400000);
    days.push(formatDateStr(current));
  }
  return days;
}

interface WorkPlanTeamWeeklyMatrixProps {
  actor: User;
  todayStr: string;
  members: User[];
  presences?: Record<string, UserPresence>;
  deptId?: string | null;
  onOpenEditor: (date: string, plan?: WorkPlan) => void;
  onOpenDetail: (user: User, plan: WorkPlan) => void;
  onRequestPlan?: (targetUser: User, date: string) => void;
  onOpenConfig?: () => void;
}

export function WorkPlanTeamWeeklyMatrix({
  actor,
  todayStr,
  members,
  presences,
  deptId,
  onOpenEditor,
  onOpenDetail,
  onRequestPlan,
  onOpenConfig,
}: WorkPlanTeamWeeklyMatrixProps) {
  const [anchorDate, setAnchorDate] = useState(todayStr);
  const { tagMap } = useWorkPlanConfig();

  const weekDays = useMemo(() => getWorkWeekDays(anchorDate), [anchorDate]);
  const startDay = weekDays[0];
  const endDay = weekDays[4];

  // 주간 범위의 전체 사용자 업무계획 조회
  const weeklyPlansQuery = useAllWorkPlans({ from: startDay, to: endDay }, true);
  const updateMutation = useUpdateWorkPlan();

  // (userId -> (date -> WorkPlan)) 맵 생성
  const plansByUserAndDate = useMemo(() => {
    const userMap = new Map<string, Map<string, WorkPlan>>();
    (weeklyPlansQuery.data ?? []).forEach((plan) => {
      if (!userMap.has(plan.ownerUserId)) {
        userMap.set(plan.ownerUserId, new Map());
      }
      userMap.get(plan.ownerUserId)!.set(plan.date, plan);
    });
    return userMap;
  }, [weeklyPlansQuery.data]);

  // ── 전자결재 및 캘린더 일정 역방향 투영 맵 ──
  const approvalsQuery = useAllApprovals();
  const calendarActor = useMemo(
    () => ({ userId: actor.id, active: actor.status === '사용', deptId }),
    [actor.id, actor.status, deptId],
  );
  const calendarEventsQuery = useCalendarEvents(calendarActor, { from: startDay, to: endDay });

  // (userId -> (date -> ProjectedScheduleItem[]))
  const projectedSchedulesMap = useMemo(() => {
    const map = new Map<
      string,
      Map<
        string,
        Array<{
          id: string;
          title: string;
          type: 'LEAVE' | 'OUTSIDE' | 'TRIP' | 'CALENDAR';
          label: string;
          badgeClass: string;
          timeStr?: string;
        }>
      >
    >();

    // 1) 전자결재 승인 일정 (외근, 출장, 휴가)
    const approvedSchedules = extractApprovedSchedules(approvalsQuery.data ?? []);
    for (const s of approvedSchedules) {
      if (!map.has(s.drafterId)) map.set(s.drafterId, new Map());
      const userDateMap = map.get(s.drafterId)!;

      for (const dStr of weekDays) {
        if (isDateInSchedule(dStr, s)) {
          if (!userDateMap.has(dStr)) userDateMap.set(dStr, []);
          const label =
            s.category === 'LEAVE'
              ? `🏖️ ${s.leaveType || '휴가'}`
              : s.category === 'OUTSIDE'
              ? `🏃 ${s.subType || '외근'}${s.destination ? ` (${s.destination})` : ''}`
              : `🚗 ${s.subType || '출장'}${s.destination ? ` (${s.destination})` : ''}`;

          const badgeClass =
            s.category === 'LEAVE'
              ? 'bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-400'
              : s.category === 'OUTSIDE'
              ? 'bg-blue-500/15 text-blue-700 border-blue-500/30 dark:text-blue-400'
              : 'bg-indigo-500/15 text-indigo-700 border-indigo-500/30 dark:text-indigo-400';

          userDateMap.get(dStr)!.push({
            id: `appr-${s.docId}-${dStr}`,
            title: s.docTitle,
            type: s.category,
            label,
            badgeClass,
            timeStr: s.startTime && s.endTime ? `${s.startTime}~${s.endTime}` : undefined,
          });
        }
      }
    }

    // 2) 캘린더 공유 일정 (회의, 외근 등. 단, WP-SYNC 태그로 생성된 업무계획 복제본은 중복 방지를 위해 제외)
    for (const ev of calendarEventsQuery.data ?? []) {
      if (isWorkPlanDerivedEvent(ev)) continue;

      const targetUserIds = new Set<string>([ev.ownerUserId, ...(ev.attendeeUserIds || [])]);
      const timeStr = ev.allDay
        ? undefined
        : ev.startTime && ev.endTime
        ? `${ev.startTime}~${ev.endTime}`
        : ev.startTime || undefined;

      for (const uId of targetUserIds) {
        if (!map.has(uId)) map.set(uId, new Map());
        const userDateMap = map.get(uId)!;
        if (!userDateMap.has(ev.date)) userDateMap.set(ev.date, []);

        const isMeeting = ev.eventType === 'MEETING';
        const label = `${isMeeting ? '👥' : '📅'} ${ev.title}`;
        const badgeClass = isMeeting
          ? 'bg-purple-500/15 text-purple-700 border-purple-500/30 dark:text-purple-400'
          : 'bg-teal-500/15 text-teal-700 border-teal-500/30 dark:text-teal-400';

        userDateMap.get(ev.date)!.push({
          id: `cal-${ev.id}`,
          title: ev.title,
          type: 'CALENDAR',
          label,
          badgeClass,
          timeStr,
        });
      }
    }

    return map;
  }, [approvalsQuery.data, calendarEventsQuery.data, weekDays]);

  const handlePrevWeek = () => {
    const d = parseDateUtc(anchorDate);
    d.setUTCDate(d.getUTCDate() - 7);
    setAnchorDate(formatDateStr(d));
  };

  const handleNextWeek = () => {
    const d = parseDateUtc(anchorDate);
    d.setUTCDate(d.getUTCDate() + 7);
    setAnchorDate(formatDateStr(d));
  };

  const handleThisWeek = () => {
    setAnchorDate(todayStr);
  };

  const handleToggleMyItem = useCallback(
    async (plan: WorkPlan, idx: number) => {
      const nextContent = toggleWorkPlanItem(plan.content, idx);
      const updated = await updateMutation.mutateAsync({
        actor: { userId: actor.id, active: actor.status === '사용' },
        id: plan.id,
        draft: { date: plan.date, content: nextContent },
      });
      if (updated) {
        await syncWorkPlanToCalendar(
          { userId: actor.id, active: actor.status === '사용', deptId: deptId ?? null },
          updated,
          true,
        );
      }
    },
    [actor, updateMutation, deptId],
  );

  const [startYear, startMonth, startDayNum] = startDay.split('-').map(Number);
  const [, endMonth, endDayNum] = endDay.split('-').map(Number);

  return (
    <div className="space-y-3.5">
      {/* 주간 네비게이션 및 빠른 작업 헤더 */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-panel p-3 shadow-xs">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handlePrevWeek}
              aria-label="이전 주"
              className="grid h-8 w-8 place-items-center rounded-lg border border-border text-ink2 hover:bg-panel-alt transition-colors"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              onClick={handleThisWeek}
              className="rounded-lg border border-border bg-panel px-3 py-1.5 text-[11.5px] font-bold text-ink hover:bg-panel-alt transition-colors shadow-2xs"
            >
              이번 주
            </button>
            <button
              type="button"
              onClick={handleNextWeek}
              aria-label="다음 주"
              className="grid h-8 w-8 place-items-center rounded-lg border border-border text-ink2 hover:bg-panel-alt transition-colors"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          <h2 className="ml-1 text-[14px] font-extrabold text-ink">
            {startYear}년 {startMonth}월 {startDayNum}일 ~ {endMonth}월 {endDayNum}일
          </h2>

          <span className="text-[11px] font-semibold text-ink3 ml-2">
            ({members.length}명 조회)
          </span>
        </div>

        {/* 사용자 액션 버튼: [+ 오늘 업무 작성], [⚙️ 설정] */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              const myTodayPlan = plansByUserAndDate.get(actor.id)?.get(todayStr);
              onOpenEditor(todayStr, myTodayPlan);
            }}
            className="flex items-center gap-1.5 rounded-xl border border-teal/40 bg-teal-soft/20 px-3 py-1.5 text-[11.5px] font-bold text-teal hover:bg-teal-soft/30 transition-colors shadow-2xs cursor-pointer"
          >
            <Plus size={13} />
            <span>오늘 업무 작성</span>
          </button>
          {onOpenConfig && (
            <button
              type="button"
              onClick={onOpenConfig}
              className="flex items-center gap-1 rounded-xl border border-border bg-panel px-3 py-1.5 text-[11.5px] font-bold text-ink hover:bg-panel-alt transition-colors shadow-2xs"
            >
              <Settings size={12} className="text-ink3" />
              <span>설정</span>
            </button>
          )}
        </div>
      </div>

      {/* 팀 주간 매트릭스 테이블 */}
      <div className="overflow-x-auto rounded-xl border border-border bg-panel shadow-sm">
        <table className="w-full min-w-[960px] border-collapse text-left">
          <thead>
            <tr className="border-b border-border bg-panel-alt/75">
              {/* 팀원 프로필 고정 열 */}
              <th className="w-[180px] p-3 text-[11.5px] font-extrabold text-ink sticky left-0 bg-panel-alt/95 z-10 border-r border-border backdrop-blur-xs">
                팀원 명단 ({members.length})
              </th>
              {/* 월~금 5영업일 열 */}
              {weekDays.map((dayStr, i) => {
                const isToday = dayStr === todayStr;
                const [, m, d] = dayStr.split('-');
                return (
                  <th
                    key={dayStr}
                    className={`p-3 text-[12px] font-extrabold border-r border-border last:border-r-0 ${
                      isToday ? 'bg-teal-soft/25 text-teal' : 'text-ink'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-baseline gap-1.5">
                        <span>{WEEKDAYS_KO[i]}요일</span>
                        <span className="text-[10.5px] font-semibold text-ink3">
                          {m}.{d}
                        </span>
                      </div>
                      {isToday && (
                        <span className="rounded bg-teal px-1.5 py-0.2 text-[9px] font-extrabold text-white shadow-2xs">
                          오늘
                        </span>
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/70">
            {members.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-[12px] font-semibold text-ink3">
                  조회할 수 있는 팀원이 없습니다.
                </td>
              </tr>
            ) : (
              members.map((member) => {
                const isSelf = member.id === actor.id;
                const userPlans = plansByUserAndDate.get(member.id);
                const presence = presences?.[member.id];
                const presenceMeta = presence?.status ? USER_PRESENCE_META[presence.status] : null;

                return (
                  <tr
                    key={member.id}
                    className={`transition-colors ${
                      isSelf ? 'bg-teal-soft/10 font-medium' : 'hover:bg-panel-alt/30'
                    }`}
                  >
                    {/* 팀원 프로필 열 */}
                    <td className="p-3 align-top sticky left-0 bg-panel/95 z-10 border-r border-border backdrop-blur-xs">
                      <div className="flex items-start gap-2">
                        <div
                          className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-extrabold text-white shadow-2xs ${
                            isSelf ? 'bg-teal' : 'bg-ink3'
                          }`}
                        >
                          {member.name.slice(0, 1)}
                        </div>
                        <div className="min-w-0 flex-1 leading-snug">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[12px] font-bold text-ink truncate">
                              {member.name}
                            </span>
                            {isSelf && (
                              <span className="rounded bg-teal/20 px-1 py-0.2 text-[9px] font-extrabold text-teal">
                                나
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-ink3 truncate flex items-center gap-1">
                            <span>{member.dept} · {member.position}</span>
                            {(member as any).isConcurrent && (
                              <span className="rounded bg-slate-200 dark:bg-slate-700 px-1 py-0.2 text-[8.5px] font-bold text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-slate-600">
                                겸직
                              </span>
                            )}
                          </div>

                          {presenceMeta && (
                            <div className="mt-1 flex items-center gap-1 text-[10px] font-semibold">
                              <span>{presenceMeta.icon}</span>
                              <span className={presenceMeta.textColor}>{presenceMeta.label}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* 월~금 5일치 일정 셀 */}
                    {weekDays.map((dayStr) => {
                      const isToday = dayStr === todayStr;
                      const plan = userPlans?.get(dayStr);
                      const parsed = plan ? parseWorkPlanItems(plan.content) : [];
                      const prog = plan ? calculatePlanProgress(plan.content) : null;
                      const userProjectedDateMap = projectedSchedulesMap.get(member.id);
                      const projectedItems = userProjectedDateMap?.get(dayStr) ?? [];

                      return (
                        <td
                          key={dayStr}
                          className={`p-2.5 align-top border-r border-border last:border-r-0 transition-colors ${
                            isToday ? 'bg-teal-soft/10' : ''
                          }`}
                        >
                          {/* 역방향 투영: 결재 승인 및 캘린더 공유 일정 칩 */}
                          {projectedItems.length > 0 && (
                            <div className="space-y-1 mb-2 pb-1.5 border-b border-border/50">
                              {projectedItems.map((pItem) => (
                                <div
                                  key={pItem.id}
                                  className={`flex items-center justify-between gap-1 rounded px-1.5 py-0.5 text-[9.5px] font-bold border shadow-2xs ${pItem.badgeClass}`}
                                  title={`${pItem.label} (${pItem.timeStr || '종일'})`}
                                >
                                  <span className="truncate">{pItem.label}</span>
                                  {pItem.timeStr && (
                                    <span className="text-[8.5px] opacity-80 shrink-0 font-normal">{pItem.timeStr}</span>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                          {parsed.length === 0 ? (
                            isSelf ? (
                              <button
                                type="button"
                                onClick={() => onOpenEditor(dayStr, plan)}
                                className="flex h-full min-h-[64px] w-full flex-col items-center justify-center rounded-lg border border-dashed border-border/70 p-2 text-center text-ink3 hover:border-teal hover:bg-teal-soft/20 hover:text-teal transition-all group cursor-pointer"
                              >
                                <Plus size={14} className="mb-0.5 text-ink3/70 group-hover:text-teal transition-colors" />
                                <span className="text-[10.5px] font-semibold">+ 계획 작성</span>
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => onRequestPlan?.(member, dayStr)}
                                className="flex h-full min-h-[64px] w-full flex-col items-center justify-center rounded-lg border border-dashed border-border/50 p-2 text-center text-ink3/40 hover:border-teal/60 hover:bg-teal-soft/15 hover:text-teal transition-all group cursor-pointer"
                                title={`${member.name}님에게 이 날짜 일정 추가 요청`}
                              >
                                <CalendarPlus size={13} className="mb-0.5 text-ink3/40 group-hover:text-teal transition-colors" />
                                <span className="text-[10px] font-semibold">+ 요청</span>
                              </button>
                            )
                          ) : (
                            <div className="space-y-1.5 min-h-[64px]">
                              {/* 계획 항목 목록: 기존 업무들을 항상 먼저 노출 */}
                              <div className="space-y-1">
                                {parsed.map((item, idx) => {
                                  if (!item.text && !item.tag && !item.isChecklist) return null;
                                  const tagMeta = item.tag ? getWorkPlanTagMeta(item.tag, tagMap) : null;

                                  return (
                                    <div
                                      key={idx}
                                      className="group flex items-start gap-1 rounded p-0.5 hover:bg-panel-alt/60 transition-colors"
                                    >
                                      {item.isChecklist ? (
                                        <button
                                          type="button"
                                          disabled={!isSelf}
                                          onClick={() => isSelf && plan && void handleToggleMyItem(plan, idx)}
                                          className={`mt-0.5 grid h-3 w-3 shrink-0 place-items-center rounded border transition-colors ${
                                            item.completed
                                              ? 'border-teal bg-teal text-white'
                                              : 'border-border bg-panel'
                                          } ${isSelf ? 'hover:border-teal cursor-pointer' : 'cursor-default'}`}
                                        >
                                          {item.completed && <CheckCircle2 size={9} />}
                                        </button>
                                      ) : (
                                        <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-ink3" />
                                      )}

                                      <div className="min-w-0 flex-1 leading-snug">
                                        {tagMeta && (
                                          <span
                                            className={`mr-1 inline-block rounded px-1 py-0.2 text-[8.5px] font-bold ${tagMeta.badgeClass}`}
                                          >
                                            {tagMeta.tag}
                                          </span>
                                        )}
                                        {/* 시간 표기 추출 */}
                                        {(() => {
                                          const { startTime, endTime, cleanText } = extractTimeFromText(item.text);
                                          if (!startTime) {
                                            return (
                                              <span
                                                className={`text-[10.5px] break-words ${
                                                  item.completed ? 'line-through text-ink3' : 'text-ink'
                                                }`}
                                              >
                                                {item.text}
                                              </span>
                                            );
                                          }
                                          return (
                                            <span
                                              className={`text-[10.5px] break-words flex items-center gap-1 flex-wrap ${
                                                item.completed ? 'line-through text-ink3' : 'text-ink'
                                              }`}
                                            >
                                              <span className="rounded bg-blue-500/10 px-1 py-0.2 text-[9px] font-bold text-blue-600 dark:text-blue-400">
                                                {startTime}{endTime ? `~${endTime}` : ''}
                                              </span>
                                              <span>{cleanText || item.text}</span>
                                            </span>
                                          );
                                        })()}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>

                              {/* 기존 업무 목록 아래: 본인인 경우 바로 모달을 여는 추가 버튼 */}
                              {isSelf && (
                                <button
                                  type="button"
                                  onClick={() => onOpenEditor(dayStr, plan)}
                                  className="flex w-full items-center justify-center gap-1 rounded border border-dashed border-border/60 py-1 text-[10px] font-semibold text-ink3 hover:border-teal/50 hover:bg-teal-soft/20 hover:text-teal transition-colors mt-1 cursor-pointer"
                                >
                                  <Plus size={11} />
                                  <span>추가 및 편집</span>
                                </button>
                              )}

                              {/* 하단 진행률 및 액션 버튼 */}
                              <div className="flex items-center justify-between pt-1 border-t border-border/40 text-[9.5px]">
                                {prog && (
                                  <span className="text-ink3 font-medium">
                                    {prog.completed}/{prog.total} ({prog.percent}%)
                                  </span>
                                )}

                                {isSelf ? (
                                  <button
                                    type="button"
                                    onClick={() => onOpenEditor(dayStr, plan)}
                                    className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-ink3 hover:text-teal hover:bg-teal-soft/20 font-semibold transition-colors cursor-pointer"
                                    title="계획 편집 (모달 열기)"
                                  >
                                    <Edit3 size={11} />
                                    <span>편집</span>
                                  </button>
                                ) : (
                                  <div className="ml-auto flex items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() => onRequestPlan?.(member, dayStr)}
                                      className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[9.5px] text-ink3 hover:text-teal hover:bg-teal-soft/20 font-semibold transition-colors cursor-pointer"
                                      title={`${member.name}님에게 이 날짜 일정 추가 요청`}
                                    >
                                      <CalendarPlus size={10} />
                                      <span>요청</span>
                                    </button>
                                    {plan && (
                                      <button
                                        type="button"
                                        onClick={() => onOpenDetail(member, plan)}
                                        className="rounded px-1.5 py-0.5 text-[9.5px] text-ink3 hover:text-ink hover:bg-panel-alt font-semibold transition-colors cursor-pointer"
                                      >
                                        상세
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
