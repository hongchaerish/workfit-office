import { useState, useMemo, type FormEvent } from 'react';
import { CalendarEventError, type CalendarEventActor } from '@/data/calendarEvent/calendarEvent.repo';
import {
  CALENDAR_VISIBILITIES,
  CALENDAR_VISIBILITY_LABELS,
  CALENDAR_EVENT_TYPE_LABELS,
  type CalendarEvent,
  type CalendarEventDraft,
  type CalendarVisibility,
  type CalendarEventType,
} from '@/domain/calendarEvent/schema';
import type { WorkProject } from '@/domain/workProject/schema';
import {
  useCreateCalendarEvent,
  useRemoveCalendarEvent,
  useUpdateCalendarEvent,
} from '@/features/calendar/useCalendarEvents';
import { useUsers } from '@/features/user/useUsers';
import { usePermission } from '@/features/auth/usePermission';
import { Button } from '@/shared/ui/Button';
import { Modal } from '@/shared/ui/Modal';
import { Field } from '@/shared/ui/form/Field';
import { TextField } from '@/shared/ui/form/TextField';
import { Users, X, ShieldAlert, Sparkles, UserPlus } from 'lucide-react';

/**
 * 캘린더에서 직접 등록 가능한 일정 유형.
 * 외근·출장(OUTSIDE), 휴가·부재(VACATION)는 전자결재 승인을 통해서만 공인·등록되므로 등록 목록에서 제거합니다.
 */
const CREATABLE_EVENT_TYPES: CalendarEventType[] = ['GENERAL', 'MEETING', 'COMPANY_EVENT'];

interface CalendarEventModalProps {
  actor: CalendarEventActor;
  initialDate: string;
  event?: CalendarEvent;
  initialTitle?: string;
  initialEventType?: CalendarEventType;
  initialAttendees?: string[];
  /** 내가 참여 중인 프로젝트. 프로젝트 공유 대상으로 고를 수 있다. */
  myProjects: WorkProject[];
  /** 내 부서 이름. 부서 공유가 어디로 가는지 화면에 밝히는 데 쓴다. */
  deptName: string | null;
  /** 공유받은 일정의 주인 이름. 내 일정이면 넘기지 않는다. */
  ownerName?: string | null;
  onClose: () => void;
  onSaved: (event: CalendarEvent) => void;
  onRemoved: (event: CalendarEvent) => void;
}

/** 범위별 한 줄 설명. 고르기 전에 누가 보게 되는지 알려준다. */
const VISIBILITY_HINTS: Record<CalendarVisibility, string> = {
  PRIVATE: '나만 볼 수 있습니다.',
  TEAM: '같은 부서 구성원이 볼 수 있습니다.',
  COMPANY: '전 직원이 볼 수 있습니다.',
  PROJECT: '고른 프로젝트의 참여자가 볼 수 있습니다.',
};

