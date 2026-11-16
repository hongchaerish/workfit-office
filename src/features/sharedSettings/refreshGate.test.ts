import assert from 'node:assert/strict';
import test from 'node:test';
import { FOCUS_REFRESH_MIN_MS, shouldRefreshOnFocus } from './refreshGate';

test('창으로 돌아올 때 공용 설정은 마지막으로 읽은 지 1분이 지났을 때만 다시 읽는다', () => {
  const t0 = 1_800_000_000_000;
  assert.equal(FOCUS_REFRESH_MIN_MS, 60_000);
  assert.equal(shouldRefreshOnFocus(t0, t0 + 5_000), false);
  assert.equal(shouldRefreshOnFocus(t0, t0 + 59_000), false);
  assert.equal(shouldRefreshOnFocus(t0, t0 + 61_000), true);
  assert.equal(shouldRefreshOnFocus(0, t0), true);
});
