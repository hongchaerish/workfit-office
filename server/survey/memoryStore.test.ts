import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryStore } from './memoryStore';

test('insert 는 같은 ID 가 있으면 exists 를 돌려주고 덮지 않는다', async () => {
  const store = createMemoryStore();
  const row = { id: 'S1__U1', surveyId: 'S1', userId: 'U1', responded: true };
  assert.equal(await store.insert('surveyParticipations', row), 'created');
  const again = { ...row, responded: false };
  assert.equal(await store.insert('surveyParticipations', again), 'exists');
  assert.equal((store.dump('surveyParticipations')[0] as typeof row).responded, true);
});

test('설문별 조회는 surveyId 로 좁힌다', async () => {
  const store = createMemoryStore({
    surveyResponses: [
      { id: 'r1', surveyId: 'S1' } as never,
      { id: 'r2', surveyId: 'S2' } as never,
    ],
  });
  assert.deepEqual((await store.listResponses('S1')).map((r) => r.id), ['r1']);
  assert.equal((await store.responseStats('S2')).count, 1);
});

test('failNextInsert 로 지정한 컬렉션의 다음 insert 는 실패한다(보상 시험용)', async () => {
  const store = createMemoryStore();
  store.failNextInsert = 'surveyAnswers';
  await assert.rejects(store.insert('surveyAnswers', { id: 'a1' }));
  assert.equal(await store.insert('surveyAnswers', { id: 'a2' }), 'created');
});
