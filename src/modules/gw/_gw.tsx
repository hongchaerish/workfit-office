import type { ReactNode } from 'react';
import type { DocStatus, StepDecision, StepKind } from '@/domain/approvalDoc/schema';
import { MenuGlyph } from '@/shared/ui/MenuGlyph';

/**
 * 그룹웨어 공통 UI — 전자결재/휴가 화면이 공유하는 배지·아이콘·포맷터.
 * OrgChartScreen 과 동일한 전역 토큰(ink/panel/teal…)을 사용해 톤을 맞춘다.
 * ([[wireframe-source-of-truth]] 기존 마스터-디테일 디자인 언어 재사용)
 */

/** 화면 상단 브레드크럼 + 타이틀(그룹웨어 / {name}) 및 목적/설명. */
export function GwHead({ icon, name, desc, right }: { icon: string; name: string; desc?: string; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 min-w-0">
      <div>
        <div className="mb-1 text-xs font-medium text-ink3">그룹웨어 <span className="px-1">/</span> {name}</div>
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-teal-soft text-teal">
            <MenuGlyph glyph={icon} size={20} className="text-teal" />
          </span>
          <div>
            <h1 className="text-xl font-bold text-ink">{name}</h1>
            {desc && <p className="mt-0.5 text-xs text-ink3 leading-relaxed">{desc}</p>}
          </div>
        </div>
      </div>
      {right}
    </div>
  );
}

/** 좌측 세부 메뉴 항목([[GwSideNav]]). */
export interface GwNavItem {
  id: string;
  /** 생략하면 아이콘 칸 없이 라벨만 그린다. 사람 이름처럼 아이콘이 의미를 못 더할 때 쓴다. */
  icon?: string;
  label: string;
  /** `참여`·`대기`처럼 주의를 끄는 짧은 알림. */
  badge?: string;
  badgeTone?: 'teal' | 'amber';
  disabled?: boolean;
  /** 비활성 이유 같은 툴팁. */
  hint?: string;
}

/**
 * 좌측 세부 메뉴 카드 — 게시판·조직도의 마스터-디테일 디자인 언어.
 * 화면 상단 가로 탭 대신 이 카드를 쓰면 다른 그룹웨어 화면과 톤이 맞는다.
 * 메뉴 없이 `children`만 채우면 일반 사이드 카드(달력 보조 패널 등)로도 쓴다.
 */
export function GwSideNav({ title, desc, items, activeId, onSelect, filter, scrollItems, children }: {
  title: string;
  desc?: string;
  items?: GwNavItem[];
  activeId?: string;
  onSelect?: (id: string) => void;
  /** 목록 위에 놓을 검색·필터 UI. 항목이 많아 눈으로 찾기 어려운 화면에서 쓴다. */
  filter?: ReactNode;
  /** 항목이 많을 때 카드 높이를 묶고 목록만 스크롤한다. 없으면 화면 아래로 계속 늘어난다. */
  scrollItems?: boolean;
  children?: ReactNode;
}) {
  return (
    <aside className="flex flex-col gap-4 rounded-xl border border-border bg-panel p-4 shadow-sm">
      <div>
        <h2 className="text-sm font-extrabold text-navy">{title}</h2>
        {desc && <p className="mt-1 text-[11px] text-ink3">{desc}</p>}
      </div>
      {filter}
      {items && items.length > 0 && (
        <nav className={`flex flex-col gap-1 ${scrollItems ? 'content-scroll max-h-[calc(52vh/var(--font-scale,1))] min-h-0 overflow-y-auto pr-0.5' : ''}`}>
          {items.map((item) => {
            const active = item.id === activeId;
            return (
              <button
                key={item.id}
                type="button"
                disabled={item.disabled}
                title={item.hint}
                onClick={() => onSelect?.(item.id)}
                className={`flex w-full items-center gap-3 rounded-lg px-3.5 py-3 text-left text-[12.5px] font-bold transition-all ${
                  active
                    ? 'bg-teal text-white shadow-xs'
                    : item.disabled
                      ? 'cursor-not-allowed text-ink3 opacity-45'
                      : 'text-ink2 hover:bg-panel-alt hover:text-ink'
                }`}
              >
                {item.icon && (
                  <span className="shrink-0 flex items-center justify-center">
                    <MenuGlyph glyph={item.icon} size={16} className={active ? 'text-white' : 'text-teal'} />
                  </span>
                )}
                <span className="flex-1 truncate">{item.label}</span>
                {item.badge && (
                  <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[8px] font-bold ${
                    active ? 'bg-white/25 text-white' : item.badgeTone === 'amber' ? 'bg-amber text-white' : 'bg-teal text-white'
                  }`}>
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      )}
      {children}
    </aside>
  );
}

/** 좌측 세부 메뉴 + 우측 본문 2단 배치. 좁은 화면에서는 위아래로 쌓인다. */
export function GwSplit({ nav, children }: { nav: ReactNode; children: ReactNode }) {
  return (
    <div className="mt-5 grid items-start gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
      {nav}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

const STATUS_TONE: Record<DocStatus, string> = {
  임시저장: 'bg-ink3/12 text-ink2',
  진행중: 'bg-blue/12 text-blue',
  완료: 'bg-teal/15 text-teal',
  반려: 'bg-red-500/12 text-red-500',
  '긴급 조치 사후 검토 반려': 'bg-rose-600 text-white font-extrabold',
  회수: 'bg-amber/15 text-amber',
  삭제: 'bg-red-500/12 text-red-500',
  시행대기: 'bg-teal/15 text-teal',
  시행반송: 'bg-red-500/12 text-red-500',
  취소완료: 'bg-rose-500/12 text-rose-600',
};

export function StatusBadge({ status, label, className }: { status: DocStatus; label?: string; className?: string }) {
  return (
    <span className={`inline-block shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold ${className || STATUS_TONE[status]}`}>
      {label || status}
    </span>
  );
}

const DECISION_TONE: Record<StepDecision, string> = {
  대기: 'bg-amber/15 text-amber',
  승인: 'bg-teal/15 text-teal',
  반려: 'bg-red-500/12 text-red-500',
  보류: 'bg-ink3/15 text-ink2',
};

export function DecisionBadge({ decision }: { decision: StepDecision }) {
  return (
    <span className={`inline-block shrink-0 rounded px-1.5 py-px text-[9.5px] font-bold ${DECISION_TONE[decision]}`}>
      {decision}
    </span>
  );
}

/** 결재 구분 라벨 색(참조는 약하게, 전결은 강조). */
export const KIND_TONE: Record<StepKind, string> = {
  결재: 'text-ink2',
  합의: 'text-purple-600',
  참조: 'text-ink3',
  전결: 'text-teal',
  대결: 'text-amber',
};

/** 기본 4종 아이콘 폴백(커스텀 서식은 approvalForms.icon 사용). */
export const DOC_TYPE_ICON: Record<string, string> = {
  기안: '📝',
  품의: '📑',
  지출결의: '💳',
  휴가: '🏖️',
};

/** 원화 포맷. */
export const won = (n: number | null | undefined) => (n == null ? '—' : '₩' + n.toLocaleString());

/** ISO → 로컬 간략 표기(MM.DD HH:mm). */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${mm}.${dd} ${hh}:${mi}`;
}
