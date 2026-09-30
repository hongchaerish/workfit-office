import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bell, ArrowLeft, X, User } from 'lucide-react';
import { useAuth } from '@/app/auth/AuthProvider';
import { GroupwarePanel } from '@/features/gw/desktop/GroupwarePanel';
import { MessengerPanel } from '@/features/chat/desktop/MessengerPanel';
import { ChatbotPanel } from '@/features/widdy/desktop/ChatbotPanel';
import { MenuGlyph } from '@/shared/ui/MenuGlyph';
import { createMesSsoLaunchUrl } from '@/features/auth/mesSso';

interface MsgNoti {
  id: string;
  from: string;
  roomName: string;
  text: string;
  at: string;
  read: boolean;
}

const MOCK_MSG_NOTIS: MsgNoti[] = [];

/**
 * 타 MES 시스템 슬라이드/iframe 및 단독 팝업 전용 도크 화면.
 * 상단바, 사이드바 등 전체 쉘 없이 오직 [그룹웨어 도크], [Widdy AI 도크], 또는 [메신저 도크]를 100% 화면으로 렌더링합니다.
 * URL: /dock?view=groupware | /dock?view=widdy | /dock?view=messenger
 */
export default function StandaloneDockScreen() {
  const [searchParams] = useSearchParams();
  const { user, loading } = useAuth();

  const rawView =
    searchParams.get('view') ||
    searchParams.get('app') ||
    searchParams.get('type') ||
    searchParams.get('tab') ||
    searchParams.get('mode') ||
    '';
  const view = rawView.toLowerCase();
  const pathname = typeof window !== 'undefined' ? window.location.pathname.toLowerCase() : '';

  const isGroupware =
    view === 'groupware' ||
    view === 'gw' ||
    pathname.includes('/dock/gw') ||
    pathname.includes('/dock/groupware');

  const isWiddy =
    view === 'widdy' ||
    view === 'bot' ||
    view === 'chatbot' ||
    pathname.startsWith('/widdy') ||
    pathname.includes('/dock/widdy') ||
    pathname.includes('/dock/bot') ||
    pathname.includes('/exec/widdy');

  const isMessenger =
    view === 'messenger' ||
    view === 'msg' ||
    pathname.includes('/dock/msg') ||
    pathname.includes('/dock/messenger');

  const hasExplicitView = isGroupware || isWiddy || isMessenger;

  const [msgNotis, setMsgNotis] = useState<MsgNoti[]>(MOCK_MSG_NOTIS);
  const [msgNotiView, setMsgNotiView] = useState(false);
  const msgUnread = msgNotis.filter((n) => !n.read).length;

  // 닫기 버튼 동작: 부모 프레임(MES)에 닫기 메시지 전송 및 단독 팝업 닫기 시도
  const handleClose = () => {
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'WORKFIT_CLOSE_DOCK', view }, '*');
      } else {
        window.close();
      }
    } catch {
      window.close();
    }
  };

  // 모듈 클릭 시: 슬라이드 iframe 에 갇히지 않고 시원하게 새 탭으로 열기
  // (iframe 브라우저 스토리지 격리를 우회하기 위해 SSO 서명 티켓을 전달)
  const handleNavigate = (url: string) => {
    // 팝업 차단 방지를 위해 사용자 클릭 이벤트 직후 창 레퍼런스를 먼저 획득
    const newTab = window.open('about:blank', '_blank');

    void (async () => {
      try {
        let targetUrl = url.startsWith('http') ? url : `${window.location.origin}${url}`;
        if (user) {
          targetUrl = await createMesSsoLaunchUrl(url, user);
        }
        if (newTab && !newTab.closed) {
          newTab.location.href = targetUrl;
        } else {
          window.open(targetUrl, '_blank');
        }
      } catch (err) {
        console.error('[Dock] SSO 모듈 런칭 실패:', err);
        const fallbackUrl = url.startsWith('http') ? url : `${window.location.origin}${url}`;
        if (newTab && !newTab.closed) {
          newTab.location.href = fallbackUrl;
        }
      }
    })();
  };

  // 로딩 상태 화면
  if (loading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-slate-50 text-[13px] font-semibold text-ink3">
        <div className="flex flex-col items-center gap-2">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-teal border-t-transparent" />
          <span>도크 인증 및 화면 로딩 중…</span>
        </div>
      </div>
    );
  }

  // 인증 실패(미로그인) 상태 화면
  if (!user) {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center bg-slate-50 p-6 text-center text-ink">
        <div className="mb-2 text-3xl">🔒</div>
        <h3 className="text-[15px] font-bold">인증 정보가 필요합니다</h3>
        <p className="mt-1 text-[12px] text-ink3">
          MES 시스템에서 정상적으로 인증되지 않았거나 세션이 만료되었습니다.
        </p>
      </div>
    );
  }

  // 1. view 파라미터나 서브패스 지정이 없는 경우 (자동로그인만 되고 대시보드는 뜨지 않는 빈 화면)
  if (!hasExplicitView) {
    return <div className="h-screen w-full bg-slate-50" />;
  }

  // 2. 그룹웨어 도크 렌더링
  if (isGroupware) {
    return (
      <div className="flex h-screen w-full flex-col overflow-hidden bg-[#f2faf3] shadow-none select-none">
        <GroupwarePanel onClose={handleClose} onNavigate={handleNavigate} />
      </div>
    );
  }

  // 3. Widdy AI 도크 렌더링 (view=widdy 또는 view=bot 또는 view=chatbot)
  if (isWiddy) {
    return (
      <div className="flex h-screen w-full flex-col overflow-hidden bg-[#eaf2ff] shadow-none select-none">
        {/* Widdy 헤더 */}
        <header
          style={{ background: '#a9c8f5' }}
          className="flex h-14 shrink-0 items-center justify-between px-4"
        >
          <span className="flex items-center gap-2.5 text-ink">
            <MenuGlyph glyph="✦" size={18} />
            <span className="text-[14.5px] font-extrabold">Widdy</span>
          </span>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleClose}
              title="닫기"
              className="grid h-[30px] w-[30px] place-items-center rounded-lg bg-black/10 text-ink hover:bg-black/15 transition-colors cursor-pointer"
            >
              <X size={15} />
            </button>
          </div>
        </header>

        {/* Widdy 본문 패널 */}
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <div className="menu-scroll h-full overflow-y-auto">
            <ChatbotPanel />
          </div>
        </div>
      </div>
    );
  }

  // 4. 메신저 도크 렌더링 (view=messenger)
  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-[#f2f8fc] shadow-none select-none">
      {/* 메신저 헤더 */}
      <header
        style={{ background: '#bae0ff' }}
        className="flex h-14 shrink-0 items-center justify-between px-4"
      >
        <span className="flex items-center gap-2.5 text-ink">
          <MenuGlyph glyph="👤" size={18} />
          <span className="text-[14.5px] font-extrabold">
            {msgNotiView ? '메신저 알림' : '메신저'}
          </span>
        </span>

        <div className="flex items-center gap-1">
          {/* 알림 벨 */}
          <button
            type="button"
            onClick={() => {
              setMsgNotiView((v) => !v);
              setMsgNotis((list) => list.map((n) => ({ ...n, read: true })));
            }}
            title={msgNotiView ? '메신저로 돌아가기' : '알림 기록'}
            className="relative grid h-[30px] w-[30px] place-items-center rounded-lg bg-black/10 text-ink hover:bg-black/15 transition-colors cursor-pointer"
          >
            {msgNotiView ? <ArrowLeft size={15} /> : <Bell size={15} />}
            {!msgNotiView && msgUnread > 0 && (
              <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[9px] font-bold text-white">
                {msgUnread}
              </span>
            )}
          </button>

          {/* 닫기 버튼 */}
          <button
            type="button"
            onClick={handleClose}
            title="닫기"
            className="grid h-[30px] w-[30px] place-items-center rounded-lg bg-black/10 text-ink hover:bg-black/15 transition-colors cursor-pointer"
          >
            <X size={15} />
          </button>
        </div>
      </header>

      {/* 메신저 본문 패널 */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div className="menu-scroll h-full overflow-y-auto">
          <MessengerPanel />
        </div>

        {/* 메신저 알림 기록 슬라이드 오버레이 */}
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
      </div>
    </div>
  );
}
