import { useRef, useState } from 'react';
import type { Survey } from '@/domain/survey/schema';
import type { User } from '@/domain/user/schema';
import { missingRequiredQuestions, SurveyError } from '@/domain/survey/engine';
import type { SurveyAnswerInput } from '@/domain/surveyAnswer/schema';
import {
  SURVEY_RATING_MAX,
  SURVEY_RATING_MIN,
  isChoiceQuestion,
  questionTextLimit,
  type SurveyQuestion,
} from '@/domain/surveyQuestion/schema';
import { useSubmitSurveyResponse } from '@/features/survey/useSurveyResponse';
import { Modal } from '@/shared/ui/Modal';
import { AnonymousBadge, DeadlineBadge } from './SurveyBadges';
import { formatSurveyDateTime } from './surveyDate';
import { Button } from '@/shared/ui/Button';

const scores = Array.from(
  { length: SURVEY_RATING_MAX - SURVEY_RATING_MIN + 1 },
  (_, index) => SURVEY_RATING_MIN + index,
);

const blank = (questionId: string): SurveyAnswerInput => ({
  questionId,
  selectedOptionIds: [],
  textValue: null,
  ratingValue: null,
});

const message = (error: unknown) =>
  error instanceof SurveyError ? error.message : (error instanceof Error ? error.message : '제출하지 못했습니다.');

interface Props {
  actor: User;
  actorDeptId: string | null;
  survey: Survey;
  questions: SurveyQuestion[];
  onSubmitted: () => void;
  onBack: () => void;
  variant?: 'desktop' | 'mobile';
  onSubmittingChange?: (pending: boolean) => void;
}

