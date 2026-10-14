import { aggregateSurveyResult, type SurveyResultView } from '@/domain/survey/aggregate';
import { kstDayStamp, shuffle } from '@/domain/survey/anonymity';
import {
  assertRespondable,
  assertSurveyVersion,
  canManageSurvey,
  canViewResultAsRespondent,
  countSurveyAudience,
  isSurveyAudience,
  SurveyError,
  validateSurveyAnswers,
} from '@/domain/survey/engine';
import type { Survey } from '@/domain/survey/schema';
import { surveyAnswerSchema, type SurveyAnswerInput } from '@/domain/surveyAnswer/schema';
import { surveyParticipationId, surveyParticipationSchema } from '@/domain/surveyParticipation/schema';
import { assertAnonymousResponse, surveyResponseSchema } from '@/domain/surveyResponse/schema';
import { resolveDeptId } from '@/domain/department/engine';
import { requireSurvey } from './manage';
import type { ServiceCtx } from './port';

/**
 * 응답 제출·참여 현황·결과.
 *
 * 익명 설문에서 응답자를 알아낼 수 있는 값을 남기지 않는다 — 참여 기록에는 시각이 없고,
 * 응답은 무작위 ID에 날짜만 갖는다. 제출은 설문 문서도 고치지 않는다(갱신 시각이 드러나므로). 결과도 서버가 집계해 응답 ID·순서를 지운 채 보낸다.
 * ([[docs/superpowers/specs/2026-10-14-survey-server-design.md]] §6 · §7)
 */

/** 제출 쓰기를 시작하려면 요청 마감까지 이만큼은 남아 있어야 한다(쓰기·되돌리기 시간). */
const SUBMIT_MIN_REMAINING_MS = 8000;

export interface SurveySubmission {
  surveyId: string;
  surveyVersion: number;
  answers: SurveyAnswerInput[];
}

export async function submit(ctx: ServiceCtx, submission: SurveySubmission): Promise<{ submitted: true }> {
  const { user, deptId } = ctx.actor;
  const survey = await requireSurvey(ctx, submission.surveyId);
  const already = await ctx.store.hasParticipation(survey.id, user.id);
  assertRespondable(survey, user, deptId, already, ctx.now());
  assertSurveyVersion(survey, submission.surveyVersion);
  const answers = validateSurveyAnswers(await ctx.store.listQuestions(survey.id), submission.answers);

  const now = ctx.now();
  const stamp = survey.anonymous ? kstDayStamp(now) : now.toISOString();

  if (ctx.remainingMs && ctx.remainingMs() < SUBMIT_MIN_REMAINING_MS) {
    throw new SurveyError('TRY_AGAIN', '서버 응답이 늦어 제출하지 못했습니다. 잠시 후 다시 제출하세요.');
  }

  const participation = surveyParticipationSchema.parse({
    id: surveyParticipationId(survey.id, user.id),
    surveyId: survey.id,
    userId: user.id,
    responded: true,
  });
  const response = surveyResponseSchema.parse({
    id: ctx.newId(),
    surveyId: survey.id,
    respondentUserId: survey.anonymous ? null : user.id,
    respondentDeptId: survey.anonymous ? null : deptId,
    surveyVersion: survey.version,
    submittedAt: stamp,
  });
  if (survey.anonymous) assertAnonymousResponse(response);
  const rows = answers.map((answer) => surveyAnswerSchema.parse({
    id: ctx.newId(),
    surveyId: survey.id,
    responseId: response.id,
    questionId: answer.questionId,
    selectedOptionIds: answer.selectedOptionIds,
    textValue: answer.textValue,
    ratingValue: answer.ratingValue,
    createdAt: stamp,
  }));

  /**
   * 실패 시 되돌리기. 시간 초과로 실패한 쓰기는 실제로는 저장됐을 수 있으므로, 성공 여부와
   * 상관없이 시도한 문서를 모두 지운다(없으면 404 를 무시한다). 참여 기록은 지운 뒤 다시
   * 확인해, 늦게 도착한 생성이 남아 있으면 한 번 더 지운다.
   */
  const rollback = async (answerIds: string[]) => {
    await Promise.all(answerIds.map((id) => ctx.store.remove('surveyAnswers', id).catch(() => undefined)));
    await ctx.store.remove('surveyParticipations', participation.id).catch(() => undefined);
    if (await ctx.store.exists('surveyParticipations', participation.id).catch(() => false)) {
      await ctx.store.remove('surveyParticipations', participation.id).catch(() => undefined);
    }
  };

  // 1) 참여 기록을 새로 만드는 데 성공한 요청만 진행한다 — 동시 제출 중 하나만 통과한다.
  let claimed: 'created' | 'exists';
  try {
    claimed = await ctx.store.insert('surveyParticipations', participation);
  } catch (error) {
    await rollback([]);
    throw error;
  }
  if (claimed === 'exists') throw new SurveyError('ALREADY_RESPONDED', '이미 참여한 설문입니다.');

  // 2) 답변. 응답 문서가 없는 답변은 결과에 세지 않으므로, 여기서 끊겨도 결과가 틀리지 않는다.
  const settled = await Promise.allSettled(rows.map((row) => ctx.store.insert('surveyAnswers', row)));
  const failed = settled.find((item): item is PromiseRejectedResult => item.status === 'rejected');
  if (failed) {
    await rollback(rows.map((row) => row.id));
    throw failed.reason;
  }

  // 3) 응답을 마지막에 쓴다 — 이 문서가 생겨야 제출이 완료된 것이다.
  //    결과를 모르는 실패면 실제로 저장됐는지 확인해, 저장됐으면 성공으로 본다.
  try {
    await ctx.store.insert('surveyResponses', response);
  } catch (error) {
    if (await ctx.store.exists('surveyResponses', response.id).catch(() => false)) return { submitted: true };
    await ctx.store.remove('surveyResponses', response.id).catch(() => undefined);
    await rollback(rows.map((row) => row.id));
    throw error;
  }
  return { submitted: true };
}

