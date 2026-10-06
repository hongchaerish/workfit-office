import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useNavigate } from 'react-router-dom';
import { Search, Paperclip, FileSignature, FileText, X, Pencil, Download } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/app/auth/AuthProvider';
import { usePermission } from '@/features/auth/usePermission';
import { ImageBundleGrid } from '@/features/chat/ImageBundleGrid';
import { isSameMinute, processMessageBundles, isGroupedWithPrevious } from '@/features/chat/messageBundles';
import { useChatThread, useSendMessage, useSendAttachments, useMarkRead, useEditMessage, useUpdateMessageReactions, useDeleteMessage } from '@/features/chat/useChatThread';
import { canDeleteMessage, DELETED_MESSAGE_TEXT, isDeletedMessage } from '@/domain/chatMessage/deletion';
import { useChatRooms, useLeaveRoom, useDeleteRoom, useInviteMembers, useUpdateRoomName, CHAT_ROOMS_KEY, CHAT_UNREAD_KEY } from '@/features/chat/useChatRooms';
import { hideRoom, unhideRooms } from '@/features/chat/hiddenRooms';
import { useUsers } from '@/features/user/useUsers';
import { MAX_ATTACHMENT_BYTES, type ChatMessage, type Attachment, type ApprovalBotPayload } from '@/domain/chatMessage/schema';
import type { ChatRoom } from '@/domain/chatRoom/schema';
import { chatRoomRepo } from '@/data/chatRoom/chatRoom.repo';
import { chatMessageRepo } from '@/data/chatMessage/chatMessage.repo';
import { nowLocalIso } from '@/shared/lib/datetime';
import { CHAT_THREAD_KEY } from '@/features/chat/useChatThread';
import { getRoomDisplayName, fmtBubbleTime, fmtSize, msgPreview, downloadAttachment } from './chatUtils';
import { MobileActionSheet, type SheetAction } from './MobileActionSheet';
import { MobileMemberPicker } from './MobileMemberPicker';
import { statusColor } from './MobileApprovalList';
import { useAllUserPresences } from '@/features/userPresence/useUserPresence';
import { PresenceDot, PresenceBadge } from '@/features/userPresence/PresenceIndicator';

/** 사용자 ID에 따른 다채로운 파스텔톤 아바타 스타일 매핑. */
export function getAvatarStyle(userId: string): { bg: string; text: string } {
  const PASTEL_PALETTE = [
    { bg: '#e0f2fe', text: '#0369a1' }, // 파스텔 스카이 블루
    { bg: '#fce7f3', text: '#be185d' }, // 파스텔 핑크
    { bg: '#dcfce7', text: '#15803d' }, // 파스텔 민트/그린
    { bg: '#fef9c3', text: '#a16207' }, // 파스텔 옐로우
    { bg: '#f3e8ff', text: '#6b21a8' }, // 파스텔 퍼플
    { bg: '#ffedd5', text: '#c2410c' }, // 파스텔 오렌지
    { bg: '#e0e7ff', text: '#3730a3' }, // 파스텔 인디고
  ];
  if (!userId) return PASTEL_PALETTE[0];
  let sum = 0;
  for (let i = 0; i < userId.length; i++) {
    sum += userId.charCodeAt(i);
  }
  return PASTEL_PALETTE[sum % PASTEL_PALETTE.length];
}

/** 방 진입 시 숨김(삭제) 해제 — 데스크톱과 동일 규칙. */
function unhideRoom(me: string, roomId: string) {
  unhideRooms(me, [roomId]);
}

