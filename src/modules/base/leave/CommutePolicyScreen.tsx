import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { usePermission } from '@/features/auth/usePermission';
import { useCommutePolicy } from '@/features/commute/useCommutePolicy';
import { DEFAULT_COMMUTE_POLICY } from '@/domain/commutePolicy/schema';
import { breakMinutesOf } from '@/domain/commutePolicy/validate';
import { Button } from '@/shared/ui/Button';
import { CommutePolicyModal } from '@/modules/gw/commute/components/CommutePolicyModal';

function Row({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-3">
      <span className="text-[12px] font-bold text-ink2">{label}</span>
      <span className="text-right">
        <span className="text-[13px] font-extrabold tabular-nums text-ink">{value}</span>
        {sub && <span className="ml-2 text-[11px] text-ink3">{sub}</span>}
      </span>
    </div>
  );
}

/** 관리자 콘솔 › 근태·휴가 › 근무 정책 — 출퇴근·휴게·지각 기준(업무 화면의 근태 판정이 이 값을 쓴다) */
export default function CommutePolicyScreen() {
  const { canAction } = usePermission();
  const canManage = canAction('S_ADM_COMMUTE_POLICY', 'update');
  const { policy = DEFAULT_COMMUTE_POLICY, isLoading, savePolicy } = useCommutePolicy();
  const [editing, setEditing] = useState(false);

  return (
    <div className="mx-auto w-full max-w-[760px] space-y-3 px-3 py-4 sm:px-5 sm:py-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-ink">근무 정책</h1>
          <p className="mt-0.5 text-xs text-ink3">근태·휴가 / 근무 정책</p>
        </div>
        {canManage && (
          <Button size="sm" variant="primary" onClick={() => setEditing(true)} disabled={isLoading}>
            <Pencil size={12} />
            <span>수정</span>
          </Button>
        )}
      </div>

      <div className="divide-y divide-border rounded-xl border border-border bg-panel shadow-2xs">
        <Row label="근무제" value={policy.name} />
        <Row label="정규 근무 시간" value={`${policy.workStartTime} ~ ${policy.workEndTime}`} />
        <Row
          label="점심·휴게 시간"
          value={`${policy.breakStartTime} ~ ${policy.breakEndTime}`}
          sub={`${breakMinutesOf(policy.breakStartTime, policy.breakEndTime)}분 공제`}
        />
        <Row label="지각 유예" value={policy.lateGraceMin > 0 ? `${policy.lateGraceMin}분` : '없음'} sub={policy.lateGraceMin > 0 ? undefined : '출근 시각이 지나면 지각'} />
        {policy.updatedAt && <Row label="마지막 수정" value={policy.updatedAt.slice(0, 16).replace('T', ' ')} sub={policy.updatedBy && policy.updatedBy !== 'system' ? policy.updatedBy : undefined} />}
      </div>

      {editing && <CommutePolicyModal isOpen policy={policy} onClose={() => setEditing(false)} onSave={savePolicy} />}
    </div>
  );
}
