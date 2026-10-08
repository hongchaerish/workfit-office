import { useEffect, useRef, useState } from 'react';
import { ArrowUp } from 'lucide-react';

/** 이만큼(px) 넘게 내려가면 버튼을 띄운다 */
const SHOW_AFTER = 300;

type ScrollTarget = Element | Window;

const scrollTopOf = (t: ScrollTarget) => (t instanceof Window ? window.scrollY : (t as Element).scrollTop);

/**
 * 모든 화면 우측 하단의 [맨 위로] 버튼.
 *
 * 화면마다 스크롤되는 곳이 다르다 — 그룹웨어는 창(window), 그 외는 본문(main), 일부 화면은
 * 자체 스크롤 영역을 쓴다. 그래서 문서 전체의 scroll 이벤트를 캡처 단계에서 받아
 * **마지막으로 스크롤된 큰 영역**을 기억하고, 버튼은 그 영역을 맨 위로 올린다.
 * 모달·메신저 도크처럼 화면 위에 뜬 작은 영역의 스크롤은 무시한다.
 */
export function ScrollTopButton() {
  const [visible, setVisible] = useState(false);
  const targetRef = useRef<ScrollTarget | null>(null);

  useEffect(() => {
    const onScroll = (e: Event) => {
      const raw = e.target;
      const target: ScrollTarget = raw === document || raw === document.documentElement || raw === document.body ? window : (raw as Element);
      if (target instanceof Element) {
        if (target.closest('[role="dialog"], .dock-panel, .fixed')) return;
        // 화면 높이의 절반도 안 되는 목록·패널 스크롤은 페이지 스크롤로 보지 않는다
        if (target.clientHeight * 2 < document.documentElement.clientHeight) return;
      }
      const top = scrollTopOf(target);
      if (top > SHOW_AFTER) {
        targetRef.current = target;
        setVisible(true);
      } else if (targetRef.current === target || targetRef.current === null) {
        setVisible(false);
      }
    };
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => document.removeEventListener('scroll', onScroll, { capture: true });
  }, []);

  // 탭을 옮기면 기억한 영역이 숨겨지거나 위치가 바뀌므로, 실제 위치로 다시 판정한다
  useEffect(() => {
    if (!visible) return;
    const id = window.setInterval(() => {
      const t = targetRef.current;
      if (!t || (t instanceof Element && !t.isConnected) || scrollTopOf(t) <= SHOW_AFTER) setVisible(false);
    }, 1000);
    return () => window.clearInterval(id);
  }, [visible]);

  const scrollToTop = () => {
    const t = targetRef.current;
    if (t && !(t instanceof Window)) t.scrollTo({ top: 0, behavior: 'smooth' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <button
      type="button"
      onClick={scrollToTop}
      aria-label="맨 위로"
      title="맨 위로"
      tabIndex={visible ? 0 : -1}
      className={`fixed bottom-6 right-6 z-[65] grid h-10 w-10 place-items-center rounded-full border border-border bg-panel text-ink2 shadow-[0_6px_20px_rgba(16,24,48,0.18)] transition-all duration-200 hover:border-teal hover:text-teal ${
        visible ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-3 opacity-0'
      }`}
    >
      <ArrowUp size={18} />
    </button>
  );
}
