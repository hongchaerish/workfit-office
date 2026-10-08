import { useEffect } from 'react';
import type { ApprovalForm } from '@/domain/approvalForm/schema';
import { ApprovalRouteRuleSettings } from './ApprovalRouteRuleSettings';
import { X, GitMerge } from 'lucide-react';

interface ApprovalRouteRuleModalProps {
  isOpen: boolean;
  onClose: () => void;
  form: ApprovalForm;
  org: any;
}

/**
 * 서식 디자이너 A4 직인란 원클릭 연동 모달.
 * 서식에 매칭되는 결재선(전결) 규칙 목록 및 단계 빌더를 모달 형태로 팝업하여
 * 좌측 속성 패널의 스크롤을 유발하지 않고 True WYSIWYG 원칙으로 결재선을 편집합니다.
 */
export function ApprovalRouteRuleModal({
  isOpen,
  onClose,
  form,
  org,
}: ApprovalRouteRuleModalProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative flex flex-col w-full max-w-4xl max-h-[calc(88vh/var(--font-scale,1))] rounded-2xl bg-panel border border-border shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 모달 상단 헤더 */}
        <div className="flex items-center justify-between border-b border-border bg-panel-alt/70 px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-soft text-teal text-[20px] shadow-xs">
              {form.icon || '📑'}
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-[16px] font-bold text-ink">
                  '{form.name}' 결재선(전결) 규칙 설정
                </h3>
                <span className="rounded bg-teal/15 px-2 py-0.5 text-[10.5px] font-extrabold text-teal border border-teal/20">
                  {form.code}
                </span>
              </div>
              <p className="text-[11.5px] text-ink3 mt-0.5">
                기안자 부서·직급 및 청구 금액 조건에 맞춰 결재선 단계를 자동으로 구성합니다.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-ink3 hover:bg-border/40 hover:text-ink transition-colors cursor-pointer"
            aria-label="닫기"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 모달 본문: ApprovalRouteRuleSettings 임베드 */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="flex items-center gap-2 rounded-lg bg-teal-soft/40 border border-teal/20 px-3.5 py-2 text-[11.5px] text-teal">
            <GitMerge className="h-4 w-4 shrink-0" />
            <span>
              A4 캔버스 상단 직인란을 클릭하여 진입하셨습니다. 규칙을 추가·수정하면 직인란에 실시간 반영됩니다.
            </span>
          </div>

          <ApprovalRouteRuleSettings form={form} org={org} />
        </div>

        {/* 모달 하단 액션 바 */}
        <div className="flex items-center justify-between border-t border-border bg-panel-alt/50 px-6 py-3">
          <div className="text-[11.5px] text-ink3 flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-teal animate-pulse" />
            <span>설정한 규칙은 A4 캔버스 직인란 및 향후 기안 상신 시 즉시 적용됩니다.</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-teal px-5 py-2 text-[12.5px] font-bold text-white shadow-xs hover:opacity-90 transition-opacity cursor-pointer"
          >
            설정 완료 및 닫기
          </button>
        </div>
      </div>
    </div>
  );
}
