import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  Phone,
  MessageCircle,
  Mail,
  Users,
  MessageSquare,
} from 'lucide-react';
import { useAuth } from '@/app/auth/AuthProvider';
import { useUsers } from '@/features/user/useUsers';
import { useEmployeeProfiles } from '@/features/employeeProfile/useEmployeeProfiles';
import { useAllUserPresences } from '@/features/userPresence/useUserPresence';
import { PresenceDot } from '@/features/userPresence/PresenceIndicator';
import { useChatRooms, useCreateRoom } from '@/features/chat/useChatRooms';
import MobileCommonHeader from './MobileCommonHeader';

export default function MobileContactScreen() {
  const { user } = useAuth();
  const nav = useNavigate();
  const me = user?.id || '';

  const [query, setQuery] = useState('');
  const [selectedDept, setSelectedDept] = useState('ALL');

  const { data: users = [] } = useUsers();
  const { data: employeeProfiles = [] } = useEmployeeProfiles();
  const presenceMap = useAllUserPresences();
  const { data: rooms = [] } = useChatRooms(me);
  const createRoom = useCreateRoom();

  // 재직 중인 사원 목록 필터링
  const activeUsers = useMemo(() => {
    return users.filter((u) => u.status === '사용' && !u.resignedAt);
  }, [users]);

  // 개인이메일은 인사정보(employeeProfiles)에 저장됨
  const personalEmailMap = useMemo(() => {
    const map = new Map<string, string>();
    employeeProfiles.forEach((p) => {
      if (p.personalEmail) map.set(p.userId || p.id, p.personalEmail);
    });
    return map;
  }, [employeeProfiles]);

  // 부서 목록 추출
  const departments = useMemo(() => {
    const set = new Set<string>();
    activeUsers.forEach((u) => {
      if (u.dept) set.add(u.dept);
    });
    return Array.from(set).sort();
  }, [activeUsers]);

  // 검색 및 부서 필터 적용
  const filteredUsers = useMemo(() => {
    const kw = query.trim().toLowerCase();
    return activeUsers
      .filter((u) => {
        if (selectedDept !== 'ALL' && u.dept !== selectedDept) return false;
        if (!kw) return true;
        const phone = (u as { phone?: string }).phone ?? '';
        return (
          u.name.toLowerCase().includes(kw) ||
          u.dept.toLowerCase().includes(kw) ||
          (u.position ?? '').toLowerCase().includes(kw) ||
          phone.includes(kw) ||
          (u.email ?? '').toLowerCase().includes(kw) ||
          (personalEmailMap.get(u.id) ?? '').toLowerCase().includes(kw)
        );
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  }, [activeUsers, selectedDept, query, personalEmailMap]);

  // 1:1 대화 시작 핸들러
  const handleStartChat = async (targetUserId: string) => {
    if (targetUserId === me) return;
    // 이미 존재하는 1:1 방이 있는지 확인
    const existingRoom = rooms.find(
      (r) => r.type === 'direct' && r.members.includes(targetUserId) && r.members.includes(me)
    );

    if (existingRoom) {
      nav(`/m/room/${existingRoom.id}`);
    } else {
      try {
        const targetUser = users.find((u) => u.id === targetUserId);
        const res = await createRoom.mutateAsync({
          name: targetUser?.name || '1:1 대화',
          type: 'direct',
          members: [me, targetUserId],
        });
        if (res?.id) {
          nav(`/m/room/${res.id}`);
        }
      } catch {
        nav('/m/new');
      }
    }
  };

  return (
    <div className="flex h-full flex-col select-none overflow-hidden" style={{ background: '#f2f8fc' }}>
      <MobileCommonHeader title="인명관리" subtitle={`총 ${activeUsers.length}명 재직`} />

      {/* 1. 검색창 */}
      <div className="bg-white px-3.5 py-2.5 border-b border-border/70 shrink-0 shadow-2xs">
        <div className="relative">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="사원 이름, 부서, 직급 검색…"
            className="h-9 w-full rounded-xl border border-border bg-panel px-3 pl-8.5 text-[12px] text-ink outline-none focus:border-teal placeholder:text-ink3"
          />
          <Search size={14} className="absolute left-2.5 top-2.5 text-ink3 pointer-events-none" />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-2.5 top-2 text-[11px] font-bold text-ink3 hover:text-ink"
            >
              ✕
            </button>
          )}
        </div>

        {/* 2. 부서 필터 칩 */}
        <div className="flex items-center gap-1 overflow-x-auto pt-2 scrollbar-none">
          <button
            type="button"
            onClick={() => setSelectedDept('ALL')}
            className={`rounded-full px-2.5 py-0.5 text-[10.5px] font-bold transition-all shrink-0 ${
              selectedDept === 'ALL'
                ? 'bg-teal text-white shadow-2xs'
                : 'bg-panel-alt text-ink2 border border-border/60 hover:border-teal'
            }`}
          >
            전체 ({activeUsers.length})
          </button>
          {departments.map((dept) => {
            const count = activeUsers.filter((u) => u.dept === dept).length;
            return (
              <button
                key={dept}
                type="button"
                onClick={() => setSelectedDept(dept)}
                className={`rounded-full px-2.5 py-0.5 text-[10.5px] font-bold transition-all shrink-0 ${
                  selectedDept === dept
                    ? 'bg-teal text-white shadow-2xs'
                    : 'bg-panel-alt text-ink2 border border-border/60 hover:border-teal'
                }`}
              >
                {dept} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. 임직원 목록 */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 pb-6">
        {filteredUsers.length === 0 ? (
          <div className="py-16 text-center text-ink3 border border-dashed border-border/80 rounded-2xl bg-white/60">
            <Users size={32} className="mx-auto mb-2 text-ink3/40" />
            <p className="text-[12.5px] font-bold text-ink">일치하는 임직원이 없습니다.</p>
          </div>
        ) : (
          filteredUsers.map((u) => {
            const presence = presenceMap[u.id];
            const isMe = u.id === me;
            const initials = u.name.slice(-2);
            const personalEmail = personalEmailMap.get(u.id) ?? '';
            const showBothEmails = Boolean(u.email && personalEmail && u.email !== personalEmail);

            return (
              <div
                key={u.id}
                className="rounded-2xl border border-border/80 bg-white p-3 shadow-2xs hover:border-teal/40 transition-all space-y-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="relative shrink-0">
                      {u.photoUrl ? (
                        <img
                          src={u.photoUrl}
                          alt={u.name}
                          className="h-10 w-10 rounded-full object-cover border border-border"
                        />
                      ) : (
                        <div
                          className="grid h-10 w-10 place-items-center rounded-full text-[12px] font-bold text-white shadow-xs"
                          style={{ background: '#17a89a' }}
                        >
                          {initials}
                        </div>
                      )}
                      <div className="absolute -bottom-0.5 -right-0.5">
                        <PresenceDot status={presence?.status ?? 'offline'} />
                      </div>
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <h4 className="text-[13.5px] font-bold text-ink truncate">{u.name}</h4>
                        {u.position && (
                          <span className="text-[11px] font-semibold text-ink3">
                            {u.position}
                          </span>
                        )}
                        {isMe && (
                          <span className="rounded bg-teal/15 px-1 py-0.2 text-[9px] font-bold text-teal">
                            나
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-ink2 mt-0.5 truncate">
                        {u.dept} {u.jobTitle ? `· ${u.jobTitle}` : ''}
                      </p>
                      {showBothEmails && (
                        <div className="mt-1 space-y-0.5 font-mono text-[10.5px]">
                          <a href={`mailto:${u.email}`} className="flex items-center gap-1 min-w-0 text-ink2">
                            <span className="shrink-0 rounded bg-teal-soft/40 px-1 font-sans text-[9px] font-bold text-teal">회사</span>
                            <span className="truncate">{u.email}</span>
                          </a>
                          <a href={`mailto:${personalEmail}`} className="flex items-center gap-1 min-w-0 text-ink3">
                            <span className="shrink-0 rounded bg-panel-alt px-1 font-sans text-[9px] font-bold text-ink3">개인</span>
                            <span className="truncate">{personalEmail}</span>
                          </a>
                        </div>
                      )}
                    </div>
                  </div>

                  {presence?.message && (
                    <span className="text-[10px] text-ink3 bg-panel-alt rounded px-1.5 py-0.5 max-w-[100px] truncate">
                      {presence.message}
                    </span>
                  )}
                </div>

                {/* 모바일 퀵 액션 버튼 바: 전화 / 문자 / 메일 / 1:1 대화 */}
                {(() => {
                  const phone = (u as { phone?: string }).phone;
                  return (
                    <div className="grid grid-cols-4 gap-1.5 pt-2 border-t border-border/60">
                      {/* 전화걸기 */}
                      {phone ? (
                        <a
                          href={`tel:${phone}`}
                          className="flex items-center justify-center gap-1 rounded-xl bg-teal-soft/20 py-1.5 text-[11px] font-bold text-teal hover:bg-teal-soft/40 active:scale-95 transition-all"
                          title="전화 걸기"
                        >
                          <Phone size={13} />
                          <span>통화</span>
                        </a>
                      ) : (
                        <span className="flex items-center justify-center rounded-xl bg-panel-alt py-1.5 text-[11px] text-ink3/40 cursor-not-allowed">
                          <Phone size={13} />
                        </span>
                      )}

                      {/* 문자보내기 */}
                      {phone ? (
                        <a
                          href={`sms:${phone}`}
                          className="flex items-center justify-center gap-1 rounded-xl bg-blue-500/10 py-1.5 text-[11px] font-bold text-blue-600 hover:bg-blue-500/20 active:scale-95 transition-all"
                          title="SMS 문자"
                        >
                          <MessageCircle size={13} />
                          <span>문자</span>
                        </a>
                      ) : (
                        <span className="flex items-center justify-center rounded-xl bg-panel-alt py-1.5 text-[11px] text-ink3/40 cursor-not-allowed">
                          <MessageCircle size={13} />
                        </span>
                      )}

                  {/* 이메일 */}
                  {u.email ? (
                    <a
                      href={`mailto:${u.email}`}
                      className="flex items-center justify-center gap-1 rounded-xl bg-amber-500/10 py-1.5 text-[11px] font-bold text-amber-600 hover:bg-amber-500/20 active:scale-95 transition-all"
                      title="메일 쓰기"
                    >
                      <Mail size={13} />
                      <span>메일</span>
                    </a>
                  ) : (
                    <span className="flex items-center justify-center rounded-xl bg-panel-alt py-1.5 text-[11px] text-ink3/40 cursor-not-allowed">
                      <Mail size={13} />
                    </span>
                  )}

                  {/* 1:1 메신저 */}
                  {!isMe ? (
                    <button
                      type="button"
                      onClick={() => handleStartChat(u.id)}
                      className="flex items-center justify-center gap-1 rounded-xl bg-[#101830] py-1.5 text-[11px] font-bold text-white hover:bg-[#1a264a] active:scale-95 transition-all cursor-pointer shadow-2xs"
                      title="1:1 대화"
                    >
                      <MessageSquare size={13} />
                      <span>채팅</span>
                    </button>
                  ) : (
                    <span className="flex items-center justify-center rounded-xl bg-panel-alt py-1.5 text-[10.5px] font-bold text-ink3">
                      본인
                    </span>
                  )}
                </div>
                  );
                })()}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
