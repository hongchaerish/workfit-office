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

// ── 반차 (2026-11-13 확정: 반차 = 점심 없이 근무 4시간. 오전반차 13:30 출근, 오후반차 12:30 퇴근) ──

test('오전반차는 13:30까지 출근하면 지각이 아니고, 13:30~17:30 근무로 8시간이 인정된다', () => {
  const r = evalDay('13:30', '17:30', [leave('오전반차')]);
  assert.equal(r.status, 'normal');
  assert.equal(r.lateMin, 0);
  assert.equal(r.totalMin, 480);
});

test('오전반차인데 13:40에 출근하면 10분 지각이다(예전 12:30 기준 아님)', () => {
  const r = evalDay('13:40', '17:30', [leave('오전반차')]);
  assert.equal(r.status, 'late');
  assert.equal(r.lateMin, 10);
});

test('오후반차는 08:30~12:30 근무로 8시간이 인정된다 — 점심을 빼지 않는다', () => {
  const r = evalDay('08:30', '12:30', [leave('오후반차')]);
  assert.equal(r.status, 'normal');
  assert.equal(r.lateMin, 0);
  assert.equal(r.totalMin, 480);
});

test('오후반차인데 11:30에 퇴근하면 근무 3시간 + 반차 4시간 = 7시간', () => {
  const r = evalDay('08:30', '11:30', [leave('오후반차')]);
  assert.equal(r.totalMin, 420);
});

test('반차 날 출근해야 하는 시간대 — 오후반차 08:30~12:30, 오전반차 13:30~17:30', () => {
  assert.deepEqual(requiredWorkSpan(policy, [leave('오후반차')]), { start: 510, end: 750 });
  assert.deepEqual(requiredWorkSpan(policy, [leave('오전반차')]), { start: 810, end: 1050 });
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
  const r = evalDay('08:30', '12:30', [leave('반차')]);
  assert.equal(r.status, 'normal');
  assert.equal(r.totalMin, 480);
});

test('대체휴무도 단위가 반차면 반차 시간대 — 오전반차 단위는 13:30 출근', () => {
  const r = evalDay('13:30', '17:30', [leave('대체휴무', { leaveUnit: '오전반차' })]);
  assert.equal(r.status, 'normal');
  assert.equal(r.totalMin, 480);
  const q = evalDay('10:30', '17:30', [leave('대체휴무', { leaveUnit: '반반차', quarterSlot: 'AM1' })]);
  assert.equal(q.status, 'normal');
  assert.equal(q.lateMin, 0);
});

test('대체휴무 종일(단위 없음)은 종일 휴가', () => {
  const r = evalDay(null, null, [leave('대체휴무')]);
  assert.equal(r.status, 'leave');
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

test('종일 휴가·외근·출장 날은 출근해야 하는 시간대가 없다', () => {
  assert.equal(requiredWorkSpan(policy, [leave('연차')]), null);
  assert.equal(requiredWorkSpan(policy, [OUTSIDE]), null);
});

// ── 승인 휴가의 부재 시간대 (상태표시 등) ──

test('연차는 종일 휴가로, 반차는 해당 시간대로 돌려준다', () => {
  assert.deepEqual(approvedLeaveSpans(policy, [leave('연차')]), { fullDay: true, windows: [[510, 690], [750, 1050]] });
  assert.deepEqual(approvedLeaveSpans(policy, [leave('오전반차')]), { fullDay: false, windows: [[510, 810]] }); // 08:30~13:30 부재
  assert.deepEqual(approvedLeaveSpans(policy, [OUTSIDE]), { fullDay: false, windows: [] });
});

// ── 휴일근무: 휴일근무 신청 결재가 완료된 날만 인정 ──
const SAT = '2026-09-19'; // 토요일
const HOLIDAY_WORK: ApprovedLeaveInfo = { leaveType: '휴일근무', category: 'HOLIDAY_WORK', docId: 'AP-H' };
function evalSat(inHm: string | null, outHm: string | null, entries: ApprovedLeaveInfo[] = []) {
  const leaveMap = new Map<string, ApprovedLeaveInfo[]>();
  if (entries.length) leaveMap.set(SAT, entries);
  const t = (hm: string | null) => (hm ? `${SAT}T${hm}:00` : null);
  return evaluateCommuteRecord({ empId: 1, date: SAT, inAt: t(inHm), outAt: t(outHm) }, policy, leaveMap);
}

test('휴일근무: 승인 없이 주말에 출근하면 휴일근무가 아니라 휴무(태그 시각은 남김)', () => {
  const r = evalSat('09:00', '13:00');
  assert.equal(r.status, 'off');
  assert.ok(r.inAt && r.outAt);
});

test('휴일근무: 휴일근무 신청이 승인된 주말 출근은 휴일근무', () => {
  assert.equal(evalSat('09:00', '13:00', [HOLIDAY_WORK]).status, 'holiday_work');
});

test('휴일근무: 승인된 날은 태그가 없어도 휴일근무로 표시', () => {
  assert.equal(evalSat(null, null, [HOLIDAY_WORK]).status, 'holiday_work');
});

test('휴일근무: 주말에 한쪽 태그만 있어도 미기록으로 보지 않는다', () => {
  assert.equal(evalSat('09:00', null).status, 'off');
  assert.equal(evalSat('09:00', null, [HOLIDAY_WORK]).status, 'holiday_work');
});

test('휴일근무: 평일의 연장근로 승인은 근태 상태를 바꾸지 않는다', () => {
  assert.equal(evalDay('08:20', '20:00', [HOLIDAY_WORK]).status, 'normal');
});

// ── 반반차 시작 시각(30분 단위, 화면설계서 V5.8) ──

test('반반차 09:00 시작이면 09:00~11:00 부재 — 08:30 출근·11:00 복귀, 8시간 인정', () => {
  assert.deepEqual(approvedLeaveSpans(policy, [leave('반반차', { quarterStart: '09:00' })]).windows, [[540, 660]]);
  const r = evalDay('08:30', '17:30', [leave('반반차', { quarterStart: '09:00' })]);
  assert.equal(r.status, 'normal');
  assert.equal(r.totalMin, 480);
});

test('반반차 13:00 시작이면 그 사이 2시간만 부재', () => {
  assert.deepEqual(approvedLeaveSpans(policy, [leave('반반차', { quarterStart: '13:00' })]).windows, [[780, 900]]);
});

// ── 휴가로 채운 분(leaveMin) — 그래프가 휴가 색으로 나눠 그린다 ──
test('반차 날 leaveMin 은 반차 4시간, workedMin 은 실제 근무', () => {
  const r = evalDay('08:30', '12:30', [leave('오후반차')]);
  assert.deepEqual([r.leaveMin, r.workedMin, r.totalMin], [240, 240, 480]);
  const short = evalDay('08:30', '11:30', [leave('오후반차')]);
  assert.deepEqual([short.leaveMin, short.workedMin, short.totalMin], [240, 180, 420]);
});

test('8시간 상한에 걸려도 leaveMin 은 반차 4시간 그대로(합계 totalMin 만 8시간), 휴가 없는 날·외근 날은 없음', () => {
  const r = evalDay('08:30', '15:30', [leave('오후반차')]);
  assert.deepEqual([r.leaveMin, r.workedMin, r.totalMin], [240, 420, 480]); // 반차 날은 점심을 빼지 않아 7시간
  assert.equal(evalDay('08:30', '17:30').leaveMin, undefined);
  assert.equal(evalDay('08:30', '10:00', [OUTSIDE]).leaveMin, undefined);
});
