import { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '@/app/auth/AuthProvider';
import { applyTheme, loadUserTheme } from '@/shared/lib/theme';
import { useCloseReadChatNotifications } from '@/features/chat/useCloseReadChatNotifications';
import { useOutboxResume } from '@/features/chat/useOutboxSender';
import { onForegroundMessage } from '@/shared/lib/messaging';
import { shouldSuppressChatPopup } from '@/shared/lib/viewedChatRoom';
import MobileLogin from './MobileLogin';
import { ReconnectScreen } from '@/app/auth/AuthGate';
import MobileNotificationsScreen from './MobileNotificationsScreen';
import MobilePushPermissionPrompt from './MobilePushPermissionPrompt';
import MobileChatList from './MobileChatList';
import MobileChatThread from './MobileChatThread';
import MobileNewRoom from './MobileNewRoom';
import MobileApprovalList from './MobileApprovalList';
import MobileApprovalDetail from './MobileApprovalDetail';
import MobileGroupwareScreen from './MobileGroupwareScreen';
import MobileTabLayout from './MobileTabLayout';
import MobileExecScreen from './MobileExecScreen';
import MobileWiddyScreen, { MobileWiddyProvider } from './MobileWiddyScreen';
import MobileCommuteScreen from './MobileCommuteScreen';
import MobileCommuteAdminScreen from './MobileCommuteAdminScreen';
import MobileCalendarScreen from './MobileCalendarScreen';
import MobileTaskScreen from './MobileTaskScreen';
import MobileWorkPlanAdminScreen from './MobileWorkPlanAdminScreen';
import MobileContactScreen from './MobileContactScreen';
import { MobileFileViewerHost } from './MobileFileViewer';
import MobileBoardScreen from './MobileBoardScreen';
import MobileResourceScreen from './MobileResourceScreen';
import MobileSurveyScreen from './MobileSurveyScreen';
import MobileGalleryScreen from './MobileGalleryScreen';
import MobileOrgChartScreen from './MobileOrgChartScreen';
import MobileProfileScreen from './MobileProfileScreen';
import MobileComingSoon from './MobileComingSoon';
import IosPwaGuideModal, { checkDeviceEnvironment, isGuideDismissedToday } from './IosPwaGuideModal';
import { ReloginDialog } from '@/app/auth/ReloginDialog';
import { ModalLayerProvider } from '@/shared/ui/Modal';

/**
 * 모바일 PWA 셸 — 데스크톱 AppShell 밖의 전체화면 라우트(/m).
 * 자체 로그인 게이트 + 기존 채팅 훅 재사용. iOS 는 "홈 화면에 추가" 시 앱처럼 실행/푸시.
 */
export default function MobileApp() {
  const { user, loading, reconnecting } = useAuth();

  // 웹과 같은 테마 색 — 이 기기에 저장된 테마(없으면 웹 기본). 글씨 배율은 PWA 에서 항상 1이라 색만 적용하고,
  // 휴대폰 상단 상태바 색(안드로이드)도 상단바 색에 맞춘다.
  useEffect(() => {
    const theme = loadUserTheme(user?.id);
    applyTheme(theme.headerBg, theme.pointColor, theme.btnColor);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.headerBg);
  }, [user?.id]);
  // 읽은 대화방의 푸시 알림 정리(아이폰은 회수 신호를 받지 않아 이걸로만 정리된다)
  useCloseReadChatNotifications(user?.id);
  // 지난번에 다 못 보낸 메신저 메시지 — 이어 보내거나 '전송 실패'로 보여 준다
  useOutboxResume(user?.id);
  const navigate = useNavigate();
  const [showGuide, setShowGuide] = useState(false);

  // SW는 열린 PWA에 이동 메시지를 보낸다. 라우터로 처리해 전체 새로고침을 피한다.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      if (data?.type !== 'workfit-open-link' || typeof data.linkUrl !== 'string') return;
      try {
        const target = new URL(data.linkUrl, window.location.origin);
        if (target.origin !== window.location.origin || !/^\/m(?:\/|$)/.test(target.pathname)) return;
        navigate(`${target.pathname}${target.search}${target.hash}`);
      } catch {
        // 잘못된 링크는 현재 화면을 유지한다.
      }
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [navigate]);

  // /m 접속 시: 홈 화면에 아직 추가하지 않은 브라우저 상태이고 오늘 닫은 적이 없다면 가이드 모달 자동 노출
  useEffect(() => {
    const env = checkDeviceEnvironment();
    const isDismissed = isGuideDismissedToday();
    if (!env.isStandalone && !isDismissed) {
      setShowGuide(true);
    }
  }, []);

  // 외부 컴포넌트(MobileLogin, MobileChatList 등)에서 언제든 가이드 모달을 열 수 있도록 커스텀 이벤트 지원
  useEffect(() => {
    const handleOpen = () => setShowGuide(true);
    window.addEventListener('open-pwa-guide', handleOpen);
    return () => window.removeEventListener('open-pwa-guide', handleOpen);
  }, []);

  // 포그라운드 수신 → 알림 표시. 서비스워커 showNotification 을 쓰면 iOS PWA 에서도
  // 표시되고, 탭 시 라우팅은 SW 의 notificationclick(결재/채팅 딥링크)이 처리한다.
  // 휴대폰 알림은 스스로 닫지 않는다 — 읽을 때까지 남고, 읽으면 회수 신호·useCloseReadChatNotifications 가 닫는다.
  useEffect(() => {
    if (!user) return;
    void onForegroundMessage(async (p) => {
      try {
        // 알림 권한이 없어 알림을 못 띄우면 휴대폰 진동만 직접 울린다(안드로이드 — 아이폰은 진동 기능이 없다)
        if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
          try {
            navigator.vibrate?.([200, 100, 200]);
          } catch {
            /* 진동 없는 기기 */
          }
          return;
        }
        // 지금 보고 있는 대화방의 메시지는 팝업·진동 모두 없음(카카오톡과 같음) — 다른 방·다른 알림은 아래 알림이 진동과 함께 뜬다
        if (shouldSuppressChatPopup(p.roomId)) return;
        const isChat = Boolean(p.roomId || p.type === '메신저');
        const body = p.body || (isChat ? '새로운 메시지가 도착했습니다.' : '');
        // at·shownAt: 읽은 방 알림 정리 기준(서비스워커 recallChat, closeReadChatNotifications)
        const data = { type: p.type, roomId: p.roomId, docId: p.docId, linkUrl: p.linkUrl, at: p.at, shownAt: Date.now() };
        const reg = await navigator.serviceWorker?.getRegistration();
        if (reg) {
          // 메시지마다 다른 tag — 늘 새 알림이라 매번 울린다. 띄운 뒤 같은 방 예전 알림은 닫는다(서비스워커 closeOlderOfTarget 과 같음)
          const target = p.roomId || p.docId || '';
          const notificationId = `${Date.now()}-${Math.random()}`;
          const tag = target ? `${target}#${notificationId}` : undefined;
          // 진동 — vibrate 는 DOM 타입 정의에 없어 넓혀 둔다(안드로이드 크롬이 쓴다)
          const options: NotificationOptions & { vibrate: number[] } = {
            body,
            icon: '/icons/icon-192.png',
            badge: '/icons/icon-192.png',
            data: { ...data, workfitNotificationId: notificationId, workfitTarget: target },
            tag,
            silent: false,
            vibrate: [200, 100, 200],
          };
          await reg.showNotification(p.title, options);
          if (target) {
            for (const old of await reg.getNotifications()) {
              const d = old.data as { workfitTarget?: string; workfitNotificationId?: string } | null;
              if ((d?.workfitTarget === target || old.tag === target) && d?.workfitNotificationId !== notificationId) old.close();
            }
          }
        } else {
          // 폴백(구형 브라우저): 페이지 컨텍스트 알림.
          new Notification(p.title, { body, icon: '/icons/icon-192.png' });
        }
      } catch {
        /* iOS 등 미지원 환경 무시 */
      }
    });
  }, [user]);

  return (
    // 웹 공용 모달(일정·외근 창 등)이 이 셸(z-[100]) 뒤에 깔리지 않도록 층을 올린다
    <ModalLayerProvider value="z-[130]">
    <div className="fixed inset-0 z-[100] flex justify-center bg-black/10">
      <ReloginDialog variant="mobile" />
      {/* 앱 안 파일 보기(채팅 첨부 PDF·엑셀·워드) — 휴대폰 뒤로가기로 닫힌다 */}
      <MobileFileViewerHost />
      <div
        className="flex h-full w-full max-w-[480px] flex-col overflow-hidden shadow-xl"
        style={{ background: 'var(--color-header-bg)', paddingTop: 'env(safe-area-inset-top)' }}
      >
        {loading ? (
          <div className="grid flex-1 place-items-center text-[13px] text-ink3">불러오는 중…</div>
        ) : !user && reconnecting ? (
          // 연결이 잠깐 끊겨 로그인 정보를 못 읽음 — 로그인 화면 대신 다시 연결
          <ReconnectScreen className="flex-1" />
        ) : !user ? (
          <MobileLogin />
        ) : (
          <MobileWiddyProvider key={user.id}>
          <Routes>
            {/* 하단 탭 — 상단바·하단바가 있는 공통 틀. 채팅방 등 안쪽 화면은 틀 밖이라 자기 헤더만 쓴다 */}
            <Route element={<MobileTabLayout />}>
              <Route index element={<MobileGroupwareScreen />} />
              <Route path="exec" element={<MobileExecScreen />} />
              <Route path="widdy" element={<MobileWiddyScreen />} />
              <Route path="chat" element={<MobileChatList />} />
            </Route>
            <Route path="notifications" element={<MobileNotificationsScreen />} />
            <Route path="modules" element={<Navigate to="/m" replace />} />
            <Route path="new" element={<MobileNewRoom />} />
            <Route path="room/:roomId" element={<MobileChatThread />} />
            <Route path="approval" element={<MobileApprovalList />} />
            <Route path="approval/:id" element={<MobileApprovalDetail />} />
            
            {/* 모바일 핵심 모듈 라우트 */}
            <Route path="commute" element={<MobileCommuteScreen />} />
            <Route path="commute-admin" element={<MobileCommuteAdminScreen />} />
            <Route path="calendar" element={<MobileCalendarScreen />} />
            <Route path="task" element={<MobileTaskScreen />} />
            <Route path="work-plan-admin" element={<MobileWorkPlanAdminScreen />} />
            <Route path="contacts" element={<MobileContactScreen />} />

            {/* 전사 모듈 모바일 전용 화면 라우트 */}
            <Route path="board" element={<MobileBoardScreen />} />
            <Route path="resource" element={<MobileResourceScreen />} />
            <Route path="mail" element={<MobileComingSoon title="사내메일" icon="✉️" desc="사내·외부 비즈니스 소통을 주고받는 메일 시스템으로, 현재 모바일 최적화 개발 중입니다." />} />
            <Route path="survey" element={<MobileSurveyScreen />} />
            <Route path="gallery" element={<MobileGalleryScreen />} />
            <Route path="project" element={<MobileComingSoon title="프로젝트" icon="📗" desc="전사 프로젝트 협업 및 진행 관리 기능으로, 개발 로드맵에 따라 순차 오픈 예정입니다." />} />
            <Route path="orgchart" element={<MobileOrgChartScreen />} />
            <Route path="profile" element={<MobileProfileScreen />} />

            <Route path="*" element={<Navigate to="/m" replace />} />
          </Routes>
          </MobileWiddyProvider>
        )}
      </div>

      {user && <MobilePushPermissionPrompt key={user.id} userId={user.id} />}
      <IosPwaGuideModal
        isOpen={showGuide}
        onClose={() => setShowGuide(false)}
        onDismissToday={() => setShowGuide(false)}
      />
    </div>
    </ModalLayerProvider>
  );
}
