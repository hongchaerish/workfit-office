import type { LeaveLedgerSummary as Summary } from '@/domain/leave/ledger';

function Card({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: string }) {
  return (
    <div className={`min-w-0 flex-1 rounded-xl border px-4 py-3 shadow-2xs ${tone ?? 'border-border bg-panel'}`}>
      <div className="text-[10px] font-bold text-ink3">{label}</div>
      <div className="mt-1 truncate text-[19px] font-extrabold leading-tight text-ink">{value}</div>
      <div className="mt-0.5 truncate text-[10px] text-ink3">{sub}</div>
    </div>
  );
}

/** 전사 연차 요약 5칸 — 업무 화면(근태 관리)과 관리자 콘솔(연차 관리)이 같이 쓴다 */
export function LeaveLedgerSummary({ summary }: { summary: Summary }) {
  return (
    <div className="grid grid-cols-2 gap-2.5 md:grid-cols-5">
      <Card label="관리 인원" value={`${summary.totalEmployees}명`} sub="전사 임직원" />
      <Card
        label="총 부여 연차"
        value={`${summary.totalGranted}일`}
        sub={`법정 ${summary.totalEntitled}일 + 조정`}
        tone="border-teal/25 bg-teal/8"
      />
      <Card label="총 사용 연차" value={`${summary.totalUsed}일`} sub="승인 완료 누적" tone="border-emerald-500/25 bg-emerald-500/8" />
      <Card label="평균 소진율" value={`${summary.avgUsageRate}%`} sub="부여 대비 사용" tone="border-teal/25 bg-teal/8" />
      <Card label="잔여 연차 합계" value={`${summary.totalRemaining}일`} sub={`신청중 ${summary.totalPending}일 제외`} />
    </div>
  );
}
