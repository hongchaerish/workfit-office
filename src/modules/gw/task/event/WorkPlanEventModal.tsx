import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, Check, ChevronDown, Repeat, Settings, UserRound } from 'lucide-react';
import { WorkPlanConfigModal } from '../components/WorkPlanConfigModal';
import { canJoinMeeting } from '@/domain/calendarEvent/meeting';
import type { User } from '@/domain/user/schema';
import type { DayCell } from '@/domain/workPlan/dayEntries';
import type { WorkPlanItem } from '@/domain/workPlan/item';
import { selectableGeneralTags, ETC_TAG_ID } from '@/domain/workPlan/tag';
import { useWorkPlanTags } from '@/features/workPlan/useWorkPlanItems';
import { Button } from '@/shared/ui/Button';
import { Modal } from '@/shared/ui/Modal';
import { EventFields, type EventForm } from './EventFields';
import { FIXED_KINDS, dotClassOf, eventWhenLabel, generalTagOf, isOutsideKind, ownerOf, useEventActions, useEventBlocks } from './eventShared';
import { kindEnabled } from './entryRouting';
import { RoutineFields, RoutineScopeFields } from './RoutineFields';
import { defaultRoutineRule, type RoutineFreq } from '@/domain/workPlan/routine';
import { TimeGrid } from './TimeGrid';
import { WorkPlanEventView } from './WorkPlanEventView';
import { useLunchRange } from '@/features/workPlan/useLunchRange';
import { EventAssist, useEventConflicts } from './EventAssist';
import { useWorkPlanEventForm, type EventKind, type EventTarget } from './useWorkPlanEventForm';

interface WorkPlanEventModalProps {
  target: EventTarget;
  actor: User;
  deptId: string | null;
  users: User[];
  /** 부모가 만든 칸 조회(indexDayEntries) — 시간표에 겹쳐 보일 그날 일정 */
  cellOf: (userId: string, date: string) => DayCell;
  onClose: () => void;
  onSaved: (message: string) => void;
  /** 최근 적은 업무 제목 — 새 업무 제목 아래 */
  recentTitles?: string[];
  /** 내 일반 업무 복사 — 창을 닫고, 그 뒤 내 칸·날짜를 누르면 붙여넣는다 */
  onCopyItem?: (item: WorkPlanItem) => void;
  /** 태그 편집 권한 — 있으면 태그 메뉴 맨 아래에 '태그 편집' */
  canEditTags?: boolean;
  /** '저장하고 이어서 적기' — 저장 뒤 같은 날 새 일정 창 */
  onSavedAndNext?: (date: string) => void;
}

/**
 * 업무계획 일정 창(PC) — 팀즈 일정 창을 우리 양식에 맞춘 것.
 * 위 도구 막대에서 종류(회의·외근·출장·일반 태그)를 고르고, 왼쪽에 입력, 오른쪽 세로 시간표로 시간을 고른다.
 * 다른 칸·일정을 열 때는 호출부가 `key`를 바꿔 다시 마운트한다(훅 규칙).
 */
