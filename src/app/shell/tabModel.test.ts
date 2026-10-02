import assert from 'node:assert/strict';
import test from 'node:test';
import type { FlatScreen } from '@/shared/types/menu';
import { closeTab, syncTab, type ShellTab } from './tabModel';

const screen = (id: string, url: string): FlatScreen => ({
  id,
  name: id,
  url,
  moduleId: 'gw',
  moduleName: '그룹웨어',
  groupId: 'gw',
  groupName: '그룹웨어',
});

const approval = screen('gw:approval', '/gw/approval');
const calendar = screen('gw:calendar', '/gw/calendar');

test('처음 여는 화면은 주소 전체(쿼리 포함)를 기억한 탭으로 추가된다', () => {
  const tabs = syncTab([], screen('gw:approval', '/gw/approval/new'), '/gw/approval/new?type=휴가&date=2026-10-02');
  assert.equal(tabs.length, 1);
  assert.equal(tabs[0].href, '/gw/approval/new?type=휴가&date=2026-10-02');
});

test('같은 앱 안에서 이동하면 탭을 새로 만들지 않고 그 탭의 주소만 갱신한다', () => {
  const opened = syncTab(syncTab([], approval, '/gw/approval'), calendar, '/gw/calendar');
  const moved = syncTab(opened, screen('gw:approval', '/gw/approval/new'), '/gw/approval/new?type=외근');
  assert.deepEqual(moved.map((t) => t.id), ['gw:approval', 'gw:calendar']);
  assert.equal(moved[0].href, '/gw/approval/new?type=외근');
  assert.equal(moved[0].url, '/gw/approval/new');
});

test('주소가 그대로면 같은 배열을 돌려준다 (불필요한 재렌더 방지)', () => {
  const tabs = syncTab([], approval, '/gw/approval?doc=AP-1');
  assert.equal(syncTab(tabs, approval, '/gw/approval?doc=AP-1'), tabs);
});

test('활성 탭을 닫으면 오른쪽(없으면 왼쪽) 탭의 주소로 이동한다', () => {
  const tabs: ShellTab[] = syncTab(
    syncTab(syncTab([], approval, '/gw/approval'), calendar, '/gw/calendar?view=week'),
    screen('gw:board', '/gw/board'),
    '/gw/board',
  );
  assert.equal(closeTab(tabs, 'gw:approval', 'gw:approval').nextHref, '/gw/calendar?view=week');
  assert.equal(closeTab(tabs, 'gw:board', 'gw:board').nextHref, '/gw/calendar?view=week');
});

test('활성이 아닌 탭을 닫으면 이동하지 않는다', () => {
  const tabs = syncTab(syncTab([], approval, '/gw/approval'), calendar, '/gw/calendar');
  const r = closeTab(tabs, 'gw:calendar', 'gw:approval');
  assert.deepEqual(r.tabs.map((t) => t.id), ['gw:approval']);
  assert.equal(r.nextHref, null);
});

test('마지막 탭을 닫으면 탭이 비고 이동할 곳이 없다', () => {
  const r = closeTab(syncTab([], approval, '/gw/approval'), 'gw:approval', 'gw:approval');
  assert.deepEqual(r.tabs, []);
  assert.equal(r.nextHref, null);
});
