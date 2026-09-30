import { z } from 'zod';
import { isHalfDayLeave, isQuarterDayLeave } from '@/domain/leave/policy';

/**
 * 근태 조회 도메인 — CAPS 인제스트가 저장하는 Firestore 문서(서버 계약 §5)의 클라이언트 뷰.
 * 쓰기는 서버(/api/ingest) 전용이라 여기는 조회 형태만 정의한다. 시각은 ISO 문자열로
 * 정규화한다(Firestore Timestamp 변환은 repo 몫).
 */
export const COMMUTE_STATUS = [
  'normal', 'late', 'holiday_work', 'off', 'absent', 'leave', 'outside', 'trip', 'missing_out', 'missing_in', 'unknown',
] as const;

export type CommuteStatus = (typeof COMMUTE_STATUS)[number];

export const COMMUTE_STATUS_LABELS: Record<CommuteStatus, string> = {
  normal: '정상',
  late: '지각',
  holiday_work: '휴일근무',
  off: '휴무/공휴일',
  absent: '결근',
  leave: '휴가',
  outside: '외근',
  trip: '출장',
  missing_out: '퇴근 미기록',
  missing_in: '출근 미기록',
  unknown: '—',
};

export const commuteEmployeeSchema = z.object({
  empId: z.number().int(),
  name: z.string(),
  active: z.boolean(),
  retireDate: z.string().nullable(),
});

export type CommuteEmployee = z.infer<typeof commuteEmployeeSchema>;

/**
 * 열람 범위 — **서버가 정한다.**
 *
 * 같은 판정 규칙을 화면에도 두면 언젠가 한쪽만 바뀌어 어긋난다. 화면은 이 값으로 탭 노출과
 * 범위 표기만 정하고, 실제 걸러내기는 서버가 한다(요청을 고쳐도 남의 근태는 안 나온다).
 */
export const COMMUTE_SCOPE_KINDS = ['admin', 'head', 'self'] as const;

export type CommuteScopeKind = (typeof COMMUTE_SCOPE_KINDS)[number];

export const commuteViewerSchema = z.object({
  /** 내 CAPS 사번. 이름이 CAPS 등록명과 안 맞으면 null이라 "내 근태"를 열 수 없다. */
  empId: z.number().int().nullable(),
  name: z.string().default(''),
  kind: z.enum(COMMUTE_SCOPE_KINDS),
  /** 부서장일 때 내가 맡은 부서 이름. 관리자·일반은 빈 배열. */
  deptNames: z.array(z.string()).default([]),
});

export type CommuteViewer = z.infer<typeof commuteViewerSchema>;

/** 남의 근태를 볼 수 있는 자리인지. 탭 노출 판단에만 쓴다. */
export const canSeeOthers = (viewer: CommuteViewer | undefined): boolean =>
  viewer?.kind === 'admin' || viewer?.kind === 'head';

export const commuteRecordSchema = z.object({
  empId: z.number().int(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  inAt: z.string().nullable(),
  outAt: z.string().nullable(),
  basicMin: z.number().int(),
  overMin: z.number().int(),
  nightMin: z.number().int(),
  lateMin: z.number().int(),
  totalMin: z.number().int(),
  status: z.enum(COMMUTE_STATUS),
  leaveName: z.string().optional(),
  outsideName: z.string().optional(),
  tripName: z.string().optional(),
  holidayName: z.string().optional(),
});

export type CommuteRecord = z.infer<typeof commuteRecordSchema>;

/** 월별 요약. status 매핑이 추정치(계약 §3)라 집계도 참고용임을 화면이 안내한다. */
export interface CommuteMonthSummary {
  workDays: number;
  lateDays: number;
  absentDays: number;
  leaveDays: number;
  totalMin: number;
  overMinTotal: number;
}

export function summarizeCommuteMonth(rows: CommuteRecord[]): CommuteMonthSummary {
  let leaveDays = 0;
  for (const row of rows) {
    if (row.status === 'leave') {
      leaveDays += 1;
    } else if (row.leaveName) {
      if (isQuarterDayLeave(row.leaveName)) {
        leaveDays += 0.25;
      } else if (isHalfDayLeave(row.leaveName)) {
        leaveDays += 0.5;
      }
    }
  }

  return {
    workDays: rows.filter(
      (row) => row.inAt !== null || row.outAt !== null || row.status === 'outside' || row.status === 'trip'
    ).length,
    lateDays: rows.filter((row) => row.status === 'late').length,
    absentDays: rows.filter((row) => row.status === 'absent').length,
    leaveDays,
    totalMin: rows.reduce((sum, row) => sum + (row.totalMin ?? 0), 0),
    overMinTotal: 0,
  };
}
