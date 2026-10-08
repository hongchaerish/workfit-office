import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutGrid, Search, Pin } from 'lucide-react';
import { useAuth } from '@/app/auth/AuthProvider';
import { useChatRooms, useUnreadCounts, useLeaveRoom } from '@/features/chat/useChatRooms';
import { useHiddenRooms, hideRoom as hideRoomFor, unhideRooms } from '@/features/chat/hiddenRooms';
import { usePinnedRooms, togglePinnedRoom, sortPinnedFirst } from '@/features/chat/pinnedRooms';
import { useUsers } from '@/features/user/useUsers';
import { useApprovalBoxes } from '@/features/gw/useApprovals';
import MobileNotificationBell from './MobileNotificationBell';
import { getRoomDisplayName, fmtTime } from './chatUtils';
import { MobileActionSheet, type SheetAction } from './MobileActionSheet';
import { useAllUserPresences, useMyPresence } from '@/features/userPresence/useUserPresence';
import { PresenceDot, PresenceBadge } from '@/features/userPresence/PresenceIndicator';
import { currentApproverIds, getPredecessorsOf } from '@/domain/approvalDoc/engine';
import type { ApprovalDoc } from '@/domain/approvalDoc/schema';
import MobileUserMenuSheet from './MobileUserMenuSheet';

