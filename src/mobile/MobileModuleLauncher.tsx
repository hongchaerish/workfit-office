import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  MessageSquare,
  ClipboardCheck,
  Clock,
  Calendar,
  CheckSquare,
  Users,
  Megaphone,
  Building2,
  Mail,
  BarChart3,
  Camera,
  FolderGit2,
  Network,
  ChevronRight,
  Bell,
  ShieldCheck,
  ListTodo,
} from 'lucide-react';
import { useAuth } from '@/app/auth/AuthProvider';
import { useApprovalBoxes } from '@/features/gw/useApprovals';
import { currentApproverIds, getPredecessorsOf } from '@/domain/approvalDoc/engine';
import type { ApprovalDoc } from '@/domain/approvalDoc/schema';
import { useMyPresence } from '@/features/userPresence/useUserPresence';
import { PresenceBadge } from '@/features/userPresence/PresenceIndicator';
import { enablePushForUser } from '@/shared/lib/messaging';
import { useSecurityContext } from '@/features/auth/useSecurityContext';
import { commutePolicy } from '@/domain/security/policy/commutePolicy';
import { workPlanPolicy } from '@/domain/security/policy/workPlanPolicy';
import MobileUserMenuSheet from './MobileUserMenuSheet';

interface CoreAppItem {
  id: string;
  name: string;
  desc: string;
  path: string;
  icon: React.ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;
  badge?: number | string;
  badgeColor?: string;
  iconBg: string;
  iconColor: string;
  disabled?: boolean;
}

interface CollabAppItem {
  id: string;
  name: string;
  desc: string;
  path: string;
  icon: React.ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;
  badge?: string;
  disabled?: boolean;
}

