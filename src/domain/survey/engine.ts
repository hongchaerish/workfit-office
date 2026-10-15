import type { User } from '@/domain/user/schema';
import type { SurveyAnswerInput } from '@/domain/surveyAnswer/schema';
import {
  isChoiceQuestion,
  isTextQuestion,
  questionTextLimit,
  SURVEY_MAX_QUESTIONS,
  SURVEY_ORDER_STEP,
  SURVEY_RATING_MAX,
  SURVEY_RATING_MIN,
  type SurveyQuestion,
} from '@/domain/surveyQuestion/schema';
import type { Survey, SurveyStatus } from './schema';

export type SurveyErrorCode =
  | 'INVALID_INPUT'
  | 'FORBIDDEN'
  | 'INVALID_STATUS'
  | 'NOT_AUDIENCE'
  | 'NOT_OPEN'
  | 'ALREADY_RESPONDED'
  | 'LOCKED'
  | 'VERSION_CHANGED'
  | 'QUESTION_LIMIT'
  | 'REQUIRED_ANSWER'
  | 'ANSWER_FORMAT'
  | 'TRY_AGAIN';

export class SurveyError extends Error {
  constructor(public readonly code: SurveyErrorCode, message: string) {
    super(message);
    this.name = 'SurveyError';
  }
}

/* ------------------------------------------------------------------ 상태·기간 */

/**
 * 저장된 상태와 기간을 함께 보고 현재 상태를 도출한다.
 * 초안·마감·보관은 시각으로 바뀌지 않는다. ([[DESIGN.md]] §6)
 */
export function deriveSurveyStatus(row: Survey, now = new Date()): SurveyStatus {
  if (row.status === 'DRAFT' || row.status === 'CLOSED' || row.status === 'ARCHIVED') return row.status;
  // 배포된 설문은 스키마가 기간을 보장하지만, 초안 기간이 비어 있을 수 있어 방어한다.
  if (row.startsAt === null || row.endsAt === null) return row.status;
  const time = now.getTime();
  if (time < new Date(row.startsAt).getTime()) return 'SCHEDULED';
  if (time > new Date(row.endsAt).getTime()) return 'CLOSED';
  return 'ACTIVE';
}

/** 기간이 지난 설문의 저장 상태를 도출값으로 맞춘다. 변화가 없으면 원본을 그대로 돌려준다. */
export function deriveSurvey(row: Survey, now = new Date()): Survey {
  const derived = deriveSurveyStatus(row, now);
  if (derived === row.status) return row;
  const stamp = now.toISOString();
  return {
    ...row,
    status: derived,
    closedAt: derived === 'CLOSED' ? row.closedAt ?? stamp : row.closedAt,
    version: row.version + 1,
    updatedAt: stamp,
  };
}

const ALLOWED_TRANSITIONS: Record<SurveyStatus, SurveyStatus[]> = {
  DRAFT: ['SCHEDULED', 'ACTIVE'],
  SCHEDULED: ['ACTIVE', 'CLOSED'],
  ACTIVE: ['CLOSED'],
  CLOSED: ['ARCHIVED'],
  ARCHIVED: [],
};

export function assertSurveyTransition(from: SurveyStatus, to: SurveyStatus): void {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new SurveyError('INVALID_STATUS', `${from} 상태에서는 ${to}(으)로 변경할 수 없습니다.`);
  }
}

/* ------------------------------------------------------------------ 권한 */

/**
 * 설문 생성 권한 — 재직 중인 모든 사용자.
 * ([[jwheo/feat/survey/DESIGN.md]] §22-①에서 확정)
 */
export function canCreateSurvey(actor: User): boolean {
  return actor.status === '사용';
}

/** 설문 편집·배포·마감 권한 — 작성자 본인과 ADMIN(장애 대응·상태 보정). */
export function canManageSurvey(actor: User, row: Survey, isAdmin = false): boolean {
  return actor.status === '사용' && (isAdmin || row.ownerUserId === actor.id);
}

/**
 * 응답자의 결과 조회 권한 — 설문별 `showResultToRespondent` 설정과 본인 참여 여부로 결정한다.
 * ([[jwheo/feat/survey/DESIGN.md]] §22-⑥)
 */
export function canViewResultAsRespondent(row: Survey, participated: boolean): boolean {
  return row.showResultToRespondent && participated;
}

/**
 * 대상자 판정. 부서 대상은 선택한 부서만 포함하고 하위 부서를 자동 확장하지 않는다.
 * ([[jwheo/feat/survey/DESIGN.md]] §22-②에서 확정)
 *
 * `users.dept`는 부서명 문자열이므로 호출부에서 부서 ID로 해석해 넘긴다.
 */
