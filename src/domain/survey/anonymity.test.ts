import assert from 'node:assert/strict';
import test from 'node:test';
import { kstDayStamp, shuffle } from './anonymity';
import { surveyParticipationSchema } from '../surveyParticipation/schema';

test('kstDayStamp 는 KST 날짜의 00:00 을 UTC ISO 로 돌려준다', () => {
  // 2026-10-14 23:30 KST = 14:30Z → 2026-10-14 00:00 KST = 2026-10-13T15:00Z
  assert.equal(kstDayStamp(new Date('2026-10-14T14:30:00Z')), '2026-10-13T15:00:00.000Z');
  // 2026-10-15 00:10 KST = 2026-10-14T15:10Z → 2026-10-15 00:00 KST
  assert.equal(kstDayStamp(new Date('2026-10-14T15:10:00Z')), '2026-10-14T15:00:00.000Z');
});

test('shuffle 은 원소를 보존하고 원본을 바꾸지 않는다', () => {
  const src = [1, 2, 3, 4, 5];
  const out = shuffle(src, () => 0);
  assert.deepEqual([...out].sort(), [1, 2, 3, 4, 5]);
  assert.deepEqual(src, [1, 2, 3, 4, 5]);
  assert.notDeepEqual(out, src);
});

test('참여 기록에는 시각이 없다', () => {
  const row = surveyParticipationSchema.parse({ id: 'S1__U1', surveyId: 'S1', userId: 'U1', responded: true });
  assert.equal('respondedAt' in row, false);
});
