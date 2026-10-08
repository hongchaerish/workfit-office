import { useEffect, useMemo, useRef, useState } from 'react';
import { LayoutTemplate, Minus, MousePointer2, Pencil, Plus, Search, Square, Trash2, Type as TypeIcon, Armchair, X } from 'lucide-react';
import { useAuth } from '@/app/auth/AuthProvider';
import type { User } from '@/domain/user/schema';
import { SEAT_BLOCK_KIND_LABELS, type SeatBlock, type SeatBlockKind, type SeatGrid, type SeatLayout } from '@/domain/seatLayout/schema';
import { addBlock, assignSeat, canPlace, placeBlock, rectFromCells, removeBlock, resizeGrid, updateBlock, type CellRect } from '@/domain/seatLayout/engine';
import { buildHqTemplateGrid } from '@/domain/seatLayout/template';
import { USER_PRESENCE_META, USER_PRESENCE_STATUSES, type UserPresenceStatus } from '@/domain/userPresence/schema';
import { useRemoveSeatLayout, useSaveSeatLayout, useSeatLayouts } from '@/features/seatLayout/useSeatLayouts';
import { useAllUserPresences } from '@/features/userPresence/useUserPresence';
import { usePermission } from '@/features/auth/usePermission';
import { Button } from '@/shared/ui/Button';

/** 한 칸 크기(px, 확대 100% 기준) — 엑셀 한 열 = 4칸, 한 행 = 2칸 */
const UNIT_W = 36;
const UNIT_H = 28;
/** 배치도 확대 단계(%) — 기본은 '맞춤'(화면 폭에 맞춘 배율) */
const ZOOM_STEPS = [50, 60, 75, 90, 100, 125, 150];
const FIT_MIN = 50;

type Tool = 'select' | SeatBlockKind;
const TOOLS: Array<{ key: Tool; label: string; icon: React.ReactNode; hint: string }> = [
  { key: 'select', label: '선택', icon: <MousePointer2 size={13} />, hint: '블록을 눌러 고르고, 끌어서 옮기거나 오른쪽 아래 모서리로 크기를 바꿉니다' },
  { key: 'seat', label: '좌석', icon: <Armchair size={13} />, hint: '빈 칸을 끌어서 좌석을 그립니다' },
  { key: 'room', label: '공간', icon: <Square size={13} />, hint: '빈 칸을 끌어서 회의실·탕비실 같은 공간을 그립니다' },
  { key: 'label', label: '글자', icon: <TypeIcon size={13} />, hint: '빈 칸을 끌어서 테두리 없는 글자(◀▶ 등)를 넣습니다' },
];

type Drag =
  | { type: 'draw'; kind: SeatBlockKind; start: { col: number; row: number }; rect: CellRect }
  | { type: 'move'; id: string; start: { col: number; row: number }; origin: CellRect; rect: CellRect; moved: boolean }
  | { type: 'resize'; id: string; origin: CellRect; rect: CellRect };

/**
 * 조직도 > 좌석배치도 — 엑셀처럼 격자 위에 자리를 그린다.
 * - 모두: 좌석마다 이름·직급, 부서, 근태(실시간 근무상태). 누르면 프로필. 찾기·확대.
 * - 운영자·임원: [배치 편집] — 좌석·공간·글자 블록 그리기, 옮기기, 크기 바꾸기, 사람 지정, 격자 크기, 본사 템플릿.
 */
