import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import type { ChangeEvent, MouseEvent, PointerEvent, ReactNode, WheelEvent } from 'react';
import { createPortal } from 'react-dom';
import { Search, X, Paperclip, Pencil, Download } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/app/auth/AuthProvider';
import { useChatRooms, useUnreadCounts, useCreateRoom, useInviteMembers, useLeaveRoom, useDeleteRoom, useUpdateRoomName, useKickMember, CHAT_ROOMS_KEY, CHAT_UNREAD_KEY } from '@/features/chat/useChatRooms';
import { useHiddenRooms, hideRoom, unhideRooms } from '@/features/chat/hiddenRooms';
import { ImageBundleGrid } from '@/features/chat/ImageBundleGrid';
import { isSameMinute, processMessageBundles, isGroupedWithPrevious } from '@/features/chat/messageBundles';
import { useChatThread, useSendMessage, useSendAttachments, useMarkRead, useEditMessage, useUpdateMessageReactions, useDeleteMessage, CHAT_THREAD_KEY } from '@/features/chat/useChatThread';
import { canDeleteMessage, DELETED_MESSAGE_TEXT, isDeletedMessage } from '@/domain/chatMessage/deletion';
import { useUsers } from '@/features/user/useUsers';
import { useOrgTree, type OrgNode } from '@/features/gw/useOrgTree';
import { useAllUserPresences } from '@/features/userPresence/useUserPresence';
import { PresenceDot, PresenceBadge } from '@/features/userPresence/PresenceIndicator';
import type { ChatRoom } from '@/domain/chatRoom/schema';
import { MAX_ATTACHMENT_BYTES, type ChatMessage, type Attachment } from '@/domain/chatMessage/schema';
import { chatRoomRepo } from '@/data/chatRoom/chatRoom.repo';
import { chatMessageRepo } from '@/data/chatMessage/chatMessage.repo';
import { nowLocalIso } from '@/shared/lib/datetime';
import { AutoLinkText } from '@/shared/ui/AutoLinkText';

/** ISO 시각 → 오늘 HH:MM / 어제 / MM/DD 표시. */
export function fmtTime(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  if (d.toDateString() === now.toDateString()) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const yst = new Date(now);
  yst.setDate(now.getDate() - 1);
  if (d.toDateString() === yst.toDateString()) return '어제';
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
}

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

// SW 알림 클릭(데스크톱) → 메신저 도크에서 열 방 ID 를 전달하는 브릿지.
let pendingChatRoomId: string | null = null;
export function requestOpenChatRoom(roomId: string): void {
  pendingChatRoomId = roomId || null;
  window.dispatchEvent(new CustomEvent('workfit-open-chat-room'));
}

