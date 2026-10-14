import { KeyRound } from 'lucide-react';
import { RELOGIN_MESSAGE, requestRelogin } from '@/shared/lib/relogin';

/**
 * 화면 안 오류 상자. 재로그인이 필요한 경우만 빨간 오류 대신 차분한 안내로 보여 주고,
 * [다시 로그인]으로 앱 셸의 안내 창을 다시 연다(이미 [나중에]로 닫았어도 직접 누르면 열린다).
 */
export function ErrorNotice({ message, className = '' }: { message: string; className?: string }) {
  if (message === RELOGIN_MESSAGE) {
    return (
      <div className={`flex items-center gap-2.5 rounded-lg border border-teal/25 bg-teal-soft/40 px-3 py-2.5 text-[11px] text-ink2 ${className}`}>
        <KeyRound size={14} className="shrink-0 text-teal" />
        <span className="min-w-0 flex-1">보안 확인을 위해 다시 로그인이 필요해요.</span>
        <button
          type="button"
          onClick={() => requestRelogin({ force: true })}
          className="shrink-0 rounded-md bg-teal px-2.5 py-1 text-[10.5px] font-bold text-white hover:opacity-90"
        >
          다시 로그인
        </button>
      </div>
    );
  }
  return (
    <div className={`rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2.5 text-[11px] font-semibold text-red-500 ${className}`}>
      {message}
    </div>
  );
}
