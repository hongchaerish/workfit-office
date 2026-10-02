import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/app/auth/AuthProvider';
import { useMyPresence } from '@/features/userPresence/useUserPresence';
import {
  USER_PRESENCE_META,
  MANUAL_PRESENCE_STATUSES,
  type UserPresenceStatus,
} from '@/domain/userPresence/schema';
import {
  X,
  Check,
  HelpCircle,
  LogOut,
  MessageSquare,
  Sparkles,
} from 'lucide-react';

interface MobileUserMenuSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * 모바일 PWA 전용 계정 및 근무 상태 관리 바텀시트.
 * 웹 AppShell의 Topbar/UserMenu와 100% 동일한 변수(presence, meta, updatePresence, msgInput 등)를 사용하여
 * 실시간 동기화 및 파편화 방지를 보장합니다.
 */
export default function MobileUserMenuSheet({ isOpen, onClose }: MobileUserMenuSheetProps) {
  const navigate = useNavigate();
  const { signOutUser, user } = useAuth();
  const { presence, meta, updatePresence } = useMyPresence();

  // 웹(UserMenu.tsx)과 동일한 상태 변수 및 로직
  const [msgInput, setMsgInput] = useState(presence.message);
  const [saveFeedback, setSaveFeedback] = useState(false);

  // 로그인 사용자 정보 (웹 Topbar/UserMenu와 동일한 변수 체계)
  const name = user?.name ?? '게스트';
  const email = user?.email ?? '-';
  const initials = user?.name ? user.name.slice(-2) : 'WF';

  // presence.message 변경 시 입력 필드 동기화
  useEffect(() => {
    setMsgInput(presence.message);
  }, [presence.message]);

  if (!isOpen || !user) return null;

  const handleStatusClick = (status: UserPresenceStatus) => {
    updatePresence(status, presence.message);
  };

  const handleMsgSave = () => {
    const trimmed = msgInput.trim();
    updatePresence(presence.status, trimmed);
    setSaveFeedback(true);
    setTimeout(() => setSaveFeedback(false), 2000);
  };

  const handleMsgClear = () => {
    setMsgInput('');
    updatePresence(presence.status, '');
    setSaveFeedback(true);
    setTimeout(() => setSaveFeedback(false), 2000);
  };

  const handlePresetClick = (preset: string) => {
    setMsgInput(preset);
    updatePresence(presence.status, preset);
    setSaveFeedback(true);
    setTimeout(() => setSaveFeedback(false), 2000);
  };

  const handleOpenGuide = () => {
    onClose();
    window.dispatchEvent(new CustomEvent('open-pwa-guide'));
  };

  const handleSignOut = () => {
    onClose();
    navigate('/m', { replace: true });
    void signOutUser();
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex flex-col justify-end bg-black/60 backdrop-blur-xs transition-opacity animate-in fade-in"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full flex-col overflow-y-auto rounded-t-3xl bg-white shadow-2xl transition-transform dark:bg-[#151c2e]"
        style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 상단 드래그 핸들 & 닫기 버튼 */}
        <div className="relative flex items-center justify-between border-b border-black/5 px-5 py-3.5 dark:border-white/10">
          <div className="flex-1" />
          <div className="h-1.5 w-10 rounded-full bg-slate-200 dark:bg-slate-700" />
          <div className="flex flex-1 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="grid h-8 w-8 place-items-center rounded-full text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 active:scale-95"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* 사용자 정보 헤더 (웹 Topbar/UserMenu 규격) */}
        <div className="flex items-center gap-3.5 px-5 py-4 border-b border-black/5 dark:border-white/10 bg-slate-50/50 dark:bg-white/[0.02]">
          <div className="relative shrink-0">
            {user.photoUrl ? (
              <img
                src={user.photoUrl}
                alt="프로필 사진"
                className="h-13 w-13 rounded-full object-cover border-2 border-white shadow-sm dark:border-slate-800"
              />
            ) : (
              <div
                className="grid h-13 w-13 place-items-center rounded-full text-[17px] font-bold text-white shadow-sm"
                style={{ background: '#17a89a' }}
              >
                {initials}
              </div>
            )}
            <span
              className={`absolute bottom-0 right-0 h-4 w-4 rounded-full border-2 border-white dark:border-[#151c2e] shadow-xs ${meta.dotColor}`}
              title={meta.label}
            />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-[16px] font-bold text-slate-900 dark:text-white">
                {name}
              </span>
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold border ${meta.bgTone}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${meta.dotColor}`} />
                {meta.label}
              </span>
            </div>
            <p className="truncate text-[12px] text-slate-500 dark:text-slate-400 mt-0.5">
              {email}
            </p>
          </div>
        </div>

        <div className="space-y-5 px-5 py-4">
          {/* 근무·활동 상태 선택기 — 직접 고를 수 있는 상태만(외근·회의·휴가는 전자결재·캘린더로 자동) */}
          <div>
            <div className="mb-2.5 flex items-center justify-between">
              <span className="text-[12.5px] font-bold text-slate-700 dark:text-slate-200">
                현재 근무·활동 상태
              </span>
              <span className="text-[11px] text-slate-400">선택 시 즉시 적용</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {MANUAL_PRESENCE_STATUSES.map((st) => {
                const item = USER_PRESENCE_META[st];
                const isSelected = presence.status === st;
                return (
                  <button
                    key={st}
                    type="button"
                    onClick={() => handleStatusClick(st)}
                    className={`flex items-center gap-2.5 rounded-xl border p-2.5 text-left transition-all active:scale-[0.98] ${
                      isSelected
                        ? 'border-teal-500 bg-teal-50/70 dark:bg-teal-950/40 shadow-xs ring-1 ring-teal-500/40 font-bold'
                        : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-700/60 dark:bg-white/[0.03] text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${item.dotColor}`} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[12.5px] leading-none truncate">
                        {item.label}
                      </div>
                      <div className="text-[10px] text-slate-400 truncate mt-1">
                        {item.desc}
                      </div>
                    </div>
                    {isSelected && (
                      <Check size={14} className="shrink-0 text-teal-600 dark:text-teal-400" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 상태 메시지 설정 (웹 UserMenu의 msgInput / handleMsgSave 로직과 통일) */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-3.5 dark:border-slate-700/60 dark:bg-white/[0.02]">
            <div className="mb-2 flex items-center justify-between">
              <label
                htmlFor="mobile-presence-msg"
                className="flex items-center gap-1.5 text-[12.5px] font-bold text-slate-700 dark:text-slate-200"
              >
                <MessageSquare size={14} className="text-teal-500" />
                <span>상태 메시지</span>
              </label>
              {saveFeedback && (
                <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400 animate-in fade-in">
                  <Check size={13} />
                  <span>저장 완료</span>
                </span>
              )}
            </div>

            <div className="flex gap-2">
              <input
                id="mobile-presence-msg"
                type="text"
                value={msgInput}
                onChange={(e) => setMsgInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleMsgSave();
                  }
                }}
                placeholder="상태 메시지 입력 (예: 3시까지 미팅)"
                maxLength={50}
                className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
              {msgInput && (
                <button
                  type="button"
                  onClick={handleMsgClear}
                  className="rounded-xl border border-slate-200 bg-white px-2.5 text-[12px] font-medium text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400"
                  title="지우기"
                >
                  삭제
                </button>
              )}
              <button
                type="button"
                onClick={handleMsgSave}
                className="shrink-0 rounded-xl px-3.5 py-2 text-[12.5px] font-bold text-white shadow-xs transition-all active:scale-95"
                style={{ background: '#17a89a' }}
              >
                저장
              </button>
            </div>

            {/* 빠른 추천 프리셋 */}
            <div className="mt-3">
              <div className="mb-1.5 flex items-center gap-1 text-[10.5px] font-semibold text-slate-400">
                <Sparkles size={11} className="text-amber-500" />
                <span>자주 쓰는 상태 메시지</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {['식사 중 🍚', '회의 중 💬', '외근·출장 🚗', '재택근무 🏠', '집중 업무 🎧', '휴가 중 🌴'].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => handlePresetClick(preset)}
                    className="rounded-lg border border-slate-200/80 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 transition-all hover:border-teal-400 hover:text-teal-700 active:scale-95 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-300"
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 유틸리티 & 시스템 설정 메뉴 */}
          <div className="space-y-1 rounded-2xl border border-slate-200 bg-white p-1.5 dark:border-slate-700/60 dark:bg-white/[0.02]">
            <button
              type="button"
              onClick={handleOpenGuide}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-slate-700 transition-colors hover:bg-slate-50 active:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5"
            >
              <div className="grid h-8 w-8 place-items-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400">
                <HelpCircle size={16} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold">모바일 앱 설치 & 알림 가이드</div>
                <div className="text-[11px] text-slate-400">홈 화면 추가 및 iOS/Android 푸시 안내</div>
              </div>
            </button>

            <div className="my-1 border-t border-slate-100 dark:border-white/5" />

            <button
              type="button"
              onClick={handleSignOut}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-rose-600 transition-colors hover:bg-rose-50/70 active:bg-rose-100 dark:text-rose-400 dark:hover:bg-rose-950/30"
            >
              <div className="grid h-8 w-8 place-items-center rounded-lg bg-rose-50 text-rose-600 dark:bg-rose-950/50 dark:text-rose-400">
                <LogOut size={16} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-bold">로그아웃</div>
                <div className="text-[11px] text-rose-500/80">현재 계정에서 로그아웃합니다</div>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