export function SeatLayoutView({
  users,
  onSelectUserId,
}: {
  users: User[];
  onSelectUserId: (id: string) => void;
}) {
  const { user: me } = useAuth();
  const { isOperator, isExecutive } = usePermission();
  const canEdit = isOperator || isExecutive;

  const layoutsQuery = useSeatLayouts();
  const layouts = layoutsQuery.data ?? [];
  const saveM = useSaveSeatLayout();
  const removeM = useRemoveSeatLayout();
  const presences = useAllUserPresences();

  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState<SeatLayout | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [keyword, setKeyword] = useState('');
  /** 'fit' 이면 배치도 영역 폭에 맞춘다(기본) */
  const [zoomSetting, setZoomSetting] = useState<number | 'fit'>('fit');
  const [areaWidth, setAreaWidth] = useState(0);
  const [error, setError] = useState('');
  const [drag, setDrag] = useState<Drag | null>(null);

  const editing = draft !== null;
  const active = layouts.find((l) => l.id === activeId) ?? layouts[0] ?? null;
  const shown = draft ?? active;
  const grid = shown?.grid ?? null;

  /** 화면 폭에 맞춘 배율 — 배치도 영역 폭(안쪽 여백 제외) ÷ 배치도 원래 폭 */
  const fitZoom = grid && areaWidth > 0 ? Math.max(FIT_MIN, Math.min(100, Math.floor(((areaWidth - 24) / (grid.cols * UNIT_W + 1)) * 100))) : 100;
  const zoom = zoomSetting === 'fit' ? fitZoom : zoomSetting;
  const stepZoom = (dir: 1 | -1) => {
    const next = dir > 0 ? ZOOM_STEPS.find((z) => z > zoom) : [...ZOOM_STEPS].reverse().find((z) => z < zoom);
    if (next) setZoomSetting(next);
  };
  const areaObserverRef = useRef<ResizeObserver | null>(null);
  const areaRef = (el: HTMLDivElement | null) => {
    areaObserverRef.current?.disconnect();
    if (!el) return;
    setAreaWidth(el.clientWidth);
    areaObserverRef.current = new ResizeObserver(() => setAreaWidth(el.clientWidth));
    areaObserverRef.current.observe(el);
  };

  const userMap = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const statusOf = (userId: string): UserPresenceStatus => presences[userId]?.status ?? 'OFFLINE';

  /** 이 배치도에 앉은 사람들의 근태 집계 */
  const statusCounts = useMemo(() => {
    const counts = new Map<UserPresenceStatus, number>();
    for (const b of grid?.blocks ?? []) {
      if (!b.userId || !userMap.has(b.userId)) continue;
      const st = presences[b.userId]?.status ?? 'OFFLINE';
      counts.set(st, (counts.get(st) ?? 0) + 1);
    }
    return counts;
  }, [grid, userMap, presences]);

  const kw = keyword.trim().toLowerCase();
  const matches = (u: User | undefined) =>
    Boolean(u && (u.name.toLowerCase().includes(kw) || u.dept.toLowerCase().includes(kw) || (u.position ?? '').toLowerCase().includes(kw)));

  const setGrid = (fn: (g: SeatGrid) => SeatGrid) => setDraft((d) => (d ? { ...d, grid: fn(d.grid) } : d));

  // ── 편집 시작·저장 ──
  const startEdit = () => {
    if (!active) return;
    setDraft(structuredClone(active));
    setSelectedId(null);
    setTool('select');
    setError('');
  };
  const startNewLayout = () => {
    setDraft({
      id: `SL-${Date.now()}`,
      name: layouts.length ? `배치도 ${layouts.length + 1}` : '본사',
      grid: { cols: 33, rows: 17, blocks: [] },
      sortOrder: layouts.length ? Math.max(...layouts.map((l) => l.sortOrder)) + 1 : 0,
      updatedBy: '',
      updatedAt: '',
    });
    setSelectedId(null);
    setTool('seat');
    setError('');
  };
  const cancelEdit = () => {
    setDraft(null);
    setSelectedId(null);
    setDrag(null);
    setError('');
  };
  const save = async () => {
    if (!draft) return;
    if (!draft.name.trim()) return setError('배치도 이름을 입력하세요.');
    setError('');
    try {
      await saveM.mutateAsync({ ...draft, name: draft.name.trim(), updatedBy: me?.id ?? '', updatedAt: new Date().toISOString() });
      setActiveId(draft.id);
      cancelEdit();
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장하지 못했습니다.');
    }
  };
  const removeLayout = async () => {
    if (!draft) return;
    if (!layouts.some((l) => l.id === draft.id)) return cancelEdit();
    if (!window.confirm(`'${draft.name}' 배치도를 삭제하시겠습니까? 좌석 정보도 함께 삭제됩니다.`)) return;
    try {
      await removeM.mutateAsync(draft.id);
      setActiveId(null);
      cancelEdit();
    } catch (e) {
      setError(e instanceof Error ? e.message : '삭제하지 못했습니다.');
    }
  };
  const applyTemplate = () => {
    if (!draft) return;
    if (draft.grid.blocks.length && !window.confirm('지금 그린 블록을 모두 지우고 본사 배치 템플릿으로 바꿀까요?')) return;
    setDraft({ ...draft, grid: buildHqTemplateGrid() });
    setSelectedId(null);
    setTool('select');
  };
  const changeGridSize = (dc: number, dr: number) => {
    if (!draft) return;
    const next = resizeGrid(draft.grid, draft.grid.cols + dc, draft.grid.rows + dr);
    if (!next) return setError('그 크기로 줄이면 밖으로 나가는 블록이 있습니다. 블록을 먼저 옮기거나 지우세요.');
    setError('');
    setDraft({ ...draft, grid: next });
  };

  // Delete 키로 고른 블록 지우기(입력칸에서는 제외)
  useEffect(() => {
    if (!editing || !selectedId) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        setGrid((g) => removeBlock(g, selectedId));
        setSelectedId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, selectedId]);

  useEffect(() => setSelectedId(null), [shown?.id]);

  // ── 격자 위 포인터 ──
  const canvasRef = useRef<HTMLDivElement>(null);
  const cellAt = (clientX: number, clientY: number) => {
    const r = canvasRef.current!.getBoundingClientRect();
    const g = grid!;
    const col = Math.min(g.cols - 1, Math.max(0, Math.floor(((clientX - r.left) / r.width) * g.cols)));
    const row = Math.min(g.rows - 1, Math.max(0, Math.floor(((clientY - r.top) / r.height) * g.rows)));
    return { col, row };
  };

  const onCanvasPointerDown = (e: React.PointerEvent) => {
    if (!editing || e.button !== 0 || e.target !== e.currentTarget) return;
    setSelectedId(null);
    if (tool === 'select') return;
    const start = cellAt(e.clientX, e.clientY);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ type: 'draw', kind: tool, start, rect: { ...start, colSpan: 1, rowSpan: 1 } });
  };
  const onBlockPointerDown = (e: React.PointerEvent, b: SeatBlock) => {
    if (!editing || e.button !== 0) return;
    e.stopPropagation();
    setSelectedId(b.id);
    canvasRef.current?.setPointerCapture(e.pointerId);
    const origin = { col: b.col, row: b.row, colSpan: b.colSpan, rowSpan: b.rowSpan };
    setDrag({ type: 'move', id: b.id, start: cellAt(e.clientX, e.clientY), origin, rect: origin, moved: false });
  };
  const onResizePointerDown = (e: React.PointerEvent, b: SeatBlock) => {
    e.stopPropagation();
    canvasRef.current?.setPointerCapture(e.pointerId);
    const origin = { col: b.col, row: b.row, colSpan: b.colSpan, rowSpan: b.rowSpan };
    setDrag({ type: 'resize', id: b.id, origin, rect: origin });
  };
  const onCanvasPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const cell = cellAt(e.clientX, e.clientY);
    if (drag.type === 'draw') {
      setDrag({ ...drag, rect: rectFromCells(drag.start, cell) });
    } else if (drag.type === 'move') {
      const dc = cell.col - drag.start.col;
      const dr = cell.row - drag.start.row;
      setDrag({ ...drag, rect: { ...drag.origin, col: drag.origin.col + dc, row: drag.origin.row + dr }, moved: drag.moved || dc !== 0 || dr !== 0 });
    } else {
      setDrag({
        ...drag,
        rect: { ...drag.origin, colSpan: Math.max(1, cell.col - drag.origin.col + 1), rowSpan: Math.max(1, cell.row - drag.origin.row + 1) },
      });
    }
  };
  const onCanvasPointerUp = () => {
    if (!drag || !draft) return setDrag(null);
    if (drag.type === 'draw') {
      const added = addBlock(draft.grid, drag.rect, drag.kind);
      if (added) {
        setDraft({ ...draft, grid: added.grid });
        setSelectedId(added.block.id);
      }
    } else if (drag.type === 'resize' || drag.moved) {
      setGrid((g) => placeBlock(g, drag.id, drag.rect));
    }
    setDrag(null);
  };

  const dragValid = drag && grid ? canPlace(grid, drag.rect, drag.type === 'draw' ? undefined : drag.id) : true;
  const selected = draft?.grid.blocks.find((b) => b.id === selectedId) ?? null;
  const uw = (UNIT_W * zoom) / 100;
  const uh = (UNIT_H * zoom) / 100;

  if (layoutsQuery.isLoading) {
    return <div className="grid h-60 place-items-center text-[12px] font-semibold text-ink3">좌석배치도를 불러오는 중…</div>;
  }

  return (
    <div className="space-y-3">
      {/* ── 상단 도구 막대 ── */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-panel p-2.5 shadow-xs">
        {editing ? (
          <input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value.slice(0, 30) })}
            placeholder="배치도 이름 (예: 본사 7층)"
            aria-label="배치도 이름"
            className="h-8 w-44 rounded-lg border border-border-hi bg-panel px-2.5 text-[12px] font-bold text-ink outline-none focus:border-teal"
          />
        ) : (
          <div className="flex flex-wrap items-center gap-1">
            {layouts.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => setActiveId(l.id)}
                className={`rounded-lg px-3 py-1.5 text-[11.5px] font-bold transition-colors ${l.id === active?.id ? 'bg-teal text-white' : 'text-ink3 hover:bg-panel-alt hover:text-ink'}`}
              >
                {l.name}
              </button>
            ))}
          </div>
        )}

        {shown && !editing && (
          <div className="flex flex-wrap items-center gap-2.5 border-l border-border pl-3 text-[10.5px] font-semibold text-ink3">
            {USER_PRESENCE_STATUSES.map((st) => {
              const n = statusCounts.get(st) ?? 0;
              if (!n) return null;
              const meta = USER_PRESENCE_META[st];
              return (
                <span key={st} className="inline-flex items-center gap-1">
                  <span className={`h-2 w-2 rounded-full ${meta.dotColor}`} />
                  {meta.label} <b className="text-ink2">{n}</b>
                </span>
              );
            })}
          </div>
        )}

        {editing && (
          <div className="flex flex-wrap items-center gap-1 border-l border-border pl-2">
            {TOOLS.map((t) => (
              <button
                key={t.key}
                type="button"
                title={t.hint}
                onClick={() => setTool(t.key)}
                className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition-colors ${tool === t.key ? 'bg-teal text-white' : 'text-ink2 hover:bg-panel-alt'}`}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {!editing && shown && (
            <label className="relative">
              <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink3" />
              <input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="이름·부서 찾기"
                className="h-8 w-40 rounded-lg border border-border-hi bg-panel pl-7 pr-2 text-[11.5px] text-ink outline-none focus:border-teal"
              />
            </label>
          )}
          {editing && grid && (
            <div className="flex items-center gap-1 text-[10.5px] font-semibold text-ink3">
              <GridStepper label="가로" value={grid.cols} onMinus={() => changeGridSize(-1, 0)} onPlus={() => changeGridSize(1, 0)} />
              <GridStepper label="세로" value={grid.rows} onMinus={() => changeGridSize(0, -1)} onPlus={() => changeGridSize(0, 1)} />
            </div>
          )}
          {shown && (
            <div className="flex items-center rounded-lg border border-border">
              <button type="button" aria-label="축소" onClick={() => stepZoom(-1)} className="grid h-8 w-7 place-items-center text-ink3 hover:text-ink"><Minus size={13} /></button>
              <button
                type="button"
                onClick={() => setZoomSetting('fit')}
                title="화면 폭에 맞추기"
                className={`min-w-[52px] px-1 text-center text-[11px] font-bold ${zoomSetting === 'fit' ? 'text-teal' : 'text-ink2 hover:text-teal'}`}
              >
                {zoomSetting === 'fit' ? `맞춤 ${zoom}%` : `${zoom}%`}
              </button>
              <button type="button" aria-label="확대" onClick={() => stepZoom(1)} className="grid h-8 w-7 place-items-center text-ink3 hover:text-ink"><Plus size={13} /></button>
            </div>
          )}
          {canEdit && !editing && (
            <>
              {active && <Button size="sm" onClick={startEdit}><Pencil size={13} />배치 편집</Button>}
              <Button size="sm" onClick={startNewLayout}><Plus size={13} />배치도 추가</Button>
            </>
          )}
          {editing && (
            <>
              <Button size="sm" onClick={applyTemplate} title="2026-10 본사 좌석 배치표 모양으로 블록을 채웁니다(좌석은 모두 공석 — 불러온 뒤 좌석을 눌러 사람 지정)">
                <LayoutTemplate size={13} />본사 템플릿
              </Button>
              <Button size="sm" variant="danger" onClick={() => void removeLayout()} disabled={saveM.isPending || removeM.isPending}>
                <Trash2 size={13} />배치도 삭제
              </Button>
              <Button size="sm" onClick={cancelEdit} disabled={saveM.isPending}>취소</Button>
              <Button size="sm" variant="primary" onClick={() => void save()} disabled={saveM.isPending}>{saveM.isPending ? '저장 중…' : '저장'}</Button>
            </>
          )}
        </div>
      </div>

      {editing && <p className="px-1 text-[11px] text-ink3">{TOOLS.find((t) => t.key === tool)?.hint} · 고른 블록은 Delete 로 지웁니다.</p>}
      {error && <div role="alert" className="rounded-lg border border-danger/20 bg-danger/5 px-3 py-2 text-[11px] font-semibold text-danger">{error}</div>}

      {/* ── 본문 ── */}
      {!shown || !grid ? (
        <div className="grid h-60 place-items-center rounded-xl border border-dashed border-border bg-panel text-center text-[12px] text-ink3">
          <div>
            등록된 좌석배치도가 없습니다.
            {canEdit && <div className="mt-2"><Button size="sm" variant="primary" onClick={startNewLayout}><Plus size={13} />첫 배치도 만들기</Button></div>}
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3">
          {/*
            [contain:inline-size] — 배치도가 넓어도 페이지 전체를 가로로 밀지 않고 이 안에서만 스크롤한다
            (셸이 내용 폭에 맞춰 늘어나는 구조라 overflow 만으로는 막히지 않는다)
          */}
          <div ref={areaRef} className="min-w-0 flex-1 overflow-auto rounded-xl border border-border bg-panel p-3 [contain:inline-size]">
            {editing && grid.blocks.length === 0 && (
              <div className="mb-2 flex items-center gap-2 rounded-lg bg-teal-soft/30 px-3 py-2 text-[11px] text-ink2">
                빈 배치도입니다. 칸을 끌어서 자리를 그리거나
                <Button size="sm" onClick={applyTemplate}><LayoutTemplate size={13} />본사 템플릿 불러오기</Button>
              </div>
            )}
            <div
              ref={canvasRef}
              onPointerDown={onCanvasPointerDown}
              onPointerMove={onCanvasPointerMove}
              onPointerUp={onCanvasPointerUp}
              className={`relative select-none ${editing ? (tool === 'select' ? 'cursor-default' : 'cursor-crosshair') : ''}`}
              style={{
                width: grid.cols * uw + 1,
                height: grid.rows * uh + 1,
                // 편집 중에는 칸 눈금을 보인다
                backgroundImage: editing
                  ? 'linear-gradient(to right, rgb(148 163 184 / 0.25) 1px, transparent 1px), linear-gradient(to bottom, rgb(148 163 184 / 0.25) 1px, transparent 1px)'
                  : undefined,
                backgroundSize: editing ? `${uw}px ${uh}px` : undefined,
              }}
            >
              {grid.blocks.map((b) => {
                const u = b.userId ? userMap.get(b.userId) : undefined;
                const moving = drag && drag.type !== 'draw' && drag.id === b.id;
                const rect = moving ? drag.rect : b;
                return (
                  <SeatBlockBox
                    key={b.id}
                    block={b}
                    rect={rect}
                    uw={uw}
                    uh={uh}
                    zoom={zoom}
                    user={u}
                    status={u ? statusOf(u.id) : null}
                    message={u ? presences[u.id]?.message ?? '' : ''}
                    editing={editing}
                    selected={b.id === selectedId}
                    invalid={Boolean(moving && !dragValid)}
                    dimmed={!editing && Boolean(kw) && !matches(u)}
                    highlighted={!editing && Boolean(kw) && matches(u)}
                    onPointerDown={(e) => onBlockPointerDown(e, b)}
                    onResizePointerDown={(e) => onResizePointerDown(e, b)}
                    onOpenProfile={() => u && onSelectUserId(u.id)}
                  />
                );
              })}
              {drag?.type === 'draw' && (
                <div
                  className={`pointer-events-none absolute border-2 border-dashed ${dragValid ? 'border-teal bg-teal-soft/30' : 'border-danger bg-danger/10'}`}
                  style={{ left: drag.rect.col * uw, top: drag.rect.row * uh, width: drag.rect.colSpan * uw + 1, height: drag.rect.rowSpan * uh + 1 }}
                />
              )}
            </div>
          </div>

          {editing && selected && (
            <BlockEditorPanel
              block={selected}
              blocks={draft.grid.blocks}
              users={users}
              onKind={(kind) => setGrid((g) => updateBlock(g, selected.id, { kind }))}
              onLabel={(label) => setGrid((g) => updateBlock(g, selected.id, { label }))}
              onAssign={(userId) => setGrid((g) => assignSeat(g, selected.id, userId))}
              onRemove={() => { setGrid((g) => removeBlock(g, selected.id)); setSelectedId(null); }}
              onClose={() => setSelectedId(null)}
            />
          )}
        </div>
      )}
    </div>
  );
}

function GridStepper({ label, value, onMinus, onPlus }: { label: string; value: number; onMinus: () => void; onPlus: () => void }) {
  return (
    <span className="flex items-center rounded-lg border border-border">
      <span className="px-1.5">{label}</span>
      <button type="button" aria-label={`${label} 줄이기`} onClick={onMinus} className="grid h-7 w-6 place-items-center hover:text-ink"><Minus size={12} /></button>
      <span className="w-6 text-center font-bold text-ink2">{value}</span>
      <button type="button" aria-label={`${label} 늘리기`} onClick={onPlus} className="grid h-7 w-6 place-items-center hover:text-ink"><Plus size={12} /></button>
    </span>
  );
}

/** 격자 위 블록 한 개 — 좌석(이름·직급, 부서, 근태) / 공간 / 글자 */
function SeatBlockBox({
  block,
  rect,
  uw,
  uh,
  zoom,
  user,
  status,
  message,
  editing,
  selected,
  invalid,
  dimmed,
  highlighted,
  onPointerDown,
  onResizePointerDown,
  onOpenProfile,
}: {
  block: SeatBlock;
  rect: CellRect;
  uw: number;
  uh: number;
  zoom: number;
  user: User | undefined;
  status: UserPresenceStatus | null;
  message: string;
  editing: boolean;
  selected: boolean;
  invalid: boolean;
  dimmed: boolean;
  highlighted: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onResizePointerDown: (e: React.PointerEvent) => void;
  onOpenProfile: () => void;
}) {
  const meta = status ? USER_PRESENCE_META[status] : null;
  const scale = zoom / 100;
  const isSeat = block.kind === 'seat';
  const title = isSeat
    ? user
      ? `${user.name}${user.position ? ` ${user.position}` : ''} · ${user.dept}${meta ? ` · ${meta.label}${message ? ` (${message})` : ''}` : ''}`
      : block.label || '공석'
    : block.label;

  // 맞닿은 블록의 테두리가 한 줄로 겹치도록 폭·높이에 1px 을 더한다
  const style: React.CSSProperties = {
    left: rect.col * uw,
    top: rect.row * uh,
    width: rect.colSpan * uw + 1,
    height: rect.rowSpan * uh + 1,
    fontSize: `${11 * scale}px`,
  };

  const box =
    block.kind === 'label'
      ? 'border border-transparent'
      : block.kind === 'room'
        ? 'border border-slate-500/70 bg-slate-100/80 dark:bg-slate-800/40'
        : 'border border-slate-500/70 bg-panel';

  return (
    <div
      onPointerDown={onPointerDown}
      onClick={(e) => {
        e.stopPropagation();
        if (!editing && isSeat && user) onOpenProfile();
      }}
      title={title}
      style={style}
      className={`absolute flex flex-col items-center justify-center overflow-hidden px-1 text-center leading-tight transition-opacity ${box} ${
        editing ? 'cursor-move' : isSeat && user ? 'cursor-pointer hover:bg-teal-soft/20' : ''
      } ${selected ? 'z-10 outline outline-2 outline-teal' : highlighted ? 'z-10 outline outline-2 outline-amber-400' : ''} ${
        invalid ? 'z-10 outline outline-2 outline-danger' : ''
      } ${dimmed ? 'opacity-30' : ''}`}
    >
      {isSeat ? (
        user ? (
          <>
            <span className="max-w-full truncate font-extrabold text-ink">
              {user.name}
              {user.position && <span className="ml-0.5 font-semibold text-ink2">{user.position}</span>}
            </span>
            <span className="max-w-full truncate text-ink3" style={{ fontSize: `${9.5 * scale}px` }}>{user.dept}</span>
            {meta && (
              <span className={`mt-px inline-flex max-w-full items-center gap-1 font-bold ${meta.textColor}`} style={{ fontSize: `${9 * scale}px` }}>
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta.dotColor}`} />
                <span className="truncate">{meta.label}</span>
              </span>
            )}
          </>
        ) : (
          <span className="whitespace-pre-line text-ink3">{block.label || '공석'}</span>
        )
      ) : (
        <span className={`whitespace-pre-line ${block.kind === 'room' ? 'font-semibold text-ink2' : 'text-ink2'}`}>{block.label}</span>
      )}
      {editing && selected && (
        <span
          role="separator"
          aria-label="크기 조절"
          onPointerDown={onResizePointerDown}
          className="absolute bottom-0 right-0 h-2.5 w-2.5 cursor-se-resize bg-teal"
        />
      )}
    </div>
  );
}

