import { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, CalendarDays, Check, ChevronDown, Repeat, UserRound, MoreHorizontal } from 'lucide-react';
import { canJoinMeeting } from '@/domain/calendarEvent/meeting';
import { OUTSIDE_WORK_SUBTYPES } from '@/domain/outsideWork/schema';
import type { User } from '@/domain/user/schema';
import type { DayCell } from '@/domain/workPlan/dayEntries';
import { selectableGeneralTags, ETC_TAG_ID } from '@/domain/workPlan/tag';
import { useWorkPlanTags } from '@/features/workPlan/useWorkPlanItems';
import { Button } from '@/shared/ui/Button';
import { Modal } from '@/shared/ui/Modal';
import { EventFields, type EventForm } from './EventFields';
import { FIXED_KINDS, dotClassOf, eventWhenLabel, generalTagOf, isOutsideKind, ownerOf, useEventActions, useEventBlocks } from './eventShared';
import { kindEnabled } from './entryRouting';
import { RoutineFields, RoutineScopeFields } from './RoutineFields';
import { defaultRoutineRule } from '@/domain/workPlan/routine';
import { TimeGrid } from './TimeGrid';
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
}

/**
 * 업무계획 일정 창(PC) — 팀즈 일정 창을 우리 양식에 맞춘 것.
 * 위 도구 막대에서 종류(회의·외근·출장·일반 태그)를 고르고, 왼쪽에 입력, 오른쪽 세로 시간표로 시간을 고른다.
 * 다른 칸·일정을 열 때는 호출부가 `key`를 바꿔 다시 마운트한다(훅 규칙).
 */
