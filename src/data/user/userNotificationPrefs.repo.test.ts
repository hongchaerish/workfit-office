import assert from 'node:assert/strict';
import test from 'node:test';
import { userRepo } from './user.repo';
import { DEFAULT_NOTIFICATION_PREFS } from '@/domain/notificationPrefs/schema';

test('알림 설정은 그 사람 계정 한 건만 읽어 돌려준다', async () => {
  const prefs = { ...DEFAULT_NOTIFICATION_PREFS, approval: false };
  await userRepo.saveNotificationPrefs('U012', prefs);
  assert.deepEqual(await userRepo.getNotificationPrefs('U012'), prefs);
});

test('없는 계정은 기본값(모두 받기)', async () => {
  assert.deepEqual(await userRepo.getNotificationPrefs('NOPE'), DEFAULT_NOTIFICATION_PREFS);
});

test('최근 접속시각은 그 칸만 고친다', async () => {
  const before = (await userRepo.listIncludingTestAccounts()).find((u) => u.id === 'U011')!;
  await userRepo.touchLastLogin('U011', '2026-11-16 09:00');
  const after = (await userRepo.listIncludingTestAccounts()).find((u) => u.id === 'U011')!;
  assert.equal(after.lastLogin, '2026-11-16 09:00');
  assert.equal(after.password, before.password);
});
