import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { useAuth } from '@/app/auth/AuthProvider';
import { useNotifications, useMarkNotificationRead, useMarkAllNotificationsRead } from '@/features/notification/useNotifications';
import { NOTIFICATION_TYPE_META, type LiveNotification } from '@/domain/liveNotification/schema';
import { notificationPermission } from '@/shared/lib/messaging';
import MobileCommonHeader from './MobileCommonHeader';
import { mobileNotificationLink } from './notificationLink';

export default function MobileNotificationsScreen() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const rows = useNotifications(user?.id).filter((n) => n.type !== '메신저');
  const markOne = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const [notice, setNotice] = useState('');
  const unread = rows.filter((n) => !n.read).length;
  const busy = markOne.isPending || markAll.isPending;
  const [permission, setPermission] = useState(notificationPermission);
  useEffect(() => {
    const refresh = () => setPermission(notificationPermission());
    window.addEventListener('workfit-push-enabled', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener('workfit-push-enabled', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, []);

  const open = async (n: LiveNotification) => {
    setNotice('');
    try {
      if (!n.read) await markOne.mutateAsync(n.id);
      const target = mobileNotificationLink(n.linkUrl);
      if (target) navigate(target);
    } catch {
      setNotice('읽음 처리에 실패했습니다. 다시 시도해 주세요.');
    }
  };
  const readAll = async () => {
    if (!user) return;
    setNotice('');
    try { await markAll.mutateAsync(user.id); }
    catch { setNotice('모두 읽음 처리에 실패했습니다. 다시 시도해 주세요.'); }
  };

  return (
    <div className="flex h-full flex-col bg-[#f2f8fc]">
      <MobileCommonHeader title="알림센터" subtitle={`미읽음 ${unread}건`} showLauncher={false} showNotifications={false}
        rightAction={<button type="button" disabled={!unread || busy} onClick={readAll} className="rounded-lg px-2 py-2 text-[11px] font-bold disabled:opacity-40">모두 읽음</button>} />
      <div className="flex-1 overflow-y-auto">
        <div className="m-3 rounded-xl border border-slate-200 bg-white p-3 text-[12px] text-slate-600">
          <p>{permission === 'denied' ? '알림이 차단되어 있습니다. 기기 또는 브라우저 설정에서 알림을 허용해 주세요.' : permission === 'granted' ? '이 기기에서 알림을 허용한 상태입니다.' : '푸시를 켜면 새 알림을 바로 받아볼 수 있어요.'}</p>
          {permission !== 'denied' && <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('workfit-enable-push'))} className="mt-2 font-bold text-teal-700">{permission === 'granted' ? '알림 연결 다시 설정' : '알림 켜기'}</button>}
        </div>
        {notice && <p role="alert" className="px-4 py-2 text-[12px] text-red-600">{notice}</p>}
        {rows.length === 0 ? <div className="flex flex-col items-center gap-3 py-20 text-slate-400"><Bell size={30} /><p className="text-[13px]">수신된 알림이 없습니다.</p></div> :
          <div className="divide-y divide-slate-100 bg-white">{rows.map((n) => <button type="button" key={n.id} disabled={busy} onClick={() => open(n)}
            className={`flex w-full items-start gap-3 px-4 py-4 text-left ${n.read ? 'bg-white' : 'bg-teal-50/60'} disabled:opacity-60`}>
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-[18px]">{NOTIFICATION_TYPE_META[n.type].icon}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-start gap-2"><p className="flex-1 text-[13px] font-bold text-slate-800">{n.title}</p>{!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-teal-500" />}</div>
              <p className="mt-1 whitespace-pre-wrap break-words text-[12px] leading-relaxed text-slate-600">{n.text}</p>
              <p className="mt-2 text-[10px] text-slate-400">{n.senderName} · {n.createdAt.replace('T', ' ').slice(0, 16)}</p>
            </div>
          </button>)}</div>}
      </div>
    </div>
  );
}
