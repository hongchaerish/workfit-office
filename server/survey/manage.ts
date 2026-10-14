import {
  assertEndsAtChange,
  assertPublishable,
  assertQuestionsEditable,
  assertQuestionSet,
  assertSurveyTransition,
  canCreateSurvey,
  canManageSurvey,
  deriveSurvey,
  deriveSurveyStatus,
  isSurveyAudience,
  normalizeQuestionOrders,
  publishedStatus,
  SurveyError,
  surveyEditScope,
} from '@/domain/survey/engine';
import { isSelectableSurveyCategory } from '@/domain/survey/category';
import { surveySchema, type Survey, type SurveyDraft } from '@/domain/survey/schema';
import { surveyQuestionSchema, type SurveyQuestion, type SurveyQuestionDraft } from '@/domain/surveyQuestion/schema';
import type { ServiceCtx } from './port';

/**
 * 설문 관리 — 작성·수정·질문 저장·상태 전이·복제·삭제·목록.
 * 브라우저 repo 에 있던 규칙을 옮긴 것이며, 다른 점은 셋이다.
 *   1) 권한 판정에 최고관리자를 반영한다(`canManageSurvey(..., isAdmin)`).
 *   2) 채번을 서버가 하고, 생성이 겹치면(409) 다음 번호로 재시도한다.
 *   3) 읽을 때 기간이 지난 상태를 저장값에 맞춰 둔다.
 * ([[docs/superpowers/specs/2026-10-14-survey-server-design.md]] §4 · §7)
 */

const maxSuffix = (ids: string[]) =>
  ids.reduce((value, id) => {
    const parsed = Number(id.match(/(\d+)$/)?.[1]);
    return Number.isFinite(parsed) ? Math.max(value, parsed) : value;
  }, 0);

/** KST 기준 YYYYMMDD — 설문 번호의 날짜 부분. */
const ymd = (date: Date) => {
  const kst = new Date(date.getTime() + 9 * 3600_000);
  return `${kst.getUTCFullYear()}${String(kst.getUTCMonth() + 1).padStart(2, '0')}${String(kst.getUTCDate()).padStart(2, '0')}`;
};

/** 기간이 지난 설문은 저장 상태도 맞춰 둔다. 바뀐 게 없으면 쓰지 않는다. */
async function fresh(ctx: ServiceCtx, row: Survey): Promise<Survey> {
  const next = deriveSurvey(row, ctx.now());
  if (next !== row) await ctx.store.save('surveys', surveySchema.parse(next));
  return next;
}

export async function requireSurvey(ctx: ServiceCtx, id: string): Promise<Survey> {
  const row = await ctx.store.getSurvey(id);
  if (!row) throw new SurveyError('INVALID_INPUT', '설문을 찾을 수 없습니다.');
  return fresh(ctx, row);
}

const canManage = (ctx: ServiceCtx, row: Survey) => canManageSurvey(ctx.actor.user, row, ctx.actor.isAdmin);

export async function requireManageable(ctx: ServiceCtx, id: string): Promise<Survey> {
  const row = await requireSurvey(ctx, id);
  if (!canManage(ctx, row)) throw new SurveyError('FORBIDDEN', '이 설문을 관리할 권한이 없습니다.');
  return row;
}

/** 작성자·관리자는 언제나, 그 밖에는 배포된 설문의 대상자만 열람한다. */
async function requireReadable(ctx: ServiceCtx, id: string): Promise<Survey> {
  const row = await requireSurvey(ctx, id);
  if (canManage(ctx, row)) return row;
  if (row.status === 'DRAFT' || !isSurveyAudience(row, ctx.actor.user, ctx.actor.deptId)) {
    throw new SurveyError('NOT_AUDIENCE', '이 설문의 대상자가 아닙니다.');
  }
  return row;
}

function assertCategory(code: string) {
  if (!isSelectableSurveyCategory(undefined, code)) {
    throw new SurveyError('INVALID_INPUT', '사용할 수 없는 설문 분류입니다.');
  }
}

