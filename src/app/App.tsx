import { lazy as reactLazy, useEffect, type ComponentType } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import AppShell from './shell/AppShell';
import MobileApp from '@/mobile/MobileApp';
import PlaceholderScreen from '@/modules/common/PlaceholderScreen';
import { flattenScreens } from './routes';
import { loadUserTheme } from '@/shared/lib/theme';

/**
 * 화면 청크 로딩 실패 대응.
 *
 * ## 왜 실패하는가
 * 빌드하면 청크 파일명에 내용 해시가 박힌다(`ApprovalScreen-DT0pnIjN.js`). 배포하면
 * 옛 이름의 파일이 서버에서 사라지는데, **이미 페이지를 연 브라우저는 옛 파일명을 계속
 * 들고 있다.** 그 사람이 아직 안 열어본 화면으로 이동하면 없는 파일을 요청해 404가 난다.
 *
 * ## 왜 곧바로 새로고침하지 않는가
 * 예전에는 실패 즉시 `location.reload()` 했다. 그러면 **작성 중이던 내용이 예고 없이
 * 사라진다** — 실제로 배포 중 계약보고서를 쓰던 사람이 겪었다.
 *
 * 그래서 두 단계를 둔다.
 * 1. **한 번 재시도.** CDN 전파가 덜 됐거나 일시적 네트워크 오류면 여기서 끝난다.
 * 2. 그래도 안 되면 **사용자에게 묻는다.** 저장할 기회를 주고 본인이 새로고침을 누르게 한다.
 */
function lazy<T extends ComponentType<any>>(factory: () => Promise<{ default: T }>) {
  return reactLazy(async () => {
    try {
      return await factory();
    } catch (first) {
      // 1) 일시적 실패일 수 있다. 잠깐 뒤 한 번만 다시.
      await new Promise((resolve) => setTimeout(resolve, 800));
      try {
        return await factory();
      } catch (error) {
        console.error('화면 청크 로딩 실패 — 새 버전이 배포된 것으로 보입니다.', error);
        // 2) 묻는다. 확인을 누르면 새로고침, 취소면 지금 화면에 그대로 머문다.
        const reload = window.confirm(
          [
            '새 버전이 배포되어 이 화면을 열 수 없습니다.',
            '',
            '작성 중인 내용이 있다면 먼저 저장해 주세요.',
            '지금 새로고침하시겠습니까?',
          ].join('\n'),
        );
        if (reload) window.location.reload();
        // 새로고침하지 않으면 이 화면은 못 그린다. 사용자는 뒤로 가서 하던 일을 이어간다.
        return new Promise<{ default: T }>(() => { });
      }
    }
  });
}

const SCREENS = flattenScreens();
const HOME = '/exec';

/**
 * 구현된 화면 레지스트리 (url → 컴포넌트).
 * 각 화면은 React.lazy 로 분리되어 별도 청크로 온디맨드 로드된다(번들 분할).
 * 미구현 화면은 PlaceholderScreen(eager) 사용.
 */
// 그룹웨어(도크 전용, menu-tree 밖) — 명시적 라우트로 등록.
const GwOrgChart = lazy(() => import('@/modules/gw/orgchart/OrgChartScreen'));
const GwApproval = lazy(() => import('@/modules/gw/approval/ApprovalScreen'));
const GwApprovalDraft = lazy(() => import('@/modules/gw/approval/ApprovalDraftScreen'));
const GwLeave = lazy(() => import('@/modules/gw/leave/LeaveScreen'));
const GwBoard = lazy(() => import('@/modules/gw/board/BoardScreen'));
const GwDocument = lazy(() => import('@/modules/gw/document/DocumentScreen'));
const GwCommunity = lazy(() => import('@/modules/gw/community/CommunityScreen'));
const GwEmployee = lazy(() => import('@/modules/gw/employee/EmployeeScreen'));
const GwCalendar = lazy(() => import('@/modules/gw/calendar/CalendarScreen'));
const GwResource = lazy(() => import('@/modules/gw/resource/ResourceScreen'));
// const GwTask = lazy(() => import('@/modules/gw/task/TaskScreen'));
const GwWorkPlan = lazy(() => import('@/modules/gw/task/WorkPlanScreen'));
const GwSurvey = lazy(() => import('@/modules/gw/survey/SurveyScreen'));
// const GwMail = lazy(() => import('@/modules/gw/mail/MailScreen'));
const GwCommute = lazy(() => import('@/modules/gw/commute/CommuteScreen'));
const GwGallery = lazy(() => import('@/modules/gw/gallery/GalleryScreen'));
const GwComingSoon = lazy(() => import('@/modules/gw/common/GwComingSoon'));
const ProfileScreen = lazy(() => import('@/modules/profile/ProfileScreen'));
const SettingsScreen = lazy(() => import('@/modules/settings/SettingsScreen'));
const StandaloneDockScreen = lazy(() => import('@/modules/dock/StandaloneDockScreen'));

