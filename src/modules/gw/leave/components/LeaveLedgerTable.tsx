import { formatMinutes } from '@/domain/leave/substituteLedger';
import { useState, useMemo, useEffect } from 'react';
import type { LeaveLedgerEntry } from '@/domain/leave/ledger';
import { SUBSTITUTE_LEDGER_UPDATED_EVENT as SUBSTITUTE_HOLIDAY_UPDATED_EVENT } from '@/data/substituteLedger/substituteLedger.repo';
import {
  Search,
  Filter,
  SlidersHorizontal,
  Sparkles,
  Calendar,
  CalendarPlus,
} from 'lucide-react';

interface LeaveLedgerTableProps {
  entries: LeaveLedgerEntry[];
  calculationMode: 'HIRE_DATE' | 'FISCAL_YEAR';
  onToggleCalculationMode: (mode: 'HIRE_DATE' | 'FISCAL_YEAR') => void;
  /** 없으면 보기 전용(조정 칸 없음) */
  onOpenAdjustment?: (entry: LeaveLedgerEntry) => void;
  onOpenBatchSubstitute?: () => void;
  onSelectPerson?: (entry: LeaveLedgerEntry) => void;
  isAdmin: boolean;
}

export function LeaveLedgerTable({
  entries,
  calculationMode,
  onToggleCalculationMode,
  onOpenAdjustment,
  onOpenBatchSubstitute,
  onSelectPerson,
  isAdmin,
}: LeaveLedgerTableProps) {
  const [selectedDept, setSelectedDept] = useState('ALL');
  const [keyword, setKeyword] = useState('');
  const [onlyAdvance, setOnlyAdvance] = useState(false);
  const [onlyNegative, setOnlyNegative] = useState(false);
  const [onlySubstitute, setOnlySubstitute] = useState(false);

  // 대체휴무 실시간 반영 리스너
  const [subUpdateVer, setSubUpdateVer] = useState(0);
  useEffect(() => {
    const onSubUpdate = () => setSubUpdateVer((v) => v + 1);
    window.addEventListener(SUBSTITUTE_HOLIDAY_UPDATED_EVENT, onSubUpdate);
    return () => window.removeEventListener(SUBSTITUTE_HOLIDAY_UPDATED_EVENT, onSubUpdate);
  }, []);

  // 부서 목록 추출 (재직자 부서만 집계)
  const deptList = useMemo(() => {
    const set = new Set<string>();
    entries.forEach((e) => {
      if (e.isRetired) return;
      if (e.dept) set.add(e.dept);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'ko'));
  }, [entries]);

  // 필터링 적용 (퇴사자 100% 원천 배제)
  const filteredEntries = useMemo(() => {
    return entries.filter((e) => {
      if (e.isRetired) return false;
      if (selectedDept !== 'ALL' && e.dept !== selectedDept) return false;
      if (onlyAdvance && !e.advanceStatus.isAdvanceUsed) return false;
      if (onlyNegative && e.remainingDays >= 0) return false;
      if (onlySubstitute && e.substituteHoliday.detailList.length === 0) return false;

      if (keyword.trim()) {
        const q = keyword.trim().toLowerCase();
        const matchName = e.name.toLowerCase().includes(q);
        const matchEmpNo = e.empNo.toLowerCase().includes(q);
        const matchDept = e.dept.toLowerCase().includes(q);
        if (!matchName && !matchEmpNo && !matchDept) return false;
      }

      return true;
    });
  }, [entries, selectedDept, onlyAdvance, onlyNegative, onlySubstitute, keyword, subUpdateVer]);

  return (
    <div className="space-y-3">
      {/* 상단 컨트롤 바 */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-panel p-3 shadow-2xs">
        <div className="flex flex-wrap items-center gap-2">
          {/* 부서 필터 */}
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-ink2">
            <Filter size={13} className="text-ink3" />
            <select
              value={selectedDept}
              onChange={(e) => setSelectedDept(e.target.value)}
              className="h-8 rounded-lg border border-border bg-panel px-2.5 text-[11px] font-semibold text-ink outline-none focus:border-teal"
            >
              <option value="ALL">전체 부서 ({entries.length}명)</option>
              {deptList.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>

          {/* 검색창 */}
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink3" />
            <input
              type="text"
              placeholder="사원명, 사번 검색…"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              className="h-8 w-44 rounded-lg border border-border bg-panel pl-7 pr-2.5 text-[11px] text-ink outline-none placeholder:text-ink3 focus:w-56 focus:border-teal transition-all"
            />
          </div>

          {/* 특이사항 필터 칩 */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setOnlyAdvance((v) => !v)}
              className={`rounded-lg border px-2.5 py-1 text-[10.5px] font-bold transition-all ${
                onlyAdvance
                  ? 'border-amber-500/40 bg-amber-500/15 text-amber-600'
                  : 'border-border text-ink3 hover:bg-panel-alt'
              }`}
            >
              🏖️ 선사용 대상자
            </button>
            <button
              type="button"
              onClick={() => setOnlyNegative((v) => !v)}
              className={`rounded-lg border px-2.5 py-1 text-[10.5px] font-bold transition-all ${
                onlyNegative
                  ? 'border-rose-500/40 bg-rose-500/15 text-rose-500'
                  : 'border-border text-ink3 hover:bg-panel-alt'
              }`}
            >
              ⚠️ 마이너스 연차
            </button>
            <button
              type="button"
              onClick={() => setOnlySubstitute((v) => !v)}
              className={`rounded-lg border px-2.5 py-1 text-[10.5px] font-bold transition-all ${
                onlySubstitute
                  ? 'border-teal/40 bg-teal/15 text-teal'
                  : 'border-border text-ink3 hover:bg-panel-alt'
              }`}
            >
              📅 대체휴무 보유자
            </button>
          </div>
        </div>

        {/* 우측 컨트롤: 대체휴무 일괄 부여 버튼 & 산정 기준 전환 토글 */}
        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && onOpenBatchSubstitute && (
            <button
              type="button"
              onClick={onOpenBatchSubstitute}
              className="flex items-center gap-1.5 rounded-lg border border-teal/30 bg-teal/10 px-2.5 py-1 text-[11px] font-bold text-teal hover:bg-teal hover:text-white transition-all shadow-2xs"
            >
              <CalendarPlus size={13} />
              <span>대체휴무 일괄 부여</span>
            </button>
          )}

          {/* 산정 기준 전환 토글 (입사일 vs 회계연도) */}
          <div className="flex items-center gap-1.5 rounded-lg border border-border bg-panel-alt p-0.5 text-[11px] font-bold shadow-2xs">
            <button
              type="button"
              onClick={() => onToggleCalculationMode('HIRE_DATE')}
              className={`flex items-center gap-1 rounded-md px-2.5 py-1 transition-all ${
                calculationMode === 'HIRE_DATE'
                  ? 'bg-teal text-white shadow-2xs'
                  : 'text-ink3 hover:text-ink hover:bg-panel'
              }`}
            >
              <Sparkles size={12} />
              <span>입사일 기준 (법정 원칙)</span>
            </button>
            <button
              type="button"
              onClick={() => onToggleCalculationMode('FISCAL_YEAR')}
              className={`flex items-center gap-1 rounded-md px-2.5 py-1 transition-all ${
                calculationMode === 'FISCAL_YEAR'
                  ? 'bg-teal text-white shadow-2xs'
                  : 'text-ink3 hover:text-ink hover:bg-panel'
              }`}
            >
              <Calendar size={12} />
              <span>회계연도 기준 (1/1 정기)</span>
            </button>
          </div>
        </div>
      </div>

      {/* 연차 원장 데이터 테이블 */}
      <div className="overflow-hidden rounded-xl border border-border bg-panel shadow-2xs">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-[11.5px]">
            <thead>
              <tr className="border-b border-border bg-panel-alt/70 text-[10.5px] font-bold text-ink2">
                <th className="p-3">임직원 정보</th>
                <th className="p-3">입사일 / 근속</th>
                <th className="p-3 text-right">법정 발생</th>
                <th className="p-3 text-right">수동 조정</th>
                <th className="p-3 text-right">총 부여</th>
                <th className="p-3 text-right">사용</th>
                <th className="p-3 text-right">신청중</th>
                <th className="p-3 text-right">잔여 연차</th>
                <th className="p-3 text-center">대체휴무</th>
                <th className="p-3 text-center">선사용 / 상계 상태</th>
                {isAdmin && <th className="p-3 text-center">관리</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {filteredEntries.length === 0 ? (
                <tr>
                  <td colSpan={isAdmin ? 11 : 10} className="py-16 text-center text-xs text-ink3">
                    조건에 일치하는 임직원 연차 데이터가 없습니다.
                  </td>
                </tr>
              ) : (
                filteredEntries.map((e) => {
                  const hasAdvance = e.advanceStatus.isAdvanceUsed;
                  const isNegative = e.remainingDays < 0;

                  return (
                    <tr
                      key={`${e.empNo}-${e.name}`}
                      onClick={() => onSelectPerson?.(e)}
                      className="hover:bg-panel-alt/50 transition-colors group cursor-pointer"
                    >
                      {/* 임직원 정보 */}
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <div className="flex flex-col">
                            <div className="flex items-center gap-1.5">
                              <span className="font-extrabold text-ink group-hover:text-teal transition-colors">
                                {e.name}
                              </span>
                              {e.isRetired && (
                                <span className="rounded bg-rose-50 px-1 py-0.2 text-[9.5px] font-semibold text-rose-600 border border-rose-200">
                                  퇴사
                                </span>
                              )}
                            </div>
                            <span className="text-[10px] text-ink3">
                              {e.dept} · {e.position} ({e.empNo})
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* 입사일 & 근속기간 */}
                      <td className="p-3 tabular-nums">
                        <div className="font-semibold text-ink">{e.hireDate}</div>
                        <div className="text-[10px] text-ink3">
                          {e.isUnderOneYear
                            ? `1년 미만 (${e.serviceMonths}개월)`
                            : `${e.serviceYears}년 ${e.serviceMonths % 12}개월`}
                        </div>
                        <div className="text-[9.5px] text-ink3/80">
                          연차 기간 {e.leaveYear.start.slice(2).replace(/-/g, '.')}~{e.leaveYear.end.slice(2).replace(/-/g, '.')}
                        </div>
                      </td>

                      {/* 법정 발생 */}
                      <td className="p-3 text-right font-bold text-ink tabular-nums">
                        {e.entitledDays}일
                      </td>

                      {/* 수동 조정 */}
                      <td className="p-3 text-right tabular-nums font-semibold">
                        {e.adjustedDays !== 0 ? (
                          <span
                            className={e.adjustedDays > 0 ? 'text-emerald-600' : 'text-rose-500'}
                          >
                            {e.adjustedDays > 0 ? `+${e.adjustedDays}` : e.adjustedDays}일
                          </span>
                        ) : (
                          <span className="text-ink3/70">—</span>
                        )}
                      </td>

                      {/* 총 부여 */}
                      <td className="p-3 text-right font-extrabold text-ink tabular-nums bg-panel-alt/20">
                        {e.totalGrantedDays}일
                      </td>

                      {/* 사용 (승인완료) */}
                      <td className="p-3 text-right tabular-nums font-bold text-ink">
                        {e.usedDays > 0 ? (
                          <span className="text-emerald-600">{e.usedDays}일</span>
                        ) : (
                          <span className="text-ink3/70">0일</span>
                        )}
                      </td>

                      {/* 신청중 */}
                      <td className="p-3 text-right tabular-nums">
                        {e.pendingDays > 0 ? (
                          <span className="text-amber-500 font-bold">{e.pendingDays}일</span>
                        ) : (
                          <span className="text-ink3/70">—</span>
                        )}
                      </td>

                      {/* 순 잔여 */}
                      <td className="p-3 text-right tabular-nums">
                        <span
                          className={`inline-block rounded-md px-2 py-0.5 font-extrabold text-[12px] ${
                            isNegative
                              ? 'bg-rose-500/12 text-rose-500 border border-rose-500/25 ring-1 ring-rose-500/20'
                              : e.remainingDays === 0
                              ? 'bg-panel-alt text-ink3'
                              : 'bg-emerald-500/12 text-emerald-600 border border-emerald-500/25'
                          }`}
                        >
                          {e.remainingDays}일
                        </span>
                      </td>

                      {/* 대체휴무 현황 */}
                      {(() => {
                        const { totalMin: totalSubGranted, usedMin: usedSubDays, remainingMin: remainingSubDays } = e.substituteHoliday;

                        return (
                          <td className="p-3 text-center tabular-nums">
                            {totalSubGranted > 0 ? (
                              <div className="inline-flex flex-col items-center">
                                <span className="inline-block rounded-md bg-teal/15 px-2 py-0.5 text-[11px] font-extrabold text-teal border border-teal/25">
                                  잔여 {formatMinutes(remainingSubDays)}
                                </span>
                                <span className="text-[9.5px] text-ink3 mt-0.5">
                                  총 {formatMinutes(totalSubGranted)} ({usedSubDays > 0 ? `사용 ${formatMinutes(usedSubDays)}` : '미사용'})
                                </span>
                              </div>
                            ) : (
                              <span className="text-ink3/50 text-[10.5px]">—</span>
                            )}
                          </td>
                        );
                      })()}

                      {/* 선사용 / 상계 상태 */}
                      <td className="p-3 text-center">
                        {hasAdvance ? (
                          <div className="inline-flex flex-col items-center">
                            <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/12 px-2 py-0.5 text-[10px] font-extrabold text-amber-600 border border-amber-500/25">
                              <span>선사용 {e.advanceStatus.totalUsed}일</span>
                              <span>·</span>
                              <span>상계 {e.advanceStatus.offsetCompletedDays}일</span>
                            </span>
                            {e.advanceStatus.offsetRemainingDays > 0 && (
                              <span className="text-[9px] text-ink3 mt-0.5">
                                잔여 {e.advanceStatus.offsetRemainingDays}일 상계 대기
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-[10px] text-ink3/70">정상</span>
                        )}
                      </td>

                      {/* 관리자 조정 액션 */}
                      {isAdmin && (
                        <td className="p-3 text-center" onClick={(event) => event.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => onOpenAdjustment?.(e)}
                            className="inline-flex items-center gap-1 rounded-md border border-border bg-panel px-2 py-1 text-[10.5px] font-bold text-ink2 hover:bg-panel-alt hover:border-border-strong transition-colors"
                          >
                            <SlidersHorizontal size={11} />
                            <span>조정</span>
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
