import { useEffect, useState } from 'react';
import { Bell, X, ArrowLeft, User } from 'lucide-react';
import { MenuGlyph } from '@/shared/ui/MenuGlyph';
import { GroupwarePanel } from '@/features/gw/desktop/GroupwarePanel';
import { ChatbotPanel } from '@/features/widdy/desktop/ChatbotPanel';
import { MessengerPanel } from '@/features/chat/desktop/MessengerPanel';

export { requestOpenChatRoom } from '@/features/chat/desktop/MessengerPanel';

interface Tool {
  key: string;
  label: string;
  icon: string;
  color: string;
}

const DOCK_TOOLS: Tool[] = [
  { key: 'gw', label: '그룹웨어', icon: '🌐', color: '#c7ecc5' },
  { key: 'bot', label: 'Widdy', icon: '✦', color: '#a9c8f5' },
  { key: 'msg', label: '메신저', icon: '👤', color: '#bae0ff' },
];

const PANEL_W = 384;

interface MsgNoti {
  id: string;
  from: string;
  roomName: string;
  text: string;
  at: string;
  read: boolean;
}

const MOCK_MSG_NOTIS: MsgNoti[] = [];

export function QuickDock({ open, setOpen }: { open: string | null; setOpen: (v: string | null) => void }) {
  const tool = DOCK_TOOLS.find((t) => t.key === open);
  const [msgNotis, setMsgNotis] = useState<MsgNoti[]>(MOCK_MSG_NOTIS);
  const [msgNotiView, setMsgNotiView] = useState(false);
  const msgUnread = msgNotis.filter((n) => !n.read).length;

  useEffect(() => { if (open !== 'msg') setMsgNotiView(false); }, [open]);

  /*
    패널(메신저 등)이 열려 있는 동안 뒤 페이지 스크롤을 잠근다. 메시지 목록 끝까지 굴리면
    휠이 뒤 화면으로 넘어가 페이지가 같이 움직였다. 스크롤바가 사라지며 화면이 옆으로
    밀리지 않도록 그 폭만큼 오른쪽 여백을 채운다.
  */
  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const prev = { overflow: root.style.overflow, paddingRight: root.style.paddingRight };
    const scrollbarWidth = window.innerWidth - root.clientWidth;
    root.style.overflow = 'hidden';
    if (scrollbarWidth > 0) root.style.paddingRight = `${scrollbarWidth}px`;
    return () => {
      root.style.overflow = prev.overflow;
      root.style.paddingRight = prev.paddingRight;
    };
  }, [open]);

  return (
    <>
      {/* dim */}
      <div
        onClick={() => setOpen(null)}
        className="fixed inset-0 z-[70] bg-navy-deep/30 transition-opacity duration-200"
        style={{ opacity: open ? 1 : 0, pointerEvents: open ? 'auto' : 'none' }}
      />

      {/* 슬라이드 패널 */}
      <aside
        style={{
          width: PANEL_W,
          right: open ? 0 : -(PANEL_W + 12),
          backgroundColor: open === 'gw' ? '#f2faf3' : open === 'bot' ? '#eaf2ff' : open === 'msg' ? '#f2f8fc' : '#f3f6fa'
        }}
        className="dock-panel fixed bottom-0 top-0 z-[73] flex flex-col shadow-[-12px_0_40px_rgba(16,24,48,0.25)] transition-[right] duration-300"
      >
        {tool && tool.key === 'gw' && <GroupwarePanel onClose={() => setOpen(null)} />}
        {tool && tool.key !== 'gw' && (
          <>
            <DockHeader
              tool={tool}
              onClose={() => setOpen(null)}
              notiCount={tool.key === 'msg' ? msgUnread : undefined}
              notiView={tool.key === 'msg' ? msgNotiView : undefined}
              onNoti={tool.key === 'msg' ? () => { setMsgNotiView((v) => !v); setMsgNotis((list) => list.map((n) => ({ ...n, read: true }))); } : undefined}
            />
            <div className="relative min-h-0 flex-1 overflow-hidden">
              {/* 메신저 패널 */}
              <div className="menu-scroll h-full overflow-y-auto">
                {tool.key === 'bot' && <ChatbotPanel />}
                {tool.key === 'msg' && <MessengerPanel isVisible={!msgNotiView} />}
              </div>
              {/* 메신저 알림 기록 슬라이드 오버레이 */}
              {tool.key === 'msg' && (
                <div
                  className="absolute inset-0 flex flex-col overflow-hidden bg-[#f2f8fc] transition-transform duration-300"
                  style={{ transform: msgNotiView ? 'translateX(0)' : 'translateX(100%)' }}
                >
                  <div className="border-b border-border px-4 py-2.5">
                    <p className="text-[11px] text-ink3">메신저 알림 기록</p>
                  </div>
                  <div className="menu-scroll flex-1 overflow-y-auto">
                    {msgNotis.length === 0 ? (
                      <div className="py-12 text-center text-[12px] text-ink3">알림이 없습니다.</div>
                    ) : (
                      msgNotis.map((n) => (
                        <div
                          key={n.id}
                          className={`flex items-start gap-3 border-b border-border px-4 py-3 ${n.read ? 'opacity-55' : ''}`}
                        >
                          <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-[#bae0ff] text-ink">
                            <User size={16} />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-1">
                              <span className="truncate text-[11.5px] font-bold text-ink">{n.from}</span>
                              <span className="shrink-0 text-[10px] text-ink3">{n.at}</span>
                            </div>
                            <div className="text-[10.5px] text-ink3">{n.roomName}</div>
                            <div className="mt-0.5 truncate text-[11.5px] text-ink2">새로운 메시지가 도착했습니다.</div>
                          </div>
                          {!n.read && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-danger" />}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </aside>
    </>
  );
}

function DockHeader({ tool, onClose, notiCount, notiView, onNoti }: { tool: Tool; onClose: () => void; notiCount?: number; notiView?: boolean; onNoti?: () => void }) {
  return (
    <header style={{ background: tool.color }} className="flex h-14 shrink-0 items-center justify-between px-4">
      <span className="flex items-center gap-2.5 text-ink">
        <MenuGlyph glyph={tool.icon} size={18} />
        <span className="text-[14.5px] font-extrabold">
          {notiView ? '메신저 알림' : tool.label}
        </span>
      </span>
      <div className="flex items-center gap-1">
        {/* 메신저 전용 알림 벨 아이콘 */}
        {onNoti && (
          <button
            onClick={onNoti}
            title={notiView ? '메신저로 돌아가기' : '알림 기록'}
            className="relative grid h-[30px] w-[30px] place-items-center rounded-lg bg-black/10 text-ink hover:bg-black/15 transition-colors"
          >
            {notiView ? <ArrowLeft size={15} /> : <Bell size={15} />}
            {!notiView && notiCount != null && notiCount > 0 && (
              <span className="absolute -right-[3px] -top-[3px] grid h-[14px] min-w-[14px] place-items-center rounded-full border-[1.5px] border-[rgba(0,0,0,0.12)] bg-danger px-[2px] text-[8px] font-extrabold text-white">
                {notiCount}
              </span>
            )}
          </button>
        )}
        <button onClick={onClose} title="닫기" className="grid h-[30px] w-[30px] place-items-center rounded-lg bg-black/10 text-ink hover:bg-black/15 transition-colors">
          <X size={15} />
        </button>
      </div>
    </header>
  );
}