/** 편집 중 고른 블록 — 종류·글자·사람·삭제 */
function BlockEditorPanel({
  block,
  blocks,
  users,
  onKind,
  onLabel,
  onAssign,
  onRemove,
  onClose,
}: {
  block: SeatBlock;
  blocks: SeatBlock[];
  users: User[];
  onKind: (kind: SeatBlockKind) => void;
  onLabel: (label: string) => void;
  onAssign: (userId: string | null) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const seatOf = useMemo(() => new Map(blocks.filter((b) => b.userId).map((b) => [b.userId!, b])), [blocks]);
  const current = block.userId ? users.find((u) => u.id === block.userId) : undefined;
  const kw = q.trim().toLowerCase();
  const candidates = users
    .filter((u) => !kw || u.name.toLowerCase().includes(kw) || u.dept.toLowerCase().includes(kw) || (u.position ?? '').toLowerCase().includes(kw))
    // 아직 자리가 없는 사람을 먼저
    .sort((a, b) => Number(seatOf.has(a.id)) - Number(seatOf.has(b.id)) || a.dept.localeCompare(b.dept, 'ko') || a.name.localeCompare(b.name, 'ko'));

  return (
    <aside className="sticky top-[calc(var(--shell-top)+12px)] flex max-h-[calc(80vh/var(--font-scale,1))] w-[260px] shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-panel shadow-md">
      <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
        <span className="text-[12.5px] font-extrabold text-ink">
          {SEAT_BLOCK_KIND_LABELS[block.kind]} 블록
          <span className="ml-1.5 text-[10.5px] font-semibold text-ink3">가로 {block.colSpan}칸 × 세로 {block.rowSpan}칸</span>
        </span>
        <button type="button" onClick={onClose} aria-label="닫기" className="text-ink3 hover:text-ink"><X size={15} /></button>
      </div>
      <div className="space-y-2 border-b border-border px-3 py-2.5 text-[11px]">
        <div className="flex gap-1">
          {(Object.keys(SEAT_BLOCK_KIND_LABELS) as SeatBlockKind[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => onKind(k)}
              className={`flex-1 rounded-md py-1 text-[11px] font-bold ${block.kind === k ? 'bg-teal text-white' : 'bg-panel-alt text-ink2 hover:bg-border/40'}`}
            >
              {SEAT_BLOCK_KIND_LABELS[k]}
            </button>
          ))}
        </div>
        <label className="block">
          <span className="text-ink3">{block.kind === 'seat' ? '메모 (빈 좌석에 보임, 예: 소장)' : '이름'}</span>
          <textarea
            value={block.label}
            onChange={(e) => onLabel(e.target.value)}
            rows={2}
            placeholder={block.kind === 'room' ? '예: 대회의실' : block.kind === 'label' ? '예: ◀▶' : ''}
            className="mt-0.5 w-full resize-none rounded-md border border-border-hi bg-panel px-2 py-1 text-[11px] text-ink outline-none focus:border-teal"
          />
        </label>
        {block.kind === 'seat' && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-ink3">앉은 사람</span>
            <span className="truncate font-bold text-ink">{current ? `${current.name} ${current.position ?? ''}` : '공석'}</span>
          </div>
        )}
        <div className="flex gap-1.5">
          {block.kind === 'seat' && <Button size="sm" onClick={() => onAssign(null)} disabled={!block.userId}>공석으로</Button>}
          <Button size="sm" variant="danger" onClick={onRemove}><Trash2 size={12} />블록 삭제</Button>
        </div>
      </div>
      {block.kind === 'seat' && (
        <>
          <div className="px-3 pt-2.5">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="이름·부서로 찾아 지정"
              className="h-8 w-full rounded-md border border-border-hi bg-panel px-2.5 text-[11.5px] text-ink outline-none focus:border-teal"
            />
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5">
            {candidates.map((u) => {
              const other = seatOf.get(u.id);
              const here = other?.id === block.id;
              return (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => onAssign(u.id)}
                    disabled={here}
                    className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[11px] ${here ? 'bg-teal-soft/40' : 'hover:bg-panel-alt'}`}
                  >
                    <span className="min-w-0">
                      <span className="font-bold text-ink">{u.name}</span>
                      <span className="ml-1 text-ink3">{u.position}</span>
                      <span className="block truncate text-[10px] text-ink3">{u.dept}</span>
                    </span>
                    {other && <span className="shrink-0 text-[9.5px] font-semibold text-ink3">{here ? '이 자리' : '다른 자리에서 이동'}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </aside>
  );
}
