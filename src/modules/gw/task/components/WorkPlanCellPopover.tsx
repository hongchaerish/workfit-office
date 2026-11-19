import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLunchRange } from '@/features/workPlan/useLunchRange';
import { useUserPresence } from '@/features/userPresence/useUserPresence';
import { PresenceDot } from '@/features/userPresence/PresenceIndicator';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { User } from '@/domain/user/schema';
import type { WorkPlanItem } from '@/domain/workPlan/item';
import type { DayCell, DayEntry, MemoPlanRef } from '@/domain/workPlan/dayEntries';
import type { MinuteRange } from '@/domain/workPlan/timeGrid';
import { WORK_DAY } from '@/domain/workPlan/freeSlots';
import { CellMemo } from './CellMemo';
import { LINE_TONE_CLASS, LINE_TONE_FILL, lineTitleOf } from './EntryLine';
import { ENTRY_KIND_LABEL, entryKindOf, isLeave, lineToneOf } from './entryKind';
import { busyRangeOf, dayStatusOf, escClosesPopover, freeSlotsOfDay, nowLineOf, type DayStatus } from './dayDetail';
import { timeOf } from './entryChipLook';

/* 칸 옆 그날 상세 — 내 칸은 고치기, 남의 칸은 지금·빈 시간·회의 잡기·메시지. 스크롤해도 닫히지 않고 칸을 따라간다. */

const WIDTH = 360;
const GAP = 8;
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

const dayLabel = (date: string) => {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  return `${Number(date.slice(5, 7))}월 ${Number(date.slice(8))}일 (${WEEKDAYS[dow]})`;
};
const initialsOf = (name: string) => (name.length > 2 ? name.slice(-2) : name);

const STATUS_STYLE: Record<DayStatus['kind'], string> = {
  office: 'bg-panel-alt text-ink2',
  leave: 'bg-yellow-100 text-[#6f630f] dark:bg-yellow-900/30 dark:text-yellow-300',
  outside: 'bg-sky-100 text-[#155f8d] dark:bg-sky-900/30 dark:text-sky-300',
  trip: 'bg-sky-100 text-[#155f8d] dark:bg-sky-900/30 dark:text-sky-300',
};
const NOW_STYLE = {
  free: 'bg-sky-50 text-sky-800 dark:bg-sky-950/40 dark:text-sky-200',
  busy: 'bg-violet-50 text-violet-800 dark:bg-violet-950/40 dark:text-violet-200',
  outside: 'bg-sky-50 text-[#155f8d] dark:bg-sky-950/40 dark:text-sky-200',
  away: 'bg-yellow-50 text-[#6f630f] dark:bg-yellow-950/30 dark:text-yellow-200',
} as const;

const statusText = (s: DayStatus) => (s.kind === 'office' ? '사무실' : s.label);

export interface WorkPlanCellPopoverProps {
  actor: User;
  member: User;
  date: string;
  anchor: HTMLElement;
  today: string;
  nowMinute: number;
  cellOf: (userId: string, date: string) => DayCell;
  /** ‹ › 로 옮길 수 있는 날 */
  weekDates: string[];
  onDateChange: (date: string) => void;
  onClose: () => void;
  onOpenEntry: (entry: DayEntry) => void;
  onCreate?: (date: string, member: User, opts?: { range?: MinuteRange; kind?: 'MEETING'; attendeeIds?: string[] }) => void;
  /** 내 일반 업무 바로 지우기(되돌리기는 화면이 맡는다) */
  onRemoveItem?: (item: WorkPlanItem) => void;
  /** 내 일반 업무 복사 — 그 뒤 내 칸을 누르면 붙여넣는다(화면이 맡는다) */
  onCopyItem?: (item: WorkPlanItem) => void;
  onSaveMemo?: (date: string, memoPlan: MemoPlanRef | null, text: string) => Promise<void>;
  onOpenWeek: (member: User) => void;
  onMessage: (member: User, text?: string) => void;
}

/** 목록 왼쪽 시각 — 시작 ~ 끝, 아니면 종일·오전·미정 같은 글 */
function TimeCell({ entry }: { entry: DayEntry }) {
  if (!entry.allDay && entry.startTime) {
    return (
      <div className="w-[46px] shrink-0 text-[11px] leading-tight tabular-nums text-ink2">
        {entry.startTime}
        {entry.endTime && <div className="text-ink3">~ {entry.endTime}</div>}
      </div>
    );
  }
  return <div className="w-[46px] shrink-0 text-[11px] text-ink3">{timeOf(entry) || '종일'}</div>;
}

