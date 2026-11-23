import { useMemo, useState, type ReactNode } from 'react';
import { AlignLeft, ArrowRight, Car, Clock, Eye, MapPin, Phone, UserPlus, Users, X } from 'lucide-react';
import { canJoinMeeting } from '@/domain/calendarEvent/meeting';
import { CALENDAR_VISIBILITY_LABELS, type CalendarEvent, type CalendarVisibility } from '@/domain/calendarEvent/schema';
import type { User } from '@/domain/user/schema';
import { outsideKindLabel } from '@/domain/outsideWork/schema';
import { DEFAULT_COMMUTE_POLICY } from '@/domain/commutePolicy/schema';
import { DAY_END, durationLabel, endTimeOptions, quickDefaultRange, startTimeOptions, toHHmm, toMinutes } from '@/domain/workPlan/timeGrid';
import { useCanDesignate } from '@/features/auth/useCanDesignate';
import { useCommutePolicy } from '@/features/commute/useCommutePolicy';
import { useOutsideSchedulesOf } from '@/features/outsideWork/useOutsideWorks';
import { MemberPicker } from '@/modules/gw/task/MemberPicker';
import { Button } from '@/shared/ui/Button';
import { SelectField } from '@/shared/ui/form/SelectField';
import { TextField } from '@/shared/ui/form/TextField';
import { outsideLengthLabel, recentDestinations } from './eventFormMapping';
import { RoomPicker } from './RoomPicker';
import { TimeCombo } from './TimeCombo';
import type { useWorkPlanEventForm } from './useWorkPlanEventForm';

export type EventForm = ReturnType<typeof useWorkPlanEventForm>;

const DEFAULT_LENGTH = 60;
/** 길이 버튼(분) */
const LENGTH_PRESETS = [10, 20, 30, 60, 90, 120] as const;
/** 종료 목록의 '미정' 값 */
const OPEN_END = -1;

const textareaClass =
  'w-full resize-y rounded-md border border-border-hi bg-panel px-3 py-2 text-[13px] text-ink outline-none transition-colors placeholder:text-ink3 focus:border-teal disabled:bg-panel-alt';

const titleClass =
  'w-full border-0 border-b-2 border-border-hi bg-transparent px-0.5 py-1.5 text-[15px] font-bold text-ink outline-none transition-colors placeholder:font-semibold placeholder:text-ink3 focus:border-blue';