/** `SUR-YYYYMMDD-XXXX` — 생성이 겹치면 다음 번호로 재시도한다. */
async function insertSurvey(ctx: ServiceCtx, build: (id: string) => Survey): Promise<Survey> {
  const base = maxSuffix((await ctx.store.listSurveys()).map((row) => row.id));
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const row = surveySchema.parse(build(`SUR-${ymd(ctx.now())}-${String(base + attempt).padStart(4, '0')}`));
    if ((await ctx.store.insert('surveys', row)) === 'created') return row;
  }
  throw new SurveyError('INVALID_INPUT', '설문 번호를 정하지 못했습니다. 잠시 후 다시 시도하세요.');
}

/** 질문 ID `Q-XXXX` — 전체 설문의 최댓값 다음부터. 겹치면 그 질문만 다음 번호로. */
async function insertQuestions(ctx: ServiceCtx, rows: Omit<SurveyQuestion, 'id'>[]): Promise<SurveyQuestion[]> {
  if (rows.length === 0) return [];
  const surveys = await ctx.store.listSurveys();
  const allIds = (await Promise.all(surveys.map((row) => ctx.store.listQuestions(row.id)))).flat().map((q) => q.id);
  let next = maxSuffix(allIds) + 1;
  const out: SurveyQuestion[] = [];
  for (const row of rows) {
    for (;;) {
      const question = surveyQuestionSchema.parse({ ...row, id: `Q-${String(next).padStart(4, '0')}` });
      next += 1;
      if ((await ctx.store.insert('surveyQuestions', question)) === 'created') {
        out.push(question);
        break;
      }
    }
  }
  return out;
}

async function saveSurvey(ctx: ServiceCtx, row: Survey): Promise<Survey> {
  const valid = surveySchema.parse(row);
  await ctx.store.save('surveys', valid);
  return valid;
}

