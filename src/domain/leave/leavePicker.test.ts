import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LEAVE_GROUPS,
  docValuesOf,
  leaveRange,
  leaveTimeOptions,
  pickerProblem,
  requestAmount,
  timeNotice,
  workDaysBetween,
  type LeavePick,
} from './leavePicker';

const day = { workStartTime: '08:30', workEndTime: '17:30', breakStartTime: '11:30', breakEndTime: '12:30' };
const holidays = [{ date: '2026-11-17', name: '시험 공휴일' }];

test('휴가 구분 7가지 — 화면설계서 순서', () => {
  assert.deepEqual(LEAVE_GROUPS.map((g) => g.name), ['연차', '반차', '반반차', '병가', '공가', '종일 대휴', '반일 대휴']);
});

test('시간대 — 반차는 부재 5시간(점심 1시간 포함, 사용 4시간): 오전 08:30~13:30, 오후 12:30~17:30 (2026-11-16 확정)', () => {
  assert.deepEqual(leaveRange({ type: 'am-half', start: '08:30' }, day), ['08:30', '13:30']);
  assert.deepEqual(leaveRange({ type: 'pm-half', start: '12:30' }, day), ['12:30', '17:30']);
  assert.deepEqual(leaveRange({ type: 'full', start: '08:30' }, day), ['08:30', '17:30']);
  assert.deepEqual(leaveRange({ type: 'comp-half', start: '08:30' }, day), ['08:30', '13:30']);
  assert.deepEqual(leaveRange({ type: 'comp-half', start: '12:30' }, day), ['12:30', '17:30']);
  assert.deepEqual(leaveRange({ type: 'pm-quarter', start: '15:30' }, day), ['15:30', '17:30']);
});

