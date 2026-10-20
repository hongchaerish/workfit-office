import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '@/shared/ui/Card';
import { Sparkline } from '@/shared/ui/charts/Sparkline';
import { LineChart } from '@/shared/ui/charts/LineChart';
import { C, RHead, RParam, RLegend, ProgBar, FField, FSel } from './_report';
import { getExecDashboardData, type ExecAlert } from './mock';
import { PerformanceSection } from './PerformanceSection';
import factoryOverview from '@/assets/exec-factory-overview.jpg';

const TONE_COLOR: Record<ExecAlert['tone'], string> = {
  err: C.err,
  warn: C.warn,
  ok: C.ok,
  info: C.blue,
};

/** 섹션 구분 헤더. */
function SecHead({ children }: { children: string }) {
  return (
    <div className="mt-1 flex items-center gap-2">
      <span className="h-[15px] w-1 rounded-sm bg-teal" />
      <span className="text-[13.5px] font-extrabold tracking-tight text-ink">{children}</span>
    </div>
  );
}

/**
 * 경영 현황(Executive Cockpit) — 로그인 후 랜딩. 회사 전체를 경영자 관점 한 화면에 요약.
 * 데이터는 단일 소스 `getExecDashboardData()`(현재 데모 샘플). 계획서 §4.
 */
/** 드릴다운 목적지가 있으면 링크, 없으면 그냥 상자. */
function DrillLink({ to, className, children }: { to?: string; className?: string; children: ReactNode }) {
  return to ? <Link to={to} className={className}>{children}</Link> : <div className={className}>{children}</div>;
}

export default function ExecDashboardScreen() {
  const d = getExecDashboardData();

  return (
    <div className="flex flex-col gap-3.5">
      <RHead title="경영 현황" sub="Executive Dashboard / 전사 종합 현황" type="R2" />
      <RParam period={d.period}>
        <FField label="공장"><FSel value={d.company} w={80} /></FField>
      </RParam>

      {/* ── 공장 전경 개요 ── */}
      <Card bodyClassName="p-0" className="overflow-hidden">
        <img
          src={factoryOverview}
          alt="공장 전경 개요"
          className="block w-full object-cover"
        />
      </Card>

      {/* ── 성과 관리(매출·거래처) — 상단 배치 ── */}
      <SecHead>성과 관리 · 매출/거래처</SecHead>
      <PerformanceSection />

      {/* ── 전사 종합 현황 ── */}
      <SecHead>전사 종합 현황</SecHead>

      {/* KPI 타일 */}
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        {d.kpis.map((t) => {
          const up = t.delta.trim().startsWith('+');
          const good = up === t.goodWhenUp;
          return (
            <DrillLink key={t.key} to={t.to} className="group">
              <Card className="transition-shadow group-hover:shadow-[0_6px_20px_rgba(16,24,48,0.12)]">
                <div className="flex items-start justify-between">
                  <div className="min-w-0">
                    <div className="text-[11.5px] font-semibold text-ink2">{t.label}</div>
                    <div className="mt-1 text-[26px] font-extrabold tabular-nums tracking-tight text-ink">{t.value}</div>
                    <div className="mt-0.5 text-[11px] font-bold" style={{ color: good ? C.ok : C.err }}>
                      {up ? '▲' : '▼'} {t.delta.replace(/^[-+]/, '')}
                      <span className="ml-1 font-medium text-ink3">전월비</span>
                    </div>
                  </div>
                  <Sparkline data={t.spark} w={84} h={36} color={t.color} />
                </div>
              </Card>
            </DrillLink>
          );
        })}
      </div>

      {/* 생산성/품질 트렌드 · 부문 평가 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="생산성 vs 품질 (월별)">
          <LineChart
            series={[
              { data: d.trend.productivity, c: C.teal },
              { data: d.trend.quality, c: C.blue },
            ]}
            labels={d.trend.labels}
            h={200}
            max={100}
          />
          <RLegend items={[['생산 달성률', C.teal], ['종합 수율', C.blue]]} />
        </Card>

        <Card title="부문별 종합 평가">
          <div className="mt-1 flex flex-col gap-3">
            {d.scores.map((r) => (
              <div key={r.label}>
                <div className="mb-1 flex items-center justify-between text-[11.5px]">
                  <span className="font-semibold text-ink2">{r.label}</span>
                  <span className="font-extrabold text-ink">{r.score}점</span>
                </div>
                <ProgBar v={r.score} color={r.color} />
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* 경영 알림 · 기간 비교 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="경영 알림 (Exec Alerts)">
          <div className="flex flex-col divide-y divide-border">
            {d.alerts.map((a) => (
              <DrillLink
                key={a.key}
                to={a.to}
                className="-mx-1 flex items-center gap-3 rounded-md px-1 py-2.5 transition-colors hover:bg-panel-alt"
              >
                <span
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] text-[15px]"
                  style={{ background: `${TONE_COLOR[a.tone]}1a` }}
                >
                  {a.icon}
                </span>
                <span className="flex-1 text-[12px] font-semibold text-ink">{a.label}</span>
                <span className="text-[13px] font-extrabold tabular-nums" style={{ color: TONE_COLOR[a.tone] }}>
                  {a.count}
                </span>
                {a.to && <span className="text-[11px] text-ink3">›</span>}
              </DrillLink>
            ))}
          </div>
        </Card>

        <Card title="주요 지표 전월 대비" bodyClassName="p-0">
          <table className="w-full text-[11.5px]">
            <thead>
              <tr className="border-b border-border text-ink3">
                <th className="px-4 py-2.5 text-left font-semibold">지표</th>
                <th className="px-4 py-2.5 text-right font-semibold">전월</th>
                <th className="px-4 py-2.5 text-right font-semibold">당월</th>
                <th className="px-4 py-2.5 text-right font-semibold">증감</th>
              </tr>
            </thead>
            <tbody>
              {d.periodRows.map((r) => (
                <tr key={r.label} className="border-b border-border last:border-0">
                  <td className="px-4 py-2.5 font-semibold text-ink2">{r.label}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink2">{r.prev}</td>
                  <td className="px-4 py-2.5 text-right font-bold tabular-nums text-ink">{r.cur}</td>
                  <td className="px-4 py-2.5 text-right font-extrabold tabular-nums" style={{ color: r.up ? C.ok : C.err }}>
                    {r.up ? '▲' : '▼'} {r.delta.replace(/^[-+]/, '')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
