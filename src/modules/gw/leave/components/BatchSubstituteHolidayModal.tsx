import { useState, useMemo, useEffect } from 'react';
import {
  saveSubstituteHolidayGrant,
  deleteSubstituteHolidayGrant,
  getStoredSubstituteHolidays,
  type SubstituteHolidayGrant,
  SUBSTITUTE_HOLIDAY_UPDATED_EVENT,
} from '@/domain/leave/substituteHolidayStore';
import { Button } from '@/shared/ui/Button';
import {
  X,
  CalendarPlus,
  CalendarCheck2,
  Users,
  Trash2,
  History,
  Info,
} from 'lucide-react';

interface BatchSubstituteHolidayModalProps {
  adminName: string;
  employees?: Array<{
    empId: number;
    name: string;
    dept?: string | null;
    position?: string | null;
    hireDate?: string | null;
    isRetired?: boolean;
  }>;
  onClose: () => void;
  onSuccess?: () => void;
}

// 1년 뒤 만료일 기본 계산 헬퍼
function calculateDefaultExpiry(occurrence: string): string {
  if (!occurrence || occurrence.length !== 10) return '';
  const [y, m, d] = occurrence.split('-').map(Number);
  if (!y || !m || !d) return '';
  const nextYear = y + 1;
  const mm = String(m).padStart(2, '0');
  const dd = String(d).padStart(2, '0');
  return `${nextYear}-${mm}-${dd}`;
}

