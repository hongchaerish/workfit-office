import assert from 'node:assert/strict';
import test from 'node:test';
import { withDeadline } from './deadline';

const never = () => new Promise<never>(() => undefined);

test('읽기는 멈춘 시도를 버리고 다시 시도해 성공한다', async () => {
  let calls = 0;
  const out = await withDeadline(() => (++calls === 1 ? never() : Promise.resolve('ok')), { timeoutMs: 20, attempts: 3 });
  assert.equal(out, 'ok');
  assert.equal(calls, 2);
});

test('모든 시도가 멈추면 시간 초과 오류를 낸다', async () => {
  let calls = 0;
  await assert.rejects(withDeadline(() => { calls += 1; return never(); }, { timeoutMs: 10, attempts: 2, label: 'listDocuments users' }), /시간 초과.*listDocuments users/);
  assert.equal(calls, 2);
});

test('쓰기(attempts 1)는 다시 보내지 않는다 — 실제로는 저장됐을 수 있다', async () => {
  let calls = 0;
  await assert.rejects(withDeadline(() => { calls += 1; return never(); }, { timeoutMs: 10, attempts: 1 }));
  assert.equal(calls, 1);
});

test('시간 초과가 아닌 오류(404 등)는 다시 시도하지 않고 그대로 던진다', async () => {
  let calls = 0;
  const notFound = Object.assign(new Error('not found'), { code: 404 });
  await assert.rejects(withDeadline(() => { calls += 1; return Promise.reject(notFound); }, { timeoutMs: 50, attempts: 3 }), (e: unknown) => e === notFound);
  assert.equal(calls, 1);
});

test('요청 전체 마감(until)을 넘기면 시도마다의 제한보다 먼저 끊고, 지난 뒤에는 보내지도 않는다', async () => {
  let calls = 0;
  const started = Date.now();
  await assert.rejects(withDeadline(() => { calls += 1; return never(); }, { timeoutMs: 5000, attempts: 3, until: Date.now() + 30 }), /시간 초과/);
  assert.ok(Date.now() - started < 1000);
  const before = calls;
  await assert.rejects(withDeadline(() => { calls += 1; return Promise.resolve('x'); }, { timeoutMs: 5000, attempts: 3, until: Date.now() - 1 }), /시간 초과/);
  assert.equal(calls, before);
});
