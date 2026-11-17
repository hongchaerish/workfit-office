import assert from 'node:assert/strict';
import test from 'node:test';
import { withRetry } from './retry';

test('다시 시도 — 중간에 성공하면 그 값, 끝까지 실패하면 마지막 오류', async () => {
  let n = 0;
  assert.equal(await withRetry(async () => (++n < 3 ? Promise.reject(new Error('잠깐 실패')) : 'ok'), [0, 0]), 'ok');
  assert.equal(n, 3);

  let m = 0;
  await assert.rejects(
    withRetry(async () => {
      m++;
      throw new Error(`실패 ${m}`);
    }, [0, 0]),
    /실패 3/,
  );
  assert.equal(m, 3, '처음 한 번 + 다시 두 번');
});