export function WorkPlanEventModal({ target, actor, deptId, users, cellOf, onClose, onSaved, recentTitles, onSavedAndNext, canEditTags = false, onCopyItem }: WorkPlanEventModalProps) {
  const form = useWorkPlanEventForm(target, actor, deptId);
  const { state, readOnly } = form;
  const owner = useMemo(() => ownerOf(target, users), [target, users]);
  const entry = target.mode === 'create' ? null : target.entry;
  const blocks = useEventBlocks(form, target, actor, users, cellOf, owner);
  const { save, join, leave, remove, confirmingDelete, setConfirmingDelete } = useEventActions(form, onSaved, onClose);
  // 시스템 점심시간(근태 정책) — 시간표 빗금과 '모두 가능한 시간'에서 뺀다
  const lunch = useLunchRange();
  const conflicts = useEventConflicts(form, target, owner.id, actor.id, users, cellOf, lunch);
  /** 저장하고 이어서 적기 — 새 일정만 */
  const [continueNext, setContinueNext] = useState(false);
  const canContinue = target.mode === 'create' && Boolean(onSavedAndNext);
  const saveNow = () => {
    if (form.saving) return;
    const date = state.date;
    void save(canContinue && continueNext ? () => onSavedAndNext!(date) : undefined);
  };
  const copyable = !!onCopyItem && target.mode === 'edit' && entry?.source === 'ITEM' && entry.item?.ownerUserId === actor.id;
  const invites = target.mode === 'create' && state.kind === 'MEETING' && state.attendeeIds.some((id) => id !== owner.id);

  const heading = target.mode === 'create' ? '새 일정' : target.mode === 'edit' ? '일정 수정' : '일정 보기';
  const when = eventWhenLabel(state.date, isOutsideKind(state.kind) ? state.endDate : undefined);

  // 보기 중인 회의 — 참석자는 참석 취소, 주최자도 참석자도 아니면 합류
  const viewedMeeting = entry?.source === 'MEETING' ? entry.event ?? null : null;
  const footer = readOnly ? (
    <>
      {form.leave && (
        <Button variant="secondary" disabled={form.saving} onClick={() => void leave()}>참석 취소</Button>
      )}
      {viewedMeeting && canJoinMeeting(actor.id, viewedMeeting) && actor.status === '사용' && (
        <Button variant="accent" disabled={form.saving} onClick={() => void join(viewedMeeting)}>참석자로 합류</Button>
      )}
      <Button onClick={onClose}>닫기</Button>
    </>
  ) : (
    <>
      {(form.remove || copyable) && (
        <div className="mr-auto flex items-center gap-2">
          {form.remove &&
            (confirmingDelete ? (
              <Button variant="dangerSolid" disabled={form.saving} onClick={() => void remove()}>
                {form.editingRoutine && form.routineScope === 'following' ? '이후 모두 삭제' : '삭제 확인'}
              </Button>
            ) : (
              <Button variant="danger" disabled={form.saving} onClick={() => setConfirmingDelete(true)}>삭제</Button>
            ))}
          {copyable && (
            <Button
              variant="secondary"
              disabled={form.saving}
              title="같은 일을 다른 날에 또 — 복사한 뒤 내 칸이나 날짜를 누르면 붙여넣어요"
              onClick={() => {
                onCopyItem!(entry!.item!);
                onClose();
              }}
            >
              복사
            </Button>
          )}
        </div>
      )}
      {canContinue && (
        <label className="mr-auto flex items-center gap-1.5 text-[12px] text-ink2">
          <input type="checkbox" checked={continueNext} onChange={(e) => setContinueNext(e.target.checked)} className="h-3.5 w-3.5 accent-teal" />
          저장하고 이어서 적기
        </label>
      )}
      <span className="text-[11px] text-ink3">Ctrl+Enter 저장</span>
      <Button disabled={form.saving} onClick={onClose}>취소</Button>
      <Button variant="primary" disabled={form.saving} onClick={saveNow}>
        {form.saving ? '저장 중…' : invites ? '저장하고 초대 보내기' : '저장'}
      </Button>
    </>
  );

  // 고칠 수 없는 일정 — 잠긴 입력 칸 대신 그날 일정 보기(누른 일정 강조)
  if (readOnly && entry) {
    const nameOf = (id: string) => users.find((u) => u.id === id)?.name ?? '';
    const day = cellOf(owner.id, state.date);
    return (
      <WorkPlanEventView
        entry={entry}
        date={state.date}
        entries={day.entries}
        dayMemo={day.memo}
        owner={owner}
        nameOf={nameOf}
        footer={footer}
        busy={form.saving}
        onClose={onClose}
      />
    );
  }

  return (
    <Modal
      open
      // 저장·삭제 중에는 ESC·바깥 클릭·X로 닫히지 않게
      onClose={form.saving ? () => {} : onClose}
      width={820}
      flush
      title={(
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="mr-1">{heading}</span>
          {owner.name && (
            <span className="inline-flex items-center gap-1.5 rounded-md bg-panel-alt px-2 py-0.5 text-[13px] font-bold text-ink">
              <UserRound size={13} className="text-ink3" />
              {owner.name}
            </span>
          )}
          {when.date && (
            <span className="inline-flex items-center gap-1.5 rounded-md bg-panel-alt px-2 py-0.5 text-[13px] font-bold text-ink">
              <CalendarDays size={13} className="text-ink3" />
              {when.date}
            </span>
          )}
          {when.week && (
            <span className="rounded-md bg-teal/10 px-2 py-0.5 text-[12px] font-bold text-teal">{when.week}</span>
          )}
          {entry?.roomStatus === 'PENDING' && (
            <span className="self-center rounded bg-amber-soft px-1.5 py-0.5 text-[10px] font-bold text-amber">회의실 승인 대기</span>
          )}
          {entry?.roomStatus === 'REJECTED' && (
            <span className="self-center rounded bg-danger/10 px-1.5 py-0.5 text-[10px] font-bold text-danger">회의실 반려</span>
          )}
        </span>
      )}
      footer={footer}
    >
      <div
        className="flex flex-col"
        onKeyDown={(e) => {
          // 창 어디서든 Ctrl/⌘+Enter = 저장
          if (!readOnly && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            saveNow();
          }
        }}
      >
        <KindToolbar form={form} target={target} canEditTags={canEditTags} />

        {/* 루틴(반복) — 새 일반 업무는 규칙, 루틴으로 만든 업무를 고칠 때는 범위 */}
        {form.routineRule && (
          <RoutineFields start={state.date} rule={form.routineRule} holidays={form.routineHolidays} onChange={form.setRoutineRule} />
        )}
        {state.kind === 'ITEM' && form.editingRoutine && (
          <RoutineScopeFields
            date={state.date}
            routine={form.editingRoutine}
            scope={form.routineScope}
            onChange={form.setRoutineScope}
            readOnly={readOnly}
          />
        )}


        <div className="grid grid-cols-[minmax(0,1fr)_240px]">
          {/* 시간표 높이에 맞추고 넘치는 입력은 왼쪽 안에서 스크롤 */}
          <div className="relative min-h-[16rem]">
            <div className="absolute inset-0 overflow-y-auto px-5 py-4">
              <fieldset disabled={readOnly} className="min-w-0">
                <EventFields
                  form={form}
                  actor={actor}
                  users={users}
                  ownerId={owner.id}
                  ownerName={owner.name}
                  outsideSelfId={entry?.outside?.self?.id ?? null}
                  onJoin={(meeting) => void join(meeting)}
                  recentTitles={target.mode === 'create' ? recentTitles : undefined}
                  busyAt={conflicts.busyAt}
                />
              </fieldset>
              {!readOnly && <EventAssist form={form} conflicts={conflicts} />}
            </div>
          </div>

          <div className="border-l border-border bg-panel-alt p-3">
            <TimeGrid
              mode="desktop"
              date={state.date}
              onDateChange={form.setDate}
              blocks={blocks}
              value={state.range}
              allDay={state.allDay}
              openEnd={state.kind === 'ITEM' && state.openEnd}
              allDayLabel={state.kind === 'ITEM' ? '미정' : '종일'}
              onChange={form.setRange}
              lunch={lunch}
              conflict={!readOnly && Boolean(conflicts.mine)}
              fits={readOnly ? [] : conflicts.fits}
              onPickFit={(start) => {
                const length = state.range && !state.allDay ? state.range.end - state.range.start : 60;
                form.setRange({ start, end: start + length });
              }}
            />
          </div>
        </div>

        {/* 저장 실패 이유 — 왼쪽 스크롤과 상관없이 바닥 바로 위에 늘 보이게 */}
        {/* 빈 제목은 제목 칸 바로 아래에 이미 보인다 — 같은 글을 두 번 띄우지 않는다 */}
        {form.error && !(!state.title.trim() && (state.kind === 'ITEM' || state.kind === 'MEETING')) && (
          <p role="alert" className="border-t border-danger/20 bg-danger/5 px-5 py-2 text-[11px] font-semibold text-danger">
            {form.error}
          </p>
        )}
      </div>
    </Modal>
  );
}