/** 모바일 대화창 — 답글·첨부·읽음수·검색·초대·방 관리 지원. */
export default function MobileChatThread() {
  const { roomId = '' } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const { isAdmin: isSuperAdmin } = usePermission();
  const me = user!.id;
  const meName = user!.name;
  const isAdmin = Boolean(isSuperAdmin);

  const { data: messages = [] } = useChatThread(roomId);
  const { data: rooms = [] } = useChatRooms(me);
  const { data: users = [] } = useUsers();
  const presenceMap = useAllUserPresences();
  const room = rooms.find((r) => r.id === roomId);
  const send = useSendMessage(roomId);
  const sendFile = useSendAttachments(roomId);
  const markRead = useMarkRead();
  const leave = useLeaveRoom();
  const remove = useDeleteRoom();
  const updateRoomName = useUpdateRoomName();
  const updateReactions = useUpdateMessageReactions(roomId);
  const deleteMessage = useDeleteMessage(roomId);
  const handleDeleteMessage = async (msg: ChatMessage) => {
    if (!window.confirm("이 메시지를 모든 참여자의 화면에서 삭제할까요?\n삭제하면 되돌릴 수 없습니다.")) return;
    try {
      await deleteMessage.mutateAsync({ messageId: msg.id, actor: { id: me, name: meName } });
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "삭제에 실패했습니다.");
    }
  };

  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);

  const [sheetMessage, setSheetMessage] = useState<ChatMessage | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [forwardMessage, setForwardMessage] = useState<ChatMessage | null>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [hasNewMsg, setHasNewMsg] = useState(false);
  const prevLengthRef = useRef(messages.length);

  const [showFileBox, setShowFileBox] = useState(false);
  const filesInRoom = useMemo(() => {
    return messages
      .filter((m) => m.attachment)
      .map((m) => ({
        messageId: m.id,
        senderName: m.senderName,
        at: m.at,
        attachment: m.attachment!,
        type: m.type,
      }))
      .reverse();
  }, [messages]);

  const copyToClipboard = async (val: string) => {
    try {
      await navigator.clipboard.writeText(val);
      window.alert('메시지가 복사되었습니다.');
    } catch {
      window.alert('복사에 실패했습니다.');
    }
  };

  const handleToggleEmoji = async (messageId: string, emoji: string) => {
    const targetMsg = messages.find((m) => m.id === messageId);
    if (!targetMsg) return;

    const curReactions = targetMsg.reactions ? { ...targetMsg.reactions } as Record<string, string[]> : {} as Record<string, string[]>;
    const userList = curReactions[emoji] ? [...curReactions[emoji]] : [];

    let nextUserList: string[];
    if (userList.includes(me)) {
      nextUserList = userList.filter((uid) => uid !== me);
    } else {
      nextUserList = [...userList, me];
    }

    if (nextUserList.length === 0) {
      delete curReactions[emoji];
    } else {
      curReactions[emoji] = nextUserList;
    }

    try {
      await updateReactions.mutateAsync({ messageId, reactions: curReactions });
    } catch {
      window.alert("반응 업데이트에 실패했습니다.");
    }
  };

  const handleRenameRoom = async () => {
    if (!room) return;
    const newName = window.prompt("새로운 대화방 이름을 입력하세요:", room.name);
    if (!newName || !newName.trim() || newName === room.name) return;
    try {
      await updateRoomName.mutateAsync({ roomId: room.id, name: newName.trim(), userName: meName });
    } catch (e) {
      window.alert("방 이름 변경에 실패했습니다.");
    }
  };
  const [viewer, setViewer] = useState<{ attachments: Attachment[]; initialIdx: number } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 150;
    setShowScrollBtn(!isAtBottom);
    if (isAtBottom) {
      setHasNewMsg(false);
    }
  };

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      setHasNewMsg(false);
    }
  };

  interface StagedFile {
    id: string;
    file: File;
    previewUrl?: string;
  }
  const [attachedFiles, setAttachedFiles] = useState<StagedFile[]>([]);

  const handleFilesAttach = (files: FileList | File[]) => {
    const list = Array.from(files);
    const validFiles: StagedFile[] = [];
    for (const file of list) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        window.alert(`파일 [${file.name}]이 너무 큽니다. 최대 ${Math.floor(MAX_ATTACHMENT_BYTES / 1024 / 1024)}MB까지 전송할 수 있습니다.`);
        continue;
      }
      const isImg = file.type.startsWith('image/');
      validFiles.push({
        id: `${file.name}-${Date.now()}-${Math.random()}`,
        file,
        previewUrl: isImg ? URL.createObjectURL(file) : undefined,
      });
    }
    if (validFiles.length > 0) {
      setAttachedFiles((prev) => [...prev, ...validFiles]);
    }
  };

  const removeAttachedFile = (id: string) => {
    setAttachedFiles((prev) => {
      const target = prev.find((f) => f.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((f) => f.id !== id);
    });
  };

  const clearAttachedFiles = (filesList: StagedFile[]) => {
    filesList.forEach((f) => {
      if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
    });
    setAttachedFiles([]);
  };

  useEffect(() => {
    return () => {
      attachedFiles.forEach((f) => {
        if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
      });
    };
  }, [roomId, attachedFiles]);

  const readonly = room?.type === 'notice';
  const displayName = room ? getRoomDisplayName(room, me, users) : '채팅방';

  // 검색 시 전체 대화를 유지하면서 위치 탐색만 하도록 변경
  const filteredMessages = messages;

  const searchMatchIds = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return messages
      .filter((m) => {
        if (m.type === 'system') return false;
        return m.text?.toLowerCase().includes(q);
      })
      .map((m) => m.id);
  }, [messages, searchQuery]);

  const [currentSearchIdx, setCurrentSearchIdx] = useState(0);

  // 검색 인덱스 변경에 따른 스크롤 위치 이동
  useEffect(() => {
    if (searchMatchIds.length > 0 && currentSearchIdx >= 0) {
      const activeId = searchMatchIds[currentSearchIdx];
      const el = document.getElementById(`msg-${activeId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [searchMatchIds, currentSearchIdx]);

  const processedItems = useMemo(() => processMessageBundles(filteredMessages), [filteredMessages]);

  useEffect(() => {
    unhideRoom(me, roomId);
    markRead.mutate({ roomId, userId: me });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, me]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 200;

    if (filteredMessages.length > prevLengthRef.current) {
      if (isAtBottom) {
        el.scrollTop = el.scrollHeight;
        setHasNewMsg(false);
      } else {
        setHasNewMsg(true);
      }
    } else {
      el.scrollTop = el.scrollHeight;
    }
    prevLengthRef.current = filteredMessages.length;
  }, [filteredMessages.length]);

  const submit = async () => {
    const t = text.trim();
    if (!t && attachedFiles.length === 0) return;
    if (sendFile.isPending) return;

    if (attachedFiles.length > 0) {
      try {
        // 첫 번째 파일은 텍스트 및 답글 정보와 함께 전송
        // 여러 장을 한 번에 — 하나씩 떨어져 올라가지 않고 한 묶음(그리드)으로 보이게
        await sendFile.mutateAsync({
          files: attachedFiles.map((f) => f.file),
          senderId: me,
          senderName: meName,
          text: t,
          replyTo: replyTo ? { id: replyTo.id, senderName: replyTo.senderName || '알 수 없음', text: msgPreview(replyTo) } : null,
        });

        clearAttachedFiles(attachedFiles);
        setText('');
        setReplyTo(null);
      } catch (err) {
        window.alert(err instanceof Error ? err.message : '전송에 실패했습니다.');
      }
    } else {
      send.mutate({
        text: t,
        senderId: me,
        senderName: meName,
        replyTo: replyTo ? { id: replyTo.id, senderName: replyTo.senderName || '알 수 없음', text: msgPreview(replyTo) } : null,
      });
      setText('');
      setReplyTo(null);
    }
  };

  const onPickFile = async (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFilesAttach(e.target.files);
    }
    e.target.value = '';
  };

  const onLeave = async () => {
    if (!room || leave.isPending) return;
    if (!window.confirm(`'${room.name}' 방에서 나가시겠어요?\n대화 내용은 보존됩니다.`)) return;
    await leave.mutateAsync({ roomId: room.id, userId: me, userName: meName });
    nav('/m');
  };
  const onDelete = async () => {
    if (!room || remove.isPending) return;
    if (!window.confirm(`'${room.name}' 방을 삭제하시겠어요?\n목록에서 숨겨지지만 대화 내용은 보존됩니다.`)) return;
    await remove.mutateAsync({ roomId: room.id, adminId: me, adminName: meName });
    nav('/m');
  };
  const onDeleteDirect = () => {
    if (!room) return;
    if (!window.confirm('채팅방을 목록에서 삭제하시겠어요?\n(새로운 대화를 시작하면 이전 대화가 다시 표시됩니다.)')) return;
    hideRoom(me, room.id);
    nav('/m');
  };

  const menuActions: SheetAction[] = room
    ? [
        { label: '파일함 모아보기 (📁)', onClick: () => { setMenuOpen(false); setShowFileBox(true); } },
        ...(room.type === 'group' && (room.createdBy === me || !room.createdBy) ? [{ label: '대화방 이름 변경', onClick: handleRenameRoom }] : []),
        ...(room.type === 'group' ? [{ label: '방 나가기', danger: true, onClick: onLeave }] : []),
        ...(room.type === 'dept' ? [{ label: '🏢 부서방은 인사이동 시 자동 관리됩니다', onClick: () => setMenuOpen(false) }] : []),
        ...(isAdmin && room.type !== 'dept' ? [{ label: '방 삭제 (관리자)', danger: true, onClick: onDelete }] : []),
        ...(room.type === 'direct' ? [{ label: '채팅방 삭제', danger: true, onClick: onDeleteDirect }] : []),
      ]
    : [];

  if (inviting && room) {
    return <InviteOverlay room={room} meName={meName} onDone={() => setInviting(false)} />;
  }

  return (
    <div className="flex h-full flex-col relative" style={{ background: '#f2f8fc' }}>
      {(() => {
        const isDirect = room?.type === 'direct';
        const otherId = isDirect ? room.members.find((m) => m !== me) : null;
        const otherPresence = otherId ? presenceMap[otherId] : null;

        return (
          <header className="flex shrink-0 items-center gap-1.5 px-2 py-3 text-white" style={{ background: '#101830' }}>
            <button onClick={() => nav('/m')} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[18px] hover:bg-white/10">←</button>
            {isDirect && (
              <div className="relative shrink-0 mr-1">
                <span
                  style={{ background: (room?.color || '#101830') + '33', color: '#fff' }}
                  className="grid h-8 w-8 place-items-center rounded-[10px] text-[13px] font-bold border border-white/20"
                >
                  {displayName[0] ?? '?'}
                </span>
                <PresenceDot presence={otherPresence} size="sm" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 min-w-0">
                <div className="truncate text-[14.5px] font-bold text-white">{displayName}</div>
                {isDirect && otherPresence && (
                  <PresenceBadge presence={otherPresence} showMessage={false} size="xs" />
                )}
                {room && room.type === 'group' && (room.createdBy === me || !room.createdBy) && (
                  <button
                    onClick={handleRenameRoom}
                    title="방 이름 변경"
                    className="opacity-70 hover:opacity-100 transition-all shrink-0 cursor-pointer p-0.5"
                  >
                    <Pencil size={12} />
                  </button>
                )}
              </div>
              {room && room.type !== 'direct' ? (
                <div className="text-[10px] text-white/60">{room.members.length}명</div>
              ) : otherPresence?.message ? (
                <div className="text-[10px] text-[#4ea8de] truncate font-medium">
                  {otherPresence.message}
                </div>
              ) : null}
            </div>
            <button
              onClick={() => { setShowSearch((v) => !v); if (showSearch) setSearchQuery(''); }}
              title="대화 검색"
              className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg hover:bg-white/10 ${showSearch ? 'bg-white/15' : ''}`}
            >
              <Search size={16} />
            </button>
            {room?.type === 'group' && (
              <button onClick={() => setInviting(true)} title="멤버 초대" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[19px] leading-none hover:bg-white/10">＋</button>
            )}
            {menuActions.length > 0 && (
              <button onClick={() => setMenuOpen(true)} title="더보기" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[17px] leading-none hover:bg-white/10">⋮</button>
            )}
          </header>
        );
      })()}

      {showSearch && (
        <div className="shrink-0 border-b border-black/10 bg-white px-4 py-2 flex items-center gap-2">
          <div className="flex flex-1 items-center gap-2 rounded-full bg-black/5 px-3 py-1.5">
            <Search size={13} className="shrink-0 text-ink3" />
            <input
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentSearchIdx(0);
              }}
              placeholder="메시지 또는 첨부파일명 검색…"
              className="w-full bg-transparent text-[12px] text-ink outline-none placeholder:text-ink3"
            />
            {searchQuery && (
              <button onClick={() => { setSearchQuery(''); setCurrentSearchIdx(0); }} className="grid h-4 w-4 place-items-center rounded bg-black/10 text-ink3">
                <X size={10} />
              </button>
            )}
          </div>
          {searchMatchIds.length > 0 && (
            <div className="flex items-center gap-1.5 shrink-0 text-[11px] font-bold text-ink2 bg-black/5 rounded-full px-2.5 py-1 select-none">
              <button
                type="button"
                onClick={() => setCurrentSearchIdx((prev) => (prev - 1 + searchMatchIds.length) % searchMatchIds.length)}
                className="text-[13px] leading-none px-1 hover:text-ink active:scale-90 transition-transform"
              >
                ◀
              </button>
              <span className="tabular-nums">
                {currentSearchIdx + 1}/{searchMatchIds.length}
              </span>
              <button
                type="button"
                onClick={() => setCurrentSearchIdx((prev) => (prev + 1) % searchMatchIds.length)}
                className="text-[13px] leading-none px-1 hover:text-ink active:scale-90 transition-transform"
              >
                ▶
              </button>
            </div>
          )}
        </div>
      )}

      <div ref={scrollRef} onScroll={handleScroll} className="min-h-0 flex-1 overflow-y-auto p-4">
        {processedItems.length === 0 && (
          <div className="py-10 text-center text-[12px] text-ink3">{searchQuery ? '검색된 메시지가 없습니다.' : '대화 내용이 없습니다.'}</div>
        )}
        {processedItems.map((item, idx) => {
          const m = item.message;
          let prevMsg: ChatMessage | null = null;
          if (idx > 0) {
            const prevItem = processedItems[idx - 1];
            if (prevItem.type === 'image-bundle' && prevItem.bundleMessages && prevItem.bundleMessages.length > 0) {
              prevMsg = prevItem.bundleMessages[prevItem.bundleMessages.length - 1];
            } else {
              prevMsg = prevItem.message;
            }
          }
          const nextMsg = idx < processedItems.length - 1 ? processedItems[idx + 1].message : null;

          const showDateDivider = !prevMsg || !isSameDay(prevMsg.at, m.at);
          // 같은 사람이 같은 분에 이어 보낸 메시지는 바짝 붙이고 프로필(이름·사진)은 첫 말풍선에만
          const groupedWithPrev = !showDateDivider && isGroupedWithPrevious(prevMsg, m);

          const lastMsgOfGroup = item.type === 'image-bundle' && item.bundleMessages
            ? item.bundleMessages[item.bundleMessages.length - 1]
            : m;
          const hideTime = nextMsg && lastMsgOfGroup.senderId === nextMsg.senderId && isSameMinute(lastMsgOfGroup.at, nextMsg.at);
          const showTime = !hideTime;

          return (
            <div key={m.id} id={`msg-${m.id}`} className={`space-y-2 ${idx === 0 ? '' : groupedWithPrev ? 'mt-1' : 'mt-2'}`}>
              {showDateDivider && (
                <div className="my-3 flex justify-center">
                  <span className="rounded-full bg-black/5 px-3 py-1 text-[10.5px] text-ink3">
                    {fmtDateDivider(m.at)}
                  </span>
                </div>
              )}
              {item.type === 'image-bundle' && item.bundleMessages ? (
                <ImageBundleBubble
                  bundle={item.bundleMessages}
                  me={me}
                  group={room?.type === 'group'}
                  roomMembers={room?.members ?? []}
                  onOpenImage={(att, list) => setViewer({ attachments: list, initialIdx: list.indexOf(att) })}
                  showTime={showTime}
                  showProfile={!groupedWithPrev}
                  onLongPress={setSheetMessage}
                  onToggleEmoji={handleToggleEmoji}
                />
              ) : (
                <MessageBubble
                  m={m}
                  me={me}
                  group={room?.type === 'group'}
                  roomMembers={room?.members ?? []}
                  onOpenImage={(att) => setViewer({ attachments: [att], initialIdx: 0 })}
                  showTime={showTime}
                  showProfile={!groupedWithPrev}
                  isEditing={editingMessageId === m.id}
                  onCancelEdit={() => setEditingMessageId(null)}
                  onLongPress={setSheetMessage}
                  onToggleEmoji={handleToggleEmoji}
                  searchQuery={searchQuery}
                  isSearchActive={searchMatchIds[currentSearchIdx] === m.id}
                />
              )}
            </div>
          );
        })}
      </div>
      {showScrollBtn && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-16 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1.5 rounded-full bg-white px-3.5 py-2.5 text-[11px] font-extrabold text-[#101830] shadow-lg border border-black/5 active:scale-95 transition-all select-none animate-bounce whitespace-nowrap"
          style={{ boxShadow: '0 4px 12px rgba(16, 24, 48, 0.15)' }}
        >
          ⬇ 최근 메시지
          {hasNewMsg && (
            <span className="w-2 h-2 rounded-full bg-[#ff4d4f] shadow-[0_0_6px_#ff4d4f]" />
          )}
        </button>
      )}

      {readonly ? (
        <div className="shrink-0 border-t border-black/10 bg-black/[0.03] px-4 py-3 text-center text-[11.5px] text-ink3" style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}>
          공지 전용 방입니다
        </div>
      ) : (
        <div className="shrink-0 border-t border-black/10 bg-white" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
          {replyTo && (
            <div className="mx-2.5 mt-2 flex items-center gap-2 rounded-lg border-l-[3px] px-2.5 py-1.5" style={{ borderColor: '#4ea8de', background: '#f2f8fc' }}>
              <div className="min-w-0 flex-1">
                <div className="text-[10.5px] font-bold" style={{ color: '#1890ff' }}>{replyTo.senderName || '메시지'}에게 답장</div>
                <div className="truncate text-[11px] text-ink3">{msgPreview(replyTo)}</div>
              </div>
              <button onClick={() => setReplyTo(null)} title="답장 취소" className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-ink3 active:bg-black/5">
                <X size={13} />
              </button>
            </div>
          )}
          {/* 다중 첨부 대기 파일 칩 목록 */}
          {attachedFiles.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2 max-h-36 overflow-y-auto px-4 py-2 border-b border-black/5">
              {attachedFiles.map((item) => (
                <div key={item.id} className="relative w-14 h-14 rounded-lg border border-black/10 bg-black/5 overflow-hidden flex items-center justify-center shrink-0 shadow-3xs">
                  {item.previewUrl ? (
                    <img src={item.previewUrl} alt="preview" className="w-full h-full object-cover" />
                  ) : (
                    <div className="flex flex-col items-center justify-center p-1 text-center w-full h-full">
                      <span className="text-[16px] leading-none">📄</span>
                      <span className="text-[8px] font-semibold truncate w-full mt-0.5 px-0.5 text-ink leading-tight" title={item.file.name}>
                        {item.file.name}
                      </span>
                    </div>
                  )}
                  <button
                    onClick={() => removeAttachedFile(item.id)}
                    title="첨부 취소"
                    className="absolute top-0.5 right-0.5 bg-black/60 text-white rounded-full w-4 h-4 grid place-items-center"
                  >
                    <X size={9} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2 p-2.5">
            <input ref={fileRef} type="file" multiple className="hidden" onChange={onPickFile} />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={sendFile.isPending}
              title={`파일 첨부 (최대 ${Math.floor(MAX_ATTACHMENT_BYTES / 1024 / 1024)}MB)`}
              className="grid h-10 w-9 shrink-0 place-items-center rounded-full text-ink3 active:bg-black/5 disabled:opacity-40"
            >
              <Paperclip size={18} />
            </button>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit(); }}
              placeholder={sendFile.isPending ? '파일 전송 중…' : '메시지를 입력하세요…'}
              className="min-w-0 flex-1 rounded-full bg-black/5 px-4 py-2.5 text-[13px] text-ink outline-none placeholder:text-ink3"
            />
            <button onClick={submit} className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-[15px] text-white" style={{ background: '#4ea8de' }}>↑</button>
          </div>
        </div>
      )}

      {viewer && <ImageViewer attachments={viewer.attachments} initialIdx={viewer.initialIdx} onClose={() => setViewer(null)} />}
      {menuOpen && <MobileActionSheet title={room?.name} actions={menuActions} onClose={() => setMenuOpen(false)} />}
      {sheetMessage && createPortal(
        <div className="fixed inset-0 z-[120] flex flex-col justify-end bg-black/40" onClick={() => setSheetMessage(null)}>
          <div
            className="mx-2 mb-2 overflow-hidden rounded-2xl bg-white shadow-xl p-3"
            style={{ marginBottom: 'calc(0.5rem + env(safe-area-inset-bottom))' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 이모지 리액션 단축 5종 */}
            <div className="flex items-center justify-around py-2 border-b border-black/5">
              {['👍', '❤️', '😄', '😮', '😢'].map((emoji) => {
                const list = (sheetMessage.reactions as Record<string, string[]> | undefined)?.[emoji] ?? [];
                const active = list.includes(me);
                return (
                  <button
                    key={emoji}
                    onClick={() => {
                      handleToggleEmoji(sheetMessage.id, emoji);
                      setSheetMessage(null);
                    }}
                    className="grid h-10 w-10 place-items-center text-[22px] rounded-full active:bg-black/5"
                    style={active ? { background: '#e6960c20' } : undefined}
                  >
                    {emoji}
                  </button>
                );
              })}
            </div>

            {/* 메시지 액션 목록 */}
            <div className="flex flex-col mt-2">
              <button
                onClick={() => {
                  setReplyTo(sheetMessage);
                  setSheetMessage(null);
                }}
                className="w-full py-3.5 text-center text-[14px] font-semibold border-b border-black/5 text-ink active:bg-black/5"
              >
                답글 달기
              </button>
              <button
                onClick={() => {
                  setForwardMessage(sheetMessage);
                  setSheetMessage(null);
                }}
                className="w-full py-3.5 text-center text-[14px] font-semibold border-b border-black/5 text-ink active:bg-black/5"
              >
                전달하기
              </button>
              <button
                onClick={() => {
                  copyToClipboard(sheetMessage.text || '');
                  setSheetMessage(null);
                }}
                className="w-full py-3.5 text-center text-[14px] font-semibold border-b border-black/5 text-ink active:bg-black/5"
              >
                텍스트 복사
              </button>
              {sheetMessage.senderId === me && sheetMessage.type === 'text' && (
                <button
                  onClick={() => {
                    setEditingMessageId(sheetMessage.id);
                    setSheetMessage(null);
                  }}
                  className="w-full py-3.5 text-center text-[14px] font-semibold text-ink active:bg-black/5"
                >
                  메시지 수정
                </button>
              )}
              {/* 삭제 가능 여부는 공용 규칙 하나로 판단(본인·24시간·일반/사진/파일) */}
              {canDeleteMessage(sheetMessage, me, new Date()).allowed && (
                <button
                  onClick={() => {
                    const target = sheetMessage;
                    setSheetMessage(null);
                    void handleDeleteMessage(target);
                  }}
                  className="w-full py-3.5 text-center text-[14px] font-semibold text-danger border-t border-black/5 active:bg-black/5"
                >
                  메시지 삭제
                </button>
              )}
            </div>
          </div>
          <button
            onClick={() => setSheetMessage(null)}
            className="mx-2 mb-2 rounded-2xl bg-white py-3.5 text-center text-[14px] font-bold text-ink2 shadow-xl active:bg-black/5"
            style={{ marginBottom: 'calc(0.5rem + env(safe-area-inset-bottom))' }}
          >
            취소
          </button>
        </div>,
        document.body
      )}
      {forwardMessage && createPortal(
        <MobileForwardModal
          msg={forwardMessage}
          me={me}
          meName={meName}
          rooms={rooms}
          users={users}
          onClose={() => setForwardMessage(null)}
          onSuccess={() => {
            setForwardMessage(null);
            window.alert('성공적으로 전달되었습니다.');
          }}
        />,
        document.body
      )}
      {showFileBox && createPortal(
        <MobileFileBoxModal
          files={filesInRoom}
          onClose={() => setShowFileBox(false)}
          onOpenImage={(att) => setViewer({ attachments: [att], initialIdx: 0 })}
        />,
        document.body
      )}
    </div>
  );
}

