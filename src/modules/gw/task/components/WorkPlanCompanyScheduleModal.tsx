import { useState, useEffect } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { Button } from '@/shared/ui/Button';
import { Calendar, Megaphone } from 'lucide-react';

interface WorkPlanCompanyScheduleModalProps {
  isOpen: boolean;
  date: string;
  initialContent?: string;
  planId?: string;
  onClose: () => void;
  onSave: (date: string, content: string, planId?: string) => Promise<void>;
  onDelete?: (planId: string, date: string) => Promise<void>;
}

export function WorkPlanCompanyScheduleModal({
  isOpen,
  date,
  initialContent = '',
  planId,
  onClose,
  onSave,
  onDelete,
}: WorkPlanCompanyScheduleModalProps) {
  const [content, setContent] = useState(initialContent);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setContent(initialContent);
  }, [initialContent, date]);

  const handleSave = async () => {
    try {
      setIsSaving(true);
      await onSave(date, content.trim(), planId);
      onClose();
    } catch (err) {
      console.error('Failed to save company schedule:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!planId || !onDelete) return;
    if (!confirm('이 날짜의 전사 주요 일정을 삭제하시겠습니까?')) return;
    try {
      setIsSaving(true);
      await onDelete(planId, date);
      onClose();
    } catch (err) {
      console.error('Failed to delete company schedule:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const formattedDate = date ? (() => {
    const [y, m, d] = date.split('-');
    return `${y}년 ${m}월 ${d}일`;
  })() : '';

  return (
    <Modal open={isOpen} onClose={onClose} title="전사 주요 일정 등록 / 수정" width={440}>
      <div className="space-y-4">
        {/* 안내 배너 */}
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-amber-800 dark:text-amber-200">
          <Megaphone size={16} className="shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
          <div className="text-[11.5px] leading-relaxed">
            <span className="font-extrabold">전사 공통 중요 일정</span>은 모든 임직원의 업무계획 상단에 빨간색 강조 텍스트로 공유됩니다.
            (예: 전체 회식, 선포식, 사내 행사, 프로젝트 오픈일 등)
          </div>
        </div>

        {/* 날짜 표시 */}
        <div className="flex items-center gap-1.5 text-[12px] font-bold text-ink">
          <Calendar size={14} className="text-teal" />
          <span>{formattedDate}</span>
        </div>

        {/* 입력란 */}
        <div className="space-y-1">
          <label className="block text-[11px] font-bold text-ink2">
            주요 일정 내용
          </label>
          <input
            type="text"
            autoFocus
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleSave();
              }
            }}
            placeholder="예: 16시. 선포식(7층) / 전체 회식 (17:00~)"
            className="w-full rounded-xl border border-border-hi bg-panel px-3 py-2 text-[12px] font-semibold text-rose-600 dark:text-rose-400 outline-none focus:border-rose-500 placeholder:text-ink3 placeholder:font-normal"
          />
        </div>

        {/* 버튼 영역 */}
        <div className="flex items-center justify-between border-t border-border pt-3">
          <div>
            {planId && onDelete && (
              <Button
                variant="danger"
                size="sm"
                onClick={handleDelete}
                disabled={isSaving}
              >
                삭제
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={onClose}
              disabled={isSaving}
            >
              취소
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={isSaving}
            >
              {isSaving ? '저장 중…' : '저장하기'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
