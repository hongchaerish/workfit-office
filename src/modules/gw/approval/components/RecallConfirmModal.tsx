import { useState } from 'react';
import { RotateCcw, X, AlertTriangle, Users } from 'lucide-react';

export interface ApprovedApproverInfo {
  name: string;
  position?: string | null;
  dept?: string | null;
}

export function RecallConfirmModal({
  open,
  docTitle,
  approvedApprovers = [],
  busy,
  onConfirm,
  onClose,
}: {
  open: boolean;
  docTitle: string;
  approvedApprovers?: ApprovedApproverInfo[];
  busy?: boolean;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const hasApproved = approvedApprovers.length > 0;
  const isReasonValid = !hasApproved || reason.trim().length >= 5;

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] grid place-items-center bg-black/50 p-4 animate-fadeIn"
      onClick={() => !busy && onClose()}
    >
      <div
        className="flex max-h-[calc(90vh/var(--font-scale,1))] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-panel shadow-2xl border border-border"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between border-b border-border bg-amber-500/5 px-5 py-3.5">
          <div className="flex items-center gap-2 text-[14px] font-extrabold text-ink">
            <RotateCcw size={16} className="text-amber-600 dark:text-amber-400" />
            <span>{hasApproved ? '결재 진행 중 문서 회수' : '결재 문서 회수'}</span>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded-lg text-ink3 hover:bg-panel-alt transition-colors disabled:opacity-50"
          >
            <X size={16} />
          </button>
        </div>

        {/* 본문 */}
        <div className="p-5 space-y-4">
          <div className="text-[12.5px] text-ink font-semibold truncate bg-panel-alt/50 px-3 py-2 rounded-lg border border-border">
            📄 {docTitle}
          </div>

          {hasApproved ? (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 space-y-2 text-[12px] text-ink2">
              <div className="flex items-start gap-2 font-bold text-amber-700 dark:text-amber-400">
                <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                <span>이미 승인을 완료한 결재자가 있습니다.</span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 pl-5 text-[11px] text-ink3">
                <Users size={12} className="inline" />
                <span>승인 완료자:</span>
                {approvedApprovers.map((a, idx) => (
                  <span key={idx} className="font-bold text-ink2 bg-panel px-1.5 py-0.5 rounded border border-border">
                    {a.name} {a.position ? `(${a.position})` : ''}
                  </span>
                ))}
              </div>
              <p className="text-[11px] leading-relaxed text-ink3 pl-5">
                문서 회수 시 기승인자들에게 **회수 사유 알림이 전송**되며, 문서는 수정 후 재상신 가능한 <strong>'회수'</strong> 상태로 전환됩니다.
              </p>
            </div>
          ) : (
            <p className="text-[12px] leading-relaxed text-ink2 bg-panel-alt/40 p-3 rounded-xl border border-border">
              아직 아무도 승인하지 않은 문서입니다. 회수 후 내용을 수정하거나 재상신할 수 있습니다.
            </p>
          )}

          <div>
            <label className="block text-[11.5px] font-bold text-ink mb-1.5 flex items-center justify-between">
              <span>
                회수 사유 {hasApproved && <strong className="text-red-500">* (5자 이상 필수)</strong>}
              </span>
              <span className="text-[10.5px] text-ink3">{reason.trim().length}자</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={
                hasApproved
                  ? '기승인자에게 전달될 회수 사유를 구체적으로 입력하세요 (예: 첨부파일 누락, 계약 금액 오기입 등)'
                  : '회수 사유를 입력하세요 (선택 사항)'
              }
              rows={3}
              className="w-full rounded-xl border border-border-hi bg-panel px-3 py-2.5 text-[12px] text-ink outline-none focus:border-amber-500 resize-none transition-all placeholder:text-ink3/50"
            />
            {hasApproved && reason.trim().length > 0 && reason.trim().length < 5 && (
              <p className="mt-1 text-[11px] text-red-500">회수 사유를 최소 5자 이상 입력해주세요.</p>
            )}
          </div>
        </div>

        {/* 푸터 */}
        <div className="flex items-center justify-end gap-2 border-t border-border bg-panel-alt/20 px-5 py-3">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-lg border border-border px-3.5 py-1.5 text-[12px] font-bold text-ink2 hover:bg-panel-alt transition-colors disabled:opacity-50 cursor-pointer"
          >
            취소
          </button>
          <button
            type="button"
            disabled={busy || !isReasonValid}
            onClick={() => onConfirm(reason.trim())}
            className="rounded-lg bg-amber-600 px-4 py-1.5 text-[12px] font-bold text-white shadow-2xs hover:bg-amber-700 transition-colors disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
          >
            <RotateCcw size={13} />
            <span>{busy ? '회수 처리 중…' : '문서 회수하기'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