/** 전자결재 알림 봇 카드 — 탭 시 결재 상세(/m/approval/:id)로 이동. Flutter approval_notification_card 와 동일 역할. */
function ApprovalBotCard({ payload, text }: { payload: ApprovalBotPayload; text: string }) {
  const nav = useNavigate();
  const canOpen = !!payload.docId;
  return (
    <div className="w-[240px] overflow-hidden rounded-2xl border border-black/10 bg-white">
      <div className="flex items-center gap-1.5 px-3 py-2 text-white" style={{ background: '#101830' }}>
        <FileSignature size={14} className="shrink-0" />
        <span className="text-[11.5px] font-bold">전자결재 알림</span>
        <span
          className="ml-auto rounded-md px-1.5 py-0.5 text-[9.5px] font-bold"
          style={{ background: `${statusColor(payload.status)}33`, color: '#fff' }}
        >
          {payload.status}
        </span>
      </div>
      <div className="px-3 py-2.5">
        <div className="text-[11px] text-ink3">{text || '전자결재 문서를 확인해 주세요.'}</div>
        <div className="mt-1.5 line-clamp-2 text-[13px] font-bold text-ink">{payload.title || '(제목 없음)'}</div>
        <div className="mt-1 text-[11px] text-ink3">
          {payload.drafterName}
          {payload.drafterDept ? ` · ${payload.drafterDept}` : ''}
          {payload.docNo ? ` · ${payload.docNo}` : ''}
        </div>
        <button
          onClick={() => canOpen && nav(`/m/approval/${payload.docId}`)}
          disabled={!canOpen}
          className="mt-2.5 w-full rounded-lg py-2 text-[12px] font-bold text-white disabled:opacity-40"
          style={{ background: '#4ea8de' }}
        >
          결재 문서 상세 보기 →
        </button>
      </div>
    </div>
  );
}

