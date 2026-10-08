import type { ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * 공통 버튼.
 *
 * 그룹웨어 화면들이 같은 용도의 버튼을 조금씩 다른 Tailwind 조합으로 60여 곳에 손으로
 * 적고 있었다. `hover:bg-ink3/8`과 `hover:bg-panel-alt`, `px-4`와 `px-5`,
 * `text-[11px]`과 `text-[11.5px]`처럼 의도한 차이가 아니라 그때그때 달라진 것들이라
 * 화면을 옮겨 다니면 미세하게 어긋나 보인다.
 *
 * 여기 없는 모양이 필요하면 `className`으로 덧붙이지 말고 variant를 늘린다. 덧붙이기
 * 시작하면 다시 제각각이 된다.
 */

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'accent'
  | 'warning'
  | 'danger'
  | 'dangerSolid'
  | 'ghost';
export type ButtonSize = 'sm' | 'md';

const VARIANT: Record<ButtonVariant, string> = {
  /** 화면당 하나. 그 화면에서 사용자가 할 주된 행동. */
  primary: 'bg-teal text-white hover:opacity-90',
  /** 취소·닫기·보조 행동. 테두리만 있는 형태. */
  secondary: 'border border-border text-ink2 hover:bg-ink3/8',
  /** 항목 추가처럼, 주된 행동은 아니지만 긍정적인 것. primary 옆에 같이 놓을 수 있다. */
  accent: 'border border-teal/30 bg-teal-soft/30 text-teal hover:bg-teal-soft/50',
  /** 마감·중단처럼 흐름을 되돌리기는 어렵지만 파괴적이지는 않은 것. */
  warning: 'border border-amber/30 bg-amber-soft/30 text-amber hover:bg-amber-soft/50',
  /** 삭제·해제를 '시작'하는 것. 누르면 보통 확인 단계가 따라온다. */
  danger: 'border border-danger/25 text-danger hover:bg-danger/8',
  /** 그 확인 단계 자체. 누르는 순간 사라지므로 가장 눈에 띄어야 한다. */
  dangerSolid: 'bg-danger text-white hover:opacity-90',
  /** 목록 안 링크처럼 배경도 테두리도 없는 것. */
  ghost: 'text-ink2 hover:bg-ink3/8',
};

const SIZE: Record<ButtonSize, string> = {
  /** 목록 행·카드 안. */
  sm: 'rounded-md px-2.5 py-1.5 text-[10px]',
  /** 툴바·모달 푸터. */
  md: 'rounded-lg px-4 py-2 text-[11px]',
};

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** 폭을 부모에 맞춘다. 모달 안 전체폭 버튼에 쓴다. */
  block?: boolean;
  children: ReactNode;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  block = false,
  type = 'button',
  children,
  ...rest
}: Props) {
  return (
    <button
      {...rest}
      type={type}
      className={[
        // 아이콘(svg는 기본 block)과 글자를 한 줄에 나란히 두고, 화면 배율을 키워 폭이 좁아져도 갈라지지 않게 한다
        'inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        VARIANT[variant],
        SIZE[size],
        block ? 'w-full' : '',
      ].filter(Boolean).join(' ')}
    >
      {children}
    </button>
  );
}
