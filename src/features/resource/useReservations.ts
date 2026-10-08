import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { reservationRepo, type ReservationFilter } from '@/data/reservation/reservation.repo';
import type { ReservationRequest } from '@/domain/reservation/schema';
import type { User } from '@/domain/user/schema';
import type { RescheduleInput } from '@/domain/reservation/engine';

const RESERVATION_KEY = 'resource-reservations';

export function useReservations(filter?: ReservationFilter) {
  return useQuery({ queryKey: [RESERVATION_KEY, filter ?? null], queryFn: () => reservationRepo.list(filter) });
}

function useReservationMutation<T, R>(mutationFn: (input: T) => Promise<R>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [RESERVATION_KEY] }),
  });
}

export function useCreateReservation() {
  return useReservationMutation(({ actor, request }: { actor: User; request: ReservationRequest }) => reservationRepo.create(actor, request));
}

export function useApproveReservation() {
  return useReservationMutation(({ actor, id, isAdmin }: { actor: User; id: string; isAdmin?: boolean }) => reservationRepo.approve(actor, id, isAdmin));
}

export function useRejectReservation() {
  return useReservationMutation(({ actor, id, reason, isAdmin }: { actor: User; id: string; reason: string; isAdmin?: boolean }) => reservationRepo.reject(actor, id, reason, isAdmin));
}

export function useCancelReservation() {
  return useReservationMutation(({ actor, id, reason, isAdmin }: { actor: User; id: string; reason: string; isAdmin?: boolean }) => reservationRepo.cancel(actor, id, reason, isAdmin));
}

export function useRescheduleReservation() {
  return useReservationMutation(({ actor, id, next, isAdmin }: { actor: User; id: string; next: RescheduleInput; isAdmin?: boolean }) => reservationRepo.reschedule(actor, id, next, isAdmin));
}

export function useCancelUpcomingByResource() {
  return useReservationMutation(({ actor, resourceId, reason, canManage }: { actor: User; resourceId: string; reason: string; canManage: boolean }) => reservationRepo.cancelUpcomingByResource(actor, resourceId, reason, canManage));
}
