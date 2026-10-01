import assert from 'node:assert/strict';
import test from 'node:test';
import { attendeesOf, eventTypeOf, meetingReminderTargets } from './meeting.js';

const memoWith = (meta) => `회의록 링크\n[CAL_META:${JSON.stringify(meta)}]`;

test('메모의 CAL_META에서 회의 유형과 참석자를 읽는다', () => {
  const event = { ownerUserId: 'A', title: '주간 회의', memo: memoWith({ eventType: 'MEETING', attendeeUserIds: ['B', 'C'] }) };
  assert.equal(eventTypeOf(event), 'MEETING');
  assert.deepEqual(attendeesOf(event), ['B', 'C']);
});

test('회의 리마인더는 주최자 + 참석자만 (전사 공개여도 전원 아님)', () => {
  const event = { ownerUserId: 'A', title: 'x', visibility: 'COMPANY', memo: memoWith({ eventType: 'MEETING', attendeeUserIds: ['B', 'A'] }) };
  assert.deepEqual(meetingReminderTargets(event), ['A', 'B']);
});

test('회의가 아니면 null — 공개 범위 규칙을 따른다', () => {
  assert.equal(meetingReminderTargets({ ownerUserId: 'A', title: '병원', memo: '' }), null);
});

test('메타가 없는 예전 회의는 제목의 [회의]로 판정, 깨진 메타는 무시', () => {
  assert.equal(eventTypeOf({ title: '[회의] 예전 회의', memo: '' }), 'MEETING');
  assert.deepEqual(attendeesOf({ memo: '[CAL_META:{깨짐}]' }), []);
});
