import assert from 'node:assert/strict';
import test from 'node:test';
import { layoutWeekBars } from './weekBars';

const week = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'];

test('여러 날 일정은 그 주 안에서 시작 칸·칸 수로 펼친다', () => {
  const [bar] = layoutWeekBars([{ key: 'a', startDate: '2026-10-20', endDate: '2026-10-22' }], week);
  assert.deepEqual(bar, { key: 'a', lane: 0, startIndex: 1, span: 3, continuesBefore: false, continuesAfter: false });
});

test('주를 넘는 일정은 이번 주 부분만, 앞뒤로 이어짐을 표시한다', () => {
  const [bar] = layoutWeekBars([{ key: 'a', startDate: '2026-10-15', endDate: '2026-10-28' }], week);
  assert.deepEqual(bar, { key: 'a', lane: 0, startIndex: 0, span: 7, continuesBefore: true, continuesAfter: true });
});

test('하루짜리와 이번 주에 없는 일정은 막대로 그리지 않는다', () => {
  assert.deepEqual(layoutWeekBars([
    { key: 'one', startDate: '2026-10-20', endDate: '2026-10-20' },
    { key: 'gone', startDate: '2026-10-01', endDate: '2026-10-03' },
  ], week), []);
});

test('겹치는 막대는 다른 줄로, 안 겹치면 같은 줄을 다시 쓴다', () => {
  const bars = layoutWeekBars([
    { key: 'a', startDate: '2026-10-19', endDate: '2026-10-21' },
    { key: 'b', startDate: '2026-10-20', endDate: '2026-10-23' },
    { key: 'c', startDate: '2026-10-22', endDate: '2026-10-24' },
  ], week);
  assert.deepEqual(bars.map((b) => [b.key, b.lane]), [['a', 0], ['b', 1], ['c', 0]]);
});
