import { Repeat } from 'lucide-react';
import {
  ROUTINE_FREQS,
  ROUTINE_FREQ_LABEL,
  addDays,
  ROUTINE_MAX_DAYS,
  routineDates,
  routineLabel,
  validateRoutineRule,
  type Routine,
  type RoutineRule,
} from '@/domain/workPlan/routine';
import { DateInput } from '@/shared/ui/form/DateInput';
import type { RoutineScope } from './useWorkPlanEventForm';

/** 월요일부터 — [표시, 요일 번호 0(일)~6(토)] */
const WEEK_ORDER: Array<[string, number]> = [['월', 1], ['화', 2], ['수', 3], ['목', 4], ['금', 5], ['토', 6], ['일', 0]];

const pill = (active: boolean) =>
  `rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
    active ? 'border-blue/40 bg-blue-soft text-blue' : 'border-border text-ink2 hover:bg-panel-alt'
  }`;

/** 새 일반 업무의 반복 규칙 — 매일·평일·매주(요일)·매월, 끝 날짜, 만들어질 횟수 */
export function RoutineFields({ start, rule, onChange }: { start: string; rule: RoutineRule; onChange: (rule: RoutineRule) => void }) {
  const invalid = validateRoutineRule(start, rule);
  const count = invalid ? 0 : routineDates(start, rule).length;
  return (
    <div className="space-y-2 border-b border-border bg-blue-soft/20 px-5 py-2.5">
      <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="반복">
        <Repeat size={13} className="mr-1 text-blue" aria-hidden />
        {ROUTINE_FREQS.map((freq) => (
          <button key={freq} type="button" role="radio" aria-checked={rule.freq === freq} onClick={() => onChange({ ...rule, freq })} className={pill(rule.freq === freq)}>
            {ROUTINE_FREQ_LABEL[freq]}
          </button>
        ))}
        {rule.freq === 'WEEKLY' && (
          <span className="ml-2 inline-flex gap-1" role="group" aria-label="반복 요일">
            {WEEK_ORDER.map(([label, day]) => {
              const on = rule.days.includes(day);
              return (
                <button
                  key={day}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onChange({ ...rule, days: on ? rule.days.filter((d) => d !== day) : [...rule.days, day] })}
                  className={`grid h-6 w-6 place-items-center rounded-full border text-[11px] font-semibold ${
                    on ? 'border-blue bg-blue text-white' : 'border-border text-ink2 hover:bg-panel-alt'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-ink2">
        <label htmlFor="work-plan-routine-until" className="font-semibold">끝 날짜</label>
        <DateInput
          id="work-plan-routine-until"
          value={rule.until}
          min={start}
          max={addDays(start, ROUTINE_MAX_DAYS)}
          onChange={(e) => onChange({ ...rule, until: e.target.value })}
          className="h-7 w-[9.5rem] text-[11.5px]"
        />
        {invalid ? (
          <span role="alert" className="font-semibold text-danger">{invalid}</span>
        ) : (
          <span className="text-ink3">{routineLabel(start, rule)} · 총 {count}회</span>
        )}
      </div>
    </div>
  );
}

/** 루틴으로 만든 업무를 고칠 때 — 이 일정만 / 이 일정과 이후 모두 (저장·삭제에 같이 쓴다) */
export function RoutineScopeFields({
  date,
  routine,
  scope,
  onChange,
  readOnly,
}: {
  date: string;
  routine: Routine;
  scope: RoutineScope;
  onChange: (scope: RoutineScope) => void;
  readOnly: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-blue-soft/20 px-5 py-2 text-[11.5px]">
      <Repeat size={13} className="mr-1 text-blue" aria-hidden />
      <span className="mr-2 font-semibold text-ink2">{routineLabel(date, routine)}</span>
      {!readOnly && (
        <span className="inline-flex gap-1" role="radiogroup" aria-label="고칠 범위">
          <button type="button" role="radio" aria-checked={scope === 'one'} onClick={() => onChange('one')} className={pill(scope === 'one')}>
            이 일정만
          </button>
          <button type="button" role="radio" aria-checked={scope === 'following'} onClick={() => onChange('following')} className={pill(scope === 'following')}>
            이 일정과 이후 모두
          </button>
        </span>
      )}
    </div>
  );
}
