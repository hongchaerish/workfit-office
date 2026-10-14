/**
 * Appwrite Function — survey: 전자설문 쓰기·제출·결과.
 *
 *   요청:  POST { token, action, payload }
 *   응답:  { data } | { error: { code, message } }
 *
 * 신원은 `widdy-login` 서명 토큰으로만 정한다(메일·근태와 같은 방식).
 * 규칙의 정본은 `server/survey/**` 와 `src/domain/survey/**` 이고, esbuild 로 이 파일과 함께
 * 한 번들(`dist/main.js`)로 묶여 배포된다 — 규칙을 JS 로 다시 적지 않는다.
 *
 * env(함수 설정):
 *   AUTH_TOKEN_SECRET     ★widdy-login 과 같은 HMAC 시크릿
 *   APPWRITE_DATABASE_ID  기본 'workfit'
 *   APPWRITE_ENDPOINT     https 엔드포인트(주입되는 함수 엔드포인트가 평문 http 라 덮어쓴다)
 * scopes: databases.read, documents.read, documents.write
 */
import crypto from 'node:crypto';
import { dispatch } from '../../../../server/survey/dispatch';
import { createAppwritePorts } from './appwriteStore';

interface FnContext {
  req: { bodyJson?: unknown; headers: Record<string, string | undefined> };
  res: { json(body: unknown, status?: number): unknown };
  log(message: string): void;
  error(message: string): void;
}

/**
 * 요청 하나에 쓸 시간. 함수 실행 제한(appwrite.json timeout 30초)보다 짧게 잡아, 강제 종료로
 * 쓰기가 반쯤 남는 대신 '잠시 후 다시' 오류로 끝나게 한다.
 */
const REQUEST_BUDGET_MS = 25_000;

export default async ({ req, res, log, error }: FnContext) => {
  const deadlineAt = Date.now() + REQUEST_BUDGET_MS;
  const secret = process.env.AUTH_TOKEN_SECRET || process.env.WIDDY_TOKEN_SECRET || '';
  if (!secret) return res.json({ error: { code: 'INVALID_INPUT', message: '설문 서버가 설정되지 않았습니다.' } }, 500);

  const endpoint = process.env.APPWRITE_ENDPOINT || process.env.APPWRITE_FUNCTION_API_ENDPOINT || '';
  const project = process.env.APPWRITE_FUNCTION_PROJECT_ID || '';
  const key = req.headers['x-appwrite-key'] || process.env.APPWRITE_API_KEY || '';
  const trace = process.env.SURVEY_DEBUG ? (message: string) => log(`${new Date().toISOString().slice(11, 23)} ${message}`) : undefined;
  const ports = createAppwritePorts(endpoint, project, key, process.env.APPWRITE_DATABASE_ID || 'workfit', trace, deadlineAt);

  try {
    const result = await dispatch(req.bodyJson, {
      ...ports,
      secret,
      remainingMs: () => deadlineAt - Date.now(),
      // 응답·답변 ID — 순번이 아닌 무작위(제출 순서를 감춘다). Appwrite ID 규칙(36자) 안.
      newId: () => crypto.randomUUID().replace(/-/g, '').slice(0, 20),
    });
    return res.json(result.body, result.status);
  } catch (caught) {
    error(`survey: ${(caught as Error).message}`);
    return res.json({ error: { code: 'INVALID_INPUT', message: '설문 서버 처리 중 오류가 났습니다.' } }, 500);
  }
};
