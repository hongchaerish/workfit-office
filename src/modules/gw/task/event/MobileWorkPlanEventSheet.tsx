import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Bell, Check, ChevronDown, ChevronUp, MoreHorizontal, Repeat, X } from 'lucide-react';
import { canJoinMeeting } from '@/domain/calendarEvent/meeting';
import { OUTSIDE_WORK_SUBTYPES } from '@/domain/outsideWork/schema';
import type { User } from '@/domain/user/schema';
import type { DayCell } from '@/domain/workPlan/dayEntries';
import { selectableGeneralTags, ETC_TAG_ID } from '@/domain/workPlan/tag';
import { useWorkPlanTags } from '@/features/workPlan/useWorkPlanItems';
import { Button } from '@/shared/ui/Button';
import { EventFields, type EventForm } from './EventFields';
import { FIXED_KINDS, dotClassOf, eventWhenLabel, generalTagOf, isOutsideKind, ownerOf, useEventActions, useEventBlocks } from './eventShared';
import { kindEnabled } from './entryRouting';
import { TimeGrid } from './TimeGrid';
import { RoutineFields, RoutineScopeFields } from './RoutineFields';
import { defaultRoutineRule } from '@/domain/workPlan/routine';
import { useWorkPlanEventForm, type EventKind, type EventTarget } from './useWorkPlanEventForm';

interface MobileWorkPlanEventSheetProps {
  target: EventTarget;
  actor: User;
  deptId: string | null;
  users: User[];
  /** 부모가 만든 칸 조회(indexDayEntries) — 시간표에 겹쳐 보일 그날 일정 */
  cellOf: (userId: string, date: string) => DayCell;
  onClose: () => void;
  onSaved: (message: string) => void;
}

/**
 * 업무계획 일정 창(모바일) — 전체 화면. 이동 중 빠른 입력이 기본이고 기능은 PC 창과 같다(같은 훅·같은 저장).
 * 처음엔 종류·제목·날짜·시간만 보이고, 시간표와 나머지 칸은 접어 둔다.
 * 다른 칸·일정을 열 때는 호출부가 `key`를 바꿔 다시 마운트한다(훅 규칙).
 */
