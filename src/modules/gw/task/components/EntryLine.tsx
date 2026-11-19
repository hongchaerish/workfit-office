import { Check, Repeat } from 'lucide-react';
import type { DayEntry } from '@/domain/workPlan/dayEntries';
import { chipLook, timeOf, timeRangeOf } from './entryChipLook';
import { lineToneOf, type LineTone } from './entryKind';

/* 일정 한 줄(C 모양) — 시각 + 제목, 왼쪽 2px 선만 색. 상자·테두리·그림자·바탕 없음. 주간 표·월간 표·상세 창이 같이 쓴다. */

/** 왼쪽 선 색과 글 색 — 업무 회색, 회의 보라, 외근·출장은 진한 하늘·휴가는 진한 노랑 굵은 글씨로 눈에 띄게 */
export const LINE_TONE_CLASS: Record<LineTone, string> = {
  item: 'border-[#d6dbe3] font-normal text-ink',
  meeting: 'border-[#b6a2f2] font-normal text-ink',
  outside: 'border-[#8cc8ee] font-semibold text-[#0b5d91] dark:text-sky-300',
  leave: 'border-[#e3d36a] font-semibold text-[#8a6400] dark:text-yellow-300',
};

/** 하루 막대 등에서 쓰는 채움 색 */
export const LINE_TONE_FILL: Record<LineTone, string> = {
  item: 'bg-[#d6dbe3]',
  meeting: 'bg-[#b6a2f2]',
  outside: 'bg-[#8cc8ee]',
  leave: 'bg-[#e3d36a]',
};

/** 칩 글의 대괄호 접두([회의]·[휴가] 등)를 뗀 제목 */
export function lineTitleOf(entry: DayEntry): string {
  return chipLook(entry).label.replace(/^\[[^\]]*\]\s*/, '');
}

/**
 * wrap — 제목이 길면 두 줄까지 접어 보인다(주간 표). 없으면 한 줄 말줄임.
 * 반복 업무는 제목을 옅게 — 매일 같은 일이 외근·휴가 같은 일정과 같은 무게로 보이지 않게.
 */
export function EntryLine({ entry, onOpen, className = '', wrap = false, hideTime = false }: { entry: DayEntry; onOpen?: (entry: DayEntry) => void; className?: string; wrap?: boolean; hideTime?: boolean }) {
  const { hint } = chipLook(entry);
  const range = timeRangeOf(entry);
  const title = range ? `${hint} (${range})` : hint;
  const openable = !!onOpen && !(entry.source === 'APPROVAL' && !entry.outside);
  const cls = `flex w-full min-w-0 ${wrap ? 'items-start' : 'items-center'} gap-1 border-l-2 pl-1.5 text-left text-[11.5px] leading-[1.45] ${LINE_TONE_CLASS[lineToneOf(entry)]} ${className}`;
  const body = (
    <>
      {/* 시각이 없는 줄(연차 등)은 빈 시각 칸 없이 붙인다 */}
      {!hideTime && timeOf(entry) && <span className="w-[2.8em] shrink-0 text-[10.5px] tabular-nums text-ink3">{timeOf(entry)}</span>}
      <span className={`min-w-0 flex-1 ${wrap ? 'line-clamp-2 [overflow-wrap:anywhere]' : 'truncate'} ${entry.item?.routine ? 'font-normal text-ink3' : ''}`}>{lineTitleOf(entry)}</span>
      {entry.roomStatus === 'PENDING' && <span className="shrink-0 text-[9px] text-amber">대기</span>}
      {entry.roomStatus === 'REJECTED' && <span className="shrink-0 text-[9px] text-danger">회의실 반려</span>}
      {entry.outside?.source === 'APPROVAL' && <Check size={10} strokeWidth={3} className="shrink-0 opacity-40" aria-label="결재 완료" />}
      {entry.item?.routine && <Repeat size={10} strokeWidth={3} className="shrink-0 opacity-40" aria-label="반복" />}
    </>
  );
  if (!openable) {
    return (
      // 결재 휴가처럼 열 상세가 없는 줄은 칸 누르기로 넘기지 않는다. onOpen 이 없으면(주간 표) 칸이 누르기를 받는다
      <div title={title} className={cls} onClick={onOpen ? (e) => e.stopPropagation() : undefined}>
        {body}
      </div>
    );
  }
  return (
    <button
      type="button"
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onOpen!(entry);
      }}
      className={`${cls} cursor-pointer hover:bg-panel-alt/60`}
    >
      {body}
    </button>
  );
}
