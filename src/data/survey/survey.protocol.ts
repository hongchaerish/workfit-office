import { SurveyError, type SurveyErrorCode } from '@/domain/survey/engine';
import { RELOGIN_MESSAGE as RELOGIN } from '@/shared/lib/relogin';

/**
 * 설문 Function 응답 해석 — 순수 함수(브라우저 SDK 없이 시험한다).
 * 실패를 빈 결과로 바꾸지 않는다. 빈 목록으로 보이면 "설문이 없다"로 오인한다.
 */
const KNOWN_CODES: SurveyErrorCode[] = [
  'INVALID_INPUT', 'FORBIDDEN', 'INVALID_STATUS', 'NOT_AUDIENCE', 'NOT_OPEN',
  'ALREADY_RESPONDED', 'LOCKED', 'VERSION_CHANGED', 'QUESTION_LIMIT', 'REQUIRED_ANSWER', 'ANSWER_FORMAT',
];
export { RELOGIN };

/** Function 응답 본문 → data. 계약은 `{ data }` 또는 `{ error: { code, message } }` 뿐이다. */
export function parseSurveyResponse<T>(raw: string, status: number): T {
  if (raw.trim() === '') throw new SurveyError('INVALID_INPUT', `설문 서버가 응답하지 않았습니다. (HTTP ${status})`);
  let body: { data?: T; error?: { code?: string; message?: string } };
  try {
    body = JSON.parse(raw);
  } catch {
    throw new SurveyError('INVALID_INPUT', '설문 서버 응답을 이해하지 못했습니다.');
  }
  if (body.error) {
    if (status === 401) throw new SurveyError('FORBIDDEN', RELOGIN);
    const code = (KNOWN_CODES as string[]).includes(body.error.code ?? '') ? (body.error.code as SurveyErrorCode) : 'INVALID_INPUT';
    throw new SurveyError(code, body.error.message || '설문 요청을 처리하지 못했습니다.');
  }
  if (!('data' in body)) throw new SurveyError('INVALID_INPUT', `설문 서버 응답 형식이 올바르지 않습니다. (HTTP ${status})`);
  return body.data as T;
}
