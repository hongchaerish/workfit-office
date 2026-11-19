/** 내 업무를 끌어 놓을 때 Ctrl(맥은 ⌘·Option)을 누르고 있으면 복사, 아니면 이동 — 윈도우 탐색기와 같은 규칙 */
export const isCopyGesture = (e: { ctrlKey: boolean; metaKey: boolean; altKey: boolean }) => e.ctrlKey || e.metaKey || e.altKey;

/** 복사로 놓일 칸에 띄우는 작은 표시 */
export const COPY_BADGE_CLASS = 'pointer-events-none absolute bottom-1 right-1 z-[3] rounded bg-teal px-1 text-[10px] font-semibold leading-[1.5] text-white';
