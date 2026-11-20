import assert from 'node:assert/strict';
import test from 'node:test';
import { isRateLimited, PartialBatchError, runEachWithRetry, withRateLimitRetry } from './rateLimit';

const noSleep = async () => {};
const limited = () => Object.assign(new Error('Rate limit for the current endpoint has been exceeded.'), { code: 429 });

test('isRateLimited: 429 또는 문구로 알아본다', () => {
  assert.equal(isRateLimited({ code: 429 }), true);
  assert.equal(isRateLimited(new Error('Rate limit for the current endpoint has been exceeded.')), true);
  assert.equal(isRateLimited({ code: 409 }), false);
  assert.equal(isRateLimited(null), false);
});

test('withRateLimitRetry: 요청 한도면 기다렸다 다시 보내고, 늘어나는 간격으로 기다린다', async () => {
  let calls = 0;
  const waits: number[] = [];
  const result = await withRateLimitRetry(
    async () => {
      calls += 1;
      if (calls < 3) throw limited();
      return 'ok';
    },
    { baseMs: 100, sleep: async (ms) => { waits.push(ms); } },
  );
  assert.equal(result, 'ok');
  assert.equal(calls, 3);
  assert.deepEqual(waits, [100, 200]);
});

test('withRateLimitRetry: 다른 오류는 다시 보내지 않는다', async () => {
  let calls = 0;
  await assert.rejects(withRateLimitRetry(async () => { calls += 1; throw Object.assign(new Error('x'), { code: 409 }); }, { sleep: noSleep }));
  assert.equal(calls, 1);
});

test('runEachWithRetry: 한도에 걸린 건은 다시 보내 모두 처리한다', async () => {
  const seen: number[] = [];
  let hit = false;
  await runEachWithRetry([1, 2, 3], async (n) => {
    if (n === 2 && !hit) { hit = true; throw limited(); }
    seen.push(n);
  }, { sleep: noSleep });
  assert.deepEqual(seen, [1, 2, 3]);
});

test('runEachWithRetry: 끝내 실패하면 몇 건까지 됐는지 알린다', async () => {
  const err = await runEachWithRetry([1, 2, 3], async (n) => { if (n === 3) throw limited(); }, { retries: 1, sleep: noSleep }).catch((e) => e);
  assert.ok(err instanceof PartialBatchError);
  assert.equal(err.done, 2);
  assert.equal(err.total, 3);
});
