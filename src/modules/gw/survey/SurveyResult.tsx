import { useState } from 'react';
import type { User } from '@/domain/user/schema';
import type { SurveyQuestionResult } from '@/domain/survey/aggregate';
import { canManageSurvey, SurveyError } from '@/domain/survey/engine';
import type { Survey } from '@/domain/survey/schema';
import type { SurveyQuestion } from '@/domain/surveyQuestion/schema';
import { useCloseSurvey } from '@/features/survey/useSurveys';
import { useSurveyResult } from '@/features/survey/useSurveyResponse';
import { audienceLabel, AnonymousBadge, QuestionTypeBadge, SurveyStatusBadge } from './SurveyBadges';
import { formatSurveyDate, formatSurveyDateTime, formatSurveyPeriod } from './surveyDate';
import { Button } from '@/shared/ui/Button';

const percent = (ratio: number) => `${(ratio * 100).toFixed(1)}%`;

function Summary({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-panel p-4 shadow-sm">
      <div className="text-[10px] font-semibold text-ink3">{label}</div>
      <div className="mt-1 text-[20px] font-extrabold leading-none text-ink">{value}</div>
      {hint && <div className="mt-1.5 text-[9.5px] text-ink3">{hint}</div>}
    </div>
  );
}

/** 비율 막대. 값이 0이어도 항목은 남겨 아무도 고르지 않은 선택지를 드러낸다. */
function Bar({ label, count, ratio, tone }: { label: string; count: number; ratio: number; tone: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-[11px]">
        <span className="min-w-0 flex-1 truncate text-ink2">{label}</span>
        <span className="shrink-0 font-bold text-ink">{count}명</span>
        <span className="w-12 shrink-0 text-right text-[10px] font-semibold text-ink3">{percent(ratio)}</span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-ink3/10">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.min(ratio, 1) * 100}%` }} />
      </div>
    </div>
  );
}

/**
 * 문항 카드. 응답자 이름은 서버가 기명 설문의 작성자·관리자에게만 채워 준다(`respondents`).
 * 익명 설문은 응답 ID가 비어 오고 제출 시각도 날짜뿐이라 날짜만 보여 준다.
 */
