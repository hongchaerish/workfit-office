import { useMemo, useState } from 'react';
import type { WorkPlan } from '@/domain/workPlan/schema';
import type { User } from '@/domain/user/schema';
import {
  parseWorkPlanItems,
  calculatePlanProgress,
  getWorkPlanTagMeta,
  toggleWorkPlanItem,
  removeWorkPlanItem,
} from '@/domain/workPlan/engine';
import { useWorkPlanConfig } from '@/features/workPlan/useWorkPlanConfig';
import { WorkPlanEditorModal } from './WorkPlanEditorModal';
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Edit3,
  CheckCircle2,
  CalendarDays,
  X,
} from 'lucide-react';

const WEEKDAYS_KO = ['월', '화', '수', '목', '금'];

/** 날짜 문자열 YYYY-MM-DD 를 Date 객체(UTC 기준)로 생성 */
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

/** 주어진 날짜가 속한 주의 월~금 5일 날짜 배열 반환 */
function getWorkWeekDays(refDateStr: string): string[] {
  const date = parseDateUtc(refDateStr);
  const day = date.getUTCDay(); // 0(일) ~ 6(토)
  // 월요일(1) 기준 거리
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(date.getTime() + diffToMonday * 86400000);

  const days: string[] = [];
  for (let i = 0; i < 5; i++) {
    const current = new Date(monday.getTime() + i * 86400000);
    days.push(formatDateStr(current));
  }
  return days;
}

interface WorkPlanWeeklyViewProps {
  actor: User;
  todayStr: string;
  myPlans: WorkPlan[];
  onSavePlan: (date: string, content: string, existingPlanId?: string) => Promise<void>;
  onDeletePlan: (planId: string) => Promise<void>;
  onOpenCalendarModal?: (text: string, date: string, tag?: string) => void;
}