export function WorkPlanEventModal({ target, actor, deptId, users, cellOf, onClose, onSaved }: WorkPlanEventModalProps) {
  const form = useWorkPlanEventForm(target, actor, deptId);
  const { state, readOnly } = form;
  const owner = useMemo(() => ownerOf(target, users), [target, users]);
  const entry = target.mode === 'create' ? null : target.entry;
  const blocks = useEventBlocks(form, target, actor, users, cellOf, owner);
  const { save, join, leave, remove, confirmingDelete, setConfirmingDelete } = useEventActions(form, onSaved, onClose);

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
      {form.remove && (
        <div className="mr-auto">
          {confirmingDelete ? (
            <Button variant="dangerSolid" disabled={form.saving} onClick={() => void remove()}>
              {form.editingRoutine && form.routineScope === 'following' ? '이후 모두 삭제' : '삭제 확인'}
            </Button>
          ) : (
            <Button variant="danger" disabled={form.saving} onClick={() => setConfirmingDelete(true)}>삭제</Button>
          )}
        </div>
      )}
      <Button disabled={form.saving} onClick={onClose}>취소</Button>
      <Button variant="primary" disabled={form.saving} onClick={() => void save()}>
        {form.saving ? '저장 중…' : '저장'}
      </Button>
    </>
  );

  return (
    <Modal
      open
      // 저장·삭제 중에는 ESC·바깥 클릭·X로 닫히지 않게
      onClose={form.saving ? () => {} : onClose}
      width={760}
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
      <div className="flex flex-col">
        <KindToolbar form={form} target={target} />

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
          <div className="flex flex-wrap items-center gap-1 border-b border-border px-5 py-2" role="radiogroup" aria-label="세부 구분">
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
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed ${
                    active ? 'border-blue/40 bg-blue-soft text-blue' : 'border-border text-ink2 hover:bg-panel-alt'
                  }`}
                >
                  {subType}
                </button>
              );
            })}
          </div>
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
                />
              </fieldset>
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
            />
          </div>
        </div>

        {/* 저장 실패 이유 — 왼쪽 스크롤과 상관없이 바닥 바로 위에 늘 보이게 */}
        {form.error && (
          <p role="alert" className="border-t border-danger/20 bg-danger/5 px-5 py-2 text-[11px] font-semibold text-danger">
            {form.error}
          </p>
        )}
      </div>
    </Modal>
  );
}

/** 위 도구 막대 — [회의|외근|출장|일반 ▾] 분할 버튼 + 오른쪽 리마인드·루틴 자리(나중 기능) */
function KindToolbar({ form, target }: { form: EventForm; target: EventTarget }) {
  const { state, readOnly } = form;
  const tagsQuery = useWorkPlanTags();
  const tags = tagsQuery.data ?? [];
  const generalTags = selectableGeneralTags(tags);
  const [menuOpen, setMenuOpen] = useState(false);
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
    `inline-flex items-center gap-1.5 border-r border-border px-3 py-1.5 text-[11.5px] font-semibold transition-colors last:border-r-0 disabled:cursor-not-allowed disabled:opacity-45 ${
      active ? 'bg-blue-soft text-blue' : 'text-ink2 hover:bg-panel-alt'
    }`;

  const currentTag = generalTagOf(tags, state.kind, state.tagId);
  const isEtc = state.kind === 'ITEM' && state.tagId === ETC_TAG_ID;

  const pickTag = (tagId: string) => {
    form.set('tagId', tagId);
    form.setKind('ITEM');
    setMenuOpen(false);
  };

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
          {FIXED_KINDS.map(({ kind, label, Icon }) => (
            <button
              key={kind}
              type="button"
              role="radio"
              aria-checked={state.kind === kind}
              disabled={!enabled(kind)}
              className={segClass(state.kind === kind)}
              onClick={() => form.setKind(kind)}
            >
              <Icon size={13} />
              {label}
            </button>
          ))}
          <button
            type="button"
            role="radio"
            aria-checked={isEtc}
            disabled={!enabled('ITEM')}
            className={segClass(isEtc)}
            onClick={() => pickTag(ETC_TAG_ID)}
          >
            <MoreHorizontal size={13} />
            기타
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={state.kind === 'ITEM' && !isEtc}
            aria-haspopup="listbox"
            aria-expanded={menuOpen}
            disabled={!enabled('ITEM')}
            className={segClass(state.kind === 'ITEM' && !isEtc)}
            onClick={() => setMenuOpen((v) => !v)}
          >
            {currentTag && <span className={`h-2 w-2 rounded-full ${dotClassOf(currentTag.colorId)}`} />}
            {currentTag?.name ?? '일반'}
            <ChevronDown size={13} />
          </button>
        </div>

        {menuOpen && (
          <div
            role="listbox"
            aria-label="일반 태그"
            className="absolute right-0 top-full z-30 mt-1 max-h-64 w-44 overflow-y-auto rounded-lg border border-border bg-panel p-1 shadow-lg"
          >
            {generalTags.length === 0 ? (
              <div className="px-2 py-2 text-[11px] text-ink3">고를 수 있는 태그가 없습니다.</div>
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
                    className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11.5px] font-semibold ${
                      active ? 'bg-blue-soft text-blue' : 'text-ink2 hover:bg-panel-alt'
                    }`}
                  >
                    <span className={`h-2 w-2 shrink-0 rounded-full ${dotClassOf(tag.colorId)}`} />
                    <span className="min-w-0 flex-1 truncate">{tag.name}</span>
                    {active && <Check size={13} className="shrink-0" />}
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>

      <span className="flex-1" />
      <Button variant="ghost" size="sm" disabled>
        <Bell size={12} />
        리마인드
      </Button>
      {/* 루틴 — 새 일반 업무만(회의·외근·출장은 아직) */}
      <Button
        variant={form.routineRule ? 'accent' : 'ghost'}
        size="sm"
        disabled={!routineAllowed}
        aria-pressed={Boolean(form.routineRule)}
        title={routineAllowed ? '반복 일정으로 만들기' : '새 일반 업무만 반복할 수 있습니다'}
        onClick={() => form.setRoutineRule(form.routineRule ? null : defaultRoutineRule(state.date))}
      >
        <Repeat size={12} />
        루틴
      </Button>
    </div>
  );
}
