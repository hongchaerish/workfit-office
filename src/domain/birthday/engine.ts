import KoreanLunarCalendar from 'korean-lunar-calendar';

/**
 * 생일 계산 — 인명관리·프로필에서 정한 생년월일과 음력 여부로 "그해 양력 생일"을 구한다.
 * 게시판 자동 게시 등 생일을 쓰는 곳은 이 함수만 쓴다(계산 규칙을 한 곳에 둔다).
 *
 * 규칙
 * - 양력: 그해 같은 월·일. 2월 29일생은 평년에 2월 28일.
 * - 음력: 생년월일의 월·일을 그해 음력 날짜로 보고 양력으로 바꾼다(한국천문연구원 기준 표,
 *   `korean-lunar-calendar`). 그해 그 달이 작은달(29일)이라 30일이 없으면 29일로 본다.
 *   윤달생은 따로 받지 않는다 — 평달 같은 날로 지낸다(일반적인 관습).
 * - 표 범위(1000~2050년) 밖이거나 날짜가 잘못되면 null.
 */
export interface BirthdayPerson {
  /** 생년월일 YYYY-MM-DD. 음력이면 음력 날짜 */
  birthDate: string | null | undefined;
  /** 생년월일이 음력인가 */
  birthLunar?: boolean;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const pad = (v: number) => String(v).padStart(2, '0');

function parseMonthDay(birthDate: string | null | undefined): { month: number; day: number } | null {
  const m = DATE_RE.exec((birthDate ?? '').trim());
  if (!m) return null;
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { month, day };
}

const isLeapYear = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** 그해(year) 양력 생일 YYYY-MM-DD. 알 수 없으면 null. */
export function solarBirthdayInYear(person: BirthdayPerson, year: number): string | null {
  const md = parseMonthDay(person.birthDate);
  if (!md) return null;

  if (!person.birthLunar) {
    const day = md.month === 2 && md.day === 29 && !isLeapYear(year) ? 28 : md.day;
    const probe = new Date(Date.UTC(year, md.month - 1, day));
    if (probe.getUTCMonth() !== md.month - 1) return null; // 4월 31일 같은 잘못된 날짜
    return `${year}-${pad(md.month)}-${pad(day)}`;
  }

  // 음력 → 양력. 작은달이면 30일이 없어 실패하므로 29일로 한 번 더 시도한다.
  const cal = new KoreanLunarCalendar();
  for (const day of md.day === 30 ? [30, 29] : [md.day]) {
    if (cal.setLunarDate(year, md.month, day, false)) {
      const s = cal.getSolarCalendar();
      return `${s.year}-${pad(s.month)}-${pad(s.day)}`;
    }
  }
  return null;
}

/**
 * 기준일(YYYY-MM-DD) 이후 가장 가까운 양력 생일(기준일 포함).
 * 음력 생일은 연말·연초에 양력 연도가 넘어갈 수 있어(음력 12월생 → 다음 해 1~2월) 앞뒤 해를 함께 본다.
 */
export function nextSolarBirthday(person: BirthdayPerson, fromDate: string): string | null {
  const year = Number(fromDate.slice(0, 4));
  if (!Number.isFinite(year)) return null;
  const candidates = [year - 1, year, year + 1]
    .map((y) => solarBirthdayInYear(person, y))
    .filter((d): d is string => Boolean(d) && (d as string) >= fromDate)
    .sort();
  return candidates[0] ?? null;
}

/** 그날(YYYY-MM-DD)이 생일인가 */
export function isBirthdayOn(person: BirthdayPerson, date: string): boolean {
  const year = Number(date.slice(0, 4));
  // 음력 12월생은 양력 다음 해 초에 생일이 올 수 있어 전년도 음력도 본다
  return [year - 1, year].some((y) => solarBirthdayInYear(person, y) === date);
}

/**
 * 그날 생일인 사람들 — 공개한 사람만. 게시판 자동 게시 등에서 쓴다.
 * `birthdayPublic`이 false면 뺀다(값이 없으면 공개로 본다).
 */
export function birthdaysOn<T extends BirthdayPerson & { birthdayPublic?: boolean }>(people: readonly T[], date: string): T[] {
  return people.filter((p) => p.birthdayPublic !== false && isBirthdayOn(p, date));
}

/** 표시용 — "양력 3월 5일" / "음력 1월 15일 (올해 양력 2월 12일)" */
export function describeBirthday(person: BirthdayPerson, today: string): string {
  const md = parseMonthDay(person.birthDate);
  if (!md) return '';
  const base = `${person.birthLunar ? '음력' : '양력'} ${md.month}월 ${md.day}일`;
  if (!person.birthLunar) return base;
  const solar = solarBirthdayInYear(person, Number(today.slice(0, 4)));
  return solar ? `${base} (올해 양력 ${Number(solar.slice(5, 7))}월 ${Number(solar.slice(8, 10))}일)` : base;
}

/**
 * 오늘 생일인 사용자 id — 이름 옆 🎂 표시용(메신저·업무계획).
 * `birthdaysOn` 규칙(공개한 사람만, 음력 환산)에 더해 사용 중인 계정만 남긴다.
 */
export function birthdayUserIds<T extends BirthdayPerson & { userId: string; birthdayPublic?: boolean }>(
  people: readonly T[],
  activeUserIds: ReadonlySet<string>,
  date: string,
): Set<string> {
  return new Set(birthdaysOn(people.filter((p) => activeUserIds.has(p.userId)), date).map((p) => p.userId));
}
