import type { HolidayType } from './schema';

export interface StandardHolidayItem {
  date: string;
  name: string;
  type: HolidayType;
  isPaid: boolean;
  isRecurring?: boolean;
  memo?: string;
}

/**
 * 대한민국 관공서 공휴일에 관한 규정 기준 표준 공휴일 데이터
 * (양력 고정 공휴일 및 연도별 음력 명절/부처님오신날/대체공휴일 포함)
 */
export const KOREA_STANDARD_HOLIDAYS: Record<string, StandardHolidayItem[]> = {
  '2025': [
    { date: '2025-01-01', name: '신정 (새해 첫날)', type: 'legal', isPaid: true, isRecurring: true },
    { date: '2025-01-28', name: '설날 전날', type: 'legal', isPaid: true },
    { date: '2025-01-29', name: '설날', type: 'legal', isPaid: true },
    { date: '2025-01-30', name: '설날 다음날', type: 'legal', isPaid: true },
    { date: '2025-03-01', name: '삼일절', type: 'legal', isPaid: true, isRecurring: true },
    { date: '2025-03-03', name: '삼일절 대체공휴일', type: 'substitute', isPaid: true, memo: '삼일절이 토요일과 겹쳐 월요일 대체' },
    { date: '2025-05-05', name: '어린이날', type: 'legal', isPaid: true, isRecurring: true },
    { date: '2025-05-06', name: '부처님오신날 대체공휴일', type: 'substitute', isPaid: true, memo: '부처님오신날(5.5)과 어린이날 중복 대체' },
    { date: '2025-06-06', name: '현충일', type: 'legal', isPaid: true, isRecurring: true },
    { date: '2025-08-15', name: '광복절', type: 'legal', isPaid: true, isRecurring: true },
    { date: '2025-10-03', name: '개천절', type: 'legal', isPaid: true, isRecurring: true },
    { date: '2025-10-05', name: '추석 전날', type: 'legal', isPaid: true },
    { date: '2025-10-06', name: '추석', type: 'legal', isPaid: true },
    { date: '2025-10-07', name: '추석 다음날', type: 'legal', isPaid: true },
    { date: '2025-10-08', name: '추석 대체공휴일', type: 'substitute', isPaid: true, memo: '추석 연휴 일요일 중복 대체' },
    { date: '2025-10-09', name: '한글날', type: 'legal', isPaid: true, isRecurring: true },
    { date: '2025-12-25', name: '기독탄신일 (성탄절)', type: 'legal', isPaid: true, isRecurring: true },
  ],
  '2026': [
    { date: '2026-01-01', name: '신정 (새해 첫날)', type: 'legal', isPaid: true, isRecurring: true },
    { date: '2026-02-16', name: '설날 전날', type: 'legal', isPaid: true },
    { date: '2026-02-17', name: '설날', type: 'legal', isPaid: true },
    { date: '2026-02-18', name: '설날 다음날', type: 'legal', isPaid: true },
    { date: '2026-03-01', name: '삼일절', type: 'legal', isPaid: true, isRecurring: true },
    { date: '2026-03-02', name: '삼일절 대체공휴일', type: 'substitute', isPaid: true, memo: '삼일절이 일요일과 겹쳐 월요일 대체' },
    { date: '2026-05-05', name: '어린이날', type: 'legal', isPaid: true, isRecurring: true },
    { date: '2026-05-24', name: '부처님오신날', type: 'legal', isPaid: true },
    { date: '2026-05-25', name: '부처님오신날 대체공휴일', type: 'substitute', isPaid: true, memo: '부처님오신날이 일요일과 겹쳐 월요일 대체' },
    { date: '2026-06-06', name: '현충일', type: 'legal', isPaid: true, isRecurring: true },
    { date: '2026-08-15', name: '광복절', type: 'legal', isPaid: true, isRecurring: true },
    { date: '2026-08-17', name: '광복절 대체공휴일', type: 'substitute', isPaid: true, memo: '광복절이 토요일과 겹쳐 월요일 대체' },
    { date: '2026-09-24', name: '추석 전날', type: 'legal', isPaid: true },
    { date: '2026-09-25', name: '추석', type: 'legal', isPaid: true },
    { date: '2026-09-26', name: '추석 다음날', type: 'legal', isPaid: true },
    { date: '2026-09-28', name: '추석 대체공휴일', type: 'substitute', isPaid: true, memo: '추석 연휴가 토요일과 겹쳐 월요일 대체' },
    { date: '2026-10-03', name: '개천절', type: 'legal', isPaid: true, isRecurring: true },
    { date: '2026-10-05', name: '개천절 대체공휴일', type: 'substitute', isPaid: true, memo: '개천절이 토요일과 겹쳐 월요일 대체' },
    { date: '2026-10-09', name: '한글날', type: 'legal', isPaid: true, isRecurring: true },
    { date: '2026-12-25', name: '기독탄신일 (성탄절)', type: 'legal', isPaid: true, isRecurring: true },
  ],
  '2027': [
    { date: '2027-01-01', name: '신정 (새해 첫날)', type: 'legal', isPaid: true, isRecurring: true },
    { date: '2027-02-06', name: '설날 전날', type: 'legal', isPaid: true },
    { date: '2027-02-07', name: '설날', type: 'legal', isPaid: true },
    { date: '2027-02-08', name: '설날 다음날', type: 'legal', isPaid: true },
    { date: '2027-02-09', name: '설날 대체공휴일', type: 'substitute', isPaid: true, memo: '설날이 일요일과 겹쳐 화요일 대체' },
    { date: '2027-03-01', name: '삼일절', type: 'legal', isPaid: true, isRecurring: true },
    { date: '2027-05-05', name: '어린이날', type: 'legal', isPaid: true, isRecurring: true },
    { date: '2027-05-13', name: '부처님오신날', type: 'legal', isPaid: true },
    { date: '2027-06-06', name: '현충일', type: 'legal', isPaid: true, isRecurring: true },
    { date: '2027-08-15', name: '광복절', type: 'legal', isPaid: true, isRecurring: true },
    { date: '2027-08-16', name: '광복절 대체공휴일', type: 'substitute', isPaid: true, memo: '광복절이 일요일과 겹쳐 월요일 대체' },
    { date: '2027-09-14', name: '추석 전날', type: 'legal', isPaid: true },
    { date: '2027-09-15', name: '추석', type: 'legal', isPaid: true },
    { date: '2027-09-16', name: '추석 다음날', type: 'legal', isPaid: true },
    { date: '2027-10-03', name: '개천절', type: 'legal', isPaid: true, isRecurring: true },
    { date: '2027-10-04', name: '개천절 대체공휴일', type: 'substitute', isPaid: true, memo: '개천절이 일요일과 겹쳐 월요일 대체' },
    { date: '2027-10-09', name: '한글날', type: 'legal', isPaid: true, isRecurring: true },
    { date: '2027-10-11', name: '한글날 대체공휴일', type: 'substitute', isPaid: true, memo: '한글날이 토요일과 겹쳐 월요일 대체' },
    { date: '2027-12-25', name: '기독탄신일 (성탄절)', type: 'legal', isPaid: true, isRecurring: true },
  ],
};

