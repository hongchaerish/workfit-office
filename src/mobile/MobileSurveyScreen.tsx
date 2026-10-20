import { useState, useMemo } from 'react';
import {
  BarChart3,
  X,
  HelpCircle,
} from 'lucide-react';
import { useAuth } from '@/app/auth/AuthProvider';
import { useRespondentSurveys, useMyParticipations } from '@/features/survey/useSurveyResponse';
import { useDepartments } from '@/features/department/useDepartments';
import { resolveUserDeptId } from '@/features/survey/useSurveyResponse';
import { useMySurveys, useSurveyQuestions } from '@/features/survey/useSurveys';
import { usePermission } from '@/features/auth/usePermission';
import type { Survey } from '@/domain/survey/schema';
import { ErrorNotice } from '@/shared/ui/ErrorNotice';
import { assertRespondable } from '@/domain/survey/engine';
import SurveyResponseForm from '@/modules/gw/survey/SurveyResponseForm';
import MobileCommonHeader from './MobileCommonHeader';

export default function MobileSurveyScreen() {
  const { user } = useAuth();
  const { canAction } = usePermission();
  const canManageSurvey = canAction('S_GW_SURVEY', 'create');

  const [activeTab, setActiveTab] = useState<'pending' | 'completed' | 'mine'>('pending');
  const [selectedSurvey, setSelectedSurvey] = useState<Survey | null>(null);
  const [responding, setResponding] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState('');

  const departmentsQuery = useDepartments();
  const departments = departmentsQuery.data ?? [];
  const deptId = useMemo(() => resolveUserDeptId(departments, user), [departments, user]);

  const respondentQuery = useRespondentSurveys(user, deptId);
  const surveys = respondentQuery.data ?? [];

  const participationQuery = useMyParticipations(user);
  const participations = participationQuery.data ?? [];
  const completedIds = useMemo(() => new Set(participations), [participations]);

  const mySurveysQuery = useMySurveys(user);
  const mySurveys = mySurveysQuery.data ?? [];
  const questionsQuery = useSurveyQuestions(responding ? selectedSurvey?.id ?? null : null);

  // 불러오기 실패를 빈 목록으로 보이면 "설문이 없다"·"아직 안 했다"로 오인한다.
  const queryError = departmentsQuery.error ?? respondentQuery.error ?? participationQuery.error
    ?? (activeTab === 'mine' ? mySurveysQuery.error : null);
  const loading = departmentsQuery.isLoading || respondentQuery.isLoading || participationQuery.isLoading
    || (activeTab === 'mine' && mySurveysQuery.isLoading);
  let unavailableReason = '';
  if (selectedSurvey && user) {
    try {
      assertRespondable(selectedSurvey, user, deptId, completedIds.has(selectedSurvey.id));
    } catch (caught) {
      unavailableReason = caught instanceof Error ? caught.message : '지금은 참여할 수 없는 설문입니다.';
    }
  }
  const canRespond = Boolean(user && selectedSurvey && !loading && !queryError && !unavailableReason);
  const closeDetail = () => {
    if (submitting) return;
    setResponding(false);
    setSelectedSurvey(null);
  };
  const retryLists = () => {
    void departmentsQuery.refetch();
    void respondentQuery.refetch();
    void participationQuery.refetch();
    if (activeTab === 'mine') void mySurveysQuery.refetch();
  };

  const pendingSurveys = useMemo(() => {
    return surveys.filter((s) => !completedIds.has(s.id) && s.status === 'ACTIVE');
  }, [surveys, completedIds]);

  const completedSurveys = useMemo(() => {
    return surveys.filter((s) => completedIds.has(s.id) || s.status === 'CLOSED');
  }, [surveys, completedIds]);

  const list = activeTab === 'pending'
    ? pendingSurveys
    : activeTab === 'completed'
    ? completedSurveys
    : mySurveys;

  return (
    <div className="flex h-full flex-col select-none overflow-hidden" style={{ background: '#f2f8fc' }}>
      <MobileCommonHeader
        title="전자설문"
        subtitle={
          activeTab === 'mine'
            ? `내가 개설한 설문 ${mySurveys.length}건`
            : `참여 대기 ${pendingSurveys.length}건`
        }
      />

      {/* 1. 상단 탭: canManageSurvey에 따라 2열 또는 3열 그리드 */}
      <div
        className={`grid ${canManageSurvey ? 'grid-cols-3' : 'grid-cols-2'} gap-1.5 bg-white/70 px-3 py-2 border-b border-border/50 shrink-0`}
      >
        <button
          type="button"
          onClick={() => setActiveTab('pending')}
          className={`flex items-center justify-center gap-1 rounded-xl py-1.5 text-[11px] font-bold transition-all ${
            activeTab === 'pending'
              ? 'bg-teal text-white shadow-xs'
              : 'bg-white text-ink3 hover:bg-panel-alt border border-border/70'
          }`}
        >
          <span>참여할 설문</span>
          {pendingSurveys.length > 0 && (
            <span className="rounded-full bg-rose-500 px-1.5 py-0.2 text-[9px] font-bold text-white">
              {pendingSurveys.length}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('completed')}
          className={`flex items-center justify-center gap-1 rounded-xl py-1.5 text-[11px] font-bold transition-all ${
            activeTab === 'completed'
              ? 'bg-teal text-white shadow-xs'
              : 'bg-white text-ink3 hover:bg-panel-alt border border-border/70'
          }`}
        >
          <span>완료 ({completedSurveys.length})</span>
        </button>

        {canManageSurvey && (
          <button
            type="button"
            onClick={() => setActiveTab('mine')}
            className={`flex items-center justify-center gap-1 rounded-xl py-1.5 text-[11px] font-bold transition-all ${
              activeTab === 'mine'
                ? 'bg-teal text-white shadow-xs'
                : 'bg-white text-teal hover:bg-teal-soft/10 border border-teal/40'
            }`}
          >
            <span>개설 설문 ({mySurveys.length})</span>
          </button>
        )}
      </div>

      {/* 2. 설문 목록 */}
      <div className="flex-1 overflow-y-auto px-3.5 py-3 space-y-2.5">
        {notice && <p role="status" className="rounded-xl border border-teal/20 bg-teal-soft/20 p-3 text-[12px] font-semibold text-teal">{notice}</p>}
        {queryError ? (
          <div role="alert" className="space-y-2">
            <ErrorNotice message={queryError instanceof Error ? queryError.message : '설문 정보를 불러오지 못했습니다.'} />
            <button type="button" onClick={retryLists} className="text-[12px] font-bold text-ink2 underline">다시 불러오기</button>
          </div>
        ) : loading ? (
          <div className="py-16 text-center text-[12px] font-semibold text-ink3">설문을 불러오는 중…</div>
        ) : list.length === 0 ? (
          <div className="py-16 text-center text-ink3 border border-dashed border-border/80 rounded-2xl bg-white/60">
            <BarChart3 size={28} className="mx-auto mb-1.5 text-ink3/40" />
            <p className="text-[12px] font-bold text-ink">
              {activeTab === 'pending'
                ? '현재 참여할 설문이 없습니다.'
                : activeTab === 'completed'
                ? '완료된 설문 내역이 없습니다.'
                : '내가 개설한 설문이 없습니다.'}
            </p>
            <p className="text-[10.5px] text-ink3 mt-0.5">
              {activeTab === 'mine'
                ? '새 설문 개설은 PC 데스크톱 화면에서 문항을 구성하여 생성할 수 있습니다.'
                : '신규 설문이 등록되면 알림을 보내드립니다.'}
            </p>
          </div>
        ) : (
          list.map((survey) => {
            const isDone = completedIds.has(survey.id);
            const endDateStr = survey.endsAt ? survey.endsAt.slice(0, 10) : '상시';

            const statusBadge = activeTab === 'mine' ? (
              survey.status === 'ACTIVE' ? (
                <span className="rounded bg-teal/15 text-teal px-1.5 py-0.2 text-[10px] font-bold">
                  진행 중
                </span>
              ) : survey.status === 'CLOSED' ? (
                <span className="rounded bg-panel-alt text-ink3 px-1.5 py-0.2 text-[10px] font-bold">
                  설문 마감
                </span>
              ) : (
                <span className="rounded bg-amber-500/15 text-amber-600 px-1.5 py-0.2 text-[10px] font-bold">
                  작성 중 (임시저장)
                </span>
              )
            ) : (
              <span
                className={`rounded px-1.5 py-0.2 text-[10px] font-bold ${
                  isDone ? 'bg-panel-alt text-ink3' : 'bg-rose-500/15 text-rose-600'
                }`}
              >
                {isDone ? '참여 완료' : survey.status === 'CLOSED' ? '설문 마감' : '참여 대기'}
              </span>
            );

            return (
              <div
                key={survey.id}
                onClick={() => { setResponding(false); setSelectedSurvey(survey); setNotice(''); }}
                className="rounded-2xl border border-border/80 bg-white p-3.5 shadow-2xs hover:border-teal/50 transition-all cursor-pointer active:scale-98 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    {statusBadge}
                    {survey.anonymous && (
                      <span className="rounded bg-blue-500/10 px-1.5 py-0.2 text-[10px] font-bold text-blue-600">
                        익명 설문
                      </span>
                    )}
                  </div>

                  <span className="text-[10.5px] text-ink3 font-mono">
                    ~ {endDateStr}
                  </span>
                </div>

                <h3 className="text-[13.5px] font-bold text-ink leading-snug">
                  {survey.title}
                </h3>

                {survey.description && (
                  <p className="text-[11px] text-ink3 line-clamp-2 leading-relaxed">
                    {survey.description}
                  </p>
                )}

                <div className="flex items-center justify-between text-[11px] text-ink3 pt-1 border-t border-border/50">
                  <span className="flex items-center gap-1">
                    <HelpCircle size={12} className="text-teal" />
                    <span>문항 {survey.questionCount}개</span>
                  </span>
                  <span>분류: {survey.categoryCode}</span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 3. 설문 상세 팝업 */}
      {selectedSurvey && (
        <div className="fixed inset-0 z-50 flex flex-col bg-white animate-in fade-in slide-in-from-bottom duration-200">
          <header className="flex items-center justify-between border-b border-border px-3 py-3 shrink-0 bg-[#101830] text-white">
            <span className="text-[13px] font-bold truncate">{responding ? '설문 응답' : '설문 상세'}</span>
            <button
              type="button"
              aria-label="설문 닫기"
              disabled={submitting}
              onClick={closeDetail}
              className="grid h-8 w-8 place-items-center rounded-lg hover:bg-white/10 text-white"
            >
              <X size={18} />
            </button>
          </header>

          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3.5" style={{ background: '#f2f8fc' }}>
            {responding && user ? (
              questionsQuery.isLoading ? <p className="py-12 text-center text-[12px] text-ink3">설문 문항을 불러오는 중…</p> : questionsQuery.isError || !questionsQuery.data?.length ? (
                <div role="alert" className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-[12px] text-rose-600">
                  <p>설문 문항을 불러오지 못했습니다. {questionsQuery.error instanceof Error ? questionsQuery.error.message : ''}</p>
                  <button type="button" onClick={() => void questionsQuery.refetch()} className="mt-2 font-bold underline">문항 다시 불러오기</button>
                </div>
              ) : <SurveyResponseForm
                key={`${selectedSurvey.id}:${user.id}`}
                actor={user}
                actorDeptId={deptId}
                survey={selectedSurvey}
                questions={questionsQuery.data}
                variant="mobile"
                onSubmittingChange={setSubmitting}
                onBack={closeDetail}
                onSubmitted={() => {
                  setResponding(false);
                  setSelectedSurvey(null);
                  setActiveTab('completed');
                  setNotice('설문 응답을 제출했습니다.');
                }}
              />
            ) : <div className="rounded-2xl border border-border/80 bg-white p-4 shadow-xs space-y-3">
              <div className="space-y-1 border-b border-border/60 pb-3">
                <div className="flex items-center gap-1.5">
                  <span className="rounded bg-teal/15 px-1.5 py-0.2 text-[10px] font-bold text-teal">
                    {selectedSurvey.anonymous ? '익명 설문' : '기명 설문'}
                  </span>
                  <span className="rounded bg-panel-alt px-1.5 py-0.2 text-[10px] font-bold text-ink2">
                    {selectedSurvey.categoryCode}
                  </span>
                </div>
                <h2 className="text-[16px] font-black text-ink">{selectedSurvey.title}</h2>
                <p className="text-[11px] text-ink3">
                  기간: {selectedSurvey.startsAt ? selectedSurvey.startsAt.slice(0, 10) : '시작일 미정'} ~ {selectedSurvey.endsAt ? selectedSurvey.endsAt.slice(0, 10) : '마감일 미정'}
                </p>
              </div>

              {selectedSurvey.description && (
                <div className="rounded-xl bg-panel-alt/50 p-3 text-[12px] text-ink2 leading-relaxed">
                  {selectedSurvey.description}
                </div>
              )}

              <div className="rounded-xl border border-border bg-teal-soft/10 p-4 text-center space-y-1.5">
                <span className="text-[24px]">📋</span>
                <h4 className="text-[13px] font-bold text-ink">총 {selectedSurvey.questionCount}개 문항</h4>
                <p className="text-[11px] text-ink3 leading-relaxed">
                  {loading ? '참여 여부를 확인하는 중입니다.' : queryError ? '참여 정보를 불러오지 못했습니다. 다시 불러온 뒤 참여해 주세요.' : unavailableReason || '참여하기를 눌러 문항에 답하고 제출해 주세요.'}
                  {' 결과 조회와 설문 관리는 PC에서 이용할 수 있습니다.'}
                </p>
              </div>

              <div className="space-y-2 pt-3">
                {canRespond && <button type="button" onClick={() => setResponding(true)} className="w-full rounded-xl bg-teal py-2.5 text-[12px] font-bold text-white shadow-xs hover:opacity-90">참여하기</button>}
                <button
                  type="button"
                  onClick={closeDetail}
                  className="w-full rounded-xl bg-teal py-2.5 text-[12px] font-bold text-white shadow-xs hover:opacity-90"
                >
                  확인 완료
                </button>
              </div>
            </div>}
          </div>
        </div>
      )}
    </div>
  );
}