function ImageBundleBubble({
  bundle,
  me,
  group,
  roomMembers,
  onOpenImage,
  showTime,
  showProfile = true,
  onLongPress,
  onToggleEmoji,
}: {
  bundle: ChatMessage[];
  me: string;
  group?: boolean;
  roomMembers: string[];
  onOpenImage: (att: Attachment, list: Attachment[]) => void;
  showTime: boolean;
  /** 앞 말풍선과 이어지면 false — 프로필 사진·이름을 숨기고 자리만 둔다 */
  showProfile?: boolean;
  onLongPress: (m: ChatMessage) => void;
  onToggleEmoji?: (messageId: string, emoji: string) => void;
}) {
  const m = bundle[0];
  const presenceMap = useAllUserPresences();
  const mine = m.senderId === me;
  const unreadCount = roomMembers.filter((uid) => uid !== m.senderId && !m.readBy.includes(uid)).length;

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const isMoving = useRef(false);

  const handleTouchStart = () => {
    isMoving.current = false;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (!isMoving.current) {
        onLongPress(m);
      }
    }, 600);
  };

  const handleTouchMove = () => {
    isMoving.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
  };

  const handleTouchEnd = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  };

  const fmtBubbleTime = (iso?: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const renderGrid = () => {
    const attachments = bundle.map((msg) => msg.attachment).filter(Boolean) as Attachment[];
    if (attachments.length === 0) return null;
    return <ImageBundleGrid attachments={attachments} onOpen={onOpenImage} className="border-black/10" />;
  };

  // 안읽음 수·시간은 말풍선 바로 옆(아래 맞춤)에 — 시간을 숨긴 말풍선에서도 숫자가 떨어져 보이지 않게
  const bubbleMeta = (mine && unreadCount > 0) || showTime ? (
    <div className={`flex shrink-0 flex-col gap-0.5 pb-0.5 leading-none ${mine ? 'items-end' : 'items-start'}`}>
      {mine && unreadCount > 0 && (
        <span className="text-[10px] font-extrabold" style={{ color: '#1890ff' }}>
          {unreadCount}
        </span>
      )}
      {showTime && <span className="text-[9.5px] tabular-nums text-ink3">{fmtBubbleTime(m.at)}</span>}
    </div>
  ) : null;

  const reactions = m.reactions as Record<string, string[]> | undefined;

  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div className={`flex max-w-[85%] gap-2 ${mine ? 'flex-row-reverse' : 'flex-row'}`}>
        {!mine && !showProfile && <div className="w-[30px] shrink-0" />}
        {!mine && showProfile && (
          <div className="relative shrink-0 self-end">
            <span style={{ backgroundColor: getAvatarStyle(m.senderId || '').bg, color: getAvatarStyle(m.senderId || '').text }} className="grid h-[30px] w-[30px] place-items-center rounded-full text-[12px] font-bold">
              {m.senderName?.[0] ?? '?'}
            </span>
            <PresenceDot presence={presenceMap[m.senderId || '']} size="sm" />
          </div>
        )}
        <div className="group min-w-0">
          {!mine && group && showProfile && <div className="mb-0.5 text-[10.5px] text-ink3">{m.senderName}</div>}
          {m.replyTo && (
            <div className={`mb-1 rounded-md border-l-2 px-2 py-1 ${mine ? 'border-amber/70 bg-black/[0.06]' : 'border-black/10 bg-black/[0.03]'}`}>
              <div className="text-[9.5px] font-bold text-ink2">{m.replyTo.senderName || '메시지'}</div>
              <div className="truncate text-[10px] text-ink3">{m.replyTo.text}</div>
            </div>
          )}
          <div
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onContextMenu={(e) => { e.preventDefault(); onLongPress(m); }}
            className={`relative flex items-end gap-1 ${mine ? 'flex-row-reverse' : 'flex-row'}`}
          >
            {renderGrid()}
            {bubbleMeta}
          </div>
          {reactions && Object.keys(reactions).length > 0 && (
            <div className={`mt-1 flex flex-wrap gap-1 ${mine ? 'justify-end' : 'justify-start'}`}>
              {Object.entries(reactions).map(([emoji, uids]) => {
                if (!uids || uids.length === 0) return null;
                const active = uids.includes(me);
                return (
                  <button
                    key={emoji}
                    onClick={() => onToggleEmoji?.(m.id, emoji)}
                    className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9.5px] font-bold shadow-3xs transition-all active:scale-95"
                    style={active
                      ? { background: '#e6960c20', borderColor: '#e6960c', color: '#e6960c' }
                      : { background: '#fff', borderColor: 'rgba(0,0,0,0.08)', color: '#666' }
                    }
                  >
                    <span>{emoji}</span>
                    <span className="tabular-nums">{uids.length}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MessageBubble({
  m,
  me,
  group,
  roomMembers,
  onOpenImage,
  showTime,
  showProfile = true,
  isEditing,
  onCancelEdit,
  onLongPress,
  onToggleEmoji,
  searchQuery = '',
  isSearchActive = false,
}: {
  m: ChatMessage;
  me: string;
  group?: boolean;
  roomMembers: string[];
  onOpenImage: (att: Attachment, list: Attachment[]) => void;
  showTime: boolean;
  /** 앞 말풍선과 이어지면 false — 프로필 사진·이름을 숨기고 자리만 둔다 */
  showProfile?: boolean;
  isEditing: boolean;
  onCancelEdit: () => void;
  onLongPress: (msg: ChatMessage) => void;
  onToggleEmoji: (messageId: string, emoji: string) => void;
  searchQuery?: string;
  isSearchActive?: boolean;
}) {
  const [editVal, setEditVal] = useState(m.text);
  const editMsg = useEditMessage(m.roomId);
  const presenceMap = useAllUserPresences();

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const isMoving = useRef(false);

  useEffect(() => {
    setEditVal(m.text);
  }, [m.text]);

  const handleTouchStart = () => {
    isMoving.current = false;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (!isMoving.current) {
        onLongPress(m);
      }
    }, 600); // 0.6초 롱탭 인식
  };

  const handleTouchMove = () => {
    isMoving.current = true;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const handleTouchEnd = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  if (m.type === 'system') {
    return (
      <div className="my-1 flex justify-center">
        <span className="rounded-full bg-black/5 px-3 py-1 text-[10.5px] text-ink3">{m.text}</span>
      </div>
    );
  }
  const mine = m.senderId === me;
  const att = m.attachment;
  // 안 읽은 인원 수: 방 멤버 중 readBy 에 없는 사람(본인 제외).
  const unreadCount = roomMembers.filter((uid) => uid !== m.senderId && !m.readBy.includes(uid)).length;

  let body;
  if (isEditing) {
    body = (
      <div className="flex flex-col gap-1 w-full min-w-[180px]">
        <textarea
          value={editVal}
          onChange={(e) => setEditVal(e.target.value)}
          className="w-full bg-[#f8fbfe] text-[12px] text-ink border border-[#bae0ff] rounded-lg px-2 py-1.5 outline-none resize-none"
          rows={2}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              const val = editVal.trim();
              if (val) {
                editMsg.mutate({ messageId: m.id, text: val });
                onCancelEdit();
              }
            }
          }}
        />
        <div className="flex justify-end gap-1 text-[10px]">
          <button
            onClick={() => { onCancelEdit(); setEditVal(m.text); }}
            className="px-2 py-0.5 bg-black/5 text-ink2 rounded"
          >
            취소
          </button>
          <button
            onClick={async () => {
              const val = editVal.trim();
              if (!val) return;
              try {
                await editMsg.mutateAsync({ messageId: m.id, text: val });
                onCancelEdit();
              } catch (e) {
                window.alert("수정에 실패했습니다.");
              }
            }}
            disabled={editMsg.isPending}
            className="px-2 py-0.5 bg-[#4ea8de] text-white rounded disabled:opacity-50"
          >
            저장
          </button>
        </div>
      </div>
    );
  } else if (m.type === 'approval_bot' && m.approvalPayload) {
    body = <ApprovalBotCard payload={m.approvalPayload} text={m.text} />;
  } else if (m.type === 'image' && att) {
    body = (
      <button 
        onClick={() => onOpenImage(att, [att])} 
        onContextMenu={(e) => { e.preventDefault(); onLongPress(m); }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onPointerDown={handleTouchStart}
        onPointerMove={handleTouchMove}
        onPointerUp={handleTouchEnd}
        className="block overflow-hidden rounded-2xl border border-black/10 select-none -webkit-touch-callout-none"
      >
        <img src={att.url} alt={att.name} className="max-h-52 max-w-full object-cover pointer-events-none" />
      </button>
    );
  } else if (m.type === 'file' && att) {
    body = (
      <button
        onClick={() => downloadAttachment(att)}
        onContextMenu={(e) => { e.preventDefault(); onLongPress(m); }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onPointerDown={handleTouchStart}
        onPointerMove={handleTouchMove}
        onPointerUp={handleTouchEnd}
        className="flex items-center gap-2.5 rounded-2xl px-3 py-2.5 text-left select-none -webkit-touch-callout-none"
        style={mine ? { background: '#bae0ff', color: '#1c2536' } : { background: '#fff', color: '#1a202c' }}
      >
        <FileText size={18} className="shrink-0" />
        <span className="min-w-0 pointer-events-none">
          <span className="block max-w-[190px] truncate text-[12.5px] font-semibold">{att.name}</span>
          <span className={`block text-[10px] ${mine ? 'opacity-85' : 'text-ink3'}`}>{fmtSize(att.size)} · 다운로드</span>
        </span>
      </button>
    );
  } else if (isDeletedMessage(m)) {
    // 삭제된 메시지 — 내용 없이 안내만, 길게 눌러도 메뉴를 열지 않는다
    body = (
      <div className="rounded-2xl border border-dashed border-black/15 px-3 py-2 text-[12.5px] italic text-ink3 select-none">
        {DELETED_MESSAGE_TEXT}
      </div>
    );
  } else {
    body = (
      <div
        onContextMenu={(e) => { e.preventDefault(); onLongPress(m); }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onPointerDown={handleTouchStart}
        onPointerMove={handleTouchMove}
        onPointerUp={handleTouchEnd}
        className="whitespace-pre-line break-words rounded-2xl px-3 py-2 text-[13px] leading-relaxed cursor-pointer select-none -webkit-touch-callout-none"
        style={mine ? { background: '#bae0ff', color: '#1c2536' } : { background: '#fff', color: '#1a202c' }}
      >
        {renderHighlightedText(m.text, searchQuery, isSearchActive)}
      </div>
    );
  }

  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div className={`flex max-w-[82%] gap-2 ${mine ? 'flex-row-reverse' : 'flex-row'}`}>
        {!mine && !showProfile && <div className="w-[26px] shrink-0" />}
        {!mine && showProfile && (
          <div className="relative shrink-0 self-end">
            <span style={{ backgroundColor: getAvatarStyle(m.senderId || '').bg, color: getAvatarStyle(m.senderId || '').text }} className="grid h-[26px] w-[26px] place-items-center rounded-full text-[11px] font-bold">
              {m.senderName?.[0] ?? '?'}
            </span>
            <PresenceDot presence={presenceMap[m.senderId || '']} size="sm" />
          </div>
        )}
        <div className="min-w-0">
          {!mine && group && showProfile && <div className="mb-0.5 text-[10px] text-ink3">{m.senderName}</div>}
          {m.replyTo && (
            <div className={`mb-1 truncate rounded-md border-l-2 px-2 py-1 text-[10.5px] ${mine ? 'border-white/50 bg-black/[0.08] text-ink2' : 'border-black/20 bg-black/[0.06] text-ink3'}`}>
              <b>{m.replyTo.senderName || '메시지'}</b> {m.replyTo.text}
            </div>
          )}
          <div className={`flex items-end gap-1 ${mine ? 'flex-row-reverse' : 'flex-row'}`}>
            {body}
            {((mine && unreadCount > 0) || showTime || m.isEdited) && (
              // 안읽음 수·시간은 말풍선 바로 옆(아래 맞춤)에
              <div className={`flex shrink-0 flex-col gap-0.5 pb-0.5 leading-none ${mine ? 'items-end' : 'items-start'}`}>
                {mine && unreadCount > 0 && (
                  <span className="text-[9.5px] font-extrabold" style={{ color: '#1890ff' }}>{unreadCount}</span>
                )}
                {m.isEdited && <span className="text-[8.5px] font-medium text-ink3/80 select-none">(수정됨)</span>}
                {showTime && <span className="text-[9.5px] tabular-nums text-ink3">{fmtBubbleTime(m.at)}</span>}
              </div>
            )}
          </div>
          {/* 이모지 반응 배지 목록 */}
          {m.reactions && Object.keys(m.reactions as Record<string, string[]>).length > 0 && (
            <div className={`mt-1 flex flex-wrap gap-1 ${mine ? 'justify-end' : 'justify-start'}`}>
              {Object.entries(m.reactions as Record<string, string[]>).map(([emoji, uids]) => {
                if (!uids || uids.length === 0) return null;
                const active = uids.includes(me);
                return (
                  <button
                    key={emoji}
                    onClick={() => onToggleEmoji(m.id, emoji)}
                    className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-bold shadow-sm transition-all"
                    style={active 
                      ? { background: '#e6960c20', borderColor: '#e6960c', color: '#e6960c' } 
                      : { background: '#fff', borderColor: 'rgba(0,0,0,0.08)', color: '#666' }
                    }
                  >
                    <span>{emoji}</span>
                    <span className="tabular-nums">{uids.length}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const ZOOM_MIN = 1;
const ZOOM_MAX = 5;

/** 이미지 라이트박스 — 전체화면 원본 표시 + 핀치줌/더블탭/패닝 + 다운로드 + 이전/다음 슬라이드. 배경/✕ 로 닫기. */
function ImageViewer({
  attachments,
  initialIdx,
  onClose,
}: {
  attachments: Attachment[];
  initialIdx: number;
  onClose: () => void;
}) {
  const [currentIdx, setCurrentIdx] = useState(initialIdx);
  const att = attachments[currentIdx];

  const [z, setZ] = useState({ scale: 1, tx: 0, ty: 0 });
  const [isInteracting, setIsInteracting] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // 터치 및 드래그 상태 추적용 ref
  const touchState = useRef({
    // 1-finger drag
    isDragging: false,
    startX: 0,
    startY: 0,
    baseTx: 0,
    baseTy: 0,
    hasMoved: false,

    // 2-finger pinch
    isPinching: false,
    startDist: 0,
    startScale: 1,
    midX: 0,
    midY: 0,
    baseTxPinch: 0,
    baseTyPinch: 0,

    // double-tap
    lastTapTime: 0,
    lastTapX: 0,
    lastTapY: 0,
  });

  // 사진이 변경되면 배율 및 위치 상태 초기화
  useEffect(() => {
    setZ({ scale: 1, tx: 0, ty: 0 });
  }, [currentIdx]);

  const hasPrev = currentIdx > 0;
  const hasNext = currentIdx < attachments.length - 1;

  const handlePrev = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (hasPrev) setCurrentIdx((prev) => prev - 1);
  };

  const handleNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (hasNext) setCurrentIdx((prev) => prev + 1);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowLeft' && hasPrev) {
        setCurrentIdx((prev) => prev - 1);
      } else if (e.key === 'ArrowRight' && hasNext) {
        setCurrentIdx((prev) => prev + 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, hasPrev, hasNext]);

  const getDistance = (t1: React.Touch, t2: React.Touch) => {
    return Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
  };

  const getMidpoint = (t1: React.Touch, t2: React.Touch) => {
    return {
      x: (t1.clientX + t2.clientX) / 2,
      y: (t1.clientY + t2.clientY) / 2,
    };
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    const touches = e.touches;

    if (touches.length === 2) {
      // 핀치 줌 시작
      const dist = getDistance(touches[0], touches[1]);
      const mid = getMidpoint(touches[0], touches[1]);
      touchState.current.isPinching = true;
      touchState.current.isDragging = false;
      touchState.current.startDist = dist;
      touchState.current.startScale = z.scale;
      touchState.current.midX = mid.x;
      touchState.current.midY = mid.y;
      touchState.current.baseTxPinch = z.tx;
      touchState.current.baseTyPinch = z.ty;
      setIsInteracting(true);
    } else if (touches.length === 1) {
      const touch = touches[0];
      const now = Date.now();
      const lastTap = touchState.current.lastTapTime;
      const tapDist = Math.hypot(touch.clientX - touchState.current.lastTapX, touch.clientY - touchState.current.lastTapY);

      // 더블 탭 판별 (300ms 이내 + 30px 이내)
      if (now - lastTap < 300 && tapDist < 30) {
        touchState.current.lastTapTime = 0;
        if (z.scale > 1) {
          // 원본 1배율로 복원
          setZ({ scale: 1, tx: 0, ty: 0 });
        } else {
          // 2.5배율로 확대 (더블탭 위치 중심)
          const rect = containerRef.current?.getBoundingClientRect();
          if (rect) {
            const cx = touch.clientX - (rect.left + rect.width / 2);
            const cy = touch.clientY - (rect.top + rect.height / 2);
            const targetScale = 2.5;
            setZ({
              scale: targetScale,
              tx: -cx * (targetScale - 1),
              ty: -cy * (targetScale - 1),
            });
          } else {
            setZ({ scale: 2.5, tx: 0, ty: 0 });
          }
        }
        return;
      }

      touchState.current.lastTapTime = now;
      touchState.current.lastTapX = touch.clientX;
      touchState.current.lastTapY = touch.clientY;

      if (z.scale > 1) {
        touchState.current.isDragging = true;
        touchState.current.isPinching = false;
        touchState.current.startX = touch.clientX;
        touchState.current.startY = touch.clientY;
        touchState.current.baseTx = z.tx;
        touchState.current.baseTy = z.ty;
        touchState.current.hasMoved = false;
        setIsInteracting(true);
      }
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const touches = e.touches;

    if (touches.length === 2 && touchState.current.isPinching) {
      const dist = getDistance(touches[0], touches[1]);
      if (touchState.current.startDist === 0) return;
      const scaleFactor = dist / touchState.current.startDist;
      const nextScale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, touchState.current.startScale * scaleFactor));

      const rect = containerRef.current?.getBoundingClientRect();
      let tx = touchState.current.baseTxPinch;
      let ty = touchState.current.baseTyPinch;

      if (rect && touchState.current.startScale > 0) {
        const cx = touchState.current.midX - (rect.left + rect.width / 2);
        const cy = touchState.current.midY - (rect.top + rect.height / 2);
        const k = nextScale / touchState.current.startScale;
        tx = tx * k + cx * (1 - k);
        ty = ty * k + cy * (1 - k);
      }

      setZ({
        scale: nextScale,
        tx: nextScale <= 1 ? 0 : tx,
        ty: nextScale <= 1 ? 0 : ty,
      });
    } else if (touches.length === 1 && touchState.current.isDragging && z.scale > 1) {
      const touch = touches[0];
      const dx = touch.clientX - touchState.current.startX;
      const dy = touch.clientY - touchState.current.startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        touchState.current.hasMoved = true;
      }
      setZ((prev) => ({
        ...prev,
        tx: touchState.current.baseTx + dx,
        ty: touchState.current.baseTy + dy,
      }));
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (e.touches.length === 0) {
      touchState.current.isDragging = false;
      touchState.current.isPinching = false;
      setIsInteracting(false);

      if (z.scale <= 1) {
        setZ({ scale: 1, tx: 0, ty: 0 });
      }
    } else if (e.touches.length === 1) {
      touchState.current.isPinching = false;
      if (z.scale > 1) {
        const touch = e.touches[0];
        touchState.current.isDragging = true;
        touchState.current.startX = touch.clientX;
        touchState.current.startY = touch.clientY;
        touchState.current.baseTx = z.tx;
        touchState.current.baseTy = z.ty;
      }
    }
  };

  if (!att) return null;

  return createPortal(
    <div
      onClick={onClose}
      className="fixed inset-0 z-[120] flex flex-col items-center justify-center bg-black/90 p-4 overflow-hidden select-none"
      style={{ touchAction: 'none' }}
    >
      {/* 상단 헤더 영역 */}
      <div
        className="absolute left-0 right-0 top-0 z-30 flex items-center gap-3 px-4 py-3 text-white pointer-events-auto"
        style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top))' }}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">
          {att.name} {attachments.length > 1 ? `(${currentIdx + 1}/${attachments.length})` : ''}
        </span>
        <button onClick={() => downloadAttachment(att)} title="다운로드" className="grid h-9 w-9 place-items-center rounded-lg bg-white/15 text-[15px] active:bg-white/25">⤓</button>
        <button onClick={onClose} title="닫기" className="grid h-9 w-9 place-items-center rounded-lg bg-white/15 active:bg-white/25">
          <X size={18} />
        </button>
      </div>

      {/* 이미지 렌더링 및 이전/다음 버튼 */}
      <div
        ref={containerRef}
        className="relative flex w-full max-w-full items-center justify-center h-[75vh]"
        onClick={(e) => e.stopPropagation()}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        {hasPrev && z.scale <= 1 && (
          <button
            onClick={handlePrev}
            title="이전 사진"
            className="absolute left-2 z-10 grid h-11 w-11 place-items-center rounded-full bg-black/45 text-[20px] text-white hover:bg-black/60 active:scale-95 transition-all select-none pointer-events-auto"
          >
            ◀
          </button>
        )}
        <img
          src={att.url}
          alt={att.name}
          draggable={false}
          style={{
            transform: `translate(${z.tx}px, ${z.ty}px) scale(${z.scale})`,
            transformOrigin: 'center center',
            transition: isInteracting ? 'none' : 'transform 160ms ease-out',
            touchAction: 'none',
          }}
          className="max-h-full max-w-full rounded-lg object-contain pointer-events-none select-none"
        />
        {hasNext && z.scale <= 1 && (
          <button
            onClick={handleNext}
            title="다음 사진"
            className="absolute right-2 z-10 grid h-11 w-11 place-items-center rounded-full bg-black/45 text-[20px] text-white hover:bg-black/60 active:scale-95 transition-all select-none pointer-events-auto"
          >
            ▶
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** 그룹 멤버 초대 — 조직도에서 비참여자 다중 선택 → members 확장 + 시스템 메시지. */
function InviteOverlay({ room, meName, onDone }: { room: ChatRoom; meName: string; onDone: () => void }) {
  const { data: users = [] } = useUsers();
  const invite = useInviteMembers();
  const [selected, setSelected] = useState<string[]>([]);
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const submit = async () => {
    if (!selected.length || invite.isPending) return;
    const inviteeNames = users.filter((u) => selected.includes(u.id)).map((u) => u.name);
    await invite.mutateAsync({ roomId: room.id, userIds: selected, inviterName: meName, inviteeNames });
    onDone();
  };

  return (
    <div className="flex h-full flex-col" style={{ background: '#f2f8fc' }}>
      <header className="flex shrink-0 items-center gap-2 px-2 py-3 text-white" style={{ background: '#101830' }}>
        <button onClick={onDone} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[18px] hover:bg-white/10">←</button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-bold">멤버 초대</div>
          <div className="text-[10px] text-white/60">{room.name}</div>
        </div>
        <button
          onClick={submit}
          disabled={!selected.length || invite.isPending}
          className="rounded-lg px-3 py-1.5 text-[12.5px] font-bold text-white transition-opacity disabled:opacity-40"
          style={{ background: '#4ea8de' }}
        >
          초대 ({selected.length})
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto bg-white" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <MobileMemberPicker exclude={room.members} selected={selected} onToggle={toggle} />
      </div>
    </div>
  );
}

function isSameDay(dateStr1?: string | null, dateStr2?: string | null): boolean {
  if (!dateStr1 || !dateStr2) return false;
  const d1 = new Date(dateStr1);
  const d2 = new Date(dateStr2);
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}


// ─────────────────────────────────────────────────────────────
// Teams 스타일 전달 모달 (PWA 모바일 전용)
// ─────────────────────────────────────────────────────────────
interface ForwardTarget {
  id: string; // roomId 혹은 userId
  name: string;
  type: 'room' | 'user';
  roomColor?: string;
  position?: string;
  dept?: string;
  email?: string;
}

function MobileForwardModal({
  msg,
  me,
  meName,
  rooms,
  users,
  onClose,
  onSuccess,
}: {
  msg: ChatMessage;
  me: string;
  meName: string;
  rooms: ChatRoom[];
  users: any[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [comment, setComment] = useState('');
  const [selectedTargets, setSelectedTargets] = useState<ForwardTarget[]>([]);
  const [sending, setSending] = useState(false);

  // 검색 필터링 후보군 (방 + 직원)
  const suggestions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    
    // 1:1 방의 상대방 유저 ID 수집
    const directUserIds = new Set<string>();
    rooms.forEach((r) => {
      if (r.type === 'direct') {
        const other = r.members.find((m) => m !== me);
        if (other) directUserIds.add(other);
      }
    });

    // 1. 방 검색 (direct 방인 경우 상대방 이름 검색 지원)
    const filteredRooms: ForwardTarget[] = rooms
      .filter((r) => {
        const displayName = getRoomDisplayName(r, me, users);
        return displayName.toLowerCase().includes(q);
      })
      .map((r) => ({
        id: r.id,
        name: getRoomDisplayName(r, me, users),
        type: 'room',
        roomColor: r.color,
      }));

    // 2. 직원 검색 (나 자신 및 이미 1:1 방이 개설된 사용자 제외)
    const filteredUsers: ForwardTarget[] = users
      .filter((u) => u.id !== me && !directUserIds.has(u.id) && (u.name.toLowerCase().includes(q) || u.dept?.toLowerCase().includes(q)))
      .map((u) => ({
        id: u.id,
        name: u.name,
        type: 'user',
        position: u.position,
        dept: u.dept,
        email: u.email,
      }));

    // 이미 선택된 것은 후보에서 제외
    const selectedIds = selectedTargets.map((t) => t.id);
    return [...filteredRooms, ...filteredUsers].filter((t) => !selectedIds.includes(t.id));
  }, [search, rooms, users, me, selectedTargets]);

  const handleAddTarget = (t: ForwardTarget) => {
    setSelectedTargets((prev) => [...prev, t]);
    setSearch('');
  };

  const handleRemoveTarget = (id: string) => {
    setSelectedTargets((prev) => prev.filter((t) => t.id !== id));
  };

  const handleForward = async () => {
    if (selectedTargets.length === 0) {
      window.alert('받는 사람을 1명 이상 선택해 주세요.');
      return;
    }
    setSending(true);
    try {
      const at = nowLocalIso();
      for (const target of selectedTargets) {
        let targetRoomId = '';
        
        if (target.type === 'room') {
          targetRoomId = target.id;
        } else {
          // 유저인 경우 1:1 대화방 검색
          const existingRoom = rooms.find(
            (r) => r.type === 'direct' && r.members.includes(target.id) && r.members.includes(me)
          );
          if (existingRoom) {
            targetRoomId = existingRoom.id;
          } else {
            // 방 개설
            const newRoom = await chatRoomRepo.create({
              name: `${meName}, ${target.name}`,
              type: 'direct',
              members: [me, target.id],
              createdBy: me,
            });
            targetRoomId = newRoom.id;
          }
        }

        // 메시지 추가 및 갱신
        if (comment.trim()) {
          const forwardPreview = msg.text || (msg.type === 'image' ? '📷 사진' : `📎 ${msg.attachment?.name ?? '파일'}`);
          const newMsg: ChatMessage = {
            id: `${targetRoomId}-${Date.now()}`,
            roomId: targetRoomId,
            senderId: me,
            senderName: meName,
            text: comment.trim(),
            type: 'text',
            attachment: null,
            replyTo: {
              id: msg.id,
              senderName: msg.senderName || '알 수 없음',
              text: forwardPreview,
            },
            approvalPayload: null,
            at,
            readBy: [me],
            isEdited: false,
            reactions: {},
          };
          await chatMessageRepo.append(newMsg);
          await chatRoomRepo.updateLastMessage(targetRoomId, {
            text: comment.trim(),
            at,
            senderId: me,
          });
        } else {
          const newMsg: ChatMessage = {
            id: `${targetRoomId}-${Date.now()}`,
            roomId: targetRoomId,
            senderId: me,
            senderName: meName,
            text: msg.text,
            type: msg.type,
            attachment: msg.attachment,
            replyTo: msg.replyTo,
            approvalPayload: msg.approvalPayload,
            at,
            readBy: [me],
            isEdited: false,
            reactions: {},
          };
          await chatMessageRepo.append(newMsg);
          await chatRoomRepo.updateLastMessage(targetRoomId, {
            text: msg.text || (msg.type === 'image' ? '📷 사진' : `📎 ${msg.attachment?.name ?? '파일'}`),
            at,
            senderId: me,
          });
        }
      }
      
      // 전송 후 캐시 무효화
      qc.invalidateQueries({ queryKey: [CHAT_THREAD_KEY] });
      qc.invalidateQueries({ queryKey: [CHAT_ROOMS_KEY] });
      qc.invalidateQueries({ queryKey: [CHAT_UNREAD_KEY] });
      
      onSuccess();
    } catch (e) {
      window.alert('메시지 전달에 실패했습니다: ' + (e instanceof Error ? e.message : '알 수 없는 오류'));
    } finally {
      setSending(false);
    }
  };

  const previewText = msg.text || (msg.type === 'image' ? '📷 사진' : `📎 ${msg.attachment?.name ?? '파일'}`);

  return (
    <div className="fixed inset-0 z-[150] flex flex-col justify-end bg-black/50 p-3" onClick={onClose}>
      <div 
        className="flex max-h-[85vh] flex-col rounded-2xl bg-white p-4 shadow-xl select-none" 
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-black/5 pb-2.5">
          <span className="text-[15px] font-bold text-ink">이 메시지 전달</span>
          <button onClick={onClose} className="text-ink3 p-1">
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto py-3 space-y-4">
          {/* 받는 사람 추가 */}
          <div>
            <label className="block text-[11px] font-bold text-ink2 mb-1.5">받는 사람 추가 *</label>
            <div className="flex flex-wrap gap-1.5 rounded-lg border border-black/10 bg-black/[0.02] p-1.5 focus-within:border-[#4ea8de] transition-colors relative">
              {selectedTargets.map((t) => (
                <div key={t.id} className="flex items-center gap-1 rounded bg-[#4ea8de]/10 border border-[#4ea8de]/20 px-2 py-0.5 text-[11px] font-semibold text-[#1d74a8]">
                  <span>{t.name}</span>
                  <button onClick={() => handleRemoveTarget(t.id)} className="hover:text-red p-0.5">
                    <X size={10} />
                  </button>
                </div>
              ))}
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={selectedTargets.length === 0 ? "이름, 부서 또는 대화방 입력..." : ""}
                className="flex-1 min-w-[120px] bg-transparent text-[12px] outline-none"
              />

              {/* 검색 드롭다운 */}
              {search.trim() && (
                <div className="absolute left-0 right-0 top-full mt-1 z-[160] max-h-48 overflow-y-auto rounded-lg border border-black/10 bg-white shadow-lg py-1">
                  {suggestions.length === 0 ? (
                    <div className="px-3 py-2 text-center text-[11px] text-ink3">검색 결과가 없습니다.</div>
                  ) : (
                    suggestions.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => handleAddTarget(t)}
                        className="w-full px-3 py-2 text-left text-[12px] hover:bg-black/5 flex items-center justify-between"
                      >
                        <span className="font-semibold text-ink">
                          {t.type === 'room' ? `👥 ${t.name}` : `👤 ${t.name}`}
                        </span>
                        {t.type === 'user' && (
                          <span className="text-[10px] text-ink3">
                            {t.dept ? `${t.dept} / ` : ''}{t.position || ''} {t.email ? `(${t.email})` : ''}
                          </span>
                        )}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          {/* 메시지 추가 */}
          <div>
            <label className="block text-[11px] font-bold text-ink2 mb-1.5">메시지 추가(선택 사항)</label>
            <textarea
              rows={2}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="전달 메시지를 추가하세요..."
              className="w-full rounded-lg border border-black/10 bg-black/[0.02] p-2.5 text-[12px] outline-none focus:border-[#4ea8de] focus:bg-white resize-none"
            />
          </div>

          {/* 메시지 미리보기 */}
          <div>
            <label className="block text-[11px] font-bold text-ink2 mb-1.5">메시지 미리보기</label>
            <div className="rounded-xl border border-black/5 bg-[#f2f8fc] p-3 flex flex-col gap-1 border-l-[3px] border-l-[#4ea8de]">
              <div className="flex items-center gap-1.5 text-[10px] font-bold text-ink2">
                <span>{msg.senderName || '알 수 없음'}</span>
                <span className="text-[8.5px] text-ink3 font-normal">{fmtBubbleTime(msg.at)}</span>
              </div>
              <div className="text-[11.5px] text-ink whitespace-pre-wrap line-clamp-3">
                {previewText}
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-black/5 pt-3 mt-1">
          <button 
            onClick={onClose} 
            disabled={sending}
            className="flex-1 rounded-xl bg-black/5 py-3 text-center text-[13px] font-bold text-ink2 active:bg-black/10 disabled:opacity-40"
          >
            취소
          </button>
          <button 
            onClick={handleForward} 
            disabled={sending || selectedTargets.length === 0}
            className="flex-1 rounded-xl py-3 text-center text-[13px] font-bold text-white active:brightness-95 disabled:opacity-40"
            style={{ background: '#4ea8de' }}
          >
            {sending ? '전달 중...' : '전달'}
          </button>
        </div>
      </div>
    </div>
  );
}

function renderHighlightedText(text: string, query: string, isActive: boolean) {
  if (!text) return '';
  if (!query.trim()) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'gi');
  const parts = text.split(regex);
  return (
    <>
      {parts.map((part, i) => {
        const isMatch = part.toLowerCase() === query.trim().toLowerCase();
        if (isMatch) {
          return (
            <mark
              key={i}
              className="rounded-xs px-0.5"
              style={{
                backgroundColor: isActive ? '#f57c00' : '#ffe082',
                color: isActive ? '#fff' : '#1c2536',
                fontWeight: 'bold',
              }}
            >
              {part}
            </mark>
          );
        }
        return part;
      })}
    </>
  );
}

function MobileFileBoxModal({
  files,
  onClose,
  onOpenImage,
}: {
  files: any[];
  onClose: () => void;
  onOpenImage: (att: Attachment) => void;
}) {
  const handleGoToMessage = (messageId: string) => {
    onClose();
    setTimeout(() => {
      const el = document.getElementById(`msg-${messageId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.style.transition = 'background-color 0.3s ease';
        el.style.backgroundColor = '#ffd33d55';
        setTimeout(() => {
          el.style.backgroundColor = '';
        }, 1500);
      }
    }, 150);
  };

  return (
    <div className="fixed inset-0 z-[150] flex flex-col bg-white" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <header className="flex shrink-0 items-center justify-between border-b border-black/10 px-4 py-3 bg-[#101830] text-white">
        <span className="text-[15px] font-bold">📁 파일함 모아보기</span>
        <button onClick={onClose} className="text-[14px] font-semibold text-white/80 hover:text-white px-2 cursor-pointer">닫기</button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-3">
        {files.length === 0 ? (
          <div className="py-20 text-center text-[12px] text-ink3">공유된 파일이 없습니다.</div>
        ) : (
          files.map((f) => {
            const isImg = f.type === 'image';
            return (
              <div key={f.messageId} className="flex items-center gap-3 rounded-xl border border-black/5 bg-black/[0.01] p-3 shadow-3xs">
                {isImg ? (
                  <button onClick={() => onOpenImage(f.attachment)} className="w-12 h-12 rounded-lg border border-black/10 overflow-hidden shrink-0 block bg-black/5 cursor-pointer">
                    <img src={f.attachment.url} alt={f.attachment.name} className="w-full h-full object-cover" />
                  </button>
                ) : (
                  <div className="w-12 h-12 rounded-lg border border-black/10 overflow-hidden shrink-0 flex items-center justify-center bg-black/5 text-[22px] select-none">
                    📄
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <button 
                    onClick={() => downloadAttachment(f.attachment)}
                    className="block text-left text-[12.5px] font-bold text-ink hover:underline truncate w-full cursor-pointer"
                  >
                    {f.attachment.name}
                  </button>
                  <div className="flex items-center gap-1.5 text-[10px] text-ink3 mt-0.5">
                    <span>{f.senderName || '알 수 없음'}</span>
                    <span>·</span>
                    <span>{fmtSize(f.attachment.size)}</span>
                    <span>·</span>
                    <span className="tabular-nums">{new Date(f.at).toLocaleDateString()}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button 
                    onClick={() => handleGoToMessage(f.messageId)}
                    className="shrink-0 text-[15px] p-2 hover:bg-black/5 rounded-full active:scale-95 transition-transform cursor-pointer"
                    title="대화 위치로 이동"
                  >
                    💬
                  </button>
                  <button 
                    onClick={() => downloadAttachment(f.attachment)}
                    className="shrink-0 p-2 hover:bg-black/5 rounded-full active:scale-95 transition-transform cursor-pointer"
                    title="다운로드"
                  >
                    <Download size={15} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function fmtDateDivider(dateStr?: string | null): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const days = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${days[d.getDay()]}`;
}
