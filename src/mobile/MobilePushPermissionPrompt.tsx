import { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { enablePushForUser, isPushConfigured, notificationPermission } from '@/shared/lib/messaging';
import { checkDeviceEnvironment } from './IosPwaGuideModal';

const INTRO_KEY = 'workfit.push-intro.v1';
function dismissed(): boolean {
  try { return localStorage.getItem(INTRO_KEY) === 'done'; } catch { return false; }
}
function remember(): void {
  try { localStorage.setItem(INTRO_KEY, 'done'); } catch { /* 저장 제한 환경 */ }
}

export default function MobilePushPermissionPrompt({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (checkDeviceEnvironment().isStandalone && window.isSecureContext && isPushConfigured() && notificationPermission() === 'default' && !dismissed()) setOpen(true);
    const show = () => { setError(''); setOpen(true); };
    window.addEventListener('workfit-enable-push', show);
    return () => window.removeEventListener('workfit-enable-push', show);
  }, []);
  const close = () => { if (!busy) { remember(); setOpen(false); } };
  const allow = async () => {
    if (busy) return;
    const env = checkDeviceEnvironment();
    if (!window.isSecureContext || !isPushConfigured()) { setError('알림을 지원하는 HTTPS 앱에서 다시 시도해 주세요.'); return; }
    if (env.isIos && !env.isStandalone) { setError('홈 화면에 앱을 추가한 뒤, 설치한 앱에서 알림을 켜 주세요.'); return; }
    setBusy(true);
    setError('');
    try {
      // 브라우저 권한 요청은 사용자가 누른 이 버튼에서 실행한다.
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') { setError(permission === 'denied' ? '알림이 차단되었습니다. 기기 또는 브라우저 설정에서 허용할 수 있어요.' : '알림 허용을 선택해 주세요.'); return; }
      const result = await enablePushForUser(userId);
      if (!result.ok) { setError('알림 연결에 실패했습니다. 잠시 후 다시 시도해 주세요.'); return; }
      remember();
      setOpen(false);
      window.dispatchEvent(new CustomEvent('workfit-push-enabled'));
    } catch { setError('알림을 켜지 못했습니다. 다시 시도해 주세요.'); }
    finally { setBusy(false); }
  };
  if (!open) return null;
  return (
    <div className="absolute inset-0 z-[200] flex items-center justify-center bg-black/50 px-6" role="dialog" aria-modal="true" aria-labelledby="push-intro-title">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-xl">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-teal-50 text-teal-600"><Bell size={28} /></div>
        <h2 id="push-intro-title" className="mt-4 text-[17px] font-bold text-slate-900">알림을 허용하시겠습니까?</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-slate-500">새 메시지와 전자결재, 일정 알림을<br />바로 받아볼 수 있어요.</p>
        {error && <p role="alert" className="mt-3 text-[12px] text-red-600">{error}</p>}
        <div className="mt-5 flex gap-2">
          <button type="button" disabled={busy} onClick={close} className="flex-1 rounded-xl bg-slate-100 py-3 text-[13px] font-bold text-slate-600 disabled:opacity-50">나중에</button>
          <button type="button" disabled={busy} onClick={allow} className="flex-1 rounded-xl bg-teal-600 py-3 text-[13px] font-bold text-white disabled:opacity-50">{busy ? '설정 중…' : error ? '다시 시도' : '허용'}</button>
        </div>
      </div>
    </div>
  );
}