const SCREEN_COMPONENTS: Record<string, ComponentType> = {
  // 경영 현황 (로그인 후 랜딩) — 성과 관리 섹션 포함(통합)
  '/exec': lazy(() => import('@/modules/exec/ExecDashboardScreen')),
  // 기준 정보
  '/base/user': lazy(() => import('@/modules/base/user/UserScreen')),
  '/sys/user': lazy(() => import('@/modules/base/user/UserScreen')),
  '/base/department': lazy(() => import('@/modules/base/department/DepartmentScreen')),
  '/base/position': lazy(() => import('@/modules/base/position/PositionScreen')),
  '/base/holiday': lazy(() => import('@/modules/base/holiday/HolidayScreen')),
  '/base/approval-rule': lazy(() => import('@/modules/base/approvalRule/ApprovalRouteRuleScreen')),
  '/base/approval-rules': lazy(() => import('@/modules/base/approvalRule/ApprovalRouteRuleScreen')),

  '/base/approval-process': lazy(() => import('@/modules/base/approvalProcess/ApprovalProcessScreen')),

  '/base/approval-form': lazy(() => import('@/modules/base/approvalForm/ApprovalFormScreen')),
  '/base/approval-monitor': lazy(() => import('@/modules/base/approvalMonitor/ApprovalMonitorScreen')),
  '/base/vendor': lazy(() => import('@/modules/base/vendor/VendorScreen')),
  '/base/code': lazy(() => import('@/modules/base/code/CodeScreen')),
  '/base/auth': lazy(() => import('@/modules/base/auth/AuthScreen')),
  // 시스템 관리
  '/sys/company': lazy(() => import('@/modules/sys/company/CompanyScreen')),
  '/sys/menu': lazy(() => import('@/modules/sys/menu/MenuMgmtScreen')),
  '/sys/log': lazy(() => import('@/modules/sys/log/LogMgmtScreen')),
  '/sys/i18n': lazy(() => import('@/modules/sys/i18n/I18nScreen')),
  '/sys/env': lazy(() => import('@/modules/sys/env/EnvScreen')),
  '/sys/backup': lazy(() => import('@/modules/sys/backup/BackupScreen')),
  '/sys/interface': lazy(() => import('@/modules/sys/interface/InterfaceScreen')),
  '/sales/quote': lazy(() => import('@/modules/sales/quote/SalesQuoteScreen')),
  '/sales/order': lazy(() => import('@/modules/sales/order/SalesOrderScreen')),
  '/sales/order-status': lazy(() => import('@/modules/sales/order-status/SalesOrderStatusScreen')),
};

import { useAuth } from '@/app/auth/AuthProvider';
import { useNotifications } from '@/features/notification/useNotifications';
import { syncPushToken, onForegroundMessage } from '@/shared/lib/messaging';

import { usePermission } from '@/features/auth/usePermission';

function ProtectedRoute({ url, children }: { url: string; children: React.ReactNode }) {
  const { canAccess, isLoading } = usePermission();
  if (isLoading) return null;
  if (!canAccess(url)) {
    return <Navigate to="/exec" replace />;
  }
  return <>{children}</>;
}

