import assert from 'node:assert/strict';
import test from 'node:test';
import type { CalendarEvent } from './schema';
import {
  canJoinMeeting,
  findSimilarMeetings,
  isMeeting,
  meetingNotifyTargets,
  meetingReminderTargets,
  normalizeMeetingTitle,
} from './meeting';

const ev = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: 'CAL-20261001-0001',
  ownerUserId: 'A',
  title: '[회의] 주간 정기 회의',
  date: '2026-10-01',
  allDay: false,
  startTime: '10:00',
  endTime: '11:00',
  memo: '',
  visibility: 'COMPANY',
  eventType: 'MEETING',
  attendeeUserIds: ['B'],
  deptId: null,
  projectId: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  reminded: false,
  ...over,
});

test('normalizeMeetingTitle: [회의] 접두·공백·기호를 걷어낸다', () => {
  assert.equal(normalizeMeetingTitle('[회의]  주간 정기-회의!'), '주간정기회의');
  assert.equal(normalizeMeetingTitle('👥 [미팅] ABC 협의'), 'abc협의');
});

test('findSimilarMeetings: 같은 날·시간 겹침·제목 비슷한 회의만', () => {
  const events = [
    ev(),
    ev({ id: 'CAL-20261001-0002', title: '주간 회의', startTime: '13:00', endTime: '14:00' }), // 시간 안 겹침
    ev({ id: 'CAL-20261001-0003', title: '예산 검토', startTime: '10:30', endTime: '11:30' }), // 제목 다름
    ev({ id: 'CAL-20261002-0001', date: '2026-10-02' }), // 날짜 다름
    ev({ id: 'CAL-20261001-0004', eventType: 'GENERAL' }), // 회의 아님
  ];
  const found = findSimilarMeetings(events, { date: '2026-10-01', title: '주간 정기회의', allDay: false, startTime: '10:30', endTime: '11:00' });
  assert.deepEqual(found.map((e) => e.id), ['CAL-20261001-0001']);
});

test('findSimilarMeetings: 종일 회의는 시간과 무관하게 겹친다, 자기 자신은 제외', () => {
  const allDay = ev({ allDay: true, startTime: null, endTime: null });
  assert.equal(findSimilarMeetings([allDay], { date: '2026-10-01', title: '주간 정기 회의', allDay: false, startTime: '15:00', endTime: '16:00' }).length, 1);
  assert.equal(findSimilarMeetings([allDay], { date: '2026-10-01', title: '주간 정기 회의', allDay: true, startTime: null, endTime: null }, allDay.id).length, 0);
});

test('findSimilarMeetings: 한 글자 제목은 포함 관계로 비슷하다고 보지 않는다', () => {
  assert.equal(findSimilarMeetings([ev({ title: '회의 A' })], { date: '2026-10-01', title: 'A', allDay: false, startTime: '10:00', endTime: '11:00' }).length, 0);
});

test('canJoinMeeting: 주최자·이미 참석자·회의 아님은 합류 불가', () => {
  assert.equal(canJoinMeeting('C', ev()), true);
  assert.equal(canJoinMeeting('A', ev()), false);
  assert.equal(canJoinMeeting('B', ev()), false);
  assert.equal(canJoinMeeting('C', ev({ eventType: 'GENERAL' })), false);
  assert.equal(isMeeting(ev()), true);
});

test('알림 대상: 생성 알림은 참석자만, 리마인더는 주최자+참석자 (중복·주최자 중복 제거)', () => {
  const m = ev({ attendeeUserIds: ['B', 'C', 'B', 'A'] });
  assert.deepEqual(meetingNotifyTargets(m), ['B', 'C']);
  assert.deepEqual(meetingReminderTargets(m), ['A', 'B', 'C']);
});