export async function listMine(ctx: ServiceCtx, { scope = 'mine' }: { scope?: 'mine' | 'all' }): Promise<Survey[]> {
  if (scope === 'all' && !ctx.actor.isAdmin) {
    throw new SurveyError('FORBIDDEN', '전체 설문은 관리자만 볼 수 있습니다.');
  }
  const rows = await ctx.store.listSurveys(scope === 'all' ? undefined : { ownerUserId: ctx.actor.user.id });
  const out = await Promise.all(rows.map((row) => fresh(ctx, row)));
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export const getSurvey = (ctx: ServiceCtx, { id }: { id: string }) => requireReadable(ctx, id);

export async function listQuestions(ctx: ServiceCtx, { surveyId }: { surveyId: string }): Promise<SurveyQuestion[]> {
  await requireReadable(ctx, surveyId);
  return (await ctx.store.listQuestions(surveyId)).sort((a, b) => a.order - b.order);
}

export async function createDraft(ctx: ServiceCtx, { draft }: { draft: SurveyDraft }): Promise<Survey> {
  if (!canCreateSurvey(ctx.actor.user)) {
    throw new SurveyError('FORBIDDEN', '사용 중인 계정만 설문을 만들 수 있습니다.');
  }
  assertCategory(draft.categoryCode);
  const stamp = ctx.now().toISOString();
  return insertSurvey(ctx, (id) => ({
    ...draft,
    id,
    ownerUserId: ctx.actor.user.id,
    status: 'DRAFT',
    audienceDeptIds: [...draft.audienceDeptIds],
    audienceUserIds: [...draft.audienceUserIds],
    questionCount: 0,
    responseCount: 0,
    publishedAt: null,
    firstRespondedAt: null,
    closedAt: null,
    version: 1,
    createdAt: stamp,
    updatedAt: stamp,
  }));
}

/** 상태·응답 여부별 수정 범위를 지켜 기본정보를 갱신한다. ([[jwheo/feat/survey/DESIGN.md]] §9) */
function applyDraft(row: Survey, draft: SurveyDraft, now: Date): Survey {
  const scope = surveyEditScope(row, now);
  const deny = () => {
    throw new SurveyError('LOCKED', '현재 상태에서는 수정할 수 없는 항목입니다.');
  };
  const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((value, i) => value === b[i]);

  if (row.title !== draft.title && !scope.title) deny();
  if (row.description !== draft.description && !scope.description) deny();
  if (row.categoryCode !== draft.categoryCode && !scope.category) deny();
  if (row.anonymous !== draft.anonymous && !scope.anonymous) deny();
  if (row.showResultToRespondent !== draft.showResultToRespondent && !scope.showResult) deny();
  if (row.startsAt !== draft.startsAt && !scope.startsAt) deny();

  const audienceChanged = row.audienceType !== draft.audienceType
    || !sameList(row.audienceDeptIds, draft.audienceDeptIds)
    || !sameList(row.audienceUserIds, draft.audienceUserIds);
  if (audienceChanged && !scope.audience) deny();

  if (row.endsAt !== draft.endsAt) {
    if (draft.endsAt === null) {
      if (!scope.endsAt || scope.extendEndsAtOnly) deny();
    } else {
      assertEndsAtChange(row, draft.endsAt, now);
    }
  }

  assertCategory(draft.categoryCode);
  return {
    ...row,
    ...draft,
    audienceDeptIds: [...draft.audienceDeptIds],
    audienceUserIds: [...draft.audienceUserIds],
    version: row.version + 1,
    updatedAt: now.toISOString(),
  };
}

export async function updateBasics(ctx: ServiceCtx, { id, draft }: { id: string; draft: SurveyDraft }): Promise<Survey> {
  const row = await requireManageable(ctx, id);
  return saveSurvey(ctx, applyDraft(row, draft, ctx.now()));
}

/**
 * 질문 목록을 통째로 교체한다. 기존 질문 ID를 가진 카드는 그대로 두어 응답 참조를 지킨다.
 * 질문 구조가 바뀌면 응답 화면이 다시 불러오도록 설문 version 을 올린다.
 */
export async function replaceQuestions(
  ctx: ServiceCtx,
  { surveyId, drafts }: { surveyId: string; drafts: SurveyQuestionDraft[] },
): Promise<SurveyQuestion[]> {
  const survey = await requireManageable(ctx, surveyId);
  assertQuestionsEditable(survey, ctx.now());

  const ordered = normalizeQuestionOrders(drafts);
  const current = await ctx.store.listQuestions(surveyId);
  const existing = new Map(current.map((row) => [row.id, row]));
  const stamp = ctx.now().toISOString();
  const kept: SurveyQuestion[] = [];
  const added: Omit<SurveyQuestion, 'id'>[] = [];
  const seen = new Set<string>();

  for (const draft of ordered) {
    const previous = draft.id ? existing.get(draft.id) : undefined;
    if (draft.id && !previous) {
      throw new SurveyError('INVALID_INPUT', '이 설문에 없는 질문을 수정할 수 없습니다.');
    }
    const { id: _draftId, ...body } = draft;
    const row = {
      ...body,
      surveyId,
      options: draft.options.map((option) => ({ ...option })),
      createdAt: previous?.createdAt ?? stamp,
      updatedAt: stamp,
    };
    if (previous) {
      if (seen.has(previous.id)) throw new SurveyError('INVALID_INPUT', '같은 질문이 두 번 담겼습니다.');
      seen.add(previous.id);
      kept.push(surveyQuestionSchema.parse({ ...row, id: previous.id }));
    } else {
      added.push(row);
    }
  }

  assertQuestionSet([...kept, ...added.map((_, index) => ({ id: `new-${index}` }))]);

  for (const question of kept) await ctx.store.save('surveyQuestions', question);
  const created = await insertQuestions(ctx, added);
  const next = [...kept, ...created].sort((a, b) => a.order - b.order);
  // 통째로 교체하므로 이번에 남지 않은 기존 질문은 지운다.
  for (const row of current) {
    if (!next.some((question) => question.id === row.id)) await ctx.store.remove('surveyQuestions', row.id);
  }
  await saveSurvey(ctx, { ...survey, questionCount: next.length, version: survey.version + 1, updatedAt: stamp });
  return next;
}

export async function publish(ctx: ServiceCtx, { id }: { id: string }): Promise<Survey> {
  const row = await requireManageable(ctx, id);
  const now = ctx.now();
  assertPublishable(row, await ctx.store.listQuestions(id), now);
  const status = publishedStatus(row.startsAt as string, now);
  assertSurveyTransition(row.status, status);
  return saveSurvey(ctx, {
    ...row,
    status,
    publishedAt: now.toISOString(),
    version: row.version + 1,
    updatedAt: now.toISOString(),
  });
}

export async function close(ctx: ServiceCtx, { id }: { id: string }): Promise<Survey> {
  const row = await requireManageable(ctx, id);
  assertSurveyTransition(deriveSurveyStatus(row, ctx.now()), 'CLOSED');
  const stamp = ctx.now().toISOString();
  return saveSurvey(ctx, { ...row, status: 'CLOSED', closedAt: stamp, version: row.version + 1, updatedAt: stamp });
}

export async function archive(ctx: ServiceCtx, { id }: { id: string }): Promise<Survey> {
  const row = await requireManageable(ctx, id);
  assertSurveyTransition(deriveSurveyStatus(row, ctx.now()), 'ARCHIVED');
  const stamp = ctx.now().toISOString();
  return saveSurvey(ctx, { ...row, status: 'ARCHIVED', version: row.version + 1, updatedAt: stamp });
}

/** 기본정보·질문·선택지만 새 초안으로 옮긴다. 응답·통계는 옮기지 않고 기간은 비운다. */
export async function duplicate(ctx: ServiceCtx, { id }: { id: string }): Promise<Survey> {
  if (!canCreateSurvey(ctx.actor.user)) {
    throw new SurveyError('FORBIDDEN', '사용 중인 계정만 설문을 만들 수 있습니다.');
  }
  const source = await requireReadable(ctx, id);
  const questions = await ctx.store.listQuestions(id);
  const stamp = ctx.now().toISOString();
  const copy = await insertSurvey(ctx, (newId) => ({
    ...source,
    id: newId,
    title: `${source.title} 복사본`.slice(0, 100),
    ownerUserId: ctx.actor.user.id,
    status: 'DRAFT',
    audienceDeptIds: [...source.audienceDeptIds],
    audienceUserIds: [...source.audienceUserIds],
    startsAt: null,
    endsAt: null,
    questionCount: questions.length,
    responseCount: 0,
    publishedAt: null,
    firstRespondedAt: null,
    closedAt: null,
    version: 1,
    createdAt: stamp,
    updatedAt: stamp,
  }));
  await insertQuestions(ctx, questions.map(({ id: _questionId, ...question }) => ({
    ...question,
    surveyId: copy.id,
    options: question.options.map((option) => ({ ...option })),
    createdAt: stamp,
    updatedAt: stamp,
  })));
  return copy;
}

/** 초안만 삭제한다. 배포된 설문은 마감·보관으로 처리한다. */
export async function remove(ctx: ServiceCtx, { id }: { id: string }): Promise<null> {
  const row = await requireManageable(ctx, id);
  if (row.status !== 'DRAFT') {
    throw new SurveyError('INVALID_STATUS', '배포된 설문은 삭제할 수 없습니다. 마감 후 보관하세요.');
  }
  // 질문을 먼저 지운다. 설문만 지우고 실패하면 주인 없는 질문 문서가 남는다.
  for (const question of await ctx.store.listQuestions(id)) await ctx.store.remove('surveyQuestions', question.id);
  await ctx.store.remove('surveys', id);
  return null;
}
