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
