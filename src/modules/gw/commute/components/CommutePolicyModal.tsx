import { useState } from 'react';
import { Clock, ShieldAlert, Check, X, Info } from 'lucide-react';
import type { CommutePolicy } from '@/domain/commutePolicy/schema';
import { breakMinutesOf, policyTimeError } from '@/domain/commutePolicy/validate';

interface Props {
  policy: CommutePolicy;
  isOpen: boolean;
  onClose: () => void;
  onSave: (updated: CommutePolicy) => Promise<unknown>;
}

export function CommutePolicyModal({ policy, isOpen, onClose, onSave }: Props) {
  const [formData, setFormData] = useState<CommutePolicy>(policy);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const timeError = policyTimeError(formData);
    if (timeError) {
      setError(timeError);
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSave({ ...formData, breakMin: breakMinutesOf(formData.breakStartTime, formData.breakEndTime) });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl overflow-hidden border border-slate-200">
        <header className="flex items-center justify-between border-b border-slate-100 bg-slate-900 px-6 py-4 text-white">
          <div className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-amber-500/20 text-amber-400">
              <Clock size={18} />
            </div>
            <div>
              <h2 className="text-[16px] font-bold">근무시간 및 근태 정책 설정</h2>
              <p className="text-[11.5px] text-slate-400">정규 출/퇴근 시간 및 지각 산정 기준</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors">
            <X size={18} />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {error && (
            <div className="flex items-center gap-2 rounded-xl bg-rose-50 p-3 text-[12.5px] text-rose-600 border border-rose-200">
              <ShieldAlert size={16} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* 정책명 */}
          <div>
            <label className="block text-[12.5px] font-bold text-slate-700 mb-1">근무제 명칭</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-[13px] text-slate-800 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
              placeholder="예: 전사 표준 근무제 (08:30~17:30)"
              required
            />
          </div>

          {/* 정규 출/퇴근 시간 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[12.5px] font-bold text-slate-700 mb-1">정규 출근 시간</label>
              <input
                type="time"
                value={formData.workStartTime}
                onChange={(e) => setFormData({ ...formData, workStartTime: e.target.value })}
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-[13px] font-semibold text-slate-800 focus:border-amber-500 focus:outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-[12.5px] font-bold text-slate-700 mb-1">정규 퇴근 시간</label>
              <input
                type="time"
                value={formData.workEndTime}
                onChange={(e) => setFormData({ ...formData, workEndTime: e.target.value })}
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-[13px] font-semibold text-slate-800 focus:border-amber-500 focus:outline-none"
                required
              />
            </div>
          </div>

          {/* 휴게(점심) 시간 */}
          <div className="rounded-xl bg-slate-50 p-3.5 border border-slate-100 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[12.5px] font-bold text-slate-800">점심 / 휴게 시간</span>
              <span className="text-[11.5px] font-semibold text-slate-500">기본 {breakMinutesOf(formData.breakStartTime, formData.breakEndTime)}분 공제</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <span className="block text-[11px] text-slate-500 mb-1">휴게 시작</span>
                <input
                  type="time"
                  value={formData.breakStartTime}
                  onChange={(e) => setFormData({ ...formData, breakStartTime: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12.5px] text-slate-800 focus:border-amber-500 focus:outline-none"
                  required
                />
              </div>
              <div>
                <span className="block text-[11px] text-slate-500 mb-1">휴게 종료</span>
                <input
                  type="time"
                  value={formData.breakEndTime}
                  onChange={(e) => setFormData({ ...formData, breakEndTime: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12.5px] text-slate-800 focus:border-amber-500 focus:outline-none"
                  required
                />
              </div>
            </div>
          </div>

          {/* 세부 판정 기준 */}
          <div>
            <label className="block text-[12px] font-bold text-slate-700 mb-1">지각 유예 시간(분)</label>
            <input
              type="number"
              min={0}
              max={60}
              value={formData.lateGraceMin}
              onChange={(e) => setFormData({ ...formData, lateGraceMin: Number(e.target.value) })}
              className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-[13px] text-slate-800 focus:border-amber-500 focus:outline-none"
            />
            <span className="text-[10.5px] text-slate-400 mt-0.5 block">예: 0분 (정시 이후 지각)</span>
          </div>

          <div className="flex items-start gap-2 rounded-xl bg-amber-50/70 p-3 text-[11.5px] text-amber-800 border border-amber-200/50">
            <Info size={15} className="shrink-0 mt-0.5 text-amber-600" />
            <span>설정한 출/퇴근 기준 시각은 전사 임직원의 일일 근태 상태(정상·지각) 및 근무시간 집계에 실시간 자동 반영됩니다.</span>
          </div>

          {/* 버튼 영역 */}
          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-200 px-4 py-2.5 text-[13px] font-bold text-slate-600 hover:bg-slate-50 transition-colors"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-1.5 rounded-xl bg-amber-500 px-5 py-2.5 text-[13px] font-bold text-white shadow-sm shadow-amber-500/20 hover:bg-amber-600 disabled:opacity-50 transition-all cursor-pointer"
            >
              <Check size={16} />
              {saving ? '저장 중…' : '설정 저장'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
