import assert from 'node:assert/strict';
import test from 'node:test';
import { SurveyError } from '@/domain/survey/engine';
import { createDraft, publish, replaceQuestions, getSurvey } from './manage';
import { listForRespondent, myParticipations, readResult, submit } from './respond';
import { actorOf, DRAFT, makeCtx, RATING_Q, TEXT_Q, user } from './testkit';

const owner = user('U1');
const a = user('U2');
const b = user('U3');
const isCode = (code: string) => (e: unknown) => e instanceof SurveyError && e.code === code;

async function setup(draft = DRAFT) {
  const ctx = makeCtx(actorOf(owner), undefined, [owner, a, b]);
  const s = await createDraft(ctx, { draft });
  const qs = await replaceQuestions(ctx, { surveyId: s.id, drafts: [RATING_Q, TEXT_Q] });
  const published = await publish(ctx, { id: s.id });
  const as = (u: typeof owner, admin = false) => ({ ...ctx, actor: actorOf(u, admin) });
  const answer = (text: string) => ({
    surveyId: s.id,
    surveyVersion: published.version,
    answers: [
      { questionId: qs[0].id, selectedOptionIds: [], textValue: null, ratingValue: 4 },
      { questionId: qs[1].id, selectedOptionIds: [], textValue: text, ratingValue: null },
    ],
  });
  return { ctx, id: s.id, as, answer, qs };
}

test('익명 제출 — 참여 기록에 시각이 없고, 응답은 날짜만·무작위 ID·응답자 없음', async () => {
  const { ctx, as, answer } = await setup();
  await submit(as(a), answer('좋아요'));
  const [p] = ctx.store.dump('surveyParticipations') as Record<string, unknown>[];
  assert.equal('respondedAt' in p, false);
  const [r] = ctx.store.dump('surveyResponses') as Record<string, unknown>[];
  assert.equal(r.submittedAt, '2026-10-13T15:00:00.000Z');
  assert.equal(r.respondentUserId, null);
  assert.doesNotMatch(String(r.id), /^RESP-/);
});

test('익명 설문의 firstRespondedAt 도 날짜만 남는다', async () => {
  const { ctx, id, as, answer } = await setup();
  await submit(as(a), answer('x'));
  assert.equal((await getSurvey(ctx, { id })).firstRespondedAt, '2026-10-13T15:00:00.000Z');
});

