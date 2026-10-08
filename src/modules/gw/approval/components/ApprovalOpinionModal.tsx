import { useState } from 'react';
import { PenTool, X } from 'lucide-react';

export function ApprovalOpinionModal({
  title = '결재 승인 확인',
  description,
  confirmText = '승인 처리',
  confirmTone = 'bg-teal',
  busy,
  onConfirm,
  onClose,
}: {
  title?: string;
  description?: React.ReactNode;
  confirmText?: string;
  confirmTone?: string;
  busy?: boolean;
  onConfirm: (comment: string) => void;
  onClose: () => void;
}) {
  const [comment, setComment] = useState('');

  return (
    <div
      className="fixed inset-0 z-[100] grid place-items-center bg-black/45 p-4 animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="flex max-h-[calc(90vh/var(--font-scale,1))] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-panel shadow-2xl border border-border"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border bg-panel-alt/30 px-5 py-3.5">
          <div className="flex items-center gap-2 text-[14px] font-extrabold text-ink">
            <PenTool size={16} className="text-teal" />
            <span>{title}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded-lg text-ink3 hover:bg-panel-alt transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {description && (
            <div className="text-[12px] leading-relaxed text-ink2 bg-panel-alt/50 p-3 rounded-xl border border-border">
              {description}
            </div>
          )}

          <div>
            <label className="block text-[11.5px] font-bold text-ink mb-1.5 flex items-center justify-between">
              <span>승인 의견 작성 <span className="text-[10px] font-normal text-ink3">(선택사항)</span></span>
            </label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="승인 관련 전달사항이나 의견을 자유롭게 입력하세요."
              rows={3}
              className="w-full rounded-xl border border-border-hi bg-panel px-3 py-2.5 text-[12px] text-ink outline-none focus:border-teal resize-none transition-all placeholder:text-ink3/50"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border bg-panel-alt/20 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-panel-alt px-3.5 py-2 text-[12px] font-bold text-ink2 hover:bg-border-hi/30 transition-colors"
          >
            취소
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onConfirm(comment)}
            className={`rounded-lg ${confirmTone} px-4 py-2 text-[12px] font-bold text-white hover:opacity-90 disabled:opacity-50 transition-colors shadow-sm`}
          >
            {busy ? '처리 중…' : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
