import assert from 'node:assert/strict';
import test from 'node:test';
import type { OutsideWorkDraft } from '@/domain/outsideWork/schema';
import { OutsideWorkError, outsideWorkRepo, type OutsideWorkActor } from './outsideWork.repo';

const owner: OutsideWorkActor = { userId: 'U011', active: true };
const other: OutsideWorkActor = { userId: 'U012', active: true };

const draft = (over: Partial<OutsideWorkDraft> = {}): OutsideWorkDraft => ({
  category: 'OUTSIDE',
  subType: '시간 외근',
  startDate: '2026-10-20',
  endDate: '2026-10-20',
  allDay: false,
  startTime: '13:00',
  endTime: '17:00',
  destination: 'OO전자',
  purpose: '견적 협의',
  companionUserIds: [],
  transportation: '',
  contact: '',
  memo: '',
  ...over,
});

test('본인이 등록·수정·삭제한다', async () => {
  const created = await outsideWorkRepo.create(owner, draft());
  assert.match(created.id, /^OW-20261020-\d{4}$/);
  assert.equal(created.ownerUserId, owner.userId);
  const updated = await outsideWorkRepo.update(owner, created.id, draft({ destination: 'XX전자' }));
  assert.equal(updated.destination, 'XX전자');
  await outsideWorkRepo.remove(owner, created.id);
  const left = await outsideWorkRepo.listAll({ from: '2026-10-01', to: '2026-10-31' });
  assert.equal(left.some((r) => r.id === created.id), false);
});

test('전원에게 보이지만 남의 기록은 고치거나 지울 수 없다', async () => {
  const created = await outsideWorkRepo.create(owner, draft({ startDate: '2026-10-21', endDate: '2026-10-21' }));
  const all = await outsideWorkRepo.listAll({ from: '2026-10-21', to: '2026-10-21' });
  assert.equal(all.some((r) => r.id === created.id), true);
  await assert.rejects(
    () => outsideWorkRepo.update(other, created.id, draft()),
    (e) => e instanceof OutsideWorkError && e.code === 'FORBIDDEN',
  );
  await assert.rejects(
    () => outsideWorkRepo.remove(other, created.id),
    (e) => e instanceof OutsideWorkError && e.code === 'FORBIDDEN',
  );
});

test('기간이 조회 범위와 겹치면 포함한다 (월을 걸친 출장)', async () => {
  const trip = await outsideWorkRepo.create(owner, draft({
    category: 'TRIP', subType: '국내출장', startDate: '2026-10-30', endDate: '2026-11-02',
    allDay: true, startTime: null, endTime: null, destination: '부산',
  }));
  const nov = await outsideWorkRepo.listAll({ from: '2026-11-01', to: '2026-11-30' });
  assert.equal(nov.some((r) => r.id === trip.id), true);
});

test('사용 중지 계정은 등록할 수 없다', async () => {
  await assert.rejects(
    () => outsideWorkRepo.create({ userId: 'U013', active: false }, draft()),
    (e) => e instanceof OutsideWorkError && e.code === 'FORBIDDEN',
  );
});

test('결재 건과 연결하면 목록에서 빠진다 — 본인만 연결할 수 있다', async () => {
  const created = await outsideWorkRepo.create(owner, draft({ startDate: '2026-11-03', endDate: '2026-11-04', destination: '연결 시험' }));
  await assert.rejects(outsideWorkRepo.link(other, created.id, 'AP-261103-001'), (e: unknown) => e instanceof OutsideWorkError && e.code === 'FORBIDDEN');
  assert.ok((await outsideWorkRepo.listAll({ from: '2026-11-03', to: '2026-11-03' })).some((w) => w.id === created.id));
  const linked = await outsideWorkRepo.link(owner, created.id, 'AP-261103-001');
  assert.equal(linked.linkedApprovalDocId, 'AP-261103-001');
  assert.equal((await outsideWorkRepo.listAll({ from: '2026-11-03', to: '2026-11-03' })).some((w) => w.id === created.id), false);
});
