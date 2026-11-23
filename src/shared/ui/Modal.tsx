import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  footer?: ReactNode;
  width?: number;
  /** 본문 안쪽 여백 없이 — 도구 막대·나뉜 칸처럼 본문이 가장자리까지 닿는 창 */
  flush?: boolean;
  /** 겹침 층(z-index 클래스). 없으면 ModalLayerProvider 값(기본 'z-50'). 모바일 앱 틀(z-[100]) 위에 띄울 때 'z-[110]' */
  zClass?: string;
  children: ReactNode;
}

let openCount = 0;
let saved = { html: '', body: '' };

function lockScroll() {
  if (openCount++ > 0) return;
  saved = { html: document.documentElement.style.overflow, body: document.body.style.overflow };
  document.documentElement.style.overflow = 'hidden';
  document.body.style.overflow = 'hidden';
}

function unlockScroll() {
  if (--openCount > 0) return;
  document.documentElement.style.overflow = saved.html;
  document.body.style.overflow = saved.body;
}

/**
 * 공통 모달 — 디자인 토큰 패널(헤더/본문/푸터) 기준.
 * 오버레이 클릭·ESC 로 닫힘. 본문은 스크롤, 최대 높이는 화면의 88%.
 * (body zoom 배율이 vh 에 한 번 더 곱해지므로 --font-scale 로 나눠 실제 화면 기준으로 맞춘다)
 */
/**
 * 모달이 뜰 층(z-index 클래스). 모달은 body에 붙으므로, 자기보다 높은 층에 떠 있는 화면
 * (PWA 셸은 z-[100]) 안에서 열면 그 뒤에 깔린다. 그런 화면은 이 값으로 층을 올려 준다.
 */
const ModalLayerContext = createContext('z-50');
export const ModalLayerProvider = ModalLayerContext.Provider;

export function Modal({ open, onClose, title, footer, width = 480, flush = false, zClass, children }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // 열려 있는 동안 뒤 화면 스크롤 막기 (모달이 겹쳐 열려도 마지막 것이 닫힐 때 풀림)
  useEffect(() => {
    if (!open) return;
    lockScroll();
    return unlockScroll;
  }, [open]);

  // 직접 준 층(zClass)이 먼저, 없으면 감싼 화면이 정한 층(ModalLayerProvider)
  const contextLayer = useContext(ModalLayerContext);
  const layer = zClass ?? contextLayer;
  if (!open) return null;

  return createPortal(
    <div
      className={`fixed inset-0 ${layer} flex items-center justify-center overscroll-contain bg-navy-deep/45 p-4 backdrop-blur-[1px]`}
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        style={{ width }}
        className="flex max-h-[calc(88vh/var(--font-scale,1))] w-full max-w-full flex-col overflow-hidden rounded-xl border border-border bg-panel shadow-[0_20px_60px_rgba(16,24,48,0.32)]"
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
        <div className={`min-h-0 flex-1 overflow-y-auto ${flush ? '' : 'px-5 py-4'}`}>{children}</div>
        {footer && (
          <div className="flex flex-wrap justify-end gap-2 border-t border-border px-5 py-3.5">{footer}</div>
        )}
      </div>
    </div>,
    document.body,
  );
}
