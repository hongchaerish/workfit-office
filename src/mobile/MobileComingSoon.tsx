import { useNavigate } from 'react-router-dom';
import MobileCommonHeader from './MobileCommonHeader';

interface MobileComingSoonProps {
  title: string;
  icon: string;
  desc?: string;
}

export default function MobileComingSoon({ title, icon, desc }: MobileComingSoonProps) {
  const nav = useNavigate();

  return (
    <div className="flex h-full flex-col select-none overflow-hidden" style={{ background: '#f2f8fc' }}>
      <MobileCommonHeader title={title} subtitle="준비 중인 기능" />

      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
        <div className="grid h-16 w-16 place-items-center rounded-2xl bg-white shadow-xs border border-border/80 text-3xl mb-4">
          {icon}
        </div>
        <h2 className="text-[16px] font-extrabold text-ink tracking-tight">준비 중인 기능입니다</h2>
        <p className="mt-2 max-w-[280px] text-[12px] leading-relaxed text-ink3">
          {desc || `${title} 기능은 현재 모바일 환경에 최적화하여 개발 중이며, 개발 로드맵에 따라 순차 오픈될 예정입니다.`}
        </p>

        <div className="mt-4 rounded-full bg-amber/15 border border-amber/30 px-3 py-1 text-[11px] font-bold text-amber-600 dark:text-amber-400">
          개발 로드맵에 따라 순차 오픈 예정
        </div>

        <button
          type="button"
          onClick={() => nav('/m/modules')}
          className="mt-6 rounded-xl bg-teal px-4 py-2 text-[12px] font-bold text-white shadow-xs hover:opacity-90 active:scale-95 transition-all"
        >
          전체 메뉴로 돌아가기
        </button>
      </div>
    </div>
  );
}