export default function MobileModuleLauncher() {
  const { user } = useAuth();
  const nav = useNavigate();
  const me = user?.id || '';

  const securityContext = useSecurityContext();
  const canAccessCommuteAdmin = useMemo(() => {
    return commutePolicy.canAccessCommuteAdmin(securityContext);
  }, [securityContext]);
  const canAccessWorkPlanAdmin = useMemo(() => {
    return workPlanPolicy.canAccessWorkPlanAdmin(securityContext);
  }, [securityContext]);

  const { presence: myPresence } = useMyPresence();
  const { byBox } = useApprovalBoxes(me);
  const preds = useMemo(() => (me ? getPredecessorsOf(me) : []), [me]);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [notice, setNotice] = useState('');

  // 1. 미결재 건수 계산
  const pendingApprovals = useMemo(() => {
    if (!me) return 0;
    const list = byBox['대기'] ?? [];
    return list.filter((d: ApprovalDoc) => {
      const approvers = currentApproverIds(d);
      return approvers.includes(me) || approvers.some((id) => preds.includes(id));
    }).length;
  }, [byBox, me, preds]);

  // 2. 오늘 날짜 텍스트
  const todayText = useMemo(() => {
    const now = new Date();
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const day = days[now.getDay()];
    return `${y}. ${m}. ${d} (${day})`;
  }, []);

  const enablePush = async () => {
    setNotice('알림 설정 중…');
    const res = await enablePushForUser(me);
    setNotice(res.ok ? '✅ 알림이 켜졌습니다.' : `⚠️ 알림 실패 — ${res.error}`);
    setTimeout(() => setNotice(''), 5000);
  };

  // ── [1단] 웹 버전 최상단 1행과 100% 일치하는 4대 필수 핵심 업무 ──
  const coreApps: CoreAppItem[] = useMemo(
    () => [
      {
        id: 'approval',
        name: '전자결재',
        desc: '기안·품의·승인 결재함',
        path: '/m/approval',
        icon: ClipboardCheck,
        badge: pendingApprovals > 0 ? `${pendingApprovals}건 대기` : undefined,
        badgeColor: 'bg-rose-500 text-white',
        iconBg: 'bg-rose-500/10 dark:bg-rose-500/20',
        iconColor: 'text-rose-600 dark:text-rose-400',
      },
      {
        id: 'mail',
        name: '사내메일',
        desc: '비즈니스 송수신 메일 (준비 중)',
        path: '/m/mail',
        icon: Mail,
        badge: '준비 중',
        badgeColor: 'bg-slate-400 text-white',
        iconBg: 'bg-slate-500/10 dark:bg-slate-500/20',
        iconColor: 'text-slate-600 dark:text-slate-400',
        disabled: true,
      },
      {
        id: 'task',
        name: '내 업무계획',
        desc: '일일 To-Do & 실무 공유',
        path: '/m/task',
        icon: CheckSquare,
        iconBg: 'bg-emerald-500/10 dark:bg-emerald-500/20',
        iconColor: 'text-emerald-600 dark:text-emerald-400',
      },
      {
        id: 'commute',
        name: '내 출퇴근·휴가',
        desc: '출퇴근 기록 및 잔여 연차',
        path: '/m/commute',
        icon: Clock,
        iconBg: 'bg-teal-500/10 dark:bg-teal-500/20',
        iconColor: 'text-teal dark:text-teal-300',
      },
    ],
    [pendingApprovals]
  );

  // ── [2단] 웹 버전 일반 8종 협업 & 편의 모듈 ──
  const collabApps: CollabAppItem[] = useMemo(
    () => [
      {
        id: 'calendar',
        name: '캘린더',
        desc: '전사·개인 캘린더 및 외근·출장',
        path: '/m/calendar',
        icon: Calendar,
      },
      {
        id: 'board',
        name: '사내게시판',
        desc: '전사 공지사항 및 경조사',
        path: '/m/board',
        icon: Megaphone,
      },
      {
        id: 'contacts',
        name: '인명관리',
        desc: '임직원 연락처 검색 및 주소록',
        path: '/m/contacts',
        icon: Users,
      },
      {
        id: 'gallery',
        name: '회사 갤러리',
        desc: '사내 행사 및 전사 사진첩',
        path: '/m/gallery',
        icon: Camera,
      },
      {
        id: 'project',
        name: '프로젝트',
        desc: '전사 협업 관리 (준비 중)',
        path: '/m/project',
        icon: FolderGit2,
        badge: '준비 중',
        disabled: true,
      },
      {
        id: 'resource',
        name: '자원예약',
        desc: '회의실·차량·공용 장비 예약',
        path: '/m/resource',
        icon: Building2,
      },
      {
        id: 'survey',
        name: '전자설문',
        desc: '임직원 의견 수렴 및 만족도 조사',
        path: '/m/survey',
        icon: BarChart3,
      },
      {
        id: 'orgchart',
        name: '조직도',
        desc: '부서 계층 및 임직원 배치도',
        path: '/m/orgchart',
        icon: Network,
      },
    ],
    []
  );

  // ── [3단] 부서장/관리자 전용 관제 센터 (권한자에게만 노출) ──
  const adminApps = useMemo(() => {
    const list = [];
    if (canAccessCommuteAdmin) {
      list.push({
        id: 'commute-admin',
        name: '근태·휴가 관제 센터',
        desc: '전사/부서 실시간 출퇴근 현황, 이상근태(지각) 및 연차 대장 관제',
        path: '/m/commute-admin',
        icon: ShieldCheck,
        badge: '관제센터',
        tagColor: 'bg-indigo-600 text-white',
        borderHover: 'hover:border-indigo-400',
      });
    }
    if (canAccessWorkPlanAdmin) {
      list.push({
        id: 'work-plan-admin',
        name: '팀·전사 업무 종합 현황',
        desc: '팀원/전사원 주간 To-Do 매트릭스 취합 및 실무 진척률 모니터링',
        path: '/m/work-plan-admin',
        icon: ListTodo,
        badge: '업무종합',
        tagColor: 'bg-teal text-white',
        borderHover: 'hover:border-teal',
      });
    }
    return list;
  }, [canAccessCommuteAdmin, canAccessWorkPlanAdmin]);

  const initials = user?.name ? user.name.slice(-2) : 'WF';

  return (
    <div className="flex h-full flex-col select-none overflow-hidden" style={{ background: '#f4f6fa' }}>
      {/* 1. 상단 네이비 프리미엄 헤더 */}
      <header
        className="flex items-center justify-between px-3.5 py-3 text-white shrink-0 shadow-xs"
        style={{ background: '#101830' }}
      >
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => nav('/m')}
            className="grid h-8.5 w-8.5 place-items-center rounded-xl hover:bg-white/10 active:scale-95 transition-all text-white/90 hover:text-white"
            title="메신저로 돌아가기"
          >
            <ArrowLeft size={20} strokeWidth={2.2} />
          </button>
          <div className="flex items-center gap-1.5">
            <span className="text-[16px] font-extrabold text-white tracking-tight">Workfit Office</span>
            <span className="rounded-md bg-teal/20 px-1.5 py-0.2 text-[10px] font-bold text-teal">
              Mobile
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {/* 푸시 알림 설정 */}
          <button
            type="button"
            onClick={enablePush}
            className="grid h-8.5 w-8.5 place-items-center rounded-xl hover:bg-white/10 active:scale-95 transition-all text-white/80 hover:text-white"
            title="푸시 알림 켜기"
          >
            <Bell size={18} strokeWidth={2} />
          </button>

          {/* 프로필 아바타 */}
          <button
            type="button"
            onClick={() => setIsUserMenuOpen(true)}
            className="relative flex items-center rounded-full p-0.5 hover:ring-2 hover:ring-white/30 transition-all active:scale-95"
            title="내 프로필 및 근무 상태"
          >
            {user?.photoUrl ? (
              <img
                src={user.photoUrl}
                alt={user.name}
                className="h-7.5 w-7.5 rounded-full object-cover border border-white/30"
              />
            ) : (
              <div
                className="grid h-7.5 w-7.5 place-items-center rounded-full text-[11px] font-bold text-white shadow-xs"
                style={{ background: '#0da5a0' }}
              >
                {initials}
              </div>
            )}
          </button>
        </div>
      </header>

      {/* 알림 토스트 배너 */}
      {notice && (
        <div className="bg-teal px-3 py-1.5 text-center text-[11.5px] font-bold text-white animate-in fade-in">
          {notice}
        </div>
      )}

      {/* 2. 스크롤 가능한 본문 영역 */}
      <div className="flex-1 overflow-y-auto px-4 py-3.5 space-y-4">
        {/* 상단 웰컴 & 3-Grid 핵심 현황 대시보드 카드 */}
        <div className="rounded-2xl border border-border/80 bg-white p-4 shadow-xs">
          <div className="flex items-start justify-between">
            <div>
              <span className="text-[11px] font-semibold text-ink3">{todayText}</span>
              <h2 className="text-[16px] font-extrabold text-ink tracking-tight mt-0.5">
                {user?.name || '임직원'} 님, 좋은 하루 되세요!
              </h2>
              <p className="text-[11px] text-ink2 mt-0.5">
                {user?.dept || '소속부서'} · {user?.position || '직급'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsUserMenuOpen(true)}
              className="flex items-center gap-1 rounded-full border border-border bg-panel-alt px-2.5 py-1 text-[11px] font-bold hover:bg-panel transition-all active:scale-95 cursor-pointer shadow-2xs"
            >
              <PresenceBadge status={myPresence.status} />
            </button>
          </div>

          {/* 3-Grid 콤팩트 업무 요약 칩 */}
          <div className="grid grid-cols-3 gap-2 mt-3.5 pt-3 border-t border-border/60">
            {/* 결재 대기 */}
            <button
              type="button"
              onClick={() => nav('/m/approval')}
              className="flex flex-col rounded-xl bg-slate-50 border border-slate-200/80 p-2 text-left hover:bg-slate-100 transition-all active:scale-98"
            >
              <span className="text-[10px] font-semibold text-ink3">미결재</span>
              <span className={`text-[12.5px] font-extrabold mt-0.5 ${pendingApprovals > 0 ? 'text-rose-600' : 'text-ink'}`}>
                {pendingApprovals > 0 ? `${pendingApprovals}건` : '0건'}
              </span>
            </button>

            {/* 안 읽은 메일 (준비 중 - 터치 차단 및 회색 표기) */}
            <div
              className="flex flex-col rounded-xl bg-slate-100/60 border border-slate-200/60 p-2 text-left pointer-events-none opacity-50 grayscale select-none cursor-not-allowed"
            >
              <span className="text-[10px] font-semibold text-slate-400">사내메일</span>
              <span className="text-[12px] font-bold text-slate-400 mt-0.5">
                준비 중
              </span>
            </div>

            {/* 메신저 대화방 */}
            <button
              type="button"
              onClick={() => nav('/m')}
              className="flex flex-col rounded-xl bg-teal-50/70 border border-teal-200/80 p-2 text-left hover:bg-teal-100/70 transition-all active:scale-98"
            >
              <span className="text-[10px] font-semibold text-teal">메신저</span>
              <span className="text-[12.5px] font-extrabold text-teal mt-0.5">
                대화방 바로가기
              </span>
            </button>
          </div>
        </div>

        {/* ── [1단] 4대 핵심 업무 (Core 4 대형 카드) ── */}
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-1.5">
              <span className="h-3 w-1 rounded-full bg-teal" />
              <h3 className="text-[12px] font-extrabold text-ink tracking-wider uppercase">
                핵심 업무
              </h3>
            </div>
            <span className="text-[10.5px] text-ink3">자주 쓰는 모듈</span>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            {coreApps.map((item) => {
              const IconComponent = item.icon;
              if (item.disabled) {
                return (
                  <div
                    key={item.id}
                    className="relative flex flex-col justify-between rounded-2xl border border-slate-200 bg-slate-100/70 p-3.5 text-left opacity-50 grayscale pointer-events-none cursor-not-allowed select-none"
                  >
                    <div className="flex items-start justify-between gap-1">
                      <div className={`grid h-10 w-10 place-items-center rounded-xl ${item.iconBg} ${item.iconColor}`}>
                        <IconComponent size={20} strokeWidth={2.3} />
                      </div>
                      {item.badge && (
                        <span className={`rounded-full px-2 py-0.5 text-[9.5px] font-extrabold shadow-2xs ${item.badgeColor || 'bg-slate-300 text-slate-700'}`}>
                          {item.badge}
                        </span>
                      )}
                    </div>

                    <div className="mt-3">
                      <h4 className="text-[13.5px] font-extrabold text-slate-600 tracking-tight">
                        {item.name}
                      </h4>
                      <p className="text-[10.5px] text-slate-400 line-clamp-1 mt-0.5">
                        {item.desc}
                      </p>
                    </div>
                  </div>
                );
              }

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => nav(item.path)}
                  className="group relative flex flex-col justify-between rounded-2xl border border-border/80 bg-white p-3.5 text-left shadow-2xs hover:border-teal/50 hover:shadow-xs transition-all active:scale-97 cursor-pointer"
                >
                  <div className="flex items-start justify-between gap-1">
                    <div className={`grid h-10 w-10 place-items-center rounded-xl ${item.iconBg} ${item.iconColor} transition-transform group-hover:scale-105`}>
                      <IconComponent size={20} strokeWidth={2.3} />
                    </div>
                    {item.badge && (
                      <span className={`rounded-full px-2 py-0.5 text-[9.5px] font-extrabold shadow-2xs ${item.badgeColor || 'bg-panel-alt text-ink2'}`}>
                        {item.badge}
                      </span>
                    )}
                  </div>

                  <div className="mt-3">
                    <h4 className="text-[13.5px] font-extrabold text-ink group-hover:text-teal transition-colors tracking-tight">
                      {item.name}
                    </h4>
                    <p className="text-[10.5px] text-ink3 line-clamp-1 mt-0.5">
                      {item.desc}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── [2단] 전사 협업 & 편의 (Collaboration 8종 정돈 그리드) ── */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 px-1">
            <span className="h-3 w-1 rounded-full bg-slate-400" />
            <h3 className="text-[12px] font-extrabold text-ink tracking-wider uppercase">
              협업 & 소통
            </h3>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            {collabApps.map((item) => {
              const IconComponent = item.icon;
              if (item.disabled) {
                return (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-100/70 p-3 text-left opacity-50 grayscale pointer-events-none cursor-not-allowed select-none"
                  >
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-200 text-slate-500">
                      <IconComponent size={18} strokeWidth={2.1} />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1">
                        <h4 className="text-[12.5px] font-bold text-slate-600 truncate">
                          {item.name}
                        </h4>
                        {item.badge && (
                          <span className="rounded bg-slate-300 border border-slate-400/40 px-1 py-0.2 text-[8.5px] font-extrabold text-slate-600 shrink-0">
                            {item.badge}
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-slate-400 truncate mt-0.2">
                        {item.desc}
                      </p>
                    </div>
                  </div>
                );
              }

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => nav(item.path)}
                  className="group flex items-center gap-3 rounded-2xl border border-border/70 bg-white p-3 text-left shadow-2xs hover:border-slate-300 hover:shadow-xs transition-all active:scale-97 cursor-pointer"
                >
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 transition-colors group-hover:bg-teal-50 group-hover:text-teal">
                    <IconComponent size={18} strokeWidth={2.1} />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1">
                      <h4 className="text-[12.5px] font-bold text-ink group-hover:text-teal transition-colors truncate">
                        {item.name}
                      </h4>
                      {item.badge && (
                        <span className="rounded bg-amber-500/15 border border-amber-500/30 px-1 py-0.2 text-[8.5px] font-extrabold text-amber-600 dark:text-amber-400 shrink-0">
                          {item.badge}
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-ink3 truncate mt-0.2">
                      {item.desc}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── [3단] 팀장·관리자 관제 센터 (권한자에게만 노출) ── */}
        {adminApps.length > 0 && (
          <div className="space-y-2 pt-1">
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-1.5">
                <span className="h-3 w-1 rounded-full bg-indigo-600" />
                <h3 className="text-[12px] font-extrabold text-indigo-950 dark:text-indigo-300 tracking-wider uppercase">
                  팀장 & 관리자 관제 센터
                </h3>
              </div>
              <span className="rounded-md bg-indigo-100 px-1.5 py-0.2 text-[9.5px] font-bold text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-400">
                Authorized Only
              </span>
            </div>

            <div className="space-y-2">
              {adminApps.map((item) => {
                const IconComponent = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => nav(item.path)}
                    className={`group flex w-full items-center justify-between rounded-2xl border border-indigo-100 dark:border-indigo-900/40 bg-gradient-to-r from-indigo-50/50 via-white to-white dark:from-indigo-950/20 dark:to-slate-900 p-3.5 text-left shadow-2xs ${item.borderHover} transition-all active:scale-98 cursor-pointer`}
                  >
                    <div className="flex items-center gap-3.5 min-w-0 flex-1">
                      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-indigo-600 text-white shadow-xs">
                        <IconComponent size={20} strokeWidth={2.3} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <h4 className="text-[13px] font-extrabold text-ink group-hover:text-indigo-600 transition-colors">
                            {item.name}
                          </h4>
                          <span className={`rounded-full px-1.5 py-0.2 text-[9px] font-bold ${item.tagColor}`}>
                            {item.badge}
                          </span>
                        </div>
                        <p className="text-[10.5px] text-ink3 line-clamp-1 mt-0.5">
                          {item.desc}
                        </p>
                      </div>
                    </div>
                    <ChevronRight size={16} className="text-ink3 group-hover:text-indigo-600 transition-colors shrink-0 ml-2" />
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* 하단 메신저 바로가기 퀵 바 */}
        <div className="pt-2 pb-6">
          <button
            type="button"
            onClick={() => nav('/m')}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#101830] py-3 text-[13px] font-bold text-white shadow-md hover:bg-[#162344] active:scale-98 transition-all cursor-pointer"
          >
            <MessageSquare size={16} />
            <span>메신저로 돌아가기</span>
          </button>
        </div>
      </div>

      {/* 내 프로필 및 상태 관리 시트 */}
      <MobileUserMenuSheet
        isOpen={isUserMenuOpen}
        onClose={() => setIsUserMenuOpen(false)}
      />
    </div>
  );
}
