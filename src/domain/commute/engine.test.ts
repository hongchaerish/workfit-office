import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_COMMUTE_POLICY, type CommutePolicy } from '@/domain/commutePolicy/schema';
import { approvedLeaveSpans, evaluateCommuteRecord, requiredWorkSpan, type ApprovedLeaveInfo } from './engine';

// 회사 근무시간(2026-10 기준): 08:30~17:30, 점심 11:30~12:30
const policy: CommutePolicy = {
  ...DEFAULT_COMMUTE_POLICY,
  workStartTime: '08:30',
  workEndTime: '17:30',
  breakStartTime: '11:30',
  breakEndTime: '12:30',
  breakMin: 60,
  lateGraceMin: 0,
};

const D = '2026-09-17'; // 목요일(평일)
const at = (hm: string | null) => (hm ? `${D}T${hm}:00` : null);

function evalDay(inHm: string | null, outHm: string | null, entries: ApprovedLeaveInfo[] = []) {
  const leaveMap = new Map<string, ApprovedLeaveInfo[]>();
  if (entries.length) leaveMap.set(D, entries);
  return evaluateCommuteRecord({ empId: 1, date: D, inAt: at(inHm), outAt: at(outHm) }, policy, leaveMap);
}

const OUTSIDE: ApprovedLeaveInfo = { leaveType: '외근', category: 'OUTSIDE', docId: 'AP-O' };
const TRIP: ApprovedLeaveInfo = { leaveType: '국내출장', category: 'TRIP', docId: 'AP-T' };
const leave = (leaveType: string, extra: Partial<ApprovedLeaveInfo> = {}): ApprovedLeaveInfo => ({
  leaveType,
  category: 'LEAVE',
  docId: `AP-${leaveType}`,
  ...extra,
});

// ── 외근·출장 ──

test('외근 복귀 후 16:57에 출근을 찍어도 외근으로 처리되고 지각이 아니다', () => {
  const r = evalDay('16:57', '18:05', [OUTSIDE]);
  assert.equal(r.status, 'outside');
  assert.equal(r.lateMin, 0);
  assert.equal(r.totalMin, 480);
});

test('출장일에 태그가 없으면 출장으로 8시간 인정된다', () => {
  const r = evalDay(null, null, [TRIP]);
  assert.equal(r.status, 'trip');
  assert.equal(r.totalMin, 480);
});

test('결재가 없으면 08:39 출근은 9분 지각이다', () => {
  const r = evalDay('08:39', '19:22');
  assert.equal(r.status, 'late');
  assert.equal(r.lateMin, 9);
});

// ── 반차 (임시 규칙: 오후반차 11:30 퇴근, 오전반차 12:30 출근) ──

test('오전반차는 12:30까지 출근하면 지각이 아니다', () => {
  const r = evalDay('12:30', '17:30', [leave('오전반차')]);
  assert.equal(r.status, 'normal');
  assert.equal(r.lateMin, 0);
  assert.equal(r.totalMin, 480);
});

test('오전반차인데 12:40에 출근하면 10분 지각이다', () => {
  const r = evalDay('12:40', '17:30', [leave('오전반차')]);
  assert.equal(r.status, 'late');
  assert.equal(r.lateMin, 10);
});

test('오후반차는 08:30~11:30 근무로 8시간이 인정된다', () => {
  const r = evalDay('08:30', '11:30', [leave('오후반차')]);
  assert.equal(r.status, 'normal');
  assert.equal(r.lateMin, 0);
  assert.equal(r.totalMin, 480);
});

test('오후반차는 퇴근 태그가 없어도 정상 처리된다', () => {
  const r = evalDay('08:20', null, [leave('오후반차')]);
  assert.equal(r.status, 'normal');
  assert.equal(r.totalMin, 480);
});

test('오전반차는 출근 태그가 없어도 퇴근 태그만으로 정상 처리된다', () => {
  const r = evalDay(null, '17:35', [leave('오전반차')]);
  assert.equal(r.status, 'normal');
});

