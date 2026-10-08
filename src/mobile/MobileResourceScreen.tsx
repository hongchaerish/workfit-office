import { useState, useMemo } from 'react';
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
import { useReservations, useCreateReservation } from '@/features/resource/useReservations';
import { useDepartments } from '@/features/department/useDepartments';
import { resolveDeptId } from '@/domain/department/engine';
import type { Resource } from '@/domain/resource/schema';
import {
  combineLocalDateTime,
  dateRangeIso,
  defaultReservationWindow,
  formatResourceTime,
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

  // 자원을 고르면 그 자원의 운영시간·슬롯 단위에 맞는 기본 시간대로 맞춘다.
  const selectFormResource = (resource: Resource | undefined) => {
    setFormResourceId(resource?.id ?? '');
    setFormError('');
    if (!resource) return;
    const window = defaultReservationWindow(resource, selectedDateStr);
    if (window.date === selectedDateStr) {
      setFormStart(window.start);
      setFormEnd(window.end);
    } else {
      // 선택한 날의 운영시간이 이미 끝났으면 운영 시작 시각을 기본값으로 둔다.
      setFormStart(resource.availableFrom);
      setFormEnd(defaultReservationWindow(resource, window.date).end);
    }
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
                          className="flex items-center justify-between rounded-xl bg-panel-alt/60 px-2.5 py-1.5 text-[11.5px]"
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            <Clock size={12} className="text-teal shrink-0" />
                            <span className="font-bold text-ink font-mono">{startTime} ~ {endTime}</span>
                            <span className="truncate text-ink2 font-medium">({r.title})</span>
                          </div>
                          <span className="text-[10.5px] text-ink3 shrink-0">{r.requesterUserId}</span>
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
                    step={(formResource?.slotMinutes ?? 30) * 60}
                    value={formStart}
                    onChange={(e) => setFormStart(e.target.value)}
                    className="h-9 w-full rounded-xl border border-border bg-panel px-2.5 text-[12px] text-ink outline-none focus:border-teal"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-ink3 block mb-1">종료 시각</label>
                  <input
                    type="time"
                    step={(formResource?.slotMinutes ?? 30) * 60}
                    value={formEnd}
                    onChange={(e) => setFormEnd(e.target.value)}
                    className="h-9 w-full rounded-xl border border-border bg-panel px-2.5 text-[12px] text-ink outline-none focus:border-teal"
                  />
                </div>
              </div>

              {formResource && (
                <p className="text-[10.5px] text-ink3">
                  {formResource.approvalMode === 'INSTANT' ? '즉시 확정' : '담당자 승인 필요'} · {formResource.slotMinutes}분 단위 · 운영 {formResource.availableFrom}~{formResource.availableTo}
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
