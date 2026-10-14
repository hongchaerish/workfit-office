import type { SurveyAnswer } from '@/domain/surveyAnswer/schema';
import type { SurveyResponse } from '@/domain/surveyResponse/schema';
import {
  isChoiceQuestion,
  isTextQuestion,
  SURVEY_RATING_MAX,
  SURVEY_RATING_MIN,
  type SurveyQuestion,
} from '@/domain/surveyQuestion/schema';

export interface SurveyChoiceBucket {
  optionId: string;
  label: string;
  count: number;
  /** 해당 질문에 답한 사람 수 대비 비율(0~1). */
  ratio: number;
}

export interface SurveyRatingBucket {
  score: number;
  count: number;
  ratio: number;
}

export interface SurveyTextEntry {
  responseId: string;
  value: string;
  submittedAt: string;
}

interface ResultBase {
  question: SurveyQuestion;
  /** 이 질문에 실제로 답한 응답 수. 선택 안 한 비필수 질문은 제외된다. */
  answeredCount: number;
}

export type SurveyQuestionResult =
  | (ResultBase & { kind: 'CHOICE'; buckets: SurveyChoiceBucket[] })
  | (ResultBase & { kind: 'RATING'; average: number; buckets: SurveyRatingBucket[] })
  | (ResultBase & { kind: 'TEXT'; entries: SurveyTextEntry[] });

export interface SurveyResultSummary {
  /** 대상자 수. 호출부가 전사·부서·사용자 대상을 해석해 넘긴다. */
  audienceCount: number;
  responseCount: number;
  /** 참여율(0~1). 대상자를 셀 수 없으면 0. */
  participationRate: number;
  questions: SurveyQuestionResult[];
}

const ratioOf = (count: number, total: number): number => (total > 0 ? count / total : 0);

/**
 * 결과 집계. MVP는 결과 화면 진입 시 답변을 모두 읽어 여기서 계산한다.
 * 응답량이 커지면 `surveyAggregates` 누적 집계로 옮긴다. ([[DESIGN.md]] §14)
 *
 * 선택형 비율의 분모는 단일·복수 모두 '해당 질문에 답한 응답 수'로 통일한다.
 * 복수 선택은 옵션 count의 합이 응답자 수보다 클 수 있어 합계가 1을 넘는다.
 */
export function aggregateSurveyResult(
  questions: SurveyQuestion[],
  responses: SurveyResponse[],
  answers: SurveyAnswer[],
  audienceCount: number,
): SurveyResultSummary {
  const submittedAtById = new Map(responses.map((response) => [response.id, response.submittedAt]));
  const answersByQuestion = new Map<string, SurveyAnswer[]>();
  for (const answer of answers) {
    // 응답 문서가 없는 답변은 끝나지 않은 제출의 잔여물이다(응답을 마지막에 저장한다).
    if (!submittedAtById.has(answer.responseId)) continue;
    const bucket = answersByQuestion.get(answer.questionId);
    if (bucket) bucket.push(answer);
    else answersByQuestion.set(answer.questionId, [answer]);
  }

  const ordered = [...questions].sort((a, b) => a.order - b.order);
  const results = ordered.map<SurveyQuestionResult>((question) => {
    const rows = answersByQuestion.get(question.id) ?? [];
    const answeredCount = new Set(rows.map((row) => row.responseId)).size;

    if (isChoiceQuestion(question.type)) {
      const counts = new Map<string, number>();
      for (const row of rows) {
        for (const optionId of row.selectedOptionIds) {
          counts.set(optionId, (counts.get(optionId) ?? 0) + 1);
        }
      }
      const buckets = [...question.options]
        .sort((a, b) => a.order - b.order)
        .map<SurveyChoiceBucket>((option) => {
          const count = counts.get(option.id) ?? 0;
          return { optionId: option.id, label: option.label, count, ratio: ratioOf(count, answeredCount) };
        });
      return { kind: 'CHOICE', question, answeredCount, buckets };
    }

    if (isTextQuestion(question.type)) {
      const entries = rows
        .filter((row) => row.textValue !== null && row.textValue.trim().length > 0)
        .map<SurveyTextEntry>((row) => ({
          responseId: row.responseId,
          value: row.textValue as string,
          submittedAt: submittedAtById.get(row.responseId) ?? row.createdAt,
        }))
        .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
      return { kind: 'TEXT', question, answeredCount, entries };
    }

    const scores = rows.map((row) => row.ratingValue).filter((value): value is number => value !== null);
    const total = scores.reduce((sum, score) => sum + score, 0);
    const buckets: SurveyRatingBucket[] = [];
    for (let score = SURVEY_RATING_MIN; score <= SURVEY_RATING_MAX; score += 1) {
      const count = scores.filter((value) => value === score).length;
      buckets.push({ score, count, ratio: ratioOf(count, scores.length) });
    }
    return {
      kind: 'RATING',
      question,
      answeredCount,
      average: scores.length > 0 ? total / scores.length : 0,
      buckets,
    };
  });

  return {
    audienceCount,
    responseCount: responses.length,
    participationRate: ratioOf(responses.length, audienceCount),
    questions: results,
  };
}

/**
 * 결과 화면에 보내는 값 — 서버가 집계해 준다.
 * 익명 설문은 주관식의 응답 ID를 비우고 순서를 섞어서 보낸다.
 */
export interface SurveyResultView {
  summary: SurveyResultSummary;
  /** responseId → 표시 이름. 기명 설문을 작성자·관리자가 볼 때만 채운다. 익명이면 빈 객체. */
  respondents: Record<string, string>;
}
