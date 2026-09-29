import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, X, Settings2, RotateCcw, Check, ChevronLeft, ChevronRight, GripVertical, Lock } from 'lucide-react';
import { useAuth } from '@/app/auth/AuthProvider';
import { usePermission } from '@/features/auth/usePermission';
import { useGwSummary } from '@/features/gw/useGwSummary';
import { useNotifications, useMarkNotificationRead, useMarkAllNotificationsRead } from '@/features/notification/useNotifications';
import { useUnseenCount } from '@/features/mail/useMailbox';
import { isMailBackendReady, isMailSampleData } from '@/data/mail/mail.client';
import { isGwAppReady } from '@/app/shell/gw-screens';
import { NOTIFICATION_TYPE_META } from '@/domain/liveNotification/schema';
import { Pill } from '@/shared/ui/Pill';
import { MenuGlyph } from '@/shared/ui/MenuGlyph';
import { useQuickDockConfig, REQUIRED_MODULE_KEYS } from './useQuickDockConfig';
import { useBoardPosts } from '@/features/board/useBoardPosts';

/** 도크 패널 공용 카드(흰 배경 + 틸 액센트 바). */
export function DockCard({
  title,
  count,
  action,
  children,
}: {
  title: string;
  count?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-panel px-3.5 py-3">
      <div className="mb-1.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="h-3.5 w-1 rounded-sm bg-teal" />
          <span className="text-[12.5px] font-bold text-ink">{title}</span>
          {count && <span className="rounded-full bg-danger/10 px-[7px] py-px text-[10px] font-extrabold text-danger">{count}</span>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

export function GroupwarePanel({ onClose }: { onClose: () => void }) {
  const CYAN = '#a2d8a0';
  const nav = useNavigate();
  const { user } = useAuth();
  const { canAccess } = usePermission();
  const summary = useGwSummary(user?.id);
  const notis = useNotifications(user?.id);
  const unreadCount = notis.filter((n) => !n.read).length;
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();
  const [showNotiPanel, setShowNotiPanel] = useState(false);

  // 일반 모듈 순서 관리 및 편집 상태
  const { normalOrder, moveNormalItem, resetNormalOrder } = useQuickDockConfig(user?.id);
  const [isEditing, setIsEditing] = useState(false);
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);

  /**
   * 메일 타일 배지 — 전 계정 받은메일함 안 읽은 수.
   *
   * 메일 화면과 같은 캐시 키를 쓰므로 메일함에서 읽으면 도크 배지도 함께 내려간다.
   * 서버가 안 붙었으면 아예 묻지 않는다 — 목업 숫자가 진짜 배지로 보이면 안 된다.
   * 이 패널은 도크를 열었을 때만 그려져서 IMAP 왕복이 상시로 일어나지 않는다.
   */
  const mailUnseenQuery = useUnseenCount(isMailBackendReady || isMailSampleData ? user : null);
  const mailUnseen = useMemo(
    () => Object.values(mailUnseenQuery.data ?? {}).reduce((sum, count) => sum + count, 0),
    [mailUnseenQuery.data],
  );

  // 타일 클릭 → 그룹웨어 앱 라우트로 이동하고 도크를 닫는다.
  const go = (to: string) => { nav(`/gw/${to}`); onClose(); };
  // 결재 문서 딥링크 → 결재함이 해당 문서를 품은 탭으로 이동·선택.
  const goDoc = (id: string) => { nav(`/gw/approval?doc=${id}`); onClose(); };

  // 전체 모듈 정의: 필수 모듈 4종은 hot: true (상단 초록색 강조), 일반 모듈 8종은 hot: false
  const rawApps = useMemo(
    () => [
      // 1. 필수 모듈 4종 (최상단 1행 고정)
      { l: '전자결재', icon: '🖋️', to: 'approval', badge: summary.pendingCount ? String(summary.pendingCount) : undefined, hot: true },
      { l: '메일', icon: '✉️', to: 'mail', badge: mailUnseen > 0 ? (mailUnseen > 99 ? '99+' : String(mailUnseen)) : undefined, hot: true },
      { l: '업무계획', icon: '🗓️', to: 'work-plan', hot: true },
      { l: '근태·휴가', icon: '⏱️', to: 'commute', hot: true },

      // 2. 일반 모듈 8종 (2~3행 배치 & 사용자 순서 변경 가능)
      { l: '캘린더', icon: '📅', to: 'calendar' },
      { l: '게시판', icon: '📌', to: 'board' },
      { l: '인명관리', icon: '👥', to: 'employee' },
      { l: '회사 갤러리', icon: '🖼️', to: 'gallery' },
      { l: '프로젝트', icon: '📗', to: 'task' },
      { l: '자원예약', icon: '📦', to: 'resource' },
      { l: '전자설문', icon: '📋', to: 'survey' },
      { l: '조직도', icon: '🏢', to: 'orgchart' },
    ],
    [summary.pendingCount, mailUnseen]
  );

  type AppItem = (typeof rawApps)[number];

  // 필수 모듈 4개 (항상 최상단 1행 고정)
  const requiredApps = useMemo(() => {
    return REQUIRED_MODULE_KEYS.map((key) => rawApps.find((a) => a.to === key)).filter(
      (a): a is AppItem => a !== undefined && canAccess('/gw/' + a.to)
    );
  }, [rawApps, canAccess]);

  // 일반 모듈 8개 (사용자 커스텀 순서 반영)
  const normalApps = useMemo(() => {
    return normalOrder
      .map((key) => rawApps.find((a) => a.to === key))
      .filter((a): a is AppItem => a !== undefined && canAccess('/gw/' + a.to));
  }, [normalOrder, rawApps, canAccess]);

  const { data: allBoardPosts = [] } = useBoardPosts();
  const noticePosts = useMemo(() => {
    return allBoardPosts
      .filter((p) => p.boardId === 'notice')
      .sort((a, b) => {
        if (a.isPinned && !b.isPinned) return -1;
        if (!a.isPinned && b.isPinned) return 1;
        return new Date(b.date).getTime() - new Date(a.date).getTime();
      })
      .slice(0, 4);
  }, [allBoardPosts]);

  return (
    <div className="flex h-full flex-col bg-[#f2faf3]">
      {/* 프로필 헤더 */}
      <header className="flex shrink-0 items-center gap-3 px-4 pb-[18px] pt-4" style={{ background: 'linear-gradient(135deg, #c7ecc5, #a2d8a0)' }}>
        <span className="grid h-[54px] w-[54px] shrink-0 place-items-center rounded-full border-2 border-ink/20 bg-white/40 text-[20px] font-extrabold text-ink">
          {user?.name?.[0] ?? '?'}
        </span>
        <div className="min-w-0 flex-1 text-ink">
          <div className="text-[15.5px] font-extrabold tracking-tight">
            {user?.name ?? '게스트'} <span className="text-[11.5px] font-semibold opacity-90">{user?.position ?? ''}</span>
          </div>
          <div className="mt-0.5 text-[10.5px] opacity-90">{user?.dept ?? '-'}</div>
        </div>
        <button
          onClick={() => {
            setShowNotiPanel(!showNotiPanel);
          }}
          title="알림"
          className="relative grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[10px] bg-black/10 text-ink hover:bg-black/15 transition-colors"
        >
          <Bell size={16} />
          {unreadCount > 0 && (
            <span className="absolute -right-[3px] -top-[3px] grid h-[15px] min-w-[15px] place-items-center rounded-full border-[1.5px] border-[#c7ecc5] bg-[#ff5b5b] px-[3px] text-[8px] font-extrabold text-white">
              {unreadCount}
            </span>
          )}
        </button>
        <button onClick={onClose} title="닫기" className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[10px] bg-black/10 text-ink hover:bg-black/15 transition-colors">
          <X size={16} />
        </button>
      </header>

      {/* 알림 레이어 */}
      {showNotiPanel && (
        <div className="absolute inset-x-0 top-[88px] z-50 flex max-h-[360px] flex-col border-b border-border bg-panel shadow-lg">
          <div className="flex items-center justify-between border-b border-border px-3.5 py-2 text-[11px] font-bold text-ink2">
            <span>실시간 알림 ({unreadCount})</span>
            {unreadCount > 0 && (
              <button
                onClick={() => user?.id && markAllRead.mutate(user.id)}
                className="text-[10px] text-teal hover:underline"
              >
                모두 읽음
              </button>
            )}
          </div>
          <div className="content-scroll min-h-0 flex-1 overflow-y-auto p-1.5 space-y-1">
            {notis.length === 0 ? (
              <div className="py-8 text-center text-[11.5px] text-ink3">알림이 없습니다.</div>
            ) : (
              notis.map((n) => (
                <button
                  key={n.id}
                  onClick={() => {
                    markRead.mutate(n.id);
                    setShowNotiPanel(false);
                    if (n.linkUrl) {
                      nav(n.linkUrl);
                      onClose();
                    }
                  }}
                  className={`flex w-full items-start gap-2.5 rounded-lg p-2.5 text-left transition-colors ${n.read ? 'opacity-65 hover:bg-panel-alt' : 'bg-teal-soft/30 hover:bg-teal-soft/50'
                    }`}
                >
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded bg-panel border text-[13px]">
                    {(n.type === '메신저' ? '👤' : NOTIFICATION_TYPE_META[n.type]?.icon) || '📢'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[11.5px] font-bold text-ink">{n.title}</span>
                      <span className="text-[9.5px] text-ink3">{n.senderName}</span>
                    </div>
                    <p className="mt-0.5 text-[11px] leading-normal text-ink2">
                      {n.type === '메신저' ? '새로운 메시지가 도착했습니다.' : n.text}
                    </p>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* 앱 타일 + 결재 + 공지 (스크롤) */}
      <div className="menu-scroll flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3.5">
        {/* 상단 툴바: 빠른 실행 앱 타이틀 + 순서 편집/완료 버튼 */}
        <div className="flex items-center justify-between px-0.5">
          <div className="flex items-center gap-1.5">
            <span className="text-[12px] font-extrabold text-ink">빠른 실행 앱</span>
            {isEditing && (
              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[9.5px] font-bold text-amber-700">
                순서 편집 중
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {isEditing ? (
              <>
                <button
                  type="button"
                  onClick={resetNormalOrder}
                  title="기본 순서로 초기화"
                  className="flex items-center gap-1 rounded-md border border-border bg-panel px-2 py-1 text-[10px] font-bold text-ink2 hover:bg-panel-alt transition-colors"
                >
                  <RotateCcw size={11} />
                  <span>초기화</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="flex items-center gap-1 rounded-md bg-teal px-2.5 py-1 text-[10.5px] font-bold text-white shadow-xs hover:opacity-90 transition-opacity"
                >
                  <Check size={12} />
                  <span>완료</span>
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setIsEditing(true)}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-[10.5px] font-bold text-ink2 hover:bg-black/5 hover:text-ink transition-colors"
              >
                <Settings2 size={12} />
                <span>배치 편집</span>
              </button>
            )}
          </div>
        </div>

        {/* ── 1. 필수 모듈 4개 (1행 고정 & 상단 초록색 강조 바) ── */}
        <div className="flex flex-col gap-1.5">
          {isEditing && (
            <div className="flex items-center gap-1 px-0.5 text-[10px] font-bold text-ink3">
              <Lock size={10} className="text-teal" />
              <span>필수 모듈 (최상단 고정)</span>
            </div>
          )}
          <div className="grid grid-cols-4 gap-2">
            {requiredApps.map((a, i) => {
              const enabled = isGwAppReady(a.to);
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    if (!isEditing && enabled) go(a.to);
                  }}
                  disabled={!enabled || isEditing}
                  title={enabled ? a.l : `${a.l} (준비 중)`}
                  className={`relative flex aspect-square flex-col overflow-hidden rounded-xl border border-[#dceddd] bg-panel shadow-[0_1px_5px_rgba(20,140,120,0.07)] transition-all ${
                    enabled && !isEditing
                      ? 'hover:shadow-[0_2px_10px_rgba(20,140,120,0.18)]'
                      : !enabled
                      ? 'opacity-40 cursor-not-allowed filter grayscale'
                      : 'opacity-70 cursor-default'
                  }`}
                >
                  <div
                    className="truncate px-1.5 py-[5px] text-left text-[9px] font-bold flex items-center justify-between"
                    style={{ background: enabled ? CYAN : '#e2e8f0', color: enabled ? '#1c2536' : '#64748b' }}
                  >
                    <span className="truncate">{a.l}</span>
                    {!enabled ? (
                      <span className="shrink-0 rounded bg-slate-300 dark:bg-slate-600 px-1 py-[1px] text-[7.5px] font-bold text-slate-700 dark:text-slate-200">
                        준비중
                      </span>
                    ) : isEditing ? (
                      <Lock size={9} className="opacity-60 shrink-0" />
                    ) : null}
                  </div>
                  <div className="grid flex-1 place-items-center pb-0.5">
                    <MenuGlyph glyph={a.icon} size={22} className="text-ink" />
                  </div>
                  {enabled && a.badge && !isEditing && (
                    <span
                      className="absolute right-1 grid h-[14px] min-w-[14px] place-items-center rounded-full border-[1.5px] border-white bg-[#ff5b5b] px-[3px] text-[8px] font-extrabold text-white"
                      style={{ top: 4 }}
                    >
                      {a.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── 2. 일반 모듈 8개 (2~3행 배치 & 사용자 커스텀 순서) ── */}
        <div className="flex flex-col gap-1.5">
          {isEditing && (
            <div className="flex items-center justify-between px-0.5 text-[10px] font-bold text-ink3">
              <div className="flex items-center gap-1">
                <GripVertical size={11} className="text-teal" />
                <span>일반 모듈 (드래그 또는 화살표로 순서 변경)</span>
              </div>
            </div>
          )}
          <div className="grid grid-cols-4 gap-2">
            {normalApps.map((a, idx) => {
              const enabled = isGwAppReady(a.to);
              const isDragged = draggedIdx === idx;

              return (
                <div
                  key={a.to}
                  draggable={isEditing}
                  onDragStart={(e) => {
                    if (!isEditing) return;
                    e.dataTransfer.setData('text/plain', String(idx));
                    setDraggedIdx(idx);
                  }}
                  onDragOver={(e) => {
                    if (isEditing) {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                    }
                  }}
                  onDrop={(e) => {
                    if (!isEditing) return;
                    e.preventDefault();
                    if (draggedIdx !== null && draggedIdx !== idx) {
                      moveNormalItem(draggedIdx, idx);
                    }
                    setDraggedIdx(null);
                  }}
                  onDragEnd={() => setDraggedIdx(null)}
                  onClick={() => {
                    if (!isEditing && enabled) go(a.to);
                  }}
                  title={isEditing ? `${a.l} (드래그하여 이동)` : enabled ? a.l : `${a.l} (준비 중)`}
                  className={`relative flex aspect-square flex-col overflow-hidden rounded-xl border border-[#dceddd] bg-panel shadow-[0_1px_5px_rgba(20,140,120,0.07)] transition-all select-none ${
                    isEditing
                      ? 'cursor-grab active:cursor-grabbing hover:border-teal'
                      : enabled
                      ? 'cursor-pointer hover:shadow-[0_2px_10px_rgba(20,140,120,0.18)]'
                      : 'opacity-40 cursor-not-allowed filter grayscale'
                  } ${isDragged ? 'ring-2 ring-teal ring-offset-1 opacity-50 scale-95' : ''}`}
                >
                  {/* 상단 라벨 */}
                  <div
                    className="truncate px-1.5 py-[5px] text-left text-[9px] font-bold flex items-center justify-between"
                    style={{
                      background: enabled ? undefined : '#f1f5f9',
                      color: enabled ? '#2a3344' : '#64748b',
                    }}
                  >
                    <span className="truncate">{a.l}</span>
                    {!enabled ? (
                      <span className="shrink-0 rounded bg-slate-200 dark:bg-slate-700 px-1 py-[1px] text-[7.5px] font-bold text-slate-600 dark:text-slate-300">
                        준비중
                      </span>
                    ) : isEditing ? (
                      <GripVertical size={10} className="text-ink3 shrink-0 opacity-60" />
                    ) : null}
                  </div>

                  {/* 중앙 아이콘 */}
                  <div className="grid flex-1 place-items-center pb-0.5">
                    <MenuGlyph glyph={a.icon} size={22} className="text-ink" />
                  </div>

                  {/* 편집 모드일 때 하단 좌우 이동 화살표 버튼 */}
                  {isEditing ? (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center justify-between border-t border-border/50 bg-panel-alt/40 px-1 py-0.5"
                    >
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (idx > 0) moveNormalItem(idx, idx - 1);
                        }}
                        title="앞으로 이동"
                        className={`rounded p-0.5 hover:bg-black/10 transition-colors ${
                          idx === 0 ? 'opacity-20 cursor-not-allowed' : 'text-ink2'
                        }`}
                      >
                        <ChevronLeft size={11} />
                      </button>
                      <button
                        type="button"
                        disabled={idx === normalApps.length - 1}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (idx < normalApps.length - 1) moveNormalItem(idx, idx + 1);
                        }}
                        title="뒤로 이동"
                        className={`rounded p-0.5 hover:bg-black/10 transition-colors ${
                          idx === normalApps.length - 1 ? 'opacity-20 cursor-not-allowed' : 'text-ink2'
                        }`}
                      >
                        <ChevronRight size={11} />
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>

        <DockCard title="결재 대기" count={summary.pendingCount ? String(summary.pendingCount) : undefined}>
          {summary.pendingDocs.slice(0, 4).map((d, i, arr) => (
            <button
              key={d.id}
              onClick={() => goDoc(d.id)}
              className={`flex w-full items-center gap-2.5 py-2.5 text-left ${i < arr.length - 1 ? 'border-b border-border' : ''}`}
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] font-semibold text-ink">{d.title}</div>
                <div className="truncate text-[10px] text-ink3">{d.docNo} · {d.drafterDept || d.docType}</div>
              </div>
              <Pill tone="warn">대기</Pill>
            </button>
          ))}
          {summary.pendingDocs.length === 0 && (
            <div className="py-4 text-center text-[11px] text-ink3">결재할 문서가 없습니다.</div>
          )}
        </DockCard>

        <DockCard
          title="공지사항"
          count={noticePosts.length ? String(noticePosts.length) : undefined}
          action={
            <button
              type="button"
              onClick={() => {
                nav('/gw/board?board=notice');
                onClose();
              }}
              className="text-[10.5px] font-bold text-teal hover:underline cursor-pointer"
            >
              더보기 &gt;
            </button>
          }
        >
          {noticePosts.map((p, i, arr) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                nav(`/gw/board?board=notice&postId=${p.id}`);
                onClose();
              }}
              className={`flex w-full items-center justify-between gap-2 py-[9px] text-left transition-colors cursor-pointer group ${
                i < arr.length - 1 ? 'border-b border-border' : ''
              }`}
            >
              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                {p.isPinned && (
                  <span className="shrink-0 rounded bg-teal-soft/80 border border-teal/20 px-1 py-0.2 text-[8.5px] font-extrabold text-teal">
                    중요
                  </span>
                )}
                <span className="truncate text-[11.5px] font-medium text-ink2 group-hover:text-teal group-hover:font-semibold transition-colors">
                  {p.title}
                </span>
              </div>
              <span className="shrink-0 text-[10px] tabular-nums text-ink3">
                {p.date ? p.date.slice(5).replace('-', '.') : ''}
              </span>
            </button>
          ))}
          {noticePosts.length === 0 && (
            <div className="py-4 text-center text-[11px] text-ink3">등록된 공지사항이 없습니다.</div>
          )}
        </DockCard>
      </div>
    </div>
  );
}
