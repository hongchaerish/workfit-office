import { useMemo, useState } from 'react';
import { useAuth } from '@/app/auth/AuthProvider';
import { usePermission } from '@/features/auth/usePermission';
import { useCommuteEvaluation } from '@/features/commute/useCommuteEvaluation';
import { useCommuteRoster } from '@/features/commute/useCommuteRoster';
import { useLeaveLedger, type LeaveLedgerMode } from '@/features/commute/useLeaveLedger';
import type { LeaveLedgerEntry } from '@/domain/leave/ledger';
import { LeaveLedgerTable } from '@/modules/gw/leave/components/LeaveLedgerTable';
import { LeaveLedgerSummary } from '@/modules/gw/leave/components/LeaveLedgerSummary';
import { LeaveAdjustmentModal } from '@/modules/gw/leave/components/LeaveAdjustmentModal';
import { LeavePersonDetailModal } from '@/modules/gw/leave/components/LeavePersonDetailModal';

/**
 * 관리자 콘솔 › 근태·휴가 › 연차 관리 — 전사 연차 원장 + 수동 가감 + 직원별 연차 기간 내역.
 * 현황 조회는 업무 화면(근태·휴가)에서 임원·인사가 보고, 조정은 여기서만 한다.
 */
export default function LeaveManageScreen() {
  const { user } = useAuth();
  const { canAction } = usePermission();
  const canManage = canAction('S_ADM_LEAVE', 'update');

  const { approvals: approvalsData, holidays } = useCommuteEvaluation();
  const approvals = useMemo(() => approvalsData ?? [], [approvalsData]);
  const roster = useCommuteRoster(true);
  const [mode, setMode] = useState<LeaveLedgerMode>('HIRE_DATE');
  const { entries, summary, refreshAdjustments } = useLeaveLedger({ enabled: true, mode, roster, approvals, holidays });

  // 상세 창은 원장이 다시 계산되면(조정 저장 등) 같은 사람의 새 줄을 보여 준다
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const keyOf = (e: LeaveLedgerEntry) => `${e.empNo}-${e.name}`;
  const detail = detailKey ? entries.find((e) => keyOf(e) === detailKey) ?? null : null;
  const [adjustTarget, setAdjustTarget] = useState<LeaveLedgerEntry | null>(null);

  return (
    <div className="mx-auto w-full max-w-[1560px] space-y-3 px-3 py-4 sm:px-5 sm:py-5">
      <div>
        <h1 className="text-xl font-extrabold tracking-tight text-ink">연차 관리</h1>
        <p className="mt-0.5 text-xs text-ink3">근태·휴가 / 연차 관리</p>
      </div>

      <LeaveLedgerSummary summary={summary} />

      <LeaveLedgerTable
        entries={entries}
        calculationMode={mode}
        onToggleCalculationMode={setMode}
        onOpenAdjustment={(e) => setAdjustTarget(e)}
        onSelectPerson={(e) => setDetailKey(keyOf(e))}
        isAdmin={canManage}
      />

      <LeavePersonDetailModal
        entry={adjustTarget ? null : detail}
        onClose={() => setDetailKey(null)}
        onAdjust={canManage ? (e) => setAdjustTarget(e) : undefined}
      />

      {adjustTarget && (
        <LeaveAdjustmentModal
          entry={adjustTarget}
          adminName={user?.name || '관리자'}
          onClose={() => setAdjustTarget(null)}
          onSuccess={refreshAdjustments}
        />
      )}
    </div>
  );
}
