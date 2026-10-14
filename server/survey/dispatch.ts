import { resolveDeptId } from '@/domain/department/engine';
import { resolveUserRoles } from '@/domain/roleGroup/roleResolver';
import { SurveyError } from '@/domain/survey/engine';
import * as manage from './manage';
import * as respond from './respond';
import type { DirectoryPort, ServiceCtx, SurveyStorePort } from './port';
import { verifyToken } from './token';

/**
 * 설문 Function 요청 분기 — `{ token, action, payload }` → `{ status, body }`.
 *
 * 요청자는 서명 토큰으로만 정한다. 본문에 실려 온 사용자 ID는 읽지 않는다.
 * 응답 계약: `{ data }` 또는 `{ error: { code, message } }`.
 */
export interface DispatchDeps {
  store: SurveyStorePort;
  directory: DirectoryPort;
  secret: string;
  now?: () => Date;
  newId: () => string;
}

type Body = { data: unknown } | { error: { code: string; message: string } };
export interface DispatchResult { status: number; body: Body }

const ACTIONS: Record<string, (ctx: ServiceCtx, payload: never) => Promise<unknown>> = {
  listMine: manage.listMine,
  getSurvey: manage.getSurvey,
  listQuestions: manage.listQuestions,
  createDraft: manage.createDraft,
  updateBasics: manage.updateBasics,
  replaceQuestions: manage.replaceQuestions,
  publish: manage.publish,
  close: manage.close,
  archive: manage.archive,
  duplicate: manage.duplicate,
  remove: manage.remove,
  submit: respond.submit,
  myParticipations: respond.myParticipations,
  listForRespondent: respond.listForRespondent,
  readResult: respond.readResult,
};

const fail = (status: number, code: string, message: string): DispatchResult => ({
  status,
  body: { error: { code, message } },
});

export async function dispatch(raw: unknown, deps: DispatchDeps): Promise<DispatchResult> {
  const body = (raw ?? {}) as { token?: unknown; action?: unknown; payload?: unknown };
  const uid = verifyToken(String(body.token ?? ''), deps.secret);
  if (!uid) return fail(401, 'UNAUTHENTICATED', '로그인 정보가 만료되었습니다. 다시 로그인해 주세요.');

  const handler = typeof body.action === 'string' ? ACTIONS[body.action] : undefined;
  if (!handler) return fail(400, 'INVALID_INPUT', '알 수 없는 요청입니다.');

  const [users, departments, roleGroups, positions] = await Promise.all([
    deps.directory.listUsers(),
    deps.directory.listDepartments(),
    deps.directory.listRoleGroups(),
    deps.directory.listPositions(),
  ]);
  const user = users.find((row) => row.id === uid);
  if (!user || user.status !== '사용') return fail(403, 'FORBIDDEN', '사용할 수 없는 계정입니다.');
  // 앱과 같은 판정 함수로 최고관리자를 가린다.
  const isAdmin = resolveUserRoles(user, roleGroups, { depts: departments, positions })
    .some((group) => group.code.replace(/^ROLE_/, '').toUpperCase() === 'ADMIN');

  const ctx: ServiceCtx = {
    store: deps.store,
    directory: deps.directory,
    now: deps.now ?? (() => new Date()),
    newId: deps.newId,
    actor: { user, deptId: resolveDeptId(departments, user.dept), isAdmin },
  };
  try {
    return { status: 200, body: { data: await handler(ctx, (body.payload ?? {}) as never) } };
  } catch (error) {
    if (error instanceof SurveyError) return fail(400, error.code, error.message);
    if (error instanceof Error && error.name === 'ZodError') return fail(400, 'INVALID_INPUT', '입력값이 올바르지 않습니다.');
    throw error;
  }
}
