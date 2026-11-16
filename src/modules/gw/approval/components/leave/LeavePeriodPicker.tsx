import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, Check, ChevronLeft, ChevronRight, Clock3, X } from 'lucide-react';
import {
  FULL_DAY_GROUPS,
  LEAVE_GROUPS,
  LEAVE_TYPE_NAMES,
  dayFrame,
  docValuesOf,
  groupOf,
  leaveRange,
  leaveTimeOptions,
  pickerProblem,
  advanceDays,
  timeNotice,
  workDaysBetween,
  type LeaveBalances,
  type LeaveDocValues,
  type LeaveGroupId,
  type LeavePick,
  type LeavePickType,
  type WorkDay,
} from '@/domain/leave/leavePicker';
import { DAY_MIN, formatMinutes } from '@/domain/leave/substituteLedger';

type Holidays = Array<{ date: string; name?: string }> | Map<string, string>;

const pad = (n: number) => String(n).padStart(2, '0');
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const dateLabel = (d: string) => {
  if (!d) return '';
  const [y, m, n] = d.split('-').map(Number);
  return `${d} (${WEEK[new Date(y, m - 1, n).getDay()]})`;
};
export const rangeLabel = (a: string, b: string) => (!a ? '' : a === b || !b ? dateLabel(a) : `${dateLabel(a)} ~ ${dateLabel(b)}`);
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const toClock = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

function holidayNameOf(holidays: Holidays | undefined, date: string): string {
  if (!holidays) return '';
  if (holidays instanceof Map) return holidays.get(date) ?? '';
  return holidays.find((h) => h.date === date)?.name ?? '';
}

export interface LeavePickerBalance extends LeaveBalances {
  annualGranted: number;
  annualUsed: number;
  substituteTotalMin: number;
  substituteUsedMin: number;
}

/**
 * 휴가원 '사용기간 및 휴가 정보 선택' 창(화면설계서 V5.8) — 날짜 → 휴가 구분 → 시간 순서로 고르고 적용.
 */