/**
 * 특정 연도의 대한민국 법정 공휴일 목록 반환
 */
export function getKoreaStandardHolidays(year: string): StandardHolidayItem[] {
  if (KOREA_STANDARD_HOLIDAYS[year]) {
    return KOREA_STANDARD_HOLIDAYS[year];
  }

  // 정의되지 않은 연도의 경우 양력 고정 공휴일 기본 반환
  return [
    { date: `${year}-01-01`, name: '신정 (새해 첫날)', type: 'legal', isPaid: true, isRecurring: true },
    { date: `${year}-03-01`, name: '삼일절', type: 'legal', isPaid: true, isRecurring: true },
    { date: `${year}-05-05`, name: '어린이날', type: 'legal', isPaid: true, isRecurring: true },
    { date: `${year}-06-06`, name: '현충일', type: 'legal', isPaid: true, isRecurring: true },
    { date: `${year}-08-15`, name: '광복절', type: 'legal', isPaid: true, isRecurring: true },
    { date: `${year}-10-03`, name: '개천절', type: 'legal', isPaid: true, isRecurring: true },
    { date: `${year}-10-09`, name: '한글날', type: 'legal', isPaid: true, isRecurring: true },
    { date: `${year}-12-25`, name: '기독탄신일 (성탄절)', type: 'legal', isPaid: true, isRecurring: true },
  ];
}
