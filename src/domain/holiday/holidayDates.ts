import { getKoreaStandardHolidays } from './koreaHolidays';

/**
 * 쉬는 날(공휴일·대체공휴일·회사 휴일) 날짜 모음 — 휴일 관리(DB)에 등록된 날짜와 기본 공휴일 목록을 합친다.
 * DB에 그해 휴일이 일부만 들어 있어도(신정만 등) 설·추석 같은 공휴일이 빠지지 않게 늘 합친다.
 */
export function holidayDateSet(dbHolidays: ReadonlyArray<{ date: string }>, years: ReadonlyArray<string>): Set<string> {
  const set = new Set(dbHolidays.map((h) => h.date));
  for (const year of years) for (const h of getKoreaStandardHolidays(year)) set.add(h.date);
  return set;
}

/** from ~ to 가 걸친 해 */
export function yearsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y += 1) out.push(String(y));
  return out;
}
