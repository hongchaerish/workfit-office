import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Home } from 'lucide-react';

/** 사업관리 화면 머리말 — 경로(사업관리 › 그룹 › 화면) · 제목 · 설명. */
export function BizHead({ group, title, desc }: { group: string; title: string; desc: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <nav className="flex items-center gap-1.5 text-[11px] text-ink3">
        <Home size={12} />
        <span className="font-bold text-teal">사업관리</span>
        <span>›</span>
        <span>{group}</span>
        <span>›</span>
        <span className="font-bold text-ink2">{title}</span>
      </nav>
      <h1 className="text-xl font-extrabold tracking-tight text-ink">{title}</h1>
      <p className="text-[12px] text-ink3">{desc}</p>
    </div>
  );
}

/** 목록 상자 — 제목 줄(왼쪽 제목, 오른쪽 건수) + 표 + 바닥(페이지). */
export function BizListCard({ title, count, footer, children }: { title: string; count: ReactNode; footer?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-col rounded-[10px] border border-border bg-panel shadow-[0_1px_2px_rgba(23,34,65,0.04)]">
      <div className="flex items-center justify-between px-4 py-3">
        <h2 className="text-[13px] font-extrabold text-ink">{title}</h2>
        <span className="text-[11px] font-bold text-teal">{count}</span>
      </div>
      <div className="overflow-x-auto">{children}</div>
      {footer && <div className="flex items-center justify-between border-t border-border px-4 py-2.5">{footer}</div>}
    </div>
  );
}

export const bizTh = 'border-y border-border bg-panel-alt px-3 py-2.5 text-[11px] font-bold whitespace-nowrap text-ink2';
export const bizTd = 'border-b border-border px-3 py-2.5 text-[12px] whitespace-nowrap';

export const PAGE_SIZES = [10, 20, 50];

/** 페이지 나누기 — n개씩 보기 + 범위 + 쪽 번호. */
export function BizPager({
  total,
  page,
  pageSize,
  onPage,
  onPageSize,
}: {
  total: number;
  page: number;
  pageSize: number;
  onPage: (p: number) => void;
  onPageSize: (n: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const btn = 'grid h-7 min-w-7 place-items-center rounded-md px-1.5 text-[11px] font-bold transition-colors disabled:opacity-40';
  return (
    <>
      <div className="flex items-center gap-2 text-[11px] text-ink3">
        <select
          value={pageSize}
          onChange={(e) => onPageSize(Number(e.target.value))}
          className="h-7 rounded-md border border-border-hi bg-panel px-2 text-[11px] text-ink2 outline-none"
        >
          {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}개씩 보기</option>)}
        </select>
        <span>{from}–{to} / {total}</span>
      </div>
      <div className="flex items-center gap-1">
        <button className={`${btn} text-ink3 hover:bg-panel-alt`} disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="이전 쪽">
          <ChevronLeft size={13} />
        </button>
        {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
          <button key={p} className={`${btn} ${p === page ? 'bg-teal text-white' : 'text-ink2 hover:bg-panel-alt'}`} onClick={() => onPage(p)}>
            {p}
          </button>
        ))}
        <button className={`${btn} text-ink3 hover:bg-panel-alt`} disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="다음 쪽">
          <ChevronRight size={13} />
        </button>
      </div>
    </>
  );
}

/** 표의 빈 줄/불러오는 중. */
export function BizEmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-12 text-center text-[12px] text-ink3">{children}</td>
    </tr>
  );
}
