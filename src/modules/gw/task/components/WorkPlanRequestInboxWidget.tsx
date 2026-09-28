import { useState } from 'react';
import { Button } from '@/shared/ui/Button';
import { Modal } from '@/shared/ui/Modal';
import type { User } from '@/domain/user/schema';
import {
  useReceivedWorkPlanRequests,
  useSentWorkPlanRequests,
  useAcceptWorkPlanRequest,
  useRejectWorkPlanRequest,
} from '@/features/workPlan/useWorkPlanRequests';
import type { WorkPlanRequest } from '@/domain/workPlan/workPlanRequest.schema';
import {
  Inbox,
  CheckCircle2,
  XCircle,
  Clock,
  Calendar,
  Send,
  Check,
  X,
} from 'lucide-react';

interface WorkPlanRequestInboxWidgetProps {
  actor: User;
}

export function WorkPlanRequestInboxWidget({ actor }: WorkPlanRequestInboxWidgetProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [tab, setTab] = useState<'received' | 'sent'>('received');
  const [rejectingReq, setRejectingReq] = useState<WorkPlanRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const receivedQuery = useReceivedWorkPlanRequests(actor.id);
  const sentQuery = useSentWorkPlanRequests(actor.id);
  const acceptMutation = useAcceptWorkPlanRequest();
  const rejectMutation = useRejectWorkPlanRequest();

  const receivedList = receivedQuery.data ?? [];
  const sentList = sentQuery.data ?? [];

  // 아직 처리되지 않은 대기 중인 요청 건수
  const pendingCount = receivedList.filter((r) => r.status === 'PENDING').length;

  const handleAccept = async (req: WorkPlanRequest) => {
    if (!confirm(`'${req.title}' 일정을 수락하여 ${req.date} 업무계획서에 반영하시겠습니까?`)) {
      return;
    }
    try {
      await acceptMutation.mutateAsync(req.id);
      alert('일정을 수락하여 업무계획서에 자동 등록했습니다.');
    } catch (e: any) {
      alert(`수락 처리 실패: ${e.message || e}`);
    }
  };

  const handleOpenReject = (req: WorkPlanRequest) => {
    setRejectingReq(req);
    setRejectReason('');
  };

  const handleConfirmReject = async () => {
    if (!rejectingReq) return;
    try {
      await rejectMutation.mutateAsync({
        requestId: rejectingReq.id,
        reason: rejectReason.trim() || undefined,
      });
      alert('일정 요청을 반려했습니다.');
      setRejectingReq(null);
    } catch (e: any) {
      alert(`반려 처리 실패: ${e.message || e}`);
    }
  };

  return (
    <>
      {/* ── 상단 트리거 버튼 ── */}
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={`relative flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[11px] font-bold transition-all border cursor-pointer ${
          pendingCount > 0
            ? 'bg-amber-500/15 border-amber-500/40 text-amber-700 dark:text-amber-300 hover:bg-amber-500/25 shadow-xs animate-pulse'
            : 'bg-panel-alt/60 border-border text-ink2 hover:text-ink hover:bg-panel'
        }`}
        title="동료 일정 요청함 확인"
      >
        <Inbox size={13} className={pendingCount > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-ink3'} />
        <span>일정 요청함</span>
        {pendingCount > 0 && (
          <span className="grid h-4.5 min-w-[18px] place-items-center rounded-full bg-red-500 px-1 text-[9.5px] font-extrabold text-white">
            {pendingCount}
          </span>
        )}
      </button>

      {/* ── 요청함 상세 모달 ── */}
      <Modal
        open={isOpen}
        onClose={() => setIsOpen(false)}
        title={
          <div className="flex items-center gap-2">
            <Inbox className="text-teal" size={18} />
            <span>업무계획 일정 요청함</span>
            {pendingCount > 0 && (
              <span className="rounded-full bg-red-500/15 text-red-600 border border-red-500/30 px-2 py-0.2 text-[10px] font-bold">
                대기 {pendingCount}건
              </span>
            )}
          </div>
        }
        footer={
          <Button size="sm" variant="secondary" onClick={() => setIsOpen(false)}>
            닫기
          </Button>
        }
      >
        <div className="space-y-3.5">
          {/* 탭 전환 (받은 요청 / 보낸 요청) */}
          <div className="flex rounded-lg border border-border bg-panel-alt/40 p-0.5 text-[11.5px] font-bold">
            <button
              type="button"
              onClick={() => setTab('received')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md transition-all ${
                tab === 'received' ? 'bg-panel text-teal shadow-xs' : 'text-ink3 hover:text-ink'
              }`}
            >
              <span>받은 요청</span>
              <span className={`rounded-full px-1.5 py-0.2 text-[10px] ${
                pendingCount > 0 ? 'bg-red-500 text-white' : 'bg-border text-ink3'
              }`}>
                {receivedList.length}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setTab('sent')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md transition-all ${
                tab === 'sent' ? 'bg-panel text-teal shadow-xs' : 'text-ink3 hover:text-ink'
              }`}
            >
              <span>보낸 요청</span>
              <span className="rounded-full bg-border px-1.5 py-0.2 text-[10px] text-ink3">
                {sentList.length}
              </span>
            </button>
          </div>

          {/* ── 탭 1: 받은 요청 목록 ── */}
          {tab === 'received' && (
            <div className="max-h-[55vh] overflow-y-auto space-y-2.5 pr-1">
              {receivedList.length === 0 ? (
                <div className="py-12 text-center text-[11.5px] text-ink3">
                  <Inbox className="mx-auto mb-2 opacity-30" size={28} />
                  다른 임직원으로부터 받은 일정 추가 요청이 없습니다.
                </div>
              ) : (
                receivedList.map((req) => (
                  <div
                    key={req.id}
                    className={`rounded-xl border p-3 transition-all ${
                      req.status === 'PENDING'
                        ? 'border-amber-500/40 bg-amber-500/5 shadow-2xs'
                        : 'border-border bg-panel'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className="grid h-6 w-6 place-items-center rounded-full bg-teal text-white text-[10px] font-bold">
                          {req.requesterName.slice(0, 1)}
                        </span>
                        <div>
                          <span className="text-[12px] font-bold text-ink">{req.requesterName}</span>
                          <span className="ml-1 text-[10px] text-ink3">({req.requesterDept})</span>
                        </div>
                      </div>

                      {/* 상태 뱃지 */}
                      {req.status === 'PENDING' && (
                        <span className="rounded bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/30 px-2 py-0.5 text-[10px] font-bold">
                          수락 대기중
                        </span>
                      )}
                      {req.status === 'ACCEPTED' && (
                        <span className="rounded bg-teal/15 text-teal border border-teal/30 px-2 py-0.5 text-[10px] font-bold flex items-center gap-1">
                          <CheckCircle2 size={11} /> 수락 완료
                        </span>
                      )}
                      {req.status === 'REJECTED' && (
                        <span className="rounded bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-slate-600 px-2 py-0.5 text-[10px] font-bold flex items-center gap-1">
                          <XCircle size={11} /> 반려됨
                        </span>
                      )}
                    </div>

                    {/* 요청 내용 */}
                    <div className="rounded-lg bg-panel-alt/50 border border-border/70 p-2 text-[11px] text-ink mb-2">
                      <div className="flex items-center gap-2 mb-1 text-[10.5px] font-semibold text-ink2">
                        <span className="flex items-center gap-1 text-teal">
                          <Calendar size={11} /> {req.date}
                        </span>
                        {req.timeStr && (
                          <span className="flex items-center gap-1 text-blue-600 dark:text-blue-400">
                            <Clock size={11} /> {req.timeStr}
                          </span>
                        )}
                        {req.tag && (
                          <span className="rounded bg-ink/5 px-1.5 py-0.2 text-[9.5px] text-ink3">
                            #{req.tag}
                          </span>
                        )}
                      </div>
                      <div className="font-bold text-[12px]">{req.title}</div>
                      {req.memo && (
                        <div className="mt-1 text-[10.5px] text-ink3 italic">
                          "{req.memo}"
                        </div>
                      )}
                    </div>

                    {/* 수락 / 반려 액션 버튼 (PENDING 상태일 때만) */}
                    {req.status === 'PENDING' && (
                      <div className="flex items-center justify-end gap-1.5 pt-1">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => handleOpenReject(req)}
                          disabled={rejectMutation.isPending || acceptMutation.isPending}
                        >
                          <span className="flex items-center gap-1 text-red-500">
                            <X size={12} /> 반려
                          </span>
                        </Button>
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => handleAccept(req)}
                          disabled={acceptMutation.isPending || rejectMutation.isPending}
                        >
                          <span className="flex items-center gap-1">
                            <Check size={12} /> 수락 및 일정 반영
                          </span>
                        </Button>
                      </div>
                    )}

                    {/* 반려 사유 안내 */}
                    {req.status === 'REJECTED' && req.responseComment && (
                      <div className="text-[10px] text-ink3 pl-1">
                        반려 사유: {req.responseComment}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {/* ── 탭 2: 보낸 요청 목록 ── */}
          {tab === 'sent' && (
            <div className="max-h-[55vh] overflow-y-auto space-y-2.5 pr-1">
              {sentList.length === 0 ? (
                <div className="py-12 text-center text-[11.5px] text-ink3">
                  <Send className="mx-auto mb-2 opacity-30" size={28} />
                  내가 동료에게 보낸 일정 추가 요청이 없습니다.
                </div>
              ) : (
                sentList.map((req) => (
                  <div key={req.id} className="rounded-xl border border-border bg-panel p-3">
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <div>
                        <span className="text-[10.5px] text-ink3">수신 대상: </span>
                        <span className="text-[12px] font-bold text-ink">{req.targetUserName}</span>
                        <span className="ml-1 text-[10px] text-ink3">({req.targetUserDept})</span>
                      </div>

                      {/* 상태 뱃지 */}
                      {req.status === 'PENDING' && (
                        <span className="rounded bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/30 px-2 py-0.5 text-[10px] font-bold">
                          대기중
                        </span>
                      )}
                      {req.status === 'ACCEPTED' && (
                        <span className="rounded bg-teal/15 text-teal border border-teal/30 px-2 py-0.5 text-[10px] font-bold flex items-center gap-1">
                          <CheckCircle2 size={11} /> 수락됨
                        </span>
                      )}
                      {req.status === 'REJECTED' && (
                        <span className="rounded bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-slate-600 px-2 py-0.5 text-[10px] font-bold flex items-center gap-1">
                          <XCircle size={11} /> 반려됨
                        </span>
                      )}
                    </div>

                    <div className="rounded-lg bg-panel-alt/40 border border-border/70 p-2 text-[11px] text-ink">
                      <div className="flex items-center gap-2 mb-1 text-[10.5px] text-ink3">
                        <span>{req.date}</span>
                        {req.timeStr && <span>{req.timeStr}</span>}
                        {req.tag && <span>#{req.tag}</span>}
                      </div>
                      <div className="font-bold text-[11.5px]">{req.title}</div>
                      {req.memo && <div className="mt-1 text-[10px] text-ink3">메모: {req.memo}</div>}
                    </div>

                    {req.status === 'REJECTED' && req.responseComment && (
                      <div className="mt-1.5 text-[10.5px] text-red-500 pl-1">
                        반려 사유: {req.responseComment}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </Modal>

      {/* ── 반려 사유 입력 서브 모달 ── */}
      {rejectingReq && (
        <Modal
          open={Boolean(rejectingReq)}
          onClose={() => setRejectingReq(null)}
          title="일정 요청 반려"
          footer={
            <div className="flex items-center justify-end gap-2">
              <Button size="sm" variant="secondary" onClick={() => setRejectingReq(null)}>
                취소
              </Button>
              <Button size="sm" variant="primary" onClick={handleConfirmReject} disabled={rejectMutation.isPending}>
                반려 확인
              </Button>
            </div>
          }
        >
          <div className="space-y-3 text-ink">
            <p className="text-[11.5px] text-ink2">
              <strong>{rejectingReq.requesterName}</strong>님의 '{rejectingReq.title}' 일정 요청을 반려하시겠습니까?
            </p>
            <div>
              <label className="mb-1 block text-[11px] font-bold text-ink2">반려 사유 (선택)</label>
              <input
                type="text"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="예: 해당 시간대 기존 외부 미팅 있음"
                className="h-8.5 w-full rounded-lg border border-border bg-panel px-2.5 text-[11px] text-ink outline-none focus:border-teal"
              />
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
