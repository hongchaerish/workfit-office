import { useMemo, useState } from 'react';
import type { CommutePersonRow } from '../types';
import { X, Calendar, Building } from 'lucide-react';
import { getKoreanHoliday, isWeekend } from '@/domain/commute/engine';
import { describeCommuteRecord } from '@/domain/commute/statusDisplay';
import { StatusBadges } from '@/features/commute/StatusBadge';

interface EmployeeDetailDrawerProps {
  person: CommutePersonRow | null;
  onClose: () => void;
  month: string;
  holidayMap?: Map<string, string>;
}

const pad = (v: number) => String(v).padStart(2, '0');
const timeOf = (iso: string | null): string => {
  if (!iso) return '—';
  const at = new Date(iso);
  return `${pad(at.getHours())}:${pad(at.getMinutes())}`;
};
const hourText = (min: number): string => (min === 0 ? '—' : `${Math.floor(min / 60)}h ${min % 60}m`);

export function EmployeeDetailDrawer({ person, onClose, month, holidayMap }: EmployeeDetailDrawerProps) {
  const [filterType, setFilterType] = useState<'all' | 'work' | 'anomaly' | 'leave'>('all');

  const filteredRecords = useMemo(() => {
    if (!person) return [];
    return person.records.filter((rec) => {
      if (filterType === 'work') return rec.inAt || rec.outAt;
      if (filterType === 'anomaly') {
        return (
          rec.status === 'late' ||
          rec.status === 'absent' ||
          rec.status === 'missing_in' ||
          rec.status === 'missing_out'
        );
      }
      if (filterType === 'leave') return rec.status === 'leave';
      return true;
    });
  }, [person, filterType]);

  if (!person) return null;

  const { summary } = person;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-xs transition-opacity animate-in fade-in duration-200">
      {/* 바깥 클릭 영역 */}
      <div className="flex-1" onClick={onClose} />

      {/* 우측 슬라이드 패널 */}
      <div className="relative flex h-full w-full max-w-lg flex-col bg-panel shadow-2xl border-l border-border animate-in slide-in-from-right duration-300">
        {/* 헤더 */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4 bg-panel-alt/40">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-teal/15 text-teal font-extrabold text-base">
              {person.name[0]}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-base font-extrabold text-ink">{person.name}</span>
                <span className="rounded bg-panel-alt px-1.5 py-0.5 text-[10.5px] font-bold text-ink2 border border-border">
                  {person.position || '사원'}
                </span>
                {!person.active && (
                  <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-bold text-rose-600">
                    퇴직
                  </span>
                )}
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-[11.5px] text-ink3">
                <span className="flex items-center gap-1"><Building size={12} /> {person.dept || '부서 미지정'}</span>
                {person.empNo && <span>· 사번: {person.empNo}</span>}
                {person.hireDate && <span>· 입사: {person.hireDate}</span>}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="grid h-8 w-8 place-items-center rounded-lg text-ink3 hover:text-ink hover:bg-panel-alt transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* 당월 요약 KPI */}
        <div className="border-b border-border p-4 bg-panel">
          <div className="text-[11px] font-bold text-ink3 mb-2 flex items-center gap-1.5">
            <Calendar size={13} className="text-teal" />
            <span>{month.slice(0, 4)}년 {Number(month.slice(5))}월 근태 요약</span>
          </div>
          <div className="grid grid-cols-5 gap-2">
            <div className="rounded-lg border border-border bg-panel-alt/40 p-2 text-center">
              <div className="text-[10px] font-bold text-ink3">출근일</div>
              <div className="mt-1 text-sm font-extrabold text-ink">{summary.workDays}일</div>
            </div>
            <div className="rounded-lg border border-border bg-panel-alt/40 p-2 text-center">
              <div className="text-[10px] font-bold text-ink3">근무시간</div>
              <div className="mt-1 text-sm font-extrabold text-teal">{hourText(summary.totalMin)}</div>
            </div>
            <div className="rounded-lg border border-border bg-panel-alt/40 p-2 text-center">
              <div className="text-[10px] font-bold text-ink3">지각</div>
              <div className={`mt-1 text-sm font-extrabold ${summary.lateDays > 0 ? 'text-amber-700 dark:text-amber-400 font-black' : 'text-ink'}`}>
                {summary.lateDays}회
              </div>
            </div>
            <div className="rounded-lg border border-border bg-panel-alt/40 p-2 text-center">
              <div className="text-[10px] font-bold text-ink3">결근</div>
              <div className={`mt-1 text-sm font-extrabold ${summary.absentDays > 0 ? 'text-rose-600 dark:text-rose-400 font-black' : 'text-ink'}`}>
                {summary.absentDays}일
              </div>
            </div>
            <div className="rounded-lg border border-border bg-panel-alt/40 p-2 text-center">
              <div className="text-[10px] font-bold text-ink3">휴가</div>
              <div className="mt-1 text-sm font-extrabold text-ink">{summary.leaveDays}일</div>
            </div>
          </div>
        </div>

        {/* 탭 필터 */}
        <div className="flex items-center gap-1.5 px-4 pt-3 border-b border-border pb-2 bg-panel">
          <button
            type="button"
            onClick={() => setFilterType('all')}
            className={`rounded-md px-2.5 py-1 text-[11px] font-bold transition-colors ${
              filterType === 'all' ? 'bg-teal text-white' : 'text-ink3 hover:text-ink hover:bg-panel-alt'
            }`}
          >
            전체 내역 ({person.records.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterType('work')}
            className={`rounded-md px-2.5 py-1 text-[11px] font-bold transition-colors ${
              filterType === 'work' ? 'bg-teal text-white' : 'text-ink3 hover:text-ink hover:bg-panel-alt'
            }`}
          >
            출근 ({summary.workDays})
          </button>
          <button
            type="button"
            onClick={() => setFilterType('anomaly')}
            className={`rounded-md px-2.5 py-1 text-[11px] font-bold transition-colors ${
              filterType === 'anomaly' ? 'bg-rose-600 text-white' : 'text-ink2 hover:bg-panel-alt'
            }`}
          >
            이상 근태 ({person.anomalyCount})
          </button>
          <button
            type="button"
            onClick={() => setFilterType('leave')}
            className={`rounded-md px-2.5 py-1 text-[11px] font-bold transition-colors ${
              filterType === 'leave' ? 'bg-teal text-white' : 'text-ink2 hover:bg-panel-alt'
            }`}
          >
            휴가 ({summary.leaveDays})
          </button>
        </div>

        {/* 일자별 상세 내역 목록 */}
        <div className="flex-1 overflow-y-auto p-4 divide-y divide-border/60">
          {filteredRecords.length === 0 ? (
            <div className="grid h-48 place-items-center text-xs text-ink3">
              해당하는 근태 내역이 없습니다.
            </div>
          ) : (
            filteredRecords.map((rec) => {
              const holiday = getKoreanHoliday(rec.date, holidayMap);
              const weekend = isWeekend(rec.date);

              return (
                <div key={rec.date} className="py-2.5 first:pt-0 last:pb-0 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span
                      className={`font-extrabold w-12 tabular-nums ${
                        holiday || rec.date.endsWith('일') ? 'text-rose-500/90' : weekend ? 'text-blue-500/90' : 'text-ink'
                      }`}
                    >
                      {rec.date.slice(5).replace('-', '/')}
                    </span>
                    {holiday && (
                      <span className="rounded bg-rose-500/10 border border-rose-500/20 px-1 py-0.2 text-[9px] font-bold text-rose-600 dark:text-rose-400">
                        {holiday}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="text-right text-[11px] tabular-nums">
                      <div className="font-semibold text-ink">
                        {timeOf(rec.inAt)} ~ {timeOf(rec.outAt)}
                      </div>
                      <div className="text-[10px] text-ink3">
                        {rec.totalMin > 0 && <span>{hourText(rec.totalMin)}</span>}
                        {rec.lateMin > 0 && <span className="ml-1 text-amber font-bold">(지각 {rec.lateMin}분)</span>}
                      </div>
                    </div>

                    <div className="min-w-16 text-right">
                      <StatusBadges
                        chips={describeCommuteRecord(rec)}
                        className="justify-end"
                        empty={<span className="text-[11px] text-ink3/70 font-medium">—</span>}
                      />
                    </div>
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
