import assert from 'node:assert/strict';
import test from 'node:test';
import { birthdaysOn, birthdayUserIds, describeBirthday, isBirthdayOn, nextSolarBirthday, solarBirthdayInYear } from './engine';

test('양력 생일은 그해 같은 날', () => {
  assert.equal(solarBirthdayInYear({ birthDate: '1990-03-05' }, 2026), '2026-03-05');
});

test('2월 29일생은 평년에 2월 28일', () => {
  assert.equal(solarBirthdayInYear({ birthDate: '1992-02-29' }, 2026), '2026-02-28');
  assert.equal(solarBirthdayInYear({ birthDate: '1992-02-29' }, 2028), '2028-02-29');
});

test('음력 생일은 그해 양력으로 바꾼다 (설날·추석으로 확인)', () => {
  // 2026년 설날(음력 1/1) = 양력 2/17, 추석(음력 8/15) = 양력 9/25
  assert.equal(solarBirthdayInYear({ birthDate: '1985-01-01', birthLunar: true }, 2026), '2026-02-17');
  assert.equal(solarBirthdayInYear({ birthDate: '1985-08-15', birthLunar: true }, 2026), '2026-09-25');
  // 2025년 추석 = 양력 10/6
  assert.equal(solarBirthdayInYear({ birthDate: '1985-08-15', birthLunar: true }, 2025), '2025-10-06');
});

test('음력 30일이 없는 해(작은달)는 29일로 본다', () => {
  const results = [2024, 2025, 2026, 2027, 2028].map((y) => solarBirthdayInYear({ birthDate: '1980-01-30', birthLunar: true }, y));
  assert.equal(results.every(Boolean), true);
});

test('음력 12월생은 양력 다음 해 초에 생일이 올 수 있다', () => {
  // 음력 2025-12-20 → 양력 2026년 2월 초
  const solar = solarBirthdayInYear({ birthDate: '1970-12-20', birthLunar: true }, 2025)!;
  assert.equal(solar.startsWith('2026-'), true);
  assert.equal(isBirthdayOn({ birthDate: '1970-12-20', birthLunar: true }, solar), true);
});

test('다음 생일은 기준일 포함 가장 가까운 날', () => {
  assert.equal(nextSolarBirthday({ birthDate: '1990-03-05' }, '2026-03-05'), '2026-03-05');
  assert.equal(nextSolarBirthday({ birthDate: '1990-03-05' }, '2026-03-06'), '2027-03-05');
});

test('생년월일이 없거나 잘못되면 null', () => {
  assert.equal(solarBirthdayInYear({ birthDate: '' }, 2026), null);
  assert.equal(solarBirthdayInYear({ birthDate: '1990-04-31' }, 2026), null);
  assert.equal(solarBirthdayInYear({ birthDate: undefined }, 2026), null);
});

test('그날 생일자 중 비공개는 뺀다', () => {
  const people = [
    { id: 'a', birthDate: '1990-10-15' },
    { id: 'b', birthDate: '1991-10-15', birthdayPublic: false },
    { id: 'c', birthDate: '1992-10-16' },
  ];
  assert.deepEqual(birthdaysOn(people, '2026-10-15').map((p) => p.id), ['a']);
});

test('표시 문구', () => {
  assert.equal(describeBirthday({ birthDate: '1990-03-05' }, '2026-10-15'), '양력 3월 5일');
  assert.equal(describeBirthday({ birthDate: '1985-08-15', birthLunar: true }, '2026-10-15'), '음력 8월 15일 (올해 양력 9월 25일)');
});

test('오늘 생일인 재직자 id — 비공개·생년월일 없음·사용 중이 아닌 계정은 뺀다', () => {
  const people = [
    { userId: 'A', birthDate: '1990-10-15' },
    { userId: 'B', birthDate: '1990-10-15', birthdayPublic: false },
    { userId: 'C', birthDate: null },
    { userId: 'D', birthDate: '1988-10-15' },
    { userId: 'E', birthDate: '1985-09-05', birthLunar: true }, // 음력 9/5 → 2026 양력 10/15
  ];
  assert.deepEqual([...birthdayUserIds(people, new Set(['A', 'B', 'C', 'E']), '2026-10-15')].sort(), ['A', 'E']);
});