test('구버전 "반차"(오전/오후 구분 없음)는 오후반차로 본다', () => {
  const r = evalDay('08:30', '11:30', [leave('반차')]);
  assert.equal(r.status, 'normal');
  assert.equal(r.totalMin, 480);
});

// ── 반반차 (점심 제외 실근무 타임라인을 2시간씩 나눈 슬롯) ──

test('반반차 AM1(08:30~10:30)은 10:30까지 출근하면 지각이 아니다', () => {
  const r = evalDay('10:30', '17:30', [leave('반반차', { quarterSlot: 'AM1' })]);
  assert.equal(r.status, 'normal');
  assert.equal(r.lateMin, 0);
});

test('반반차 AM1인데 10:40에 출근하면 10분 지각이다', () => {
  const r = evalDay('10:40', '17:30', [leave('반반차', { quarterSlot: 'AM1' })]);
  assert.equal(r.status, 'late');
  assert.equal(r.lateMin, 10);
});

test('반반차 PM2(15:30~17:30)는 08:30~15:30 근무로 8시간이 인정된다', () => {
  const r = evalDay('08:30', '15:30', [leave('반반차', { quarterSlot: 'PM2' })]);
  assert.equal(r.status, 'normal');
  assert.equal(r.totalMin, 480);
});

// ── 같은 날 여러 결재 ──

test('외근과 오전반차가 같은 날이면 외근으로 처리하고 휴가명도 남긴다', () => {
  const r = evalDay('14:00', '17:40', [leave('오전반차'), OUTSIDE]);
  assert.equal(r.status, 'outside');
  assert.equal(r.lateMin, 0);
  assert.equal(r.leaveName, '오전반차');
});

// ── 근무시간 계산 ──

test('점심시간과 겹치는 만큼만 근무시간에서 뺀다', () => {
  assert.equal(evalDay('08:30', '12:00').totalMin, 180); // 11:30~12:00 30분 제외
  assert.equal(evalDay('08:30', '11:00').totalMin, 150); // 겹침 없음
  assert.equal(evalDay('08:30', '17:30').totalMin, 480);
});

test('기존 단일 객체 leaveMap 호출도 그대로 동작한다', () => {
  const leaveMap = new Map<string, ApprovedLeaveInfo>([[D, OUTSIDE]]);
  const r = evaluateCommuteRecord({ empId: 1, date: D, inAt: at('16:57'), outAt: at('18:05') }, policy, leaveMap);
  assert.equal(r.status, 'outside');
});

// ── 그날 출근해야 하는 시간대 (화면의 '퇴근 처리' 기준 등) ──

test('결재가 없는 날의 근무 시간대는 정책의 출퇴근 시각이다', () => {
  assert.deepEqual(requiredWorkSpan(policy, []), { start: 510, end: 1050 });
});

test('오후반차 날은 11:30에 근무가 끝난다', () => {
  assert.deepEqual(requiredWorkSpan(policy, [leave('오후반차')]), { start: 510, end: 690 });
});

test('오전반차 날은 12:30에 근무가 시작된다', () => {
  assert.deepEqual(requiredWorkSpan(policy, [leave('오전반차')]), { start: 750, end: 1050 });
});

test('종일 휴가·외근·출장 날은 출근해야 하는 시간대가 없다', () => {
  assert.equal(requiredWorkSpan(policy, [leave('연차')]), null);
  assert.equal(requiredWorkSpan(policy, [OUTSIDE]), null);
});

// ── 승인 휴가의 부재 시간대 (상태표시 등) ──

test('연차는 종일 휴가로, 반차는 해당 시간대로 돌려준다', () => {
  assert.deepEqual(approvedLeaveSpans(policy, [leave('연차')]), { fullDay: true, windows: [[510, 690], [750, 1050]] });
  assert.deepEqual(approvedLeaveSpans(policy, [leave('오전반차')]), { fullDay: false, windows: [[510, 690]] });
  assert.deepEqual(approvedLeaveSpans(policy, [OUTSIDE]), { fullDay: false, windows: [] });
});
