import { useNavigate } from 'react-router-dom';
import { ArrowLeft, LayoutGrid, MessageSquare } from 'lucide-react';
import MobileNotificationBell from './MobileNotificationBell';

interface MobileCommonHeaderProps {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  showHome?: boolean;
  showLauncher?: boolean;
  showNotifications?: boolean;
  rightAction?: React.ReactNode;
}

export default function MobileCommonHeader({
  title,
  subtitle,
  onBack,
  showHome = true,
  showLauncher = true,
  showNotifications = true,
  rightAction,
}: MobileCommonHeaderProps) {
  const nav = useNavigate();

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else {
      nav(-1);
    }
  };

  return (
    <header
      className="flex items-center gap-2 px-3 py-2.5 text-white shrink-0 shadow-xs select-none"
      style={{ background: '#101830' }}
    >
      <button
        type="button"
        onClick={handleBack}
        className="grid h-8.5 w-8.5 place-items-center rounded-xl hover:bg-white/10 active:scale-95 transition-all text-white/90 hover:text-white"
        title="뒤로가기"
      >
        <ArrowLeft size={19} strokeWidth={2.2} />
      </button>

      <div className="min-w-0 flex-1">
        <h1 className="text-[15px] font-bold text-white leading-tight truncate">
          {title}
        </h1>
        {subtitle && (
          <p className="text-[10.5px] text-white/60 leading-tight truncate">
            {subtitle}
          </p>
        )}
      </div>

      <div className="flex items-center gap-1">
        {rightAction}
        {showNotifications && <MobileNotificationBell />}

        {showHome && (
          <button
            type="button"
            onClick={() => nav('/m')}
            className="grid h-8 w-8 place-items-center rounded-xl hover:bg-white/10 active:scale-95 transition-all text-white/80 hover:text-white"
            title="메신저 홈"
          >
            <MessageSquare size={17} strokeWidth={2} />
          </button>
        )}

        {showLauncher && (
          <button
            type="button"
            onClick={() => nav('/m/modules')}
            className="grid h-8 w-8 place-items-center rounded-xl hover:bg-white/10 active:scale-95 transition-all text-white/80 hover:text-white"
            title="전체 모듈 메뉴"
          >
            <LayoutGrid size={18} strokeWidth={2} />
          </button>
        )}
      </div>
    </header>
  );
}