export function MobileWorkPlanEventSheet({ target, actor, deptId, users, cellOf, onClose, onSaved }: MobileWorkPlanEventSheetProps) {
  const form = useWorkPlanEventForm(target, actor, deptId);
  const { state, readOnly } = form;
  const owner = useMemo(() => ownerOf(target, users), [target, users]);
  const entry = target.mode === 'create' ? null : target.entry;
  const blocks = useEventBlocks(form, target, actor, users, cellOf, owner);
  const { save, join, leave, remove, confirmingDelete, setConfirmingDelete } = useEventActions(form, onSaved, onClose);
  const [showGrid, setShowGrid] = useState(false);
  // 보기·수정은 이미 적힌 내용을 볼 수 있게 펼쳐 둔다
  const [showMore, setShowMore] = useState(target.mode !== 'create');
  const [menuOpen, setMenuOpen] = useState(false);

  const close = form.saving ? () => {} : onClose;
  const heading = target.mode === 'create' ? '새 일정' : target.mode === 'edit' ? '일정 수정' : '일정 보기';
  const when = eventWhenLabel(state.date, isOutsideKind(state.kind) ? state.endDate : undefined);
  const subtitle = [owner.name, when.date, when.week].filter(Boolean).join(' · ');

  // 보기 중인 회의 — 참석자는 참석 취소, 주최자도 참석자도 아니면 합류
  const viewedMeeting = entry?.source === 'MEETING' ? entry.event ?? null : null;
  const canJoinViewed = Boolean(viewedMeeting && canJoinMeeting(actor.id, viewedMeeting) && actor.status === '사용');

  const fieldProps = {
    form,
    actor,
    users,
    ownerId: owner.id,
    ownerName: owner.name,
    outsideSelfId: entry?.outside?.self?.id ?? null,
    onJoin: (meeting: Parameters<typeof join>[0]) => void join(meeting),
    // 키보드가 바로 뜨므로 새 일정일 때만
    autoFocusTitle: target.mode === 'create',
  };

  return createPortal(
    // 모바일 앱 틀(가운데 최대 480px)과 같은 폭으로 화면 전체를 덮는다
    <div className="fixed inset-0 z-[110] flex justify-center bg-black/10">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={heading}
        className="flex h-full w-full max-w-[480px] flex-col bg-panel"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        {/* 머리줄 — 닫기 · 제목 · ⋯(리마인드·루틴 자리) */}
        <header className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-2">
          <button
            type="button"
            aria-label="닫기"
            disabled={form.saving}
            onClick={close}
            className="grid h-9 w-9 place-items-center rounded-lg text-ink2 active:bg-panel-alt disabled:opacity-50"
          >
            <X size={20} />
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <h2 className="truncate text-[15px] font-bold text-ink">{heading}</h2>
              {entry?.roomStatus === 'PENDING' && (
                <span className="shrink-0 rounded bg-amber-soft px-1.5 py-0.5 text-[10px] font-bold text-amber">회의실 승인 대기</span>
              )}
              {entry?.roomStatus === 'REJECTED' && (
                <span className="shrink-0 rounded bg-danger/10 px-1.5 py-0.5 text-[10px] font-bold text-danger">회의실 반려</span>
              )}
            </div>
            {subtitle && <p className="truncate text-[12px] font-semibold text-ink2">{subtitle}</p>}
          </div>
          <MoreMenu
            open={menuOpen}
            onOpenChange={setMenuOpen}
            routineAllowed={!readOnly && target.mode === 'create' && state.kind === 'ITEM'}
            routineOn={Boolean(form.routineRule)}
            onToggleRoutine={() => {
              form.setRoutineRule(form.routineRule ? null : defaultRoutineRule(state.date));
              setMenuOpen(false);
            }}
          />
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <KindRow form={form} target={target} />

          {/* 루틴(반복) — 새 일반 업무는 규칙, 루틴으로 만든 업무를 고칠 때는 범위 */}
          {form.routineRule && (
            <RoutineFields start={state.date} rule={form.routineRule} onChange={form.setRoutineRule} />
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

          {/* 세부 구분은 출장(국내·해외)만 — 외근은 고르지 않는다 */}
          {state.kind === 'TRIP' && (
            <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-4 py-2" role="radiogroup" aria-label="세부 구분">
              {OUTSIDE_WORK_SUBTYPES.TRIP.map((subType) => {
                const active = state.subType === subType;
                return (
                  <button
                    key={subType}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    disabled={readOnly}
                    onClick={() => form.setSubType(subType)}
                    className={`rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors disabled:cursor-not-allowed ${
                      active ? 'border-blue/40 bg-blue-soft text-blue' : 'border-border text-ink2 active:bg-panel-alt'
                    }`}
                  >
                    {subType}
                  </button>
                );
              })}
            </div>
          )}

          <fieldset disabled={readOnly} className="min-w-0 px-4 py-3">
            <EventFields {...fieldProps} part="main" />
          </fieldset>

          <Fold label="시간표" open={showGrid} onToggle={() => setShowGrid((v) => !v)}>
            <TimeGrid
              mode="touch"
              date={state.date}
              onDateChange={form.setDate}
              blocks={blocks}
              value={state.range}
              allDay={state.allDay}
              openEnd={state.kind === 'ITEM' && state.openEnd}
              allDayLabel={state.kind === 'ITEM' ? '미정' : '종일'}
              onChange={form.setRange}
            />
          </Fold>

          <Fold label="자세히" open={showMore} onToggle={() => setShowMore((v) => !v)}>
            <fieldset disabled={readOnly} className="min-w-0">
              <EventFields {...fieldProps} part="more" />
            </fieldset>
          </Fold>
        </div>

        {/* 저장 실패 이유 — 바닥 버튼 바로 위에 늘 보이게 */}
        {form.error && (
          <p role="alert" className="shrink-0 border-t border-danger/20 bg-danger/5 px-4 py-2 text-[12px] font-semibold text-danger">
            {form.error}
          </p>
        )}

        <footer
          className="flex shrink-0 items-center gap-2 border-t border-border bg-panel px-4 pt-3"
          style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
        >
          {readOnly ? (
            <>
              {form.leave && (
                <div className="flex-1">
                  <Button block variant="secondary" disabled={form.saving} onClick={() => void leave()}>참석 취소</Button>
                </div>
              )}
              {canJoinViewed && viewedMeeting && (
                <div className="flex-1">
                  <Button block variant="accent" disabled={form.saving} onClick={() => void join(viewedMeeting)}>참석자로 합류</Button>
                </div>
              )}
              <div className="flex-1">
                <Button block onClick={onClose}>닫기</Button>
              </div>
            </>
          ) : (
            <>
              {form.remove && (
                <div className="w-28 shrink-0">
                  {confirmingDelete ? (
                    <Button block variant="dangerSolid" disabled={form.saving} onClick={() => void remove()}>삭제 확인</Button>
                  ) : (
                    <Button block variant="danger" disabled={form.saving} onClick={() => setConfirmingDelete(true)}>삭제</Button>
                  )}
                </div>
              )}
              <div className="flex-1">
                <Button block variant="primary" disabled={form.saving} onClick={() => void save()}>
                  {form.saving ? '저장 중…' : '저장'}
                </Button>
              </div>
            </>
          )}
        </footer>
      </div>
    </div>,
    document.body,
  );
}

/** 접는 영역 — 머리 줄을 누르면 펼치고 접는다 */
function Fold({ label, open, onToggle, children }: { label: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <section className="border-t border-border">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full items-center justify-between px-4 py-3 text-[13px] font-bold text-ink2 active:bg-panel-alt"
      >
        {label}
        {open ? <ChevronUp size={16} className="text-ink3" /> : <ChevronDown size={16} className="text-ink3" />}
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </section>
  );
}

/** ⋯ 메뉴 — 루틴(새 일반 업무만). 리마인드는 나중 기능이라 자리만(비활성) */
function MoreMenu({
  open,
  onOpenChange,
  routineAllowed,
  routineOn,
  onToggleRoutine,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  routineAllowed: boolean;
  routineOn: boolean;
  onToggleRoutine: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onOpenChange(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open, onOpenChange]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="더보기"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
        className="grid h-9 w-9 place-items-center rounded-lg text-ink2 active:bg-panel-alt"
      >
        <MoreHorizontal size={20} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-20 mt-1 w-36 rounded-lg border border-border bg-panel p-1 shadow-lg">
          <button type="button" role="menuitem" disabled className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-[12.5px] font-semibold text-ink3 opacity-60">
            <Bell size={14} />
            리마인드
          </button>
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={routineOn}
            disabled={!routineAllowed}
            onClick={onToggleRoutine}
            className={`flex w-full items-center gap-2 rounded px-2.5 py-2 text-[12.5px] font-semibold disabled:opacity-50 ${routineOn ? 'bg-blue-soft text-blue' : 'text-ink2 active:bg-panel-alt'}`}
          >
            <Repeat size={14} />
            {routineOn ? '루틴 끄기' : '루틴'}
          </button>
        </div>
      )}
    </div>
  );
}