export function isSurveyAudience(row: Survey, user: User, userDeptId: string | null): boolean {
  if (user.status !== '사용') return false;
  switch (row.audienceType) {
    case 'COMPANY':
      return true;
    case 'DEPARTMENT':
      return userDeptId !== null && row.audienceDeptIds.includes(userDeptId);
    case 'USERS':
      return row.audienceUserIds.includes(user.id);
  }
}

/**
 * 대상자 수 — 참여율의 분모. 재직 중인 사용자만 센다.
 *
 * `users.dept`가 부서명 문자열이라 부서 ID 해석기를 호출부에서 받는다.
 * 대상 사용자로 지정됐어도 퇴사·잠금 계정은 제외해 참여율이 100%를 넘지 않게 한다.
 */
export function countSurveyAudience(
  row: Survey,
  users: User[],
  deptIdOf: (user: User) => string | null,
): number {
  return users.filter((user) => isSurveyAudience(row, user, deptIdOf(user))).length;
}

/* ------------------------------------------------------------------ 수정 범위 */

export interface SurveyEditScope {
  title: boolean;
  description: boolean;
  category: boolean;
  startsAt: boolean;
  endsAt: boolean;
  /** endsAt을 현재 마감일시보다 뒤로만 옮길 수 있는 상태. */
  extendEndsAtOnly: boolean;
  audience: boolean;
  anonymous: boolean;
  /** 응답자에게 결과 요약을 보여줄지 — 익명 설정과 함께 초안에서만 바꾼다. */
  showResult: boolean;
  questions: boolean;
}

const NOTHING: SurveyEditScope = {
  title: false, description: false, category: false,
  startsAt: false, endsAt: false, extendEndsAtOnly: false,
  audience: false, anonymous: false, showResult: false, questions: false,
};

/**
 * 상태·응답 여부별 수정 가능 범위. ([[jwheo/feat/survey/DESIGN.md]] §9)
 *
 * 표에 열거되지 않은 항목은 잠근 것으로 본다. 배포 후에는 분류·익명 설정을 바꿀 수 없고,
 * 첫 응답 뒤에는 제목·설명과 마감 연장만 남는다.
 */
export function surveyEditScope(row: Survey, now = new Date()): SurveyEditScope {
  const status = deriveSurveyStatus(row, now);
  if (status === 'DRAFT') {
    return {
      title: true, description: true, category: true,
      startsAt: true, endsAt: true, extendEndsAtOnly: false,
      audience: true, anonymous: true, showResult: true, questions: true,
    };
  }
  if (status === 'CLOSED' || status === 'ARCHIVED') {
    return { ...NOTHING, title: true, description: true };
  }
  if (row.firstRespondedAt !== null) {
    return { ...NOTHING, title: true, description: true, endsAt: true, extendEndsAtOnly: true };
  }
  return {
    ...NOTHING,
    title: true, description: true,
    startsAt: true, endsAt: true,
    audience: true, questions: true,
  };
}

export function assertSurveyEditable(
  row: Survey,
  field: keyof Omit<SurveyEditScope, 'extendEndsAtOnly'>,
  now = new Date(),
): void {
  if (!surveyEditScope(row, now)[field]) {
    throw new SurveyError('LOCKED', '현재 상태에서는 수정할 수 없는 항목입니다.');
  }
}

/** 첫 응답 이후 질문 구조 변경을 막는다. */
export function assertQuestionsEditable(row: Survey, now = new Date()): void {
  if (row.firstRespondedAt !== null) {
    throw new SurveyError('LOCKED', '응답이 시작된 설문은 질문을 수정할 수 없습니다. 설문을 복제해 새로 배포하세요.');
  }
  assertSurveyEditable(row, 'questions', now);
}

/** 마감 연장만 허용되는 상태에서 기간을 줄이지 못하게 막는다. */
export function assertEndsAtChange(row: Survey, nextEndsAt: string, now = new Date()): void {
  const scope = surveyEditScope(row, now);
  if (!scope.endsAt) {
    throw new SurveyError('LOCKED', '현재 상태에서는 마감일시를 바꿀 수 없습니다.');
  }
  if (scope.extendEndsAtOnly && row.endsAt !== null && nextEndsAt <= row.endsAt) {
    throw new SurveyError('LOCKED', '응답이 시작된 설문은 마감을 연장만 할 수 있습니다.');
  }
  if (row.startsAt !== null && nextEndsAt <= row.startsAt) {
    throw new SurveyError('INVALID_INPUT', '마감일시는 시작일시보다 늦어야 합니다.');
  }
}

/**
 * 배포 가능 여부. 초안은 기간이 비어 있을 수 있으므로 여기서 필수화한다.
 * ([[DESIGN.md]] §7.1 · §8.4)
 */