export function WorkPlanCellPopover(props: WorkPlanCellPopoverProps) {
  const { actor, member, date, anchor, today, nowMinute, cellOf, weekDates, onDateChange, onClose, onOpenEntry, onCreate, onRemoveItem, onCopyItem, onSaveMemo, onOpenWeek, onMessage } = props;
  const isMine = member.id === actor.id;
  const isToday = date === today;
  const lunch = useLunchRange();
  const presence = useUserPresence(member.id);
  const cell = cellOf(member.id, date);
  const entries = cell.entries;
  const status = dayStatusOf(entries);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // 자리 — 칸 오른쪽(모자라면 왼쪽), 페이지 기준 좌표라 스크롤하면 칸과 같이 움직인다
  // body 에 글자 배율(zoom)이 걸려 있다 — 화면 좌표(배율 적용)를 body 좌표로 나눠 쓴다
  const place = () => {
    // 표가 다시 그려져 누른 칸이 사라졌으면(묶음 접기 등) 왼쪽 위로 튀지 않게 닫는다
    if (!anchor.isConnected) {
      onClose();
      return;
    }
    const z = parseFloat(getComputedStyle(document.body).zoom) || 1;
    const r = anchor.getBoundingClientRect();
    const h = (ref.current?.offsetHeight ?? 0) * z;
    const w = WIDTH * z;
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    let left = r.right + GAP;
    if (left + w > vw - GAP) left = Math.max(GAP, r.left - w - GAP);
    let top = r.top;
    if (top + h > vh - GAP) top = Math.max(GAP, vh - GAP - h);
    setPos({ left: (left + window.scrollX) / z, top: (top + window.scrollY) / z });
  };
  useLayoutEffect(place, [anchor, date, entries.length]);
  useEffect(() => {
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  });
  // 칸이 표에서 빠지면(묶음 접기·주 바꾸기 등) 닫는다 — 상세 창 자신의 변화와 상관없이 표를 지켜본다
  useEffect(() => {
    const root = anchor.closest('table') ?? document.body;
    const obs = new MutationObserver(() => {
      if (!anchor.isConnected) onClose();
    });
    obs.observe(root.parentElement ?? root, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, [anchor, onClose]);

  // 바깥 누르기·Esc 로 닫기 — 스크롤로는 닫지 않는다
  // 위에 띄운 상세 창(모달)을 누르거나 Esc 로 닫을 때는 그 창만 닫히고, 그날 상세로 돌아온다
  useEffect(() => {
    const modalOpen = () => !!document.querySelector('[aria-modal="true"]');
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.contains(t) || modalOpen()) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (escClosesPopover({ key: e.key, defaultPrevented: e.defaultPrevented, target: e.target as HTMLElement | null, modalOpen: modalOpen() })) onClose();
    };
    document.addEventListener('mousedown', onDown, true); // capture — 모달 배경을 누르면 모달이 먼저 사라지므로 그 전에 검사
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [anchor, onClose]);

  const idx = weekDates.indexOf(date);
  const prev = idx > 0 ? weekDates[idx - 1] : null;
  const next = idx >= 0 && idx < weekDates.length - 1 ? weekDates[idx + 1] : null;

  const free = isMine ? [] : freeSlotsOfDay(entries, { isToday, nowMinute, lunch });
  const now = !isMine && isToday ? nowLineOf(entries, nowMinute) : null;
  const meetingAt = (slot?: MinuteRange) => {
    if (!onCreate) return;
    onClose();
    onCreate(date, actor, {
      kind: 'MEETING',
      attendeeIds: [member.id],
      range: slot ? { start: slot.start, end: Math.min(slot.start + 60, slot.end) } : undefined,
    });
  };

  const span = WORK_DAY.end - WORK_DAY.start;
  const bars = entries
    .map((e) => ({ e, r: busyRangeOf(e) }))
    .filter((x): x is { e: DayEntry; r: MinuteRange } => x.r !== null)
    .map(({ e, r }) => ({
      e,
      left: Math.max(0, ((r.start - WORK_DAY.start) / span) * 100),
      width: Math.max(1.5, ((Math.min(r.end, WORK_DAY.end) - Math.max(r.start, WORK_DAY.start)) / span) * 100),
    }))
    .filter((b) => b.width > 0 && b.left < 100);

  const footerBtn = 'rounded-md px-2 py-1 text-[11.5px] text-ink2 hover:bg-panel-alt disabled:opacity-30';

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={`${member.name} ${dayLabel(date)} 일정`}
      className="absolute z-[45] flex max-h-[70vh] flex-col rounded-[14px] border border-border bg-panel shadow-xl"
      style={{ width: WIDTH, left: pos?.left ?? -9999, top: pos?.top ?? 0 }}
    >
      {/* 머리 */}
      <div className="flex items-start gap-2.5 border-b border-border px-3.5 py-3">
        <div className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full bg-sky-100 text-[11.5px] font-bold text-sky-800 dark:bg-sky-900/40 dark:text-sky-200">
          {initialsOf(member.name)}
          {/* 현재 상태(접속·자리 비움 등) — 얼굴 오른쪽 아래 점 */}
          <PresenceDot presence={presence?.presence} size="md" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[13.5px] font-bold text-ink">{isMine ? '내 일정' : member.name}</span>
            {!isMine && (member.position || member.jobTitle) && <span className="text-[11.5px] text-ink3">{member.position || member.jobTitle}</span>}
            <span className={`rounded px-1.5 py-px text-[10.5px] ${STATUS_STYLE[status.kind]}`}>{statusText(status)}</span>
          </div>
          <div className="mt-0.5 text-[11.5px] text-ink3">
            {!isMine && member.dept ? `${member.dept} · ` : ''}
            {dayLabel(date)}
            {isToday ? ' 오늘' : ''}
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label="닫기" className="rounded p-1 text-ink3 hover:bg-panel-alt hover:text-ink">
          <X size={15} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3">
        {now && <div className={`mb-2.5 rounded-lg px-2.5 py-1.5 text-[12px] ${NOW_STYLE[now.tone]}`}>{now.text}</div>}

        {/* 하루 막대 9~18시 */}
        <div className="mb-3">
          <div className="relative h-2 overflow-hidden rounded-full bg-panel-alt">
            {bars.map(({ e, left, width }) => (
              <span key={e.key} className={`absolute inset-y-0 ${LINE_TONE_FILL[lineToneOf(e)]}`} style={{ left: `${left}%`, width: `${width}%` }} />
            ))}
            {isToday && nowMinute > WORK_DAY.start && nowMinute < WORK_DAY.end && (
              <span className="absolute inset-y-0 w-px bg-rose-500" style={{ left: `${((nowMinute - WORK_DAY.start) / span) * 100}%` }} />
            )}
          </div>
          <div className="mt-0.5 flex justify-between text-[9.5px] text-ink3">
            <span>9시</span>
            <span>12시</span>
            <span>15시</span>
            <span>18시</span>
          </div>
        </div>

        {/* 목록 */}
        {entries.length === 0 && <p className="py-2 text-[12px] text-ink3">{isMine ? '이날 적은 일정이 없어요.' : '이날 일정이 없어요.'}</p>}
        <ul className="space-y-1">
          {entries.map((entry) => {
            const kind = entryKindOf(entry);
            const leave = isLeave(entry);
            const attendees = entry.event?.attendeeUserIds?.length ?? 0;
            const meta = [ENTRY_KIND_LABEL[kind], entry.tag && !entry.tag.unknown && entry.tag.name !== ENTRY_KIND_LABEL[kind] ? entry.tag.name : null, attendees > 0 ? `참석 ${attendees}명` : null]
              .filter(Boolean)
              .join(' · ');
            const memo = entry.item?.memo?.trim();
            const canDelete = isMine && !!onRemoveItem && entry.source === 'ITEM' && entry.item?.ownerUserId === actor.id && !entry.item.routine;
            const askable = !isMine && (kind === 'item' || kind === 'meeting');
            const canCopy = isMine && !!onCopyItem && entry.source === 'ITEM' && entry.item?.ownerUserId === actor.id;
            // 남의 특수한 일정(회의·외근·출장·결재·캘린더)은 줄을 누르면 바로 상세, 일반 업무는 열지 않는다([[entryRouting]])
            const openable = !isMine && !leave && entry.source !== 'ITEM';
            // 그날 상세는 닫지 않는다 — 위에 뜬 상세를 닫으면 그날 상세로 돌아온다
            const open = () => onOpenEntry(entry);
            return (
              <li
                key={entry.key}
                onClick={openable ? open : undefined}
                onKeyDown={openable ? (e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(); } } : undefined}
                role={openable ? 'button' : undefined}
                tabIndex={openable ? 0 : undefined}
                title={openable ? '눌러서 상세 보기' : undefined}
                className={`group/item flex gap-2 rounded-lg px-1.5 py-1.5 hover:bg-panel-alt/60 ${openable ? 'cursor-pointer' : ''}`}
              >
                <TimeCell entry={entry} />
                <div className={`min-w-0 flex-1 border-l-2 pl-2 ${LINE_TONE_CLASS[lineToneOf(entry)]}`}>
                  <div className="truncate text-[12.5px] text-ink">{lineTitleOf(entry)}</div>
                  <div className="text-[10.5px] text-ink3">{meta}</div>
                  {memo && <div className="mt-1 whitespace-pre-line rounded-md bg-panel-alt/70 px-2 py-1 text-[11px] text-ink2">{memo}</div>}
                  {isMine && leave && <div className="mt-0.5 text-[10.5px] text-ink3">휴가는 휴가원으로만 바꿀 수 있어요</div>}
                </div>
                <div className="flex shrink-0 items-start gap-1">
                  {isMine && !leave && (
                    <button type="button" onClick={() => { onClose(); onOpenEntry(entry); }} className="rounded px-1.5 py-0.5 text-[11px] text-ink2 hover:bg-panel hover:text-ink">
                      수정
                    </button>
                  )}
                  {canCopy && (
                    <button
                      type="button"
                      onClick={() => {
                        onCopyItem!(entry.item!);
                        onClose();
                      }}
                      title="같은 일을 다른 날에 또 — 복사한 뒤 내 칸을 누르면 붙여넣어요"
                      className="rounded px-1.5 py-0.5 text-[11px] text-ink2 hover:bg-panel hover:text-ink"
                    >
                      복사
                    </button>
                  )}
                  {canDelete && (
                    <button type="button" onClick={() => onRemoveItem!(entry.item!)} className="rounded px-1.5 py-0.5 text-[11px] text-ink3 hover:bg-panel hover:text-danger">
                      삭제
                    </button>
                  )}
                  {askable && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onMessage(member, `${Number(date.slice(5, 7))}/${Number(date.slice(8))} ${entry.title} 일정 관련해서 여쭤볼게요.`);
                      }}
                      className="rounded px-1.5 py-0.5 text-[11px] text-sky-700 hover:bg-panel dark:text-sky-300"
                    >
                      이 일정 묻기
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        {(cell.memo || (isMine && onSaveMemo)) && (
          <CellMemo
            key={`${cell.memoPlan?.id ?? 'new'}|${cell.memo ?? ''}|${date}`}
            text={cell.memo}
            label={`${member.name} ${dayLabel(date)} 메모`}
            onSave={isMine && onSaveMemo ? (text) => onSaveMemo(date, cell.memoPlan, text) : undefined}
          />
        )}

        {isMine && onCreate && (
          <button
            type="button"
            onClick={() => {
              onClose();
              onCreate(date, actor);
            }}
            className="mt-2.5 w-full rounded-lg border border-dashed border-border py-1.5 text-[12px] text-ink2 hover:border-sky-300 hover:text-sky-700"
          >
            {entries.length === 0 ? '+ 이날 일정 적기' : '+ 이날 일정 추가'}
          </button>
        )}
      </div>

      {/* 바닥 */}
      <div className="flex items-center gap-1 border-t border-border px-2.5 py-2">
        <button type="button" disabled={!prev} onClick={() => prev && onDateChange(prev)} className={footerBtn} aria-label="전날">
          ‹{isMine ? ' 전날' : ''}
        </button>
        <button type="button" disabled={!next} onClick={() => next && onDateChange(next)} className={footerBtn} aria-label="다음날">
          {isMine ? '다음날 ' : ''}›
        </button>
        <div className="flex-1" />
        <button type="button" onClick={() => onOpenWeek(member)} className={footerBtn}>
          {isMine ? '내 한 주' : '한 주 보기'}
        </button>
        {!isMine && onCreate && (
          <button type="button" onClick={() => meetingAt(free[0])} className={footerBtn}>
            회의 잡기
          </button>
        )}
        {!isMine && (
          <button type="button" onClick={() => onMessage(member)} className="rounded-md bg-sky-600 px-2.5 py-1 text-[11.5px] font-semibold text-white hover:bg-sky-700">
            메시지
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}
