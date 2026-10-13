import { useState } from 'react';
import type { LeaveLedgerEntry } from '@/domain/leave/ledger';
import {
  saveAdjustment,
  type AdjustmentType,
} from '@/domain/leave/adjustmentStore';
import { Button } from '@/shared/ui/Button';
import { X, Plus, Minus, Award, AlertCircle, History } from 'lucide-react';

interface LeaveAdjustmentModalProps {
  entry: LeaveLedgerEntry;
  adminName: string;
  onClose: () => void;
  onSuccess: () => void;
}

const ADJUSTMENT_TYPES: Array<{ type: AdjustmentType; label: string; defaultSign: number }> = [
  { type: 'REWARD', label: '포상휴가 부여 (+)', defaultSign: 1 },
  { type: 'SPECIAL', label: '특별휴가 부여 (+)', defaultSign: 1 },
  { type: 'MANUAL', label: '기타 수동 가감', defaultSign: 1 },
  { type: 'PENALTY', label: '공제 / 차감 (-)', defaultSign: -1 },
  { type: 'CARRYOVER', label: '전년도 이월 조정', defaultSign: 1 },
];

export function LeaveAdjustmentModal({
  entry,
  adminName,
  onClose,
  onSuccess,
}: LeaveAdjustmentModalProps) {
  const [selectedType, setSelectedType] = useState<AdjustmentType>('REWARD');
  const [days, setDays] = useState<number>(1);
  const [isDeduction, setIsDeduction] = useState(false);
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const delta = (isDeduction ? -1 : 1) * Math.abs(days);
  const expectedRemaining = Number((entry.remainingDays + delta).toFixed(2));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (days <= 0) {
      window.alert('가감 일수를 0.25일 이상 입력해 주세요.');
      return;
    }
    if (!reason.trim()) {
      window.alert('조정 사유를 반드시 입력해 주세요 (노무 감사 대비 증빙).');
      return;
    }

    setIsSubmitting(true);
    try {
      await saveAdjustment({
        empId: entry.empId,
        empName: entry.name,
        empNo: entry.empNo,
        type: selectedType,
        deltaDays: delta,
        reason: reason.trim(),
        grantedAt: new Date().toISOString().slice(0, 10),
        grantedBy: adminName,
      });

      window.alert(`[${entry.name}] 님의 연차 ${delta > 0 ? `+${delta}` : delta}일 조정이 완료되었습니다.`);
      onSuccess();
      onClose();
    } catch (err) {
      console.error(err);
      window.alert('연차 조정 저장 중 오류가 발생했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-panel shadow-2xl overflow-hidden">
        {/* 헤더 */}
        <div className="flex items-center justify-between border-b border-border bg-panel-alt/50 px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-teal/15 text-teal">
              <Award size={18} />
            </div>
            <div>
              <h3 className="text-[14px] font-extrabold text-ink">연차 수동 가감 (관리자 조정)</h3>
              <p className="text-[11px] text-ink3">
                {entry.dept} · {entry.position} {entry.name} ({entry.empNo})
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

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* 대상자 요약 카드 */}
          <div className="grid grid-cols-3 gap-2 rounded-xl border border-border bg-panel-alt/30 p-3 text-center">
            <div>
              <div className="text-[10px] text-ink3 font-bold">법정 발생</div>
              <div className="text-[14px] font-extrabold text-ink">{entry.entitledDays}일</div>
            </div>
            <div>
              <div className="text-[10px] text-ink3 font-bold">현재 잔여</div>
              <div
                className={`text-[14px] font-extrabold ${
                  entry.remainingDays < 0 ? 'text-rose-500' : 'text-emerald-600'
                }`}
              >
                {entry.remainingDays}일
              </div>
            </div>
            <div>
              <div className="text-[10px] text-teal font-bold">조정 후 잔여</div>
              <div className="text-[14px] font-extrabold text-teal tabular-nums">
                {expectedRemaining}일
              </div>
            </div>
          </div>

          {/* 가감 유형 선택 */}
          <div>
            <label className="block text-[11px] font-extrabold text-ink2 mb-1.5">조정 유형</label>
            <div className="grid grid-cols-2 gap-1.5">
              {ADJUSTMENT_TYPES.map((t) => (
                <button
                  key={t.type}
                  type="button"
                  onClick={() => {
                    setSelectedType(t.type);
                    setIsDeduction(t.defaultSign < 0);
                  }}
                  className={`flex items-center justify-between rounded-lg border px-3 py-2 text-[11px] font-bold transition-all ${
                    selectedType === t.type
                      ? 'border-teal bg-teal/10 text-teal ring-1 ring-teal/30'
                      : 'border-border bg-panel text-ink3 hover:border-border-strong hover:bg-panel-alt'
                  }`}
                >
                  <span>{t.label}</span>
                  {selectedType === t.type && <span className="h-1.5 w-1.5 rounded-full bg-teal" />}
                </button>
              ))}
            </div>
          </div>

          {/* 일수 설정 (+ / -) */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-extrabold text-ink2 mb-1.5">부여 / 차감 방향</label>
              <div className="flex rounded-lg border border-border bg-panel-alt p-0.5">
                <button
                  type="button"
                  onClick={() => setIsDeduction(false)}
                  className={`flex-1 flex items-center justify-center gap-1 rounded-md py-1.5 text-[11px] font-extrabold transition-all ${
                    !isDeduction ? 'bg-panel text-emerald-600 shadow-xs' : 'text-ink3 hover:text-ink'
                  }`}
                >
                  <Plus size={13} />
                  <span>부여 (+)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsDeduction(true)}
                  className={`flex-1 flex items-center justify-center gap-1 rounded-md py-1.5 text-[11px] font-extrabold transition-all ${
                    isDeduction ? 'bg-panel text-rose-500 shadow-xs' : 'text-ink3 hover:text-ink'
                  }`}
                >
                  <Minus size={13} />
                  <span>차감 (-)</span>
                </button>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-extrabold text-ink2 mb-1.5">조정 일수 (일)</label>
              <input
                type="number"
                step="0.25"
                min="0.25"
                max="30"
                value={days}
                onChange={(e) => setDays(parseFloat(e.target.value) || 0)}
                className="w-full rounded-lg border border-border bg-panel px-3 py-1.5 text-[12px] font-extrabold text-ink outline-none focus:border-teal"
              />
            </div>
          </div>

          {/* 사유 입력 */}
          <div>
            <label className="block text-[11px] font-extrabold text-ink2 mb-1.5">
              조정 사유 <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              placeholder="예: 프로젝트 오픈 유공 포상휴가 부여, 지각 누적 공제 등"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full rounded-lg border border-border bg-panel px-3 py-2 text-[11.5px] text-ink outline-none placeholder:text-ink3 focus:border-teal"
            />
          </div>

          {/* 이전 가감 이력 타임라인 */}
          {entry.adjustmentHistory.length > 0 && (
            <div className="rounded-xl border border-border/80 bg-panel-alt/20 p-3">
              <div className="flex items-center gap-1.5 text-[10.5px] font-extrabold text-ink2 mb-2">
                <History size={13} className="text-ink3" />
                <span>이전 수동 조정 이력 ({entry.adjustmentHistory.length}건)</span>
              </div>
              <div className="max-h-24 overflow-y-auto space-y-1.5 pr-1 text-[10.5px]">
                {entry.adjustmentHistory.map((tx) => (
                  <div key={tx.id} className="flex items-center justify-between rounded-md bg-panel p-1.5 border border-border/60">
                    <span className="text-ink3">{tx.grantedAt}</span>
                    <span className="font-semibold text-ink truncate max-w-[180px]">{tx.reason}</span>
                    <span className={`font-extrabold ${tx.deltaDays > 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                      {tx.deltaDays > 0 ? `+${tx.deltaDays}` : tx.deltaDays}일
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-1.5 text-[10.5px] text-ink3">
            <AlertCircle size={13} className="shrink-0 text-amber-500" />
            <span>수동 조정 내역은 감사 이력으로 영구 보존되며 즉시 연차 원장에 합산됩니다.</span>
          </div>

          {/* 버튼 액션 */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
            <Button type="button" variant="secondary" size="sm" onClick={onClose} disabled={isSubmitting}>
              취소
            </Button>
            <Button type="submit" variant="primary" size="sm" disabled={isSubmitting}>
              {isSubmitting ? '저장 중…' : '조정 내용 저장'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