export function assertPublishable(
  row: Survey,
  questions: Pick<SurveyQuestion, 'id'>[],
  now = new Date(),
): void {
  if (row.status !== 'DRAFT') {
    throw new SurveyError('INVALID_STATUS', '초안 상태의 설문만 배포할 수 있습니다.');
  }
  if (row.startsAt === null || row.endsAt === null) {
    throw new SurveyError('INVALID_INPUT', '응답 시작일시와 마감일시를 설정하세요.');
  }
  if (row.startsAt >= row.endsAt) {
    throw new SurveyError('INVALID_INPUT', '마감일시는 시작일시보다 늦어야 합니다.');
  }
  if (new Date(row.endsAt).getTime() <= now.getTime()) {
    throw new SurveyError('INVALID_INPUT', '마감일시가 이미 지났습니다.');
  }
  if (row.audienceType === 'DEPARTMENT' && row.audienceDeptIds.length === 0) {
    throw new SurveyError('INVALID_INPUT', '대상 부서를 한 개 이상 선택하세요.');
  }
  if (row.audienceType === 'USERS' && row.audienceUserIds.length === 0) {
    throw new SurveyError('INVALID_INPUT', '대상 사용자를 한 명 이상 선택하세요.');
  }
  assertQuestionSet(questions);
}

/** 배포 직후 상태 — 시작일시가 지났으면 즉시 진행, 아니면 예정. ([[DESIGN.md]] §6) */
export function publishedStatus(startsAt: string, now = new Date()): SurveyStatus {
  return new Date(startsAt).getTime() <= now.getTime() ? 'ACTIVE' : 'SCHEDULED';
}

/* ------------------------------------------------------------------ 질문 편집 */

/** 질문 order를 화면 순서대로 SURVEY_ORDER_STEP 간격으로 재정렬한다. */
export function normalizeQuestionOrders<T extends { order: number }>(questions: T[]): T[] {
  return [...questions]
    .sort((a, b) => a.order - b.order)
    .map((question, index) => ({ ...question, order: (index + 1) * SURVEY_ORDER_STEP }));
}

/** 배포 전 질문 목록 검증 — 개수 상한과 최소 1개. */
export function assertQuestionSet(questions: Pick<SurveyQuestion, 'id'>[]): void {
  if (questions.length === 0) {
    throw new SurveyError('INVALID_INPUT', '질문을 한 개 이상 추가하세요.');
  }
  if (questions.length > SURVEY_MAX_QUESTIONS) {
    throw new SurveyError('QUESTION_LIMIT', `질문은 최대 ${SURVEY_MAX_QUESTIONS}개까지 만들 수 있습니다.`);
  }
  const ids = questions.map((question) => question.id);
  if (new Set(ids).size !== ids.length) {
    throw new SurveyError('INVALID_INPUT', '질문 ID가 중복되었습니다.');
  }
}

export interface ParsedOptionLines {
  labels: string[];
  /** 두 번 이상 등장한 문구. 저장 전에 화면에서 알려준다. ([[DESIGN.md]] §8.2) */
  duplicates: string[];
}

/** 줄바꿈 기준 선택지 일괄 입력. 빈 줄과 앞뒤 공백을 제거하고 중복 문구를 알려준다. */
export function parseOptionLines(text: string): ParsedOptionLines {
  const labels = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const label of labels) {
    if (seen.has(label)) duplicates.add(label);
    seen.add(label);
  }
  return { labels, duplicates: [...duplicates] };
}

/** 줄바꿈 기준 질문 일괄 추가. 한 줄이 질문 하나가 된다. ([[DESIGN.md]] §8.3) */
export function parseQuestionLines(text: string): string[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
}

/** 질문 안에서 고유한 선택지 ID. 기존 선택지 문구가 바뀌어도 응답 참조가 유지된다. */
export function nextOptionId(existing: { id: string }[]): string {
  const max = existing.reduce((value, option) => {
    const parsed = Number(option.id.match(/(\d+)$/)?.[1]);
    return Number.isFinite(parsed) ? Math.max(value, parsed) : value;
  }, 0);
  return `OPT-${String(max + 1).padStart(2, '0')}`;
}

/* ------------------------------------------------------------------ 응답 검증 */

/** 응답 가능 여부 — 재직·대상·상태·기간·중복. ([[DESIGN.md]] §13) */
export function assertRespondable(
  row: Survey,
  user: User,
  userDeptId: string | null,
  alreadyResponded: boolean,
  now = new Date(),
): void {
  if (user.status !== '사용') {
    throw new SurveyError('FORBIDDEN', '사용 중인 계정만 응답할 수 있습니다.');
  }
  if (!isSurveyAudience(row, user, userDeptId)) {
    throw new SurveyError('NOT_AUDIENCE', '이 설문의 대상자가 아닙니다.');
  }
  const status = deriveSurveyStatus(row, now);
  if (status !== 'ACTIVE') {
    throw new SurveyError('NOT_OPEN', status === 'SCHEDULED' ? '아직 시작되지 않은 설문입니다.' : '응답 기간이 끝난 설문입니다.');
  }
  if (alreadyResponded) {
    throw new SurveyError('ALREADY_RESPONDED', '이미 참여한 설문입니다.');
  }
}

