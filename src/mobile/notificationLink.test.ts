import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mobileNotificationLink } from './notificationLink';

test('결재 알림은 문서 상세로, 일정 알림은 날짜를 유지해 이동한다', () => {
  assert.equal(mobileNotificationLink('/gw/approval?doc=DOC-123'), '/m/approval/DOC-123');
  assert.equal(mobileNotificationLink('/gw/calendar?date=2026-11-03'), '/m/calendar?date=2026-11-03');
  assert.equal(mobileNotificationLink('/gw/approval'), '/m/approval');
});
test('모바일 채팅 주소와 업무계획의 모바일 주소를 연결한다', () => {
  assert.equal(mobileNotificationLink('/m/room/ROOM-123'), '/m/room/ROOM-123');
  assert.equal(mobileNotificationLink('/gw/work-plan?date=2026-11-03'), '/m/task?date=2026-11-03');
});
test('문서 ID 안의 특수문자는 경로 구분자로 해석하지 않는다', () => {
  assert.equal(mobileNotificationLink('/gw/approval?doc=A%2FB'), '/m/approval/A%2FB');
});
test('비어 있거나 외부로 이동하는 링크는 거부한다', () => {
  for (const link of [null, undefined, '', '//other.test/m', 'https://other.test/m', 'javascript:alert(1)', '/outside']) {
    assert.equal(mobileNotificationLink(link), null);
  }
});
