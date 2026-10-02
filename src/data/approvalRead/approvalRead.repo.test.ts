import assert from 'node:assert/strict';
import test from 'node:test';
import { approvalReadRepo } from './approvalRead.repo';

test('읽음으로 기록한 문서는 그 사람의 읽음 목록에만 나온다', async () => {
  await approvalReadRepo.markRead('U-A', ['AP-1', 'AP-2']);
  await approvalReadRepo.markRead('U-B', ['AP-3']);
  const a = await approvalReadRepo.readState('U-A');
  assert.deepEqual([...a.readDocIds].sort(), ['AP-1', 'AP-2']);
  assert.deepEqual([...(await approvalReadRepo.readState('U-B')).readDocIds], ['AP-3']);
});

test('이미 읽은 문서를 다시 기록해도 처음 읽은 시각이 바뀌지 않는다 (한 번 읽으면 끝)', async () => {
  await approvalReadRepo.markRead('U-C', ['AP-9'], new Date('2026-10-01T09:00:00Z'));
  await approvalReadRepo.markRead('U-C', ['AP-9'], new Date('2026-10-02T09:00:00Z'));
  const rows = await approvalReadRepo.rowsOf('U-C');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].readAt, '2026-10-01T09:00:00.000Z');
});

test('처음 적용 기준선을 남기면 이후 다시 하지 않도록 표시된다', async () => {
  assert.equal((await approvalReadRepo.readState('U-D')).hasBaseline, false);
  await approvalReadRepo.applyBaseline('U-D', ['AP-5']);
  const s = await approvalReadRepo.readState('U-D');
  assert.equal(s.hasBaseline, true);
  assert.deepEqual([...s.readDocIds], ['AP-5']); // 기준선 표시 행은 문서로 세지 않는다
});

test('같은 문서를 동시에 기록해 "이미 존재(409)"가 나도 실패로 보지 않는다', async () => {
  const { createApprovalReadRepo } = await import('./approvalRead.repo');
  const saved: string[] = [];
  const conflictBackend = {
    async loadAll() { return []; },
    async loadWithQueries() { return []; },
    async save(item: { docId: string }) {
      saved.push(item.docId);
      throw Object.assign(new Error('Document with the requested ID already exists'), { code: 409 });
    },
    async remove() {},
  };
  const repo = createApprovalReadRepo(conflictBackend as never);
  await repo.markRead('U-E', ['AP-7']);
  assert.deepEqual(saved, ['AP-7']);
});
