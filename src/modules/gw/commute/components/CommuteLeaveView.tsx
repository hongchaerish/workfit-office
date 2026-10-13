import { useMemo } from 'react';
import type { CommutePersonRow } from '../types';
import { FileText, CalendarCheck2 } from 'lucide-react';
import { calculateLeaveDays } from '@/domain/leave/policy';
import { leaveChip } from '@/domain/commute/statusDisplay';
import { StatusBadge } from '@/features/commute/StatusBadge';

interface CommuteLeaveViewProps {
  month: string;
  approvals: any[];
  personMap: Map<number, CommutePersonRow>;
  onSelectPerson: (person: CommutePersonRow) => void;
}

export function CommuteLeaveView({ month, approvals, personMap, onSelectPerson }: CommuteLeaveViewProps) {
  // 당월에 걸쳐있는 승인 완료 휴가 문서들 추출
  const leaveDocs = useMemo(() => {
    return approvals
      .filter((doc) => doc.docType === '휴가' && doc.status === '완료' && doc.form?.startDate)
      .filter((doc) => {
        const start = doc.form.startDate;
        const end = doc.form.endDate || doc.form.startDate;
        // month(YYYY-MM)와 겹치는지 체크
        return start.slice(0, 7) === month || end.slice(0, 7) === month;
      })
      .sort((a, b) => (a.form.startDate || '').localeCompare(b.form.startDate || ''));
  }, [approvals, month]);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-panel shadow-2xs">
      <div className="flex flex-wrap items-center justify-between border-b border-border bg-panel-alt/50 px-4 py-3">
        <div className="flex items-center gap-2">
          <CalendarCheck2 size={16} className="text-teal" />
          <h3 className="text-xs font-extrabold text-ink">
            전사 승인 휴가 현황 ({month.slice(0, 4)}년 {Number(month.slice(5))}월 총 {leaveDocs.length}건)
          </h3>
        </div>
        <div className="text-[11px] text-ink3">
          전자결재를 통해 최종 승인된 공식 휴가 내역입니다.
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-[11.5px]">
          <thead>
            <tr className="border-b border-border bg-panel-alt/80 text-[10.5px] font-bold text-ink2">
              <th className="p-3">휴가 기간</th>
              <th className="p-3">신청자</th>
              <th className="p-3">소속 부서</th>
              <th className="p-3 text-center">휴가 구분</th>
              <th className="p-3 text-center">사용 일수</th>
              <th className="p-3">결재 문서명</th>
              <th className="p-3 text-center">상세 기록</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {leaveDocs.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-16 text-center text-xs text-ink3">
                  해당 월에 승인된 휴가 내역이 없습니다.
                </td>
              </tr>
            ) : (
              leaveDocs.map((doc) => {
                const drafterName = (doc.drafterName || '').trim();
                let matchedPerson: CommutePersonRow | undefined;
                for (const p of personMap.values()) {
                  if (p.name.trim() === drafterName) {
                    matchedPerson = p;
                    break;
                  }
                }

                const startDate = doc.form?.startDate;
                const endDate = doc.form?.endDate || startDate;
                const leaveType = doc.form?.leaveType || '연차';
                const daysCount = calculateLeaveDays({
                  leaveType,
                  startDate,
                  endDate,
                  rawDays: doc.form?.days,
                  title: doc.title,
                });

                return (
                  <tr
                    key={doc.id}
                    onClick={() => matchedPerson && onSelectPerson(matchedPerson)}
                    className="hover:bg-panel-alt/60 cursor-pointer transition-colors"
                  >
                    <td className="p-3 font-extrabold text-ink tabular-nums">
                      {startDate === endDate ? startDate : `${startDate} ~ ${endDate}`}
                    </td>
                    <td className="p-3 font-bold text-ink">
                      <span className="hover:text-teal transition-colors">{drafterName}</span>
                    </td>
                    <td className="p-3 text-ink2">{doc.drafterDept || matchedPerson?.dept || '—'}</td>
                    <td className="p-3 text-center">
                      <StatusBadge chip={leaveChip(leaveType, doc.title)} />
                    </td>
                    <td className="p-3 text-center tabular-nums font-bold text-ink">
                      {daysCount}일
                    </td>
                    <td className="p-3 text-ink2 truncate max-w-xs" title={doc.title}>
                      <span className="flex items-center gap-1.5">
                        <FileText size={12} className="text-ink3 shrink-0" />
                        <span className="truncate">{doc.title}</span>
                      </span>
                    </td>
                    <td className="p-3 text-center">
                      {matchedPerson && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectPerson(matchedPerson!);
                          }}
                          className="rounded-md bg-panel-alt hover:bg-teal hover:text-white px-2 py-1 text-[10px] font-bold text-ink2 border border-border transition-colors"
                        >
                          개인 근태
                        </button>
                      )}
                    </td>
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
