import { Bell } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/app/auth/AuthProvider';
import { useNotifications } from '@/features/notification/useNotifications';

export default function MobileNotificationBell() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const notifications = useNotifications(user?.id);
  const unread = notifications.filter((n) => n.type !== '메신저' && !n.read).length;
  return (
    <button type="button" onClick={() => navigate('/m/notifications')}
      title="알림센터" aria-label={`알림센터${unread ? `, 미읽음 ${unread}건` : ''}`}
      className="relative grid h-8.5 w-8.5 place-items-center rounded-xl text-white hover:bg-white/10 active:scale-95">
      <Bell size={18} strokeWidth={2} />
      {unread > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">{unread > 99 ? '99+' : unread}</span>}
    </button>
  );
}
