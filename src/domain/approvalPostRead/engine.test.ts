import assert from 'node:assert/strict';
import test from 'node:test';
import { parseLegacyShares, postReadDocIdsFor, unreadPostReadDocIdsFor } from './engine';
import type { ApprovalPostReadShare } from './schema';

const s = (over: Partial<ApprovalPostReadShare>): ApprovalPostReadShare => ({
  id: 'prs-1', docId: 'D1', docNo: 'D1', docTitle: 't', fromUserId: 'ADM', fromUserName: '', toUserId: 'U1',
  toUserName: '', toUserDept: '', memo: '', sentAt: '2026-10-01T00:00:00.000Z', readAt: null, ...over,
});

test('postReadDocIdsFor: 해당 수신자 문서만, 중복 전달은 1건', () => {
  const shares = [s({ id: 'a' }), s({ id: 'b' }), s({ id: 'c', toUserId: 'U2', docId: 'D2' })];
  assert.deepEqual([...postReadDocIdsFor(shares, 'U1')], ['D1']);
});

test('unreadPostReadDocIdsFor: 하나라도 미확인이면 미확인 문서', () => {
  const shares = [s({ id: 'a', readAt: '2026-10-01T01:00:00.000Z' }), s({ id: 'b', docId: 'D2' })];
  assert.deepEqual([...unreadPostReadDocIdsFor(shares, 'U1')], ['D2']);
});

test('parseLegacyShares: 깨진 항목은 건너뛰고 나머지는 readAt=null 로 변환', () => {
  const out = parseLegacyShares([
    { id: 'prs-1', docId: 'D1', docNo: 'D1', docTitle: 't', fromUserId: 'ADM', fromUserName: '관리자', toUserId: 'U1',
      toUserName: '수신', toUserDept: '', memo: '', sentAt: '2026-09-01T00:00:00.000Z', isRead: false },
    { id: 'prs-2' },
    'garbage',
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].readAt, null);
  assert.equal('isRead' in out[0], false);
  assert.deepEqual(parseLegacyShares('not-array'), []);
});
