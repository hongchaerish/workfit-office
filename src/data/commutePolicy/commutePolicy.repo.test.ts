import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_COMMUTE_POLICY, type CommutePolicy } from '@/domain/commutePolicy/schema';
import type { CrudBackend } from '@/data/_backend/crudBackend';
import { createCommutePolicyRepo } from './commutePolicy.repo';

function fakeBackend(opts: { failSave?: boolean } = {}): CrudBackend<CommutePolicy> & { saved: CommutePolicy[] } {
  const saved: CommutePolicy[] = [];
  return {
    saved,
    async loadAll() {
      return saved;
    },
    async loadWithQueries() {
      return saved;
    },
    async save(item) {
      if (opts.failSave) throw new Error('401 unauthorized');
      saved.push(item);
    },
    async remove() {},
  };
}

test('DB 저장에 실패하면 저장이 실패로 끝난다 (성공처럼 보이지 않는다)', async () => {
  const repo = createCommutePolicyRepo(fakeBackend({ failSave: true }));
  await assert.rejects(repo.save({ ...DEFAULT_COMMUTE_POLICY, breakStartTime: '11:30' }), /401/);
});

test('DB 저장에 성공하면 저장한 정책을 DB에서 다시 읽는다', async () => {
  const backend = fakeBackend();
  const repo = createCommutePolicyRepo(backend);
  await repo.save({ ...DEFAULT_COMMUTE_POLICY, breakStartTime: '11:30', breakEndTime: '12:30' });
  const policy = await repo.getDefault();
  assert.equal(policy.breakStartTime, '11:30');
  assert.equal(backend.saved.length, 1);
});

test('저장 페이로드의 모든 필드가 Appwrite commutePolicies 컬렉션 속성에 있다', async () => {
  const { readFileSync } = await import('node:fs');
  const { commutePolicySchema } = await import('@/domain/commutePolicy/schema');
  const { COMMUTE_POLICY_STRIP_FIELDS } = await import('./commutePolicy.repo');
  const script = readFileSync('scripts/appwrite-provision-commute-policy.ts', 'utf8');
  const attrKeys = new Set([...script.matchAll(/key: '([A-Za-z]+)'/g)].map((m) => m[1]));
  const payloadKeys = Object.keys(commutePolicySchema.shape).filter((k) => !COMMUTE_POLICY_STRIP_FIELDS.includes(k));
  assert.deepEqual(payloadKeys.filter((k) => !attrKeys.has(k)), []);
});
