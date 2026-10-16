import { useState, useMemo, useRef } from 'react';
import {
  Building2,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  Plus,
  X,
  CheckCircle2,
  AlertCircle,
  Car,
  Laptop,
} from 'lucide-react';
import { useAuth } from '@/app/auth/AuthProvider';
import { useResources } from '@/features/resource/useResources';
import { useReservations, useCreateReservation, useCancelReservation, useRescheduleReservation } from '@/features/resource/useReservations';
import { useDepartments } from '@/features/department/useDepartments';
import { resolveDeptId } from '@/domain/department/engine';
import type { Resource } from '@/domain/resource/schema';
import type { Reservation } from '@/domain/reservation/schema';
import { canCancelReservation, planReschedule, type RescheduleInput } from '@/domain/reservation/engine';
import {
  combineLocalDateTime,
  dateRangeIso,
  defaultReservationWindow,
  formatResourceDateTime,
  formatResourceTime,
  toDateInput,
} from '@/modules/gw/resource/resourceDate';
import MobileCommonHeader from './MobileCommonHeader';

const pad = (n: number) => String(n).padStart(2, '0');
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function MobileResourceScreen() {
  const { user } = useAuth();
  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date());
  const selectedDateStr = useMemo(() => formatDate(selectedDate), [selectedDate]);

  // 모달 상태
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formResourceId, setFormResourceId] = useState('');
  const [formTitle, setFormTitle] = useState('');
  const [formStart, setFormStart] = useState('09:00');
  const [formEnd, setFormEnd] = useState('11:00');
  const [formPurpose, setFormPurpose] = useState('');
  const [formAttendees, setFormAttendees] = useState(1);
  const [formError, setFormError] = useState('');
  const [cancelTarget, setCancelTarget] = useState<Reservation | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelError, setCancelError] = useState('');
  const [notice, setNotice] = useState('');
  const cancelSubmitting = useRef(false);
  const [rescheduleTarget, setRescheduleTarget] = useState<Reservation | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleStart, setRescheduleStart] = useState('');
  const [rescheduleEnd, setRescheduleEnd] = useState('');
  const [rescheduleError, setRescheduleError] = useState('');
  const rescheduleSubmitting = useRef(false);

  const resourcesQuery = useResources();
  const resources = resourcesQuery.data ?? [];
  // 점검·미사용 자원은 신청 단계에서 거부되므로 선택지에 올리지 않는다.
  const bookableResources = useMemo(() => resources.filter((r) => r.status === 'ACTIVE'), [resources]);
  const formResource = bookableResources.find((r) => r.id === formResourceId) ?? null;
  const departments = useDepartments().data ?? [];

  // 예약 시각은 ISO(UTC)로 저장되므로 날짜 문자열이 아니라 그날 0시~익일 0시(KST) 구간으로 거른다.
  const dayRange = useMemo(() => dateRangeIso(selectedDateStr), [selectedDateStr]);
  const reservationsQuery = useReservations(dayRange);
  const reservations = reservationsQuery.data ?? [];

  const createReservation = useCreateReservation();
  const cancelReservation = useCancelReservation();
  const rescheduleReservation = useRescheduleReservation();
  const reservationBusy = cancelReservation.isPending || rescheduleReservation.isPending;
  const rescheduleResource = resources.find((resource) => resource.id === rescheduleTarget?.resourceId);
  const rescheduleNext = useMemo<RescheduleInput | null>(() => {
    if (!rescheduleDate || !rescheduleStart || !rescheduleEnd) return null;
    try {
      return {
        startAt: combineLocalDateTime(rescheduleDate, rescheduleStart),
        endAt: combineLocalDateTime(rescheduleDate, rescheduleEnd),
      };
    } catch {
      return null;
    }
  }, [rescheduleDate, rescheduleStart, rescheduleEnd]);
  const rescheduleUnchanged = !rescheduleNext || (
    rescheduleNext.startAt === rescheduleTarget?.startAt && rescheduleNext.endAt === rescheduleTarget?.endAt
  );
  const reschedulePlan = rescheduleResource && rescheduleTarget && rescheduleNext && !rescheduleUnchanged && rescheduleStart < rescheduleEnd
    ? planReschedule(rescheduleResource, rescheduleTarget, rescheduleNext)
    : null;

  const openReschedule = (reservation: Reservation) => {
    if (cancelSubmitting.current || rescheduleSubmitting.current || !user || !canCancelReservation(user, reservation)) return;
    setRescheduleTarget(reservation);
    setRescheduleDate(toDateInput(new Date(reservation.startAt)));
    setRescheduleStart(formatResourceTime(reservation.startAt));
    setRescheduleEnd(formatResourceTime(reservation.endAt));
    setRescheduleError('');
    setNotice('');
  };

  const closeReschedule = () => {
    if (!rescheduleSubmitting.current) setRescheduleTarget(null);
  };

  const handleReschedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (rescheduleSubmitting.current) return;
    if (!user || !rescheduleTarget || !canCancelReservation(user, rescheduleTarget)) {
      setRescheduleError('본인 예약만 변경할 수 있습니다.');
      return;
    }
    if (!rescheduleNext) {
      setRescheduleError('변경할 날짜와 시각을 입력하세요.');
      return;
    }
    if (rescheduleStart >= rescheduleEnd) {
      setRescheduleError('종료 시각은 시작 시각보다 뒤여야 합니다.');
      return;
    }
    if (rescheduleUnchanged) return;
    rescheduleSubmitting.current = true;
    setRescheduleError('');
    try {
      // 웹과 같은 경로가 최신 예약의 마감·충돌·재승인을 검사한다. 시간 이외의 필드는 전달하지 않는다.
      const updated = await rescheduleReservation.mutateAsync({ actor: user, id: rescheduleTarget.id, next: rescheduleNext });
      setRescheduleTarget(null);
      setSelectedDate(new Date(`${toDateInput(new Date(updated.startAt))}T00:00:00`));
      setNotice(updated.status === 'PENDING' ? '예약 시간을 변경했습니다. 담당자 재승인을 기다립니다.' : '예약 시간을 변경했습니다.');
    } catch (caught) {
      setRescheduleError(caught instanceof Error ? caught.message : '예약 변경에 실패했습니다. 다시 시도해 주세요.');
    } finally {
      rescheduleSubmitting.current = false;
    }
  };

  const openCancellation = (reservation: Reservation) => {
    if (cancelSubmitting.current || rescheduleSubmitting.current || !user || !canCancelReservation(user, reservation)) return;
    setCancelTarget(reservation);
    setCancelReason('');
    setCancelError('');
    setNotice('');
  };

  const closeCancellation = () => {
    if (!cancelSubmitting.current) setCancelTarget(null);
  };

  const handleCancelReservation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cancelSubmitting.current) return;
    if (!user || !cancelTarget || !canCancelReservation(user, cancelTarget)) {
      setCancelError('본인 예약만 취소할 수 있습니다.');
      return;
    }
    const reason = cancelReason.trim();
    if (!reason) {
      setCancelError('취소 사유를 입력하세요.');
      return;
    }
    cancelSubmitting.current = true;
    setCancelError('');
    try {
      // Web과 같은 저장소에서 최신 예약 상태·취소 마감을 검사한다. 관리자 예외는 적용하지 않는다.
      await cancelReservation.mutateAsync({ actor: user, id: cancelTarget.id, reason });
      setCancelTarget(null);
      setNotice('예약을 취소했습니다.');
    } catch (caught) {
      setCancelError(caught instanceof Error ? caught.message : '예약 취소에 실패했습니다. 다시 시도해 주세요.');
    } finally {
      cancelSubmitting.current = false;
    }
  };

  // 날짜 이동
  const handlePrevDay = () => {
    setSelectedDate((prev) => {
      const d = new Date(prev);
      d.setDate(d.getDate() - 1);
      return d;
    });
  };
  const handleNextDay = () => {
    setSelectedDate((prev) => {
      const d = new Date(prev);
      d.setDate(d.getDate() + 1);
      return d;
    });
  };
  const handleToday = () => setSelectedDate(new Date());

  const dateTitle = useMemo(() => {
    const y = selectedDate.getFullYear();
    const m = selectedDate.getMonth() + 1;
    const d = selectedDate.getDate();
    const day = WEEKDAYS[selectedDate.getDay()];
    return `${y}년 ${m}월 ${d}일 (${day})`;
  }, [selectedDate]);

  const getResourceIcon = (typeCode: string) => {
    if (typeCode === 'VEHICLE') return <Car size={16} className="text-amber-500" />;
    if (typeCode === 'EQUIPMENT' || typeCode === 'SUPPLY') return <Laptop size={16} className="text-blue-500" />;
    return <Building2 size={16} className="text-teal" />;
  };

  const getTypeName = (typeCode: string) => {
    switch (typeCode) {
      case 'ROOM': return '회의실';
      case 'VEHICLE': return '차량';
      case 'EQUIPMENT': return '장비';
      case 'SUPPLY': return '비품';
      default: return typeCode;
    }
  };

  // 자원을 고르면 기본 시간대(다음 30분 단위부터 1시간)로 맞춘다.
  const selectFormResource = (resource: Resource | undefined) => {
    setFormResourceId(resource?.id ?? '');
    setFormError('');
    if (!resource) return;
    // 선택한 날이 곧 끝나 기본 시간대가 다음 날로 넘어가도 시각만 가져온다(날짜는 선택한 날 그대로).
    const window = defaultReservationWindow(selectedDateStr);
    setFormStart(window.start);
    setFormEnd(window.end);
  };

  const openForm = (resource: Resource | undefined) => {
    selectFormResource(resource);
    setFormAttendees(1);
    setIsModalOpen(true);
  };

  // 예약 신청 핸들러
  const handleCreateReservation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formResource) {
      setFormError('자원을 선택해주세요.');
      return;
    }
    if (!formTitle.trim()) {
      setFormError('예약 제목을 입력해주세요.');
      return;
    }
    if (formStart >= formEnd) {
      setFormError('종료 시각은 시작 시각보다 뒤여야 합니다.');
      return;
    }
    if (!user) {
      setFormError('로그인이 필요합니다.');
      return;
    }

    setFormError('');
    try {
      await createReservation.mutateAsync({
        actor: user,
        request: {
          resourceId: formResource.id,
          requesterDeptId: resolveDeptId(departments, user.dept),
          title: formTitle.trim(),
          purpose: formPurpose.trim() || '회의 및 업무 목적',
          // 입력 시각은 KST 벽시계 — 'Z'를 붙이면 9시간 밀려 운영시간 밖으로 거부된다.
          startAt: combineLocalDateTime(selectedDateStr, formStart),
          endAt: combineLocalDateTime(selectedDateStr, formEnd),
          quantity: 1,
          attendeeCount: formResource.typeCode === 'ROOM' ? formAttendees : null,
          attendeeUserIds: [user.id],
        },
      });

      setIsModalOpen(false);
      setFormTitle('');
      setFormPurpose('');
      reservationsQuery.refetch();
    } catch (caught) {
      // 충돌·운영시간·과거 시각 등 도메인 사유를 그대로 보여줘야 사용자가 고칠 수 있다.
      setFormError(caught instanceof Error ? caught.message : '예약 생성에 실패했습니다.');
    }
  };

  return (
    <div className="flex h-full flex-col select-none overflow-hidden" style={{ background: '#f2f8fc' }}>
      <MobileCommonHeader
        title="자원예약"
        subtitle={dateTitle}
        rightAction={
          <button
            type="button"
            onClick={() => openForm(bookableResources[0])}
            className="grid h-8 w-8 place-items-center rounded-xl bg-teal text-white shadow-2xs hover:opacity-90 active:scale-95 transition-all cursor-pointer"
            title="예약 신청"
          >
            <Plus size={18} strokeWidth={2.2} />
          </button>
        }
      />

      {/* 1. 날짜 이동 바 */}
      <div className="flex items-center justify-between border-b border-border/70 bg-white px-3 py-2 shadow-2xs shrink-0">
        <button
          type="button"
          onClick={handlePrevDay}
          className="grid h-8 w-8 place-items-center rounded-xl hover:bg-panel-alt transition-colors text-ink2"
          title="이전 날"
        >
          <ChevronLeft size={18} />
        </button>

        <button
          type="button"
          onClick={handleToday}
          className="text-[13.5px] font-bold text-ink hover:text-teal transition-colors flex items-center gap-1.5"
        >
          <Calendar size={14} className="text-teal" />
          <span>{dateTitle}</span>
        </button>

        <button
          type="button"
          onClick={handleNextDay}
          className="grid h-8 w-8 place-items-center rounded-xl hover:bg-panel-alt transition-colors text-ink2"
          title="다음 날"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      {/* 2. 자원 및 타임라인 목록 */}
      <div className="flex-1 overflow-y-auto px-3.5 py-3 space-y-3">
        {notice && <p role="status" className="rounded-xl border border-teal/20 bg-teal-soft/20 p-3 text-[12px] font-semibold text-teal">{notice}</p>}
        {resources.length === 0 ? (
          <div className="py-16 text-center text-[12px] text-ink3">등록된 자원이 없습니다.</div>
        ) : (
          resources.map((res) => {
            const resReservations = reservations.filter(
              (r) => r.resourceId === res.id && (r.status === 'PENDING' || r.status === 'CONFIRMED' || r.status === 'COMPLETED')
            );

            return (
              <div
                key={res.id}
                className="rounded-2xl border border-border/80 bg-white p-3.5 shadow-2xs space-y-2.5"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="grid h-8 w-8 place-items-center rounded-xl bg-panel-alt">
                      {getResourceIcon(res.typeCode)}
                    </div>
                    <div>
                      <h3 className="text-[13.5px] font-bold text-ink">{res.name}</h3>
                      <p className="text-[10.5px] text-ink3">
                        {getTypeName(res.typeCode)} {res.location ? `· ${res.location}` : ''} {res.capacity ? `· 수용 ${res.capacity}명` : ''}
                      </p>
                    </div>
                  </div>

                  {res.status === 'ACTIVE' ? (
                    <button
                      type="button"
                      onClick={() => openForm(res)}
                      className="rounded-xl bg-teal-soft/20 px-2.5 py-1 text-[11px] font-bold text-teal hover:bg-teal-soft/40 transition-colors"
                    >
                      예약하기
                    </button>
                  ) : (
                    <span className="rounded-xl bg-panel-alt px-2.5 py-1 text-[11px] font-bold text-ink3">예약 불가</span>
                  )}
                </div>

                {/* 해당 자원의 오늘 예약 내역 */}
                <div className="space-y-1.5 pt-2 border-t border-border/50">
                  {resReservations.length === 0 ? (
                    <div className="text-[11px] text-emerald-600 font-semibold flex items-center gap-1 py-1">
                      <CheckCircle2 size={13} />
                      <span>오늘 예약 없음 (전 시간대 예약 가능)</span>
                    </div>
                  ) : (
                    resReservations.map((r) => {
                      const startTime = formatResourceTime(r.startAt);
                      const endTime = formatResourceTime(r.endAt);

                      return (
                        <div
                          key={r.id}
                          className="rounded-xl bg-panel-alt/60 px-2.5 py-1.5 text-[11.5px]"
                        >
                          <p className="mb-1 break-words font-medium text-ink2">{r.title}</p>
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-1.5">
                              <Clock size={12} className="text-teal shrink-0" />
                              <span className="shrink-0 whitespace-nowrap font-bold text-ink font-mono">{startTime} ~ {endTime}</span>
                            </div>
                            <span className="shrink-0 text-[10.5px] text-ink3">{r.requesterUserId}</span>
                          </div>
                          {user && canCancelReservation(user, r) && (r.status === 'PENDING' || r.status === 'CONFIRMED') && (
                            <div className="mt-1 flex flex-wrap justify-end gap-2">
                              <button
                                type="button"
                                aria-label={`${r.title} 예약 시간 변경`}
                                disabled={reservationBusy}
                                onClick={() => openReschedule(r)}
                                className="rounded-lg border border-teal/20 px-2 py-1.5 text-[10.5px] font-bold text-teal disabled:opacity-50"
                              >
                                시간 변경
                              </button>
                              <button
                                type="button"
                                aria-label={`${r.title} 예약 취소`}
                                disabled={reservationBusy}
                                onClick={() => openCancellation(r)}
                                className="rounded-lg border border-rose-500/20 px-2 py-1.5 text-[10.5px] font-bold text-rose-600 disabled:opacity-50"
                              >
                                예약 취소
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 본인 예약 시간 변경 — 웹의 변경·재승인 규칙을 그대로 사용한다. */}
      {rescheduleTarget && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-2 sm:p-4">
          <section role="dialog" aria-modal="true" aria-labelledby="mobile-reservation-reschedule-title" className="w-full max-w-[440px] max-h-[90dvh] overflow-y-auto rounded-2xl bg-white shadow-xl">
            <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-[#101830] px-4 py-3 text-white">
              <h2 id="mobile-reservation-reschedule-title" className="text-[13.5px] font-bold">예약 시간 변경</h2>
              <button type="button" aria-label="예약 시간 변경 창 닫기" disabled={rescheduleReservation.isPending} onClick={closeReschedule} className="p-1 disabled:opacity-50"><X size={18} /></button>
            </header>
            <form onSubmit={handleReschedule} className="space-y-3 p-4">
              <div className="rounded-xl bg-panel-alt p-3 text-[12px] text-ink2">
                <p className="break-words font-bold">{rescheduleTarget.title} · {rescheduleTarget.resourceNameSnapshot}</p>
                <p className="mt-1">현재 {formatResourceDateTime(rescheduleTarget.startAt)} ~ {formatResourceDateTime(rescheduleTarget.endAt)}</p>
              </div>
              {rescheduleError && <p role="alert" className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-[12px] text-rose-600">{rescheduleError}</p>}
              <label className="block text-[12px] font-bold text-ink2">
                변경 날짜
                <input type="date" required value={rescheduleDate} disabled={rescheduleReservation.isPending} onChange={(e) => setRescheduleDate(e.target.value)} className="mt-1 h-10 w-full min-w-0 max-w-full rounded-xl border border-border bg-panel px-3 text-[13px] font-normal text-ink outline-none focus:border-teal" />
              </label>
              <div className="grid grid-cols-1 gap-2">
                <label className="min-w-0 text-[12px] font-bold text-ink2">
                  변경 시작 시각
                  <input type="time" step={60} required value={rescheduleStart} disabled={rescheduleReservation.isPending} onChange={(e) => setRescheduleStart(e.target.value)} className="mt-1 h-10 w-full min-w-0 rounded-xl border border-border bg-panel px-3 text-[13px] font-normal text-ink outline-none focus:border-teal" />
                </label>
                <label className="min-w-0 text-[12px] font-bold text-ink2">
                  변경 종료 시각
                  <input type="time" step={60} required value={rescheduleEnd} disabled={rescheduleReservation.isPending} onChange={(e) => setRescheduleEnd(e.target.value)} className="mt-1 h-10 w-full min-w-0 rounded-xl border border-border bg-panel px-3 text-[13px] font-normal text-ink outline-none focus:border-teal" />
                </label>
              </div>
              {reschedulePlan && rescheduleResource?.approvalMode === 'APPROVAL' && (
                <p className={`rounded-xl p-3 text-[12px] ${reschedulePlan.keepsApproval ? 'bg-teal-soft/20 text-teal' : 'bg-amber-500/10 text-amber-700'}`}>
                  {reschedulePlan.keepsApproval ? '기존 시간 범위 안의 변경이라 승인이 유지됩니다.' : '승인형 자원이라 변경 후 담당자 재승인이 필요합니다. 승인 전까지 승인 대기 상태가 됩니다.'}
                </p>
              )}
              <div className="flex gap-2 pt-2">
                <button type="button" disabled={rescheduleReservation.isPending} onClick={closeReschedule} className="flex-1 rounded-xl bg-panel-alt py-2.5 text-[12px] font-bold text-ink2 disabled:opacity-50">닫기</button>
                <button type="submit" disabled={rescheduleReservation.isPending || rescheduleUnchanged} className="flex-1 rounded-xl bg-teal py-2.5 text-[12px] font-bold text-white disabled:opacity-50">{rescheduleReservation.isPending ? '변경 중…' : reschedulePlan?.status === 'PENDING' ? '변경 후 재승인 요청' : '변경'}</button>
              </div>
            </form>
          </section>
        </div>
      )}

      {/* 본인 예약 취소 — 조회·신청과 별도 상태로 관리한다. */}
      {cancelTarget && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-2 sm:p-4">
          <section role="dialog" aria-modal="true" aria-labelledby="mobile-reservation-cancel-title" className="w-full max-w-[440px] max-h-[90dvh] overflow-y-auto rounded-2xl bg-white shadow-xl">
            <header className="flex items-center justify-between border-b border-border bg-[#101830] px-4 py-3 text-white">
              <h2 id="mobile-reservation-cancel-title" className="text-[13.5px] font-bold">예약 취소</h2>
              <button type="button" aria-label="예약 취소 창 닫기" disabled={cancelReservation.isPending} onClick={closeCancellation} className="p-1 disabled:opacity-50">
                <X size={18} />
              </button>
            </header>
            <form onSubmit={handleCancelReservation} className="space-y-3 p-4">
              <div className="rounded-xl bg-panel-alt p-3 text-[12px] text-ink2">
                <p className="break-words font-bold">{cancelTarget.title} · {cancelTarget.resourceNameSnapshot}</p>
                <p className="mt-1">{formatResourceDateTime(cancelTarget.startAt)} ~ {formatResourceDateTime(cancelTarget.endAt)}</p>
              </div>
              {cancelError && <p role="alert" className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-[12px] text-rose-600">{cancelError}</p>}
              <label className="block text-[12px] font-bold text-ink2" htmlFor="mobile-reservation-cancel-reason">
                취소 사유
              </label>
              <textarea
                id="mobile-reservation-cancel-reason"
                autoFocus
                rows={3}
                value={cancelReason}
                disabled={cancelReservation.isPending}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="예약을 취소하는 사유를 입력하세요."
                className="w-full rounded-xl border border-border bg-panel p-3 text-[13px] text-ink outline-none focus:border-teal disabled:opacity-50"
              />
              <div className="flex gap-2 pt-2">
                <button type="button" disabled={cancelReservation.isPending} onClick={closeCancellation} className="flex-1 rounded-xl bg-panel-alt py-2.5 text-[12px] font-bold text-ink2 disabled:opacity-50">닫기</button>
                <button type="submit" disabled={cancelReservation.isPending || !cancelReason.trim()} className="flex-1 rounded-xl bg-rose-600 py-2.5 text-[12px] font-bold text-white disabled:opacity-50">{cancelReservation.isPending ? '취소 중…' : '예약 취소'}</button>
              </div>
            </form>
          </section>
        </div>
      )}

      {/* 3. 예약 신청 모달 */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 animate-in fade-in duration-150 p-2 sm:p-4">
          <div className="w-full max-w-[440px] rounded-2xl bg-white shadow-xl overflow-hidden animate-in slide-in-from-bottom duration-200">
            <header className="flex items-center justify-between border-b border-border px-4 py-3 bg-[#101830] text-white">
              <span className="text-[13.5px] font-bold">자원 예약 신청</span>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-white hover:opacity-75"
              >
                <X size={18} />
              </button>
            </header>

            <form onSubmit={handleCreateReservation} className="p-4 space-y-3">
              {formError && (
                <div className="rounded-xl bg-rose-500/10 border border-rose-500/20 p-2.5 text-[11.5px] font-bold text-rose-600 flex items-center gap-1.5">
                  <AlertCircle size={14} />
                  <span>{formError}</span>
                </div>
              )}

              <div>
                <label className="text-[11px] font-bold text-ink3 block mb-1">대상 자원</label>
                <select
                  value={formResourceId}
                  onChange={(e) => selectFormResource(bookableResources.find((r) => r.id === e.target.value))}
                  className="h-9 w-full rounded-xl border border-border bg-panel px-3 text-[12.5px] text-ink outline-none focus:border-teal"
                >
                  {bookableResources.map((r) => (
                    <option key={r.id} value={r.id}>
                      [{getTypeName(r.typeCode)}] {r.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[11px] font-bold text-ink3 block mb-1">예약 제목</label>
                <input
                  type="text"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="예: 주간 기획 회의"
                  className="h-9 w-full rounded-xl border border-border bg-panel px-3 text-[12.5px] text-ink outline-none focus:border-teal"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-bold text-ink3 block mb-1">시작 시각</label>
                  <input
                    type="time"
                    step={60}
                    value={formStart}
                    onChange={(e) => setFormStart(e.target.value)}
                    className="h-9 w-full rounded-xl border border-border bg-panel px-2.5 text-[12px] text-ink outline-none focus:border-teal"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-ink3 block mb-1">종료 시각</label>
                  <input
                    type="time"
                    step={60}
                    value={formEnd}
                    onChange={(e) => setFormEnd(e.target.value)}
                    className="h-9 w-full rounded-xl border border-border bg-panel px-2.5 text-[12px] text-ink outline-none focus:border-teal"
                  />
                </div>
              </div>

              {formResource && (
                <p className="text-[10.5px] text-ink3">
                  {formResource.approvalMode === 'INSTANT' ? '즉시 확정' : '담당자 승인 필요'} · 다른 예약과 겹치지 않으면 원하는 시간에 예약할 수 있습니다
                </p>
              )}

              {formResource?.typeCode === 'ROOM' && (
                <div>
                  <label className="text-[11px] font-bold text-ink3 block mb-1">참석 인원 (최대 {formResource.capacity}명)</label>
                  <input
                    type="number"
                    min={1}
                    max={formResource.capacity ?? undefined}
                    value={formAttendees}
                    onChange={(e) => setFormAttendees(Number(e.target.value) || 1)}
                    className="h-9 w-full rounded-xl border border-border bg-panel px-3 text-[12.5px] text-ink outline-none focus:border-teal"
                  />
                </div>
              )}

              <div>
                <label className="text-[11px] font-bold text-ink3 block mb-1">사용 목적 (선택)</label>
                <input
                  type="text"
                  value={formPurpose}
                  onChange={(e) => setFormPurpose(e.target.value)}
                  placeholder="상세 사용 목적 및 내용"
                  className="h-9 w-full rounded-xl border border-border bg-panel px-3 text-[12.5px] text-ink outline-none focus:border-teal"
                />
              </div>

              <div className="pt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 rounded-xl bg-panel-alt py-2 text-[12px] font-bold text-ink2"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={createReservation.isPending}
                  className="flex-1 rounded-xl bg-teal py-2 text-[12px] font-bold text-white shadow-xs hover:opacity-90 disabled:opacity-50"
                >
                  {createReservation.isPending ? '신청 중…' : formResource?.approvalMode === 'APPROVAL' ? '승인 요청' : '예약 확정'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