/** 설문 응답 — 필수값 검증 후 확인 모달을 거쳐 제출한다. ([[jwheo/feat/survey/DESIGN.md]] §10.2 · §11.4) */
export default function SurveyResponseForm({ actor, actorDeptId, survey, questions, onSubmitted, onBack, variant = 'desktop', onSubmittingChange }: Props) {
  const mobile = variant === 'mobile';
  const [answers, setAnswers] = useState<Record<string, SurveyAnswerInput>>({});
  const [missing, setMissing] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const submit = useSubmitSurveyResponse();
  const sending = useRef(false);

  const valueOf = (questionId: string) => answers[questionId] ?? blank(questionId);
  const patch = (questionId: string, changes: Partial<SurveyAnswerInput>) => {
    setAnswers((previous) => ({
      ...previous,
      [questionId]: { ...valueOf(questionId), ...changes },
    }));
    setMissing((previous) => previous.filter((id) => id !== questionId));
  };

  const toggleOption = (question: SurveyQuestion, optionId: string) => {
    const current = valueOf(question.id).selectedOptionIds;
    const next = question.type === 'SINGLE_CHOICE'
      ? [optionId]
      : (current.includes(optionId) ? current.filter((id) => id !== optionId) : [...current, optionId]);
    patch(question.id, { selectedOptionIds: next });
  };

  const answered = questions.map((question) => valueOf(question.id));
  const remaining = missingRequiredQuestions(questions, answered);

  const review = () => {
    setError('');
    if (remaining.length > 0) {
      setMissing(remaining.map((question) => question.id));
      document.getElementById(`q-${remaining[0].id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    setConfirming(true);
  };

  const send = async () => {
    if (sending.current) return;
    sending.current = true;
    setConfirming(false);
    setError('');
    onSubmittingChange?.(true);
    try {
      await submit.mutateAsync({
        actor,
        actorDeptId,
        submission: { surveyId: survey.id, surveyVersion: survey.version, answers: answered },
      });
      onSubmitted();
    } catch (caught) {
      setError(message(caught));
    } finally {
      sending.current = false;
      onSubmittingChange?.(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Button onClick={onBack} disabled={mobile && submit.isPending} size="sm">← 참여할 설문</Button>

      <section className="rounded-xl border border-border bg-panel p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-1.5">
          <AnonymousBadge anonymous={survey.anonymous} />
          <DeadlineBadge survey={survey} />
        </div>
        <h2 className="mt-2 text-[15px] font-bold text-ink">{survey.title}</h2>
        {survey.description && <p className="mt-1.5 whitespace-pre-wrap text-[11.5px] leading-relaxed text-ink2">{survey.description}</p>}
        <div className="mt-3 text-[10px] text-ink3">마감 {formatSurveyDateTime(survey.endsAt)} · 질문 {questions.length}개</div>
        <div className={`mt-3 rounded-lg border px-3 py-2 text-[10.5px] ${survey.anonymous ? 'border-teal/20 bg-teal-soft/25 text-teal' : 'border-border bg-ink3/5 text-ink2'}`}>
          {survey.anonymous
            ? '익명 설문입니다. 응답에 이름·부서가 저장되지 않습니다. 다만 주관식에 특정 개인을 알아볼 수 있는 내용을 적으면 익명성이 깨질 수 있으니 주의해 주세요.'
            : `기명 설문입니다. ${actor.name} 계정으로 응답이 기록됩니다.`}
        </div>
      </section>

      {error && <div role="alert" className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2.5 text-[11px] font-semibold text-red-500">{error}</div>}
      {missing.length > 0 && (
        <div className="rounded-lg border border-amber/25 bg-amber-soft/25 px-3 py-2.5 text-[11px] font-semibold text-amber">
          답변하지 않은 필수 질문이 {missing.length}개 있습니다.
        </div>
      )}

      {questions.map((question, index) => {
        const value = valueOf(question.id);
        const flagged = missing.includes(question.id);
        const limit = questionTextLimit(question);
        return (
          <section key={question.id} id={`q-${question.id}`} className={`rounded-xl border bg-panel p-4 shadow-sm ${flagged ? 'border-amber' : 'border-border'}`}>
            <div className="text-[12px] font-bold text-ink">
              <span className="mr-1.5 text-ink3">Q{index + 1}.</span>
              {question.title}
              {question.required && <span className="ml-1 text-red-500">*</span>}
            </div>
            {question.description && <p className="mt-1 text-[10.5px] text-ink3">{question.description}</p>}

            <div className="mt-3 space-y-1.5">
              {isChoiceQuestion(question.type) && question.options.map((option) => (
                <label key={option.id} className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-[11.5px] text-ink2 hover:bg-ink3/5">
                  <input
                    type={question.type === 'SINGLE_CHOICE' ? 'radio' : 'checkbox'}
                    name={`q-${question.id}`}
                    checked={value.selectedOptionIds.includes(option.id)}
                    disabled={mobile && submit.isPending}
                    onChange={() => toggleOption(question, option.id)}
                  />
                  {option.label}
                </label>
              ))}

              {question.type === 'SHORT_TEXT' && (
                <input
                  className="w-full rounded-lg border border-border bg-panel px-3 py-2 text-[11.5px] text-ink outline-none focus:border-teal"
                  maxLength={limit}
                  disabled={mobile && submit.isPending}
                  value={value.textValue ?? ''}
                  onChange={(event) => patch(question.id, { textValue: event.target.value })}
                />
              )}
              {question.type === 'LONG_TEXT' && (
                <>
                  <textarea
                    rows={4}
                    className="w-full rounded-lg border border-border bg-panel px-3 py-2 text-[11.5px] text-ink outline-none focus:border-teal"
                    maxLength={limit}
                    disabled={mobile && submit.isPending}
                    value={value.textValue ?? ''}
                    onChange={(event) => patch(question.id, { textValue: event.target.value })}
                  />
                  <div className="text-right text-[9.5px] text-ink3">{(value.textValue ?? '').length} / {limit}</div>
                </>
              )}

              {question.type === 'RATING' && (
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-[10px] text-ink3">{question.ratingMinLabel}</span>
                  {scores.map((score) => (
                    <label key={score} className="flex cursor-pointer flex-col items-center gap-0.5 text-[10px] font-semibold text-ink2">
                      <input
                        type="radio"
                        name={`q-${question.id}`}
                        checked={value.ratingValue === score}
                        disabled={mobile && submit.isPending}
                        onChange={() => patch(question.id, { ratingValue: score })}
                      />
                      {score}
                    </label>
                  ))}
                  <span className="text-[10px] text-ink3">{question.ratingMaxLabel}</span>
                </div>
              )}
            </div>
          </section>
        );
      })}

      <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-panel px-4 py-3 shadow-sm">
        <span className="text-[10.5px] text-ink3">
          {remaining.length > 0 ? `필수 질문 ${remaining.length}개가 남았습니다.` : '모든 필수 질문에 답했습니다.'}
        </span>
        <Button disabled={submit.isPending} onClick={review} variant="primary">
          {submit.isPending ? '제출 중…' : '제출'}
        </Button>
      </div>

      {mobile ? confirming && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-3">
          <section role="dialog" aria-modal="true" aria-labelledby="mobile-survey-confirm-title" className="w-full max-w-[420px] max-h-[85dvh] overflow-y-auto rounded-2xl border border-border bg-panel p-4 shadow-xl">
            <h2 id="mobile-survey-confirm-title" className="text-[15px] font-bold text-ink">설문을 제출할까요?</h2>
            <p className="mt-3 text-[13px] leading-relaxed text-ink2">
              제출하면 응답을 수정하거나 취소할 수 없고, 한 번만 참여할 수 있습니다.
              {survey.anonymous && ' 익명 설문이므로 제출 후에는 본인의 응답을 다시 찾을 수 없습니다.'}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button onClick={() => setConfirming(false)}>취소</Button>
              <Button disabled={submit.isPending} onClick={send} variant="primary">제출</Button>
            </div>
          </section>
        </div>
      ) : <Modal open={confirming} onClose={() => setConfirming(false)} title="설문을 제출할까요?" width={420}
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={() => setConfirming(false)}>취소</Button>
            <Button onClick={send} variant="primary">제출</Button>
          </div>
        }>
        <p className="text-[11.5px] leading-relaxed text-ink2">
          제출하면 응답을 수정하거나 취소할 수 없고, 한 번만 참여할 수 있습니다.
          {survey.anonymous && ' 익명 설문이므로 제출 후에는 본인의 응답을 다시 찾을 수 없습니다.'}
        </p>
      </Modal>}
    </div>
  );
}
