import type { ApprovalStep } from '@/domain/approvalDoc/schema';
import { resolveSignatureSnapshot } from '@/domain/approvalDoc/signatureSnapshot';

function shortDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

function Stamp({ step, name, sealUrl, isSignature, isPostApproval }: { step: ApprovalStep; name: string; sealUrl: string; isSignature: boolean; isPostApproval?: boolean }) {
  if (step.kind === '참조') return <span className="text-[10px] text-[#888]">열람<br />{name}</span>;

  if (sealUrl && (step.seq === 1 || step.decision === '승인' || step.decision === '반려' || step.decision === '보류')) {
    if (isSignature) {
      return (
        <div className="relative h-[52px] w-[59px] flex items-center justify-center overflow-visible select-none">
          <img
            src={sealUrl}
            alt="서명"
            className="min-w-[84px] min-h-[40px] max-w-[84px] max-h-[40px] object-contain opacity-95 pointer-events-none mix-blend-multiply"
            style={{ opacity: step.decision === '반려' ? 0.6 : 1 }}
          />
          {isPostApproval && step.decision === '승인' && (
            <span className="absolute bottom-0 text-[8px] font-extrabold text-rose-600 bg-white/90 border border-rose-400 px-0.5 rounded z-20">사후승인</span>
          )}
          {step.decision === '반려' && (
            <span className="absolute inset-0 flex items-center justify-center text-[9px] font-extrabold text-[#c0392b] z-30" style={{ textShadow: '0 0 2px #fff' }}>반려</span>
          )}
        </div>
      );
    }

    return (
      <div className="relative flex h-[44px] w-[44px] items-center justify-center">
        <img src={sealUrl} alt="인감" className="h-full w-full object-contain" style={{ opacity: step.decision === '반려' ? 0.6 : 1 }} />
        {isPostApproval && step.decision === '승인' && (
          <span className="absolute bottom-0 text-[8px] font-extrabold text-rose-600 bg-white/90 border border-rose-400 px-0.5 rounded z-20">사후승인</span>
        )}
        {step.decision === '반려' && (
          <span className="absolute inset-0 flex items-center justify-center text-[9px] font-extrabold text-[#c0392b]" style={{ textShadow: '0 0 2px #fff' }}>반려</span>
        )}
      </div>
    );
  }

  if (step.decision === '승인')
    return (
      <div className="relative flex items-center justify-center">
        <span className="grid h-[40px] w-[40px] place-items-center rounded-full border-[1.5px] border-[#c0392b] text-[10px] font-bold leading-tight text-[#c0392b]">{name}</span>
        {isPostApproval && (
          <span className="absolute bottom-[-4px] text-[7.5px] font-extrabold text-rose-600 bg-white border border-rose-400 px-0.5 rounded z-10">사후</span>
        )}
      </div>
    );
  if (step.decision === '반려')
    return <span className="grid h-[40px] w-[40px] place-items-center rounded-full border-[1.5px] border-[#c0392b] text-[10px] font-bold text-[#c0392b]">반려</span>;
  if (step.decision === '보류') return <span className="text-[10px] font-semibold text-[#888]">{step.kind === '합의' ? '협의요청' : '보류'}<br />{name}</span>;

  return <span className="text-[12px] font-bold text-[#ccc] select-none">{step.kind}</span>;
}

export function ApprovalStampTable({
  steps,
  nameOf,
  posOf,
  sealOf,
  isSignatureOf,
  isPostApproval,
  allowCurrentSignature = false,
}: {
  steps: ApprovalStep[];
  nameOf: (id: string) => string;
  posOf: (id: string) => string;
  sealOf?: (id: string) => string;
  isSignatureOf?: (id: string) => boolean;
  isPostApproval?: boolean;
  /** 작성 화면에서만 현재 프로필 이미지를 참조한다. */
  allowCurrentSignature?: boolean;
}) {
  if (steps.length === 0) return null;

  const approvalSteps = steps.filter((s) => s.kind !== '합의');
  const agreementSteps = steps.filter((s) => s.kind === '합의');

  const signatureOfStep = (step: ApprovalStep) => {
    if (!allowCurrentSignature) return resolveSignatureSnapshot(step);
    const isSignature = isSignatureOf?.(step.approverId) ?? false;
    const url = sealOf?.(step.approverId) ?? '';
    return resolveSignatureSnapshot(step, {
      signType: isSignature ? 'signature' : 'stamp',
      signUrl: isSignature ? url : null,
      sealUrl: isSignature ? null : url,
    });
  };

  return (
    <div className="flex items-start justify-end gap-3.5 shrink-0">
      {/* 합의(협조) 테이블: 합의 단계가 있을 때만 좌측에 렌더링 */}
      {agreementSteps.length > 0 && (
        <div className="flex shrink-0 border border-[#333] text-center bg-white">
          <div className="flex w-6 items-center justify-center border-r border-[#333] text-[10px] font-bold [writing-mode:vertical-rl] tracking-[0.3em] text-[#333] bg-[#f8f9fa] select-none">
            합의
          </div>
          <div className="flex">
            {agreementSteps.map((s) => {
              const finalName = s.approverName || nameOf(s.approverId);
              const finalPos = s.approverPos || posOf(s.approverId);
              const { url: finalSealUrl, isSignature: finalIsSignature } = signatureOfStep(s);

              return (
                <div key={s.seq} className="w-[60px] border-r border-[#333] last:border-r-0">
                  <div className="border-b border-[#333] bg-[#f2f2f2] py-0.5 text-[9px] font-bold text-[#333]">{finalPos || ' '}</div>
                  <div className="grid h-[52px] place-items-center px-0.5">
                    <Stamp step={s} name={finalName} sealUrl={finalSealUrl || ''} isSignature={finalIsSignature} isPostApproval={isPostApproval} />
                  </div>
                  <div className="border-t border-[#333] py-[1px] text-[8px] text-[#666]">{(s.decidedAt ? shortDate(s.decidedAt) : ' ') || ' '}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 결재 테이블: 직속 결재선 우측에 렌더링 */}
      {approvalSteps.length > 0 && (
        <div className="flex shrink-0 border border-[#333] text-center bg-white">
          <div className="flex w-6 items-center justify-center border-r border-[#333] text-[10px] font-bold [writing-mode:vertical-rl] tracking-[0.3em] text-[#333] bg-[#f8f9fa] select-none">
            결재
          </div>
          <div className="flex">
            {approvalSteps.map((s) => {
              const finalName = s.approverName || nameOf(s.approverId);
              const finalPos = s.approverPos || posOf(s.approverId);
              const { url: finalSealUrl, isSignature: finalIsSignature } = signatureOfStep(s);

              return (
                <div key={s.seq} className="w-[60px] border-r border-[#333] last:border-r-0">
                  <div className="border-b border-[#333] bg-[#f2f2f2] py-0.5 text-[9px] font-bold text-[#333]">{finalPos || ' '}</div>
                  <div className="grid h-[52px] place-items-center px-0.5">
                    <Stamp step={s} name={finalName} sealUrl={finalSealUrl || ''} isSignature={finalIsSignature} isPostApproval={isPostApproval} />
                  </div>
                  <div className="border-t border-[#333] py-[1px] text-[8px] text-[#666]">{(s.decidedAt ? shortDate(s.decidedAt) : ' ') || ' '}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
