import type { ApprovalDoc } from '@/domain/approvalDoc/schema';
import { AlertTriangle } from 'lucide-react';
import { STATUS_BADGE } from '../utils/approvalUtils';
import { isActiveApprover } from '@/domain/approvalDoc/engine';

export function DocStatusBadge({ doc, me }: { doc: ApprovalDoc; me?: string }) {
  const effectiveStatus = doc.status === '시행대기' ? '완료' : doc.status === '시행반송' ? '반려' : doc.status;
  let badge = STATUS_BADGE[effectiveStatus] ?? { label: effectiveStatus, toneClass: 'bg-panel-alt text-ink2 border-border' };

  if (doc.status === '진행중' && me) {
    // 엔진이 정한 지금 차례(활성 그룹)만 — 결재선에 대기로 남은 것만 보면 병렬 합의가 안 끝났는데 다음 결재자에게도 '내 결재 순서'가 떴다
    const isMyTurn = isActiveApprover(doc, me);
    if (isMyTurn) {
      badge = { label: '내 결재 순서', toneClass: 'bg-red-500 text-white font-extrabold border-red-500 animate-pulse' };
    }
  }

  return (
    <div className="inline-flex items-center gap-1">
      {doc.isPostApproval && (
        <span className="inline-flex items-center gap-0.5 rounded-md border border-rose-500/40 bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-extrabold text-rose-600 dark:text-rose-400">
          <AlertTriangle size={10} className="shrink-0" />
          <span>후결</span>
        </span>
      )}
      <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10.5px] border ${badge.toneClass}`}>
        {badge.label}
      </span>
    </div>
  );
}
