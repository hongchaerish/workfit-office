import assert from 'node:assert/strict';
import test from 'node:test';
import { SurveyError } from '@/domain/survey/engine';
import { createDraft, replaceQuestions, publish, close, remove, listMine, duplicate, getSurvey } from './manage';
import { actorOf, DRAFT, makeCtx, RATING_Q, user } from './testkit';

const owner = user('U1');
const other = user('U2');

const isCode = (code: string) => (e: unknown) => e instanceof SurveyError && e.code === code;

async function publishedSurvey() {
  const ctx = makeCtx(actorOf(owner));
  const s = await createDraft(ctx, { draft: DRAFT });
  await replaceQuestions(ctx, { surveyId: s.id, drafts: [RATING_Q] });
  await publish(ctx, { id: s.id });
  return { ctx, id: s.id };
}

test('초안 생성 — 서버가 ID·작성자를 정한다', async () => {
  const ctx = makeCtx(actorOf(owner));
  const s = await createDraft(ctx, { draft: DRAFT });
  assert.match(s.id, /^SUR-20261014-\d{4}$/);
  assert.equal(s.ownerUserId, 'U1');
  assert.equal(s.status, 'DRAFT');
});

test('남의 설문은 마감할 수 없다', async () => {
  const { ctx, id } = await publishedSurvey();
  await assert.rejects(close({ ...ctx, actor: actorOf(other) }, { id }), isCode('FORBIDDEN'));
});

test('최고관리자는 남의 설문도 마감할 수 있다', async () => {
  const { ctx, id } = await publishedSurvey();
  const closed = await close({ ...ctx, actor: actorOf(other, true) }, { id });
  assert.equal(closed.status, 'CLOSED');
});

test('배포된 설문은 삭제할 수 없다', async () => {
  const { ctx, id } = await publishedSurvey();
  await assert.rejects(remove(ctx, { id }), isCode('INVALID_STATUS'));
});

test('초안 삭제는 질문까지 지운다', async () => {
  const ctx = makeCtx(actorOf(owner));
  const s = await createDraft(ctx, { draft: DRAFT });
  await replaceQuestions(ctx, { surveyId: s.id, drafts: [RATING_Q] });
  await remove(ctx, { id: s.id });
  assert.equal(ctx.store.dump('surveyQuestions').length, 0);
  assert.equal(ctx.store.dump('surveys').length, 0);
});

test('질문 저장은 questionCount·version 을 갱신한다', async () => {
  const ctx = makeCtx(actorOf(owner));
  const s = await createDraft(ctx, { draft: DRAFT });
  const qs = await replaceQuestions(ctx, { surveyId: s.id, drafts: [RATING_Q] });
  assert.match(qs[0].id, /^Q-\d{4}$/);
  const after = await getSurvey(ctx, { id: s.id });
  assert.equal(after.questionCount, 1);
  assert.equal(after.version, s.version + 1);
});

test('listMine scope=all 은 관리자만', async () => {
  const { ctx } = await publishedSurvey();
  await assert.rejects(listMine({ ...ctx, actor: actorOf(other) }, { scope: 'all' }), isCode('FORBIDDEN'));
  assert.equal((await listMine({ ...ctx, actor: actorOf(other, true) }, { scope: 'all' })).length, 1);
});

test('대상이 아닌 사용자는 설문을 열 수 없다', async () => {
  const ctx = makeCtx(actorOf(owner));
  const s = await createDraft(ctx, { draft: { ...DRAFT, audienceType: 'USERS', audienceUserIds: ['U1'] } });
  await replaceQuestions(ctx, { surveyId: s.id, drafts: [RATING_Q] });
  await publish(ctx, { id: s.id });
  await assert.rejects(getSurvey({ ...ctx, actor: actorOf(other) }, { id: s.id }), isCode('NOT_AUDIENCE'));
});

test('복제는 기간을 비운 새 초안과 질문을 만든다', async () => {
  const { ctx, id } = await publishedSurvey();
  const copy = await duplicate(ctx, { id });
  assert.equal(copy.status, 'DRAFT');
  assert.equal(copy.startsAt, null);
  assert.equal(ctx.store.dump('surveyQuestions').length, 2);
});