test('같은 사람이 동시에 두 번 제출해도 1건만 남는다', async () => {
  const { ctx, as, answer } = await setup();
  const results = await Promise.allSettled([submit(as(a), answer('1')), submit(as(a), answer('2'))]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
  assert.equal((rejected.reason as SurveyError).code, 'ALREADY_RESPONDED');
  assert.equal(ctx.store.dump('surveyResponses').length, 1);
});

test('답변 저장이 실패하면 참여 기록·응답을 되돌려 다시 낼 수 있다', async () => {
  const { ctx, as, answer } = await setup();
  ctx.store.failNextInsert = 'surveyAnswers';
  await assert.rejects(submit(as(a), answer('x')));
  assert.equal(ctx.store.dump('surveyParticipations').length, 0);
  assert.equal(ctx.store.dump('surveyResponses').length, 0);
  await submit(as(a), answer('x'));
  assert.equal(ctx.store.dump('surveyResponses').length, 1);
});

test('responseCount 는 실제 응답 수다', async () => {
  const { ctx, id, as, answer } = await setup();
  await submit(as(a), answer('1'));
  await submit(as(b), answer('2'));
  assert.equal((await getSurvey(ctx, { id })).responseCount, 2);
});

test('질문이 바뀐 뒤의 옛 버전 제출은 VERSION_CHANGED', async () => {
  const { as, answer, id, qs } = await setup();
  const stale = answer('x');
  // 응답이 없으니 진행 중이어도 질문을 고칠 수 있다
  await replaceQuestions(as(owner), { surveyId: id, drafts: [{ ...RATING_Q, id: qs[0].id }] });
  await assert.rejects(submit(as(a), stale), isCode('VERSION_CHANGED'));
});

test('익명 결과 — 주관식에 응답 ID·응답자가 없고 시각은 날짜뿐', async () => {
  const { as, answer, id } = await setup();
  await submit(as(a), answer('하나'));
  await submit(as(b), answer('둘'));
  const view = await readResult(as(owner), { surveyId: id });
  const text = view.summary.questions.find((q) => q.kind === 'TEXT');
  assert.ok(text && text.kind === 'TEXT');
  assert.deepEqual(text.entries.map((e) => e.responseId), ['', '']);
  assert.ok(text.entries.every((e) => e.submittedAt === '2026-10-13T15:00:00.000Z'));
  assert.deepEqual(view.respondents, {});
  assert.equal(view.summary.audienceCount, 3);
});

test('기명 결과 — 작성자에게 응답자 이름을 준다', async () => {
  const { as, answer, id } = await setup({ ...DRAFT, anonymous: false });
  await submit(as(a), answer('하나'));
  const view = await readResult(as(owner), { surveyId: id });
  assert.deepEqual(Object.values(view.respondents), ['사용자U2 · 개발팀']);
});

test('결과 비공개 설문의 참여자는 결과를 볼 수 없다', async () => {
  const { as, answer, id } = await setup();
  await submit(as(a), answer('x'));
  await assert.rejects(readResult(as(a), { surveyId: id }), isCode('FORBIDDEN'));
});

test('결과 공개 설문의 참여자에게는 응답자 정보를 주지 않는다', async () => {
  const { as, answer, id } = await setup({ ...DRAFT, anonymous: false, showResultToRespondent: true });
  await submit(as(a), answer('x'));
  const view = await readResult(as(a), { surveyId: id });
  assert.deepEqual(view.respondents, {});
});

test('참여 현황과 응답자 목록', async () => {
  const { as, answer, id } = await setup();
  await submit(as(a), answer('x'));
  assert.deepEqual(await myParticipations(as(a), {}), [id]);
  assert.deepEqual((await listForRespondent(as(b), {})).map((s) => s.id), [id]);
});

/* ---------------------------------------------------- 최종 검토 I1~I3 */

test('I1 제출은 설문 문서를 고치지 않는다 — 응답 수·첫 응답은 읽을 때 센다', async () => {
  const { ctx, id, as, answer } = await setup();
  const before = ctx.store.dump('surveys').find((row) => row.id === id);
  await submit(as(a), answer('x'));
  assert.deepEqual(ctx.store.dump('surveys').find((row) => row.id === id), before);
  const read = await getSurvey(ctx, { id });
  assert.equal(read.responseCount, 1);
  assert.equal(read.firstRespondedAt, '2026-10-13T15:00:00.000Z');
});

test('I2 기간 만료 상태 정리는 상태 칸만 고친다 — 그 사이 작성자가 고친 제목을 덮지 않는다', async () => {
  const { ctx, id } = await setup();
  const later = { ...ctx, now: () => new Date('2026-10-21T00:00:00Z') };
  const stale = await ctx.store.getSurvey(id);
  // 작성자가 방금 제목을 고쳤지만, 이 요청은 그 전에 읽은 문서를 들고 있다
  await ctx.store.update('surveys', id, { title: '새 제목' });
  const getSurveyOrig = ctx.store.getSurvey;
  ctx.store.getSurvey = async () => stale;
  await getSurvey(later, { id });
  ctx.store.getSurvey = getSurveyOrig;
  const saved = ctx.store.dump('surveys').find((row) => row.id === id) as Record<string, unknown>;
  assert.equal(saved.title, '새 제목');
  assert.equal(saved.status, 'CLOSED');
});

test('I3a 참여 기록 저장이 실제로는 됐는데 실패로 돌아오면 지우고 다시 낼 수 있다', async () => {
  const { ctx, as, answer } = await setup();
  ctx.store.landThenFailNextInsert = 'surveyParticipations';
  await assert.rejects(submit(as(a), answer('x')));
  assert.equal(ctx.store.dump('surveyParticipations').length, 0);
  await submit(as(a), answer('x'));
  assert.equal(ctx.store.dump('surveyResponses').length, 1);
});

test('I3b 답변 저장이 실제로는 됐는데 실패로 돌아와도 고아 답변을 남기지 않는다', async () => {
  const { ctx, as, answer } = await setup();
  ctx.store.landThenFailNextInsert = 'surveyAnswers';
  await assert.rejects(submit(as(a), answer('x')));
  assert.equal(ctx.store.dump('surveyAnswers').length, 0);
  assert.equal(ctx.store.dump('surveyResponses').length, 0);
  assert.equal(ctx.store.dump('surveyParticipations').length, 0);
});

test('I3b 응답(마지막 저장)이 실제로는 됐는데 실패로 돌아오면 제출 성공으로 본다', async () => {
  const { ctx, id, as, answer } = await setup();
  ctx.store.landThenFailNextInsert = 'surveyResponses';
  await submit(as(a), answer('x'));
  assert.equal(ctx.store.dump('surveyResponses').length, 1);
  assert.equal(ctx.store.dump('surveyAnswers').length, 2);
  assert.deepEqual(await myParticipations(as(a), {}), [id]);
});

test('I3c 남은 시간이 모자라면 아무것도 쓰지 않고 다시 시도하라고 한다', async () => {
  const { ctx, as, answer } = await setup();
  await assert.rejects(submit({ ...as(a), remainingMs: () => 3000 }, answer('x')), isCode('TRY_AGAIN'));
  assert.equal(ctx.store.dump('surveyParticipations').length, 0);
  assert.equal(ctx.store.dump('surveyAnswers').length, 0);
});

test('I3b 응답 문서 없는 답변(늦게 도착한 고아)은 결과에 세지 않는다', async () => {
  const { ctx, as, answer, id, qs } = await setup({ ...DRAFT, anonymous: false });
  await submit(as(a), answer('하나'));
  await ctx.store.insert('surveyAnswers', {
    id: 'orphan1', surveyId: id, responseId: 'ghost', questionId: qs[1].id,
    selectedOptionIds: [], textValue: '유령', ratingValue: null, createdAt: '2026-10-14T03:00:00.000Z',
  } as never);
  const view = await readResult(as(owner), { surveyId: id });
  const text = view.summary.questions.find((q) => q.kind === 'TEXT');
  assert.ok(text && text.kind === 'TEXT');
  assert.deepEqual(text.entries.map((e) => e.value), ['하나']);
});