export default function CalendarEventModal({
  actor,
  initialDate,
  event,
  initialTitle,
  initialEventType,
  initialAttendees,
  myProjects,
  deptName,
  ownerName,
  onClose,
  onSaved,
  onRemoved,
}: CalendarEventModalProps) {
  const { isOperator, isExecutive } = usePermission();
  const canManageCompanyEvent = isOperator || isExecutive;

  const usersQuery = useUsers();
  const allUsers = usersQuery.data ?? [];

  /** 전자결재 승인 건 연동 여부 (CAL-APPR- 로 시작하는 가상 합성 일정) */
  const isApprovalEvent = Boolean(event?.id?.startsWith('CAL-APPR-'));

  /*
    공유는 보여주기까지다. 남의 일정 및 전자결재 연동 일정은 열어서 볼 수만 있다.
    결재 연동 일정은 결재 문서에서 취소해야 하므로 캘린더에서 직접 수정/삭제하지 못하게 막는다.
  */
  const canEdit = !isApprovalEvent && (!event || event.ownerUserId === actor.userId);
  const [title, setTitle] = useState(event?.title ?? initialTitle ?? '');
  const [date, setDate] = useState(event?.date ?? initialDate);
  const [allDay, setAllDay] = useState(event?.allDay ?? true);
  const [startTime, setStartTime] = useState(event?.startTime ?? '09:00');
  const [endTime, setEndTime] = useState(event?.endTime ?? '10:00');
  const [memo, setMemo] = useState(event?.memo ?? '');
  const [visibility, setVisibility] = useState<CalendarVisibility>(event?.visibility ?? 'PRIVATE');
  const [eventType, setEventType] = useState<CalendarEventType>(
    event?.eventType ?? initialEventType ?? (event?.visibility === 'COMPANY' ? 'COMPANY_EVENT' : 'GENERAL'),
  );
  const [attendeeUserIds, setAttendeeUserIds] = useState<string[]>(
    event?.attendeeUserIds ?? initialAttendees ?? [],
  );
  const [attendeeSearch, setAttendeeSearch] = useState('');
  const [isAttendeeSearchOpen, setIsAttendeeSearchOpen] = useState(false);
  const [projectId, setProjectId] = useState(event?.projectId ?? myProjects[0]?.id ?? '');
  const [error, setError] = useState('');

  const createEvent = useCreateCalendarEvent();
  const updateEvent = useUpdateCalendarEvent();
  const removeEvent = useRemoveCalendarEvent();
  const pending = createEvent.isPending || updateEvent.isPending || removeEvent.isPending;

  /* 소속이 없으면 부서 공유가 아무에게도 안 닿는다. 고르게 두지 않고 이유를 밝힌다. */
  const canShareToTeam = Boolean(actor.deptId);
  const canShareToProject = myProjects.length > 0;
  const disabledReason = (option: CalendarVisibility): string | null => {
    if (option === 'TEAM' && !canShareToTeam) return '소속 부서가 없어 부서 공유를 쓸 수 없습니다.';
    if (option === 'PROJECT' && !canShareToProject) return '참여 중인 프로젝트가 없습니다.';
    return null;
  };

  /** 참여자 검색 필터링 */
  const searchedUsers = useMemo(() => {
    if (!attendeeSearch.trim()) return [];
    const kw = attendeeSearch.trim().toLowerCase();
    return allUsers
      .filter((u) => u.status === '사용' && !u.resignedAt && u.id !== actor.userId && !attendeeUserIds.includes(u.id))
      .filter((u) => u.name.toLowerCase().includes(kw) || u.dept.toLowerCase().includes(kw) || (u.position ?? '').toLowerCase().includes(kw))
      .slice(0, 8);
  }, [allUsers, attendeeSearch, attendeeUserIds, actor.userId]);

  /** 선택된 참여자 객체 목록 */
  const selectedAttendees = useMemo(() => {
    return attendeeUserIds
      .map((id) => allUsers.find((u) => u.id === id))
      .filter(Boolean) as typeof allUsers;
  }, [attendeeUserIds, allUsers]);

  const addAttendee = (userId: string) => {
    if (!attendeeUserIds.includes(userId)) {
      setAttendeeUserIds((prev) => [...prev, userId]);
    }
    setAttendeeSearch('');
    setIsAttendeeSearchOpen(false);
  };

  const removeAttendee = (userId: string) => {
    setAttendeeUserIds((prev) => prev.filter((id) => id !== userId));
  };

  /**
   * 화면에 띄울 오류 문구.
   */
  const errorText = (caught: unknown, fallback: string): string => {
    if (caught instanceof CalendarEventError) return caught.message;
    console.error(caught);
    return fallback;
  };

  const draft = (): CalendarEventDraft => ({
    title,
    date,
    allDay,
    startTime: allDay ? null : startTime,
    endTime: allDay ? null : endTime,
    memo,
    visibility: eventType === 'COMPANY_EVENT' ? 'COMPANY' : visibility,
    eventType,
    attendeeUserIds,
    deptId: visibility === 'TEAM' ? actor.deptId ?? null : null,
    projectId: visibility === 'PROJECT' ? projectId || null : null,
  });

  const submit = async (submitEvent: FormEvent) => {
    submitEvent.preventDefault();
    setError('');

    // 사내행사 권한 검증
    if (eventType === 'COMPANY_EVENT' && !canManageCompanyEvent) {
      setError('사내행사는 운영자(OPERATOR) 또는 임원(EXEC) 권한을 가진 사용자만 등록할 수 있습니다.');
      return;
    }

    try {
      const saved = event
        ? await updateEvent.mutateAsync({ actor, id: event.id, draft: draft() })
        : await createEvent.mutateAsync({ actor, draft: draft() });
      onSaved(saved as CalendarEvent);
    } catch (caught) {
      setError(errorText(caught, '일정을 저장하지 못했습니다.'));
    }
  };

  const remove = async () => {
    if (!event || !window.confirm(`‘${event.title}’ 일정을 삭제하시겠습니까?`)) return;
    setError('');
    try {
      const removed = await removeEvent.mutateAsync({ actor, id: event.id });
      onRemoved(removed as CalendarEvent);
    } catch (caught) {
      setError(errorText(caught, '일정을 삭제하지 못했습니다.'));
    }
  };

  return (
    <Modal
      open
      onClose={() => !pending && onClose()}
      title={
        isApprovalEvent
          ? `${CALENDAR_EVENT_TYPE_LABELS[eventType]?.label ?? '전자결재 일정'} 상세`
          : !canEdit
          ? '공유받은 일정'
          : event
          ? `${CALENDAR_EVENT_TYPE_LABELS[eventType]?.label ?? '일정'} 수정`
          : '새 일정 등록'
      }
      width={Math.min(640, window.innerWidth - 32)}
      footer={
        canEdit ? (
          <>
            {event && (
              <span className="mr-auto">
                <Button variant="danger" onClick={() => void remove()} disabled={pending}>
                  삭제
                </Button>
              </span>
            )}
            <Button onClick={onClose} disabled={pending}>
              취소
            </Button>
            <Button variant="primary" type="submit" form="calendar-event-form" disabled={pending}>
              {pending ? '처리 중…' : '저장'}
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>닫기</Button>
        )
      }
    >
      <fieldset disabled={!canEdit} className="contents">
        {isApprovalEvent ? (
          <div className="mb-4 rounded-lg border border-teal/30 bg-teal-soft/10 px-3.5 py-2.5 text-[11px] leading-relaxed text-ink2">
            <strong className="font-bold text-teal">전자결재 승인 연동 일정</strong>
            <p className="text-[10.5px] text-ink3 mt-0.5">
              이 일정은 전자결재(외근·출장·휴가)로 승인되어 자동 등록되었습니다.{eventType === 'VACATION' ? ' 개인 프라이버시 보호를 위해 연차 사유는 비공개 처리되며,' : ''} 일정 취소 및 변경은 전자결재 문서(취소 기안 등)를 통해 진행해주세요.
            </p>
          </div>
        ) : !canEdit && (
          <div className="mb-4 rounded-lg border border-border bg-ink3/5 px-3 py-2 text-[10.5px] leading-relaxed text-ink2">
            {ownerName ? <strong className="font-bold">{ownerName}</strong> : '다른 사용자'}님이 공유한 일정입니다.
            <span className="text-ink3"> 내용은 볼 수 있고 고치는 것은 등록한 사람만 할 수 있습니다.</span>
          </div>
        )}
        <form id="calendar-event-form" onSubmit={submit} className="space-y-4">
          {/* 1. 일정 유형 선택 칩 (외근·출장, 휴가는 전자결재 전용이므로 신규 등록 목록에서 제외) */}
          <Field label="일정 유형" required>
            <div className="flex flex-wrap gap-1.5">
              {(isApprovalEvent || !CREATABLE_EVENT_TYPES.includes(eventType)
                ? [eventType]
                : CREATABLE_EVENT_TYPES
              ).map((typeKey) => {
                const meta = CALENDAR_EVENT_TYPE_LABELS[typeKey];
                const isSelected = eventType === typeKey;
                const isCompany = typeKey === 'COMPANY_EVENT';
                const isLocked = (isCompany && !canManageCompanyEvent) || isApprovalEvent;

                return (
                  <button
                    key={typeKey}
                    type="button"
                    disabled={isLocked}
                    onClick={() => {
                      setEventType(typeKey);
                      if (isCompany) {
                        setVisibility('COMPANY');
                      }
                    }}
                    className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11.5px] font-bold transition-all ${
                      isSelected
                        ? 'border-teal bg-teal text-white shadow-2xs'
                        : isLocked
                        ? 'border-border/60 bg-panel-alt/40 text-ink3/50 cursor-not-allowed opacity-60'
                        : 'border-border bg-panel text-ink hover:bg-panel-alt'
                    }`}
                    title={
                      isLocked
                        ? isApprovalEvent
                          ? '전자결재 승인 일정은 유형을 변경할 수 없습니다.'
                          : '사내행사는 운영자(OPERATOR) 또는 임원(EXEC)만 등록 가능합니다.'
                        : meta.label
                    }
                  >
                    <span>{meta.icon}</span>
                    <span>{meta.label}</span>
                    {isCompany && !canManageCompanyEvent && <ShieldAlert size={12} className="text-amber-500 ml-0.5" />}
                  </button>
                );
              })}
            </div>
            {eventType === 'COMPANY_EVENT' && (
              <p className="mt-1 flex items-center gap-1 text-[10.5px] font-semibold text-teal">
                <Sparkles size={12} />
                <span>사내행사는 전 직원 공통 캘린더에 공개 표시되며 전체 임직원에게 알림이 전송됩니다.</span>
              </p>
            )}
            {!canManageCompanyEvent && (
              <p className="mt-1 text-[10px] text-ink3">
                ※ 사내행사 등록은 운영자(OPERATOR) 및 임원(EXEC) 권한 계정만 가능합니다.
              </p>
            )}
          </Field>

          {/* 2. 제목 */}
          <Field label="일정 제목" required>
            <TextField
              aria-label="일정 제목"
              value={title}
              onChange={(input) => setTitle(input.target.value)}
              maxLength={100}
              autoFocus
              className="w-full"
              placeholder={eventType === 'MEETING' ? '예: UI/UX 설계 검토 회의' : eventType === 'COMPANY_EVENT' ? '예: 2026년 3분기 전사 타운홀 미팅' : '일정 제목'}
            />
          </Field>

          {/* 3. 날짜 및 종일 여부 */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="날짜" required>
              <TextField
                aria-label="일정 날짜"
                type="date"
                value={date}
                onChange={(input) => setDate(input.target.value)}
                className="w-full"
              />
            </Field>
            <Field label="시간 구분">
              <label className="flex h-9 items-center gap-2 rounded-md border border-border-hi px-3 text-[11px] font-semibold text-ink2 cursor-pointer hover:bg-panel-alt/50">
                <input
                  type="checkbox"
                  checked={allDay}
                  onChange={(input) => setAllDay(input.target.checked)}
                  className="accent-teal"
                />
                <span>종일 일정</span>
              </label>
            </Field>
          </div>

          {!allDay && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="시작 시각" required>
                <TextField
                  aria-label="시작 시각"
                  type="time"
                  step={300}
                  value={startTime}
                  onChange={(input) => {
                    setStartTime(input.target.value);
                    setEndTime(input.target.value);
                  }}
                  className="w-full"
                />
              </Field>
              <Field label="종료 시각" required>
                <TextField
                  aria-label="종료 시각"
                  type="time"
                  value={endTime}
                  onChange={(input) => setEndTime(input.target.value)}
                  min={startTime || undefined}
                  className="w-full"
                />
              </Field>
            </div>
          )}

          {/* 4. 함께하는 참여자 (회의·협업 공유용 다중 선택) */}
          {eventType !== 'COMPANY_EVENT' && (
            <Field label={`함께하는 참여자 (${attendeeUserIds.length}명)`}>
              <div className="space-y-2">
                {/* 선택된 참여자 칩들 */}
                {selectedAttendees.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 rounded-lg border border-border bg-panel-alt/40 p-2">
                    {selectedAttendees.map((u) => (
                      <span
                        key={u.id}
                        className="inline-flex items-center gap-1.5 rounded-md border border-teal/30 bg-teal-soft/20 px-2 py-1 text-[11px] font-semibold text-teal"
                      >
                        <Users size={11} />
                        <span>
                          {u.name} {u.position ? `(${u.position})` : ''} · {u.dept}
                        </span>
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => removeAttendee(u.id)}
                            className="rounded p-0.5 hover:bg-teal-soft/40 hover:text-rose-500 transition-colors"
                            title="참여자 제외"
                          >
                            <X size={12} />
                          </button>
                        )}
                      </span>
                    ))}
                  </div>
                )}

                {/* 참여자 검색 및 인풋 */}
                {canEdit && (
                  <div className="relative">
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <input
                          type="text"
                          value={attendeeSearch}
                          onChange={(e) => {
                            setAttendeeSearch(e.target.value);
                            setIsAttendeeSearchOpen(true);
                          }}
                          onFocus={() => setIsAttendeeSearchOpen(true)}
                          placeholder="이름 또는 부서 검색으로 회의 참여자 추가…"
                          className="h-9 w-full rounded-md border border-border-hi bg-panel px-3 text-[11.5px] text-ink outline-none focus:border-teal placeholder:text-ink3"
                        />
                        <UserPlus size={14} className="absolute right-3 top-2.5 text-ink3 pointer-events-none" />
                      </div>
                    </div>

                    {/* 드롭다운 검색 결과 */}
                    {isAttendeeSearchOpen && attendeeSearch.trim() && (
                      <div className="absolute left-0 top-10 z-50 max-h-48 w-full overflow-y-auto rounded-lg border border-border bg-panel shadow-lg">
                        {searchedUsers.length === 0 ? (
                          <div className="py-3 text-center text-[11px] text-ink3">일치하는 사원이 없습니다.</div>
                        ) : (
                          searchedUsers.map((u) => (
                            <div
                              key={u.id}
                              onClick={() => addAttendee(u.id)}
                              className="flex cursor-pointer items-center justify-between px-3 py-2 text-[11.5px] hover:bg-teal-soft/20 transition-colors"
                            >
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-ink">{u.name}</span>
                                <span className="text-[10.5px] text-ink3">{u.position}</span>
                                <span className="rounded bg-panel-alt px-1.5 py-0.2 text-[9.5px] text-ink3">{u.dept}</span>
                              </div>
                              <span className="text-[10px] font-bold text-teal">+ 추가</span>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )}

                <p className="text-[10px] leading-snug text-ink3">
                  💡 지정된 참여자 전원의 캘린더에 해당 일정이 자동으로 등록되고 공유 알림이 전송됩니다.
                </p>
              </div>
            </Field>
          )}

          {/* 5. 공개 범위 (사내행사가 아닌 경우) */}
          {eventType !== 'COMPANY_EVENT' && (
            <Field label="기본 공개 범위" required>
              <div className="space-y-1.5">
                <select
                  aria-label="공개 범위"
                  value={visibility}
                  onChange={(input) => setVisibility(input.target.value as CalendarVisibility)}
                  className="h-9 w-full rounded-md border border-border-hi bg-panel px-3 text-[12px] text-ink outline-none focus:border-teal"
                >
                  {CALENDAR_VISIBILITIES.map((option) => {
                    const blocked = disabledReason(option);
                    return (
                      <option key={option} value={option} disabled={Boolean(blocked)}>
                        {CALENDAR_VISIBILITY_LABELS[option]}
                        {blocked ? ` — ${blocked}` : ''}
                      </option>
                    );
                  })}
                </select>
                <p className="text-[10px] leading-snug text-ink3">
                  {VISIBILITY_HINTS[visibility]}
                  {visibility === 'TEAM' && deptName && <span className="ml-1 font-semibold text-ink2">({deptName})</span>}
                </p>
              </div>
            </Field>
          )}

          {visibility === 'PROJECT' && eventType !== 'COMPANY_EVENT' && (
            <Field label="공유할 프로젝트" required>
              <select
                aria-label="공유할 프로젝트"
                value={projectId}
                onChange={(input) => setProjectId(input.target.value)}
                className="h-9 w-full rounded-md border border-border-hi bg-panel px-3 text-[12px] text-ink outline-none focus:border-teal"
              >
                {myProjects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {/* 6. 메모 (휴가 일정은 개인 프라이버시 보호를 위해 사유 비공개) */}
          {eventType !== 'VACATION' ? (
            <Field label="메모 및 안건">
              <textarea
                aria-label="일정 메모"
                value={memo}
                onChange={(input) => setMemo(input.target.value)}
                maxLength={2000}
                rows={4}
                className="w-full resize-y rounded-md border border-border-hi bg-panel px-3 py-2 text-[12px] text-ink outline-none placeholder:text-ink3 focus:border-teal font-sans"
                placeholder="회의 안건, 장소, 준비 사항 등을 자유롭게 기록하세요."
              />
            </Field>
          ) : (
            <div className="rounded-lg border border-border/80 bg-panel-alt/40 px-3 py-2 text-[10.5px] leading-relaxed text-ink3">
              🔒 <strong>프라이버시 보호</strong>: 근로기준법 및 사내 규정에 따라 휴가(연차)의 구체적인 사유는 공개되지 않으며 부재 여부만 표시됩니다.
            </div>
          )}

          {error && (
            <div role="alert" className="rounded-lg border border-danger/20 bg-danger/5 px-3 py-2 text-[10.5px] font-semibold text-danger">
              {error}
            </div>
          )}
        </form>
      </fieldset>
    </Modal>
  );
}
