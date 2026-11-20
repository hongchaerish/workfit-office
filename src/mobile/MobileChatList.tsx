import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Pin } from 'lucide-react';
import { useAuth } from '@/app/auth/AuthProvider';
import { useChatRooms, useUnreadCounts, useLeaveRoom } from '@/features/chat/useChatRooms';
import { useHiddenRooms, hideRoom as hideRoomFor, unhideRooms } from '@/features/chat/hiddenRooms';
import { usePinnedRooms, togglePinnedRoom, sortPinnedFirst } from '@/features/chat/pinnedRooms';
import { useChatDrafts, draftPreview } from '@/features/chat/chatDrafts';
import { useFailedOutboxRooms } from '@/features/chat/chatOutbox';
import { usePrefetchChatThread } from '@/features/chat/useChatThread';
import { useUsers } from '@/features/user/useUsers';
import { getRoomDisplayName, fmtTime } from './chatUtils';
import { MobileActionSheet, type SheetAction } from './MobileActionSheet';
import { useAllUserPresences } from '@/features/userPresence/useUserPresence';
import { PresenceDot, PresenceBadge } from '@/features/userPresence/PresenceIndicator';
import { BirthdayMark } from '@/features/birthday/BirthdayProvider';
import { chatTextScaleStyle, useChatTextSize } from './chatTextSize';
import { ChatAvatarPhoto } from '@/features/chat/ChatAvatarPhoto';

/** 모바일 채팅방 목록 — 검색·상대 이름·상단 고정·숨김·새 대화. */
export default function MobileChatList() {
  const { user } = useAuth();
  const nav = useNavigate();
  const me = user!.id;
  const textSize = useChatTextSize(me);
  const { data: rooms = [] } = useChatRooms(me);
  const failedRooms = useFailedOutboxRooms(me);
  const { data: unread = {} } = useUnreadCounts(me);
  const drafts = useChatDrafts(me);
  const prefetchThread = usePrefetchChatThread();
  const { data: users = [] } = useUsers();
  const presenceMap = useAllUserPresences();
  const [q, setQ] = useState('');
  const [sheetRoom, setSheetRoom] = useState<{ id: string; type: string } | null>(null);

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
        ...(sheetRoom.type === 'group' || sheetRoom.type === 'dept'
          ? [{ label: '방 나가기', danger: true, onClick: () => handleLeaveRoom(sheetRoom.id) }]
          : []),
      ]
    : [];

  return (
    <div className="flex h-full flex-col" style={{ background: '#f2f8fc', ...chatTextScaleStyle(textSize) }}>
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

      <div className="min-h-0 flex-1 overflow-y-auto">
        {sortedRooms.length === 0 && (
          <div className="py-16 text-center chat-text-[12px] text-ink3">{kw ? '검색 결과가 없습니다.' : '대화방이 없습니다.'}</div>
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
                onPointerDown={() => prefetchThread(r.id)}
                onClick={() => nav(`/m/room/${r.id}`)}
                className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-4 text-left"
              >
                <div className="relative shrink-0">
                  <span
                    style={{ background: (r.color || '#101830') + '22', color: r.color || '#101830' }}
                    className="relative overflow-hidden grid h-9 w-9 place-items-center rounded-[10px] text-[15px] font-bold"
                  >
                    {isDirect ? r.displayName[0] : r.type === 'dept' ? '🏢' : r.type === 'group' ? '👥' : (r.displayName[0] ?? '#')}
                    <ChatAvatarPhoto userId={isDirect ? otherId : null} />
                  </span>
                  {isDirect && <PresenceDot presence={otherPresence} size="sm" />}
                </div>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 truncate chat-text-[14px] font-bold text-ink">
                      <span className="truncate">{r.displayName}</span>
                      {isDirect && <BirthdayMark userId={otherId} />}
                      {isPinned && <Pin size={11} className="inline shrink-0" />}
                      {isDirect && otherPresence && otherPresence.status !== 'OFFLINE' && (
                        <PresenceBadge presence={otherPresence} showMessage={false} size="xs" />
                      )}
                    </span>
                    <span className="shrink-0 chat-text-[10px] tabular-nums text-ink3">{fmtTime(r.lastMessage?.at)}</span>
                  </span>
                  <span className="mt-0.5 flex items-center justify-between gap-2">
                    <span className="truncate chat-text-[12px] text-ink3">
                      {isDirect && otherPresence?.message ? (
                        <span className="text-teal font-semibold mr-1">[{otherPresence.message}]</span>
                      ) : null}
                      {failedRooms.has(r.id) && <span className="mr-1 font-semibold" style={{ color: '#e0483b' }}>[전송 실패]</span>}
                      {drafts[r.id] ? (
                        <>
                          <span className="mr-1 font-semibold" style={{ color: '#e0483b' }}>[작성 중]</span>
                          {draftPreview(drafts[r.id])}
                        </>
                      ) : (
                        r.lastMessage?.text ?? '대화를 시작하세요'
                      )}
                    </span>
                    {n > 0 && (
                      <span className="shrink-0 rounded-full px-2 py-0.5 chat-text-[11px] font-bold text-white" style={{ background: '#e0483b' }}>{n}</span>
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
    </div>
  );
}

