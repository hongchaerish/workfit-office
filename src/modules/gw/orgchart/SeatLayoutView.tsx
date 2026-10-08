import { useEffect, useMemo, useRef, useState } from 'react';
import { ImageUp, Minus, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { useAuth } from '@/app/auth/AuthProvider';
import type { User } from '@/domain/user/schema';
import type { Seat, SeatLayout } from '@/domain/seatLayout/schema';
import { addSeat, assignSeat, moveSeat, removeSeat, setSeatLabel } from '@/domain/seatLayout/engine';
import { USER_PRESENCE_META, USER_PRESENCE_STATUSES, type UserPresenceStatus } from '@/domain/userPresence/schema';
import { seatLayoutRepo } from '@/data/seatLayout/seatLayout.repo';
import { useRemoveSeatLayout, useSaveSeatLayout, useSeatLayouts } from '@/features/seatLayout/useSeatLayouts';
import { useAllUserPresences } from '@/features/userPresence/useUserPresence';
import { usePermission } from '@/features/auth/usePermission';
import { Button } from '@/shared/ui/Button';

/** 배치도 확대 단계(%) */
const ZOOM_STEPS = [75, 100, 125, 150, 200];
/** 이만큼(px) 넘게 움직여야 끌기로 본다 — 그보다 작으면 클릭(좌석 선택) */
const DRAG_THRESHOLD = 4;

/**
 * 조직도 > 좌석배치도.
 * - 모두: 배치도 위에서 자리마다 이름·직급·부서·근태(실시간 근무상태)를 본다. 누르면 프로필.
 * - 운영자·임원: [배치 편집]으로 이미지 교체, 좌석 추가(빈 곳 클릭)·이동(끌기)·지정·삭제.
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
  const [selectedSeatId, setSelectedSeatId] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');
  const [zoom, setZoom] = useState(100);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const editing = draft !== null;
  const active = layouts.find((l) => l.id === activeId) ?? layouts[0] ?? null;
  const shown = draft ?? active;
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => setImageFailed(false), [shown?.imageUrl]);

  const userMap = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const statusOf = (userId: string): UserPresenceStatus => presences[userId]?.status ?? 'OFFLINE';

  /** 지금 배치도에 앉은 사람들의 근태 집계 */
  const statusCounts = useMemo(() => {
    const counts = new Map<UserPresenceStatus, number>();
    for (const s of shown?.seats ?? []) {
      if (!s.userId || !userMap.has(s.userId)) continue;
      const st = presences[s.userId]?.status ?? 'OFFLINE';
      counts.set(st, (counts.get(st) ?? 0) + 1);
    }
    return counts;
  }, [shown, userMap, presences]);

  const kw = keyword.trim().toLowerCase();
  const matches = (u: User | undefined) =>
    !kw || Boolean(u && (u.name.toLowerCase().includes(kw) || u.dept.toLowerCase().includes(kw) || (u.position ?? '').toLowerCase().includes(kw)));

  // ── 편집 ──
  const startEdit = () => {
    if (!active) return;
    setDraft(structuredClone(active));
    setSelectedSeatId(null);
    setError('');
  };
  const startNewLayout = () => {
    setDraft({
      id: `SL-${Date.now()}`,
      name: layouts.length ? `배치도 ${layouts.length + 1}` : '본사',
      imagePath: '',
      imageUrl: '',
      seats: [],
      sortOrder: layouts.length ? Math.max(...layouts.map((l) => l.sortOrder)) + 1 : 0,
      updatedBy: '',
      updatedAt: '',
    });
    setSelectedSeatId(null);
    setError('');
  };
  const cancelEdit = () => {
    setDraft(null);
    setSelectedSeatId(null);
    setError('');
  };
  const updateSeats = (fn: (seats: Seat[]) => Seat[]) => setDraft((d) => (d ? { ...d, seats: fn(d.seats) } : d));

  const save = async () => {
    if (!draft) return;
    if (!draft.name.trim()) return setError('배치도 이름을 입력하세요.');
    setError('');
    try {
      await saveM.mutateAsync({ ...draft, name: draft.name.trim(), updatedBy: me?.id ?? '', updatedAt: new Date().toISOString() });
      setActiveId(draft.id);
      setDraft(null);
      setSelectedSeatId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장하지 못했습니다.');
    }
  };

  const removeLayout = async () => {
    if (!draft) return;
    const exists = layouts.some((l) => l.id === draft.id);
    if (!exists) return cancelEdit();
    if (!window.confirm(`'${draft.name}' 배치도를 삭제하시겠습니까? 좌석 정보도 함께 삭제됩니다.`)) return;
    try {
      await removeM.mutateAsync(draft.id);
      setActiveId(null);
      cancelEdit();
    } catch (e) {
      setError(e instanceof Error ? e.message : '삭제하지 못했습니다.');
    }
  };

  const fileRef = useRef<HTMLInputElement>(null);
  const uploadImage = async (file: File | undefined) => {
    if (!file || !draft) return;
    if (!file.type.startsWith('image/')) return setError('이미지 파일만 올릴 수 있습니다.');
    setUploading(true);
    setError('');
    try {
      const { path, url } = await seatLayoutRepo.uploadImage(draft.id, file);
      setDraft((d) => (d ? { ...d, imagePath: path, imageUrl: url } : d));
    } catch (e) {
      setError(e instanceof Error ? e.message : '이미지를 올리지 못했습니다.');
    } finally {
      setUploading(false);
    }
  };

  // ── 배치도 위 포인터: 빈 곳 클릭 = 좌석 추가, 좌석 끌기 = 이동, 좌석 클릭 = 선택 ──
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ seatId: string; startX: number; startY: number; moved: boolean } | null>(null);
  const percentAt = (clientX: number, clientY: number) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: ((clientX - r.left) / r.width) * 100, y: ((clientY - r.top) / r.height) * 100 };
  };

  const onCanvasClick = (e: React.MouseEvent) => {
    // 좌석이 아니라 배치도 바탕(이미지)을 눌렀을 때만 좌석을 만든다
    if (!editing || (e.target !== e.currentTarget && !(e.target as HTMLElement).dataset.canvasBg)) return;
    const { x, y } = percentAt(e.clientX, e.clientY);
    const result = addSeat(draft!.seats, x, y);
    setDraft({ ...draft!, seats: result.seats });
    setSelectedSeatId(result.seat.id);
  };

  const onSeatPointerDown = (e: React.PointerEvent, seatId: string) => {
    if (!editing) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { seatId, startX: e.clientX, startY: e.clientY, moved: false };
  };
  const onSeatPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < DRAG_THRESHOLD) return;
    d.moved = true;
    const { x, y } = percentAt(e.clientX, e.clientY);
    updateSeats((seats) => moveSeat(seats, d.seatId, x, y));
  };
  const onSeatPointerUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (d && !d.moved) setSelectedSeatId(d.seatId);
  };

  const selectedSeat = draft?.seats.find((s) => s.id === selectedSeatId) ?? null;

  // 배치도를 바꾸면 선택을 푼다
  useEffect(() => setSelectedSeatId(null), [shown?.id]);

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
            placeholder="배치도 이름 (예: 본사 3층)"
            aria-label="배치도 이름"
            className="h-8 w-48 rounded-lg border border-border-hi bg-panel px-2.5 text-[12px] font-bold text-ink outline-none focus:border-teal"
          />
        ) : (
          <div className="flex flex-wrap items-center gap-1">
            {layouts.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => setActiveId(l.id)}
                className={`rounded-lg px-3 py-1.5 text-[11.5px] font-bold transition-colors ${
                  l.id === active?.id ? 'bg-teal text-white' : 'text-ink3 hover:bg-panel-alt hover:text-ink'
                }`}
              >
                {l.name}
              </button>
            ))}
          </div>
        )}

        {/* 근태 범례 — 이 배치도에 앉은 사람 기준 */}
        {shown && (
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
          {shown && (
            <div className="flex items-center rounded-lg border border-border">
              <button type="button" aria-label="축소" onClick={() => setZoom((z) => ZOOM_STEPS[Math.max(0, ZOOM_STEPS.indexOf(z) - 1)])} className="grid h-8 w-7 place-items-center text-ink3 hover:text-ink"><Minus size={13} /></button>
              <span className="w-11 text-center text-[11px] font-bold text-ink2">{zoom}%</span>
              <button type="button" aria-label="확대" onClick={() => setZoom((z) => ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, ZOOM_STEPS.indexOf(z) + 1)])} className="grid h-8 w-7 place-items-center text-ink3 hover:text-ink"><Plus size={13} /></button>
            </div>
          )}
          {canEdit && !editing && (
            <>
              {active && (
                <Button size="sm" onClick={startEdit}>
                  <Pencil size={13} />배치 편집
                </Button>
              )}
              <Button size="sm" onClick={startNewLayout}>
                <Plus size={13} />배치도 추가
              </Button>
            </>
          )}
          {editing && (
            <>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { void uploadImage(e.target.files?.[0]); e.target.value = ''; }} />
              <Button size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
                <ImageUp size={13} />{uploading ? '올리는 중…' : draft.imageUrl ? '이미지 변경' : '이미지 올리기'}
              </Button>
              <Button size="sm" variant="danger" onClick={() => void removeLayout()} disabled={saveM.isPending || removeM.isPending}>
                <Trash2 size={13} />배치도 삭제
              </Button>
              <Button size="sm" onClick={cancelEdit} disabled={saveM.isPending}>취소</Button>
              <Button size="sm" variant="primary" onClick={() => void save()} disabled={saveM.isPending || uploading}>
                {saveM.isPending ? '저장 중…' : '저장'}
              </Button>
            </>
          )}
        </div>
      </div>

      {editing && (
        <p className="px-1 text-[11px] text-ink3">
          배치도의 빈 곳을 누르면 좌석이 생기고, 좌석을 끌면 자리를 옮깁니다. 좌석을 누르면 오른쪽에서 사람을 지정합니다.
        </p>
      )}
      {error && <div role="alert" className="rounded-lg border border-danger/20 bg-danger/5 px-3 py-2 text-[11px] font-semibold text-danger">{error}</div>}

      {/* ── 본문 ── */}
      {!shown ? (
        <div className="grid h-60 place-items-center rounded-xl border border-dashed border-border bg-panel text-center text-[12px] text-ink3">
          <div>
            등록된 좌석배치도가 없습니다.
            {canEdit && <div className="mt-2"><Button size="sm" variant="primary" onClick={startNewLayout}><Plus size={13} />첫 배치도 만들기</Button></div>}
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1 overflow-auto rounded-xl border border-border bg-panel-alt/40">
            {shown.imageUrl ? (
              <div
                ref={canvasRef}
                onClick={onCanvasClick}
                className={`relative select-none ${editing ? 'cursor-crosshair' : ''}`}
                style={{ width: `${zoom}%` }}
              >
                {imageFailed ? (
                  <div data-canvas-bg="1" className="grid aspect-[16/9] w-full place-items-center text-[12px] text-ink3">
                    배치도 이미지를 불러오지 못했습니다.
                  </div>
                ) : (
                  <img
                    src={shown.imageUrl}
                    alt={`${shown.name} 배치도`}
                    draggable={false}
                    data-canvas-bg="1"
                    onError={() => setImageFailed(true)}
                    className="block h-auto w-full"
                  />
                )}
                {shown.seats.map((seat) => {
                  const u = seat.userId ? userMap.get(seat.userId) : undefined;
                  return (
                    <SeatCard
                      key={seat.id}
                      seat={seat}
                      user={u}
                      status={u ? statusOf(u.id) : null}
                      message={u ? presences[u.id]?.message ?? '' : ''}
                      editing={editing}
                      selected={seat.id === selectedSeatId}
                      dimmed={!editing && Boolean(kw) && !matches(u)}
                      highlighted={!editing && Boolean(kw) && Boolean(u) && matches(u)}
                      onOpenProfile={() => u && onSelectUserId(u.id)}
                      onPointerDown={(e) => onSeatPointerDown(e, seat.id)}
                      onPointerMove={onSeatPointerMove}
                      onPointerUp={onSeatPointerUp}
                    />
                  );
                })}
              </div>
            ) : (
              <div className="grid h-60 place-items-center text-center text-[12px] text-ink3">
                <div>
                  배치도 이미지가 아직 없습니다.
                  {editing && <div className="mt-2"><Button size="sm" variant="primary" onClick={() => fileRef.current?.click()} disabled={uploading}><ImageUp size={13} />이미지 올리기</Button></div>}
                </div>
              </div>
            )}
          </div>

          {editing && selectedSeat && (
            <SeatEditorPanel
              seat={selectedSeat}
              seats={draft.seats}
              users={users}
              onAssign={(userId) => updateSeats((seats) => assignSeat(seats, selectedSeat.id, userId))}
              onLabel={(label) => updateSeats((seats) => setSeatLabel(seats, selectedSeat.id, label))}
              onRemove={() => { updateSeats((seats) => removeSeat(seats, selectedSeat.id)); setSelectedSeatId(null); }}
              onClose={() => setSelectedSeatId(null)}
            />
          )}
        </div>
      )}
    </div>
  );
}