/** 종류 줄 — [회의|외근|출장|기타|일반 ▾] 다섯 칸(가로 스크롤 없음). 일반 ▾ 은 아래에 태그 목록을 펼친다. */
function KindRow({ form, target }: { form: EventForm; target: EventTarget }) {
  const { state, readOnly } = form;
  const tagsQuery = useWorkPlanTags();
  const tags = tagsQuery.data ?? [];
  const generalTags = selectableGeneralTags(tags);
  const [tagsOpen, setTagsOpen] = useState(false);

  const enabled = (kind: EventKind) => kindEnabled(kind, target, state.kind, readOnly);

  const cellClass = (active: boolean) =>
    `flex min-w-0 items-center justify-center gap-1 rounded-lg border px-1 py-2 text-[12.5px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
      active ? 'border-blue/40 bg-blue-soft text-blue' : 'border-border text-ink2 active:bg-panel-alt'
    }`;

  const currentTag = generalTagOf(tags, state.kind, state.tagId);
  const isEtc = state.kind === 'ITEM' && state.tagId === ETC_TAG_ID;

  const pickTag = (tagId: string) => {
    form.set('tagId', tagId);
    form.setKind('ITEM');
    setTagsOpen(false);
  };

  return (
    <div className="border-b border-border bg-panel-alt px-4 py-2.5">
      <div className="grid grid-cols-5 gap-1.5" role="radiogroup" aria-label="일정 종류">
        {FIXED_KINDS.map(({ kind, label, Icon }) => (
          <button
            key={kind}
            type="button"
            role="radio"
            aria-checked={state.kind === kind}
            disabled={!enabled(kind)}
            className={cellClass(state.kind === kind)}
            onClick={() => {
              form.setKind(kind);
              setTagsOpen(false);
            }}
          >
            <Icon size={14} className="shrink-0" />
            {label}
          </button>
        ))}
        <button
          type="button"
          role="radio"
          aria-checked={isEtc}
          disabled={!enabled('ITEM')}
          className={cellClass(isEtc)}
          onClick={() => pickTag(ETC_TAG_ID)}
        >
          <MoreHorizontal size={14} className="shrink-0" />
          기타
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={state.kind === 'ITEM' && !isEtc}
          aria-haspopup="listbox"
          aria-expanded={tagsOpen}
          disabled={!enabled('ITEM')}
          className={cellClass(state.kind === 'ITEM' && !isEtc)}
          onClick={() => setTagsOpen((v) => !v)}
        >
          {currentTag && <span className={`h-2 w-2 shrink-0 rounded-full ${dotClassOf(currentTag.colorId)}`} />}
          <span className="truncate">{currentTag?.name ?? '일반'}</span>
          <ChevronDown size={13} className="shrink-0" />
        </button>
      </div>

      {tagsOpen && (
        <div role="listbox" aria-label="일반 태그" className="mt-2 flex flex-wrap gap-1.5">
          {generalTags.length === 0 ? (
            <span className="px-1 py-1 text-[12px] text-ink3">고를 수 있는 태그가 없습니다.</span>
          ) : (
            generalTags.map((tag) => {
              const active = state.kind === 'ITEM' && state.tagId === tag.id;
              return (
                <button
                  key={tag.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => pickTag(tag.id)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-semibold ${
                    active ? 'border-blue/40 bg-blue-soft text-blue' : 'border-border bg-panel text-ink2 active:bg-panel-alt'
                  }`}
                >
                  <span className={`h-2 w-2 shrink-0 rounded-full ${dotClassOf(tag.colorId)}`} />
                  {tag.name}
                  {active && <Check size={13} className="shrink-0" />}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
