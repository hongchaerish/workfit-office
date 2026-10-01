import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  calendarEventRepo,
  type CalendarEventActor,
  type CalendarEventFilter,
} from '@/data/calendarEvent/calendarEvent.repo';
import type { CalendarEventDraft } from '@/domain/calendarEvent/schema';

export const CALENDAR_EVENTS_KEY = 'calendarEvents';

function actorKey(actor: CalendarEventActor) {
  return [actor.userId, actor.active] as const;
}

export function useCalendarEvents(actor: CalendarEventActor, filter?: CalendarEventFilter, enabled = true) {
  return useQuery({
    queryKey: [CALENDAR_EVENTS_KEY, 'list', ...actorKey(actor), filter ?? null],
    queryFn: () => calendarEventRepo.list(actor, filter),
    // 팀 탭이 떠 있는 동안에는 끈다 — 전건 로드가 탭당 한 번이면 충분하다.
    enabled,
  });
}

/**
 * 관리자 종합 조회(팀 일정). `owners`가 null이면 전 직원, 배열이면 그 소유자들만.
 * `enabled`로 게이트한다 — 범위 판정(resolveCalendarSupervisor)을 통과 못 한 사용자는
 * 조회 자체를 던지지 않는다.
 */
export function useTeamCalendarEvents(
  viewer: { userId: string; active: boolean },
  owners: string[] | null,
  filter: CalendarEventFilter | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: [CALENDAR_EVENTS_KEY, 'team', viewer.userId, viewer.active, owners, filter ?? null],
    queryFn: () => calendarEventRepo.listTeam(viewer, owners, filter),
    enabled,
  });
}

export function useCalendarEvent(actor: CalendarEventActor, id?: string) {
  return useQuery({
    queryKey: [CALENDAR_EVENTS_KEY, 'detail', ...actorKey(actor), id ?? null],
    queryFn: () => calendarEventRepo.get(actor, id ?? ''),
    enabled: Boolean(id),
  });
}

function useCalendarEventMutation<T>(mutationFn: (input: T) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [CALENDAR_EVENTS_KEY] }),
  });
}

export function useCreateCalendarEvent() {
  return useCalendarEventMutation(({
    actor,
    draft,
  }: {
    actor: CalendarEventActor;
    draft: CalendarEventDraft;
  }) => calendarEventRepo.create(actor, draft));
}

export function useUpdateCalendarEvent() {
  return useCalendarEventMutation(({
    actor,
    id,
    draft,
  }: {
    actor: CalendarEventActor;
    id: string;
    draft: CalendarEventDraft;
  }) => calendarEventRepo.update(actor, id, draft));
}

export function useRemoveCalendarEvent() {
  return useCalendarEventMutation(({
    actor,
    id,
  }: {
    actor: CalendarEventActor;
    id: string;
  }) => calendarEventRepo.remove(actor, id));
}

/** 회의에 참석자로 합류(본인만). */
export function useJoinMeeting() {
  return useCalendarEventMutation(({ actor, id }: { actor: CalendarEventActor; id: string }) => calendarEventRepo.joinAsAttendee(actor, id));
}

/** 회의 참석 취소(본인만). */
export function useLeaveMeeting() {
  return useCalendarEventMutation(({ actor, id }: { actor: CalendarEventActor; id: string }) => calendarEventRepo.leaveAsAttendee(actor, id));
}
