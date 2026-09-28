import { useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { Button } from '@/shared/ui/Button';
import type { User } from '@/domain/user/schema';
import { useCreateWorkPlanRequest } from '@/features/workPlan/useWorkPlanRequests';
import { Calendar, Clock, Tag, MessageSquare, Send } from 'lucide-react';

interface WorkPlanRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  actor: User;
  targetUser: User;
  initialDate: string;
}

const TIME_OPTIONS = [
  '08:00', '08:30', '09:00', '09:30', '10:00', '10:30',
  '11:00', '11:30', '12:00', '12:30', '13:00', '13:30',
  '14:00', '14:30', '15:00', '15:30', '16:00', '16:30',
  '17:00', '17:30', '18:00', '18:30', '19:00',
];

const PRESET_TAGS = ['회의', '미팅', '협조', '검토', '외근', '교육', '기타'];

export function WorkPlanRequestModal({
  isOpen,
  onClose,
  actor,
  targetUser,
  initialDate,
}: WorkPlanRequestModalProps) {
  const [date, setDate] = useState(initialDate);
  const [mode, setMode] = useState<'schedule' | 'todo'>('schedule');
  const [title, setTitle] = useState('');
  const [tag, setTag] = useState('회의');
  const [startTime, setStartTime] = useState('14:00');
  const [endTime, setEndTime] = useState('15:00');
  const [memo, setMemo] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const createRequest = useCreateWorkPlanRequest();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      alert('일정 또는 업무 내용을 입력해주세요.');
      return;
    }

    try {
      setIsSubmitting(true);
      const timeStr = mode === 'schedule' ? `${startTime}~${endTime}` : undefined;

      await createRequest.mutateAsync({
        requesterId: actor.id,
        requesterName: actor.name,
        requesterDept: actor.dept,
        targetUserId: targetUser.id,
        targetUserName: targetUser.name,
        targetUserDept: targetUser.dept,
        date,
        title: title.trim(),
        timeStr,
        tag: tag || undefined,
        memo: memo.trim() || undefined,
      });

      alert(`${targetUser.name}님에게 일정 추가 요청을 보냈습니다.\n상대방이 수락하면 업무계획서에 정식 등록됩니다.`);
      onClose();
    } catch (err: any) {
      alert(`요청 전송 실패: ${err.message || err}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title="동료 일정에 추가 요청"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button size="sm" variant="secondary" onClick={onClose} disabled={isSubmitting}>
            취소
          </Button>
          <Button size="sm" variant="primary" onClick={handleSubmit} disabled={isSubmitting || !title.trim()}>
            <span className="flex items-center gap-1.5">
              <Send size={13} />
              {isSubmitting ? '전송 중...' : '요청 전송'}
            </span>
          </Button>
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4 text-ink">
        {/* 대상 임직원 정보 카드 */}
        <div className="flex items-center justify-between rounded-xl bg-teal-soft/20 border border-teal/30 p-3">
          <div className="flex items-center gap-2.5">
            <div className="grid h-9 w-9 place-items-center rounded-full bg-teal text-white font-extrabold text-[12px]">
              {targetUser.name.slice(0, 1)}
            </div>
            <div>
              <div className="text-[13px] font-bold text-ink flex items-center gap-1.5">
                <span>{targetUser.name}</span>
                <span className="text-[11px] font-normal text-ink2">{targetUser.position}</span>
              </div>
              <div className="text-[10.5px] text-ink3">{targetUser.dept}</div>
            </div>
          </div>
          <span className="rounded bg-teal/20 px-2 py-0.5 text-[10px] font-bold text-teal">
            일정 요청 대상
          </span>
        </div>

        {/* 요청 날짜 및 모드 선택 */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-[11px] font-bold text-ink2">
              <span className="flex items-center gap-1"><Calendar size={12} /> 요청 일자</span>
            </label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="h-8.5 w-full rounded-lg border border-border bg-panel px-2.5 text-[11px] font-medium text-ink outline-none focus:border-teal"
            />
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-bold text-ink2">
              <span className="flex items-center gap-1"><Clock size={12} /> 일정 유형</span>
            </label>
            <div className="flex h-8.5 rounded-lg border border-border bg-panel-alt/40 p-0.5">
              <button
                type="button"
                onClick={() => setMode('schedule')}
                className={`flex-1 rounded-md text-[11px] font-bold transition-all ${
                  mode === 'schedule' ? 'bg-panel shadow-xs text-teal' : 'text-ink3 hover:text-ink'
                }`}
              >
                시간 일정
              </button>
              <button
                type="button"
                onClick={() => setMode('todo')}
                className={`flex-1 rounded-md text-[11px] font-bold transition-all ${
                  mode === 'todo' ? 'bg-panel shadow-xs text-teal' : 'text-ink3 hover:text-ink'
                }`}
              >
                업무 To-Do
              </button>
            </div>
          </div>
        </div>

        {/* 시간 선택 (시간 일정 모드일 때) */}
        {mode === 'schedule' && (
          <div className="rounded-lg bg-panel-alt/40 border border-border p-2.5 flex items-center gap-2">
            <span className="text-[11px] font-bold text-ink2 shrink-0">시간:</span>
            <select
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="h-7.5 rounded border border-border bg-panel px-2 text-[11px] text-ink outline-none focus:border-teal"
            >
              {TIME_OPTIONS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <span className="text-ink3 text-[11px]">~</span>
            <select
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="h-7.5 rounded border border-border bg-panel px-2 text-[11px] text-ink outline-none focus:border-teal"
            >
              {TIME_OPTIONS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
        )}

        {/* 태그 선택 */}
        <div>
          <label className="mb-1 block text-[11px] font-bold text-ink2">
            <span className="flex items-center gap-1"><Tag size={12} /> 태그</span>
          </label>
          <div className="flex flex-wrap gap-1.5">
            {PRESET_TAGS.map((t) => (
              <button
                type="button"
                key={t}
                onClick={() => setTag(t)}
                className={`rounded-full px-2.5 py-0.5 text-[10.5px] font-semibold border transition-all ${
                  tag === t
                    ? 'border-teal bg-teal text-white shadow-xs'
                    : 'border-border bg-panel text-ink3 hover:border-teal/40 hover:text-ink'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* 일정 / 업무 제목 */}
        <div>
          <label className="mb-1 block text-[11px] font-bold text-ink2">
            일정 / 업무 명칭 <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="예: 2분기 예산안 협의 미팅, 시스템 요구사항 검토 등"
            className="h-9 w-full rounded-lg border border-border bg-panel px-3 text-[12px] text-ink outline-none focus:border-teal focus:ring-1 focus:ring-teal/30"
          />
        </div>

        {/* 추가 메모 / 전달사항 */}
        <div>
          <label className="mb-1 block text-[11px] font-bold text-ink2">
            <span className="flex items-center gap-1"><MessageSquare size={12} /> 요청 사유 및 전달사항</span>
          </label>
          <textarea
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            rows={2}
            placeholder="상대방에게 전달할 요청 사유나 회의 장소, 참고 사항을 적어주세요."
            className="w-full rounded-lg border border-border bg-panel p-2.5 text-[11px] text-ink outline-none focus:border-teal focus:ring-1 focus:ring-teal/30 resize-none"
          />
        </div>

        {/* 안내 문구 */}
        <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-2.5 text-[10.5px] text-amber-800 dark:text-amber-300 leading-relaxed">
          💡 <strong>승인 및 연동 안내</strong>: 요청을 보내면 {targetUser.name}님에게 실시간 알림이 발송되며, 상대방이 <strong>수락</strong>하면 해당 날짜 업무계획서에 정식 등록됩니다.
        </div>
      </form>
    </Modal>
  );
}
