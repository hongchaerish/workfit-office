import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { GitFork, X } from 'lucide-react';

/**
 * 기안 작성 — 결재선·수신처 편집 모달.
 *
 * 문서의 결재란이나 상단 [결재선] 버튼으로 연다. 편집 내용은 바로 기안에 반영되므로
 * 따로 저장 단계가 없고, 닫기·바깥 클릭·ESC 모두 "완료"와 같다.
 * 높이는 화면을 덮는 오버레이 기준(max-h-full)이라 화면 배율(body zoom)과 무관하게 화면 안에 들어온다.
 */
export function DraftApprovalLineModal({
  stepCount,
  onClose,
  children,
}: {
  stepCount: number;
  onClose: () => void;
  children: ReactNode;
}) {
  // 패널 안에서 누르고 바깥에서 뗀 드래그(글자 선택 등)로 닫히지 않게, 누른 곳과 뗀 곳이 모두 바깥일 때만 닫는다
  const pressedOnBackdropRef = useRef(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // 이 모달 위에 다른 창(결재자 선택·수신처 선택 등)이 떠 있으면 그 창이 먼저다 — 결재선 모달은 닫지 않는다
      if (overlayRef.current?.nextElementSibling) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[300] grid place-items-center bg-black/40 p-4"
      onMouseDown={(e) => { pressedOnBackdropRef.current = e.target === e.currentTarget; }}
      onClick={(e) => {
        if (pressedOnBackdropRef.current && e.target === e.currentTarget) onClose();
        pressedOnBackdropRef.current = false;
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="결재선 설정"
        className="flex max-h-full w-[600px] max-w-full flex-col overflow-hidden rounded-xl border border-border bg-panel shadow-2xl"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border bg-panel-alt/60 px-5 py-3.5">
          <span className="flex items-center gap-1.5 text-[14px] font-extrabold text-ink">
            <GitFork className="h-4 w-4 shrink-0 text-teal" />
            <span>결재선 설정</span>
            <span className="ml-1 text-[11px] font-semibold text-ink3">{stepCount}명 지정됨</span>
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="grid h-7 w-7 place-items-center rounded-md text-ink3 transition-colors hover:bg-panel-alt hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-5 py-4">{children}</div>
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-5 py-3">
          <span className="text-[10.5px] text-ink3">변경 내용은 바로 문서에 반영됩니다.</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-teal px-4 py-1.5 text-[12px] font-bold text-white transition-colors hover:bg-teal-dark"
          >
            완료
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