/** 모바일 채팅방 목록 — 검색·상대 이름·상단 고정·숨김·새 대화. */
export default function MobileChatList() {
  const { user } = useAuth();
  const nav = useNavigate();
  const me = user!.id;
  const { data: rooms = [] } = useChatRooms(me);
  const { data: unread = {} } = useUnreadCounts(me);
  const { data: users = [] } = useUsers();
  const presenceMap = useAllUserPresences();
  const { meta: presenceMeta, presence: myPresence } = useMyPresence();
  const { byBox } = useApprovalBoxes(me);
  const preds = useMemo(() => getPredecessorsOf(me), [me]);
  const pendingApprovals = useMemo(() => {
    const list = byBox['대기'] ?? [];
    return list.filter((d: ApprovalDoc) => {
      const approvers = currentApproverIds(d);
      return approvers.includes(me) || approvers.some((id) => preds.includes(id));
    }).length;
  }, [byBox, me, preds]);
  const [q, setQ] = useState('');
  const [sheetRoom, setSheetRoom] = useState<{ id: string; type: string } | null>(null);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);

  // 상단 고정 — 웹 메신저와 같은 저장소(features/chat/pinnedRooms)
  const pinnedIds = usePinnedRooms(me);
  const hiddenIds = useHiddenRooms(me);

  const leave = useLeaveRoom();

  const handleLeaveRoom = async (roomId: string) => {
    const room = rooms.find((r) => r.id === roomId);
    if (!room) return;
    if (!window.confirm(`'${room.name || '채팅방'}' 방에서 나가시겠어요?\n대화 내용은 보존됩니다.`)) return;
    try {
      await leave.mutateAsync({ roomId, userId: me, userName: user?.name || '' });
      setSheetRoom(null);
    } catch (e) {
      window.alert('방을 나가는 도중 오류가 발생했습니다.');
    }
  };

  const togglePin = (roomId: string) => togglePinnedRoom(me, roomId);

  const hideRoom = (roomId: string) => hideRoomFor(me, roomId);

  // 새 메시지(미읽음)가 도착한 숨김 방은 자동으로 숨김 해제
  useEffect(() => {
    const arrived = hiddenIds.filter((id) => (unread[id] ?? 0) > 0);
    if (arrived.length > 0) unhideRooms(me, arrived);
  }, [hiddenIds, unread, me]);

  const kw = q.trim().toLowerCase();

  const sortedRooms = useMemo(() => {
    const visible = rooms.filter((r) => !hiddenIds.includes(r.id) || (unread[r.id] ?? 0) > 0);
    const named = visible.map((r) => ({ ...r, displayName: getRoomDisplayName(r, me, users) }));
    const filtered = kw ? named.filter((r) => r.displayName.toLowerCase().includes(kw)) : named;
    const byRecent = [...filtered].sort((a, b) => {
      const at = a.lastMessage?.at ? new Date(a.lastMessage.at).getTime() : 0;
      const bt = b.lastMessage?.at ? new Date(b.lastMessage.at).getTime() : 0;
      return bt - at;
    });
    return sortPinnedFirst(byRecent, pinnedIds);
  }, [rooms, hiddenIds, unread, users, me, kw, pinnedIds]);

  const sheetActions: SheetAction[] = sheetRoom
    ? [
        { label: pinnedIds.includes(sheetRoom.id) ? '고정 해제' : '상단 고정', onClick: () => togglePin(sheetRoom.id) },
        ...(sheetRoom.type === 'direct'
          ? [{ label: '채팅방 삭제', danger: true, onClick: () => hideRoom(sheetRoom.id) }]
          : []),
        ...(sheetRoom.type === 'group'
          ? [{ label: '방 나가기', danger: true, onClick: () => handleLeaveRoom(sheetRoom.id) }]
          : []),
        ...(sheetRoom.type === 'dept'
          ? [{ label: '🏢 부서방은 인사이동 시 자동 관리됩니다', onClick: () => setSheetRoom(null) }]
          : []),
      ]
    : [];

  const initials = user?.name ? user.name.slice(-2) : 'WF';

  return (
    <div className="flex h-full flex-col" style={{ background: '#f2f8fc' }}>
      <header className="flex items-center gap-2 px-4 py-3 text-white" style={{ background: '#101830' }}>
        <img src="/icons/icon-192.png" alt="" className="h-6 w-6 rounded" />
        <span className="text-[15px] font-bold">워크핏 메신저</span>
        <div className="ml-auto flex items-center gap-1.5">
          {/* 그룹웨어 전체 모듈 메뉴 버튼 (미결재 건수 뱃지 유지) */}
          <button
            onClick={() => nav('/m/modules')}
            title="그룹웨어 메뉴"
            className="relative grid h-8.5 w-8.5 place-items-center rounded-xl hover:bg-white/10 active:scale-95 transition-all text-white"
          >
            <LayoutGrid size={19} strokeWidth={2} />
            {pendingApprovals > 0 && (
              <span
                className="absolute -right-0.5 -top-0.5 grid h-[16px] min-w-[16px] place-items-center rounded-full px-1 text-[9.5px] font-extrabold text-white shadow-xs"
                style={{ background: '#e0483b' }}
              >
                {pendingApprovals}
              </span>
            )}
          </button>

          <MobileNotificationBell />

          {/* 내 프로필 아바타 + 근무 상태 인디케이터 (탭 시 상태 관리 바텀시트 오픈) */}
          <button
            type="button"
            onClick={() => setIsUserMenuOpen(true)}
            title={user ? `${user.name} (${user.empNo}) · ${presenceMeta.label}${myPresence.message ? ` - ${myPresence.message}` : ''}` : '내 프로필 및 근무 상태 관리'}
            className="relative ml-0.5 flex items-center rounded-full p-0.5 transition-all hover:ring-2 hover:ring-white/20 active:scale-95"
          >
            {user?.photoUrl ? (
              <img
                src={user.photoUrl}
                alt={user.name}
                className="h-8 w-8 rounded-full object-cover border border-white/30"
              />
            ) : (
              <div
                className="grid h-8 w-8 place-items-center rounded-full text-[12px] font-bold text-white shadow-xs"
                style={{ background: '#17a89a' }}
              >
                {initials}
              </div>
            )}
            <span
              className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-[#101830] shadow-xs ${presenceMeta.dotColor}`}
              title={presenceMeta.label}
            />
          </button>
        </div>
      </header>

      {/* 검색 + 새 대화 */}
      <div className="flex items-center gap-2 border-b border-black/5 bg-white px-4 py-2.5">
        <div className="flex flex-1 items-center gap-2 rounded-full bg-black/5 px-3.5 py-2">
          <Search size={14} className="shrink-0 text-ink3" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="이름, 채팅방 검색"
            className="w-full bg-transparent text-[12.5px] text-ink outline-none placeholder:text-ink3"
          />
        </div>
        <button onClick={() => nav('/m/new')} title="새 대화" className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[20px] leading-none text-white" style={{ background: '#4ea8de' }}>＋</button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {sortedRooms.length === 0 && (
          <div className="py-16 text-center text-[12px] text-ink3">{kw ? '검색 결과가 없습니다.' : '대화방이 없습니다.'}</div>
        )}
        {sortedRooms.map((r) => {
          const n = unread[r.id] ?? 0;
          const isPinned = pinnedIds.includes(r.id);
          const isDirect = r.type === 'direct';
          const otherId = isDirect ? r.members.find((m) => m !== me) : null;
          const otherPresence = otherId ? presenceMap[otherId] : null;

          return (
            <div
              key={r.id}
              className={`flex items-center border-b border-black/5 bg-white active:bg-black/5 ${isPinned ? 'bg-[#f2f8fc]' : ''}`}
            >
              <button
                onClick={() => nav(`/m/room/${r.id}`)}
                className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-4 text-left"
              >
                <div className="relative shrink-0">
                  <span
                    style={{ background: (r.color || '#101830') + '22', color: r.color || '#101830' }}
                    className="grid h-9 w-9 place-items-center rounded-[10px] text-[15px] font-bold"
                  >
                    {isDirect ? r.displayName[0] : r.type === 'dept' ? '🏢' : r.type === 'group' ? '👥' : (r.displayName[0] ?? '#')}
                  </span>
                  {isDirect && <PresenceDot presence={otherPresence} size="sm" />}
                </div>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 truncate text-[14px] font-bold text-ink">
                      <span className="truncate">{r.displayName}</span>
                      {isPinned && <Pin size={11} className="inline shrink-0" />}
                      {isDirect && otherPresence && otherPresence.status !== 'OFFLINE' && (
                        <PresenceBadge presence={otherPresence} showMessage={false} size="xs" />
                      )}
                    </span>
                    <span className="shrink-0 text-[10px] tabular-nums text-ink3">{fmtTime(r.lastMessage?.at)}</span>
                  </span>
                  <span className="mt-0.5 flex items-center justify-between gap-2">
                    <span className="truncate text-[12px] text-ink3">
                      {isDirect && otherPresence?.message ? (
                        <span className="text-teal font-semibold mr-1">[{otherPresence.message}]</span>
                      ) : null}
                      {r.lastMessage?.text ?? '대화를 시작하세요'}
                    </span>
                    {n > 0 && (
                      <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold text-white" style={{ background: '#e0483b' }}>{n}</span>
                    )}
                  </span>
                </span>
              </button>
              <button
                onClick={() => setSheetRoom({ id: r.id, type: r.type })}
                title="더보기"
                className="grid h-full shrink-0 place-items-center px-3 text-[16px] text-ink3 active:bg-black/5"
              >
                ⋮
              </button>
            </div>
          );
        })}
      </div>

      {sheetRoom && <MobileActionSheet actions={sheetActions} onClose={() => setSheetRoom(null)} />}

      <MobileUserMenuSheet
        isOpen={isUserMenuOpen}
        onClose={() => setIsUserMenuOpen(false)}
      />
    </div>
  );
}

