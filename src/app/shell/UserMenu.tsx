import { useState, type ReactNode } from 'react';
import { useAuth } from '@/app/auth/AuthProvider';
import { useNavigate } from 'react-router-dom';
import { useMyPresence } from '@/features/userPresence/useUserPresence';
import { MANUAL_PRESENCE_STATUSES, USER_PRESENCE_META, type UserPresenceStatus } from '@/domain/userPresence/schema';
import { User as UserIcon, Settings, Globe, MessageSquare } from 'lucide-react';

interface UserMenuProps {
  onClose: () => void;
}

function Item({ icon, label, sub, onClick }: { icon: ReactNode; label: string; sub?: string; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 px-[18px] py-2 text-left transition-colors hover:bg-panel-alt">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-panel-alt text-[13px] text-ink2">{icon}</span>
      <span className="min-w-0">
        <span className="block text-[12px] font-semibold text-ink">{label}</span>
        {sub && <span className="mt-px block text-[10px] text-ink3">{sub}</span>}
      </span>
    </button>
  );
}

/** 계정 팝업 — 실시간 근무 상태(Teams/Discord 스타일) 및 프로필 메뉴. */
export function UserMenu({ onClose }: UserMenuProps) {
  const { signOutUser, user } = useAuth();
  const navigate = useNavigate();
  const { presence, meta, updatePresence } = useMyPresence();
  const [msgInput, setMsgInput] = useState(presence.message);
  const [isEditingMsg, setIsEditingMsg] = useState(false);

  // 로그인 사용자 정보
  const name = user?.name ?? '게스트';
  const email = user?.email ?? '-';
  const initials = name.slice(-2);

  const goProfile = () => {
    onClose();
    navigate('/profile');
  };

  const handleStatusClick = (status: UserPresenceStatus) => {
    updatePresence(status);
  };

  const handleMsgSave = () => {
    updatePresence(presence.status, msgInput);
    setIsEditingMsg(false);
  };

  return (
    <>
      <div className="fixed inset-0 z-[55]" onClick={onClose} />
      <div className="absolute right-[-4px] top-[calc(100%+12px)] z-[60] w-84 overflow-hidden rounded-2xl border border-border bg-panel shadow-[0_16px_48px_rgba(16,24,48,0.28)]">
        {/* 프로필 헤더 */}
        <div className="flex flex-col items-center gap-2 bg-teal-soft/80 px-5 pb-4 pt-5">
          {/* 프로필 사진 또는 이니셜 아바타 + 상태 점 */}
          <div className="relative">
            {user?.photoUrl ? (
              <div className="h-16 w-16 overflow-hidden rounded-full border-2 border-teal/30 bg-white shadow-[0_2px_8px_rgba(23,168,154,0.35)]">
                <img src={user.photoUrl} alt="프로필 사진" className="h-full w-full object-cover" />
              </div>
            ) : (
              <div className="grid h-16 w-16 place-items-center rounded-full bg-teal text-[24px] font-bold text-white shadow-[0_2px_8px_rgba(23,168,154,0.35)]">
                {initials}
              </div>
            )}
            <span
              className={`absolute bottom-0 right-0 h-4 w-4 rounded-full border-2 border-white dark:border-panel shadow-xs ${meta.dotColor}`}
              title={meta.label}
            />
          </div>

          <div className="text-center">
            <div className="text-[14px] font-bold text-ink">{name}</div>
            <div className="text-[11px] text-ink3">{email}</div>
          </div>

          {/* 상태 메시지 표시 또는 입력 */}
          <div className="mt-1 w-full max-w-[250px]">
            {isEditingMsg ? (
              <div className="flex items-center gap-1.5 rounded-lg border border-teal bg-white dark:bg-panel px-2.5 py-1">
                <input
                  type="text"
                  value={msgInput}
                  onChange={(e) => setMsgInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleMsgSave();
                    if (e.key === 'Escape') {
                      setMsgInput(presence.message);
                      setIsEditingMsg(false);
                    }
                  }}
                  placeholder="상태 메시지 입력 (예: 3시까지 미팅)"
                  maxLength={50}
                  autoFocus
                  className="w-full bg-transparent text-[11px] text-ink outline-none"
                />
                <button
                  type="button"
                  onClick={handleMsgSave}
                  className="shrink-0 text-[10.5px] font-bold text-teal hover:underline"
                >
                  저장
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setIsEditingMsg(true)}
                className="group flex w-full items-center justify-center gap-1 rounded-lg border border-border/80 bg-white/70 dark:bg-panel/70 px-2.5 py-1 text-[11px] text-ink2 hover:border-teal hover:bg-white transition-all shadow-2xs"
                title="상태 메시지 편집"
              >
                <span className="truncate flex items-center gap-1 justify-center">
                  {presence.message ? (
                    <>
                      <MessageSquare size={11} className="text-teal shrink-0" />
                      <span>"{presence.message}"</span>
                    </>
                  ) : (
                    '+ 상태 메시지 설정'
                  )}
                </span>
              </button>
            )}
          </div>
        </div>

        {/* Teams/Discord 스타일 실시간 상태 선택기 */}
        <div className="border-b border-border bg-panel-alt/30 p-2.5">
          <div className="mb-2 px-1 text-[10.5px] font-bold text-ink3">현재 근무·활동 상태</div>
          {/* 직접 고를 수 있는 상태만 — 외근·회의·휴가는 전자결재·캘린더로 자동 표시된다 */}
          <div className="grid grid-cols-2 gap-1.5">
            {MANUAL_PRESENCE_STATUSES.map((st) => {
              const item = USER_PRESENCE_META[st];
              const isSelected = presence.status === st;
              return (
                <button
                  key={st}
                  type="button"
                  onClick={() => handleStatusClick(st)}
                  className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-left transition-all ${
                    isSelected
                      ? 'bg-panel font-bold shadow-xs border border-border ring-1 ring-teal/30'
                      : 'hover:bg-panel/60 font-medium text-ink2 opacity-80 hover:opacity-100'
                  }`}
                >
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${item.dotColor}`} />
                  <span className="truncate text-[11px]">{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="border-b border-border py-1.5">
          <Item
            icon={<UserIcon size={14} />}
            label="내 계정 관리"
            sub="프로필 사진 및 개인정보 설정"
            onClick={goProfile}
          />
          <Item
            icon={<Settings size={14} />}
            label="환경설정"
            sub="테마 및 기본 환경 설정"
            onClick={() => {
              onClose();
              navigate('/settings');
            }}
          />
          <Item icon={<Globe size={14} />} label="언어 / 지역" sub="한국어 (Korea)" />
        </div>

        <div className="py-2">
          <div className="px-[18px] pb-1 pt-0.5 text-[10px] font-extrabold tracking-wide text-ink3">접속 환경</div>
          <button onClick={onClose} className="flex w-full items-center gap-3 px-[18px] py-1.5 text-left transition-colors hover:bg-panel-alt">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[7px] bg-blue-soft text-[12px] font-extrabold text-blue">M1</span>
            <span className="min-w-0 flex-1">
              <span className="block text-[12px] font-semibold text-ink">[WorkFit] M-line · Fab1</span>
              <span className="mt-px block text-[10px] text-ink3">현재 접속 라인</span>
            </span>
            <span className="text-[10px] font-semibold text-ink3">변경 ▾</span>
          </button>
        </div>

        <div className="flex border-t border-border">
          <button onClick={onClose} className="flex-1 border-r border-border py-2.5 text-[11.5px] font-semibold text-ink2 hover:bg-panel-alt">도움말</button>
          <button
            onClick={() => {
              onClose();
              navigate('/', { replace: true });
              void signOutUser();
            }}
            className="flex-1 py-2.5 text-[11.5px] font-bold text-danger hover:bg-panel-alt"
          >
            로그아웃
          </button>
        </div>
      </div>
    </>
  );
}