export default function App() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  useNotifications(user?.id);
  const isMobilePwa = location.pathname.startsWith('/m');

  // 로그인 시 FCM 토큰 동기화(권한 허용된 기기 한정, 팝업 없음).
  // 데스크톱/모바일 공통 루트라 채팅을 열지 않는 결재 사용자도 푸시를 받는다.
  useEffect(() => {
    if (user?.id) void syncPushToken(user.id);
  }, [user?.id]);

  // 데스크톱 포그라운드(앱 활성) 수신 → OS 알림 표시. 웹은 포그라운드 메시지가 onMessage 로만
  // 들어오고 자동 배너가 없으므로 SW 등록으로 직접 표시한다(백그라운드와 동일한 Workfit 로고·유지).
  // 모바일 PWA(/m)는 MobileApp 이 처리하므로 여기서는 제외(중복 방지).
  useEffect(() => {
    if (!user?.id || isMobilePwa) return;
    void onForegroundMessage(async (p) => {
      try {
        if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
        const isChat = Boolean(p.roomId || p.type === '메신저');
        const body = isChat ? '새로운 메시지가 도착했습니다.' : p.body;
        const data = { type: p.type, roomId: p.roomId, docId: p.docId, linkUrl: p.linkUrl };
        const reg = await navigator.serviceWorker?.getRegistration();
        if (reg) {
          await reg.showNotification(p.title, {
            body,
            icon: '/icons/icon-192.png',
            badge: '/icons/icon-192.png',
            data,
            // 서비스워커 쪽과 같은 규칙 — 일정 알림은 병합되고 스스로 사라진다.
            tag: p.roomId || p.docId || p.linkUrl || undefined,
            requireInteraction: Boolean(p.roomId || p.docId),
          });
        } else {
          new Notification(p.title, { body, icon: '/icons/icon-192.png' });
        }
      } catch {
        /* 미지원 환경(iOS 비PWA 등) 무시 */
      }
    });
  }, [user?.id, isMobilePwa]);

  // 로컬 스토리지에 저장된 폰트 크기 설정을 감지하여 앱 전체(HTML/Body)에 바인딩.
  // 단, 모바일 PWA(/m)는 자체 px 디자인이므로 데스크톱 확대(zoom, 기본 1.1875)를 적용하면
  // 아이폰 화면보다 크게 렌더되어 축소해야 하는 문제가 생긴다 → PWA 는 항상 1(확대 없음).
  useEffect(() => {
    if (isMobilePwa) {
      document.documentElement.style.setProperty('--font-scale', '1');
      return;
    }
    const savedScale = loadUserTheme(user?.id).fontScale;
    document.documentElement.style.setProperty('--font-scale', savedScale);
  }, [isMobilePwa, user?.id]);

  // 타 MES 시스템 연동: /exec?from=mes 진입 시 대시보드를 노출하지 않고 독립 도크 뷰로 전환
  const isFromMes = new URLSearchParams(location.search).get('from') === 'mes';
  const isDock = location.pathname.startsWith('/dock') || (location.pathname === '/exec' && isFromMes);
  useEffect(() => {
    if (isMobilePwa || isDock) return;
    const defaultHash = '06c4371239ef075e099d6d84de05e43ad7f649fc75350eac00ce55bc859cf218';
    if (user && (user.password === 'mes1234' || user.password === defaultHash)) {
      window.alert('보안을 위해 초기 비밀번호(mes1234)를 반드시 변경해 주세요.');
      navigate('/profile');
    }
  }, [user, navigate, isMobilePwa, isDock]);

  // 셸(AppShell) 안의 화면 라우트 — AppShell 이 열린 탭마다 이 목록으로 화면을 그린다(탭 상태 유지).
  const shellRoutes = (
    <>
      <Route index element={<Navigate to={HOME} replace />} />
      {SCREENS.map((screen) => {
        const Impl = SCREEN_COMPONENTS[screen.url];
        return (
          <Route
            key={screen.id}
            path={screen.url}
            element={
              <ProtectedRoute url={screen.url}>
                {Impl ? <Impl /> : <PlaceholderScreen screen={screen} />}
              </ProtectedRoute>
            }
          />
        );
      })}
      {/* 그룹웨어(도크 전용) — 조직도 실화면 + 전자결재 독립 라우트 */}
      <Route path="/gw/orgchart" element={<ProtectedRoute url="/gw/orgchart"><GwOrgChart /></ProtectedRoute>} />
      <Route path="/gw/approval/new" element={<ProtectedRoute url="/gw/approval"><GwApprovalDraft /></ProtectedRoute>} />
      <Route path="/gw/approval/edit/:id" element={<ProtectedRoute url="/gw/approval"><GwApprovalDraft /></ProtectedRoute>} />
      <Route path="/gw/approval" element={<ProtectedRoute url="/gw/approval"><GwApproval /></ProtectedRoute>} />
      <Route path="/gw/leave" element={<ProtectedRoute url="/gw/leave"><GwLeave /></ProtectedRoute>} />
      <Route path="/gw/board" element={<ProtectedRoute url="/gw/board"><GwBoard /></ProtectedRoute>} />
      <Route path="/gw/document" element={<ProtectedRoute url="/gw/document"><GwDocument /></ProtectedRoute>} />
      <Route path="/gw/community" element={<ProtectedRoute url="/gw/community"><GwCommunity /></ProtectedRoute>} />
      <Route path="/gw/employee" element={<ProtectedRoute url="/gw/employee"><GwEmployee /></ProtectedRoute>} />
      <Route path="/gw/calendar" element={<ProtectedRoute url="/gw/calendar"><GwCalendar /></ProtectedRoute>} />
      <Route path="/gw/resource" element={<ProtectedRoute url="/gw/resource"><GwResource /></ProtectedRoute>} />
      <Route path="/gw/task" element={<ProtectedRoute url="/gw/task"><GwComingSoon /></ProtectedRoute>} />
      <Route path="/gw/work-plan" element={<ProtectedRoute url="/gw/work-plan"><GwWorkPlan /></ProtectedRoute>} />
      <Route path="/gw/survey" element={<ProtectedRoute url="/gw/survey"><GwSurvey /></ProtectedRoute>} />
      <Route path="/gw/mail" element={<ProtectedRoute url="/gw/mail"><GwComingSoon /></ProtectedRoute>} />
      <Route path="/gw/commute" element={<ProtectedRoute url="/gw/commute"><GwCommute /></ProtectedRoute>} />
      <Route path="/gw/gallery" element={<ProtectedRoute url="/gw/gallery"><GwGallery /></ProtectedRoute>} />
      <Route path="/gw/:app" element={<GwComingSoon />} />
      {/* 개인 프로필 설정 */}
      <Route path="/profile" element={<ProfileScreen />} />
      {/* 환경설정 */}
      <Route path="/settings" element={<SettingsScreen />} />
      <Route path="*" element={<PlaceholderScreen />} />
    </>
  );

  return (
    <Routes>
      {/* 모바일 메신저 PWA — 데스크톱 셸 밖의 전체화면 라우트 */}
      <Route path="/m/*" element={<MobileApp />} />
      {/* 타 MES 시스템 슬라이드/iframe 전용 독립 도크 라우트 */}
      <Route path="/dock" element={<StandaloneDockScreen />} />
      <Route path="/dock/*" element={<StandaloneDockScreen />} />
      <Route path="/widdy" element={<StandaloneDockScreen />} />

      {/* /exec?from=mes 진입 시 AppShell(GNB/사이드바) 및 대시보드를 일체 띄우지 않고 도크만 렌더링 */}
      {isFromMes && <Route path="/exec" element={<StandaloneDockScreen />} />}

      <Route path="/*" element={<AppShell routes={shellRoutes} />} />
    </Routes>
  );
}
