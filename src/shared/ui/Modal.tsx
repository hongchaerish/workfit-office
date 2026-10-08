import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  footer?: ReactNode;
  width?: number;
  children: ReactNode;
}

/**
 * 공통 모달 — 디자인 토큰 패널(헤더/본문/푸터) 기준.
 * 오버레이 클릭·ESC 로 닫힘. 본문은 스크롤, 최대 높이는 화면의 88%.
 * (body zoom 배율이 vh 에 한 번 더 곱해지므로 --font-scale 로 나눠 실제 화면 기준으로 맞춘다)
 */
export function Modal({ open, onClose, title, footer, width = 480, children }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-navy-deep/45 p-4 backdrop-blur-[1px]"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        style={{ width }}
        className="flex max-h-[calc(88vh/var(--font-scale,1))] w-full flex-col overflow-hidden rounded-xl border border-border bg-panel shadow-[0_20px_60px_rgba(16,24,48,0.32)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <h2 className="text-[15px] font-bold text-ink">{title}</h2>
            <button
              onClick={onClose}
              aria-label="닫기"
              className="grid h-7 w-7 place-items-center rounded-md text-ink3 transition-colors hover:bg-panel-alt hover:text-ink"
            >
              <X size={16} />
            </button>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-border px-5 py-3.5">{footer}</div>
        )}
      </div>
    </div>,
    document.body,
  );
}