function Row({ icon, label, children }: { icon?: ReactNode; label?: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5" role="group" aria-label={label}>
      <span className="flex w-4 shrink-0 justify-center pt-2.5 text-ink3">{icon}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

interface EventFieldsProps {
  form: EventForm;
  actor: User;
  users: User[];
  /** 외근·출장 겹침 경고 대상(일정 주인) */
  ownerId: string;
  ownerName: string;
  /** 고치는 외근·출장 원본 id — 겹침 경고에서 자기 자신을 뺀다 */
  outsideSelfId: string | null;
  onJoin: (meeting: CalendarEvent) => void;
  /**
   * 나눠 그리기(모바일 시트) — 'main' = 처음 보이는 칸(제목·날짜·시간, 회의 참석자, 경고),
   * 'more' = [자세히] 안의 나머지 칸. 기본 'all'(PC 창, 한 번에 전부).
   */
  part?: 'all' | 'main' | 'more';
  /** 제목(행선지) 칸에 처음 포커스 — 기본 켬(PC). 모바일은 새 일정일 때만(키보드가 바로 뜨므로) */
  autoFocusTitle?: boolean;
}

/** 일정 창 왼쪽 입력 — 종류(일반·회의·외근·출장)마다 칸이 다르다. */
export function EventFields({ form, actor, users, ownerId, ownerName, outsideSelfId, onJoin, part = 'all', autoFocusTitle = true }: EventFieldsProps) {
  const { state, set, readOnly } = form;
  const isOutside = state.kind === 'OUTSIDE' || state.kind === 'TRIP';
  const isMeeting = state.kind === 'MEETING';
  const nameOf = (id: string) => users.find((u) => u.id === id)?.name ?? '';
  const main = part !== 'more';
  const more = part !== 'main';
  // 나눠 그릴 때(모바일)는 날짜·시각을 두 줄로
  const split = part !== 'all';

  if (isOutside) {
    return (
      <OutsideFields
        form={form}
        actor={actor}
        users={users}
        ownerId={ownerId}
        ownerName={ownerName}
        outsideSelfId={outsideSelfId}
        part={part}
        autoFocusTitle={autoFocusTitle}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3.5">
      {main && (
        <Row label="제목">
          <input
            aria-label="제목"
            className={titleClass}
            value={state.title}
            maxLength={100}
            placeholder={isMeeting ? '회의 제목' : '제목'}
            disabled={readOnly}
            autoFocus={autoFocusTitle && !readOnly}
            onChange={(e) => set('title', e.target.value)}
          />
        </Row>
      )}

      {main && isMeeting && (
        <Row icon={<Users size={15} />} label="참석자">
          <AttendeeField form={form} actor={actor} users={users} />
        </Row>
      )}

      {main && (
        <Row icon={<Clock size={15} />} label="날짜·시간">
          <TimeFields form={form} stacked={split} />
        </Row>
      )}

      {more && isMeeting && (
        <Row icon={<MapPin size={15} />} label="장소">
          <RoomPicker
            mode={state.locationMode}
            onModeChange={(mode) => set('locationMode', mode)}
            text={state.locationText}
            onTextChange={(text) => set('locationText', text)}
            rooms={form.rooms}
            roomId={state.roomId}
            onRoomChange={(roomId) => set('roomId', roomId)}
            disabled={readOnly}
          />
        </Row>
      )}

      {more && (
        <Row icon={<AlignLeft size={15} />} label="세부 내용">
          <textarea
            aria-label={isMeeting ? '세부 내용·안건' : '메모'}
            className={`${textareaClass} min-h-[84px]`}
            value={state.memo}
            maxLength={state.kind === 'ITEM' ? 1000 : 2000}
            rows={4}
            placeholder={isMeeting ? '세부 내용 · 안건' : '메모'}
            disabled={readOnly}
            onChange={(e) => set('memo', e.target.value)}
          />
        </Row>
      )}

      {more && isMeeting && (
        <Row icon={<Eye size={15} />} label="공개 범위">
          <div className="w-44">
            <SelectField
              aria-label="공개 범위"
              value={state.visibility}
              disabled={readOnly}
              options={visibilityOptionsOf(form.visibilityOptions, state.visibility)}
              onChange={(e) => set('visibility', e.target.value as CalendarVisibility)}
            />
          </div>
        </Row>
      )}

      {main && isMeeting && form.similarMeetings.length > 0 && (
        <SimilarMeetings meetings={form.similarMeetings} actorId={actor.id} nameOf={nameOf} saving={form.saving} onJoin={onJoin} />
      )}
    </div>
  );
}

/** 기존 공개 범위가 선택지에 없으면(예: 부서 없음) 그 값도 남겨 둔다 */
function visibilityOptionsOf(options: CalendarVisibility[], current: CalendarVisibility) {
  const list = options.includes(current) ? options : [...options, current];
  return list.map((value) => ({ value, label: CALENDAR_VISIBILITY_LABELS[value] }));
}

const TRANSPORT_PRESETS = ['자차', '법인차량', '대중교통', 'KTX·기차', '항공'] as const;
const RECENT_DESTINATION_LIMIT = 5;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3" aria-label={title}>
      <h3 className="border-b border-border pb-1 text-[11px] font-bold text-ink3">{title}</h3>
      {children}
    </section>
  );
}

/**
 * 외근·출장 입력 — 제목(저장은 목적 칸) → 출장지·외근지(행선지·기간) → 세부 정보(동행자·교통·연락처·메모).
 * 나눠 그릴 때(모바일) 'main' = 제목·장소·기간, 'more' = 종료일과 세부 정보.
 */
function OutsideFields({
  form,
  actor,
  users,
  ownerId,
  ownerName,
  outsideSelfId,
  part,
  autoFocusTitle,
}: Omit<EventFieldsProps, 'onJoin'> & { part: 'all' | 'main' | 'more'; autoFocusTitle: boolean }) {
  const { state, set, readOnly } = form;
  const kind = state.kind === 'TRIP' ? 'TRIP' : 'OUTSIDE';
  const placeLabel = kind === 'TRIP' ? '출장지' : '외근지';
  const main = part !== 'more';
  const more = part !== 'main';
  const split = part !== 'all';
  const endDate = state.endDate < state.date ? state.date : state.endDate;
  const length = outsideLengthLabel(kind, state.date, endDate);
  const nameOf = (id: string) => users.find((u) => u.id === id)?.name ?? '';

  return (
    <div className="flex flex-col gap-4">
      {main && (
        <Row label="제목">
          <input
            aria-label="제목"
            className={titleClass}
            value={state.purpose}
            maxLength={500}
            placeholder="제목"
            disabled={readOnly}
            autoFocus={autoFocusTitle && !readOnly}
            onChange={(e) => set('purpose', e.target.value)}
          />
        </Row>
      )}

      {main && (
        <Section title={placeLabel}>
          <Row icon={<MapPin size={15} />} label={placeLabel}>
            <DestinationField form={form} ownerId={ownerId} ownerName={ownerName} placeholder={placeLabel} />
          </Row>
          <Row icon={<Clock size={15} />} label="날짜·시간">
            <TimeFields form={form} stacked={split} showEndDate={!split} />
            {length && !split && <LengthBadge length={length} />}
          </Row>
          {!readOnly && (
            <OutsideOverlapWarning ownerId={ownerId} ownerName={ownerName} selfId={outsideSelfId} startDate={state.date} endDate={endDate} />
          )}
        </Section>
      )}

      {more && (
        <Section title="세부 정보">
          {split && (
            <Row icon={<Clock size={15} />} label="종료일">
              <div className="flex flex-wrap items-center gap-2">
                <EndDateField form={form} />
                {length && <LengthBadge length={length} />}
              </div>
            </Row>
          )}
          <Row icon={<Users size={15} />} label="동행자">
            <CompanionField
              form={form}
              actor={actor}
              users={users}
              nameOf={nameOf}
              selfId={outsideSelfId}
              startDate={state.date}
              endDate={endDate}
            />
          </Row>
          <Row icon={<Car size={15} />} label="교통수단">
            <TransportField form={form} />
          </Row>
          <Row icon={<Phone size={15} />} label="연락처">
            <TextField
              aria-label="연락처"
              value={state.contact}
              maxLength={50}
              placeholder="연락처"
              disabled={readOnly}
              className="w-full max-w-[240px]"
              onChange={(e) => set('contact', e.target.value)}
            />
          </Row>
          <Row icon={<AlignLeft size={15} />} label="메모">
            <textarea
              aria-label="메모"
              className={`${textareaClass} min-h-[84px]`}
              value={state.memo}
              maxLength={2000}
              rows={4}
              placeholder="메모"
              disabled={readOnly}
              onChange={(e) => set('memo', e.target.value)}
            />
          </Row>
        </Section>
      )}
    </div>
  );
}

function LengthBadge({ length }: { length: string }) {
  return <span className="mt-1.5 inline-block rounded bg-teal/10 px-1.5 py-0.5 text-[11px] font-bold text-teal">{length}</span>;
}

/** 행선지 — 비어 있으면 일정 주인의 지난 행선지를 눌러 채운다 */
function DestinationField({ form, ownerId, ownerName, placeholder }: { form: EventForm; ownerId: string; ownerName: string; placeholder: string }) {
  const { state, set, readOnly } = form;
  const schedules = useOutsideSchedulesOf(ownerId, ownerName);
  const recent = useMemo(() => recentDestinations(schedules, RECENT_DESTINATION_LIMIT), [schedules]);
  const showRecent = !readOnly && !state.destination.trim() && recent.length > 0;

  return (
    <div className="flex flex-col gap-1.5">
      <TextField
        aria-label={placeholder}
        value={state.destination}
        maxLength={200}
        placeholder={placeholder}
        disabled={readOnly}
        className="w-full"
        onChange={(e) => set('destination', e.target.value)}
      />
      {showRecent && (
        <div className="flex flex-wrap items-center gap-1" aria-label="지난 행선지">
          <span className="text-[10.5px] font-semibold text-ink3">최근</span>
          {recent.map((destination) => (
            <button
              key={destination}
              type="button"
              className="max-w-[200px] truncate rounded-full border border-border px-2 py-0.5 text-[11px] font-semibold text-ink2 hover:bg-panel-alt"
              onClick={() => set('destination', destination)}
            >
              {destination}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** 교통수단 — 자주 쓰는 것은 눌러 고르고(다시 누르면 해제), 그 밖은 직접 입력 */
function TransportField({ form }: { form: EventForm }) {
  const { state, set, readOnly } = form;
  return (
    <div className="flex flex-col gap-1.5">
      {!readOnly && (
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="교통수단 고르기">
          {TRANSPORT_PRESETS.map((preset) => {
            const active = state.transportation === preset;
            return (
              <button
                key={preset}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => set('transportation', active ? '' : preset)}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                  active ? 'border-blue/40 bg-blue-soft text-blue' : 'border-border text-ink2 hover:bg-panel-alt'
                }`}
              >
                {preset}
              </button>
            );
          })}
        </div>
      )}
      <TextField
        aria-label="교통수단"
        value={state.transportation}
        maxLength={50}
        placeholder={readOnly ? '' : '직접 입력'}
        disabled={readOnly}
        className="w-full max-w-[240px]"
        onChange={(e) => set('transportation', e.target.value)}
      />
    </div>
  );
}

/** 외근·출장 종료일 */
function EndDateField({ form }: { form: EventForm }) {
  const { state, set, readOnly } = form;
  return (
    <TextField
      type="date"
      aria-label="종료일"
      value={state.endDate}
      min={state.date}
      disabled={readOnly}
      className="w-[140px]"
      onChange={(e) => e.target.value && set('endDate', e.target.value)}
    />
  );
}

/**
 * 날짜·시각 칸. `stacked` = 날짜 줄과 시각 줄을 나눈다(좁은 화면),
 * `showEndDate` = 외근·출장 종료일을 함께 둔다(모바일은 [자세히]로 뺀다).
 */
function TimeFields({ form, stacked = false, showEndDate = true }: { form: EventForm; stacked?: boolean; showEndDate?: boolean }) {
  const { state, set, readOnly } = form;
  const { policy = DEFAULT_COMMUTE_POLICY } = useCommutePolicy();
  const work = { start: toMinutes(policy.workStartTime), end: toMinutes(policy.workEndTime) };
  const isOutside = state.kind === 'OUTSIDE' || state.kind === 'TRIP';
  const isMeeting = state.kind === 'MEETING';
  const isItem = state.kind === 'ITEM';
  const range = state.range;
  const showTimes = isMeeting || !state.allDay;
  // 업무만 — 종료 미정(시작만)
  const openEnd = isItem && state.openEnd;

  // 시각 = 입력 + 10분 간격 목록(TimeCombo). 시작을 바꾸면 길이를 유지하고, 종료는 시작보다 늦어야 한다
  const onStart = (start: number) => {
    if (start >= DAY_END) return;
    const length = range ? range.end - range.start : DEFAULT_LENGTH;
    form.setRange({ start, end: Math.min(start + Math.max(length, 1), DAY_END) });
    // 시작만 옮긴 것 — 종료 미정은 그대로
    if (openEnd) set('openEnd', true);
  };
  const onEnd = (end: number) => {
    if (end === OPEN_END) {
      set('openEnd', true);
      return;
    }
    if (!range || end <= range.start) return;
    form.setRange({ start: range.start, end });
  };
  const onLength = (length: number) => {
    if (!range) return;
    form.setRange({ start: range.start, end: Math.min(range.start + length, DAY_END) });
  };
  const startOptions = startTimeOptions(range?.start ?? null).map((minute) => ({ minute, label: toHHmm(minute) }));
  const endOptions = range
    ? [...(isItem ? [{ minute: OPEN_END, label: '미정' }] : []), ...endTimeOptions(range.start, openEnd ? null : range.end)]
    : [];
  const dates = (
    <>
      <TextField
        type="date"
        aria-label={isOutside ? '시작일' : '날짜'}
        value={state.date}
        disabled={readOnly}
        className="w-[140px]"
        onChange={(e) => form.setDate(e.target.value)}
      />
      {isOutside && showEndDate && (
        <>
          <span className="text-ink3">~</span>
          <TextField
            type="date"
            aria-label="종료일"
            value={state.endDate}
            min={state.date}
            disabled={readOnly}
            className="w-[140px]"
            onChange={(e) => e.target.value && set('endDate', e.target.value)}
          />
        </>
      )}
    </>
  );
  const times = showTimes && (
    <>
      <TimeCombo
        aria-label="시작 시각"
        className="w-[88px]"
        value={range?.start ?? null}
        options={startOptions}
        anchor={quickDefaultRange(new Date()).start}
        work={work}
        placeholder="시작"
        disabled={readOnly}
        touch={stacked}
        onChange={onStart}
      />
      <ArrowRight size={13} className="text-ink3" />
      <TimeCombo
        aria-label="종료 시각"
        className="w-[88px]"
        value={openEnd ? OPEN_END : range?.end ?? null}
        options={endOptions}
        anchor={range?.end}
        work={work}
        placeholder="종료"
        disabled={readOnly || !range}
        touch={stacked}
        onChange={onEnd}
      />
      {range && range.end > range.start && !openEnd && (
        <span className="text-[11px] font-semibold text-ink3">{durationLabel(range)}</span>
      )}
    </>
  );
  // 자주 쓰는 길이 — 누르면 시작 기준으로 끝을 정한다
  const lengths = showTimes && range && !readOnly && (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label="길이">
      {LENGTH_PRESETS.map((length) => {
        const active = !openEnd && range.end - range.start === length;
        return (
          <button
            key={length}
            type="button"
            aria-pressed={active}
            disabled={range.start + length > DAY_END}
            onClick={() => onLength(length)}
            className={`rounded-full border px-2 py-0.5 text-[10.5px] font-semibold transition-colors disabled:opacity-40 ${
              active ? 'border-blue/40 bg-blue-soft text-blue' : 'border-border text-ink2 hover:bg-panel-alt'
            }`}
          >
            {durationLabel({ start: 0, end: length })}
          </button>
        );
      })}
      {isItem && (
        <button
          type="button"
          aria-pressed={openEnd}
          onClick={() => set('openEnd', true)}
          className={`rounded-full border px-2 py-0.5 text-[10.5px] font-semibold transition-colors ${
            openEnd ? 'border-blue/40 bg-blue-soft text-blue' : 'border-border text-ink2 hover:bg-panel-alt'
          }`}
        >
          미정
        </button>
      )}
    </div>
  );
  const allDayToggle = !isMeeting && (
    <label className="ml-1 inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-ink2">
      <input
        type="checkbox"
        className="accent-teal"
        checked={state.allDay}
        disabled={readOnly}
        onChange={(e) => form.setAllDay(e.target.checked)}
      />
      {/* 업무는 시각 없음 = 시간을 모르는 일(날짜만) — 외근·출장의 종일은 근태와 이어져 그대로 */}
      {isItem ? '시간 미정' : '종일'}
    </label>
  );
  // 업무만 — 종일 = 회사 업무시간(근태 정책 출근~퇴근) 전체를 차지하는 일
  const workDay = !state.allDay && !openEnd && range?.start === work.start && range?.end === work.end;
  const workDayChip = isItem && !readOnly && work.end > work.start && (
    <button
      type="button"
      aria-pressed={workDay}
      onClick={() => form.setRange({ start: work.start, end: work.end })}
      className={`rounded-full border px-2 py-0.5 text-[10.5px] font-semibold transition-colors ${
        workDay ? 'border-blue/40 bg-blue-soft text-blue' : 'border-border text-ink2 hover:bg-panel-alt'
      }`}
    >
      종일 {policy.workStartTime}~{policy.workEndTime}
    </button>
  );

  if (stacked) {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {dates}
          {workDayChip}
          {allDayToggle}
        </div>
        {times && <div className="flex flex-wrap items-center gap-1.5">{times}</div>}
        {lengths}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {dates}
        {times}
        {workDayChip}
        {allDayToggle}
      </div>
      {lengths}
    </div>
  );
}

/** 회의 참석자 — 이름·부서 검색 칩(캘린더 회의 창과 같은 후보 규칙) */
function AttendeeField({ form, actor, users }: { form: EventForm; actor: User; users: User[] }) {
  const { state, set, readOnly } = form;
  const { canDesignate } = useCanDesignate();
  const [keyword, setKeyword] = useState('');
  const [open, setOpen] = useState(false);

  const selected = useMemo(
    () => state.attendeeIds.map((id) => users.find((u) => u.id === id)).filter((u): u is User => Boolean(u)),
    [state.attendeeIds, users],
  );

  const candidates = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return [];
    return users
      .filter((u) => u.status === '사용' && !u.resignedAt && u.id !== actor.id && !state.attendeeIds.includes(u.id) && canDesignate(u))
      .filter((u) => u.name.toLowerCase().includes(kw) || u.dept.toLowerCase().includes(kw) || (u.position ?? '').toLowerCase().includes(kw))
      .slice(0, 8);
  }, [users, keyword, actor.id, state.attendeeIds, canDesignate]);

  const add = (id: string) => {
    set('attendeeIds', [...state.attendeeIds, id]);
    setKeyword('');
    setOpen(false);
  };
  const remove = (id: string) => set('attendeeIds', state.attendeeIds.filter((v) => v !== id));

  return (
    <div className="relative">
      <div className="flex min-h-9 flex-wrap items-center gap-1 rounded-md border border-border-hi bg-panel px-1.5 py-1 focus-within:border-teal">
        {selected.map((u) => (
          <span
            key={u.id}
            className="inline-flex items-center gap-1 rounded-full bg-blue-soft py-0.5 pl-2 pr-1 text-[11px] font-semibold text-blue"
          >
            {u.name}{u.position ? ` ${u.position}` : ''}
            {!readOnly && (
              <button
                type="button"
                aria-label={`${u.name} 빼기`}
                className="grid h-4 w-4 place-items-center rounded-full hover:bg-blue/15"
                onClick={() => remove(u.id)}
              >
                <X size={11} />
              </button>
            )}
          </span>
        ))}
        {!readOnly && (
          <input
            type="text"
            aria-label="참석자 검색"
            value={keyword}
            placeholder={selected.length === 0 ? '이름 또는 부서로 참석자 추가' : ''}
            className="h-6 min-w-[120px] flex-1 bg-transparent px-1 text-[12px] text-ink outline-none placeholder:text-ink3"
            onChange={(e) => {
              setKeyword(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={(e) => {
              // 검색 목록만 닫는다(창의 ESC 닫기까지 가지 않게)
              if (e.key !== 'Escape' || !open || !keyword.trim()) return;
              e.nativeEvent.stopPropagation();
              setOpen(false);
            }}
          />
        )}
        {!readOnly && <UserPlus size={13} className="mr-1 shrink-0 text-ink3" />}
      </div>

      {open && keyword.trim() && (
        <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-48 overflow-y-auto rounded-lg border border-border bg-panel py-1 shadow-lg">
          {candidates.length === 0 ? (
            <div className="py-3 text-center text-[11px] text-ink3">일치하는 사원이 없습니다.</div>
          ) : (
            candidates.map((u) => (
              <button
                key={u.id}
                type="button"
                // 입력칸 blur 보다 먼저 받는다
                onMouseDown={(e) => {
                  e.preventDefault();
                  add(u.id);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11.5px] hover:bg-panel-alt"
              >
                <span className="font-bold text-ink">{u.name}</span>
                <span className="text-[10.5px] text-ink3">{u.position}</span>
                <span className="ml-auto rounded bg-panel-alt px-1.5 text-[10px] text-ink3">{u.dept}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/** 외근·출장 동행자 — 기존 등록 창과 같은 부서 트리 선택기. 동행자마다 같은 기간 외근·출장 겹침도 알린다 */
function CompanionField({
  form,
  actor,
  users,
  nameOf,
  selfId,
  startDate,
  endDate,
}: {
  form: EventForm;
  actor: User;
  users: User[];
  nameOf: (id: string) => string;
  selfId: string | null;
  startDate: string;
  endDate: string;
}) {
  const { state, set, readOnly } = form;
  const [showPicker, setShowPicker] = useState(false);
  const pickable = useMemo(() => users.filter((u) => u.id !== actor.id), [users, actor.id]);
  const companions = state.companionIds.map((id) => ({ id, name: nameOf(id) })).filter((c) => c.name);
  const remove = (id: string) => set('companionIds', state.companionIds.filter((v) => v !== id));

  return (
    <div className="flex flex-col gap-1.5 pt-1">
      <div className="flex flex-wrap items-center gap-1">
        {companions.map(({ id, name }) => {
          const position = users.find((u) => u.id === id)?.position;
          return (
            <span key={id} className="inline-flex items-center gap-1 rounded-full bg-blue-soft py-0.5 pl-2 pr-1 text-[11px] font-semibold text-blue">
              {name}{position ? ` ${position}` : ''}
              {!readOnly && (
                <button
                  type="button"
                  aria-label={`${name} 빼기`}
                  className="grid h-4 w-4 place-items-center rounded-full hover:bg-blue/15"
                  onClick={() => remove(id)}
                >
                  <X size={11} />
                </button>
              )}
            </span>
          );
        })}
        {companions.length === 0 && readOnly && <span className="text-[11.5px] text-ink3">없음</span>}
        {!readOnly && (
          <Button size="sm" variant="accent" onClick={() => setShowPicker((v) => !v)}>
            {showPicker ? '닫기' : '동행자 선택'}
          </Button>
        )}
      </div>
      {showPicker && !readOnly && (
        <MemberPicker users={pickable} selected={state.companionIds} lockedUserId="" onChange={(ids) => set('companionIds', ids)} />
      )}
      {!readOnly &&
        companions.map(({ id, name }) => (
          <OutsideOverlapWarning key={id} ownerId={id} ownerName={name} selfId={selfId} startDate={startDate} endDate={endDate} who={name} />
        ))}
    </div>
  );
}

/** 같은 사람의 같은 기간 외근·출장(결재 완료 + 직접 등록) — 경고만, 저장은 막지 않는다 */
function OutsideOverlapWarning({
  ownerId,
  ownerName,
  selfId,
  startDate,
  endDate,
  who,
}: {
  ownerId: string;
  ownerName: string;
  selfId: string | null;
  startDate: string;
  endDate: string;
  /** 동행자 겹침이면 그 사람 이름 */
  who?: string;
}) {
  const existing = useOutsideSchedulesOf(ownerId, ownerName);
  const overlapping = existing.filter(
    (v) => v.key !== (selfId ? `self-${selfId}` : '') && v.startDate <= endDate && v.endDate >= startDate,
  );
  if (overlapping.length === 0) return null;
  return (
    <p className="rounded-md border border-amber/30 bg-amber-soft/30 px-3 py-2 text-[11px] font-semibold text-amber">
      {who ? `${who}님은 ` : ''}이 기간에 이미 외근·출장이 있습니다:{' '}
      {overlapping.map((v) => `${outsideKindLabel(v.category, v.subType)}${v.destination ? ` (${v.destination})` : ''}`).join(', ')}
    </p>
  );
}

function SimilarMeetings({
  meetings,
  actorId,
  nameOf,
  saving,
  onJoin,
}: {
  meetings: CalendarEvent[];
  actorId: string;
  nameOf: (id: string) => string;
  saving: boolean;
  onJoin: (meeting: CalendarEvent) => void;
}) {
  return (
    <div className="rounded-lg border border-amber/30 bg-amber-soft/30 px-3 py-2.5">
      <div className="mb-1.5 text-[11px] font-bold text-amber">비슷한 회의가 있습니다</div>
      <div className="flex flex-col gap-1.5">
        {meetings.map((m) => (
          <div key={m.id} className="flex items-center justify-between gap-2 rounded-md bg-panel px-2.5 py-1.5">
            <div className="min-w-0">
              <div className="truncate text-[11.5px] font-bold text-ink">{m.title}</div>
              <div className="text-[10px] text-ink3">
                {m.allDay ? '종일' : `${m.startTime}~${m.endTime}`} · 주최 {nameOf(m.ownerUserId) || '알 수 없음'} · 참석 {m.attendeeUserIds.length}명
              </div>
            </div>
            {canJoinMeeting(actorId, m) ? (
              <Button size="sm" variant="primary" disabled={saving} onClick={() => onJoin(m)}>
                참석자로 합류
              </Button>
            ) : (
              <span className="shrink-0 text-[10px] font-semibold text-ink3">이미 포함됨</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
