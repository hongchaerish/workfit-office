import { Activity, Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Routes, useLocation, useNavigate, type Location } from 'react-router-dom';
import type { FlatScreen } from '@/shared/types/menu';
import { closeTab as closeTabModel, restoreTabState, syncTab, type ShellNavState, type ShellTab } from './tabModel';
import { MENU_TREE } from '../menu-tree';
import { SCREEN_BY_URL, HOME_URL } from './screens';
import { gwScreen } from './gw-screens';
import { Topbar } from './Topbar';
import { Sidebar } from './Sidebar';
import { TabBar } from './TabBar';
import { QuickDock, requestOpenChatRoom } from './QuickDock';
import { ToastFeed } from './ToastFeed';
import { ScrollTopButton } from './ScrollTopButton';
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

export default function AppShell({ routes }: { routes: ReactNode }) {
  const { user } = useAuth();
  useToastNotificationsTrigger(user?.id);

  const location = useLocation();
  const navigate = useNavigate();
  const activeUrl = location.pathname;

  // 라우트(URL) → 탭용 화면. MES 메뉴 화면 우선, 없으면 그룹웨어(도크 전용) 합성.
  const resolveScreen = (url: string) => SCREEN_BY_URL[url] ?? gwScreen(url);
  const href = location.pathname + location.search;
  const navMode = (location.state as ShellNavState | null)?.shellTab;
  const activeScreen = resolveScreen(activeUrl);

  /**
   * **열린 탭마다 화면을 유지한다.**
   *
   * 예전에는 현재 주소의 화면 하나만 <Outlet/> 으로 그려, 다른 탭으로 가면 이전 화면이
   * 통째로 사라졌다(작성 중 기안·필터·선택·스크롤 초기화). 이제 탭마다 그 탭의 location 으로
   * 라우트를 그리고, 보이지 않는 탭은 <Activity mode=hidden> 으로 상태만 남긴다 —
   * 숨긴 동안에는 effect(구독·타이머·리스너)가 정리돼 뒤에서 돌지 않는다.
   */
  const [tabs, setTabs] = useState<ShellTab[]>(() => {
    if (activeScreen) return [{ ...activeScreen, href }];
    const home = SCREEN_BY_URL[HOME_URL];
    return home ? [{ ...home, href: home.url }] : [];
  });
  /** 탭별 화면 위치. 탭 전환(restore)은 저장된 위치를 그대로 되살려 딥링크가 다시 적용되지 않게 한다. */
  const [tabLocations, setTabLocations] = useState<Record<string, Location>>(() =>
    activeScreen ? { [activeScreen.id]: location } : {},
  );

  // 이번 렌더의 탭·위치 — 이동 직후 첫 렌더부터 올바른 탭에 그려야 화면이 다시 마운트되지 않는다.
  const existingTab = activeScreen ? tabs.find((t) => t.id === activeScreen.id) : undefined;
  const keepStored = Boolean(existingTab && (navMode === 'restore' || navMode === 'open-app'));
  const viewTabs = !activeScreen || keepStored ? tabs : syncTab(tabs, activeScreen, href);
  const viewLocations =
    !activeScreen || keepStored || tabLocations[activeScreen.id] === location
      ? tabLocations
      : { ...tabLocations, [activeScreen.id]: location };

  useEffect(() => {
    if (viewTabs !== tabs) setTabs(viewTabs);
    if (viewLocations !== tabLocations) setTabLocations(viewLocations);
    // 도크·메뉴에서 이미 열린 앱을 다시 열면 그 탭의 주소로 맞춘다(앱 첫 화면으로 덮어쓰지 않음).
    if (navMode === 'open-app' && existingTab && existingTab.href !== href) {
      navigate(existingTab.href, { replace: true, state: restoreTabState });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location]);

  // 탭별 스크롤 위치 — 전환 직전 저장, 전환 직후 복원. 그룹웨어는 창이, 그 외는 본문이 스크롤된다.
  const mainRef = useRef<HTMLElement>(null);
  const scrollByTab = useRef<Record<string, { win: number; main: number }>>({});
  const activeTabId = activeScreen?.id ?? null;
  const prevTabIdRef = useRef<string | null>(activeTabId);
  useLayoutEffect(() => {
    const prev = prevTabIdRef.current;
    if (prev === activeTabId) return;
    prevTabIdRef.current = activeTabId;
    const saved = activeTabId ? scrollByTab.current[activeTabId] : undefined;
    window.scrollTo(0, saved?.win ?? 0);
    if (mainRef.current) mainRef.current.scrollTop = saved?.main ?? 0;
  }, [activeTabId]);
  const rememberScroll = () => {
    if (!activeTabId) return;
    scrollByTab.current[activeTabId] = { win: window.scrollY, main: mainRef.current?.scrollTop ?? 0 };
  };

  const [collapsed, setCollapsed] = useState(false);
  const [openModule, setOpenModule] = useState<string | null>(null);
  const [userOpen, setUserOpen] = useState(false);
  const [tabMenuOpen, setTabMenuOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [favs, setFavs] = useState<string[]>(() => loadJSON('mes_favs', []));
  const [railOpen, setRailOpen] = useState<Record<string, boolean>>(() => loadJSON('mes_rail_open', {}));
  const [dockOpen, setDockOpen] = useState<string | null>(null);

  // 최상단 바(Topbar)는 스크롤해도 고정된다 — 그 높이를 알려 sticky 요소들이 바로 아래에 붙게 한다
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--shell-top', '58px');
    return () => {
      root.style.removeProperty('--shell-top');
    };
  }, []);

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

  // 콜드 클릭(데스크톱) 및 외부 연동(MES): view=groupware, view=messenger 또는 ?openChat=<roomId> 로 도크를 연다.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const view = params.get('view');
    const roomId = params.get('openChat');

    if (view === 'groupware' || view === 'gw') {
      setDockOpen('gw');
    } else if (view === 'messenger' || view === 'msg' || roomId) {
      setDockOpen('msg');
      if (roomId) {
        requestOpenChatRoom(roomId);
      }
    }

    if (roomId) {
      params.delete('openChat');
      const qs = params.toString();
      window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''));
    }
  }, []);



  useEffect(() => { try { localStorage.setItem('mes_favs', JSON.stringify(favs)); } catch { /* noop */ } }, [favs]);
  useEffect(() => { try { localStorage.setItem('mes_rail_open', JSON.stringify(railOpen)); } catch { /* noop */ } }, [railOpen]);


  // 전자결재 화면(/gw/approval) 진입 시 좌측 사이드바 메뉴 기본 닫힘 처리
  useEffect(() => {
    if (activeUrl === '/gw/approval') {
      setCollapsed(true);
    }
  }, [activeUrl]);

  const activeModuleId = activeScreen?.moduleId ?? MENU_TREE[0].id;
  const activeModule = MENU_TREE.find((m) => m.id === activeModuleId) ?? MENU_TREE[0];

  /** 탭으로 이동 — 그 탭이 갖고 있던 화면 위치를 되살린다. */
  const selectTab = (tab: ShellTab) => {
    if (tab.id === activeTabId) return;
    rememberScroll();
    navigate(tab.href, { state: restoreTabState });
  };
  const openTab = (s: FlatScreen) => {
    // 사이드바에서 열 때도 같은 규칙 — 이미 열려 있으면 그 탭으로 돌아간다.
    setOpenModule(null);
    const existing = tabs.find((t) => t.id === s.id);
    if (existing) {
      selectTab(existing);
      return;
    }
    rememberScroll();
    if (s.url !== activeUrl) navigate(s.url);
  };
  const closeTab = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const result = closeTabModel(tabs, id, activeTabId);
    setTabs(result.tabs);
    setTabLocations((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    delete scrollByTab.current[id];
    if (id === activeTabId) navigate(result.nextHref ?? HOME_URL, { state: restoreTabState });
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
            tabs={viewTabs}
            activeTabId={activeTabId}
            onSelect={selectTab}
            onClose={closeTab}
            menuOpen={tabMenuOpen}
            setMenuOpen={setTabMenuOpen}
          />
          <main ref={mainRef} className={activeUrl.startsWith('/gw') ? 'flex-1 bg-bg min-w-fit' : 'flex-1 bg-bg min-h-0 overflow-y-auto'}>
            <div className={activeUrl.startsWith('/gw/') ? 'p-0' : 'p-[18px]'}>
                {viewTabs.map((tab) => (
                  <Activity key={tab.id} mode={tab.id === activeTabId ? 'visible' : 'hidden'}>
                    <Suspense fallback={<ScreenLoading />}>
                      <Routes location={viewLocations[tab.id] ?? tab.href}>{routes}</Routes>
                    </Suspense>
                  </Activity>
                ))}
                {/* 탭이 없는 화면(프로필·설정·리다이렉트 등)은 지금 주소로 그린다 */}
                {!activeScreen && (
                  <Suspense fallback={<ScreenLoading />}>
                    <Routes location={location}>{routes}</Routes>
                  </Suspense>
                )}
              </div>
          </main>
        </div>
      </div>

      <QuickDock open={dockOpen} setOpen={setDockOpen} />
      <ToastFeed />
      <ScrollTopButton />

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
