import assert from 'node:assert/strict';
import test from 'node:test';
import type { CalendarEventDraft } from '@/domain/calendarEvent/schema';
import { calendarEventRepo, type CalendarEventActor } from './calendarEvent.repo';
import { notificationRepo } from '@/data/notification/notification.repo';

const host: CalendarEventActor = { userId: 'U011', active: true };
const joiner: CalendarEventActor = { userId: 'U003', active: true };

const meeting = (over: Partial<CalendarEventDraft> = {}): CalendarEventDraft => ({
  title: '[회의] 주간 정기 회의',
  date: '2026-10-05',
  allDay: false,
  startTime: '10:00',
  endTime: '11:00',
  memo: '',
  visibility: 'COMPANY',
  eventType: 'MEETING',
  attendeeUserIds: ['U012'],
  deptId: null,
  projectId: null,
  ...over,
});

const inviteCount = async (userId: string) =>
  (await notificationRepo.list(userId)).filter((n) => n.title === '회의 참여 요청').length;

test('전사 공개 회의라도 생성 알림은 참석자에게만 간다', async () => {
  await calendarEventRepo.create(host, meeting());
  assert.equal(await inviteCount('U012'), 1);
  assert.equal(await inviteCount('U003'), 0); // 재직 중인 다른 직원
  assert.equal(await inviteCount('U011'), 0); // 주최자 본인
});

test('참석자로 합류: 본인만 추가되고 주최자에게 알린다, 다시 눌러도 그대로', async () => {
  const created = await calendarEventRepo.create(host, meeting({ title: '합류 테스트 회의', attendeeUserIds: [] }));
  const joined = await calendarEventRepo.joinAsAttendee(joiner, created.id);
  assert.deepEqual(joined.attendeeUserIds, ['U003']);
  assert.equal(joined.title, created.title);
  const again = await calendarEventRepo.joinAsAttendee(joiner, created.id);
  assert.deepEqual(again.attendeeUserIds, ['U003']);
  const hostNotis = (await notificationRepo.list('U011')).filter((n) => n.title === '회의 참석');
  assert.equal(hostNotis.length, 1);
});

test('주최자는 합류할 수 없고, 회의가 아닌 일정에는 합류할 수 없다', async () => {
  const created = await calendarEventRepo.create(host, meeting({ title: '주최자 합류 금지' }));
  await assert.rejects(calendarEventRepo.joinAsAttendee(host, created.id), /주최/);
  const general = await calendarEventRepo.create(host, meeting({ title: '일반 일정', eventType: 'GENERAL', attendeeUserIds: [] }));
  await assert.rejects(calendarEventRepo.joinAsAttendee(joiner, general.id), /회의/);
});

test('참석 취소: 본인만 빠진다', async () => {
  const created = await calendarEventRepo.create(host, meeting({ title: '취소 테스트', attendeeUserIds: ['U012', 'U003'] }));
  const left = await calendarEventRepo.leaveAsAttendee(joiner, created.id);
  assert.deepEqual(left.attendeeUserIds, ['U012']);
});

test('주최자가 참석자를 추가하면 새로 추가된 사람에게만 초대 알림', async () => {
  const before012 = await inviteCount('U012');
  const created = await calendarEventRepo.create(host, meeting({ title: '추가 초대 테스트' }));
  assert.equal(await inviteCount('U012'), before012 + 1);
  const before006 = await inviteCount('U006');
  await calendarEventRepo.update(host, created.id, meeting({ title: '추가 초대 테스트', attendeeUserIds: ['U012', 'U006'] }));
  assert.equal(await inviteCount('U006'), before006 + 1);
  assert.equal(await inviteCount('U012'), before012 + 1);
});
