import { Check, Repeat } from 'lucide-react';
import type { DayEntry } from '@/domain/workPlan/dayEntries';
import { chipLook, timeOf, timeRangeOf } from './entryChipLook';
import { lineToneOf, type LineTone } from './entryKind';

/* 일정 한 줄(C 모양) — 시각 + 제목, 왼쪽 2px 선만 색. 상자·테두리·그림자·바탕 없음. 주간 표·월간 표·상세 창이 같이 쓴다. */

/** 왼쪽 선 색과 글 색 — 업무 회색, 회의 보라, 외근·출장 하늘, 휴가 노랑 */
export const LINE_TONE_CLASS: Record<LineTone, string> = {
  item: 'border-[#d6dbe3] text-ink',
  meeting: 'border-[#b6a2f2] text-ink',
  outside: 'border-[#8cc8ee] text-[#155f8d] dark:text-sky-300',
  leave: 'border-[#e3d36a] text-[#6f630f] dark:text-yellow-300',
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

export function EntryLine({ entry, onOpen, className = '' }: { entry: DayEntry; onOpen?: (entry: DayEntry) => void; className?: string }) {
  const { hint } = chipLook(entry);
  const range = timeRangeOf(entry);
  const title = range ? `${hint} (${range})` : hint;
  const openable = !!onOpen && !(entry.source === 'APPROVAL' && !entry.outside);
  const cls = `flex w-full min-w-0 items-center gap-1 border-l-2 pl-1.5 text-left text-[11.5px] font-normal leading-[1.45] ${LINE_TONE_CLASS[lineToneOf(entry)]} ${className}`;
  const body = (
    <>
      <span className="w-[2.8em] shrink-0 text-[10.5px] tabular-nums text-ink3">{timeOf(entry)}</span>
      <span className="min-w-0 flex-1 truncate">{lineTitleOf(entry)}</span>
      {entry.roomStatus === 'PENDING' && <span className="shrink-0 text-[9px] text-amber">대기</span>}
      {entry.roomStatus === 'REJECTED' && <span className="shrink-0 text-[9px] text-danger">회의실 반려</span>}
      {entry.outside?.source === 'APPROVAL' && <Check size={10} strokeWidth={3} className="shrink-0 opacity-40" aria-label="결재 완료" />}
      {entry.item?.routine && <Repeat size={10} strokeWidth={3} className="shrink-0 opacity-40" aria-label="반복" />}
    </>
  );
  if (!openable) {
    return (
      <div title={title} className={cls} onClick={(e) => e.stopPropagation()}>
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
