import { useMemo } from 'react';
import type { CommutePersonRow } from '../types';
import { getKoreanHoliday } from '@/domain/commute/engine';
import { getLeaveBadgeLabel } from '@/domain/leave/policy';
import { Users } from 'lucide-react';

interface CommuteMatrixViewProps {
  month: string;
  rows: CommutePersonRow[];
  onSelectPerson: (person: CommutePersonRow) => void;
  holidayMap?: Map<string, string>;
}

const pad = (v: number) => String(v).padStart(2, '0');

const timeOfHM = (iso?: string | null): string => {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (!isNaN(d.getTime())) {
      const h = String(d.getHours()).padStart(2, '0');
      const m = String(d.getMinutes()).padStart(2, '0');
      return `${h}:${m}`;
    }
  } catch {
    // fallback
  }
  const match = iso.match(/T(\d{2}:\d{2})/);
  if (match) return match[1];
  if (iso.length >= 16) return iso.slice(11, 16);
  return '';
};

function CellStatusBadge({ status, leaveName, holidayName }: { status: string; leaveName?: string; holidayName?: string }) {
  if (status === 'unknown') {
    return <span className="text-[10px] text-ink3/40 font-mono">—</span>;
  }
  if (status === 'leave') {
    const badge = getLeaveBadgeLabel(leaveName);
    return (
      <span
        className="inline-flex items-center justify-center rounded bg-panel-alt border border-border px-1 py-0.2 text-[9px] font-bold text-ink2"
        title={badge.tooltip}
      >
        {badge.label}
      </span>
    );
  }
  if (status === 'off') {
    if (holidayName && holidayName !== '주말 휴무') {
      return (
        <span className="text-[8.5px] font-semibold text-rose-500/90 truncate max-w-[28px] inline-block" title={holidayName}>
          휴
        </span>
      );
    }
    return <span className="text-[9px] text-ink3/30">—</span>;
  }
  if (status === 'present' || status === 'normal') {
    if (leaveName) {
      const badge = getLeaveBadgeLabel(leaveName);
      return (
        <span
          className="inline-flex items-center justify-center rounded bg-panel-alt border border-teal/40 px-1 py-0.2 text-[9px] font-bold text-teal"
          title={`${badge.tooltip} (출근 완료)`}
        >
          {badge.label}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center justify-center font-bold text-[10px] text-teal/80" title="정상 출근">
        ●
      </span>
    );
  }
  if (status === 'holiday_work') {
    return (
      <span className="inline-flex items-center justify-center rounded bg-panel-alt border border-border px-1 py-0.2 text-[9px] font-medium text-ink2" title="휴일근무">
        휴근
      </span>
    );
  }
  if (status === 'late') {
    return (
      <span className="inline-flex items-center justify-center rounded bg-amber-500/10 border border-amber-500/25 px-1 py-0.2 text-[9px] font-bold text-amber-700 dark:text-amber-400" title="지각">
        지각
      </span>
    );
  }
  if (status === 'absent') {
    return (
      <span className="inline-flex items-center justify-center rounded bg-rose-500/10 border border-rose-500/25 px-1 py-0.2 text-[9px] font-bold text-rose-600 dark:text-rose-400" title="결근">
        결근
      </span>
    );
  }
  if (status === 'missing_in' || status === 'missing_out') {
    return (
      <span className="inline-flex items-center justify-center rounded bg-stone-500/10 border border-stone-500/25 px-1 py-0.2 text-[9px] font-medium text-stone-600 dark:text-stone-400" title="출/퇴근 미기록">
        미체크
      </span>
    );
  }
  return <span className="text-[9px] text-ink3/40 font-mono">—</span>;
}

export function CommuteMatrixView({ month, rows, onSelectPerson, holidayMap }: CommuteMatrixViewProps) {
  const [year, mm] = month.split('-').map(Number);

  const daysInMonth = useMemo(() => {
    if (!year || !mm) return [];
    const totalDays = new Date(year, mm, 0).getDate();
    const days: { dateStr: string; dayNum: number; isSun: boolean; isSat: boolean; holiday: string | null }[] = [];
    for (let d = 1; d <= totalDays; d++) {
      const dateStr = `${month}-${pad(d)}`;
      const dayOfWeek = new Date(year, mm - 1, d).getDay();
      days.push({
        dateStr,
        dayNum: d,
        isSun: dayOfWeek === 0,
        isSat: dayOfWeek === 6,
        holiday: getKoreanHoliday(dateStr, holidayMap),
      });
    }
    return days;
  }, [year, mm, month, holidayMap]);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-panel shadow-2xs w-full max-w-full min-w-0">
      {/* 상태 기호 범례 헤더 */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-panel-alt/50 px-3.5 py-2 text-[11px] text-ink3">
        <div className="flex items-center gap-1.5 font-bold text-ink2 shrink-0">
          <Users size={13} className="text-teal" />
          {/* 부서로 묶지 않고 전사 정렬 순서(업무계획 > 정렬 순서) 그대로 한 줄로 보인다. 좁혀 보기는 위 필터로 한다. */}
          <span>전 직원 근태 (총 {rows.length}명)</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[9.5px] font-semibold text-ink2">
          <span className="flex items-center gap-1"><span className="text-teal font-black">●</span> 정상</span>
          <span className="flex items-center gap-1"><span className="rounded bg-panel-alt border border-border px-1 py-0.2 text-[8.5px] font-bold text-ink2">반차</span> (오전/오후)</span>
          <span className="flex items-center gap-1"><span className="rounded bg-panel-alt border border-border px-1 py-0.2 text-[8.5px] font-bold text-ink2">반반</span> (2h)</span>
          <span className="flex items-center gap-1"><span className="rounded bg-amber-500/10 border border-amber-500/25 px-1 py-0.2 text-[8.5px] font-bold text-amber-700 dark:text-amber-400">지각</span></span>
          <span className="flex items-center gap-1"><span className="rounded bg-rose-500/10 border border-rose-500/25 px-1 py-0.2 text-[8.5px] font-bold text-rose-600 dark:text-rose-400">결근</span></span>
          <span className="flex items-center gap-1"><span className="rounded bg-stone-500/10 border border-stone-500/25 px-1 py-0.2 text-[8.5px] font-medium text-stone-600 dark:text-stone-400">미체크</span></span>
          <span className="flex items-center gap-1"><span className="text-ink3 font-mono">—</span> 휴무</span>
        </div>
      </div>

      {/* 단일 일체형 테이블 */}
      <div className="overflow-x-auto w-full max-w-full min-w-0">
        <table className="w-full border-collapse text-left text-[11px]">
          <thead className="sticky top-0 z-30 bg-panel-alt border-b border-border shadow-2xs">
            <tr className="text-[10.5px] font-bold text-ink2">
              <th className="sticky left-0 z-40 bg-panel-alt px-3 py-2.5 min-w-[150px] border-r border-border">
                직원
              </th>
              {daysInMonth.map(({ dateStr, dayNum, isSun, isSat, holiday }) => (
                <th
                  key={dateStr}
                  className={`px-0.5 py-1.5 text-center min-w-[46px] border-r border-border/40 ${
                    holiday || isSun ? 'bg-rose-500/5 text-rose-500/90' : isSat ? 'bg-blue-500/5 text-blue-500/90' : ''
                  }`}
                  title={holiday ? `${dayNum}일 (${holiday})` : `${dayNum}일`}
                >
                  <div className="font-extrabold text-[11px]">{dayNum}</div>
                  <div className="text-[8.5px] font-medium opacity-80">
                    {isSun ? '일' : isSat ? '토' : ''}
                  </div>
                </th>
              ))}
              <th className="px-2.5 py-2 text-center min-w-[55px] border-r border-border bg-panel-alt text-ink">
                근무일
              </th>
              <th className="px-2.5 py-2 text-center min-w-[55px] bg-panel-alt text-rose-600">
                이상
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={daysInMonth.length + 3} className="py-16 text-center text-xs text-ink3">
                  조건에 일치하는 임직원이 없습니다.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.empId}
                  onClick={() => onSelectPerson(row)}
                  className="group hover:bg-panel-alt/60 cursor-pointer transition-colors"
                >
                  {/* 고정 직원 열 */}
                  <td className="sticky left-0 z-10 bg-panel group-hover:bg-panel-alt/90 px-3 py-2 border-r border-border min-w-[150px] shadow-xs">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-bold text-ink group-hover:text-teal transition-colors flex items-center gap-1.5">
                          <span>{row.name}</span>
                          <span className="text-[10px] font-normal text-ink3">
                            {row.position || '사원'}
                          </span>
                        </div>
                        <div className="text-[9.5px] text-ink3">
                          {row.dept || '소속 미지정'}
                        </div>
                      </div>
                      {row.anomalyCount > 0 && (
                        <span
                          className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500/15 px-1 text-[9px] font-extrabold text-rose-600 border border-rose-500/30"
                          title={`이상 근태 ${row.anomalyCount}건`}
                        >
                          {row.anomalyCount}
                        </span>
                      )}
                    </div>
                  </td>

                  {/* 일자별 상태 셀 */}
                  {daysInMonth.map(({ dateStr, isSun, isSat, holiday }) => {
                    const record = row.recordsMap.get(dateStr);
                    const status = record?.status ?? 'unknown';
                    const inTime = timeOfHM(record?.inAt);
                    const outTime = timeOfHM(record?.outAt);

                    return (
                      <td
                        key={dateStr}
                        className={`px-0.5 py-1 text-center border-r border-border/30 tabular-nums select-none ${
                          holiday || isSun ? 'bg-rose-500/4' : isSat ? 'bg-blue-500/4' : ''
                        }`}
                        title={
                          record && (record.inAt || record.outAt)
                            ? `${record.date}: ${record.inAt ? record.inAt.slice(11, 16) : '미체크'} ~ ${record.outAt ? record.outAt.slice(11, 16) : '미체크'}`
                            : `${dateStr}`
                        }
                      >
                        <div className="flex flex-col items-center justify-center min-h-[50px] gap-0.5">
                          {/* 상단: 출근 시각 (지각 시 앰버 강조) */}
                          <span
                            className={`text-[10px] font-mono leading-none tracking-tight tabular-nums h-[11px] ${
                              status === 'late' && inTime
                                ? 'text-amber-700 dark:text-amber-400 font-extrabold'
                                : inTime
                                ? 'text-ink font-semibold'
                                : 'text-ink3/40'
                            }`}
                          >
                            {inTime || '\u00A0'}
                          </span>

                          {/* 중앙: 상태 뱃지 (●, 반차, 지각, 결근, — 등) */}
                          <div className="flex items-center justify-center my-0.5">
                            <CellStatusBadge
                              status={status}
                              leaveName={record?.leaveName}
                              holidayName={record?.holidayName}
                            />
                          </div>

                          {/* 하단: 퇴근 시각 */}
                          <span
                            className={`text-[10px] font-mono leading-none tracking-tight tabular-nums h-[11px] ${
                              outTime ? 'text-ink font-semibold' : 'text-ink3/40'
                            }`}
                          >
                            {outTime || '\u00A0'}
                          </span>
                        </div>
                      </td>
                    );
                  })}

                  {/* 요약 통계 */}
                  <td className="px-2 py-1 text-center font-extrabold text-ink border-r border-border tabular-nums bg-panel/30">
                    {row.summary.workDays}일
                  </td>
                  <td className="px-2 py-1 text-center font-extrabold tabular-nums bg-panel/30">
                    {row.anomalyCount > 0 ? (
                      <span className="text-rose-600 font-black">{row.anomalyCount}</span>
                    ) : (
                      <span className="text-ink3/40 font-normal">0</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
