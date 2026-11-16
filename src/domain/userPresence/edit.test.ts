import assert from 'node:assert/strict';
import test from 'node:test';
import { presencePatch } from './edit';
import { resolvePresence } from './resolve';
import { DEFAULT_COMMUTE_POLICY } from '@/domain/commutePolicy/schema';

const NOW = '2026-11-16T01:05:00.000Z';
const stored = { status: 'ONLINE' as const, message: '', updatedAt: '', lastSeenAt: null };

test('연차 날 상태만 바꾸면 화면에 보이던 "연차"가 아니라 본인 메시지가 저장된다', () => {
  assert.deepEqual(presencePatch({ shownStatus: 'LEAVE', stored, status: 'ONLINE', nowIso: NOW }), { status: 'ONLINE', message: '', updatedAt: NOW });
  assert.deepEqual(
    presencePatch({ shownStatus: 'OUTSIDE', stored: { ...stored, message: '몰입' }, status: 'FOCUS', nowIso: NOW }),
    { status: 'FOCUS', message: '몰입', updatedAt: NOW },
  );
});

test('지금 보이는 상태 그대로 메시지만 저장하면 메시지만 바뀐다 (자동 상태를 직접 설정으로 굳히지 않음)', () => {
  assert.deepEqual(presencePatch({ shownStatus: 'LEAVE', stored, status: 'LEAVE', message: ' 오후 복귀 ', nowIso: NOW }), { message: '오후 복귀' });
});

test('상태와 메시지를 함께 정하면 둘 다 저장한다', () => {
  assert.deepEqual(presencePatch({ shownStatus: 'ONLINE', stored, status: 'OFFLINE', message: '퇴근', nowIso: NOW }), { status: 'OFFLINE', message: '퇴근', updatedAt: NOW });
});

test('연차 날 상태를 바꾼 뒤 다음 날에는 "연차"가 남지 않는다', () => {
  const patch = presencePatch({ shownStatus: 'LEAVE', stored, status: 'ONLINE', nowIso: NOW });
  const next = new Date('2026-11-17T10:00:00+09:00');
  const r = resolvePresence({
    stored: { ...stored, ...patch, lastSeenAt: next.toISOString(), lastActiveAt: next.toISOString() },
    approvalDays: new Map(), meetings: [], policy: DEFAULT_COMMUTE_POLICY, now: next,
  });
  assert.equal(r.message, '');
});
