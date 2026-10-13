import assert from 'node:assert/strict';
import {
  getStoredSubstituteHolidays,
  saveSubstituteHolidayGrant,
  deleteSubstituteHolidayGrant,
  getSubstituteHolidaysForUser,
  _resetSubstituteHolidayStoreForTest,
} from './substituteHolidayStore';

export async function runSubstituteHolidayTests() {
  console.log('=== 대체휴무 저장소 (옵션 B: 시스템 프리셋 미지원) 단위 테스트 시작 ===\n');

  // Test 1
  await _resetSubstituteHolidayStoreForTest();
  {
    const list = getStoredSubstituteHolidays();
    assert.deepEqual(list, [], '1. 초기 상태에서는 시스템 기본 프리셋이 전혀 없어야 함');

    const userHolidays = getSubstituteHolidaysForUser('user-1', '홍길동');
    assert.deepEqual(userHolidays, [], '1. 사용자 대체휴무도 초기에는 0건이어야 함');
    console.log('✓ TEST 1 통과: 초기 상태 프리셋 없음 (완전 빈 배열 보장)');
  }

  // Test 2
  await _resetSubstituteHolidayStoreForTest();
  {
    await saveSubstituteHolidayGrant({
      targetScope: 'ALL',
      targetScopeLabel: '전체 임직원',
      occurrenceDate: '2026-08-17',
      expirationDate: '2027-08-17',
      days: 1.0,
      reason: '8/17 대체공휴일 특근',
      grantedBy: '관리자',
      grantedAt: '2026-09-14',
    });

    await saveSubstituteHolidayGrant({
      targetScope: 'ALL',
      targetScopeLabel: '전체 임직원',
      occurrenceDate: '2026-08-29',
      expirationDate: '2027-08-29',
      days: 1.0,
      reason: '8/29 토요 특근',
      grantedBy: '관리자',
      grantedAt: '2026-09-14',
    });

    const stored = getStoredSubstituteHolidays();
    assert.equal(stored.length, 2, '2. 2건 저장 확인');

    const heo = getSubstituteHolidaysForUser('68910001', '허진욱');
    assert.equal(heo.length, 2, '2. 허진욱 대리에게 2건 정상 부여 확인');
    assert.equal(heo[0].occurrenceDate, '2026-08-17');
    assert.equal(heo[0].days, 1.0);
    assert.equal(heo[1].occurrenceDate, '2026-08-29');
    assert.equal(heo[1].days, 1.0);

    const totalDays = heo.reduce((s, h) => s + h.days, 0);
    assert.equal(totalDays, 2.0, '2. 총 부여 대체휴무는 2일이어야 함');

    const kim = getSubstituteHolidaysForUser('user-kim', '김철수');
    assert.equal(kim.length, 2, '2. 다른 직원도 전사 대상이므로 2건 부여 확인');
    console.log('✓ TEST 2 통과: 전사(ALL) 대상 부여 시 8/17 및 8/29 특근 2일 정상 조회');
  }

  // Test 3
  await _resetSubstituteHolidayStoreForTest();
  {
    await saveSubstituteHolidayGrant({
      targetScope: ['허진욱'],
      targetScopeLabel: '허진욱',
      occurrenceDate: '2026-09-01',
      expirationDate: '2027-09-01',
      days: 1.0,
      reason: '특정 비상근무',
      grantedBy: '관리자',
      grantedAt: '2026-09-14',
    });

    const heo = getSubstituteHolidaysForUser('user-heo', '허진욱');
    assert.equal(heo.length, 1);
    assert.equal(heo[0].reason, '특정 비상근무');

    const other = getSubstituteHolidaysForUser('user-other', '이영희');
    assert.equal(other.length, 0, '3. 비대상자에게는 부여되지 않음');
    console.log('✓ TEST 3 통과: 특정 사원 지정 부여 및 비대상자 격리 확인');
  }

  // Test 4
  await _resetSubstituteHolidayStoreForTest();
  {
    const grant = await saveSubstituteHolidayGrant({
      targetScope: 'ALL',
      targetScopeLabel: '전체',
      occurrenceDate: '2026-08-17',
      expirationDate: '2027-08-17',
      days: 1.0,
      reason: '8/17 특근',
      grantedBy: '관리자',
      grantedAt: '2026-09-14',
    });

    assert.equal(getStoredSubstituteHolidays().length, 1);
    const ok = await deleteSubstituteHolidayGrant(grant.id);
    assert.equal(ok, true);
    assert.equal(getStoredSubstituteHolidays().length, 0);
    assert.equal(getSubstituteHolidaysForUser('u1', '아무개').length, 0);
    console.log('✓ TEST 4 통과: 관리자 회수/삭제 시 즉시 제거 확인');
  }

  // Test 5
  await _resetSubstituteHolidayStoreForTest();
  {
    await saveSubstituteHolidayGrant({
      targetScope: 'ALL',
      targetScopeLabel: '전체',
      occurrenceDate: '2026-08-29',
      expirationDate: '2027-08-29',
      days: 1.0,
      reason: '8/29 특근',
      grantedBy: '관리자',
      grantedAt: '2026-09-14',
    });

    await saveSubstituteHolidayGrant({
      targetScope: 'ALL',
      targetScopeLabel: '전체',
      occurrenceDate: '2026-08-17',
      expirationDate: '2027-08-17',
      days: 1.0,
      reason: '8/17 특근',
      grantedBy: '관리자',
      grantedAt: '2026-09-14',
    });

    const sorted = getSubstituteHolidaysForUser('u1', '직원');
    assert.equal(sorted[0].occurrenceDate, '2026-08-17', '5. 빠른 일자가 먼저 정렬되어야 FIFO 적용됨');
    assert.equal(sorted[1].occurrenceDate, '2026-08-29');
    console.log('✓ TEST 5 통과: 발생일자 기준 오름차순(FIFO) 자동 정렬 확인');
  }

  // Test 6: 입사일 기준 자동 제외 로직 검증 (입사일이 발생일보다 나중인 사람 제외)
  await _resetSubstituteHolidayStoreForTest();
  {
    // 8/17 특근 1일 등록 (전사)
    await saveSubstituteHolidayGrant({
      targetScope: 'ALL',
      targetScopeLabel: '전체 임직원',
      occurrenceDate: '2026-08-17',
      expirationDate: '2027-08-17',
      days: 1.0,
      reason: '8/17 대체공휴일 특근',
      grantedBy: '관리자',
      grantedAt: '2026-09-14',
    });

    // 8/29 특근 1일 등록 (전사)
    await saveSubstituteHolidayGrant({
      targetScope: 'ALL',
      targetScopeLabel: '전체 임직원',
      occurrenceDate: '2026-08-29',
      expirationDate: '2027-08-29',
      days: 1.0,
      reason: '8/29 토요 특근',
      grantedBy: '관리자',
      grantedAt: '2026-09-14',
    });

    // Case A: 8/17 이전 입사자 (예: 2026-01-01 입사) -> 8/17, 8/29 둘 다 부여 (2일)
    const existingEmp = getSubstituteHolidaysForUser('u-old', '기존사원', '2026-01-01');
    assert.equal(existingEmp.length, 2, 'Case A: 8/17 이전 입사자는 2일 모두 부여');

    // Case B: 8/17 당일 입사자 (2026-08-17 입사) -> 8/17, 8/29 둘 다 부여 (2일)
    const sameDayEmp = getSubstituteHolidaysForUser('u-same', '당일입사자', '2026-08-17');
    assert.equal(sameDayEmp.length, 2, 'Case B: 8/17 당일 입사자는 2일 모두 부여');

    // Case C: 8/17과 8/29 사이 입사자 (예: 2026-08-20 입사)
    // -> 8/17 특근은 미입사이므로 제외, 8/29 특근만 1일 부여
    const midEmp = getSubstituteHolidaysForUser('u-mid', '중간입사자', '2026-08-20');
    assert.equal(midEmp.length, 1, 'Case C: 8/20 입사자는 8/17 특근 제외, 8/29 특근만 부여');
    assert.equal(midEmp[0].occurrenceDate, '2026-08-29');

    // Case D: 8/29 이후 입사자 (예: 2026-09-01 입사)
    // -> 8/17 및 8/29 특근 둘 다 미입사이므로 0일 (완전 자동 제외)
    const newEmp = getSubstituteHolidaysForUser('u-new', '신규입사자', '2026-09-01');
    assert.equal(newEmp.length, 0, 'Case D: 9/1 신규입사자는 발생일 기준 미입사이므로 0일 부여');

    console.log('✓ TEST 6 통과: 입사일(hireDate > occurrenceDate) 기준 미입사자 자동 제외 완벽 검증');
  }

  console.log('\n🎉 대체휴무 저장소 모든 단위 테스트 성공 (6/6 Passed)!');
}

void runSubstituteHolidayTests();
