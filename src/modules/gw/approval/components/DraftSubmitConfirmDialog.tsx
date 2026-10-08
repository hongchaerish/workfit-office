import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, GitFork, Paperclip, Send, X } from 'lucide-react';
import type { ApprovalRecipient, ApprovalStep } from '@/domain/approvalDoc/schema';

/** 결재 구분별 배지 색 */
const KIND_BADGE: Record<string, string> = {
  결재: 'bg-teal/10 text-teal',
  합의: 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
  전결: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  대결: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400',
  참조: 'bg-ink3/10 text-ink3',
};

/**
 * 상신 직전 확인창 — 제목·결재선·수신처·첨부를 한 번 더 보여주고 상신한다.
 * 상신은 결재자에게 바로 알림이 가는 동작이라 잘못 보낸 뒤 회수하는 번거로움을 줄인다.
 */
export function DraftSubmitConfirmDialog({
  docTitle,
  formName,
  steps,
  drafterId,
  recipients,
  attachmentCount,
  relatedDocCount,
  visibility,
  securityLevel,
  isPostApproval,
  isResubmit,
  busy,
  nameOf,
  posOf,
  onEditLine,
  onCancel,
  onConfirm,
}: {
  docTitle: string;
  formName: string;
  steps: ApprovalStep[];
  drafterId: string;
  recipients: ApprovalRecipient[];
  attachmentCount: number;
  relatedDocCount: number;
  visibility: string;
  securityLevel: string;
  isPostApproval: boolean;
  isResubmit: boolean;
  busy: boolean;
  nameOf: (id: string) => string;
  posOf: (id: string) => string;
  onEditLine: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const pressedOnBackdropRef = useRef(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  const ordered = [...steps].sort((a, b) => a.seq - b.seq);
  const lineSteps = ordered.filter((s) => s.kind !== '참조');
  const refSteps = ordered.filter((s) => s.kind === '참조');

  const warnings: string[] = [];
  if (lineSteps.some((s) => s.kind === '전결')) warnings.push('전결이 포함되어 있어, 전결자가 승인하면 이후 결재자는 생략되고 결재가 완료됩니다.');
  if (isPostApproval) warnings.push('후결(사후 승인) 문서로 상신됩니다.');

  const label = (id: string) => {
    const pos = posOf(id);
    return pos ? `${nameOf(id)} ${pos}` : nameOf(id);
  };
  const actionLabel = isResubmit ? '재상신' : '상신';

  return createPortal(
    <div
      className="fixed inset-0 z-[400] grid place-items-center bg-black/40 p-4 backdrop-blur-sm"
      onMouseDown={(e) => { pressedOnBackdropRef.current = e.target === e.currentTarget; }}
      onClick={(e) => {
        if (pressedOnBackdropRef.current && e.target === e.currentTarget && !busy) onCancel();
        pressedOnBackdropRef.current = false;
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${actionLabel} 확인`}
        className="flex max-h-full w-[480px] max-w-full flex-col overflow-hidden rounded-2xl border border-border bg-panel shadow-2xl"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-3.5">
          <h3 className="flex items-center gap-1.5 text-[14px] font-extrabold text-ink">
            <Send size={15} className="shrink-0 text-teal" />
            <span>{actionLabel} 전 확인</span>
          </h3>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            aria-label="닫기"
            className="grid h-7 w-7 place-items-center rounded-md text-ink3 transition-colors hover:bg-panel-alt hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto px-5 py-4 text-[12px]">
          {/* 문서 */}
          <div className="rounded-lg border border-border bg-panel-alt/40 px-3.5 py-2.5">
            <div className="text-[10.5px] font-bold text-ink3">{formName}</div>
            <div className="mt-0.5 break-all text-[13.5px] font-extrabold text-ink">{docTitle}</div>
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10.5px] text-ink3">
              <span>공개범위 · <b className="text-ink2">{visibility}</b></span>
              {securityLevel !== '일반' && <span>보안등급 · <b className="text-danger">{securityLevel}</b></span>}
              <span className="inline-flex items-center gap-0.5"><Paperclip size={10} />첨부 <b className="text-ink2">{attachmentCount}</b>개</span>
              {relatedDocCount > 0 && <span>관련문서 <b className="text-ink2">{relatedDocCount}</b>건</span>}
            </div>
          </div>

          {/* 결재선 */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="flex items-center gap-1 text-[11.5px] font-extrabold text-ink">
                <GitFork size={12} className="text-teal" />결재선
              </span>
              <button type="button" onClick={onEditLine} disabled={busy} className="text-[11px] font-bold text-teal hover:underline">
                결재선 수정
              </button>
            </div>
            <ol className="divide-y divide-border/60 rounded-lg border border-border">
              {lineSteps.map((s, i) => {
                const isDrafter = i === 0 && s.approverId === drafterId;
                return (
                  <li key={`${s.seq}-${s.approverId}`} className="flex items-center gap-2 px-3 py-1.5">
                    <span className="w-4 shrink-0 text-right text-[10.5px] font-bold text-ink3">{i + 1}</span>
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${isDrafter ? 'bg-panel-alt text-ink2' : KIND_BADGE[s.kind] ?? 'bg-panel-alt text-ink2'}`}>
                      {isDrafter ? '기안' : s.kind}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-semibold text-ink">{label(s.approverId)}</span>
                    {s.parallelGroup && <span className="shrink-0 text-[10px] text-ink3">동시 진행</span>}
                  </li>
                );
              })}
            </ol>
          </div>

          {/* 참조·수신 */}
          <div className="grid gap-1 text-[11px]">
            <div className="flex gap-2">
              <span className="w-10 shrink-0 font-bold text-ink3">참조</span>
              <span className="min-w-0 flex-1 text-ink2">{refSteps.length ? refSteps.map((s) => label(s.approverId)).join(', ') : '없음'}</span>
            </div>
            <div className="flex gap-2">
              <span className="w-10 shrink-0 font-bold text-ink3">수신</span>
              <span className="min-w-0 flex-1 text-ink2">{recipients.length ? recipients.map((r) => r.name).join(', ') : '없음'}</span>
            </div>
          </div>

          {warnings.length > 0 && (
            <ul className="space-y-1 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-300">
              {warnings.map((w) => (
                <li key={w} className="flex items-start gap-1.5">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0 text-amber-500" />
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-1.5 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="h-8 rounded-lg bg-panel-alt px-3 text-[11.5px] font-semibold text-ink2 transition-colors hover:bg-border-hi/30"
          >
            취소
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="h-8 rounded-lg bg-teal px-4 text-[12px] font-bold text-white transition-colors hover:bg-teal-dark disabled:opacity-50"
          >
            {busy ? `${actionLabel} 중...` : `${actionLabel}하기`}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