function QuestionCard({ index, result, respondents, anonymous }: {
  index: number;
  result: SurveyQuestionResult;
  respondents: Record<string, string>;
  anonymous: boolean;
}) {

  return (
    <section className="rounded-xl border border-border bg-panel p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-1.5">
        <QuestionTypeBadge type={result.question.type} />
        {result.question.required && <span className="rounded bg-red-500/10 px-1.5 py-px text-[9.5px] font-bold text-red-500">필수</span>}
        <span className="text-[9.5px] font-semibold text-ink3">응답 {result.answeredCount}건</span>
      </div>
      <div className="mt-1.5 text-[12.5px] font-bold text-ink">
        <span className="mr-1.5 text-ink3">Q{index + 1}.</span>
        {result.question.title}
      </div>
      {result.question.description && (
        <p className="mt-1 text-[10.5px] text-ink3">{result.question.description}</p>
      )}

      {result.answeredCount === 0 ? (
        <div className="mt-3 rounded-lg border border-dashed border-border px-3 py-5 text-center text-[10.5px] text-ink3">
          아직 이 질문에 답한 응답이 없습니다.
        </div>
      ) : (
        <div className="mt-3">
          {result.kind === 'CHOICE' && (
            <div className="space-y-2.5">
              {result.buckets.map((bucket) => (
                <Bar key={bucket.optionId} label={bucket.label} count={bucket.count} ratio={bucket.ratio} tone="bg-teal" />
              ))}
              {result.question.type === 'MULTIPLE_CHOICE' && (
                <div className="text-[9.5px] text-ink3">복수 선택 질문이라 비율의 합이 100%를 넘을 수 있습니다.</div>
              )}
            </div>
          )}

          {result.kind === 'RATING' && (
            <div>
              <div className="flex items-baseline gap-2">
                <span className="text-[22px] font-extrabold leading-none text-teal">{result.average.toFixed(2)}</span>
                <span className="text-[10px] text-ink3">
                  평균 · {result.question.ratingMinLabel} ~ {result.question.ratingMaxLabel}
                </span>
              </div>
              <div className="mt-3 space-y-2.5">
                {result.buckets.map((bucket) => (
                  <Bar key={bucket.score} label={`${bucket.score}점`} count={bucket.count} ratio={bucket.ratio} tone="bg-blue" />
                ))}
              </div>
            </div>
          )}

          {result.kind === 'TEXT' && (
            <ul className="space-y-2">
              {result.entries.map((entry, i) => (
                <li key={`${entry.responseId}-${i}`} className="rounded-lg border border-border bg-ink3/4 px-3 py-2.5">
                  <p className="whitespace-pre-wrap text-[11.5px] leading-relaxed text-ink">{entry.value}</p>
                  <div className="mt-1.5 flex flex-wrap gap-x-2 text-[9.5px] text-ink3">
                    <span>{respondents[entry.responseId] ?? '익명'}</span>
                    <span>{anonymous ? formatSurveyDate(entry.submittedAt) : formatSurveyDateTime(entry.submittedAt)}</span>
                  </div>
                </li>
              ))}
              {result.entries.length === 0 && (
                <li className="rounded-lg border border-dashed border-border px-3 py-5 text-center text-[10.5px] text-ink3">
                  내용이 있는 주관식 답변이 없습니다.
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

interface Props {
  actor: User;
  survey: Survey;
  questions: SurveyQuestion[];
  onBack: () => void;
  onNotice: (text: string) => void;
}

/**
 * 설문 결과 — 참여율과 문항별 통계. ([[jwheo/feat/survey/DESIGN.md]] §11.5 · §14)
 *
 * 대상자 수는 저장된 값이 아니라 현재 재직자 명단으로 매번 센다. 대상 부서·사용자가
 * 바뀌거나 퇴사자가 생기면 분모도 함께 움직이는 편이 참여율을 덜 왜곡한다.
 *
 * 익명 설문에는 사용자·부서 필터를 두지 않는다. 필터 조건을 좁히면 응답을 역추적할 수 있다.
 */
export default function SurveyResult({ actor, survey, questions, onBack, onNotice }: Props) {
  const [error, setError] = useState('');
  const resultQuery = useSurveyResult(actor, survey.id);
  const close = useCloseSurvey();

  const manageable = canManageSurvey(actor, survey);
  const closable = manageable && (survey.status === 'ACTIVE' || survey.status === 'SCHEDULED');

  // 대상자 수·집계는 서버가 현재 재직자 명단으로 계산해 준다.
  const summary = resultQuery.data?.summary ?? null;
  const respondents = resultQuery.data?.respondents ?? {};
  const audienceCount = summary?.audienceCount ?? 0;

  const closeSurvey = async () => {
    setError('');
    try {
      await close.mutateAsync({ actor, id: survey.id });
      onNotice('설문을 마감했습니다. 더 이상 응답을 받지 않습니다.');
    } catch (caught) {
      setError(caught instanceof SurveyError ? caught.message : '설문을 마감하지 못했습니다.');
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button onClick={onBack} size="sm">← 목록</Button>
        {closable && (
          <Button disabled={close.isPending} onClick={closeSurvey} variant="warning" size="sm">
            지금 마감
          </Button>
        )}
      </div>

      <section className="rounded-xl border border-border bg-panel p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-1.5">
          <SurveyStatusBadge status={survey.status} />
          <AnonymousBadge anonymous={survey.anonymous} />
        </div>
        <h2 className="mt-2 text-[15px] font-bold text-ink">{survey.title}</h2>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-ink3">
          <span>{audienceLabel(survey)}</span>
          <span>{formatSurveyPeriod(survey.startsAt, survey.endsAt)}</span>
          <span>질문 {questions.length}개</span>
          {survey.closedAt && <span>마감 {formatSurveyDateTime(survey.closedAt)}</span>}
        </div>
      </section>

      {error && <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2.5 text-[11px] font-semibold text-red-500">{error}</div>}

      {resultQuery.isLoading && (
        <div className="rounded-xl border border-border bg-panel px-6 py-10 text-center text-[11px] text-ink3">결과를 집계하는 중…</div>
      )}

      {resultQuery.error && (
        <div className="rounded-xl border border-amber/25 bg-amber-soft/25 px-6 py-10 text-center">
          <div className="text-[12px] font-bold text-amber">
            {resultQuery.error instanceof SurveyError ? resultQuery.error.message : '결과를 불러오지 못했습니다.'}
          </div>
          <div className="mt-1 text-[10px] text-ink3">설문 작성자와 관리자, 그리고 결과 공개가 켜진 설문의 참여자만 결과를 볼 수 있습니다.</div>
        </div>
      )}

      {summary && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Summary label="대상자" value={`${audienceCount}명`} hint="현재 재직 중인 대상자 기준" />
            <Summary label="응답" value={`${summary.responseCount}건`} />
            <Summary
              label="참여율"
              value={audienceCount > 0 ? percent(summary.participationRate) : '—'}
              hint={audienceCount > 0 ? undefined : '대상자를 셀 수 없습니다.'}
            />
          </div>

          {survey.anonymous && (
            <div className="rounded-lg border border-teal/20 bg-teal-soft/25 px-3 py-2 text-[10.5px] text-teal">
              익명 설문입니다. 응답에 사용자·부서가 저장되지 않아 응답자별 조회와 필터를 제공하지 않습니다.
            </div>
          )}

          {summary.responseCount === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-panel px-6 py-12 text-center">
              <div className="text-2xl">📊</div>
              <div className="mt-2 text-[12px] font-bold text-ink">아직 응답이 없습니다.</div>
              <div className="mt-1 text-[10.5px] text-ink3">
                {survey.status === 'SCHEDULED' ? '응답 기간이 시작되면 결과가 쌓입니다.' : '대상자가 응답하면 여기에 집계됩니다.'}
              </div>
            </div>
          ) : (
            summary.questions.map((result, index) => (
              <QuestionCard
                key={result.question.id}
                index={index}
                result={result}
                respondents={respondents}
                anonymous={survey.anonymous}
              />
            ))
          )}
        </>
      )}
    </div>
  );
}
