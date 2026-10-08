import { useEffect, useRef } from 'react';
import type { ShellTab } from './tabModel';
import { MenuGlyph } from '@/shared/ui/MenuGlyph';
import { X, Plus, ChevronDown, LayoutGrid } from 'lucide-react';
import { isGwUrl } from './gw-screens';

interface TabBarProps {
  tabs: ShellTab[];
  activeTabId: string | null;
  onSelect: (tab: ShellTab) => void;
  onClose: (id: string, e: React.MouseEvent) => void;
  menuOpen: boolean;
  setMenuOpen: (v: boolean) => void;
}

export function TabBar({ tabs, activeTabId, onSelect, onClose, menuOpen, setMenuOpen }: TabBarProps) {
  const listRef = useRef<HTMLDivElement>(null);

  // 탭이 막대보다 많으면 막대 안에서 가로로 넘긴다 — 휠을 가로 스크롤로 바꾼다
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const onWheel = (e: WheelEvent) => {
      if (list.scrollWidth <= list.clientWidth || e.deltaY === 0) return;
      e.preventDefault();
      list.scrollLeft += e.deltaY;
    };
    list.addEventListener('wheel', onWheel, { passive: false });
    return () => list.removeEventListener('wheel', onWheel);
  }, []);

  // 선택한 탭이 가려져 있으면 보이도록 막대만 넘긴다 (페이지는 움직이지 않게 scrollIntoView 대신 직접 계산)
  useEffect(() => {
    const list = listRef.current;
    const active = list?.querySelector<HTMLElement>('[data-active-tab="true"]');
    if (!list || !active) return;
    const left = active.offsetLeft - list.offsetLeft;
    const right = left + active.offsetWidth;
    if (left < list.scrollLeft) list.scrollLeft = left;
    else if (right > list.scrollLeft + list.clientWidth) list.scrollLeft = right - list.clientWidth;
  }, [activeTabId, tabs.length]);

  return (
    <div className="relative flex h-9 shrink-0 items-end border-b border-border-hi bg-bg-deep pl-2.5 w-full min-w-full">
      {/* w-0 + flex-1: 탭 너비 합계가 셸 전체 너비(min-w-fit)를 밀어내지 않게 하고, 남는 폭만 차지한다 */}
      <div
        ref={listRef}
        className="flex w-0 min-w-0 flex-1 items-end gap-[3px] overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map((t) => {
          const a = t.id === activeTabId;
          const gw = isGwUrl(t.url);
          return (
            <button
              key={t.id}
              data-active-tab={a}
              onClick={() => onSelect(t)}
              title={gw ? `그룹웨어 · ${t.name}` : t.name}
              className={`flex shrink-0 cursor-pointer items-center gap-1.5 rounded-t-[7px] pl-3 pr-2 ${
                a ? 'h-[30px] border-l border-r border-t border-border-hi bg-panel shadow-[0_-1px_2px_rgba(23,34,65,0.04)]' : 'h-[26px] bg-[#dde3ee]'
              }`}
            >
              {gw ? (
                <MenuGlyph glyph={t.icon} size={13} className="shrink-0 text-ink2" />
              ) : (
                <span className={`h-1.5 w-1.5 rounded-full ${a ? 'bg-teal' : 'bg-ink3'}`} />
              )}
              <span className={`whitespace-nowrap text-[11px] ${a ? 'font-bold text-ink' : 'font-semibold text-ink2'}`}>{t.name}</span>
              <span
                onClick={(e) => onClose(t.id, e)}
                className={`grid h-4 w-4 place-items-center rounded-full transition-colors ${a ? 'bg-panel-alt text-ink2 hover:bg-border' : 'text-ink3 hover:text-ink'}`}
              >
                <X size={10} />
              </span>
            </button>
          );
        })}
        <span className="grid h-[26px] w-[26px] shrink-0 place-items-center self-end text-ink3">
          <Plus size={14} />
        </span>
      </div>

      {/* 전체 탭 드롭다운 */}
      <div className="relative flex shrink-0 items-center self-stretch border-l border-border-hi px-2 pl-1.5">
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          title="전체 탭 목록"
          className={`flex h-6 items-center gap-1.5 rounded-[7px] border border-border-hi px-2.5 text-[11px] font-bold text-ink2 ${menuOpen ? 'bg-panel' : 'bg-white'}`}
        >
          <LayoutGrid size={11} className="text-ink3" />
          {tabs.length}
          <ChevronDown size={11} className={`transition-transform text-ink3 ${menuOpen ? 'rotate-180' : ''}`} />
        </button>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-[55]" onClick={() => setMenuOpen(false)} />
            <div className="content-scroll absolute right-1.5 top-[calc(100%+4px)] z-[60] max-h-80 w-[248px] overflow-y-auto rounded-[10px] border border-border bg-panel p-1.5 shadow-[0_12px_32px_rgba(16,24,48,0.2)]">
              <div className="px-2.5 pb-1.5 pt-1.5 text-[9.5px] font-extrabold tracking-wide text-ink3">열린 화면 {tabs.length}</div>
              {tabs.map((t) => {
                const a = t.id === activeTabId;
                return (
                  <div
                    key={t.id}
                    onClick={() => { onSelect(t); setMenuOpen(false); }}
                    className={`flex cursor-pointer items-center gap-2 rounded-[7px] px-2.5 py-[7px] ${a ? 'bg-teal-soft' : 'hover:bg-panel-alt'}`}
                  >
                    {isGwUrl(t.url) ? (
                      <MenuGlyph glyph={t.icon} size={13} className="shrink-0 text-ink2" />
                    ) : (
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${a ? 'bg-teal' : 'bg-ink3'}`} />
                    )}
                    <span className={`min-w-0 flex-1 truncate text-[11.5px] ${a ? 'font-bold text-teal' : 'font-medium text-ink2'}`}>{t.name}</span>
                    <span onClick={(e) => onClose(t.id, e)} className="grid h-4 w-4 shrink-0 place-items-center rounded-full text-ink3 hover:text-ink">
                      <X size={11} />
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