export function LeavePeriodPicker({
  initial,
  day,
  holidays,
  balance,
  onApply,
  onClose,
}: {
  initial: { from: string; to: string; pick: LeavePick | null };
  day: WorkDay;
  holidays?: Holidays;
  balance: LeavePickerBalance;
  onApply: (values: LeaveDocValues, pick: LeavePick) => void;
  onClose: () => void;
}) {
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [pick, setPick] = useState<LeavePick | null>(initial.pick);
  const [group, setGroup] = useState<LeaveGroupId | null>(initial.pick ? groupOf(initial.pick.type) : null);
  const base = initial.from ? initial.from.split('-').map(Number) : (() => { const t = new Date(); return [t.getFullYear(), t.getMonth() + 1]; })();
  const [ym, setYm] = useState({ y: base[0], m: base[1] - 1 });
  const [toast, setToast] = useState('');

  const days = from && to ? workDaysBetween(from, to, holidays) : 0;
  const multi = days > 1;
  const problem = pickerProblem(pick, from, to, holidays, balance);
  const advance = advanceDays(pick, from, to, holidays, balance);
  const step = !from || !to ? 1 : !group ? 2 : !pick ? 3 : 4;
  const applied = step === 4 && !problem;

  const dayOff = (d: string) => {
    const [y, m, n] = d.split('-').map(Number);
    const w = new Date(y, m - 1, n).getDay();
    return holidayNameOf(holidays, d) || (w === 0 ? '일요일' : w === 6 ? '토요일' : '');
  };

  const flash = (t: string) => {
    setToast(t);
    window.setTimeout(() => setToast(''), 2800);
  };

  const pickDate = (d: string) => {
    if (dayOff(d)) return;
    if (!from || to || d < from) {
      setFrom(d);
      setTo('');
    } else setTo(d);
    setGroup(null);
    setPick(null);
  };

  const subNeed = (g: LeaveGroupId) => (g === 'comp-full' ? DAY_MIN : g === 'comp-half' ? DAY_MIN / 2 : 0);
  const groupBlocked = (g: LeaveGroupId) => !to || (subNeed(g) > 0 && balance.substituteMin < subNeed(g)) || (multi && !FULL_DAY_GROUPS.has(g));

  const chooseGroup = (g: LeaveGroupId) => {
    if (!from || !to) return flash('시작일과 종료일을 선택해 주세요.');
    if (groupBlocked(g)) return;
    setGroup(g);
    const f = dayFrame(day);
    setPick(FULL_DAY_GROUPS.has(g) ? { type: g as LeavePickType, start: toClock(f.ws) } : null);
  };

  const timeGroups: Array<{ tag: string; type: LeavePickType }> =
    group === 'half' ? [{ tag: '오전 반차', type: 'am-half' }, { tag: '오후 반차', type: 'pm-half' }]
      : group === 'quarter' ? [{ tag: '오전', type: 'am-quarter' }, { tag: '오후', type: 'pm-quarter' }]
        : group ? [{ tag: '', type: group as LeavePickType }] : [];

  const apply = () => {
    if (!pick || !applied) return;
    onApply(docValuesOf(pick, from, to, day, holidays), pick);
  };

  const summary = problem
    ? <span className="font-semibold text-rose-600">{problem}</span>
    : applied && pick
      ? (() => {
        const [a, b] = leaveRange(pick, day);
        const text = `${rangeLabel(from, to)} · ${LEAVE_TYPE_NAMES[pick.type]} · ${a}~${b}${days > 1 ? ` · ${days}근무일 신청` : ''}`;
        return advance > 0
          ? <>{text} <span className="font-semibold text-amber-600">· 잔여 초과 {advance}일은 미리 사용(이후 발생 연차에서 차감)</span></>
          : text;
      })()
      : from && !to ? '종료일을 선택하세요. 같은 날짜를 두 번 누르면 1일 휴가입니다.' : '시작일 → 종료일 → 휴가 구분 → 시간 순서로 선택';

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label="사용기간 및 휴가 정보 선택"
        className="relative flex max-h-[calc(94vh/var(--font-scale,1))] w-full max-w-[820px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-5 pb-2 pt-4">
          <strong className="text-[16px] font-extrabold text-[#1d2433]">사용기간 및 휴가 정보 선택</strong>
          <button type="button" onClick={onClose} aria-label="닫기" className="rounded-lg p-1 text-[#8a93a5] hover:bg-slate-100"><X size={22} /></button>
        </header>

        <div className="grid grid-cols-1 gap-3 px-5 sm:grid-cols-2">
          <BalanceCard icon={<CalendarDays size={15} />} title="연차" sub={`발생 ${balance.annualGranted}일 · 사용 ${balance.annualUsed}일`} value={`${balance.annualDays}일`} />
          <BalanceCard icon={<Clock3 size={15} />} title="대체휴무" sub={`발생 ${formatMinutes(balance.substituteTotalMin)} · 사용 ${formatMinutes(balance.substituteUsedMin)}`} value={formatMinutes(balance.substituteMin)} />
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto px-5 py-4 md:grid-cols-[1fr_280px]">
          <div className="rounded-xl border border-[#dfe5ef]">
            <Section n={1} title="날짜 선택" done={!!(from && to)} current={step === 1}>
              <MonthCalendar ym={ym} setYm={setYm} from={from} to={to} dayOff={dayOff} onPick={pickDate} />
              <div className="mt-2 rounded-lg border border-[#d5e2f7] bg-[#f3f7fe] px-3 py-2 text-[11.5px] text-[#41618f]">
                {!from ? '시작일을 선택해 주세요. (주말·공휴일 제외)'
                  : !to ? <><b>시작 {dateLabel(from)}</b> · 종료일을 선택해 주세요. (같은 날짜 재선택 가능)</>
                    : <><b>시작 {dateLabel(from)} → 종료 {dateLabel(to)}</b> · 실제 신청 {days}근무일</>}
              </div>
            </Section>

            <Section n={2} title="휴가 구분 선택" done={!!group} current={step === 2}>
              <div className="grid grid-cols-3 gap-2">
                {LEAVE_GROUPS.map((g) => {
                  const blocked = groupBlocked(g.id);
                  const chosen = group === g.id;
                  return (
                    <button
                      key={g.id}
                      type="button"
                      disabled={blocked}
                      aria-pressed={chosen}
                      onClick={() => chooseGroup(g.id)}
                      className={`rounded-lg border px-2 py-2 text-center transition-colors ${chosen
                        ? 'border-[#2f6fe4] bg-[#eaf2ff] text-[#1f5fd6] ring-1 ring-[#2f6fe4]'
                        : blocked ? 'cursor-not-allowed border-[#e6e9ef] bg-[#f6f7f9] text-[#b4bac6]'
                          : 'border-[#d9dee8] bg-white text-[#2a3140] hover:border-[#9db8ea]'}`}
                    >
                      <strong className="block text-[12.5px]">{g.name}</strong>
                      <small className="text-[10.5px] opacity-80">({g.unit})</small>
                    </button>
                  );
                })}
              </div>
            </Section>

            <Section n={3} title="시간 선택" done={applied} current={step === 3} last>
              {!from || !to ? <p className="text-[12px] text-[#8a93a5]">시작일과 종료일을 먼저 선택해 주세요.</p>
                : !group ? <p className="text-[12px] text-[#8a93a5]">휴가 구분을 선택하면 사용 가능한 시간대가 표시됩니다.</p>
                  : (
                    <div className="space-y-2">
                      {timeGroups.map(({ tag, type }) => (
                        <div key={type}>
                          {tag && <span className="mb-1 block text-[11px] font-semibold text-[#6b7487]">{tag}</span>}
                          <div className="grid grid-cols-3 gap-2">
                            {leaveTimeOptions(type, day).map((start) => {
                              const [a, b] = leaveRange({ type, start }, day);
                              const on = pick?.type === type && pick.start === start;
                              return (
                                <button
                                  key={start}
                                  type="button"
                                  aria-pressed={on}
                                  onClick={() => setPick({ type, start })}
                                  className={`rounded-lg border px-2 py-1.5 text-[12px] tabular-nums transition-colors ${on ? 'border-[#1f63e0] bg-[#1f63e0] font-bold text-white' : 'border-[#d9dee8] bg-white text-[#2a3140] hover:border-[#9db8ea]'}`}
                                >
                                  {a} ~ {b}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                      {pick && <p className="pt-1 text-[11.5px] text-[#3c64a8]">{timeNotice(pick, day)}</p>}
                    </div>
                  )}
            </Section>
          </div>

          <section className="rounded-xl border border-[#dfe5ef] p-4">
            <h3 className="mb-3 text-[13px] font-extrabold text-[#1d2433]">시간 그래프 <small className="font-normal text-[#8a93a5]">(하루 기준)</small></h3>
            <TimeChart day={day} pick={from && to ? pick : null} />
          </section>
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-[#e6e9ef] px-5 py-3">
          <span className="min-w-0 text-[12px] text-[#56607a]">{summary}</span>
          <div className="flex shrink-0 gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-[#d9dee8] bg-white px-6 py-2 text-[13px] font-bold text-[#2a3140] hover:bg-slate-50">취소</button>
            <button type="button" onClick={apply} disabled={!applied} className="rounded-lg bg-[#2f6fe4] px-7 py-2 text-[13px] font-bold text-white disabled:cursor-not-allowed disabled:bg-[#a9c2ef]">적용</button>
          </div>
        </footer>

        {toast && <div className="pointer-events-none absolute bottom-16 left-1/2 -translate-x-1/2 rounded-lg bg-[#1d2a44] px-4 py-2 text-[12px] font-semibold text-white shadow-lg">{toast}</div>}
      </section>
    </div>
  , document.body);
}

function BalanceCard({ icon, title, sub, value }: { icon: React.ReactNode; title: string; sub: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-[#d5e2f7] bg-[#f3f7fe] px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-white text-[#2f6fe4]">{icon}</span>
        <div>
          <b className="block text-[12.5px] text-[#1d2433]">{title}</b>
          <small className="text-[10.5px] text-[#7a8499]">{sub}</small>
        </div>
      </div>
      <div className="text-right">
        <strong className="block text-[19px] font-extrabold text-[#1f5fd6] tabular-nums">{value}</strong>
        <span className="text-[10.5px] text-[#7a8499]">잔여</span>
      </div>
    </div>
  );
}

function Section({ n, title, done, current, last, children }: { n: number; title: string; done: boolean; current: boolean; last?: boolean; children: React.ReactNode }) {
  return (
    <section className={`px-4 py-3 ${last ? '' : 'border-b border-[#e6e9ef]'} ${current ? '' : done ? '' : 'opacity-70'}`}>
      <h3 className="mb-2 flex items-center gap-1.5 text-[13.5px] font-extrabold text-[#1d2433]">
        {n}. {title}
        {done && <span className="grid h-4 w-4 place-items-center rounded-full bg-[#dbe7fd] text-[#2f6fe4]"><Check size={11} strokeWidth={3} /></span>}
      </h3>
      {children}
    </section>
  );
}

function MonthCalendar({ ym, setYm, from, to, dayOff, onPick }: {
  ym: { y: number; m: number };
  setYm: (v: { y: number; m: number }) => void;
  from: string;
  to: string;
  dayOff: (d: string) => string;
  onPick: (d: string) => void;
}) {
  const cells = useMemo(() => {
    const first = new Date(ym.y, ym.m, 1).getDay();
    const count = new Date(ym.y, ym.m + 1, 0).getDate();
    return [...Array(first).fill(null), ...Array.from({ length: count }, (_, i) => `${ym.y}-${pad(ym.m + 1)}-${pad(i + 1)}`)] as Array<string | null>;
  }, [ym]);
  const shift = (n: number) => {
    const d = new Date(ym.y, ym.m + n, 1);
    setYm({ y: d.getFullYear(), m: d.getMonth() });
  };
  return (
    <div>
      <div className="mb-2 flex items-center justify-between px-4">
        <button type="button" onClick={() => shift(-1)} aria-label="이전 달" className="grid h-8 w-8 place-items-center rounded-lg bg-[#eef3fb] text-[#2f6fe4]"><ChevronLeft size={16} /></button>
        <strong className="text-[15px] text-[#1d2433]">{ym.y}년 {ym.m + 1}월</strong>
        <button type="button" onClick={() => shift(1)} aria-label="다음 달" className="grid h-8 w-8 place-items-center rounded-lg bg-[#eef3fb] text-[#2f6fe4]"><ChevronRight size={16} /></button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[12px]">
        {WEEK.map((w, i) => <span key={w} className={`py-1 font-bold ${i === 0 ? 'text-rose-500' : i === 6 ? 'text-[#5b7fc7]' : 'text-[#6b7487]'}`}>{w}</span>)}
        {cells.map((d, i) => {
          if (!d) return <span key={`b${i}`} />;
          const off = dayOff(d);
          const isStart = d === from;
          const isEnd = d === to;
          const inRange = !!(from && to && d >= from && d <= to);
          return (
            <button
              key={d}
              type="button"
              disabled={!!off}
              title={off ? `${d} · ${off} (선택 불가)` : undefined}
              onClick={() => onPick(d)}
              className={`h-7 rounded-md text-[11.5px] tabular-nums transition-colors ${isStart || isEnd
                ? 'bg-[#1f63e0] font-bold text-white'
                : inRange ? 'bg-[#dbe7fd] text-[#1f4fb0]'
                  : off ? 'cursor-not-allowed bg-[#f1f3f6] text-[#c3a3ab]' : 'text-[#2a3140] hover:bg-[#eef3fb]'}`}
            >
              {Number(d.slice(8))}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TimeChart({ day, pick }: { day: WorkDay; pick: LeavePick | null }) {
  const f = dayFrame(day);
  const total = f.we - f.ws;
  const pos = (m: number) => `${((m - f.ws) / total) * 100}%`;
  const ticks: number[] = [];
  for (let t = f.ws; t <= f.we; t += 60) ticks.push(t);
  // 반차·반일 대휴는 부재 5시간에 점심 1시간(출근 4시간 뒤 12:30~13:30)이 들어 있다 — 사용 4시간만 칠한다
  const halfDay = pick?.type === 'am-half' || pick?.type === 'pm-half' || pick?.type === 'comp-half';
  const lunch: [number, number] | null = halfDay ? [f.ws + 240, f.ws + 300] : [f.ls, f.le];
  const blocks: Array<[number, number]> = [];
  if (pick) {
    const [a, b] = leaveRange(pick, day).map(toMin);
    if (lunch && a < lunch[1] && b > lunch[0]) {
      if (a < lunch[0]) blocks.push([a, Math.min(b, lunch[0])]);
      if (b > lunch[1]) blocks.push([Math.max(a, lunch[1]), b]);
    } else blocks.push([a, b]);
  }
  return (
    <div className="relative ml-12 h-[380px] rounded-md border border-[#e3e8f0] bg-[#f8fafd]">
      {ticks.map((t) => (
        <div key={t} className="absolute left-0 right-0 border-t border-dashed border-[#e1e6ee]" style={{ top: pos(t) }}>
          <span className="absolute -left-12 -translate-y-1/2 text-[11px] tabular-nums text-[#7a8499]">{toClock(t)}</span>
        </div>
      ))}
      {lunch && (
        <div className="absolute left-0 right-0 grid place-items-center bg-[#e7e9ee] text-[10.5px] text-[#7a8499]" style={{ top: pos(lunch[0]), height: `${((lunch[1] - lunch[0]) / total) * 100}%` }}>
          휴게시간
        </div>
      )}
      {blocks.map(([a, b]) => (
        <div key={a} aria-label="휴가 적용 구간" className="absolute left-1 right-1 rounded-md border border-[#3b78e7] bg-gradient-to-b from-[#a9c8fb] to-[#77a6f5]" style={{ top: pos(a), height: `${((b - a) / total) * 100}%` }} />
      ))}
    </div>
  );
}