/** 위 도구 막대 — [회의|외근|출장|일반 ▾] 분할 버튼 + 오른쪽 리마인드·루틴 자리(나중 기능) */
function KindToolbar({ form, target, canEditTags }: { form: EventForm; target: EventTarget; canEditTags: boolean }) {
  const { state, readOnly } = form;
  const tagsQuery = useWorkPlanTags();
  const tags = tagsQuery.data ?? [];
  const generalTags = selectableGeneralTags(tags);
  const [menuOpen, setMenuOpen] = useState(false);
  const [tagEditOpen, setTagEditOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  const enabled = (kind: EventKind) => kindEnabled(kind, target, state.kind, readOnly);
  const routineAllowed = !readOnly && target.mode === 'create' && state.kind === 'ITEM';

  const segClass = (active: boolean) =>
    `inline-flex items-center gap-1.5 whitespace-nowrap border-r border-border px-3 py-1.5 text-[11.5px] font-semibold transition-colors last:border-r-0 disabled:cursor-not-allowed disabled:opacity-45 ${
      active ? 'bg-blue-soft text-blue' : 'text-ink2 hover:bg-panel-alt'
    }`;

  const isItem = state.kind === 'ITEM';
  const isEtc = isItem && state.tagId === ETC_TAG_ID;
  const currentTag = generalTagOf(tags, state.kind, state.tagId);
  // 첫 일반 태그(기본)면 '업무', 다른 태그·기타를 고르면 그 이름을 버튼에
  const defaultTagId = generalTags[0]?.id;
  const itemLabel = !isItem ? null : isEtc ? { name: '기타', dot: 'bg-slate-400' } : currentTag && state.tagId && state.tagId !== defaultTagId ? { name: currentTag.name, dot: dotClassOf(currentTag.colorId) } : null;

  const pickTag = (tagId: string) => {
    form.set('tagId', tagId);
    form.setKind('ITEM');
    setMenuOpen(false);
  };

  // 반복 — 새 일반 업무만. 고른 날짜 기준 요일·날짜를 글에 넣는다
  const dow = ['일', '월', '화', '수', '목', '금', '토'][new Date(`${state.date}T00:00:00Z`).getUTCDay()];
  const repeatOptions: Array<{ value: RoutineFreq | ''; label: string }> = [
    { value: '', label: '반복 안 함' },
    { value: 'DAILY', label: '매일' },
    { value: 'WEEKDAYS', label: '평일마다' },
    { value: 'WEEKLY', label: `매주 ${dow}요일` },
    { value: 'MONTHLY', label: `매월 ${Number(state.date.slice(8))}일` },
  ];

  return (
    <div className="flex items-center gap-1.5 border-b border-border bg-panel-alt px-5 py-2">
      <div
        ref={menuRef}
        className="relative"
        onKeyDown={(e) => {
          // 메뉴만 닫는다(창의 ESC 닫기까지 가지 않게)
          if (e.key !== 'Escape' || !menuOpen) return;
          e.nativeEvent.stopPropagation();
          setMenuOpen(false);
        }}
      >
        <div className="inline-flex overflow-hidden rounded-md border border-border bg-panel" role="radiogroup" aria-label="일정 종류">
          {/* 업무 — 이미 업무면 다시 눌러 태그 메뉴, 다른 종류에서 누르면 업무로만 */}
          <button
            type="button"
            role="radio"
            aria-checked={isItem}
            aria-haspopup="listbox"
            aria-expanded={menuOpen}
            disabled={!enabled('ITEM')}
            className={segClass(isItem)}
            onClick={() => (isItem ? setMenuOpen((v) => !v) : form.setKind('ITEM'))}
          >
            {itemLabel ? <span className={`h-2 w-2 rounded-full ${itemLabel.dot}`} /> : <span className="h-3 w-[3px] rounded-sm bg-[#d6dbe3]" aria-hidden />}
            {itemLabel?.name ?? '업무'}
            <ChevronDown size={13} />
          </button>
          {FIXED_KINDS.map(({ kind, label }) => (
            <button
              key={kind}
              type="button"
              role="radio"
              aria-checked={state.kind === kind}
              disabled={!enabled(kind)}
              className={segClass(state.kind === kind)}
              onClick={() => {
                setMenuOpen(false);
                form.setKind(kind);
              }}
            >
              <span className={`h-3 w-[3px] rounded-sm ${kind === 'MEETING' ? 'bg-[#b6a2f2]' : 'bg-[#8cc8ee]'}`} aria-hidden />
              {label}
            </button>
          ))}
        </div>

        {menuOpen && (
          <div
            role="listbox"
            aria-label="업무 태그"
            className="absolute left-0 top-full z-30 mt-1 max-h-64 w-44 overflow-y-auto rounded-lg border border-border bg-panel p-1 shadow-lg"
          >
            {[...generalTags.map((tag) => ({ id: tag.id, name: tag.name, dot: dotClassOf(tag.colorId) })), { id: ETC_TAG_ID, name: '기타', dot: 'bg-slate-400' }].map((tag) => {
              const active = isItem && (state.tagId === tag.id || (!state.tagId && tag.id === defaultTagId));
              return (
                <button
                  key={tag.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => pickTag(tag.id)}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11.5px] font-semibold ${
                    active ? 'bg-blue-soft text-blue' : 'text-ink2 hover:bg-panel-alt'
                  }`}
                >
                  <span className={`h-2 w-2 shrink-0 rounded-full ${tag.dot}`} />
                  <span className="min-w-0 flex-1 truncate">{tag.name}</span>
                  {active && <Check size={13} className="shrink-0" />}
                </button>
              );
            })}
            {canEditTags && (
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  setTagEditOpen(true);
                }}
                className="mt-1 flex w-full items-center gap-2 rounded border-t border-border px-2 pb-1.5 pt-2 text-left text-[11.5px] font-semibold text-ink3 hover:bg-panel-alt hover:text-ink"
              >
                <Settings size={12} className="shrink-0" />
                태그 편집
              </button>
            )}
          </div>
        )}
      </div>
      {/* 일정 창 위에 겹쳐 뜬다 — 고친 태그는 바로 이 메뉴에 반영된다 */}
      <WorkPlanConfigModal isOpen={tagEditOpen} onClose={() => setTagEditOpen(false)} canEdit={canEditTags} />

      <span className="flex-1" />
      {/* 반복 — 새 일반 업무만(회의·외근·출장은 아직) */}
      {routineAllowed && (
        <label className="flex items-center gap-1.5 text-[11.5px] text-ink2">
          <Repeat size={12} className="text-ink3" />
          반복
          <select
            value={form.routineRule?.freq ?? ''}
            onChange={(e) => {
              const freq = e.target.value as RoutineFreq | '';
              form.setRoutineRule(freq ? { ...defaultRoutineRule(state.date), freq } : null);
            }}
            className="h-7 rounded-md border border-border bg-panel px-1.5 text-[11.5px] text-ink outline-none focus:border-teal/50"
          >
            {repeatOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