function getRoomDisplayName(room: ChatRoom, me: string, users: any[]): string {
  if (room.type !== 'direct') return room.name;
  const otherId = room.members.find((m) => m !== me);
  if (!otherId) return room.name;
  const u = users.find((x) => x.id === otherId);
  return u ? `${u.name} ${u.position}` : room.name;
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function msgPreview(m: ChatMessage): string {
  if (m.type === 'image') return '📷 사진';
  if (m.type === 'file') return `📎 ${m.attachment?.name ?? '파일'}`;
  return m.text;
}

import { downloadFile } from '@/shared/lib/download';

function downloadAttachment(att: Attachment) {
  void downloadFile(att.url, att.name);
}

import { usePermission } from '@/features/auth/usePermission';

/** 메신저 패널 — 방 목록 ↔ 대화 뷰 2-state 전환. */
export function MessengerPanel() {
  const { user } = useAuth();
  const { isAdmin: isSuperAdmin } = usePermission();
  const me = user?.id ?? 'U001';
  const meName = user?.name ?? '김승기';
  const isAdmin = Boolean(isSuperAdmin);
  const [openRoomId, setOpenRoomId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const { data: rooms = [] } = useChatRooms(me);
  const { data: unreadMap = {} } = useUnreadCounts(me);
  const { data: users = [] } = useUsers();
  const presenceMap = useAllUserPresences();
  const [q, setQ] = useState('');
  const openRoom = rooms.find((r) => r.id === openRoomId) ?? null;

  // 알림 클릭(데스크톱) → 지정된 방 열기. 마운트 직후 대기값 소비 + 이후 이벤트 수신.
  useEffect(() => {
    const consume = () => {
      if (pendingChatRoomId) {
        setComposing(false);
        setOpenRoomId(pendingChatRoomId);
        pendingChatRoomId = null;
      }
    };
    consume();
    window.addEventListener('workfit-open-chat-room', consume);
    return () => window.removeEventListener('workfit-open-chat-room', consume);
  }, []);

  const hiddenIds = useHiddenRooms(me);

  // [＋]로 숨긴 방을 다시 열면(1:1은 기존 방 재사용) 그 즉시 숨김을 푼다 — 메시지를 안 보내고 나와도 목록에 남게.
  const handleCreated = (id: string) => {
    unhideRooms(me, [id]);
    setComposing(false);
    setOpenRoomId(id);
  };

  const handleHideRoom = (roomId: string) => {
    if (!window.confirm('이 채팅방을 대화 목록에서 숨기시겠습니까?\n(새로운 메시지가 오면 다시 표시됩니다.)')) return;
    hideRoom(me, roomId);
  };

  // 방에 들어가면(알림 클릭 포함) 숨김 해제
  useEffect(() => {
    if (openRoomId) unhideRooms(me, [openRoomId]);
  }, [openRoomId, me]);

  // 새 메시지(미읽음)가 도착한 숨김 방은 자동으로 숨김 해제
  useEffect(() => {
    const arrived = hiddenIds.filter((id) => (unreadMap[id] ?? 0) > 0);
    if (arrived.length > 0) unhideRooms(me, arrived);
  }, [hiddenIds, unreadMap, me]);

  const visibleRooms = useMemo(() => {
    const list = rooms.filter((r) => !hiddenIds.includes(r.id) || (unreadMap[r.id] ?? 0) > 0);
    const kw = q.trim().toLowerCase();
    if (!kw) return list;
    return list.filter((r) => getRoomDisplayName(r, me, users).toLowerCase().includes(kw));
  }, [rooms, hiddenIds, me, q, users, unreadMap]);

  if (composing) {
    return <NewRoomView me={me} onCancel={() => setComposing(false)} onCreated={handleCreated} />;
  }

  if (openRoom) {
    return (
      <MessengerThread
        room={openRoom}
        me={me}
        meName={meName}
        isAdmin={isAdmin}
        users={users}
        onBack={() => setOpenRoomId(null)}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* 검색 + 새 대화 (PWA와 완벽히 동일화) */}
      <div className="flex items-center gap-2 border-b border-border bg-white px-4 py-2.5 select-none">
        <div className="flex flex-1 items-center gap-2 rounded-full bg-black/5 px-3.5 py-2">
          <Search size={14} className="shrink-0 text-ink3" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="이름, 채팅방 검색"
            className="w-full bg-transparent text-[12px] text-ink outline-none placeholder:text-ink3"
          />
        </div>
        <button
          onClick={() => setComposing(true)}
          title="새 대화"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[20px] leading-none text-white transition-all active:scale-95"
          style={{ background: '#4ea8de' }}
        >
          ＋
        </button>
      </div>

      <div className="menu-scroll flex-1 overflow-y-auto">
        {visibleRooms.length === 0 ? (
          <div className="py-12 text-center text-[12.5px] text-ink3">개설된 대화방이 없습니다.</div>
        ) : (
          visibleRooms.map((r) => {
            const display = getRoomDisplayName(r, me, users);
            // 내 미읽음 수
            const n = unreadMap[r.id] ?? 0;
            const isDirect = r.type === 'direct';
            const otherId = isDirect ? r.members.find((m) => m !== me) : null;
            const otherPresence = otherId ? presenceMap[otherId] : null;
            return (
              <div
                key={r.id}
                onClick={() => setOpenRoomId(r.id)}
                className="group relative flex items-center gap-3 border-b border-border px-4 py-3 hover:bg-panel-alt cursor-pointer"
              >
                <div className="relative shrink-0">
                  <span
                    style={{ background: r.color + '22', color: r.color }}
                    className="grid h-9 w-9 place-items-center rounded-[10px] text-[15px] font-bold"
                  >
                    {isDirect ? display[0] : '👥'}
                  </span>
                  {isDirect && <PresenceDot presence={otherPresence} size="sm" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="truncate text-[12.5px] font-bold text-ink">{display}</span>
                      {isDirect && otherPresence && otherPresence.status !== 'OFFLINE' && (
                        <PresenceBadge presence={otherPresence} showMessage={false} size="xs" />
                      )}
                    </div>
                    <span className="shrink-0 text-[10px] text-ink3">{fmtTime(r.lastMessage?.at)}</span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between gap-2">
                    <span className="truncate text-[11.5px] text-ink3">
                      {isDirect && otherPresence?.message ? (
                        <span className="text-teal font-semibold mr-1">[{otherPresence.message}]</span>
                      ) : null}
                      {r.lastMessage ? msgPreview(r.lastMessage as any) : '대화 내용이 없습니다.'}
                    </span>
                    {n > 0 && (
                      <span className="grid h-[16px] min-w-[16px] shrink-0 place-items-center rounded-full bg-[#ff4d4f] px-1.5 text-[8.5px] font-extrabold text-white shadow-[0_2px_6px_rgba(255,77,79,0.3)] select-none">
                        {n}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleHideRoom(r.id);
                  }}
                  title="대화방 숨기기"
                  className="absolute right-2 top-2 hidden h-5 w-5 place-items-center rounded bg-black/5 text-ink3 hover:bg-black/10 group-hover:grid"
                >
                  <X size={11} />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function MessengerThread({
  room,
  me,
  meName,
  isAdmin,
  users,
  onBack,
}: {
  room: ChatRoom;
  me: string;
  meName: string;
  isAdmin: boolean;
  users: any[];
  onBack: () => void;
}) {
  const displayName = getRoomDisplayName(room, me, users);
  const presenceMap = useAllUserPresences();
  const { data: messages = [] } = useChatThread(room.id);
  const { data: rooms = [] } = useChatRooms(me);
  const send = useSendMessage(room.id);
  const sendFile = useSendAttachments(room.id);
  const markRead = useMarkRead();
  const leave = useLeaveRoom();
  const remove = useDeleteRoom();
  const updateRoomName = useUpdateRoomName();
  const updateReactions = useUpdateMessageReactions(room.id);
  const deleteMessage = useDeleteMessage(room.id);
  const handleDeleteMessage = async (msg: ChatMessage) => {
    if (!window.confirm('이 메시지를 모든 참여자의 화면에서 삭제할까요?\n삭제하면 되돌릴 수 없습니다.')) return;
    try {
      await deleteMessage.mutateAsync({ messageId: msg.id, actor: { id: me, name: meName } });
    } catch (err) {
      window.alert(err instanceof Error ? err.message : '삭제에 실패했습니다.');
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

  const [text, setText] = useState('');
  const [inviting, setInviting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeMenu, setActiveMenu] = useState<{ m: ChatMessage; x: number; y: number; mine: boolean } | null>(null);
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [forwardMessage, setForwardMessage] = useState<ChatMessage | null>(null);
  const [attachmentRetention, setAttachmentRetention] = useState<'30d' | '90d' | '180d' | '1y' | 'permanent'>('30d');
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  const [hasNewMsg, setHasNewMsg] = useState(false);
  const prevLengthRef = useRef(messages.length);
  const isInitialLoadRef = useRef(true);
  const prevRoomIdRef = useRef(room.id);

  useEffect(() => {
    if (!activeMenu) return;
    const close = () => setActiveMenu(null);
    const timer = setTimeout(() => {
      window.addEventListener('click', close);
      window.addEventListener('contextmenu', close);
    }, 50);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('click', close);
      window.removeEventListener('contextmenu', close);
    };
  }, [activeMenu]);

  const handleRenameRoom = async () => {
    if (room.createdBy !== me) {
      window.alert("채팅방을 생성한 사람만 이름을 변경할 수 있습니다.");
      return;
    }
    const newName = window.prompt("새로운 대화방 이름을 입력하세요:", room.name);
    if (!newName || !newName.trim() || newName === room.name) return;
    try {
      await updateRoomName.mutateAsync({ roomId: room.id, name: newName.trim(), userName: meName });
    } catch (e) {
      window.alert("방 이름 변경에 실패했습니다.");
    }
  };

  const [viewer, setViewer] = useState<{ attachments: Attachment[]; initialIdx: number } | null>(null);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const readonly = room.type === 'notice';

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const nextHeight = Math.min(Math.max(el.scrollHeight, 24), 84);
    el.style.height = `${nextHeight}px`;
  }, [text]);

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

  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  /** 답장 인용을 누르면 원본 메시지로 이동해 잠깐 강조한다. 사진 묶음 속 메시지도 묶음 위치로 찾는다. */
  const jumpToMessage = useCallback((messageId: string) => {
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-msg-ids~="${CSS.escape(messageId)}"]`);
    if (!el) {
      window.alert(searchQuery ? '원본 메시지가 검색 결과에 없습니다. 검색어를 지우고 다시 눌러 주세요.' : '원본 메시지를 찾을 수 없습니다.');
      return;
    }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.remove('chat-jump-highlight');
    void el.offsetWidth; // 같은 메시지를 연달아 눌러도 강조 애니메이션이 다시 돌게
    el.classList.add('chat-jump-highlight');
    window.setTimeout(() => el.classList.remove('chat-jump-highlight'), 1800);
  }, [searchQuery]);

  const [currentSearchIdx, setCurrentSearchIdx] = useState(0);
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

  const [showMemberList, setShowMemberList] = useState(false);
  const kick = useKickMember();
  /** 단체방(그룹)에서만 내보내기 — 부서방은 인사 정보로 참여자가 자동 동기화되어 내보내도 되돌아온다. */
  const canKick = room.type === 'group';
  const onKick = async (targetId: string, targetName: string) => {
    if (kick.isPending) return;
    if (!window.confirm(`${targetName}님을 이 대화방에서 내보내시겠어요?\n대화 내용은 보존됩니다.`)) return;
    try {
      await kick.mutateAsync({ roomId: room.id, targetId, targetName, kickerName: meName });
    } catch {
      window.alert('내보내는 중 오류가 발생했습니다.');
    }
  };
  const memberDetails = useMemo(() => {
    return room.members
      .map((mId) => users.find((u) => u.id === mId))
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [room.members, users]);

  const [isDragging, setIsDragging] = useState(false);
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
      if (target?.previewUrl) {
        URL.revokeObjectURL(target.previewUrl);
      }
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
  }, [room.id, attachedFiles]);

  const handleDragOver = (e: React.DragEvent) => {
    if (readonly) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDrop = async (e: React.DragEvent) => {
    if (readonly) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFilesAttach(e.dataTransfer.files);
    }
  };

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

  const onPickFile = async (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFilesAttach(e.target.files);
    }
    e.target.value = '';
  };

  const canLeave = room.type === 'group';
  const canDelete = isAdmin;

  const onLeave = async () => {
    if (leave.isPending) return;
    if (!window.confirm(`'${room.name}' 방에서 나가시겠어요?\n대화 내용은 보존됩니다.`)) return;
    await leave.mutateAsync({ roomId: room.id, userId: me, userName: meName });
    onBack();
  };
  const onDelete = async () => {
    if (remove.isPending) return;
    if (!window.confirm(`'${room.name}' 방을 삭제하시겠어요?\n목록에서 숨겨지지만 대화 내용은 보존되어 관리자가 조회할 수 있습니다.`)) return;
    await remove.mutateAsync({ roomId: room.id, adminId: me, adminName: meName });
    onBack();
  };
  const onDeleteDirect = () => {
    if (!window.confirm('채팅방을 목록에서 삭제하시겠어요?\n(새로운 대화를 시작하면 이전 대화가 다시 표시됩니다.)')) return;
    hideRoom(me, room.id);
    onBack();
  };

  useEffect(() => {
    markRead.mutate({ roomId: room.id, userId: me });
  }, [room.id, me]);

  useEffect(() => {
    if (prevRoomIdRef.current !== room.id) {
      prevRoomIdRef.current = room.id;
      isInitialLoadRef.current = true;
      prevLengthRef.current = 0;
    }
  }, [room.id]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    if (isInitialLoadRef.current) {
      if (filteredMessages.length > 0) {
        el.scrollTop = el.scrollHeight;
        requestAnimationFrame(() => {
          if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
          }
        });
        setTimeout(() => {
          if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
          }
        }, 100);
        isInitialLoadRef.current = false;
        setHasNewMsg(false);
      }
    } else {
      const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 200;
      if (filteredMessages.length > prevLengthRef.current) {
        if (isAtBottom) {
          el.scrollTop = el.scrollHeight;
          setHasNewMsg(false);
        } else {
          setHasNewMsg(true);
        }
      }
    }
    prevLengthRef.current = filteredMessages.length;
  }, [filteredMessages.length, room.id]);

  const submit = async () => {
    const t = text.trim();
    if (!t && attachedFiles.length === 0) return;
    if (sendFile.isPending) return;

    if (attachedFiles.length > 0) {
      try {
        // 여러 장을 한 번에 — 하나씩 떨어져 올라가지 않고 한 묶음(그리드)으로 보이게
        await sendFile.mutateAsync({
          files: attachedFiles.map((f) => f.file),
          senderId: me,
          senderName: meName,
          text: t,
          replyTo: replyTo
            ? { id: replyTo.id, senderName: replyTo.senderName || '알 수 없음', text: msgPreview(replyTo as any) }
            : null,
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
        replyTo: replyTo
          ? { id: replyTo.id, senderName: replyTo.senderName || '알 수 없음', text: msgPreview(replyTo as any) }
          : null,
      });
      setText('');
      setReplyTo(null);
    }
  };

  const handlePaste = (e: React.ClipboardEvent<any>) => {
    if (readonly) return;
    const items = e.clipboardData?.items;
    if (!items || items.length === 0) return;

    const imageFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          const ext = file.type.split('/')[1] || 'png';
          const namedFile = new File(
            [file],
            `capture_${Date.now()}_${Math.random().toString(36).slice(2, 6)}_${i + 1}.${ext}`,
            { type: file.type }
          );
          imageFiles.push(namedFile);
        }
      }
    }

    if (imageFiles.length > 0) {
      e.preventDefault();
      handleFilesAttach(imageFiles);
    }
  };

  if (inviting) {
    return <InviteView room={room} meName={meName} onCancel={() => setInviting(false)} onDone={() => setInviting(false)} />;
  }

  return (
    <div className="flex h-full w-full bg-white relative">
      {showFileBox ? (
        <DesktopFileBoxPanel
          files={filesInRoom}
          onClose={() => setShowFileBox(false)}
          onOpenImage={(att) => setViewer({ attachments: [att], initialIdx: 0 })}
        />
      ) : (
        <div
          onDragOver={handleDragOver}
          onPaste={handlePaste}
          className="flex-1 flex h-full flex-col relative min-w-0"
        >
      {isDragging && !readonly && (
        <div
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(false); }}
          onDrop={handleDrop}
          className="absolute inset-0 z-[60] flex flex-col items-center justify-center bg-[#f2f8fc]/95 backdrop-blur-xs border-2 border-dashed border-amber m-2 rounded-2xl"
        >
          <Download size={32} className="text-amber mb-2" />
          <div className="text-[13px] font-extrabold text-[#1c2536]">여기에 파일을 놓아 전송</div>
          <div className="text-[10.5px] text-ink3 mt-1">최대 {Math.floor(MAX_ATTACHMENT_BYTES / 1024 / 1024)}MB</div>
        </div>
      )}

      {(() => {
        const isDirect = room.type === 'direct';
        const otherId = isDirect ? room.members.find((m) => m !== me) : null;
        const otherPresence = otherId ? presenceMap[otherId] : null;

        return (
          <div className="flex shrink-0 items-center gap-2.5 border-b border-border bg-panel px-2.5 py-2.5">
            <button onClick={onBack} title="목록" className="grid h-7 w-7 place-items-center rounded-lg text-[16px] text-ink2 hover:bg-panel-alt">←</button>
            <div className="relative shrink-0">
              <span className="grid h-8 w-8 place-items-center rounded-[10px] text-[14px] font-bold" style={{ background: room.color + '22', color: room.color }}>
                {isDirect ? displayName[0] : '👥'}
              </span>
              {isDirect && <PresenceDot presence={otherPresence} size="md" />}
            </div>
            <div className="min-w-0 flex-1 ml-0.5">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="truncate text-[12.5px] font-bold text-ink">{displayName}</span>
                {isDirect && otherPresence && (
                  <PresenceBadge presence={otherPresence} showMessage={false} size="xs" />
                )}
                {room.type === 'group' && room.createdBy === me && (
                  <button
                    onClick={handleRenameRoom}
                    title="대화방 이름 변경"
                    className="opacity-60 hover:opacity-100 hover:text-teal transition-all shrink-0 cursor-pointer p-0.5"
                  >
                    <Pencil size={11} />
                  </button>
                )}
              </div>
              {room.type !== 'direct' ? (
                <button
                  onClick={() => setShowMemberList((prev) => !prev)}
                  className="text-[10px] text-ink3 hover:text-teal font-semibold hover:underline transition-colors flex items-center gap-0.5"
                >
                  {room.members.length}명 {showMemberList ? '▲' : '▼'}
                </button>
              ) : otherPresence?.message ? (
                <div className="text-[10px] text-teal truncate font-medium">
                  {otherPresence.message}
                </div>
              ) : null}
            </div>
            <button
              onClick={() => {
                setShowSearch((prev) => !prev);
                if (showSearch) setSearchQuery('');
              }}
              title="대화 검색"
              className={`grid h-7 w-7 place-items-center rounded-lg text-[15px] hover:bg-panel-alt ${showSearch ? 'text-amber bg-panel-alt' : 'text-ink2'}`}
            >
              🔍
            </button>
            <button
              onClick={() => {
                setShowFileBox((prev) => !prev);
              }}
              title="파일함 모아보기"
              className={`grid h-7 w-7 place-items-center rounded-lg text-[14px] hover:bg-panel-alt ${showFileBox ? 'text-amber bg-panel-alt' : 'text-ink2'}`}
            >
              📁
            </button>
            {room.type === 'group' && (
              <button onClick={() => setInviting(true)} title="멤버 초대" className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[17px] leading-none text-ink2 hover:bg-panel-alt">＋</button>
            )}
            {(canLeave || canDelete || room.type === 'direct') && (
              <div className="relative shrink-0">
                <button onClick={() => setMenuOpen((v) => !v)} title="더보기" className="grid h-7 w-7 place-items-center rounded-lg text-[16px] leading-none text-ink2 hover:bg-panel-alt">⋮</button>
                {menuOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                    <div className="absolute right-0 top-8 z-20 w-32 overflow-hidden rounded-lg border border-border bg-panel py-1 shadow-lg">
                      {canLeave && (
                        <button onClick={() => { setMenuOpen(false); onLeave(); }} className="block w-full px-3 py-2 text-left text-[12px] text-ink hover:bg-panel-alt">방 나가기</button>
                      )}
                      {canDelete && (
                        <button onClick={() => { setMenuOpen(false); onDelete(); }} className="block w-full px-3 py-2 text-left text-[12px] text-danger hover:bg-panel-alt">방 삭제</button>
                      )}
                      {room.type === 'direct' && (
                        <button onClick={() => { setMenuOpen(false); onDeleteDirect(); }} className="block w-full px-3 py-2 text-left text-[12px] text-danger hover:bg-panel-alt">채팅방 삭제</button>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {showMemberList && room.type !== 'direct' && (
        <div className="shrink-0 border-b border-[#d0e6f7] bg-[#f2f8fc] px-4 py-3 max-h-48 overflow-y-auto">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold text-ink2">대화방 참여자 ({memberDetails.length})</span>
            <button
              onClick={() => setShowMemberList(false)}
              className="text-[10px] text-ink3 hover:text-ink hover:underline"
            >
              닫기
            </button>
          </div>
          <div className="space-y-2">
            {memberDetails.map((m) => {
              const p = presenceMap[m.id];
              return (
                <div key={m.id} className="flex items-center justify-between gap-2 text-[11.5px]">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="relative shrink-0">
                      <span style={{ backgroundColor: getAvatarStyle(m.id).bg, color: getAvatarStyle(m.id).text }} className="grid h-6 w-6 place-items-center rounded-full text-[10px] font-bold">
                        {m.name?.[0] ?? '?'}
                      </span>
                      <PresenceDot presence={p} size="sm" />
                    </div>
                    <span className="font-semibold text-ink truncate">{m.name}</span>
                    <span className="text-[10px] text-ink3">{m.position ?? ''}</span>
                    <span className="text-[10px] text-ink3">/ {m.dept ?? ''}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {p && (
                      <PresenceBadge presence={p} showMessage={true} size="xs" />
                    )}
                    {canKick && m.id !== me && (
                      <button
                        type="button"
                        onClick={() => onKick(m.id, m.name)}
                        disabled={kick.isPending}
                        title={`${m.name}님 내보내기`}
                        className="cursor-pointer rounded-md border border-danger/30 px-1.5 py-0.5 text-[10px] font-bold text-danger hover:bg-danger/10 disabled:cursor-default disabled:opacity-50"
                      >
                        내보내기
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {showSearch && (
        <div className="shrink-0 border-b border-border bg-panel px-4 py-2 flex items-center gap-2">
          <div className="flex flex-1 items-center gap-2 rounded-full border border-border-hi bg-panel px-3 py-1.5">
            <Search size={12} className="text-ink3 shrink-0" />
            <input
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentSearchIdx(0);
              }}
              placeholder="메시지 또는 첨부파일명 검색..."
              className="w-full bg-transparent text-[11px] text-ink outline-none placeholder:text-ink3"
            />
            {searchQuery && (
              <button
                onClick={() => { setSearchQuery(''); setCurrentSearchIdx(0); }}
                className="text-ink3 hover:text-ink w-4 h-4 grid place-items-center rounded bg-black/5 cursor-pointer"
              >
                <X size={10} />
              </button>
            )}
          </div>
          {searchMatchIds.length > 0 && (
            <div className="flex items-center gap-1.5 shrink-0 text-[11px] font-bold text-ink2 bg-panel-alt rounded-full px-2.5 py-1 select-none">
              <button
                type="button"
                onClick={() => setCurrentSearchIdx((prev) => (prev - 1 + searchMatchIds.length) % searchMatchIds.length)}
                className="text-[13px] leading-none px-1 hover:text-ink active:scale-90 transition-transform cursor-pointer"
              >
                ◀
              </button>
              <span className="tabular-nums">
                {currentSearchIdx + 1}/{searchMatchIds.length}
              </span>
              <button
                type="button"
                onClick={() => setCurrentSearchIdx((prev) => (prev + 1) % searchMatchIds.length)}
                className="text-[13px] leading-none px-1 hover:text-ink active:scale-90 transition-transform cursor-pointer"
              >
                ▶
              </button>
            </div>
          )}
        </div>
      )}

      <div ref={scrollRef} onScroll={handleScroll} className="menu-scroll flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
        {processedItems.length === 0 && (
          <div className="py-12 text-center text-[11.5px] text-ink3">{searchQuery ? '검색된 메시지가 없습니다' : '대화 내용이 없습니다'}</div>
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
          const showDateDivider = !prevMsg || (() => {
            const d1 = new Date(m.at).toDateString();
            const d2 = prevMsg.at ? new Date(prevMsg.at).toDateString() : '';
            return d1 !== d2;
          })();
          // 같은 사람이 같은 분에 이어 보낸 메시지는 바짝 붙이고 프로필(이름·사진)은 첫 말풍선에만
          const groupedWithPrev = !showDateDivider && isGroupedWithPrevious(prevMsg, m);

          const formatDateDivider = (iso?: string) => {
            if (!iso) return '';
            const d = new Date(iso);
            if (isNaN(d.getTime())) return '';
            const y = d.getFullYear();
            const month = d.getMonth() + 1;
            const day = d.getDate();
            const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
            const dayName = dayNames[d.getDay()];
            return `${y}년 ${month}월 ${day}일 ${dayName}요일`;
          };

          return (
            <div key={m.id} id={`msg-${m.id}`} data-msg-ids={(item.bundleMessages ?? [m]).map((x) => x.id).join(' ')} className={`space-y-2.5 ${idx === 0 ? '' : groupedWithPrev ? 'mt-1' : 'mt-2.5'}`}>
              {showDateDivider && (
                <div className="my-3 flex justify-center">
                  <span className="rounded-full bg-panel-alt px-3.5 py-1 text-[10px] font-extrabold text-ink3 tracking-wider shadow-3xs border border-border/40 select-none">
                    📅 {formatDateDivider(m.at)}
                  </span>
                </div>
              )}
              {(() => {
                const curLastMsg = item.type === 'image-bundle' && item.bundleMessages && item.bundleMessages.length > 0
                  ? item.bundleMessages[item.bundleMessages.length - 1]
                  : item.message;

                const nextItem = idx < processedItems.length - 1 ? processedItems[idx + 1] : null;
                const nextFirstMsg = nextItem
                  ? (nextItem.type === 'image-bundle' && nextItem.bundleMessages && nextItem.bundleMessages.length > 0
                      ? nextItem.bundleMessages[0]
                      : nextItem.message)
                  : null;

                const hideTime = Boolean(
                  nextFirstMsg &&
                  nextFirstMsg.type !== 'system' &&
                  curLastMsg.type !== 'system' &&
                  nextFirstMsg.senderId === curLastMsg.senderId &&
                  isSameMinute(curLastMsg.at, nextFirstMsg.at)
                );
                const showTime = !hideTime;

                return item.type === 'image-bundle' && item.bundleMessages ? (
                  <ImageBundleBubble
                    bundle={item.bundleMessages}
                    me={me}
                    group={room.type === 'group'}
                    roomMembers={room.members}
                    onOpenImage={(att, list) => setViewer({ attachments: list, initialIdx: list.indexOf(att) })}
                    onReply={setReplyTo}
                    onJumpToMessage={jumpToMessage}
                    onToggleEmoji={handleToggleEmoji}
                    showTime={showTime}
                    showProfile={!groupedWithPrev}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const fontScaleStr = window.getComputedStyle(document.documentElement).getPropertyValue('--font-scale') || '1.1875';
                      const zoom = parseFloat(fontScaleStr) || 1.1875;
                      setActiveMenu({ m, x: e.clientX / zoom, y: e.clientY / zoom, mine: m.senderId === me });
                    }}
                  />
                ) : (
                  <MessageBubble
                    m={m}
                    me={me}
                    group={room.type === 'group'}
                    roomMembers={room.members}
                    onOpenImage={(att) => setViewer({ attachments: [att], initialIdx: 0 })}
                    onReply={setReplyTo}
                    onJumpToMessage={jumpToMessage}
                    isEditing={editingMsgId === m.id}
                    onStartEdit={() => setEditingMsgId(m.id)}
                    onCancelEdit={() => setEditingMsgId(null)}
                    onToggleEmoji={handleToggleEmoji}
                    searchQuery={searchQuery}
                    isSearchActive={searchMatchIds[currentSearchIdx] === m.id}
                    showTime={showTime}
                    showProfile={!groupedWithPrev}
                    onContextMenu={(e) => {
                      if (m.type === 'system') return;
                      e.preventDefault();
                      e.stopPropagation();
                      const fontScaleStr = window.getComputedStyle(document.documentElement).getPropertyValue('--font-scale') || '1.1875';
                      const zoom = parseFloat(fontScaleStr) || 1.1875;
                      setActiveMenu({ m, x: e.clientX / zoom, y: e.clientY / zoom, mine: m.senderId === me });
                    }}
                  />
                );
              })()}
            </div>
          );
        })}
        {filteredMessages.length === 0 && searchQuery && (
          <div className="py-12 text-center text-[11.5px] text-ink3">검색된 메시지가 없습니다</div>
        )}
      </div>
      {showScrollBtn && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-20 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1.5 rounded-full bg-white px-3.5 py-2.5 text-[11px] font-extrabold text-[#101830] shadow-lg border border-[#e2e8f0] active:scale-95 transition-all select-none animate-bounce whitespace-nowrap"
          style={{ boxShadow: '0 4px 12px rgba(16, 24, 48, 0.15)' }}
        >
          ⬇ 최근 메시지
          {hasNewMsg && (
            <span className="w-2.5 h-2.5 rounded-full bg-[#ff4d4f] shadow-[0_0_6px_#ff4d4f]" />
          )}
        </button>
      )}

      {viewer && <ImageViewer attachments={viewer.attachments} initialIdx={viewer.initialIdx} onClose={() => setViewer(null)} />}

      {readonly ? (
        <div className="shrink-0 border-t border-border bg-panel-alt px-4 py-3 text-center text-[11px] text-ink3">공지 전용 방입니다</div>
      ) : (
        <div className="shrink-0 border-t border-border bg-panel p-3">
          {replyTo && (
            <div className="mb-1.5 flex items-center gap-2 rounded-lg border-l-[3px] border-amber bg-panel-alt px-2.5 py-1.5">
              <div className="min-w-0 flex-1">
                <div className="text-[10.5px] font-bold text-amber">{(replyTo.senderName || '메시지')}에게 답장</div>
                <div className="truncate text-[11px] text-ink3">{msgPreview(replyTo as any)}</div>
              </div>
              <button onClick={() => setReplyTo(null)} title="답장 취소" className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-ink3 hover:bg-black/5">
                <X size={13} />
              </button>
            </div>
          )}
          {attachedFiles.length > 0 && (
            <div className="mb-2 space-y-1.5 border-b border-border pb-2 px-1">
              <div className="flex items-center justify-between text-[10px] text-ink3 font-medium">
                <span className="flex items-center gap-1.5 font-bold text-ink2">
                  <span className="flex items-center gap-1"><Paperclip size={11} className="shrink-0 text-ink3" /> 첨부 {attachedFiles.length}개</span>
                  <span>· 보존기한:</span>
                  <select
                    value={attachmentRetention}
                    onChange={(e) => setAttachmentRetention(e.target.value as any)}
                    className="rounded border border-border bg-panel px-1.5 py-0.5 text-[10px] font-bold text-teal outline-none"
                  >
                    <option value="30d">30일 (기본)</option>
                    <option value="90d">90일 (3개월)</option>
                    <option value="180d">180일 (6개월)</option>
                    <option value="1y">1년</option>
                    <option value="permanent">영구보존</option>
                  </select>
                </span>
                <span className="text-[9.5px] text-amber font-semibold">
                  {attachmentRetention === 'permanent' ? '영구 보관' : `기한 만료 시 자동 파기`}
                </span>
              </div>
              <div className="flex flex-wrap gap-2 max-h-36 overflow-y-auto py-0.5">
                {attachedFiles.map((item) => (
                  <div key={item.id} className="relative w-14 h-14 rounded-lg border border-border-hi bg-panel-alt overflow-hidden flex items-center justify-center shrink-0 shadow-3xs">
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
                      className="absolute top-0.5 right-0.5 bg-black/60 hover:bg-black/80 text-white rounded-full w-4 h-4 grid place-items-center transition-colors"
                    >
                      <X size={9} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-end gap-1.5 rounded-2xl border border-border-hi bg-panel py-1 pl-2 pr-1.5">
            <input ref={fileRef} type="file" multiple className="hidden" onChange={onPickFile} />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={sendFile.isPending}
              title={`파일 첨부 (최대 ${Math.floor(MAX_ATTACHMENT_BYTES / 1024 / 1024)}MB)`}
              className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full text-ink3 hover:bg-panel-alt disabled:opacity-40 select-none mb-0.5"
            >
              <Paperclip size={16} />
            </button>
            <textarea
              ref={textareaRef}
              rows={1}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onPaste={handlePaste}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder={sendFile.isPending ? '파일 전송 중…' : '메시지를 입력하세요…'}
              className="flex-1 bg-transparent text-[12px] text-ink outline-none placeholder:text-ink3 resize-none min-h-[24px] max-h-[84px] py-1 leading-normal menu-scroll"
              style={{ overflowY: text.split('\n').length > 3 ? 'auto' : 'hidden' }}
            />
            <button
              type="button"
              onClick={submit}
              className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full bg-amber text-[14px] text-white select-none hover:bg-amber-dark transition-colors mb-0.5"
            >
              ↑
            </button>
          </div>
        </div>
      )}
      </div>
      )}
      {activeMenu && (
        <MessageContextMenuPortal
          activeMenu={activeMenu}
          me={me}
          onClose={() => setActiveMenu(null)}
          onToggleEmoji={handleToggleEmoji}
          onReply={(msg) => setReplyTo(msg)}
          onForward={(msg) => setForwardMessage(msg)}
          onStartEdit={(msgId) => setEditingMsgId(msgId)}
          onDownload={(att) => downloadAttachment(att)}
          onDelete={(msg) => void handleDeleteMessage(msg)}
        />
      )}
      {forwardMessage && createPortal(
        <DesktopForwardModal
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
    </div>
  );
}


function MessageContextMenuPortal({
  activeMenu,
  me,
  onClose,
  onToggleEmoji,
  onReply,
  onForward,
  onStartEdit,
  onDownload,
  onDelete,
}: {
  activeMenu: { m: ChatMessage; x: number; y: number; mine: boolean };
  me: string;
  onClose: () => void;
  onToggleEmoji: (msgId: string, emoji: string) => void;
  onReply: (m: ChatMessage) => void;
  onForward: (m: ChatMessage) => void;
  onStartEdit: (msgId: string) => void;
  onDownload: (att: Attachment) => void;
  onDelete: (m: ChatMessage) => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  // 삭제 가능 여부는 공용 규칙 하나로 판단(본인·24시간·일반/사진/파일)
  const canDelete = canDeleteMessage(activeMenu.m, me, new Date()).allowed;
  const deleteButton = canDelete ? (
    <button
      onClick={() => { onClose(); onDelete(activeMenu.m); }}
      className="w-full px-3 py-1.5 text-left hover:bg-black/5 transition-colors text-danger cursor-pointer"
    >
      삭제
    </button>
  ) : null;
  const [pos, setPos] = useState({ x: activeMenu.x, y: activeMenu.y });

  useEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const fontScaleStr = window.getComputedStyle(document.documentElement).getPropertyValue('--font-scale') || '1.1875';
    const zoom = parseFloat(fontScaleStr) || 1.1875;

    const vWidth = window.innerWidth / zoom;
    const vHeight = window.innerHeight / zoom;

    let targetX = activeMenu.x;
    let targetY = activeMenu.y;

    const menuW = rect.width / zoom;
    const menuH = rect.height / zoom;

    // 하단 경계 넘침 시 위쪽 방향으로 반전
    if (targetY + menuH > vHeight - 12) {
      targetY = Math.max(12, targetY - menuH);
    }
    // 우측 경계 넘침 시 왼쪽 방향으로 반전
    if (targetX + menuW > vWidth - 12) {
      targetX = Math.max(12, targetX - menuW);
    }

    setPos({ x: targetX, y: targetY });
  }, [activeMenu]);

  return createPortal(
    <div
      ref={menuRef}
      style={{
        top: `${pos.y}px`,
        left: `${pos.x}px`,
        backgroundColor: '#ffffff',
        color: '#1c2536',
        border: '1px solid #e2e8f0',
        boxShadow: '0 4px 16px rgba(16, 24, 48, 0.18)',
        right: 'auto',
        bottom: 'auto',
        margin: 0,
      }}
      className="fixed z-[99999] min-w-[150px] rounded-lg py-1 text-[11.5px] font-medium outline-none select-none animate-in fade-in zoom-in-95 duration-75"
      onClick={onClose}
    >
      {/* 이모지 리액션 단축 5종 */}
      <div className="flex items-center justify-around border-b border-border/40 px-2 py-1 bg-panel-alt/30" onClick={(e) => e.stopPropagation()}>
        {['👍', '❤️', '😄', '😮', '😢'].map((emoji) => {
          const list = (activeMenu.m.reactions as Record<string, string[]> | undefined)?.[emoji] ?? [];
          const active = list.includes(me);
          return (
            <button
              key={emoji}
              onClick={() => {
                onToggleEmoji(activeMenu.m.id, emoji);
                onClose();
              }}
              className="grid h-6 w-6 place-items-center text-[13px] rounded-md hover:bg-black/5 active:bg-black/10 transition-colors"
              style={active ? { background: '#e6960c20' } : undefined}
            >
              {emoji}
            </button>
          );
        })}
      </div>

      {activeMenu.m.type === 'text' ? (
        <>
          <button
            onClick={() => {
              navigator.clipboard.writeText(activeMenu.m.text);
            }}
            className="w-full px-3 py-1.5 text-left hover:bg-black/5 transition-colors cursor-pointer"
          >
            메시지 복사
          </button>
          <button
            onClick={() => onReply(activeMenu.m)}
            className="w-full px-3 py-1.5 text-left hover:bg-black/5 transition-colors cursor-pointer"
          >
            답장
          </button>
          <button
            onClick={() => onForward(activeMenu.m)}
            className="w-full px-3 py-1.5 text-left hover:bg-black/5 transition-colors cursor-pointer"
          >
            전달
          </button>
          {activeMenu.mine && (
            <button
              onClick={() => onStartEdit(activeMenu.m.id)}
              className="w-full px-3 py-1.5 text-left hover:bg-black/5 transition-colors text-teal cursor-pointer"
            >
              수정
            </button>
          )}
          {deleteButton}
        </>
      ) : (
        <>
          <button
            onClick={() => onReply(activeMenu.m)}
            className="w-full px-3 py-1.5 text-left hover:bg-black/5 transition-colors cursor-pointer"
          >
            답장
          </button>
          <button
            onClick={() => onForward(activeMenu.m)}
            className="w-full px-3 py-1.5 text-left hover:bg-black/5 transition-colors cursor-pointer"
          >
            전달
          </button>
          {activeMenu.m.attachment && (
            <button
              onClick={() => onDownload(activeMenu.m.attachment!)}
              className="w-full px-3 py-1.5 text-left hover:bg-black/5 transition-colors cursor-pointer"
            >
              다운로드
            </button>
          )}
          {deleteButton}
        </>
      )}
    </div>,
    document.body
  );
}

function ImageBundleBubble({
  bundle,
  me,
  group,
  roomMembers,
  onOpenImage,
  onReply,
  onJumpToMessage,
  onContextMenu,
  onToggleEmoji,
  showTime = true,
  showProfile = true,
}: {
  bundle: ChatMessage[];
  me: string;
  group: boolean;
  roomMembers: string[];
  onOpenImage: (att: Attachment, list: Attachment[]) => void;
  onReply: (m: ChatMessage) => void;
  /** 답장 인용 클릭 → 원본 메시지로 이동 */
  onJumpToMessage?: (messageId: string) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onToggleEmoji?: (messageId: string, emoji: string) => void;
  showTime?: boolean;
  /** 앞 말풍선과 이어지면 false — 프로필 사진·이름을 숨기고 자리만 둔다 */
  showProfile?: boolean;
}) {
  const m = bundle[0];
  const presenceMap = useAllUserPresences();
  const mine = m.senderId === me;
  const unreadCount = roomMembers.filter((uid) => uid !== m.senderId && !m.readBy.includes(uid)).length;

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
    return <ImageBundleGrid attachments={attachments} onOpen={onOpenImage} className="border-border" />;
  };

  // 안읽음 수·시간은 말풍선 바로 옆(아래 맞춤)에 붙인다 — 시간을 숨긴 말풍선에서도 숫자가 떨어져 보이지 않게
  const hasMeta = (mine && unreadCount > 0) || showTime;
  const bubbleMeta = hasMeta ? (
    <div className={`flex shrink-0 flex-col gap-0.5 pb-0.5 leading-none ${mine ? 'items-end' : 'items-start'}`}>
      {mine && unreadCount > 0 && (
        <span className="text-[9.5px] font-extrabold" style={{ color: '#1890ff' }}>
          {unreadCount}
        </span>
      )}
      {showTime && <span className="text-[9.5px] tabular-nums text-ink3">{fmtBubbleTime(m.at)}</span>}
    </div>
  ) : null;

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
        <div className="group min-w-0">
          {!mine && group && showProfile && <div className="mb-0.5 text-[10px] text-ink3">{m.senderName}</div>}
          {m.replyTo && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onJumpToMessage?.(m.replyTo!.id);
              }}
              title="원본 메시지로 이동"
              className={`mb-1 block w-full cursor-pointer rounded-md border-l-2 px-2 py-1 text-left transition-[filter] hover:brightness-95 ${mine ? 'border-amber/70 bg-black/[0.06]' : 'border-border-hi bg-panel-alt'}`}
            >
              <div className="text-[9.5px] font-bold text-ink2">{m.replyTo.senderName || '메시지'}</div>
              <div className="truncate text-[10.5px] text-ink3">{m.replyTo.text}</div>
            </button>
          )}
          <div
            className={`flex items-end gap-1 ${mine ? 'flex-row-reverse' : 'flex-row'}`}
            onContextMenu={onContextMenu}
          >
            {renderGrid()}
            {bubbleMeta}
            <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                onClick={() => onReply(m)}
                title="답글"
                className="grid h-6 w-6 place-items-center rounded-full text-[12px] text-ink3 hover:bg-panel-alt"
              >
                ↩
              </button>
            </div>
          </div>
          {m.reactions && Object.keys(m.reactions as Record<string, string[]>).length > 0 && (
            <div className={`mt-1 flex flex-wrap gap-1 ${mine ? 'justify-end' : 'justify-start'}`}>
              {Object.entries(m.reactions as Record<string, string[]>).map(([emoji, uids]) => {
                if (!uids || uids.length === 0) return null;
                const active = uids.includes(me);
                return (
                  <button
                    key={emoji}
                    onClick={() => onToggleEmoji?.(m.id, emoji)}
                    className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9.5px] font-bold shadow-3xs transition-all hover:scale-105"
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
  onReply,
  onJumpToMessage,
  isEditing,
  onStartEdit: _onStartEdit,
  onCancelEdit,
  onContextMenu,
  onToggleEmoji,
  searchQuery = '',
  isSearchActive = false,
  showTime = true,
  showProfile = true,
}: {
  m: ChatMessage;
  me: string;
  group: boolean;
  roomMembers: string[];
  onOpenImage: (att: Attachment, list: Attachment[]) => void;
  onReply: (m: ChatMessage) => void;
  /** 답장 인용 클릭 → 원본 메시지로 이동 */
  onJumpToMessage?: (messageId: string) => void;
  isEditing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onToggleEmoji?: (messageId: string, emoji: string) => void;
  searchQuery?: string;
  isSearchActive?: boolean;
  showTime?: boolean;
  /** 앞 말풍선과 이어지면 false — 프로필 사진·이름을 숨기고 자리만 둔다 */
  showProfile?: boolean;
}) {
  const [editVal, setEditVal] = useState(m.text);
  const editMsg = useEditMessage(m.roomId);
  const presenceMap = useAllUserPresences();

  useEffect(() => {
    setEditVal(m.text);
  }, [m.text]);

  if (m.type === 'system') {
    return (
      <div className="my-1 flex justify-center">
        <span className="rounded-full bg-panel-alt px-3 py-1 text-[10.5px] text-ink3">{m.text}</span>
      </div>
    );
  }
  const mine = m.senderId === me;
  const att = m.attachment;

  const fmtBubbleTime = (iso?: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const unreadCount = roomMembers.filter((uid) => uid !== m.senderId && !m.readBy.includes(uid)).length;

  let body: ReactNode;
  if (isEditing) {
    body = (
      <div className="flex flex-col gap-1 w-full min-w-[180px]">
        <textarea
          value={editVal}
          onChange={(e) => setEditVal(e.target.value)}
          className="w-full bg-[#f8fbfe] text-[11.5px] text-ink border border-[#bae0ff] rounded-lg px-2 py-1.5 outline-none resize-none"
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
        <div className="flex justify-end gap-1 text-[9.5px]">
          <button
            onClick={() => { onCancelEdit(); setEditVal(m.text); }}
            className="px-1.5 py-0.5 bg-[#bae0ff]/30 text-ink2 rounded hover:bg-[#bae0ff]/50"
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
            className="px-1.5 py-0.5 bg-amber text-white rounded hover:bg-amber-dark disabled:opacity-50"
          >
            {editMsg.isPending ? '...' : '저장'}
          </button>
        </div>
      </div>
    );
  } else if (m.type === 'image' && att) {
    body = (
      <div className="flex flex-col gap-1.5" onContextMenu={onContextMenu}>
        <button onClick={() => onOpenImage(att, [att])} title="크게 보기" className="block cursor-zoom-in overflow-hidden rounded-xl border border-border">
          <img src={att.url} alt={att.name} className="max-h-52 w-auto max-w-full object-cover" />
        </button>
        {m.text && (
          <div
            style={mine ? { backgroundColor: '#bae0ff', color: '#1c2536' } : undefined}
            className={`whitespace-pre-wrap break-words [word-break:break-word] max-w-full min-w-0 rounded-xl px-3 py-2.5 text-[12px] leading-relaxed shadow-[0_1px_2px_rgba(16,24,48,0.05)] select-text cursor-text ${mine ? '' : 'border border-border bg-panel text-ink'}`}
          >
            {renderHighlightedText(m.text, searchQuery, isSearchActive)}
          </div>
        )}
      </div>
    );
  } else if (m.type === 'file' && att) {
    body = (
      <div className="flex flex-col gap-1.5 min-w-0 max-w-full" onContextMenu={onContextMenu}>
        <button
          type="button"
          onClick={() => downloadAttachment(att)}
          title={`${att.name} 다운로드`}
          style={mine ? { backgroundColor: '#bae0ff', color: '#1c2536' } : undefined}
          className={`flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2.5 text-left shadow-[0_1px_2px_rgba(16,24,48,0.05)] transition-[filter] hover:brightness-95 select-text min-w-0 max-w-full ${mine ? '' : 'border border-border bg-panel text-ink'}`}
        >
          <span className="text-[18px] shrink-0">📄</span>
          <span className="min-w-0 flex-1">
            <span className="block max-w-[220px] truncate text-[12px] font-semibold">{att.name}</span>
            <span className={`block text-[10px] ${mine ? 'opacity-85' : 'text-ink3'}`}>{fmtSize(att.size)} · 다운로드</span>
          </span>
        </button>
        {m.text && (
          <div
            style={mine ? { backgroundColor: '#bae0ff', color: '#1c2536' } : undefined}
            className={`whitespace-pre-wrap break-words [word-break:break-word] max-w-full min-w-0 rounded-xl px-3 py-2.5 text-[12px] leading-relaxed shadow-[0_1px_2px_rgba(16,24,48,0.05)] select-text cursor-text ${mine ? '' : 'border border-border bg-panel text-ink'}`}
          >
            {renderHighlightedText(m.text, searchQuery, isSearchActive)}
          </div>
        )}
      </div>
    );
  } else if (isDeletedMessage(m)) {
    // 삭제된 메시지 — 내용 없이 안내만, 메뉴(복사·답장·전달·수정·삭제)는 열지 않는다
    body = (
      <div className="rounded-xl border border-dashed border-border px-3 py-2 text-[11.5px] italic text-ink3 select-none min-w-0 max-w-full">
        {DELETED_MESSAGE_TEXT}
      </div>
    );
  } else {
    body = (
      <div
        style={mine ? { backgroundColor: '#bae0ff', color: '#1c2536' } : undefined}
        className={`whitespace-pre-wrap break-words [word-break:break-word] max-w-full min-w-0 rounded-xl px-3 py-2.5 text-[12px] leading-relaxed shadow-[0_1px_2px_rgba(16,24,48,0.05)] select-text cursor-text ${mine ? '' : 'border border-border bg-panel text-ink'}`}
        onContextMenu={onContextMenu}
      >
        {renderHighlightedText(m.text, searchQuery, isSearchActive)}
      </div>
    );
  }

  // 안읽음 수·시간은 말풍선 바로 옆(아래 맞춤)에 붙인다 — 시간을 숨긴 말풍선에서도 숫자가 떨어져 보이지 않게
  const hasMeta = (mine && unreadCount > 0) || showTime || m.isEdited;
  const bubbleMeta = hasMeta ? (
    <div className={`flex shrink-0 flex-col gap-0.5 pb-0.5 leading-none ${mine ? 'items-end' : 'items-start'}`}>
      {mine && unreadCount > 0 && (
        <span className="text-[9.5px] font-extrabold" style={{ color: '#1890ff' }}>
          {unreadCount}
        </span>
      )}
      {m.isEdited && <span className="text-[8.5px] font-medium text-ink3/80 select-none">(수정됨)</span>}
      {showTime && <span className="text-[9.5px] tabular-nums text-ink3">{fmtBubbleTime(m.at)}</span>}
    </div>
  ) : null;

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
        <div className="group min-w-0">
          {!mine && group && showProfile && <div className="mb-0.5 text-[10px] text-ink3">{m.senderName}</div>}
          {m.replyTo && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onJumpToMessage?.(m.replyTo!.id);
              }}
              title="원본 메시지로 이동"
              className={`mb-1 block w-full cursor-pointer rounded-md border-l-2 px-2 py-1 text-left transition-[filter] hover:brightness-95 ${mine ? 'border-amber/70 bg-black/[0.06]' : 'border-border-hi bg-panel-alt'}`}
            >
              <div className="text-[9.5px] font-bold text-ink2">{m.replyTo.senderName || '메시지'}</div>
              <div className="truncate text-[10.5px] text-ink3">{m.replyTo.text}</div>
            </button>
          )}
          <div
            className={`flex items-end gap-1 ${mine ? 'flex-row-reverse' : 'flex-row'}`}
          >
            {body}
            {bubbleMeta}
            <div className={`flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 ${isDeletedMessage(m) ? 'hidden' : ''}`}>
              <button
                onClick={() => onReply(m)}
                title="답글"
                className="grid h-6 w-6 place-items-center rounded-full text-[12px] text-ink3 hover:bg-panel-alt"
              >
                ↩
              </button>
            </div>
          </div>
          {m.reactions && Object.keys(m.reactions as Record<string, string[]>).length > 0 && (
            <div className={`mt-1 flex flex-wrap gap-1 ${mine ? 'justify-end' : 'justify-start'}`}>
              {Object.entries(m.reactions as Record<string, string[]>).map(([emoji, uids]) => {
                if (!uids || uids.length === 0) return null;
                const active = uids.includes(me);
                return (
                  <button
                    key={emoji}
                    onClick={() => onToggleEmoji?.(m.id, emoji)}
                    className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9.5px] font-bold shadow-3xs transition-all hover:scale-105"
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
const ZOOM_MAX = 6;

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
  const [panning, setPanning] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const drag = useRef({ startX: 0, startY: 0, baseTx: 0, baseTy: 0, moved: false });

  // 사진이 변경되면 드래그/패닝 배율 상태 초기화
  useEffect(() => { setZ({ scale: 1, tx: 0, ty: 0 }); }, [currentIdx]);

  const clamp = (n: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, n));

  const applyZoom = useCallback((calc: (prev: number) => number, cx?: number, cy?: number) => {
    setZ((prev) => {
      const s2 = clamp(calc(prev.scale));
      if (s2 === prev.scale) return prev;
      if (s2 <= ZOOM_MIN) return { scale: ZOOM_MIN, tx: 0, ty: 0 };
      const el = containerRef.current;
      let { tx, ty } = prev;
      if (el) {
        const r = el.getBoundingClientRect();
        const dx = (cx ?? r.left + r.width / 2) - (r.left + r.width / 2);
        const dy = (cy ?? r.top + r.height / 2) - (r.top + r.height / 2);
        const k = s2 / prev.scale;
        tx = tx * k + dx * (1 - k);
        ty = ty * k + dy * (1 - k);
      }
      return { scale: s2, tx, ty };
    });
  }, []);

  const reset = useCallback(() => setZ({ scale: 1, tx: 0, ty: 0 }), []);

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
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && hasPrev) setCurrentIdx((prev) => prev - 1);
      else if (e.key === 'ArrowRight' && hasNext) setCurrentIdx((prev) => prev + 1);
      else if (e.key === '+' || e.key === '=') applyZoom((s) => s * 1.4);
      else if (e.key === '-' || e.key === '_') applyZoom((s) => s / 1.4);
      else if (e.key === '0') reset();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, applyZoom, reset, hasPrev, hasNext]);

  const onWheel = (e: WheelEvent) => {
    applyZoom((s) => s * Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
  };
  const onDoubleClick = (e: MouseEvent) => {
    applyZoom((s) => (s > 1 ? 1 : 2.5), e.clientX, e.clientY);
  };
  const onPointerDown = (e: PointerEvent) => {
    if (z.scale <= 1) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startY: e.clientY, baseTx: z.tx, baseTy: z.ty, moved: false };
    setPanning(true);
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!panning) return;
    const dx = e.clientX - drag.current.startX;
    const dy = e.clientY - drag.current.startY;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.current.moved = true;
    setZ((prev) => ({ ...prev, tx: drag.current.baseTx + dx, ty: drag.current.baseTy + dy }));
  };
  const onPointerUp = (e: PointerEvent) => {
    if (!panning) return;
    setPanning(false);
    if (drag.current.moved) e.stopPropagation();
  };

  const pct = Math.round(z.scale * 100);

  if (!att) return null;

  return createPortal(
    <div
      ref={containerRef}
      onClick={onClose}
      onWheel={onWheel}
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center overflow-hidden bg-black/85 p-6"
    >
      <div className="absolute left-0 right-0 top-0 flex items-center gap-3 px-4 py-3 text-white" onClick={(e) => e.stopPropagation()}>
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">
          {att.name} {attachments.length > 1 ? `(${currentIdx + 1}/${attachments.length})` : ''}
        </span>
        <button
          type="button"
          onClick={() => downloadAttachment(att)}
          title="다운로드"
          className="grid h-8 w-8 cursor-pointer place-items-center rounded-lg bg-white/15 text-[15px] hover:bg-white/25"
        >
          ⤓
        </button>
        <button onClick={onClose} title="닫기(Esc)" className="grid h-8 w-8 place-items-center rounded-lg bg-white/15 hover:bg-white/25">
          <X size={18} />
        </button>
      </div>

      <div className="relative flex w-full max-w-full items-center justify-center h-[75vh]" onClick={(e) => e.stopPropagation()}>
        {hasPrev && (
          <button
            onClick={handlePrev}
            title="이전 사진 (←)"
            className="absolute left-4 z-20 grid h-12 w-12 place-items-center rounded-full bg-black/40 text-[22px] text-white hover:bg-black/60 active:scale-95 transition-all select-none"
          >
            ◀
          </button>
        )}
        <img
          src={att.url}
          alt={att.name}
          draggable={false}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={onDoubleClick}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          style={{
            transform: `translate(${z.tx}px, ${z.ty}px) scale(${z.scale})`,
            transformOrigin: 'center center',
            transition: panning ? 'none' : 'transform 120ms ease-out',
            cursor: z.scale > 1 ? (panning ? 'grabbing' : 'grab') : 'zoom-in',
            touchAction: 'none',
          }}
          className="max-h-full max-w-full select-none rounded-lg object-contain shadow-2xl"
        />
        {hasNext && (
          <button
            onClick={handleNext}
            title="다음 사진 (→)"
            className="absolute right-4 z-20 grid h-12 w-12 place-items-center rounded-full bg-black/40 text-[22px] text-white hover:bg-black/60 active:scale-95 transition-all select-none"
          >
            ▶
          </button>
        )}
      </div>

      <div
        className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-xl bg-white/12 px-1.5 py-1 text-white backdrop-blur"
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={() => applyZoom((s) => s / 1.4)} title="축소(−)" className="grid h-8 w-8 place-items-center rounded-lg text-[17px] hover:bg-white/20">－</button>
        <button onClick={reset} title="원본(0)" className="min-w-[52px] rounded-lg px-2 py-1 text-[12px] font-semibold tabular-nums hover:bg-white/20">{pct}%</button>
        <button onClick={() => applyZoom((s) => s * 1.4)} title="확대(+)" className="grid h-8 w-8 place-items-center rounded-lg text-[17px] hover:bg-white/20">＋</button>
      </div>
    </div>,
    document.body,
  );
}

function OrgTreeNode({
  node,
  exclude,
  selected,
  onToggle,
  expanded,
  toggleExpand,
  isExpanded,
}: {
  node: OrgNode;
  exclude: string[];
  selected: string[];
  onToggle: (id: string) => void;
  expanded: Record<string, boolean>;
  toggleExpand: (id: string) => void;
  isExpanded: (id: string) => boolean;
}) {
  const { rankOf } = useOrgTree();
  const presenceMap = useAllUserPresences();
  const show = isExpanded(node.dept.id);
  const deptUsers = useMemo(() => {
    const filtered = node.members.filter((u) => u.status === '사용' && !exclude.includes(u.id));
    return filtered.sort((a, b) => rankOf(a.position) - rankOf(b.position));
  }, [node.members, exclude, rankOf]);

  const hasContent = deptUsers.length > 0 || node.children.length > 0;
  if (!hasContent) return null;

  return (
    <div className="flex flex-col mt-0.5">
      <div
        onClick={() => toggleExpand(node.dept.id)}
        className="flex items-center gap-1.5 py-1.5 px-2 rounded-lg cursor-pointer hover:bg-black/5"
      >
        <span className="text-[10px] text-ink3 w-3 h-3 grid place-items-center">
          {show ? '▼' : '▶'}
        </span>
        <span className="text-[12px] font-bold text-ink2">{node.dept.name}</span>
        <span className="text-[10px] text-ink3">({node.members.filter((u) => u.status === '사용').length})</span>
      </div>

      {show && (
        <div className="flex flex-col pl-3.5 border-l border-border/50 ml-3.5 my-0.5 gap-0.5">
          {deptUsers.map((u) => {
            const on = selected.includes(u.id);
            const p = presenceMap[u.id];
            return (
              <button
                key={u.id}
                onClick={() => onToggle(u.id)}
                className="flex items-center gap-3 py-1.5 px-2 rounded-lg text-left hover:bg-panel-alt transition-colors w-full"
              >
                <div className="relative shrink-0">
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-teal-soft text-[11px] font-bold text-teal">
                    {u.name[0]}
                  </span>
                  <PresenceDot presence={p} size="sm" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[12px] font-medium text-ink">{u.name}</span>
                    <span className="text-[10px] text-ink3">{u.position}</span>
                    {p && p.status !== 'OFFLINE' && (
                      <PresenceBadge presence={p} showMessage={false} size="xs" />
                    )}
                  </div>
                  {p?.message && (
                    <div className="text-[9.5px] text-ink3 truncate font-normal mt-0.5">
                      {p.message}
                    </div>
                  )}
                </div>
                <span className={`grid h-[17px] w-[17px] shrink-0 place-items-center rounded-full border text-[9px] font-bold ${on ? 'border-amber bg-amber text-white' : 'border-border-hi text-transparent'}`}>✓</span>
              </button>
            );
          })}

          {node.children.map((child) => (
            <OrgTreeNode
              key={child.dept.id}
              node={child}
              exclude={exclude}
              selected={selected}
              onToggle={onToggle}
              expanded={expanded}
              toggleExpand={toggleExpand}
              isExpanded={isExpanded}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MemberPicker({ exclude, selected, onToggle }: { exclude: string[]; selected: string[]; onToggle: (id: string) => void }) {
  const { roots, isLoading } = useOrgTree();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const toggleExpand = (id: string) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  const isExpanded = (id: string) => expanded[id] !== false;

  if (isLoading) {
    return <div className="p-10 text-center text-[12px] text-ink3">조직도를 불러오는 중...</div>;
  }

  return (
    <div className="p-3.5 flex flex-col gap-0.5 select-none">
      {roots.map((root) => (
        <OrgTreeNode
          key={root.dept.id}
          node={root}
          exclude={exclude}
          selected={selected}
          onToggle={onToggle}
          expanded={expanded}
          toggleExpand={toggleExpand}
          isExpanded={isExpanded}
        />
      ))}
    </div>
  );
}

function NewRoomView({ me, onCancel, onCreated }: { me: string; onCancel: () => void; onCreated: (id: string) => void }) {
  const { data: users = [] } = useUsers();
  const create = useCreateRoom();
  const [selected, setSelected] = useState<string[]>([]);
  const [name, setName] = useState('');
  const isGroup = selected.length >= 2;
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const pickedNames = users.filter((u) => selected.includes(u.id)).map((u) => u.name);

  const submit = async () => {
    if (!selected.length || create.isPending) return;
    const roomName = isGroup ? (name.trim() || pickedNames.join(', ')) : (pickedNames[0] ?? '새 대화');
    const room = await create.mutateAsync({
      name: roomName,
      type: isGroup ? 'group' : 'direct',
      members: [me, ...selected],
    });
    onCreated(room.id);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2.5 border-b border-border bg-panel px-3 py-2.5">
        <button onClick={onCancel} title="취소" className="grid h-7 w-7 place-items-center rounded-lg text-[16px] text-ink2 hover:bg-panel-alt">←</button>
        <div className="flex-1 text-[12.5px] font-bold text-ink">새 대화</div>
        <button
          onClick={submit}
          disabled={!selected.length || create.isPending}
          className="rounded-lg bg-amber px-3 py-1.5 text-[11.5px] font-bold text-white transition-opacity disabled:opacity-40"
        >
          {isGroup ? `그룹 만들기 (${selected.length})` : '대화 시작'}
        </button>
      </div>
      {isGroup && (
        <div className="shrink-0 border-b border-border bg-panel px-4 py-2.5">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={pickedNames.join(', ')}
            className="w-full rounded-lg border border-border-hi bg-panel px-3 py-2 text-[12px] text-ink outline-none placeholder:text-ink3"
          />
        </div>
      )}
      <div className="menu-scroll min-h-0 flex-1 overflow-y-auto">
        <MemberPicker exclude={[me]} selected={selected} onToggle={toggle} />
      </div>
    </div>
  );
}

function InviteView({ room, meName, onCancel, onDone }: { room: ChatRoom; meName: string; onCancel: () => void; onDone: () => void }) {
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
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2.5 border-b border-border bg-panel px-3 py-2.5">
        <button onClick={onCancel} title="취소" className="grid h-7 w-7 place-items-center rounded-lg text-[16px] text-ink2 hover:bg-panel-alt">←</button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-bold text-ink">멤버 초대</div>
          <div className="text-[10px] text-ink3">{room.name}</div>
        </div>
        <button
          onClick={submit}
          disabled={!selected.length || invite.isPending}
          className="rounded-lg bg-amber px-3 py-1.5 text-[11.5px] font-bold text-white transition-opacity disabled:opacity-40"
        >
          초대 ({selected.length})
        </button>
      </div>
      <div className="menu-scroll min-h-0 flex-1 overflow-y-auto">
        <MemberPicker exclude={room.members} selected={selected} onToggle={toggle} />
      </div>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────
// Teams 스타일 전달 모달 (데스크톱 웹 메신저 전용)
// ─────────────────────────────────────────────────────────────
interface DesktopForwardTarget {
  id: string; // roomId 혹은 userId
  name: string;
  type: 'room' | 'user';
  roomColor?: string;
  position?: string;
  dept?: string;
  email?: string;
}

function DesktopForwardModal({
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
  const [selectedTargets, setSelectedTargets] = useState<DesktopForwardTarget[]>([]);
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

    // 1. 방 검색
    const filteredRooms: DesktopForwardTarget[] = rooms
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
    const filteredUsers: DesktopForwardTarget[] = users
      .filter((u) => u.id !== me && !directUserIds.has(u.id) && (u.name.toLowerCase().includes(q) || u.dept?.toLowerCase().includes(q)))
      .map((u) => ({
        id: u.id,
        name: u.name,
        type: 'user',
        position: u.position,
        dept: u.dept,
        email: u.email,
      }));

    // 이미 선택된 항목 제외
    const selectedIds = selectedTargets.map((t) => t.id);
    return [...filteredRooms, ...filteredUsers].filter((t) => !selectedIds.includes(t.id));
  }, [search, rooms, users, me, selectedTargets]);

  const handleAddTarget = (t: DesktopForwardTarget) => {
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
      
      // 캐시 무효화
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

  const fmtBubbleTime = (iso?: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  return (
    <div className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/45 p-4" onClick={onClose}>
      <div 
        className="flex w-[450px] max-h-[90vh] flex-col rounded-xl bg-white p-5 shadow-2xl select-none" 
        onClick={(e) => e.stopPropagation()}
        style={{ color: '#1c2536' }}
      >
        <div className="flex items-center justify-between border-b border-border/60 pb-3">
          <span className="text-[15px] font-bold text-ink">이 메시지 전달</span>
          <button onClick={onClose} className="text-ink3 hover:text-ink transition-colors cursor-pointer p-1">
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto py-4 space-y-4">
          {/* 받는 사람 추가 */}
          <div>
            <label className="block text-[11px] font-bold text-ink2 mb-1.5">받는 사람 추가 *</label>
            <div className="flex flex-wrap gap-1.5 rounded-lg border border-border-hi bg-panel-alt/10 p-2 focus-within:border-amber focus-within:bg-white transition-all relative">
              {selectedTargets.map((t) => (
                <div key={t.id} className="flex items-center gap-1 rounded-md bg-[#e6960c]/10 border border-[#e6960c]/25 px-2 py-0.5 text-[11px] font-semibold text-[#b8780a]">
                  <span>{t.name}</span>
                  <button onClick={() => handleRemoveTarget(t.id)} className="hover:text-red transition-colors ml-0.5 cursor-pointer">
                    <X size={10} />
                  </button>
                </div>
              ))}
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={selectedTargets.length === 0 ? "이름, 부서 또는 대화방 입력..." : ""}
                className="flex-1 min-w-[150px] bg-transparent text-[11.5px] outline-none"
              />

              {/* 검색 드롭다운 */}
              {search.trim() && (
                <div className="absolute left-0 right-0 top-full mt-1.5 z-[1000000] max-h-48 overflow-y-auto rounded-lg border border-border bg-panel shadow-2xl py-1">
                  {suggestions.length === 0 ? (
                    <div className="px-3 py-2 text-center text-[11px] text-ink3">검색 결과가 없습니다.</div>
                  ) : (
                    suggestions.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => handleAddTarget(t)}
                        className="w-full px-3 py-2 text-left text-[11.5px] hover:bg-panel-alt transition-colors flex items-center justify-between cursor-pointer"
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
              rows={3}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="전달 메시지를 추가하세요..."
              className="w-full rounded-lg border border-border-hi bg-panel-alt/10 p-2.5 text-[11.5px] outline-none focus:border-amber focus:bg-white resize-none transition-all"
            />
          </div>

          {/* 메시지 미리보기 */}
          <div>
            <label className="block text-[11px] font-bold text-ink2 mb-1.5">메시지 미리보기</label>
            <div className="rounded-xl border border-border bg-panel-alt/20 p-3 flex flex-col gap-1 border-l-[3px] border-l-amber">
              <div className="flex items-center gap-1.5 text-[10.5px] font-bold text-ink2">
                <span>{msg.senderName || '알 수 없음'}</span>
                <span className="text-[9px] text-ink3 font-normal">{fmtBubbleTime(msg.at)}</span>
              </div>
              <div className="text-[11.5px] text-ink whitespace-pre-wrap line-clamp-4 leading-relaxed">
                {previewText}
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border/60 pt-3 mt-1">
          <button 
            onClick={onClose} 
            disabled={sending}
            className="px-4 py-2 rounded-lg bg-panel-alt text-[12px] font-bold text-ink2 hover:bg-panel-alt-hi active:scale-95 transition-all disabled:opacity-40 cursor-pointer"
          >
            취소
          </button>
          <button 
            onClick={handleForward} 
            disabled={sending || selectedTargets.length === 0}
            className="px-4 py-2 rounded-lg text-[12px] font-bold text-white bg-amber hover:bg-amber-dark active:scale-95 transition-all disabled:opacity-40 cursor-pointer"
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
  if (!query.trim()) {
    return <AutoLinkText text={text} className="break-words [word-break:break-word] whitespace-pre-wrap select-text" />;
  }
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'gi');
  const parts = text.split(regex);
  return (
    <span className="break-words [word-break:break-word] whitespace-pre-wrap select-text">
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
        return <AutoLinkText key={i} text={part} />;
      })}
    </span>
  );
}

function DesktopFileBoxPanel({
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
    <div className="w-full h-full bg-white flex flex-col select-none" style={{ color: '#1c2536' }}>
      <header className="flex shrink-0 items-center gap-3 border-b border-border bg-panel px-3.5 py-3 text-ink">
        <button
          onClick={onClose}
          title="대화방으로 돌아가기"
          className="grid h-7 w-7 place-items-center rounded-lg text-[16px] text-ink2 hover:bg-panel-alt transition-colors cursor-pointer"
        >
          ←
        </button>
        <span className="text-[13px] font-bold text-ink flex-1">📁 파일함 모아보기</span>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3.5 space-y-3 menu-scroll">
        {files.length === 0 ? (
          <div className="py-24 text-center text-[11px] text-ink3">공유된 파일이 없습니다.</div>
        ) : (
          files.map((f) => {
            const isImg = f.type === 'image';
            return (
              <div key={f.messageId} className="flex items-center gap-3 rounded-lg border border-border bg-panel p-2.5 shadow-3xs hover:border-amber/40 transition-colors">
                {isImg ? (
                  <button onClick={() => onOpenImage(f.attachment)} className="w-10 h-10 rounded-md border border-border overflow-hidden shrink-0 block bg-panel-alt/10 hover:brightness-95 transition-all cursor-pointer">
                    <img src={f.attachment.url} alt={f.attachment.name} className="w-full h-full object-cover" />
                  </button>
                ) : (
                  <div className="w-10 h-10 rounded-md border border-border overflow-hidden shrink-0 flex items-center justify-center bg-panel-alt/10 text-[18px] select-none">
                    📄
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <button 
                    onClick={() => downloadAttachment(f.attachment)}
                    className="block text-left text-[11.5px] font-bold text-ink hover:underline truncate w-full cursor-pointer"
                    title={f.attachment.name}
                  >
                    {f.attachment.name}
                  </button>
                  <div className="flex items-center gap-1 text-[9.5px] text-ink3 mt-0.5">
                    <span className="truncate max-w-[50px]">{f.senderName}</span>
                    <span>·</span>
                    <span>{fmtSize(f.attachment.size)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button 
                    onClick={() => handleGoToMessage(f.messageId)}
                    className="shrink-0 text-[13px] p-1.5 hover:bg-panel-alt rounded-md active:scale-95 transition-all cursor-pointer text-ink3 hover:text-ink"
                    title="대화 위치로 이동"
                  >
                    💬
                  </button>
                  <button 
                    onClick={() => downloadAttachment(f.attachment)}
                    className="shrink-0 p-1.5 hover:bg-panel-alt rounded-md active:scale-95 transition-all cursor-pointer text-ink3 hover:text-ink"
                    title="다운로드"
                  >
                    <Download size={14} />
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
