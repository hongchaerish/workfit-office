import assert from 'node:assert/strict';
import test from 'node:test';
import { approvalPostReadRepo } from './approvalPostRead.repo';
import { notificationRepo } from '@/data/notification/notification.repo';

const doc = { id: 'AP-T-001', docNo: 'AP-T-001', title: '테스트 기안' };
const base = { fromUserId: 'ADM', fromUserName: '관리자', toUserName: '수신', toUserDept: '개발팀', memo: '' };

test('share: 수신자·문서 기준으로 조회되고 다른 수신자 건은 섞이지 않는다', async () => {
  await approvalPostReadRepo.share({ ...base, doc, toUserId: 'R1' });
  await approvalPostReadRepo.share({ ...base, doc: { ...doc, id: 'AP-T-002', docNo: 'AP-T-002' }, toUserId: 'R2' });

  const r1 = await approvalPostReadRepo.listByRecipients(['R1']);
  assert.deepEqual(r1.map((s) => s.docId), ['AP-T-001']);
  assert.equal(r1[0].readAt, null);

  const both = await approvalPostReadRepo.listByRecipients(['R1', 'R2']);
  assert.equal(both.length, 2);

  const byDoc = await approvalPostReadRepo.listByDoc('AP-T-001');
  assert.deepEqual(byDoc.map((s) => s.toUserId), ['R1']);
});

test('share: 수신자에게 후열 알림 1건을 만든다', async () => {
  const { notified } = await approvalPostReadRepo.share({ ...base, doc: { ...doc, id: 'AP-T-003', docNo: 'AP-T-003' }, toUserId: 'R3' });
  assert.equal(notified, true);
  const notis = await notificationRepo.list('R3');
  assert.equal(notis.length, 1);
  assert.equal(notis[0].title, '후열 문서 전달');
  assert.equal(notis[0].linkUrl, '/gw/approval?doc=AP-T-003');
});

test('share: 본인에게 전달하거나 대상이 없으면 거부한다', async () => {
  await assert.rejects(approvalPostReadRepo.share({ ...base, doc, toUserId: 'ADM' }), /본인/);
  await assert.rejects(approvalPostReadRepo.share({ ...base, doc, toUserId: '' }), /대상자/);
});

test('markRead: 멱등 — 두 번째 호출이 readAt 을 바꾸지 않는다', async () => {
  const { share } = await approvalPostReadRepo.share({ ...base, doc: { ...doc, id: 'AP-T-004', docNo: 'AP-T-004' }, toUserId: 'R4' });
  const first = await approvalPostReadRepo.markRead(share.id);
  assert.ok(first?.readAt);
  await new Promise((r) => setTimeout(r, 5));
  const second = await approvalPostReadRepo.markRead(share.id);
  assert.equal(second?.readAt, first?.readAt);
  assert.equal(await approvalPostReadRepo.markRead('없는-id'), null);
});

test('importLegacy: 이미 있는 id 는 건너뛰고 알림을 만들지 않는다', async () => {
  const legacy = {
    id: 'prs-legacy-1', docId: 'AP-T-005', docNo: 'AP-T-005', docTitle: '레거시', fromUserId: 'ADM', fromUserName: '관리자',
    toUserId: 'R5', toUserName: '수신5', toUserDept: '', memo: '', sentAt: '2026-09-20T09:00:00.000Z', readAt: null,
  };
  const first = await approvalPostReadRepo.importLegacy([legacy]);
  assert.deepEqual(first, { imported: 1, skipped: 0, failed: 0 });
  const again = await approvalPostReadRepo.importLegacy([legacy]);
  assert.deepEqual(again, { imported: 0, skipped: 1, failed: 0 });
  assert.equal((await notificationRepo.list('R5')).length, 0);
  assert.equal((await approvalPostReadRepo.listByRecipients(['R5'])).length, 1);
});
