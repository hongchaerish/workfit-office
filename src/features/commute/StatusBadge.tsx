import { STATUS_TONES, type StatusChip } from '@/domain/commute/statusDisplay';

/**
 * 근태 상태 배지 — [[statusDisplay]] 정의 그대로 그린다.
 * `compact` 는 근태표 칸처럼 좁은 곳(짧은 표기), 아니면 전체 이름.
 */
export function StatusBadge({ chip, compact = false, className = '' }: { chip: StatusChip; compact?: boolean; className?: string }) {
  const tone = STATUS_TONES[chip.kind];
  if (chip.kind === 'normal' && compact) {
    return (
      <span className={`inline-flex items-center justify-center text-[10px] font-bold ${tone.text} ${className}`} title={chip.label}>
        ●
      </span>
    );
  }
  return (
    <span
      title={chip.label}
      className={`inline-flex items-center justify-center whitespace-nowrap rounded border font-bold ${
        compact ? 'px-1 py-px text-[9px]' : 'px-1.5 py-0.5 text-[10px]'
      } ${tone.badge} ${className}`}
    >
      {compact ? chip.short : chip.label}
    </span>
  );
}

/** 배지 여러 개(겹친 상태). 비었으면 `empty` 를 그린다. */
export function StatusBadges({
  chips,
  compact = false,
  empty = null,
  className = '',
}: {
  chips: StatusChip[];
  compact?: boolean;
  empty?: React.ReactNode;
  className?: string;
}) {
  if (chips.length === 0) return <>{empty}</>;
  return (
    <span className={`inline-flex flex-wrap items-center justify-center gap-0.5 ${className}`}>
      {chips.map((c, i) => (
        <StatusBadge key={`${c.kind}-${i}`} chip={c} compact={compact} />
      ))}
    </span>
  );
}