export function BatchSubstituteHolidayModal({
  adminName,
  employees = [],
  onClose,
  onSuccess,
}: BatchSubstituteHolidayModalProps) {
  const [activeTab, setActiveTab] = useState<'grant' | 'history'>('grant');

  // 입력 폼 상태
  const [targetMode, setTargetMode] = useState<'ALL' | 'CUSTOM'>('ALL');
  const [selectedEmpIds, setSelectedEmpIds] = useState<number[]>([]);
  const [empSearch, setEmpSearch] = useState('');

  const [occurrenceDate, setOccurrenceDate] = useState('2026-08-17');
  const [expirationDate, setExpirationDate] = useState('2027-08-17');
  const [days, setDays] = useState<number>(1);
  const [reason, setReason] = useState('8/17 대체공휴일 특근');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 저장소 이력 상태
  const [historyList, setHistoryList] = useState<SubstituteHolidayGrant[]>(() =>
    getStoredSubstituteHolidays(),
  );

  const refreshHistory = () => {
    setHistoryList(getStoredSubstituteHolidays());
  };

  useEffect(() => {
    window.addEventListener(SUBSTITUTE_HOLIDAY_UPDATED_EVENT, refreshHistory);
    return () => window.removeEventListener(SUBSTITUTE_HOLIDAY_UPDATED_EVENT, refreshHistory);
  }, []);

  // 발생일 변경 시 만료일 자동 계산
  const handleOccurrenceChange = (val: string) => {
    setOccurrenceDate(val);
    const autoExpiry = calculateDefaultExpiry(val);
    if (autoExpiry) {
      setExpirationDate(autoExpiry);
    }
  };

  // 재직 사원 필터링 (퇴사자 원천 제외)
  const activeEmployees = useMemo(() => {
    return employees.filter((e) => !e.isRetired);
  }, [employees]);

  // 사원 검색 필터링
  const filteredEmployees = useMemo(() => {
    if (!empSearch.trim()) return activeEmployees;
    const q = empSearch.trim().toLowerCase();
    return activeEmployees.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        (e.dept || '').toLowerCase().includes(q) ||
        String(e.empId).includes(q),
    );
  }, [activeEmployees, empSearch]);

  const toggleEmp = (empId: number) => {
    setSelectedEmpIds((prev) =>
      prev.includes(empId) ? prev.filter((id) => id !== empId) : [...prev, empId],
    );
  };

  const handleSelectAllFiltered = () => {
    // 발생일 기준 미입사자는 선택에서 자동 제외
    const validFiltered = filteredEmployees.filter(
      (e) => !(e.hireDate && occurrenceDate && e.hireDate > occurrenceDate),
    );
    const ids = validFiltered.map((e) => e.empId);
    setSelectedEmpIds((prev) => Array.from(new Set([...prev, ...ids])));
  };

  const handleClearSelected = () => {
    setSelectedEmpIds([]);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!occurrenceDate) {
      window.alert('대체휴무 발생일을 입력해 주세요.');
      return;
    }
    if (!expirationDate) {
      window.alert('유효 만료일을 입력해 주세요.');
      return;
    }
    if (expirationDate <= occurrenceDate) {
      window.alert('만료일은 발생일보다 미래 일자여야 합니다.');
      return;
    }
    if (days <= 0) {
      window.alert('부여 일수는 0.5일 이상이어야 합니다.');
      return;
    }
    if (!reason.trim()) {
      window.alert('부여 사유를 입력해 주세요.');
      return;
    }

    let targetScope: 'ALL' | string[] = 'ALL';
    let targetScopeLabel = '전체 임직원 (전사 일괄)';

    if (targetMode === 'CUSTOM') {
      // 발생일 기준 미입사자 제외
      const eligibleEmployees = employees.filter((e) => {
        if (!selectedEmpIds.includes(e.empId)) return false;
        if (e.hireDate && occurrenceDate && e.hireDate > occurrenceDate) {
          return false;
        }
        return true;
      });

      if (eligibleEmployees.length === 0) {
        window.alert(`선택한 사원은 모두 발생일(${occurrenceDate}) 기준 미입사자이므로 부여할 수 없습니다.`);
        return;
      }
      const selectedNames = eligibleEmployees.map((e) => e.name);
      targetScope = selectedNames;
      targetScopeLabel =
        selectedNames.length === 1
          ? selectedNames[0]
          : `${selectedNames[0]} 외 ${selectedNames.length - 1}명`;
    }

    setIsSubmitting(true);
    try {
      saveSubstituteHolidayGrant({
        targetScope,
        targetScopeLabel,
        occurrenceDate,
        expirationDate,
        days,
        reason: reason.trim(),
        grantedBy: adminName,
        grantedAt: new Date().toISOString().slice(0, 10),
      });

      window.alert(`[${targetScopeLabel}] 대상 ${days}일 대체휴무가 성공적으로 부여되었습니다.`);
      refreshHistory();
      onSuccess?.();
      setActiveTab('history');
    } catch (err) {
      console.error(err);
      window.alert('대체휴무 저장 중 오류가 발생했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = (id: string, label: string, r: string) => {
    if (!window.confirm(`[${label}]의 대체휴무(${r}) 부여 내역을 회수/삭제하시겠습니까?`)) {
      return;
    }
    deleteSubstituteHolidayGrant(id);
    refreshHistory();
    onSuccess?.();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="w-full max-w-xl rounded-2xl border border-border bg-panel shadow-2xl overflow-hidden flex flex-col max-h-[calc(90vh/var(--font-scale,1))]">
        {/* 모달 헤더 */}
        <div className="flex items-center justify-between border-b border-border bg-panel-alt/50 px-5 py-4 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-teal/15 text-teal shadow-2xs">
              <CalendarPlus size={19} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-[14.5px] font-extrabold text-ink">대체휴무 일괄 및 개별 부여 관리</h3>
              </div>
              <p className="text-[11px] text-ink3 mt-0.5">
                휴일·대체공휴일 특근에 대한 보상 대체휴무를 안전하게 부여하고 관리합니다.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-ink3 hover:bg-panel-alt hover:text-ink transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* 탭 네비게이션 */}
        <div className="flex items-center border-b border-border bg-panel-alt/30 px-5 pt-2 gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('grant')}
            className={`flex items-center gap-1.5 px-3 py-2 text-[12px] font-bold border-b-2 transition-all ${activeTab === 'grant'
              ? 'border-teal text-teal'
              : 'border-transparent text-ink3 hover:text-ink hover:border-border'
              }`}
          >
            <CalendarPlus size={13} />
            <span>대체휴무 부여</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className={`flex items-center gap-1.5 px-3 py-2 text-[12px] font-bold border-b-2 transition-all ${activeTab === 'history'
              ? 'border-teal text-teal'
              : 'border-transparent text-ink3 hover:text-ink hover:border-border'
              }`}
          >
            <History size={13} />
            <span>부여 이력 및 회수 ({historyList.length}건)</span>
          </button>
        </div>

        {/* 바디 영역 (스크롤 가능) */}
        <div className="p-5 overflow-y-auto space-y-4">
          {activeTab === 'grant' ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* 안내 배너 */}
              <div className="rounded-xl border border-teal/20 bg-teal/5 p-3 text-[11.5px] text-ink2 flex items-start gap-2.5">
                <Info size={16} className="text-teal shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold text-teal"> 부여된 대체휴무는 발생일 기준 1년간 유효하며, 전자결재 시 선입선출로 자동 차감됩니다.</span>
                </div>
              </div>

              {/* 1. 부여 대상 선택 */}
              <div className="space-y-1.5">
                <label className="text-[11.5px] font-bold text-ink">부여 대상</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setTargetMode('ALL')}
                    className={`flex items-center justify-center gap-2 rounded-xl border p-2.5 text-xs font-bold transition-all ${targetMode === 'ALL'
                      ? 'border-teal bg-teal/10 text-teal shadow-2xs ring-1 ring-teal/30'
                      : 'border-border bg-panel text-ink3 hover:bg-panel-alt'
                      }`}
                  >
                    <Users size={14} />
                    <span>전체 임직원 (전사 일괄)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setTargetMode('CUSTOM')}
                    className={`flex items-center justify-center gap-2 rounded-xl border p-2.5 text-xs font-bold transition-all ${targetMode === 'CUSTOM'
                      ? 'border-teal bg-teal/10 text-teal shadow-2xs ring-1 ring-teal/30'
                      : 'border-border bg-panel text-ink3 hover:bg-panel-alt'
                      }`}
                  >
                    <CalendarCheck2 size={14} />
                    <span>특정 대상자 직접 선택</span>
                  </button>
                </div>

                {targetMode === 'CUSTOM' && (
                  <div className="mt-2 rounded-xl border border-border bg-panel-alt/30 p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <input
                        type="text"
                        placeholder="이름, 부서 검색…"
                        value={empSearch}
                        onChange={(e) => setEmpSearch(e.target.value)}
                        className="h-7 w-48 rounded-lg border border-border bg-panel px-2 text-[11px] text-ink outline-none focus:border-teal"
                      />
                      <div className="flex items-center gap-1.5 text-[10.5px]">
                        <button
                          type="button"
                          onClick={handleSelectAllFiltered}
                          className="text-teal font-bold hover:underline"
                        >
                          검색결과 전체선택
                        </button>
                        <span className="text-border">|</span>
                        <button
                          type="button"
                          onClick={handleClearSelected}
                          className="text-ink3 hover:underline"
                        >
                          선택해제 ({selectedEmpIds.length}명)
                        </button>
                      </div>
                    </div>

                    <div className="max-h-36 overflow-y-auto divide-y divide-border/60 rounded-lg border border-border bg-panel text-[11px]">
                      {filteredEmployees.length === 0 ? (
                        <div className="p-3 text-center text-ink3">일치하는 사원이 없습니다.</div>
                      ) : (
                        filteredEmployees.map((emp) => {
                          const isNotHiredYet = Boolean(emp.hireDate && occurrenceDate && emp.hireDate > occurrenceDate);
                          const isChecked = selectedEmpIds.includes(emp.empId);
                          return (
                            <label
                              key={emp.empId}
                              className={`flex items-center justify-between p-2 transition-colors ${isNotHiredYet
                                  ? 'opacity-50 cursor-not-allowed bg-panel-alt/20'
                                  : 'hover:bg-panel-alt cursor-pointer'
                                }`}
                            >
                              <div className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={isChecked && !isNotHiredYet}
                                  disabled={isNotHiredYet}
                                  onChange={() => !isNotHiredYet && toggleEmp(emp.empId)}
                                  className="rounded border-border text-teal focus:ring-teal disabled:cursor-not-allowed"
                                />
                                <span className="font-bold text-ink">{emp.name}</span>
                                <span className="text-[10px] text-ink3">
                                  {emp.dept} · {emp.position}
                                </span>
                              </div>
                              {isNotHiredYet && (
                                <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[9.5px] font-bold text-rose-500 border border-rose-500/25">
                                  미입사 ({emp.hireDate} 입사)
                                </span>
                              )}
                            </label>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* 2. 발생일 및 퀵 칩 */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[11.5px] font-bold text-ink">특근 발생일</label>
                  {/* 최근 특근 일자 퀵 추천 칩 */}
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-ink3">추천:</span>
                    <button
                      type="button"
                      onClick={() => {
                        handleOccurrenceChange('2026-08-17');
                        setReason('8/17 대체공휴일 특근');
                      }}
                      className="rounded-md border border-border bg-panel-alt px-2 py-0.5 text-[10px] font-bold text-ink hover:border-teal hover:text-teal transition-all"
                    >
                      8/17 대체공휴일
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        handleOccurrenceChange('2026-08-29');
                        setReason('8/29 토요 특근');
                      }}
                      className="rounded-md border border-border bg-panel-alt px-2 py-0.5 text-[10px] font-bold text-ink hover:border-teal hover:text-teal transition-all"
                    >
                      8/29 토요특근
                    </button>
                  </div>
                </div>

                <input
                  type="date"
                  value={occurrenceDate}
                  onChange={(e) => handleOccurrenceChange(e.target.value)}
                  className="w-full rounded-xl border border-border bg-panel px-3 py-2 text-xs font-semibold text-ink outline-none focus:border-teal"
                  required
                />
              </div>

              {/* 3. 부여 일수 & 유효 만료일 */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-[11.5px] font-bold text-ink">부여 일수</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      step="0.5"
                      min="0.5"
                      max="10"
                      value={days}
                      onChange={(e) => setDays(Number(e.target.value))}
                      className="w-full rounded-xl border border-border bg-panel px-3 py-2 text-xs font-extrabold text-ink outline-none focus:border-teal"
                      required
                    />
                    <div className="flex gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => setDays(1.0)}
                        className={`rounded-lg border px-2 py-1.5 text-[10.5px] font-bold ${days === 1.0 ? 'border-teal bg-teal text-white' : 'border-border bg-panel-alt text-ink3'
                          }`}
                      >
                        1일
                      </button>
                      <button
                        type="button"
                        onClick={() => setDays(0.5)}
                        className={`rounded-lg border px-2 py-1.5 text-[10.5px] font-bold ${days === 0.5 ? 'border-teal bg-teal text-white' : 'border-border bg-panel-alt text-ink3'
                          }`}
                      >
                        0.5일
                      </button>
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-[11.5px] font-bold text-ink">유효 만료일</label>
                    <span className="text-[10px] text-ink3 font-medium">(기본 발생+1년)</span>
                  </div>
                  <input
                    type="date"
                    value={expirationDate}
                    onChange={(e) => setExpirationDate(e.target.value)}
                    className="w-full rounded-xl border border-border bg-panel px-3 py-2 text-xs font-semibold text-ink outline-none focus:border-teal"
                    required
                  />
                </div>
              </div>

              {/* 4. 부여 사유 */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[11.5px] font-bold text-ink">발생 사유</label>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setReason('8/17 대체공휴일 특근')}
                      className="text-[10px] text-ink3 hover:text-teal underline"
                    >
                      #8/17특근
                    </button>
                    <button
                      type="button"
                      onClick={() => setReason('8/29 토요 특근')}
                      className="text-[10px] text-ink3 hover:text-teal underline"
                    >
                      #8/29특근
                    </button>
                    <button
                      type="button"
                      onClick={() => setReason('주말 비상 대응 근무')}
                      className="text-[10px] text-ink3 hover:text-teal underline"
                    >
                      #비상근무
                    </button>
                  </div>
                </div>
                <input
                  type="text"
                  placeholder="예: 8/17 대체공휴일 특근 지원"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="w-full rounded-xl border border-border bg-panel px-3 py-2 text-xs font-medium text-ink outline-none focus:border-teal"
                  required
                />
              </div>

              {/* 제출 버튼 */}
              <div className="pt-2 flex justify-end gap-2">
                <Button variant="ghost" type="button" onClick={onClose} disabled={isSubmitting}>
                  닫기
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? '저장 중…' : '대체휴무 부여'}
                </Button>
              </div>
            </form>
          ) : (
            /* 이력 및 관리 탭 */
            <div className="space-y-3">
              <div className="flex items-center justify-between text-[11.5px] text-ink3">
                <span>현재 등록된 관리자 부여 이력</span>
                <span className="font-bold text-ink">총 {historyList.length}건</span>
              </div>

              {historyList.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border p-10 text-center text-xs text-ink3 space-y-2">
                  <p>등록된 대체휴무 부여 내역이 없습니다.</p>
                  <p className="text-[11px]">
                    상단의 [대체휴무 부여] 탭에서 8/17 또는 8/29 특근 대체휴무를 등록해 주세요.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-border/60 rounded-xl border border-border bg-panel overflow-hidden">
                  {historyList.map((item) => (
                    <div
                      key={item.id}
                      className="p-3.5 flex items-center justify-between gap-3 hover:bg-panel-alt/40 transition-colors"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="rounded-md bg-teal/15 px-2 py-0.5 text-[11px] font-extrabold text-teal">
                            +{item.days}일
                          </span>
                          <span className="font-bold text-ink text-xs">{item.reason}</span>
                          <span className="rounded bg-panel-alt px-1.5 py-0.5 text-[10px] text-ink2 border border-border">
                            {item.targetScopeLabel}
                          </span>
                        </div>
                        <div className="text-[11px] text-ink3 flex items-center gap-3">
                          <span>발생일: <strong className="text-ink">{item.occurrenceDate}</strong></span>
                          <span>만료일: <strong className="text-ink">{item.expirationDate}</strong></span>
                          <span>등록: {item.grantedBy} ({item.grantedAt})</span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleDelete(item.id, item.targetScopeLabel, item.reason)}
                        className="rounded-lg border border-rose-500/30 p-2 text-rose-500 hover:bg-rose-500/10 transition-colors shrink-0"
                        title="부여 회수/삭제"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
