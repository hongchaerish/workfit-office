import { C } from './_report';

/**
 * 경영자 대시보드 데이터 소스 — 데모 샘플.
 *
 * ⚠ 화면은 오직 `getExecDashboardData()` "단일 소스 함수"만 호출한다.
 *    실운영 전환 시 이 함수 내부만 샘플 → services/reporting 실집계로 바꾸면
 *    화면은 무변경이다. (계획서 §5-3 / 데이터 계층 격리 원칙)
 */

/** KPI 타일. delta는 부호 포함 문자열('+1.2%p'). goodWhenUp=상승이 좋은 지표인지. */
export interface ExecKpi {
  key: string;
  label: string;
  value: string;
  delta: string;
  goodWhenUp: boolean;
  color: string;
  spark: number[];
  /** 드릴다운 목적지(원천 화면). 없으면 눌러도 이동하지 않는다(영업 관리 숨김으로 끊은 항목 등). */
  to?: string;
}

export interface DeptScore {
  label: string;
  score: number;
  color: string;
}

export interface ExecAlert {
  key: string;
  icon: string;
  label: string;
  count: string;
  tone: 'err' | 'warn' | 'ok' | 'info';
  /** 없으면 눌러도 이동하지 않는다. */
  to?: string;
}

export interface ExecTrend {
  labels: string[];
  productivity: number[];
  quality: number[];
}

export interface PeriodRow {
  label: string;
  prev: string;
  cur: string;
  delta: string;
  up: boolean;
}

/** 기간 비교 막대(지수) — GroupedBars 입력. type 별칭(암묵적 인덱스 시그니처 필요). */
export type PeriodBar = {
  label: string;
  prev: number;
  cur: number;
};

/** 부서/라인 스코어카드 행. grade A/B/C. */
export interface ScorecardRow {
  org: string;
  prod: number;
  qual: number;
  oee: number;
  due: number;
  score: string;
  grade: 'A' | 'B' | 'C';
}

/** 스코어카드 상단 요약 KPI([label, value, unit, tone?]) — MKpis 입력 호환. */
export type ScorecardKpi = [string, string, string] | [string, string, string, string];

export interface ExecDashboardData {
  company: string;
  period: string;
  kpis: ExecKpi[];
  scores: DeptScore[];
  trend: ExecTrend;
  alerts: ExecAlert[];
  periodRows: PeriodRow[];
  /** 기간 비교(전월 vs 당월) 화면용. */
  periodCompareLabel: string;
  periodBars: PeriodBar[];
  /** 부서/라인 스코어카드 화면용. */
  scorecardKpis: ScorecardKpi[];
  scorecardRows: ScorecardRow[];
}

