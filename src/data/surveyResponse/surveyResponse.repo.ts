import type { User } from '@/domain/user/schema';
import { surveySchema, type Survey } from '@/domain/survey/schema';
import {
  assertRespondable,
  assertSurveyVersion,
  canViewResultAsRespondent,
  canViewSurveyResult,
  SurveyError,
  validateSurveyAnswers,
} from '@/domain/survey/engine';
import { surveyAnswerSchema, type SurveyAnswer, type SurveyAnswerInput } from '@/domain/surveyAnswer/schema';
import {
  assertAnonymousResponse,
  surveyResponseSchema,
  type SurveyResponse,
} from '@/domain/surveyResponse/schema';
import {
  surveyParticipationId,
  surveyParticipationSchema,
} from '@/domain/surveyParticipation/schema';
import {
  exclusive,
  loadSurveyStore,
  nextAnswerId,
  nextResponseId,
  persistDocs,
  questionsOf,
  refreshSurveyStatuses,
  SURVEY_ANSWER_COLL,
  SURVEY_COLL,
  SURVEY_PARTICIPATION_COLL,
  SURVEY_RESPONSE_COLL,
  surveyStore,
} from '@/data/survey/store';

export interface SurveySubmission {
  surveyId: string;
  /** 화면이 들고 있던 설문 version. 질문이 바뀌었으면 제출을 막는다. */
  surveyVersion: number;
  answers: SurveyAnswerInput[];
}

/** 결과 집계 원본. 참여 기록은 의도적으로 포함하지 않는다. */
export interface SurveyResultSource {
  responses: SurveyResponse[];
  answers: SurveyAnswer[];
}

function requireSurvey(id: string): Survey {
  const found = surveyStore.surveys.find((row) => row.id === id);
  if (!found) throw new SurveyError('INVALID_INPUT', '설문을 찾을 수 없습니다.');
  return found;
}

/**
 * 설문 응답 저장소.
 *
 * 익명성은 저장 구조로 지킨다. 익명 설문의 `surveyResponses`에는 사용자·부서를 넣지 않고,
 * 1인 1회 제한은 `surveyParticipations`가 따로 담당한다. 두 문서를 잇는 값은 어느 쪽에도
 * 두지 않으며, 이 저장소도 둘을 함께 돌려주는 API를 제공하지 않는다.
 *
 * 다만 이는 애플리케이션 수준의 익명성이다. 저장 순서의 상관관계까지 가리지는 못하므로
 * 높은 수준의 익명성이 필요한 설문은 별도 설계가 필요하다. ([[DESIGN.md]] §7.5)
 */
export const surveyResponseRepo = {
  /** 현재 사용자가 이미 참여한 설문 ID 목록. 응답 내용은 돌려주지 않는다. */
  async participatedSurveyIds(userId: string): Promise<string[]> {
    await loadSurveyStore();
    return surveyStore.participations
      .filter((row) => row.userId === userId && row.responded)
      .map((row) => row.surveyId);
  },

  /**
   * 응답 제출. 참여 기록·응답·답변·응답 수를 한 단위로 처리한다.
   *
   * 로컬 MVP에서는 `exclusive()` 직렬화가 Firestore transaction을 대신한다. 실제 다중 사용자
   * 동시성은 Cloud Function 이관 전까지 보장하지 않는다. ([[DESIGN.md]] §13)
   */
  submit(actor: User, actorDeptId: string | null, submission: SurveySubmission): Promise<SurveyResponse> {
    return exclusive(async () => {
      await loadSurveyStore();
      refreshSurveyStatuses();
      const survey = requireSurvey(submission.surveyId);
      const participationId = surveyParticipationId(survey.id, actor.id);
      const alreadyResponded = surveyStore.participations.some((row) => row.id === participationId);

      assertRespondable(survey, actor, actorDeptId, alreadyResponded);
      assertSurveyVersion(survey, submission.surveyVersion);

      // 클라이언트가 보낸 질문 문구·선택지 문구는 신뢰하지 않고 저장된 질문으로 다시 검증한다.
      const questions = questionsOf(survey.id);
      const answers = validateSurveyAnswers(questions, submission.answers);

      const now = new Date();
      const stamp = now.toISOString();

      const participation = surveyParticipationSchema.parse({
        id: participationId,
        surveyId: survey.id,
        userId: actor.id,
        responded: true,
      });

      const response = surveyResponseSchema.parse({
        id: nextResponseId(),
        surveyId: survey.id,
        respondentUserId: survey.anonymous ? null : actor.id,
        respondentDeptId: survey.anonymous ? null : actorDeptId,
        surveyVersion: survey.version,
        submittedAt: stamp,
      });
      if (survey.anonymous) assertAnonymousResponse(response);

      const rows = answers.map((answer, index) => surveyAnswerSchema.parse({
        id: nextAnswerId(index),
        surveyId: survey.id,
        responseId: response.id,
        questionId: answer.questionId,
        selectedOptionIds: answer.selectedOptionIds,
        textValue: answer.textValue,
        ratingValue: answer.ratingValue,
        createdAt: stamp,
      }));

      const updated = surveySchema.parse({
        ...survey,
        responseCount: survey.responseCount + 1,
        firstRespondedAt: survey.firstRespondedAt ?? stamp,
        updatedAt: stamp,
      });

      surveyStore.participations = [...surveyStore.participations, participation];
      surveyStore.responses = [...surveyStore.responses, response];
      surveyStore.answers = [...surveyStore.answers, ...rows];
      surveyStore.surveys = surveyStore.surveys.map((row) => (row.id === survey.id ? updated : row));

      // 참여 기록을 먼저 쓴다. 중간에 실패하더라도 중복 제출은 막힌 상태로 남는 편이,
      // 응답만 저장되고 재제출이 열려 있는 것보다 낫다.
      await persistDocs(SURVEY_PARTICIPATION_COLL, [participation]);
      await persistDocs(SURVEY_RESPONSE_COLL, [response]);
      await persistDocs(SURVEY_ANSWER_COLL, rows);
      await persistDocs(SURVEY_COLL, [updated]);

      return { ...response };
    });
  },

  /**
   * 결과 집계 원본. 작성자·ADMIN과, 결과 공개 설정이 켜진 설문에 참여한 응답자만 읽는다.
   *
   * 응답과 답변을 함께 돌려주되 참여 기록은 절대 섞지 않는다. 셋을 한 번에 넘기면
   * 호출부에서 익명 응답자를 역추적할 여지가 생기기 때문이다. ([[DESIGN.md]] §7.5 · §12)
   */
  async readResult(actor: User, surveyId: string): Promise<SurveyResultSource> {
    await loadSurveyStore();
    refreshSurveyStatuses();
    const survey = requireSurvey(surveyId);
    const participated = surveyStore.participations.some(
      (row) => row.surveyId === surveyId && row.userId === actor.id,
    );
    if (!canViewSurveyResult(actor, survey) && !canViewResultAsRespondent(survey, participated)) {
      throw new SurveyError('FORBIDDEN', '이 설문의 결과를 볼 권한이 없습니다.');
    }
    return {
      responses: surveyStore.responses
        .filter((row) => row.surveyId === surveyId)
        .map((row) => ({ ...row })),
      answers: surveyStore.answers
        .filter((row) => row.surveyId === surveyId)
        .map((row) => ({ ...row, selectedOptionIds: [...row.selectedOptionIds] })),
    };
  },
};
