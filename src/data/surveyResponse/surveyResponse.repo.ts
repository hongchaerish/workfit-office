import type { User } from '@/domain/user/schema';
import type { SurveyAnswerInput } from '@/domain/surveyAnswer/schema';
import type { SurveyResultView } from '@/domain/survey/aggregate';
import { callSurvey } from '@/data/survey/survey.gateway';

export interface SurveySubmission {
  surveyId: string;
  /** 화면이 들고 있던 설문 version. 질문이 바뀌었으면 서버가 제출을 막는다. */
  surveyVersion: number;
  answers: SurveyAnswerInput[];
}

/**
 * 설문 응답 저장소.
 *
 * 응답·답변·참여 기록은 브라우저가 직접 읽지 못한다 — 서버만 다룬다. 결과도 서버가
 * 집계해 주며, 익명 설문은 응답자·제출 순서를 지운 채로 온다.
 * ([[docs/superpowers/specs/2026-10-14-survey-server-design.md]] §6)
 */
export const surveyResponseRepo = {
  /** 현재 사용자가 이미 참여한 설문 ID 목록. 응답 내용은 담기지 않는다. */
  participatedSurveyIds(_userId: string): Promise<string[]> {
    return callSurvey<string[]>('myParticipations');
  },

  async submit(_actor: User, _actorDeptId: string | null, submission: SurveySubmission): Promise<void> {
    await callSurvey('submit', { ...submission });
  },

  /** 결과 — 작성자·관리자, 그리고 결과 공개 설문의 참여자만. 그 밖에는 FORBIDDEN. */
  readResult(_actor: User, surveyId: string): Promise<SurveyResultView> {
    return callSurvey<SurveyResultView>('readResult', { surveyId });
  },
};
