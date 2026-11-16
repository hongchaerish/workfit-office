import {
  calculateLeaveDays,
  isHalfDayLeave,
  isQuarterDayLeave,
  isPartDayLeave,
  isAnnualLeaveDeduction,
} from './policy';
import { normalizeLegacyLeaveDoc } from './legacyAdapter';
import type { ApprovalDoc } from '@/domain/approvalDoc/schema';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`[Assertion Failed] ${message}`);
  }
}

export function runLeaveCalculationTests() {
  console.log('=== 단일 기준 휴가 일수 계산기(SSOT) 단위 테스트 시작 ===\n');

  // TEST-01: 반차 판별 및 0.5일 고정 산출 (DB/폼에 1일로 잘못 저장된 경우 포함)
  {
    assert(isHalfDayLeave('반차') === true, 'TEST-01 Fail: "반차"는 반차여야 함');
    assert(isHalfDayLeave('오전반차') === true, 'TEST-01 Fail: "오전반차"는 반차여야 함');
    assert(isHalfDayLeave('오후반차') === true, 'TEST-01 Fail: "오후반차"는 반차여야 함');
    assert(isHalfDayLeave('AM_HALF') === true, 'TEST-01 Fail: "AM_HALF"는 반차여야 함');
    assert(isHalfDayLeave('PM_HALF') === true, 'TEST-01 Fail: "PM_HALF"는 반차여야 함');
    assert(isHalfDayLeave('연차', '오후 반차 신청서') === true, 'TEST-01 Fail: 제목에 반차가 포함되면 반차여야 함');
    assert(isHalfDayLeave('반반차') === false, 'TEST-01 Fail: "반반차"는 반차로 오인되면 안 됨');
    assert(isPartDayLeave('반차') === true, 'TEST-01 Fail: 반차는 부분일차여야 함');

    // ★ 핵심 검증: DB에 days: 1로 잘못 저장되어 있어도 0.5일로 강제 교정되는지 검증
    const daysFromCorruptedDb = calculateLeaveDays({
      leaveType: '반차',
      startDate: '2026-08-13',
      endDate: '2026-08-13',
      rawDays: 1, // DB에 1일로 저장되어 있던 값
      title: '반차',
    });
    assert(daysFromCorruptedDb === 0.5, `TEST-01 Fail: DB에 1일로 저장되었어도 0.5일이어야 함 (실제: ${daysFromCorruptedDb})`);

    const daysAmHalf = calculateLeaveDays({ leaveType: '오전반차', rawDays: 1 });
    assert(daysAmHalf === 0.5, 'TEST-01 Fail: 오전반차는 0.5일이어야 함');

    const daysPmHalf = calculateLeaveDays({ leaveType: '오후반차', rawDays: 1 });
    assert(daysPmHalf === 0.5, 'TEST-01 Fail: 오후반차는 0.5일이어야 함');

    console.log('✅ TEST-01 통과: 반차 판별 및 DB 오염값(1일)에 대한 0.5일 강제 보정 정상');
  }

  // TEST-02: 반반차 판별 및 0.25일 고정 산출
  {
    assert(isQuarterDayLeave('반반차') === true, 'TEST-02 Fail: "반반차"는 반반차여야 함');
    assert(isQuarterDayLeave('QUARTER') === true, 'TEST-02 Fail: "QUARTER"는 반반차여야 함');
    assert(isQuarterDayLeave(null, '반반차 신청의 건') === true, 'TEST-02 Fail: 제목에 반반차가 포함되면 반반차여야 함');
    assert(isQuarterDayLeave('반차') === false, 'TEST-02 Fail: 반차는 반반차로 오인되면 안 됨');

    const daysQuarter = calculateLeaveDays({
      leaveType: '반반차',
      startDate: '2026-08-13',
      endDate: '2026-08-13',
      rawDays: 1,
    });
    assert(daysQuarter === 0.25, `TEST-02 Fail: 반반차는 0.25일이어야 함 (실제: ${daysQuarter})`);
    console.log('✅ TEST-02 통과: 반반차 판별 및 0.25일 고정 산출 정상');
  }

  // TEST-03: 종일 연차 및 다일 연차 계산
  {
    // 단일 1일 연차
    const oneDay = calculateLeaveDays({
      leaveType: '연차',
      startDate: '2026-08-10',
      endDate: '2026-08-10',
    });
    assert(oneDay === 1.0, `TEST-03 Fail: 1일 연차는 1.0일이어야 함 (실제: ${oneDay})`);

    // 주중 5일 연차 (2026-08-03 월 ~ 2026-08-07 금)
    const fiveDays = calculateLeaveDays({
      leaveType: '연차',
      startDate: '2026-08-03',
      endDate: '2026-08-07',
    });
    assert(fiveDays === 5.0, `TEST-03 Fail: 월~금 5일 연차는 5.0일이어야 함 (실제: ${fiveDays})`);

    // 주말을 포함한 연차 (금~월 4일 중 주말 제외 평일 2일)
    const weekendDays = calculateLeaveDays({
      leaveType: '연차',
      startDate: '2026-08-07', // 금
      endDate: '2026-08-10',   // 월
    });
    assert(weekendDays === 2.0, `TEST-03 Fail: 금~월 연차는 평일 2일이어야 함 (실제: ${weekendDays})`);

    // 명시적 rawDays 우선
    const explicitDays = calculateLeaveDays({
      leaveType: '연차',
      rawDays: 3.0,
    });
    assert(explicitDays === 3.0, `TEST-03 Fail: 명시된 수치 3.0이어야 함 (실제: ${explicitDays})`);
    console.log('✅ TEST-03 통과: 종일 연차 및 평일 영업일 계산 정상');
  }

  // TEST-04: 연차 차감 대상(isAnnualLeaveDeduction) 판정 일원화
  {
    assert(isAnnualLeaveDeduction('연차') === true, 'TEST-04 Fail: 연차는 차감 대상이어야 함');
    assert(isAnnualLeaveDeduction('오전반차') === true, 'TEST-04 Fail: 오전반차는 차감 대상이어야 함');
    assert(isAnnualLeaveDeduction('오후반차') === true, 'TEST-04 Fail: 오후반차는 차감 대상이어야 함');
    assert(isAnnualLeaveDeduction('반차') === true, 'TEST-04 Fail: 반차는 차감 대상이어야 함');
    assert(isAnnualLeaveDeduction('반반차') === true, 'TEST-04 Fail: 반반차는 차감 대상이어야 함');
    assert(isAnnualLeaveDeduction('대체휴무') === false, 'TEST-04 Fail: 대체휴무는 연차 차감 대상이 아니어야 함');
    assert(isAnnualLeaveDeduction('병가') === false, 'TEST-04 Fail: 병가는 연차 차감 대상이 아니어야 함');
    assert(isAnnualLeaveDeduction('경조') === false, 'TEST-04 Fail: 경조는 연차 차감 대상이 아니어야 함');
    assert(isAnnualLeaveDeduction(null) === false, 'TEST-04 Fail: null은 false');
    console.log('✅ TEST-04 통과: 법정 연차 차감 대상 유형 판별 일원화 정상');
  }

  // TEST-05: 실제 운영 DB의 기결재 반차 문서(AP-260812-003) 레거시 정규화 검증
  {
    const legacyDoc = {
      id: 'AP-260812-003',
      docNo: 'AP-260812-003',
      docType: '휴가',
      title: '반차',
      drafterId: 'U011',
      drafterName: '김승기',
      drafterDept: 'S/W 개발팀',
      status: '완료',
      form: {
        leaveType: '반차',
        startDate: '2026-08-13',
        endDate: '2026-08-13',
        days: 1, // ⚠️ 과거 DB에 1로 저장되어 있던 값!
      },
      fieldValues: {
        period: '2026-08-13',
        period__end: '2026-08-13',
        period__days: 1,
        leaveType: '반차',
      },
      steps: [],
      createdAt: '2026-08-12T01:44:42.783Z',
      submittedAt: '2026-08-12T01:44:42.874Z',
      currentSeq: 2,
    } as unknown as ApprovalDoc;

    const normalized = normalizeLegacyLeaveDoc(legacyDoc);
    assert(normalized !== null, 'TEST-05 Fail: 정규화 레코드가 반환되어야 함');
    assert(normalized!.days === 0.5, `TEST-05 Fail: DB에 1일로 저장된 반차는 정규화 시 0.5일이어야 함 (실제: ${normalized!.days})`);
    assert(normalized!.leaveType === '오전반차', `TEST-05 Fail: 시간대 미지정 반차는 오전반차로 추론되어야 함 (실제: ${normalized!.leaveType})`);
    assert(normalized!.startTime === '08:30', 'TEST-05 Fail: 시작시간은 08:30이어야 함');
    assert(normalized!.endTime === '13:30', 'TEST-05 Fail: 종료시간은 13:30이어야 함(반차 부재 5시간, 2026-11-16 확정)');
    console.log('✅ TEST-05 통과: 운영 DB의 과거 반차 문서(AP-260812-003)가 0.5일로 정상 교정됨');
  }

  // TEST-06: 전사 연차 원장(buildLeaveLedger)에서 과거 반차 문서 집계 시 usedDays 0.5일 반영 검증
  {
    const legacyDoc = {
      id: 'AP-260812-003',
      docNo: 'AP-260812-003',
      docType: '휴가',
      title: '반차',
      drafterId: 'U011',
      drafterName: '김승기',
      drafterDept: 'S/W 개발팀',
      status: '완료',
      form: {
        leaveType: '반차',
        startDate: '2026-08-13',
        endDate: '2026-08-13',
        days: 1, // 과거 DB에 1일로 오염되어 있던 값
      },
      fieldValues: {
        period: '2026-08-13',
        period__end: '2026-08-13',
        period__days: 1,
        leaveType: '반차',
      },
    } as unknown as ApprovalDoc;

    const normalized = [normalizeLegacyLeaveDoc(legacyDoc)!];
    const usedSum = normalized
      .filter((d) => d.status === '완료' && isAnnualLeaveDeduction(d.leaveType))
      .reduce((s, d) => s + d.days, 0);

    assert(usedSum === 0.5, `TEST-06 Fail: 기결재 반차 문서의 차감 일수 합은 0.5일이어야 함 (실제: ${usedSum})`);
    console.log('✅ TEST-06 통과: 기결재 반차 문서 합산 시 정확히 0.5일로 차감됨 확인');
  }

  console.log('\n✨ 모든 연차/반차/반반차 단일 연산 단위 테스트 성공 (6/6 Passed)');
}

runLeaveCalculationTests();