export function WorkPlanWeeklyView({
  todayStr,
  myPlans,
  onSavePlan,
  onDeletePlan,
  onOpenCalendarModal,
}: WorkPlanWeeklyViewProps) {
  const [anchorDate, setAnchorDate] = useState(todayStr);
  const [editingTarget, setEditingTarget] = useState<{ date: string; plan?: WorkPlan } | null>(null);

  const { tagMap } = useWorkPlanConfig();

  const weekDays = useMemo(() => getWorkWeekDays(anchorDate), [anchorDate]);
  const startDay = weekDays[0];
  const endDay = weekDays[4];

  // 날짜별 내 계획 매핑
  const plansByDate = useMemo(() => {
    const map = new Map<string, WorkPlan>();
    myPlans.forEach((p) => map.set(p.date, p));
    return map;
  }, [myPlans]);

  // 주간 달성률 통계
  const weekStats = useMemo(() => {
    let totalItems = 0;
    let completedItems = 0;
    weekDays.forEach((d) => {
      const plan = plansByDate.get(d);
      if (plan) {
        const prog = calculatePlanProgress(plan.content);
        if (prog) {
          totalItems += prog.total;
          completedItems += prog.completed;
        }
      }
    });
    const percent = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;
    return { totalItems, completedItems, percent };
  }, [weekDays, plansByDate]);

  // 주 이동
  const moveWeek = (deltaWeeks: number) => {
    const cur = parseDateUtc(anchorDate);
    const next = new Date(cur.getTime() + deltaWeeks * 7 * 86400000);
    setAnchorDate(formatDateStr(next));
  };

  const goToday = () => {
    setAnchorDate(todayStr);
  };

  // 체크박스 원클릭 토글
  const handleToggleItem = async (plan: WorkPlan, idx: number) => {
    const newContent = toggleWorkPlanItem(plan.content, idx);
    await onSavePlan(plan.date, newContent, plan.id);
  };

  // 개별 업무 삭제
  const handleRemoveItem = async (plan: WorkPlan, idx: number) => {
    const nextContent = removeWorkPlanItem(plan.content, idx);
    if (!nextContent.trim()) {
      await onDeletePlan(plan.id);
    } else {
      await onSavePlan(plan.date, nextContent, plan.id);
    }
  };

  return (
    <div className="space-y-4">
      {/* 주간 네비게이터 & 통계 헤더 바 */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-panel p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-lg border border-border bg-panel-alt p-1">
            <button
              type="button"
              onClick={() => moveWeek(-1)}
              className="rounded p-1 hover:bg-panel text-ink transition-colors"
              title="이전 주"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              onClick={goToday}
              className="px-2.5 py-0.5 text-[11.5px] font-bold text-ink hover:text-teal transition-colors"
            >
              이번 주
            </button>
            <button
              type="button"
              onClick={() => moveWeek(1)}
              className="rounded p-1 hover:bg-panel text-ink transition-colors"
              title="다음 주"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          <span className="text-[13px] font-extrabold text-ink flex items-center gap-1.5 ml-1">
            <CalendarDays size={16} className="text-teal" />
            {startDay.slice(5).replace('-', '.')} ~ {endDay.slice(5).replace('-', '.')}
          </span>
        </div>

        {/* 주간 총 달성률 게이지 */}
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-[11px] font-bold text-ink2">
              주간 달성률: <span className="text-teal font-extrabold">{weekStats.percent}%</span>
            </div>
            <div className="text-[10px] text-ink3">
              {weekStats.completedItems}/{weekStats.totalItems} 항목 완료
            </div>
          </div>
          <div className="h-2 w-24 rounded-full bg-border overflow-hidden">
            <div
              className="h-full bg-teal transition-all duration-500 rounded-full"
              style={{ width: `${weekStats.percent}%` }}
            />
          </div>
        </div>
      </div>

      {/* 월~금 5영업일 카드 그리드 */}
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-5">
        {weekDays.map((dayStr, i) => {
          const isToday = dayStr === todayStr;
          const plan = plansByDate.get(dayStr);
          const parsed = plan ? parseWorkPlanItems(plan.content) : [];
          const prog = plan ? calculatePlanProgress(plan.content) : null;
          const [, m, d] = dayStr.split('-');

          return (
            <div
              key={dayStr}
              className={`flex flex-col rounded-xl border transition-all ${
                isToday
                  ? 'border-teal ring-1 ring-teal/30 bg-teal-soft/10 shadow-sm'
                  : 'border-border bg-panel hover:border-border-hi'
              }`}
            >
              {/* 요일 헤더 */}
              <div className="flex items-center justify-between border-b border-border/70 p-3">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-[14px] font-extrabold text-ink">{WEEKDAYS_KO[i]}요일</span>
                  <span className="text-[11.5px] font-semibold text-ink3">{m}.{d}</span>
                  {isToday && (
                    <span className="rounded bg-teal px-1.5 py-0.5 text-[9.5px] font-extrabold text-white">
                      오늘
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setEditingTarget({ date: dayStr, plan })}
                  className="rounded-md p-1 text-ink3 hover:bg-panel-alt hover:text-teal transition-colors"
                  title={plan ? '계획 수정' : '새 계획 작성'}
                >
                  {plan ? <Edit3 size={13} /> : <Plus size={14} />}
                </button>
              </div>

              {/* 본문 항목 리스트 */}
              <div className="flex-1 p-3 space-y-1.5 min-h-[140px]">
                {parsed.length === 0 ? (
                  <div
                    onClick={() => setEditingTarget({ date: dayStr, plan })}
                    className="flex h-full min-h-[120px] cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-border/70 p-4 text-center hover:bg-panel-alt/40 transition-colors"
                  >
                    <span className="text-[11.5px] font-medium text-ink3">+ 계획 작성</span>
                  </div>
                ) : (
                  parsed.map((item, idx) => {
                    if (!item.text && !item.tag && !item.isChecklist) {
                      // 빈 줄 간격(줄바꿈) 유지
                      return <div key={idx} className="h-2" />;
                    }
                    const tagMeta = item.tag ? getWorkPlanTagMeta(item.tag, tagMap) : null;

                    return (
                      <div
                        key={idx}
                        className="group flex items-start gap-1.5 rounded-md p-1 hover:bg-panel-alt/50 transition-colors"
                      >
                        {item.isChecklist && (
                          <button
                            type="button"
                            onClick={() => plan && handleToggleItem(plan, idx)}
                            className={`mt-0.5 grid h-3.5 w-3.5 shrink-0 place-items-center rounded border transition-colors cursor-pointer ${
                              item.completed ? 'border-teal bg-teal text-white' : 'border-border bg-panel hover:border-teal'
                            }`}
                          >
                            {item.completed && <CheckCircle2 size={11} />}
                          </button>
                        )}

                        <div className="min-w-0 flex-1 leading-snug">
                          {tagMeta && (
                            <span className={`mr-1 inline-block rounded px-1 py-0.2 text-[9.5px] font-bold ${tagMeta.badgeClass}`}>
                              {tagMeta.tag}
                            </span>
                          )}
                          <span className={`text-[11.5px] break-words ${item.completed ? 'line-through text-ink3' : 'text-ink'}`}>
                            {item.text}
                          </span>
                        </div>

                        {/* 캘린더 일정 등록/공유 버튼 */}
                        {onOpenCalendarModal && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenCalendarModal(item.text, dayStr, item.tag);
                            }}
                            className="opacity-0 group-hover:opacity-100 rounded p-0.5 text-ink3 hover:bg-teal-soft/30 hover:text-teal transition-all shrink-0 ml-1"
                            title="캘린더 일정으로 등록 및 공유"
                          >
                            <CalendarDays size={11} />
                          </button>
                        )}

                        {/* 행별 개별 삭제 버튼 (✕) */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (plan) void handleRemoveItem(plan, idx);
                          }}
                          className="opacity-0 group-hover:opacity-100 rounded p-0.5 text-ink3 hover:bg-rose-500/10 hover:text-rose-500 transition-all shrink-0 ml-1"
                          title="이 업무 삭제"
                        >
                          <X size={11} />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>

              {/* 카드 하단 진행률 바 */}
              {prog && (
                <div className="border-t border-border/60 bg-panel-alt/30 px-3 py-2 flex items-center justify-between text-[10.5px]">
                  <span className="text-ink3 font-medium">{prog.completed}/{prog.total} 완료</span>
                  <span className="font-bold text-teal">{prog.percent}%</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 계획 편집 모달 */}
      {editingTarget && (
        <WorkPlanEditorModal
          isOpen={true}
          onClose={() => setEditingTarget(null)}
          date={editingTarget.date}
          dateTitle={`${editingTarget.date}`}
          initialContent={editingTarget.plan?.content ?? ''}
          onSave={async (content) => {
            await onSavePlan(editingTarget.date, content, editingTarget.plan?.id);
          }}
          onDelete={
            editingTarget.plan
              ? async () => {
                  await onDeletePlan(editingTarget.plan!.id);
                }
              : undefined
          }
        />
      )}
    </div>
  );
}
