import { Functions } from 'appwrite';
import { client } from '@/shared/lib/appwrite';
import { getWiddyToken } from '@/data/widdyChat/widdyAuth';
import { SurveyError } from '@/domain/survey/engine';
import { parseSurveyResponse, RELOGIN } from './survey.protocol';
import { requestRelogin } from '@/shared/lib/relogin';

/**
 * 전자설문 Function(`survey`) 호출.
 * ([[docs/superpowers/specs/2026-10-14-survey-server-design.md]] §8)
 *
 * 신원은 로그인 때 받은 서명 토큰으로만 전달한다 — 본문에 사용자 ID를 싣지 않는다.
 */
const FUNCTION_ID = (import.meta.env?.VITE_SURVEY_FUNCTION_ID as string | undefined) || 'survey';

export async function callSurvey<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  if (!client) throw new SurveyError('INVALID_INPUT', '설문 서버가 설정되지 않았습니다.');
  const token = getWiddyToken();
  if (!token) {
    requestRelogin();
    throw new SurveyError('FORBIDDEN', RELOGIN);
  }

  let raw: string;
  let status: number;
  try {
    const execution = await new Functions(client).createExecution(FUNCTION_ID, JSON.stringify({ token, action, payload }), false);
    raw = execution.responseBody ?? '';
    status = execution.responseStatusCode ?? 0;
  } catch {
    throw new SurveyError('INVALID_INPUT', '설문 서버에 연결하지 못했습니다. 잠시 후 다시 시도하세요.');
  }
  // 서명 토큰이 무효(키 교체·만료) — 앱 셸이 다시 로그인하도록 안내한다.
  if (status === 401) requestRelogin();
  return parseSurveyResponse<T>(raw, status);
}
