import assert from 'node:assert/strict';
import test from 'node:test';
import type { ProjectAccessContext } from '@/domain/workProject/engine';
import { WbsDomainError } from '@/domain/workTask/engine';
import type { WorkProject, WorkProjectDraft } from '@/domain/workProject/schema';
import type { WorkTaskDraft } from '@/domain/workTask/schema';
import { workProjectRepo } from '@/data/workProject/workProject.repo';
import { workTrackRepo } from '@/data/workTrack/workTrack.repo';
import { workTaskRepo } from './workTask.repo';

const owner: ProjectAccessContext = { userId: 'U011', deptId: 'D240', active: true };
const member: ProjectAccessContext = { userId: 'U012', deptId: 'D240', active: true };
const outsider: ProjectAccessContext = { userId: 'U008', deptId: 'D220', active: true };

const projectDraft = (code: string): WorkProjectDraft => ({
  code,
  name: '과업 저장소 테스트',
  description: '',
  ownerUserId: owner.userId,
  memberUserIds: [owner.userId, member.userId],
  deptId: owner.deptId,
  visibility: 'PRIVATE',
  status: 'PLANNING',
  projectType: 'INTERNAL',
  fundingType: null,
  clientName: null,
  contractNo: null,
  contractStartAt: null,
  contractEndAt: null,
  startAt: '2026-08-12T00:00:00.000Z',
  dueAt: '2026-08-31T14:59:59.999Z',
  color: '#16a394',
  chatRoomId: null,
});

const project: WorkProject = await workProjectRepo.create(owner, projectDraft('LOCAL-WBS-TEST'));

const draft: WorkTaskDraft = {
  projectId: project.id,
  trackId: null,
  parentId: null,
  title: 'WBS 저장소 테스트',
  description: '',
  assigneeUserId: member.userId,
  startAt: '2026-08-15T00:00:00.000Z',
  dueAt: '2026-08-16T14:59:59.999Z',
  status: 'TODO',
  progress: 0,
};

test('접근 가능한 프로젝트의 과업만 트리 순서로 조회한다', async () => {
  const tree = await workProjectRepo.create(owner, projectDraft('LOCAL-WBS-TREE'));
  const add = (title: string, parentId: string | null = null) =>
    workTaskRepo.create(owner, { ...draft, projectId: tree.id, parentId, title });
  await add('첫째');
  const second = await add('둘째');
  await add('둘째-1', second.id);
  await add('둘째-2', second.id);
  await add('셋째');

  const rows = await workTaskRepo.list(member, tree.id);
  // path 오름차순 하나로 부모 바로 밑에 자식이 오고 형제는 순번대로 온다.
  assert.deepEqual(rows.map((row) => row.path), ['0000', '0001', '0001.0000', '0001.0001', '0002']);
  assert.deepEqual(rows.map((row) => row.level), [1, 1, 2, 2, 1]);
  assert.deepEqual(await workTaskRepo.list(outsider, tree.id), []);
});

test('트랙이 있는 프로젝트는 트랙별로 묶여 나온다', async () => {
  const tracked = await workProjectRepo.create(owner, projectDraft('LOCAL-WBS-TRACK'));
  const tracks = await workTrackRepo.seedDefaults(owner, tracked.id);
  // 트랙을 섞어서 만들어도 조회는 트랙별로 묶여야 한다.
  for (const track of [...tracks].reverse()) {
    await workTaskRepo.create(owner, { ...draft, projectId: tracked.id, trackId: track.id });
  }

  const rows = await workTaskRepo.list(member, tracked.id);
  const trackIds = rows.map((row) => row.trackId);
  // 같은 트랙끼리 붙어 있어야 화면이 트랙 단위로 끊어 그릴 수 있다.
  assert.deepEqual(trackIds, [...trackIds].sort((a, b) => (a ?? '').localeCompare(b ?? '')));
  // path 는 트랙 그룹 안에서만 유일하다 — 트랙이 다르면 같은 경로가 나올 수 있다.
  assert.equal(rows.filter((row) => row.path === '0000').length, 3);
});

test('프로젝트 참여자가 작업을 만들고 작성자가 수정·삭제한다', async () => {
  const created = await workTaskRepo.create(member, draft);
  assert.equal(created.createdBy, member.userId);
  assert.equal(created.assigneeUserId, member.userId);

  const updated = await workTaskRepo.update(member, created.id, { ...draft, title: '수정된 WBS 작업' }, created.version);
  assert.equal(updated.title, '수정된 WBS 작업');
  const removed = await workTaskRepo.remove(member, updated.id, updated.version);
  assert.equal(removed.id, created.id);
});

test('담당자는 본인 작업의 진척률을 변경하되 상세는 수정할 수 없다', async () => {
  // 작성자는 소유자, 담당자는 참여자 — 담당자는 진척률만 바꿀 수 있다.
  const current = await workTaskRepo.create(owner, { ...draft, title: '담당 작업' });
  const progressed = await workTaskRepo.setProgress(member, current.id, 40, current.version);
  assert.equal(progressed.status, 'IN_PROGRESS');
  assert.equal(progressed.progress, 40);

  await assert.rejects(
    () => workTaskRepo.update(member, progressed.id, {
      projectId: progressed.projectId,
      trackId: progressed.trackId,
      parentId: progressed.parentId,
      title: '권한 없는 수정',
      description: progressed.description,
      assigneeUserId: progressed.assigneeUserId,
      startAt: progressed.startAt,
      dueAt: progressed.dueAt,
      status: progressed.status,
      progress: progressed.progress,
    }, progressed.version),
    (error) => error instanceof WbsDomainError && error.code === 'FORBIDDEN',
  );
});

test('프로젝트 외 담당자와 오래된 version을 차단한다', async () => {
  await assert.rejects(
    () => workTaskRepo.create(owner, { ...draft, assigneeUserId: outsider.userId }),
    (error) => error instanceof WbsDomainError && error.code === 'INVALID_ASSIGNEE',
  );
  const current = await workTaskRepo.create(owner, { ...draft, title: '버전 검사 작업' });
  await assert.rejects(
    () => workTaskRepo.setProgress(owner, current.id, 70, current.version + 1),
    (error) => error instanceof WbsDomainError && error.code === 'VERSION_CONFLICT',
  );
  await assert.rejects(
    () => workTaskRepo.setProgress(outsider, current.id, 70, current.version + 1),
    (error) => error instanceof WbsDomainError && error.code === 'FORBIDDEN',
  );
});
