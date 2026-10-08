import { useState, useEffect, useMemo } from 'react';
import {
  Settings,
  Palette,
  Bell,
  UserCheck,
  Check,
  AlertCircle,
  Lightbulb,
  Calendar,
  FileText,
  CheckSquare,
  Square,
} from 'lucide-react';
import {
  applyTheme,
  getContrastColor,
  loadUserTheme,
  saveUserTheme,
  DEFAULT_THEME_SETTINGS,
} from '@/shared/lib/theme';
import { useAuth } from '@/app/auth/AuthProvider';
import { absenceRepo } from '@/data/absence/absence.repo';
import { userRepo } from '@/data/user/user.repo';
import { approvalFormRepo } from '@/data/approvalForm/approvalForm.repo';
import { approvalProcessRepo } from '@/data/approvalProcess/approvalProcess.repo';
import type { User } from '@/domain/user/schema';
import type { UserAbsenceConfig } from '@/domain/absence/schema';
import type { ApprovalForm } from '@/domain/approvalForm/schema';

export default function SettingsScreen() {
  const { user: me } = useAuth();
  const [activeTab, setActiveTab] = useState<'theme' | 'notification' | 'proxy'>('theme');

  // Theme states (사용자별 안전 격리)
  const [headerBg, setHeaderBg] = useState(() => loadUserTheme(me?.id).headerBg);
  const [pointColor, setPointColor] = useState(() => loadUserTheme(me?.id).pointColor);
  const [btnColor, setBtnColor] = useState(() => loadUserTheme(me?.id).btnColor);

  // Notification states (mock)
  const [notiMute, setNotiMute] = useState(false);
  const [notiPush, setNotiPush] = useState(true);
  const [notiChat, setNotiChat] = useState(true);
  const [notiApproval, setNotiApproval] = useState(true);

  // Font scale states (사용자별 안전 격리)
  const [fontScale, setFontScale] = useState(() => loadUserTheme(me?.id).fontScale);

  // Absence / Proxy states
  const [users, setUsers] = useState<User[]>([]);
  const [allMasterForms, setAllMasterForms] = useState<ApprovalForm[]>([]);
  const [isProxySystemEnabled, setIsProxySystemEnabled] = useState(true);
  const [absenceConfig, setAbsenceConfig] = useState<UserAbsenceConfig>({
    userId: me?.id ?? '',
    isAbsent: false,
    startDate: '',
    endDate: '',
    delegateUserId: '',
    reason: '휴가',
    scope: 'ALL',
    allowedDocTypes: [],
    maxDelegateAmount: null,
    updatedAt: null,
  });
  const [absenceToast, setAbsenceToast] = useState<string | null>(null);

  // Load theme, users, forms, process options, and absence config
  useEffect(() => {
    const currentTheme = loadUserTheme(me?.id);
    setHeaderBg(currentTheme.headerBg);
    setPointColor(currentTheme.pointColor);
    setBtnColor(currentTheme.btnColor);
    setFontScale(currentTheme.fontScale);

    // Load users list for delegate selection
    userRepo.list().then((res) => {
      setUsers(res);
    });

    // Load active approval forms list
    approvalFormRepo.list().then((res) => {
      setAllMasterForms(res);
    });

    // Check system proxy approval option status
    approvalProcessRepo.isOptionEnabled('proxy_approval').then((enabled) => {
      setIsProxySystemEnabled(enabled);
    });

    // Load absence config if user is logged in
    if (me?.id) {
      absenceRepo.get(me.id).then((cfg) => {
        setAbsenceConfig(cfg);
      });
    }
  }, [me?.id]);

  const handleFontScaleChange = (scale: string) => {
    setFontScale(scale);
    document.documentElement.style.setProperty('--font-scale', scale);
  };

  const handleSaveTheme = () => {
    saveUserTheme({ headerBg, pointColor, btnColor, fontScale }, me?.id);
    applyTheme(headerBg, pointColor, btnColor, fontScale);
    alert('설정이 성공적으로 저장되었습니다.');
  };

  const handleResetTheme = () => {
    setHeaderBg(DEFAULT_THEME_SETTINGS.headerBg);
    setPointColor(DEFAULT_THEME_SETTINGS.pointColor);
    setBtnColor(DEFAULT_THEME_SETTINGS.btnColor);
    setFontScale(DEFAULT_THEME_SETTINGS.fontScale);
    document.documentElement.style.setProperty('--font-scale', DEFAULT_THEME_SETTINGS.fontScale);
  };

  const handleSaveAbsence = async () => {
    if (!me?.id) return;
    if (absenceConfig.isAbsent && !absenceConfig.delegateUserId) {
      alert('대결을 수행할 대결자를 지정해주세요.');
      return;
    }
    const saved = await absenceRepo.save({
      ...absenceConfig,
      userId: me.id,
    });
    setAbsenceConfig(saved);
    setAbsenceToast('부재 및 대결 설정이 저장되었습니다.');
    setTimeout(() => setAbsenceToast(null), 3000);
  };

  const handleResetAbsence = async () => {
    if (!me?.id) return;
    const initial: UserAbsenceConfig = {
      userId: me.id,
      isAbsent: false,
      startDate: '',
      endDate: '',
      delegateUserId: '',
      reason: '휴가',
      scope: 'ALL',
      allowedDocTypes: [],
      maxDelegateAmount: null,
      updatedAt: null,
    };
    const saved = await absenceRepo.save(initial);
    setAbsenceConfig(saved);
    setAbsenceToast('부재 설정이 초기화되었습니다.');
    setTimeout(() => setAbsenceToast(null), 3000);
  };

  const selectedDelegateUser = useMemo(
    () => users.find((u) => u.id === absenceConfig.delegateUserId),
    [users, absenceConfig.delegateUserId]
  );

  const candidateUsers = useMemo(
    () => users.filter((u) => u.id !== me?.id && u.status === '사용'),
    [users, me?.id]
  );

  const allAvailableDocTypes = useMemo(() => {
    if (allMasterForms.length > 0) {
      return allMasterForms.map((f) => f.name).sort((a, b) => a.localeCompare(b, 'ko'));
    }
    return [
      '품의서',
      '지출결의서',
      '휴가신청서',
      '외근신청서',
      '국내출장신청서',
      '해외출장신청서',
      '인장날인신청서',
      '공문발송신청서',
      '구매요청서',
    ].sort((a, b) => a.localeCompare(b, 'ko'));
  }, [allMasterForms]);

  const headerTextColor = useMemo(() => getContrastColor(headerBg), [headerBg]);
  const pointTextColor = useMemo(() => getContrastColor(pointColor), [pointColor]);
  const btnTextColor = useMemo(() => getContrastColor(btnColor), [btnColor]);

  return (
    <div className="w-full pl-1 pr-6 py-4 flex flex-col min-h-screen">
      {/* Toast */}
      {absenceToast && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-xl bg-ink px-4 py-3 text-xs font-semibold text-white shadow-xl animate-in fade-in slide-in-from-bottom-3">
          <Check size={14} className="text-teal" />
          <span>{absenceToast}</span>
        </div>
      )}

      {/* 타이틀 헤더 */}
      <div className="flex items-center gap-2 pb-4 border-b border-border">
        <Settings size={20} className="text-teal" />
        <h1 className="text-[17px] font-bold text-ink">환경설정</h1>
      </div>

      {/* 메인 2열 레이아웃 - 좌측 정렬 및 전폭 확장 */}
      <div className="mt-5 flex gap-6 items-start w-full">
        {/* 좌측: 탭 리스트 (내용 높이에 딱 맞춰 상단 고정) */}
        <div className="w-48 shrink-0 rounded-xl border border-border bg-panel p-2 flex flex-col gap-1 sticky top-[calc(var(--shell-top)+16px)] shadow-xs">
          <div className="px-2.5 py-1 rounded bg-panel-alt text-[10px] font-extrabold tracking-wider uppercase text-ink3 mb-1">
            일반 설정
          </div>
          <button
            onClick={() => setActiveTab('theme')}
            className={`w-full text-left px-3 py-2 rounded-lg text-[12px] font-bold transition-all flex items-center gap-2 ${activeTab === 'theme'
              ? 'bg-teal text-white shadow-sm'
              : 'text-ink2 hover:bg-panel-alt'
              }`}
          >
            <Palette size={14} />
            <span>테마 설정</span>
          </button>
          <button
            onClick={() => setActiveTab('notification')}
            className={`w-full text-left px-3 py-2 rounded-lg text-[12px] font-bold transition-all flex items-center gap-2 ${activeTab === 'notification'
              ? 'bg-teal text-white shadow-sm'
              : 'text-ink2 hover:bg-panel-alt'
              }`}
          >
            <Bell size={14} />
            <span>알림 설정</span>
          </button>

          <div className="px-2.5 py-1 rounded bg-panel-alt text-[10px] font-extrabold tracking-wider uppercase text-ink3 mt-3 mb-1">
            전자결재
          </div>
          <button
            onClick={() => setActiveTab('proxy')}
            className={`w-full text-left px-3 py-2 rounded-lg text-[12px] font-bold transition-all flex items-center gap-2 ${activeTab === 'proxy'
              ? 'bg-teal text-white shadow-sm'
              : 'text-ink2 hover:bg-panel-alt'
              }`}
          >
            <UserCheck size={14} />
            <span>부재/대결 관리</span>
          </button>
        </div>

        {/* 우측: 상세 폼 패널 (내부 스크롤 없이 전체 확장) */}
        <div className="flex-1 rounded-xl border border-border bg-panel p-6 shadow-xs flex flex-col">
          {activeTab === 'theme' && (
            <div className="flex flex-col items-center">
              <div className="w-full">
                <h2 className="text-[14px] font-bold text-ink mb-1">테마 컬러 커스터마이저</h2>
                <p className="text-[11.5px] text-ink3 mb-6">메인 헤더 및 포인트 강조 색상을 사용자의 취향에 맞게 사용자 정의합니다.</p>
              </div>

              <div className="w-full flex flex-col gap-6">
                {/* 헤더 배경색 */}
                <div className="flex items-center justify-between p-4 border border-border rounded-xl bg-panel-alt/50">
                  <div>
                    <div className="text-[13px] font-bold text-ink mb-0.5">상단 헤더 배경색</div>
                    <div className="text-[11px] text-ink3">앱 최상단 내비게이션 바의 스킨 색상</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={headerBg}
                      onChange={(e) => setHeaderBg(e.target.value)}
                      className="w-9 h-9 rounded cursor-pointer border border-border bg-transparent p-0.5"
                    />
                    <span className="text-[12px] font-mono font-semibold text-ink2 uppercase w-16">{headerBg}</span>
                  </div>
                </div>

                {/* 포인트 컬러 */}
                <div className="flex items-center justify-between p-4 border border-border rounded-xl bg-panel-alt/50">
                  <div>
                    <div className="text-[13px] font-bold text-ink mb-0.5">포인트 서브 색상</div>
                    <div className="text-[11px] text-ink3">대시보드 카드 강조 및 활성 탭 하이라이트</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={pointColor}
                      onChange={(e) => setPointColor(e.target.value)}
                      className="w-9 h-9 rounded cursor-pointer border border-border bg-transparent p-0.5"
                    />
                    <span className="text-[12px] font-mono font-semibold text-ink2 uppercase w-16">{pointColor}</span>
                  </div>
                </div>

                {/* 메인 버튼 색상 */}
                <div className="flex items-center justify-between p-4 border border-border rounded-xl bg-panel-alt/50">
                  <div>
                    <div className="text-[13px] font-bold text-ink mb-0.5">주요 버튼 색상</div>
                    <div className="text-[11px] text-ink3">전사 통합 브랜드 컬러 (기본: MES Blue)</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={btnColor}
                      onChange={(e) => setBtnColor(e.target.value)}
                      className="w-9 h-9 rounded cursor-pointer border border-border bg-transparent p-0.5"
                    />
                    <span className="text-[12px] font-mono font-semibold text-ink2 uppercase w-16">{btnColor}</span>
                  </div>
                </div>

                {/* 글자 크기(배율) 커스터마이저 */}
                <div className="flex items-center justify-between p-4 border border-border rounded-xl bg-panel-alt/50">
                  <div>
                    <div className="text-[13px] font-bold text-ink mb-0.5">글자 크기 (화면 비율)</div>
                    <div className="text-[11px] text-ink3">시스템 전체 글꼴 크기를 4단계로 조절합니다.</div>
                  </div>
                  <div className="flex items-center gap-1 bg-panel border border-border p-1 rounded-lg">
                    {[
                      { label: '작게', value: '1.1875' },
                      { label: '보통', value: '1.48' },
                      { label: '크게', value: '1.6' },
                      { label: '매우크게', value: '1.75' },
                    ].map((item) => (
                      <button
                        key={item.value}
                        onClick={() => handleFontScaleChange(item.value)}
                        className={`px-2.5 py-1 rounded text-[11px] font-bold transition-all ${fontScale === item.value
                          ? 'bg-teal text-white shadow-sm'
                          : 'text-ink2 hover:bg-panel-alt'
                          }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 실시간 미리보기 상자 */}
                <div className="p-5 border border-border rounded-xl bg-panel-alt/30 flex flex-col gap-3">
                  <div className="text-[12px] font-bold text-ink3">미리보기 (Preview)</div>
                  <div className="rounded-lg p-3 flex items-center justify-between shadow-sm" style={{ backgroundColor: headerBg, color: headerTextColor }}>
                    <span className="text-[12px] font-bold">헤더 영역 미리보기</span>
                    <span className="text-[10px] px-2 py-0.5 rounded font-mono" style={{ backgroundColor: pointColor, color: pointTextColor }}>
                      포인트 태그
                    </span>
                  </div>
                  <div className="flex justify-end">
                    <button className="px-4 py-2 rounded-lg text-[12px] font-bold shadow-sm" style={{ backgroundColor: btnColor, color: btnTextColor }}>
                      주요 버튼 미리보기
                    </button>
                  </div>
                </div>

                {/* 하단 저장 / 초기화 버튼 */}
                <div className="flex items-center justify-end gap-2 pt-4 border-t border-border">
                  <button
                    onClick={handleResetTheme}
                    className="px-4 py-2 rounded-lg border border-border text-[12px] font-bold text-ink2 hover:bg-panel-alt transition-all"
                  >
                    초기화
                  </button>
                  <button
                    onClick={handleSaveTheme}
                    className="px-5 py-2 rounded-lg bg-teal text-white text-[12px] font-bold shadow-sm hover:opacity-90 transition-all"
                  >
                    테마 저장
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'notification' && (
            <div className="flex-1 overflow-y-auto p-6 flex flex-col items-center">
              <div className="w-full max-w-xl">
                <h2 className="text-[14px] font-bold text-ink mb-1">알림 환경설정</h2>
                <p className="text-[11.5px] text-ink3 mb-6">시스템 및 커뮤니케이션 알림 수신 상태를 맞춤 설정합니다.</p>
              </div>

              <div className="w-full max-w-xl flex flex-col gap-4">
                {/* 전체 음소거 */}
                <div className="flex items-center justify-between p-4 border border-border rounded-xl bg-panel-alt/50">
                  <div className="flex flex-col">
                    <span className="text-[12.5px] font-bold text-ink">모든 알림 방해금지 (Mute)</span>
                    <span className="text-[10px] text-ink3 mt-0.5">모든 알림의 수신을 일시적으로 음소거합니다.</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={notiMute}
                    onChange={(e) => setNotiMute(e.target.checked)}
                    className="w-4 h-4 accent-teal cursor-pointer"
                  />
                </div>

                {/* 푸시 알림 */}
                <div className="flex items-center justify-between p-4 border border-border rounded-xl bg-panel-alt/50">
                  <div className="flex flex-col">
                    <span className="text-[12.5px] font-bold text-ink">모바일 웹 푸시(FCM) 수신</span>
                    <span className="text-[10px] text-ink3 mt-0.5">모바일 브라우저 PWA 알림을 실시간 수신합니다.</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={notiPush}
                    onChange={(e) => setNotiPush(e.target.checked)}
                    className="w-4 h-4 accent-teal cursor-pointer"
                  />
                </div>

                {/* 메신저 알림 */}
                <div className="flex items-center justify-between p-4 border border-border rounded-xl bg-panel-alt/50">
                  <div className="flex flex-col">
                    <span className="text-[12.5px] font-bold text-ink">메신저 알림 수신</span>
                    <span className="text-[10px] text-ink3 mt-0.5">신규 1:1 및 그룹 대화 메세지 도착 시 알림을 받습니다.</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={notiChat}
                    onChange={(e) => setNotiChat(e.target.checked)}
                    className="w-4 h-4 accent-teal cursor-pointer"
                  />
                </div>

                {/* 전자결재 알림 */}
                <div className="flex items-center justify-between p-4 border border-border rounded-xl bg-panel-alt/50">
                  <div className="flex flex-col">
                    <span className="text-[12.5px] font-bold text-ink">전자결재 알림 수신</span>
                    <span className="text-[10px] text-ink3 mt-0.5">내 결재 차례, 최종 승인/반려 시 알림을 받습니다.</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={notiApproval}
                    onChange={(e) => setNotiApproval(e.target.checked)}
                    className="w-4 h-4 accent-teal cursor-pointer"
                  />
                </div>

                {/* 하단 저장 버튼 */}
                <div className="flex items-center justify-end gap-2 pt-4 border-t border-border">
                  <button
                    onClick={() => alert('알림 수신 설정이 성공적으로 저장되었습니다.')}
                    className="px-5 py-2 rounded-lg bg-teal text-white text-[12px] font-bold shadow-sm hover:opacity-90 transition-all"
                  >
                    알림 설정 저장
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'proxy' && (
            <div className="w-full flex flex-col items-center">
              <div className="w-full">
                <div className="flex items-center justify-between mb-1">
                  <h2 className="text-[14px] font-bold text-ink">부재 설정 및 대결자 지정</h2>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[10.5px] font-extrabold ${absenceConfig.isAbsent
                      ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                      : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                      }`}
                  >
                    {absenceConfig.isAbsent ? '● 부재중 (대결 가동중)' : '○ 정상 재직중'}
                  </span>
                </div>
                <p className="text-[11.5px] text-ink3 mb-6">
                  휴가, 출장 등 부재 시 본인을 대신해 전자결재를 대리 승인할 대결자와 부재 기간을 설정합니다.
                </p>
              </div>

              <div className="w-full flex flex-col gap-5">
                {/* 시스템 대결 기능 비활성화 경고 배너 */}
                {!isProxySystemEnabled && (
                  <div className="flex items-start gap-2.5 rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-xs text-rose-700 dark:text-rose-300 animate-in fade-in">
                    <AlertCircle size={20} className="text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                    <div className="flex flex-col gap-1">
                      <span className="font-extrabold text-[12.5px] text-rose-800 dark:text-rose-200">
                        '대결자 지정' 기능 비활성화 안내
                      </span>
                      <span className="text-[11.5px] leading-relaxed">
                        현재 시스템 상 <strong>'대결자 지정'</strong> 기능을 제공하지 않도록 설정되어 있어, 부재를 등록하더라도 실제 결재 시 대결 기능이 작동하지 않습니다.
                      </span>
                    </div>
                  </div>
                )}

                {/* 추후 개발 예정 자동 부재 연동 안내 배너 */}
                <div className="flex items-start gap-2.5 rounded-xl border border-teal/30 bg-teal/5 p-3.5 text-xs text-ink">
                  <Lightbulb size={18} className="text-teal shrink-0 mt-0.5" />
                  <div className="flex flex-col gap-0.5">
                    <span className="font-bold text-teal">자동 부재 연동 안내 (추후 개발 예정)</span>
                    <span className="text-[11.5px] leading-relaxed text-ink2">
                      휴가신청서, 출장신청서, 외근신청서 등의 결재 문서가 최종 승인 완료되면, 기재된 부재 기간 및 대결자가 본 관리 설정에 자동으로 등록·연동되는 기능이 추후 구현될 예정입니다.
                    </span>
                  </div>
                </div>

                {/* 부재/대결 설정 폼 래퍼 (시스템 OFF 시 비활성화 Grayed Out) */}
                <fieldset disabled={!isProxySystemEnabled} className={`w-full flex flex-col gap-5 ${!isProxySystemEnabled ? 'opacity-50 pointer-events-none select-none' : ''}`}>

                  {/* 부재 상태 활성화 스위치 */}
                  <div className="flex items-center justify-between p-4 border border-border rounded-xl bg-panel-alt/50">
                    <div className="flex flex-col">
                      <span className="text-[13px] font-bold text-ink">부재 상태 활성화 (대결 가동)</span>
                      <span className="text-[11px] text-ink3 mt-0.5">
                        스위치를 켜면 지정된 부재 기간 동안 기안되는 결재 문서가 대결자의 대기함에 동시 전달됩니다.
                      </span>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={absenceConfig.isAbsent}
                      onClick={() =>
                        setAbsenceConfig((prev) => ({ ...prev, isAbsent: !prev.isAbsent }))
                      }
                      className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${absenceConfig.isAbsent ? 'bg-amber-500' : 'bg-gray-300'
                        }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${absenceConfig.isAbsent ? 'translate-x-5' : 'translate-x-0'
                          }`}
                      />
                    </button>
                  </div>

                  {/* 대결자 지정 선택 */}
                  <div className="flex flex-col gap-2 p-4 border border-border rounded-xl bg-panel-alt/50">
                    <label className="text-[13px] font-bold text-ink flex items-center gap-1.5">
                      <span>지정 대결자 (대리 결재자)</span>
                      <span className="text-rose-500 text-xs">*</span>
                    </label>
                    <p className="text-[11px] text-ink3">
                      부재 기간 동안 본인 대신 결재 승인 권한을 위임받을 사용자를 선택하세요.
                    </p>
                    <select
                      value={absenceConfig.delegateUserId ?? ''}
                      onChange={(e) =>
                        setAbsenceConfig((prev) => ({ ...prev, delegateUserId: e.target.value || null }))
                      }
                      className="mt-1 w-full rounded-lg border border-border-hi bg-panel px-3 py-2 text-[12.5px] font-medium text-ink outline-none focus:border-teal"
                    >
                      <option value="">-- 대결자를 선택하세요 --</option>
                      {candidateUsers.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name} ({u.dept} / {u.position} {u.jobTitle ? `· ${u.jobTitle}` : ''})
                        </option>
                      ))}
                    </select>

                    {selectedDelegateUser && (
                      <div className="mt-2 flex items-center gap-3 rounded-lg border border-teal/20 bg-teal/5 p-3 text-xs">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-teal text-white font-bold">
                          {selectedDelegateUser.name.slice(0, 1)}
                        </div>
                        <div className="flex flex-col">
                          <span className="font-bold text-ink">
                            {selectedDelegateUser.name} <span className="text-ink3 text-[11px]">({selectedDelegateUser.dept})</span>
                          </span>
                          <span className="text-[11px] text-ink2">
                            직급: {selectedDelegateUser.position} {selectedDelegateUser.jobTitle ? `| 직책: ${selectedDelegateUser.jobTitle}` : ''} | 이메일: {selectedDelegateUser.email}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 부재 기간 설정 */}
                  <div className="flex flex-col gap-3 p-4 border border-border rounded-xl bg-panel-alt/50">
                    <div className="text-[13px] font-bold text-ink flex items-center gap-1.5">
                      <Calendar size={15} className="text-teal" />
                      <span>부재 기간 및 사유</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex flex-col gap-1">
                        <label className="text-[11px] font-semibold text-ink3">부재 시작일시</label>
                        <input
                          type="datetime-local"
                          value={absenceConfig.startDate ?? ''}
                          onChange={(e) =>
                            setAbsenceConfig((prev) => ({ ...prev, startDate: e.target.value }))
                          }
                          className="rounded-lg border border-border-hi bg-panel px-2.5 py-1.5 text-[12px] text-ink outline-none focus:border-teal"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[11px] font-semibold text-ink3">부재 종료일시</label>
                        <input
                          type="datetime-local"
                          value={absenceConfig.endDate ?? ''}
                          onChange={(e) =>
                            setAbsenceConfig((prev) => ({ ...prev, endDate: e.target.value }))
                          }
                          className="rounded-lg border border-border-hi bg-panel px-2.5 py-1.5 text-[12px] text-ink outline-none focus:border-teal"
                        />
                      </div>
                    </div>

                    <div className="flex flex-col gap-1 mt-1">
                      <label className="text-[11px] font-semibold text-ink3">부재 사유</label>
                      <select
                        value={absenceConfig.reason}
                        onChange={(e) =>
                          setAbsenceConfig((prev) => ({ ...prev, reason: e.target.value }))
                        }
                        className="rounded-lg border border-border-hi bg-panel px-3 py-1.5 text-[12px] font-medium text-ink outline-none focus:border-teal"
                      >
                        <option value="휴가">휴가 (연차/반차/경조 등)</option>
                        <option value="출장">출장 (국내/해외/외근)</option>
                        <option value="병가">병가 및 치료</option>
                        <option value="교육">교육 및 훈련</option>
                      </select>
                    </div>
                  </div>

                  {/* 대결 위임 범위 설정 (1단계 범위 지정 대결) */}
                  <div className="flex flex-col gap-3 p-4 border border-border rounded-xl bg-panel-alt/50">
                    <div className="flex items-center justify-between">
                      <div className="text-[13px] font-bold text-ink flex items-center gap-1.5">
                        <span>대결 위임 범위 (Policy Guard)</span>
                      </div>
                      <span className="rounded bg-teal/15 px-2 py-0.5 text-[10px] font-bold text-teal">
                        1단계 범위 지정 대결
                      </span>
                    </div>
                    <p className="text-[11px] text-ink3 leading-relaxed">
                      대결자에게 위임할 결재 문서의 범위를 선택합니다. 사원·대리급 대결자 지정 시 민감한 재무/보안 문서를 안전하게 보호할 수 있습니다.
                    </p>

                    <div className="flex items-center gap-5 pt-1">
                      <label className="flex items-center gap-2 text-[12px] font-semibold text-ink cursor-pointer">
                        <input
                          type="radio"
                          name="absenceScope"
                          checked={(absenceConfig.scope ?? 'ALL') === 'ALL'}
                          onChange={() => setAbsenceConfig((prev) => ({ ...prev, scope: 'ALL' }))}
                          className="accent-teal cursor-pointer"
                        />
                        <span>전체 문서 대결 (기본)</span>
                      </label>

                      <label className="flex items-center gap-2 text-[12px] font-semibold text-ink cursor-pointer">
                        <input
                          type="radio"
                          name="absenceScope"
                          checked={absenceConfig.scope === 'SPECIFIC_FORMS'}
                          onChange={() => setAbsenceConfig((prev) => ({ ...prev, scope: 'SPECIFIC_FORMS' }))}
                          className="accent-teal cursor-pointer"
                        />
                        <span>특정 서식 문서만 선택 대결</span>
                      </label>
                    </div>

                    {absenceConfig.scope === 'SPECIFIC_FORMS' && (
                      <div className="mt-2 rounded-lg border border-teal/30 bg-panel p-3.5 flex flex-col gap-2.5 animate-in fade-in duration-200">
                        <div className="flex items-center justify-between border-b border-border/60 pb-2">
                          <div className="flex items-center gap-1.5">
                            <FileText size={14} className="text-teal" />
                            <span className="text-[11.5px] font-bold text-ink">대결 위임 허용 서식 선택</span>
                            <span className="rounded-full bg-teal/10 px-2 py-0.5 text-[10.5px] font-bold text-teal ml-1">
                              {absenceConfig.allowedDocTypes?.length ?? 0} / {allAvailableDocTypes.length}개 서식 선택됨
                            </span>
                          </div>

                          {/* 전체 선택 / 전체 해제 버튼 */}
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setAbsenceConfig((prev) => ({ ...prev, allowedDocTypes: [...allAvailableDocTypes] }))}
                              className="inline-flex items-center gap-1 rounded px-2 py-1 text-[10.5px] font-bold text-teal hover:bg-teal/10 transition-colors"
                            >
                              <CheckSquare size={13} />
                              <span>전체 선택</span>
                            </button>
                            <span className="text-ink3 text-[10px]">|</span>
                            <button
                              type="button"
                              onClick={() => setAbsenceConfig((prev) => ({ ...prev, allowedDocTypes: [] }))}
                              className="inline-flex items-center gap-1 rounded px-2 py-1 text-[10.5px] font-bold text-ink3 hover:bg-panel-alt transition-colors"
                            >
                              <Square size={13} />
                              <span>전체 해제</span>
                            </button>
                          </div>
                        </div>

                        {/* 전사 마스터 서식 4열 그리드 (내부 스크롤 없이 확장) */}
                        <div className="grid grid-cols-4 gap-2 pt-1">
                          {allAvailableDocTypes.map((docType) => {
                            const isChecked = (absenceConfig.allowedDocTypes ?? []).includes(docType);
                            return (
                              <label
                                key={docType}
                                className={`flex items-center gap-2 text-[11.5px] p-1.5 rounded-lg border transition-all cursor-pointer ${isChecked
                                  ? 'border-teal/50 bg-teal/5 text-ink font-semibold'
                                  : 'border-border/50 text-ink2 hover:border-border hover:bg-panel-alt/50'
                                  }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={(e) => {
                                    const currentList = absenceConfig.allowedDocTypes ?? [];
                                    const nextList = e.target.checked
                                      ? [...currentList, docType]
                                      : currentList.filter((item) => item !== docType);
                                    setAbsenceConfig((prev) => ({ ...prev, allowedDocTypes: nextList }));
                                  }}
                                  className="accent-teal rounded cursor-pointer"
                                />
                                <span className="truncate">{docType}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 대결 승인 최고 금액 제한 (Amount Cap) */}
                  <div className="flex flex-col gap-3 p-4 border border-border rounded-xl bg-panel-alt/50">
                    <div className="flex items-center justify-between">
                      <div className="text-[13px] font-bold text-ink flex items-center gap-1.5">
                        <span>대결 승인 최고 금액 제한 (Amount Limit)</span>
                      </div>
                      {absenceConfig.maxDelegateAmount && absenceConfig.maxDelegateAmount > 0 ? (
                        <span className="rounded bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-600 dark:text-amber-400">
                          {absenceConfig.maxDelegateAmount.toLocaleString()}원 이하만 대결 가능
                        </span>
                      ) : (
                        <span className="rounded bg-teal/15 px-2 py-0.5 text-[10px] font-bold text-teal">
                          금액 제한 없음 (전액 대결 가능)
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-ink3 leading-relaxed">
                      지출결의서, 품의서 등 금액이 기재되는 문서에 대해 대결자가 승인할 수 있는 최고 금액 한도를 설정합니다. 초과 금액 문서는 대결 승인이 차단됩니다.
                    </p>

                    <div className="flex flex-col gap-2 pt-1">
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          placeholder="예: 1000000 (0 또는 빈값은 제한없음)"
                          value={absenceConfig.maxDelegateAmount ?? ''}
                          onChange={(e) => {
                            const val = e.target.value ? Number(e.target.value) : null;
                            setAbsenceConfig((prev) => ({ ...prev, maxDelegateAmount: val }));
                          }}
                          className="flex-1 rounded-lg border border-border-hi bg-panel px-3 py-1.5 text-[12.5px] font-medium text-ink outline-none focus:border-teal"
                        />
                        <span className="text-[12px] font-bold text-ink2">원 이하</span>
                      </div>

                      {/* 빠른 금액 프리셋 버튼 */}
                      <div className="flex items-center gap-1.5 pt-1">
                        <span className="text-[10.5px] font-semibold text-ink3">빠른 설정:</span>
                        {[
                          { label: '제한 없음', amount: null },
                          { label: '100만원', amount: 1000000 },
                          { label: '300만원', amount: 3000000 },
                          { label: '500만원', amount: 5000000 },
                          { label: '1,000만원', amount: 10000000 },
                        ].map((preset) => (
                          <button
                            key={preset.label}
                            type="button"
                            onClick={() => setAbsenceConfig((prev) => ({ ...prev, maxDelegateAmount: preset.amount }))}
                            className={`rounded px-2.5 py-1 text-[11px] font-bold transition-all border ${absenceConfig.maxDelegateAmount === preset.amount
                              ? 'bg-teal text-white border-teal shadow-xs'
                              : 'bg-panel border-border text-ink2 hover:border-teal/50 hover:text-teal'
                              }`}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* 하단 저장 / 초기화 버튼 */}
                  <div className="flex items-center justify-end gap-2 pt-4 border-t border-border">
                    <button
                      onClick={handleResetAbsence}
                      className="px-4 py-2 rounded-lg border border-border text-[12px] font-bold text-ink2 hover:bg-panel-alt transition-all"
                    >
                      부재 설정 초기화
                    </button>
                    <button
                      onClick={handleSaveAbsence}
                      className="px-5 py-2 rounded-lg bg-teal text-white text-[12px] font-bold shadow-sm hover:opacity-90 transition-all"
                    >
                      부재 설정 저장
                    </button>
                  </div>
                </fieldset>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