/** 배치도 위 좌석 한 칸 — 이름·직급, 부서, 근태 */
function SeatCard({
  seat,
  user,
  status,
  message,
  editing,
  selected,
  dimmed,
  highlighted,
  onOpenProfile,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: {
  seat: Seat;
  user: User | undefined;
  status: UserPresenceStatus | null;
  message: string;
  editing: boolean;
  selected: boolean;
  dimmed: boolean;
  highlighted: boolean;
  onOpenProfile: () => void;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: () => void;
}) {
  const meta = status ? USER_PRESENCE_META[status] : null;
  const title = user
    ? `${user.name}${user.position ? ` ${user.position}` : ''} · ${user.dept}${meta ? ` · ${meta.label}${message ? ` (${message})` : ''}` : ''}`
    : seat.label || '빈 좌석';

  return (
    <div
      role={editing ? 'button' : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onClick={(e) => { e.stopPropagation(); if (!editing) onOpenProfile(); }}
      title={title}
      style={{ left: `${seat.x}%`, top: `${seat.y}%` }}
      className={`absolute w-[84px] -translate-x-1/2 -translate-y-1/2 touch-none rounded-md border px-1 py-0.5 text-center shadow-sm transition-[opacity,box-shadow] ${
        user ? 'border-border bg-panel/95' : 'border-dashed border-ink3/50 bg-panel/70'
      } ${editing ? 'cursor-grab active:cursor-grabbing' : user ? 'cursor-pointer hover:shadow-md' : ''} ${
        selected ? 'z-10 ring-2 ring-teal' : highlighted ? 'z-10 ring-2 ring-amber-400' : ''
      } ${dimmed ? 'opacity-30' : ''}`}
    >
      {user ? (
        <>
          <div className="truncate text-[10.5px] font-extrabold leading-tight text-ink">
            {user.name}
            {user.position && <span className="ml-0.5 font-semibold text-ink3">{user.position}</span>}
          </div>
          <div className="truncate text-[9px] leading-tight text-ink3">{user.dept}</div>
          {meta && (
            <div className={`mt-px flex items-center justify-center gap-1 text-[9px] font-bold leading-tight ${meta.textColor}`}>
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta.dotColor}`} />
              <span className="truncate">{meta.label}</span>
            </div>
          )}
        </>
      ) : (
        <div className="truncate py-1 text-[9.5px] font-semibold text-ink3">{seat.label || '빈 좌석'}</div>
      )}
    </div>
  );
}

/** 편집 중 고른 좌석 — 사람 지정·이름·삭제 */
function SeatEditorPanel({
  seat,
  seats,
  users,
  onAssign,
  onLabel,
  onRemove,
  onClose,
}: {
  seat: Seat;
  seats: Seat[];
  users: User[];
  onAssign: (userId: string | null) => void;
  onLabel: (label: string) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const seatOf = useMemo(() => new Map(seats.filter((s) => s.userId).map((s) => [s.userId!, s])), [seats]);
  const current = seat.userId ? users.find((u) => u.id === seat.userId) : undefined;
  const kw = q.trim().toLowerCase();
  const candidates = users
    .filter((u) => !kw || u.name.toLowerCase().includes(kw) || u.dept.toLowerCase().includes(kw) || (u.position ?? '').toLowerCase().includes(kw))
    // 아직 자리가 없는 사람을 먼저
    .sort((a, b) => Number(seatOf.has(a.id)) - Number(seatOf.has(b.id)) || a.dept.localeCompare(b.dept, 'ko') || a.name.localeCompare(b.name, 'ko'));

  return (
    <aside className="sticky top-[calc(var(--shell-top)+12px)] flex max-h-[calc(80vh/var(--font-scale,1))] w-[260px] shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-panel shadow-md">
      <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
        <span className="text-[12.5px] font-extrabold text-ink">좌석 {seat.id}</span>
        <button type="button" onClick={onClose} aria-label="닫기" className="text-ink3 hover:text-ink"><X size={15} /></button>
      </div>
      <div className="space-y-2 border-b border-border px-3 py-2.5 text-[11px]">
        <div className="flex items-center justify-between gap-2">
          <span className="text-ink3">앉은 사람</span>
          <span className="truncate font-bold text-ink">{current ? `${current.name} ${current.position ?? ''}` : '없음'}</span>
        </div>
        <label className="flex items-center gap-2">
          <span className="shrink-0 text-ink3">좌석 이름</span>
          <input
            value={seat.label}
            onChange={(e) => onLabel(e.target.value)}
            placeholder="예: 회의석, 방문석"
            className="h-7 min-w-0 flex-1 rounded-md border border-border-hi bg-panel px-2 text-[11px] text-ink outline-none focus:border-teal"
          />
        </label>
        <div className="flex gap-1.5">
          <Button size="sm" onClick={() => onAssign(null)} disabled={!seat.userId}>자리 비우기</Button>
          <Button size="sm" variant="danger" onClick={onRemove}><Trash2 size={12} />좌석 삭제</Button>
        </div>
      </div>
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
          const here = other?.id === seat.id;
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
                {other && <span className="shrink-0 text-[9.5px] font-semibold text-ink3">{here ? '이 자리' : `${other.id}에서 이동`}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
