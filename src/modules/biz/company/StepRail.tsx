import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import type { StepView } from './companyFormSteps';

/** 단계 동그라미 — 상태별 모양. */
function StepDot({ index, state }: { index: number; state: StepView['state'] }) {
  const base = 'relative z-[1] grid h-7 w-7 shrink-0 place-items-center rounded-full text-[12px] font-extrabold transition-colors';
  if (state === 'done') return <span className={`${base} bg-teal`}><Check size={14} strokeWidth={3} /></span>;
  if (state === 'error') return <span className={`${base} bg-danger text-white`}>!</span>;
  if (state === 'progress') return <span className={`${base} border-2 border-teal bg-panel text-ink`}>{index}</span>;
  return <span className={`${base} border-2 border-border-hi bg-panel text-ink3`}>{index}</span>;
}

/**
 * 단계 한 칸 — 왼쪽 번호·세로선, 오른쪽 제목줄(상태글·오른쪽 단추)과 내용.
 * 세로선은 다음 단계까지 이어지고, 이 단계가 끝났으면 청록.
 */
export function StepSection({
  index,
  step,
  last = false,
  aside,
  children,
}: {
  index: number;
  step: StepView;
  last?: boolean;
  aside?: ReactNode;
  children: ReactNode;
}) {
  const status =
    step.state === 'done' ? (
      <span className="min-w-0 truncate text-[12px] font-semibold text-ink2">{step.summary}</span>
    ) : step.state === 'error' ? (
      <span className="text-[12px] font-bold text-danger">확인 필요</span>
    ) : step.state === 'optional' ? (
      <span className="text-[11.5px] font-semibold text-ink3">선택</span>
    ) : null;

  return (
    <section className="relative flex gap-4" aria-label={`${index}단계 ${step.title}`}>
      <div className="flex flex-col items-center">
        <StepDot index={index} state={step.state} />
        {!last && <span className={`mt-1 w-0.5 flex-1 rounded-full ${step.state === 'done' ? 'bg-teal' : 'bg-border'}`} />}
      </div>
      <div className={`flex min-w-0 flex-1 flex-col gap-3 ${last ? '' : 'pb-6'}`}>
        <div className="flex min-h-7 items-center gap-3">
          <h3 className="shrink-0 text-[14px] font-extrabold text-ink">{step.title}</h3>
          <div className="flex min-w-0 flex-1 items-center">{status}</div>
          {aside}
        </div>
        {children}
      </div>
    </section>
  );
}
