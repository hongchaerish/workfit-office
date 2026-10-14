import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { KeyRound } from 'lucide-react';
import { useAuth } from '@/app/auth/AuthProvider';
import { onReloginRequired, shouldShowRelogin } from '@/shared/lib/relogin';

/**
 * 재로그인 안내 창 — 서명 토큰이 없거나 만료되어 설문·메일·근태 조회를 쓸 수 없을 때 한 번 띄운다.
 *
 * 오류처럼 보이지 않게 빨간색 대신 앱 기본 톤으로, 무엇을 하면 되는지 버튼으로 바로 안내한다.
 * 여러 기능이 동시에 신호를 보내도 창은 하나이고, [나중에]를 누르면 잠시 다시 띄우지 않는다.
 */
export function ReloginDialog({ variant = 'desktop' }: { variant?: 'desktop' | 'mobile' }) {
  const { user, signOutUser } = useAuth();
  const [open, setOpen] = useState(false);
  const dismissedAt = useRef<number | null>(null);

  useEffect(() => onReloginRequired((force) => {
    if (shouldShowRelogin(dismissedAt.current, Date.now(), force)) setOpen(true);
  }), []);

  if (!open || !user) return null;

  const later = () => {
    dismissedAt.current = Date.now();
    setOpen(false);
  };
  const relogin = async () => {
    setOpen(false);
    await signOutUser();
  };
  const mobile = variant === 'mobile';

  return createPortal(
    <div className="fixed inset-0 z-[300] grid place-items-center bg-navy-deep/30 p-4 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-labelledby="relogin-title">
      <div className={`w-full ${mobile ? 'max-w-[340px]' : 'max-w-[380px]'} overflow-hidden rounded-2xl border border-border bg-panel shadow-[0_16px_48px_rgba(16,24,48,0.22)]`}>
        <div className="flex flex-col items-center gap-3 bg-teal-soft/60 px-6 pb-5 pt-6 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-white text-teal shadow-[0_2px_10px_rgba(23,168,154,0.25)]">
            <KeyRound size={22} />
          </span>
          <h2 id="relogin-title" className="text-[15px] font-bold text-ink">로그인을 한 번 더 확인할게요</h2>
        </div>
        <div className="space-y-2 px-6 py-4 text-[12px] leading-relaxed text-ink2">
          <p>보안 설정이 새로워져서, 일부 기능(설문·메일·근태 조회)을 계속 쓰려면 다시 로그인해 주세요.</p>
          <p className="text-ink3">작성 중인 내용이 있다면 먼저 저장한 뒤 진행해 주세요. 로그인하면 바로 이어서 쓸 수 있어요.</p>
        </div>
        <div className="flex gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={later}
            className={`flex-1 rounded-xl border border-border bg-panel font-semibold text-ink2 transition-colors hover:bg-panel-alt ${mobile ? 'py-3 text-[13px]' : 'py-2.5 text-[12px]'}`}
          >
            나중에
          </button>
          <button
            type="button"
            onClick={() => void relogin()}
            className={`flex-1 rounded-xl bg-teal font-bold text-white shadow-xs transition-opacity hover:opacity-90 ${mobile ? 'py-3 text-[13px]' : 'py-2.5 text-[12px]'}`}
          >
            다시 로그인
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
