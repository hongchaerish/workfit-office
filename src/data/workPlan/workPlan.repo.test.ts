import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkPlanDraft } from '@/domain/workPlan/schema';
import { WorkPlanError, workPlanRepo, type WorkPlanActor } from './workPlan.repo';

const owner: WorkPlanActor = { userId: 'U011', active: true };
const other: WorkPlanActor = { userId: 'U012', active: true };

const draft = (content: string): WorkPlanDraft => ({ date: '2026-08-27', content });

test('본인 계획을 생성·수정·삭제한다', async () => {
  const created = await workPlanRepo.create(owner, draft('영업 미팅'));
  assert.equal(created.ownerUserId, owner.userId);
  const updated = await workPlanRepo.update(owner, created.id, draft('영업 미팅(변경)'));
  assert.equal(updated.content, '영업 미팅(변경)');
  await workPlanRepo.remove(owner, created.id);
  assert.deepEqual(await workPlanRepo.list(owner, { from: '2026-08-01', to: '2026-08-31' }), []);
});

// 팀 월간표에서 서로의 칸을 채워 주는 운영 방식이라 남의 계획도 고칠 수 있다(2026-09-29 결정).
// 동시 편집은 expectedUpdatedAt 으로 막는다.
test('전체 보기는 다 보이고, 남의 계획도 고치거나 지울 수 있다', async () => {
  const mine = await workPlanRepo.create(owner, draft('내 계획'));
  const others = await workPlanRepo.create(other, draft('남의 계획'));

  const all = await workPlanRepo.listAll({ from: '2026-08-01', to: '2026-08-31' });
  assert.equal(all.some((row) => row.id === mine.id), true);
  assert.equal(all.some((row) => row.id === others.id), true);

  // 내 목록에는 본인 것만.
  const onlyMine = await workPlanRepo.list(owner, { from: '2026-08-01', to: '2026-08-31' });
  assert.equal(onlyMine.every((row) => row.ownerUserId === owner.userId), true);

  const edited = await workPlanRepo.update(other, mine.id, draft('대신 채움'));
  assert.equal(edited.content, '대신 채움');
  assert.equal(edited.ownerUserId, owner.userId);

  await assert.rejects(
    () => workPlanRepo.update(owner, mine.id, draft('늦은 저장'), mine.updatedAt),
    (error) => error instanceof WorkPlanError && error.code === 'CONFLICT',
  );

  await workPlanRepo.remove(other, mine.id);
  await workPlanRepo.remove(owner, others.id);
});

test('비활성 계정은 쓰기가 막히고 조회는 빈 목록이다', async () => {
  const inactive: WorkPlanActor = { userId: 'U099', active: false };
  await assert.rejects(() => workPlanRepo.create(inactive, draft('불가')));
  assert.deepEqual(await workPlanRepo.list(inactive), []);
});