/** 화면이 들고 있던 설문 버전이 최신인지 확인한다. */
export function assertSurveyVersion(row: Survey, submittedVersion: number): void {
  if (row.version !== submittedVersion) {
    throw new SurveyError('VERSION_CHANGED', '설문이 변경되었습니다. 새로고침한 뒤 다시 응답해 주세요.');
  }
}

const isBlankAnswer = (question: SurveyQuestion, input: SurveyAnswerInput): boolean => {
  if (isChoiceQuestion(question.type)) return input.selectedOptionIds.length === 0;
  if (isTextQuestion(question.type)) return input.textValue === null || input.textValue.trim().length === 0;
  return input.ratingValue === null;
};

/**
 * 제출된 답변을 현재 질문 목록과 대조해 검증하고 정규화한다.
 *
 * 클라이언트가 보낸 질문 문구·선택지 문구는 신뢰하지 않고 `questionId`/`optionId`만 사용한다.
 * 비어 있는 선택 질문은 결과에서 제외해 통계 분모를 오염시키지 않는다.
 */
export function validateSurveyAnswers(
  questions: SurveyQuestion[],
  inputs: SurveyAnswerInput[],
): SurveyAnswerInput[] {
  const byId = new Map(questions.map((question) => [question.id, question]));
  const seen = new Set<string>();
  const normalized: SurveyAnswerInput[] = [];

  for (const input of inputs) {
    const question = byId.get(input.questionId);
    if (!question) {
      throw new SurveyError('ANSWER_FORMAT', '설문에 없는 질문에 대한 답변이 있습니다.');
    }
    if (seen.has(input.questionId)) {
      throw new SurveyError('ANSWER_FORMAT', '같은 질문에 답변이 두 번 담겼습니다.');
    }
    seen.add(input.questionId);

    if (isBlankAnswer(question, input)) continue;

    if (isChoiceQuestion(question.type)) {
      const optionIds = new Set(question.options.map((option) => option.id));
      const unique = [...new Set(input.selectedOptionIds)];
      if (unique.length !== input.selectedOptionIds.length) {
        throw new SurveyError('ANSWER_FORMAT', `'${question.title}'에 같은 선택지가 중복 선택되었습니다.`);
      }
      if (unique.some((id) => !optionIds.has(id))) {
        throw new SurveyError('ANSWER_FORMAT', `'${question.title}'에 존재하지 않는 선택지가 있습니다.`);
      }
      if (question.type === 'SINGLE_CHOICE' && unique.length !== 1) {
        throw new SurveyError('ANSWER_FORMAT', `'${question.title}'은 한 개만 선택할 수 있습니다.`);
      }
      normalized.push({ questionId: question.id, selectedOptionIds: unique, textValue: null, ratingValue: null });
      continue;
    }

    if (isTextQuestion(question.type)) {
      const text = (input.textValue ?? '').trim();
      const limit = questionTextLimit(question);
      if (text.length > limit) {
        throw new SurveyError('ANSWER_FORMAT', `'${question.title}'은 ${limit}자 이내로 입력하세요.`);
      }
      normalized.push({ questionId: question.id, selectedOptionIds: [], textValue: text, ratingValue: null });
      continue;
    }

    const rating = input.ratingValue;
    if (rating === null || !Number.isInteger(rating) || rating < SURVEY_RATING_MIN || rating > SURVEY_RATING_MAX) {
      throw new SurveyError('ANSWER_FORMAT', `'${question.title}'은 ${SURVEY_RATING_MIN}~${SURVEY_RATING_MAX}점으로 선택하세요.`);
    }
    normalized.push({ questionId: question.id, selectedOptionIds: [], textValue: null, ratingValue: rating });
  }

  const answered = new Set(normalized.map((answer) => answer.questionId));
  const missing = questions.filter((question) => question.required && !answered.has(question.id));
  if (missing.length > 0) {
    throw new SurveyError('REQUIRED_ANSWER', `필수 질문에 답변하지 않았습니다: ${missing[0].title}`);
  }

  return normalized;
}

/** 필수 질문 중 아직 답하지 않은 항목 — 화면에서 누락 질문으로 이동시킬 때 쓴다. */
export function missingRequiredQuestions(
  questions: SurveyQuestion[],
  inputs: SurveyAnswerInput[],
): SurveyQuestion[] {
  const byId = new Map(inputs.map((input) => [input.questionId, input]));
  return questions.filter((question) => {
    if (!question.required) return false;
    const input = byId.get(question.id);
    return !input || isBlankAnswer(question, input);
  });
}