const DATA: ExecDashboardData = {
  company: '전사',
  period: '2026-06 (월간)',
  kpis: [
    { key: 'ach', label: '생산 달성률', value: '97.8%', delta: '+1.2%p', goodWhenUp: true, color: C.teal, spark: [94, 96, 95, 97, 98, 97.8], to: '/report/prod-pva' },
    { key: 'fpy', label: '종합 수율(FPY)', value: '97.1%', delta: '+0.4%p', goodWhenUp: true, color: C.blue, spark: [96, 96.5, 96.2, 97, 97.3, 97.1], to: '/report/yield' },
    { key: 'oee', label: '평균 OEE', value: '86.6%', delta: '+0.9%p', goodWhenUp: true, color: C.navy, spark: [83, 84, 85, 84, 86, 86.6], to: '/equip/oee' },
    { key: 'otd', label: '납기 준수율', value: '98.4%', delta: '-0.3%p', goodWhenUp: true, color: C.warn, spark: [99, 98, 99, 98.5, 98.7, 98.4] },
    { key: 'turn', label: '재고 회전율', value: '5.9회', delta: '+0.3', goodWhenUp: true, color: C.teal, spark: [5.4, 5.6, 5.5, 5.7, 5.8, 5.9], to: '/report/turnover' },
    { key: 'claim', label: '클레임 건수', value: '14건', delta: '-3건', goodWhenUp: false, color: C.err, spark: [22, 19, 17, 16, 15, 14], to: '/qual/voc' },
    { key: 'rev', label: '월 매출', value: '32.6억', delta: '+4.1%', goodWhenUp: true, color: '#7a3f97', spark: [28.4, 29.1, 30.2, 31.0, 31.3, 32.6] },
    { key: 'cost', label: '원가율', value: '78.2%', delta: '-0.6%p', goodWhenUp: false, color: C.blue, spark: [80, 79.5, 79, 78.8, 78.6, 78.2], to: '/report/cost' },
  ],
  scores: [
    { label: '생산', score: 92, color: C.teal },
    { label: '품질', score: 88, color: C.blue },
    { label: '설비', score: 86, color: C.navy },
    { label: '자재/물류', score: 90, color: C.warn },
    { label: '원가', score: 84, color: '#7a3f97' },
  ],
  trend: {
    labels: ['1월', '2월', '3월', '4월', '5월', '6월'],
    productivity: [94, 96, 95, 97, 98, 97.8],
    quality: [96, 96.5, 96.2, 97, 97.3, 97.1],
  },
  alerts: [
    { key: 'otd', icon: '⏰', label: '납기 임박·지연 수주', count: '5건', tone: 'err' },
    { key: 'safety', icon: '📦', label: '안전재고 미달 품목', count: '8건', tone: 'warn', to: '/mat/safety-stock' },
    { key: 'qalarm', icon: '⚠️', label: '미해제 품질 알람', count: '3건', tone: 'warn', to: '/qual/spc-alarm' },
    { key: 'credit', icon: '💳', label: '여신 한도 초과 거래처', count: '2건', tone: 'err' },
    { key: 'eqfault', icon: '🔧', label: '설비 고장·미조치 알람', count: '1건', tone: 'warn', to: '/equip/alarm' },
  ],
  periodRows: [
    { label: '생산량(천EA)', prev: '198.4', cur: '206.5', delta: '+4.1%', up: true },
    { label: '종합 수율', prev: '96.7%', cur: '97.1%', delta: '+0.4%p', up: true },
    { label: '평균 OEE', prev: '84.2%', cur: '86.6%', delta: '+2.4%p', up: true },
    { label: '납기 준수율', prev: '98.7%', cur: '98.4%', delta: '-0.3%p', up: false },
    { label: '불량률', prev: '2.2%', cur: '1.6%', delta: '-0.6%p', up: true },
  ],
  periodCompareLabel: '2026-05 vs 2026-06',
  periodBars: [
    { label: '생산량', prev: 94, cur: 98 },
    { label: '수율', prev: 96, cur: 97 },
    { label: 'OEE', prev: 84, cur: 87 },
    { label: '납기', prev: 99, cur: 98 },
    { label: '불량률', prev: 22, cur: 16 },
  ],
  scorecardKpis: [
    ['평가 조직', '12', '개'],
    ['A 등급', '7', '개', 'teal'],
    ['목표 달성', '83', '%'],
    ['전월비', '+1.8', '%p'],
  ],
  scorecardRows: [
    { org: 'M-Line 1', prod: 98, qual: 97, oee: 88, due: 99, score: '95.5', grade: 'A' },
    { org: 'M-Line 2', prod: 96, qual: 96, oee: 85, due: 98, score: '93.8', grade: 'A' },
    { org: 'A-Line', prod: 96, qual: 95, oee: 84, due: 97, score: '93.0', grade: 'B' },
    { org: '가공팀', prod: 97, qual: 98, oee: 90, due: 96, score: '95.3', grade: 'A' },
    { org: '조립팀', prod: 95, qual: 94, oee: 82, due: 95, score: '91.5', grade: 'B' },
  ],
};

/** 경영자 대시보드 단일 데이터 소스(현재 샘플, 후속 실집계 교체 지점). */
export function getExecDashboardData(): ExecDashboardData {
  return DATA;
}