test('반반차 시작 시각 — 오전 08:30·09:00·09:30, 오후 12:30~15:30 (30분 단위)', () => {
  assert.deepEqual(leaveTimeOptions('am-quarter', day), ['08:30', '09:00', '09:30']);
  assert.deepEqual(leaveTimeOptions('pm-quarter', day), ['12:30', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30']);
  assert.deepEqual(leaveTimeOptions('comp-half', day), ['08:30', '12:30']);
  assert.deepEqual(leaveTimeOptions('am-half', day), ['08:30']);
  assert.deepEqual(leaveTimeOptions('pm-half', day), ['12:30']);
});

test('근무일 수 — 주말·공휴일 제외', () => {
  assert.equal(workDaysBetween('2026-11-13', '2026-11-18', holidays), 3); // 금, 월, (화 공휴일), 수
  assert.equal(workDaysBetween('2026-11-14', '2026-11-15', holidays), 0);
});

test('신청량 — 연차는 일, 대휴는 분', () => {
  const bal = { annualDays: 2.5, substituteMin: 1250 };
  assert.deepEqual(requestAmount({ type: 'full', start: '08:30' }, '2026-11-13', '2026-11-16', holidays, bal), { category: '연차', amount: 2, unit: '일', available: 2.5 });
  assert.deepEqual(requestAmount({ type: 'am-quarter', start: '09:00' }, '2026-11-13', '2026-11-13', holidays, bal)?.amount, 0.25);
  assert.deepEqual(requestAmount({ type: 'comp-full', start: '08:30' }, '2026-11-13', '2026-11-16', holidays, bal), { category: '대체휴무', amount: 960, unit: '분', available: 1250 });
  assert.equal(requestAmount({ type: 'comp-half', start: '12:30' }, '2026-11-13', '2026-11-13', holidays, bal)?.amount, 240);
  assert.equal(requestAmount({ type: 'sick', start: '08:30' }, '2026-11-13', '2026-11-13', holidays, bal), null);
});

test('막는 경우 — 근무일 없음, 여러 날 반차, 잔여 부족', () => {
  const bal = { annualDays: 1, substituteMin: 300 };
  assert.equal(pickerProblem(null, '2026-11-14', '2026-11-15', holidays, bal), '휴가를 사용할 근무일이 없습니다.');
  assert.equal(pickerProblem({ type: 'am-half', start: '08:30' }, '2026-11-13', '2026-11-16', holidays, bal), '연속 날짜 신청은 종일 휴가만 가능합니다. 반차·반반차·반일 대휴는 하루씩 신청해 주세요.');
  assert.equal(pickerProblem({ type: 'full', start: '08:30' }, '2026-11-13', '2026-11-16', holidays, bal), '연차 잔여 1일보다 신청 2일이 많습니다.');
  assert.equal(pickerProblem({ type: 'comp-full', start: '08:30' }, '2026-11-13', '2026-11-13', holidays, bal), '대체휴무 잔여 5시간보다 신청 8시간이(가) 많습니다.');
  assert.equal(pickerProblem({ type: 'comp-half', start: '08:30' }, '2026-11-13', '2026-11-13', holidays, bal), '');
});

test('안내 문구 — 화면설계서(오후반차는 사용자 정정)', () => {
  assert.equal(timeNotice({ type: 'am-half', start: '08:30' }, day), '13:30 출근 · 12:30~13:30 휴게');
  assert.equal(timeNotice({ type: 'pm-half', start: '12:30' }, day), '12:30 퇴근 · 오전 4시간 근무');
  assert.equal(timeNotice({ type: 'am-quarter', start: '09:30' }, day), '점심 후 12:30 업무 복귀');
  assert.equal(timeNotice({ type: 'am-quarter', start: '08:30' }, day), '10:30 업무 복귀');
  assert.equal(timeNotice({ type: 'pm-quarter', start: '15:30' }, day), '15:30 퇴근');
  assert.equal(timeNotice({ type: 'pm-quarter', start: '13:00' }, day), '15:00 업무 복귀');
  assert.equal(timeNotice({ type: 'full', start: '08:30' }, day), '종일 사용 시간 자동 선택 · 점심시간 1시간 제외');
});

test('문서 값 — 휴가종류·기간·시각·대체휴무 단위·반반차 시작', () => {
  const v = (p: LeavePick, a = '2026-11-13', b = a) => docValuesOf(p, a, b, day, holidays);
  assert.deepEqual(v({ type: 'pm-half', start: '12:30' }), { leaveType: '오후반차', period: '2026-11-13', period__end: '2026-11-13', startTime: '12:30', endTime: '17:30', leaveUnit: '', quarterStart: '', days: 0.5 });
  assert.deepEqual([v({ type: 'am-half', start: '08:30' }).startTime, v({ type: 'am-half', start: '08:30' }).endTime, v({ type: 'am-half', start: '08:30' }).days], ['08:30', '13:30', 0.5]);
  assert.equal(v({ type: 'comp-half', start: '08:30' }).leaveType, '대체휴무');
  assert.equal(v({ type: 'comp-half', start: '08:30' }).leaveUnit, '오전반차');
  assert.equal(v({ type: 'comp-half', start: '12:30' }).leaveUnit, '오후반차');
  assert.equal(v({ type: 'comp-full', start: '08:30' }, '2026-11-13', '2026-11-16').leaveUnit, '종일');
  assert.equal(v({ type: 'comp-full', start: '08:30' }, '2026-11-13', '2026-11-16').days, 2);
  assert.equal(v({ type: 'am-quarter', start: '09:00' }).quarterStart, '09:00');
  assert.equal(v({ type: 'am-quarter', start: '09:00' }).leaveType, '반반차');
  assert.equal(v({ type: 'official', start: '08:30' }).leaveType, '공가');
});

test('운영 휴게 12:00~13:00 이어도 반차는 오전 08:30~13:30·오후 12:30~17:30 (사용자 확정)', () => {
  const prod = { ...day, breakStartTime: '12:00', breakEndTime: '13:00' };
  assert.deepEqual(leaveRange({ type: 'am-half', start: '08:30' }, prod), ['08:30', '13:30']);
  assert.deepEqual(leaveRange({ type: 'pm-half', start: '12:30' }, prod), ['12:30', '17:30']);
  assert.equal(timeNotice({ type: 'am-half', start: '08:30' }, prod), '13:30 출근 · 12:30~13:30 휴게');
  assert.equal(timeNotice({ type: 'pm-half', start: '12:30' }, prod), '12:30 퇴근 · 오전 4시간 근무');
  assert.deepEqual(leaveTimeOptions('comp-half', prod), ['08:30', '12:30']);
  assert.deepEqual(leaveRange({ type: 'comp-half', start: '12:30' }, prod), ['12:30', '17:30']);
  assert.deepEqual(leaveTimeOptions('am-quarter', prod), ['08:30', '09:00', '09:30', '10:00']);
  assert.deepEqual(leaveTimeOptions('pm-quarter', prod), ['13:00', '13:30', '14:00', '14:30', '15:00', '15:30']);
  assert.deepEqual(leaveRange({ type: 'comp-half', start: '08:30' }, prod), ['08:30', '13:30']);
});
