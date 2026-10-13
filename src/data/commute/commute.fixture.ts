import type { CommuteEmployee, CommuteRecord } from '@/domain/commute/schema';

/**
 * 근태 로컬 fixture — Firebase 미설정 환경용 샘플.
 *
 * 실데이터는 CAPS 에이전트 → `/api/ingest`가 Firestore에 넣는다(운영). 로컬 화면
 * 확인용으로 최근 4주 평일을 결정적 규칙으로 생성한다(무작위 없음 — 새로고침마다
 * 흔들리면 확인이 안 된다).
 */
export const COMMUTE_EMPLOYEE_FIXTURE: CommuteEmployee[] = [
  { empId: 1, name: '김승기', active: true, retireDate: null },
  { empId: 2, name: '박명규', active: true, retireDate: null },
  { empId: 3, name: '홍채원', active: true, retireDate: null },
  { empId: 4, name: '박광래', active: true, retireDate: null },
  { empId: 5, name: '강윤석', active: false, retireDate: '2026-06-30' },
];

const pad = (value: number) => String(value).padStart(2, '0');

function record(empId: number, date: Date, kind: number): CommuteRecord {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const at = (hour: number, minute: number) => `${day}T${pad(hour)}:${pad(minute)}:00+09:00`;

  if (kind === 5) {
    return { empId, date: day, inAt: null, outAt: null, basicMin: 0, overMin: 0, nightMin: 0, lateMin: 0, totalMin: 0, status: 'absent' };
  }
  if (kind === 4) {
    return { empId, date: day, inAt: at(8, 40), outAt: null, basicMin: 0, overMin: 0, nightMin: 0, lateMin: 0, totalMin: 0, status: 'missing_out' };
  }
  if (kind === 3) {
    const late = 12 + empId * 3;
    return { empId, date: day, inAt: at(9, late), outAt: at(18, 10), basicMin: 540 - late, overMin: 0, nightMin: 0, lateMin: late, totalMin: 540 - late, status: 'late' };
  }
  const over = kind === 2 ? 45 + empId * 10 : 0;
  return {
    empId, date: day, inAt: at(8, 30 + empId * 4), outAt: at(18, kind === 2 ? 50 : 5),
    basicMin: 540, overMin: over, nightMin: 0, lateMin: 0, totalMin: 540 + over, status: 'normal',
  };
}

function buildRecords(): CommuteRecord[] {
  const rows: CommuteRecord[] = [];
  const today = new Date();
  for (let back = 0; back < 28; back += 1) {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - back);
    const weekday = date.getDay();
    if (weekday === 0 || weekday === 6) continue; // 주말 제외
    for (const employee of COMMUTE_EMPLOYEE_FIXTURE.filter((row) => row.active)) {
      // 결정적 패턴: (사번+날짜)로 정상·연장·지각·미퇴근·결근을 섞는다.
      const seed = (employee.empId * 7 + date.getDate() * 3) % 17;
      const kind = seed < 10 ? 1 : seed < 13 ? 2 : seed < 15 ? 3 : seed < 16 ? 4 : 5;
      rows.push(record(employee.empId, date, kind));
    }
  }
  return rows;
}

export const COMMUTE_RECORD_FIXTURE: CommuteRecord[] = buildRecords();