/** 내가 참여한 설문 ID. 응답 내용은 담지 않는다. */
export const myParticipations = (ctx: ServiceCtx, _: Record<string, never>) =>
  ctx.store.listParticipatedSurveyIds(ctx.actor.user.id);

/** 참여할 설문 — 대상인 진행 중 설문과 이미 참여한 설문. */
export async function listForRespondent(ctx: ServiceCtx, _: Record<string, never>): Promise<Survey[]> {
  const participated = new Set(await ctx.store.listParticipatedSurveyIds(ctx.actor.user.id));
  const rows = await Promise.all((await ctx.store.listSurveys()).map((row) => requireSurvey(ctx, row.id)));
  return rows
    .filter((row) => row.status !== 'DRAFT' && isSurveyAudience(row, ctx.actor.user, ctx.actor.deptId))
    .filter((row) => row.status === 'ACTIVE' || participated.has(row.id))
    .sort((x, y) => (x.endsAt ?? '').localeCompare(y.endsAt ?? ''));
}

/** 결과 — 작성자·관리자, 그리고 결과 공개 설문의 참여자만. */
export async function readResult(ctx: ServiceCtx, { surveyId }: { surveyId: string }): Promise<SurveyResultView> {
  const survey = await requireSurvey(ctx, surveyId);
  const manager = canManageSurvey(ctx.actor.user, survey, ctx.actor.isAdmin);
  const participated = await ctx.store.hasParticipation(surveyId, ctx.actor.user.id);
  if (!manager && !canViewResultAsRespondent(survey, participated)) {
    throw new SurveyError('FORBIDDEN', '이 설문의 결과를 볼 권한이 없습니다.');
  }

  const [questions, responses, answers, users, departments] = await Promise.all([
    ctx.store.listQuestions(surveyId),
    ctx.store.listResponses(surveyId),
    ctx.store.listAnswers(surveyId),
    ctx.directory.listUsers(),
    ctx.directory.listDepartments(),
  ]);
  const audienceCount = countSurveyAudience(survey, users, (u) => resolveDeptId(departments, u.dept));
  const summary = aggregateSurveyResult(questions, responses, answers, audienceCount);

  if (survey.anonymous) {
    // 응답 ID·순서를 지워 주관식 답변끼리, 그리고 다른 질문의 답과 잇지 못하게 한다.
    summary.questions = summary.questions.map((question) => (question.kind !== 'TEXT' ? question : {
      ...question,
      entries: shuffle(question.entries.map((entry) => ({ ...entry, responseId: '' })), ctx.random),
    }));
    return { summary, respondents: {} };
  }
  if (!manager) return { summary, respondents: {} };

  const respondents: Record<string, string> = {};
  for (const response of responses) {
    const name = users.find((u) => u.id === response.respondentUserId)?.name ?? '알 수 없음';
    const dept = departments.find((d) => d.id === response.respondentDeptId)?.name;
    respondents[response.id] = dept ? `${name} · ${dept}` : name;
  }
  return { summary, respondents };
}
