import type { User } from '@/domain/user/schema';
import type { SurveyQuestion, SurveyQuestionDraft } from '@/domain/surveyQuestion/schema';
import { callSurvey } from '@/data/survey/survey.gateway';

/**
 * 설문 질문 저장소.
 *
 * 초안은 화면 로컬 상태에서 편집한 뒤 저장 버튼으로 질문 전체를 한 번에 교체한다
 * (서버 `replaceQuestions`). 기존 질문 ID를 가진 카드는 그대로 두어 응답 참조를 지킨다.
 * ([[jwheo/feat/survey/DESIGN.md]] §8.1)
 */
export const surveyQuestionRepo = {
  list(surveyId: string): Promise<SurveyQuestion[]> {
    return callSurvey<SurveyQuestion[]>('listQuestions', { surveyId });
  },

  replaceAll(_actor: User, surveyId: string, drafts: SurveyQuestionDraft[]): Promise<SurveyQuestion[]> {
    return callSurvey<SurveyQuestion[]>('replaceQuestions', { surveyId, drafts });
  },
};
