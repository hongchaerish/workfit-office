import { Suspense, useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import type { FlatScreen } from '@/shared/types/menu';
import { MENU_TREE } from '../menu-tree';
import { SCREEN_BY_URL, HOME_URL } from './screens';
import { gwScreen } from './gw-screens';
import { Topbar } from './Topbar';
import { Sidebar } from './Sidebar';
import { TabBar } from './TabBar';
import { QuickDock, requestOpenChatRoom } from './QuickDock';
import { ToastFeed } from './ToastFeed';
import { applyTheme, loadUserTheme } from '@/shared/lib/theme';
import { useAuth } from '@/app/auth/AuthProvider';
import { useToastNotificationsTrigger } from '@/features/notification/useNotifications';

function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function NoTab() {
  return (
    <div className="grid h-full place-items-center text-ink3">
      <div className="text-center">
        <div className="mb-2 text-[27px] opacity-40">▦</div>
        <div className="text-[12.5px] font-semibold">열린 화면이 없습니다. 좌측 메뉴에서 선택하세요.</div>
      </div>
    </div>
  );
}

function ScreenLoading() {
  return (
    <div className="grid h-full place-items-center text-ink3">
      <div className="flex items-center gap-2.5 text-[12.5px] font-semibold">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-border-hi border-t-teal" />
        화면을 불러오는 중…
      </div>
    </div>
  );
}

export default function AppShell() {
  const { user } = useAuth();
  useToastNotificationsTrigger(user?.id);

  const location = useLocation();
  const navigate = useNavigate();
  const activeUrl = location.pathname;

  // 라우트(URL) → 탭용 화면. MES 메뉴 화면 우선, 없으면 그룹웨어(도크 전용) 합성.
  const resolveScreen = (url: string) => SCREEN_BY_URL[url] ?? gwScreen(url);
  const initialScreen = resolveScreen(activeUrl) ?? SCREEN_BY_URL[HOME_URL];
  const [tabs, setTabs] = useState<FlatScreen[]>(initialScreen ? [initialScreen] : []);
  const [collapsed, setCollapsed] = useState(false);
  const [openModule, setOpenModule] = useState<string | null>(null);
  const [userOpen, setUserOpen] = useState(false);
  const [tabMenuOpen, setTabMenuOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [favs, setFavs] = useState<string[]>(() => loadJSON('mes_favs', []));
  const [railOpen, setRailOpen] = useState<Record<string, boolean>>(() => loadJSON('mes_rail_open', {}));
  const [dockOpen, setDockOpen] = useState<string | null>(null);

  useEffect(() => {
    const userTheme = loadUserTheme(user?.id);
    applyTheme(userTheme.headerBg, userTheme.pointColor, userTheme.btnColor, userTheme.fontScale);
  }, [user?.id]);

  // 데스크톱 알림 클릭 → SW 가 이 창에 postMessage → 메신저 도크를 해당 방으로 연다.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onMsg = (e: MessageEvent) => {
      const d = e.data;
      if (d && d.type === 'workfit-open-chat') {
        setDockOpen('msg');
        requestOpenChatRoom(d.roomId || '');
      } else if (d && d.type === 'workfit-open-link' && typeof d.linkUrl === 'string') {
        // 결재·일정 알림. react-router 로 이동해야 페이지가 다시 로드되지 않는다 —
        // SW 가 직접 navigate 하면 작성 중이던 내용이 사라진다.
        navigate(d.linkUrl);
      }
    };
    navigator.serviceWorker.addEventListener('message', onMsg);
    return () => navigator.serviceWorker.removeEventListener('message', onMsg);
  }, []);

  // 콜드 클릭(데스크톱): SW 가 /?openChat=<roomId> 로 새 창을 열면 도크를 그 방으로 연다.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomId = params.get('openChat');
    if (!roomId) return;
    setDockOpen('msg');
    requestOpenChatRoom(roomId);
    params.delete('openChat');
    const qs = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''));
  }, []);



  useEffect(() => { try { localStorage.setItem('mes_favs', JSON.stringify(favs)); } catch { /* noop */ } }, [favs]);
  useEffect(() => { try { localStorage.setItem('mes_rail_open', JSON.stringify(railOpen)); } catch { /* noop */ } }, [railOpen]);

  // 현재 라우트에 해당하는 탭이 없으면 자동으로 연다 — 도크(그룹웨어)·딥링크·뒤로가기 모두 커버.
  // MES 화면은 openTab 이 먼저 추가하므로 여기선 no-op, 그룹웨어는 여기서 탭이 생긴다.
  useEffect(() => {
    const s = SCREEN_BY_URL[activeUrl] ?? gwScreen(activeUrl);
    if (!s) return;
    setTabs((prev) => {
      /**
       * **같은 앱이면 탭을 새로 만들지 않고 그 탭의 주소만 옮긴다.**
       *
       * 탭 중복 판정이 `url` 기준이라, `/gw/approval` 을 열어 둔 채 임시저장함에서
       * 편집을 누르면 `/gw/approval/edit/xxx` 는 다른 주소라 **"전자결재" 탭이 하나 더
       * 생겼다.** 이름이 같아 어느 쪽이 무엇인지 구분도 안 된다.
       *
       * 앱 단위(`id`)로 보고, 이미 열려 있으면 주소만 갱신한다 — 브라우저 탭에서
       * 같은 사이트를 옮겨 다니는 것과 같은 동작이다.
       */
      const existing = prev.findIndex((t) => t.id === s.id);
      if (existing === -1) return [...prev, s];
      if (prev[existing].url === s.url) return prev;
      return prev.map((t, i) => (i === existing ? { ...t, url: s.url } : t));
    });
  }, [activeUrl]);

  // 전자결재 화면(/gw/approval) 진입 시 좌측 사이드바 메뉴 기본 닫힘 처리
  useEffect(() => {
    if (activeUrl === '/gw/approval') {
      setCollapsed(true);
    }
  }, [activeUrl]);

  const activeScreen = resolveScreen(activeUrl);
  const activeModuleId = activeScreen?.moduleId ?? MENU_TREE[0].id;
  const activeModule = MENU_TREE.find((m) => m.id === activeModuleId) ?? MENU_TREE[0];

  const openTab = (s: FlatScreen) => {
    // 사이드바에서 열 때도 같은 규칙 — 이미 있으면 그 탭의 주소를 옮긴다.
    setTabs((prev) => {
      const existing = prev.findIndex((t) => t.id === s.id);
      if (existing === -1) return [...prev, s];
      return prev.map((t, i) => (i === existing ? { ...t, url: s.url } : t));
    });
    setOpenModule(null);
    if (s.url !== activeUrl) navigate(s.url);
  };
  const closeTab = (url: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.url === url);
      const next = prev.filter((t) => t.url !== url);
      if (url === activeUrl) {
        const nb = next[idx] ?? next[idx - 1];
        if (nb) navigate(nb.url);
      }
      return next;
    });
  };
  const toggleFav = (name: string) =>
    setFavs((f) => (f.includes(name) ? f.filter((x) => x !== name) : [...f, name]));

  return (
    <div className="relative flex min-h-screen flex-col bg-bg w-full min-w-fit">
      <Topbar
        activeModuleId={activeModuleId}
        activeUrl={activeUrl}
        openModule={openModule}
        setOpenModule={setOpenModule}
        userOpen={userOpen}
        setUserOpen={setUserOpen}
        onPick={openTab}
        dockOpen={dockOpen}
        setDockOpen={setDockOpen}
      />

      {/* 모듈 드롭다운 딤 */}
      {openModule && <div onClick={() => setOpenModule(null)} className="absolute inset-x-0 bottom-0 top-[58px] z-40 bg-navy-deep/30" />}

      <div className={activeUrl.startsWith('/gw') ? 'flex flex-1 w-full min-w-fit' : 'flex min-h-0 flex-1 w-full'}>
        {/* /gw 하위 라우트(:조직도, 전자결재 등)에서는 좌측 사이드바 숨김 */}
        {!activeUrl.startsWith('/gw') && (
          <Sidebar
            module={activeModule}
            activeUrl={activeUrl}
            collapsed={collapsed}
            setCollapsed={setCollapsed}
            query={query}
            setQuery={setQuery}
            railOpen={railOpen}
            setRailOpen={setRailOpen}
            favs={favs}
            toggleFav={toggleFav}
            openTab={openTab}
          />
        )}

        <div className="flex flex-1 flex-col min-w-fit w-full">
          <TabBar
            tabs={tabs}
            activeUrl={activeUrl}
            onSelect={(url) => navigate(url)}
            onClose={closeTab}
            menuOpen={tabMenuOpen}
            setMenuOpen={setTabMenuOpen}
          />
          <main className={activeUrl.startsWith('/gw') ? 'flex-1 bg-bg min-w-fit' : 'flex-1 bg-bg min-h-0 overflow-y-auto'}>
            {tabs.length === 0 ? (
              <NoTab />
            ) : (
              <div className={activeUrl.startsWith('/gw/') ? 'p-0' : 'p-[18px]'}>
                <Suspense fallback={<ScreenLoading />}>
                  <Outlet />
                </Suspense>
              </div>
            )}
          </main>
        </div>
      </div>

      <QuickDock open={dockOpen} setOpen={setDockOpen} />
      <ToastFeed />

      {/* 하단 푸터 */}
      <footer
        style={{ backgroundColor: 'var(--color-header-bg)', color: 'var(--color-header-text)' }}
        className="shrink-0 flex items-center justify-center gap-2 px-4 py-1.5 text-[10px] opacity-70 w-full min-w-full"
      >
        <span>© {new Date().getFullYear()} WorkFit</span>
        <span>·</span>
        <a
          href="https://www.workfit.kr/ko"
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 hover:opacity-100 transition-opacity"
        >
          공식 홈페이지
        </a>
      </footer>
    </div>
  );
}
