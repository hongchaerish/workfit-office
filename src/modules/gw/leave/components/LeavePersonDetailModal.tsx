import type { ReactNode } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import type { LeaveLedgerEntry } from '@/domain/leave/ledger';
import type { AdjustmentType } from '@/domain/leave/adjustmentStore';
import { Modal } from '@/shared/ui/Modal';
import { Button } from '@/shared/ui/Button';

const ADJUSTMENT_LABEL: Record<AdjustmentType, string> = {
  REWARD: '포상휴가',
  SPECIAL: '특별휴가',
  MANUAL: '기타 가감',
  PENALTY: '공제',
  CARRYOVER: '이월 조정',
};

const days = (n: number) => `${Number.isInteger(n) ? n : Number(n.toFixed(2))}일`;
const signed = (n: number) => (n > 0 ? `+${days(n)}` : days(n));

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-[11.5px] font-extrabold text-ink2">{title}</h3>
      {children}
    </section>
  );
}

function Stat({ label, value, tone = 'text-ink' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-border bg-panel-alt/40 px-2.5 py-2">
      <div className="text-[10px] font-bold text-ink3">{label}</div>
      <div className={`mt-0.5 text-[14px] font-extrabold tabular-nums ${tone}`}>{value}</div>
    </div>
  );
}

const th = 'px-2 py-1.5 text-left text-[10.5px] font-bold text-ink3';
const td = 'px-2 py-1.5 text-[11.5px] tabular-nums';

/**
 * 직원 한 명의 연차 상세 — 지금 연차 기간 숫자, 지난 기간별 발생·사용·소멸, 사용·조정 내역.
 * 업무 화면(보기 전용)과 관리자 콘솔(onAdjust 가 있으면 '연차 조정' 단추)이 같이 쓴다.
 */
export function LeavePersonDetailModal({
  entry,
  onClose,
  onAdjust,
}: {
  entry: LeaveLedgerEntry | null;
  onClose: () => void;
  onAdjust?: (entry: LeaveLedgerEntry) => void;
}) {
  if (!entry) return null;
  const e = entry;
  const inYear = (date: string) => !date || (date >= e.leaveYear.start && date <= e.leaveYear.end);
  const service = e.isUnderOneYear ? `1년 미만 (${e.serviceMonths}개월)` : `${e.serviceYears}년 ${e.serviceMonths % 12}개월`;

  return (
    <Modal
      open
      onClose={onClose}
      width={720}
      title={
        <span>
          {e.name} <span className="text-[12px] font-semibold text-ink3">{e.dept} · {e.position}</span>
        </span>
      }
      footer={
        <div className="flex justify-end gap-2">
          {onAdjust && (
            <Button size="sm" variant="primary" onClick={() => onAdjust(e)}>
              <SlidersHorizontal size={12} />
              <span>연차 조정</span>
            </Button>
          )}
          <Button size="sm" onClick={onClose}>닫기</Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-ink2">
          <span>입사일 <strong className="tabular-nums text-ink">{e.hireDate}</strong></span>
          <span>근속 <strong className="text-ink">{service}</strong></span>
          <span>연차 기간 <strong className="tabular-nums text-ink">{e.leaveYear.start} ~ {e.leaveYear.end}</strong></span>
        </div>

        <Section title="지금 연차 기간">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            <Stat label={e.isUnderOneYear ? '월별 발생' : '법정 발생'} value={days(e.entitledDays)} />
            <Stat label="조정" value={e.adjustedDays ? signed(e.adjustedDays) : '—'} tone={e.adjustedDays < 0 ? 'text-rose-500' : 'text-ink'} />
            <Stat label="총 부여" value={days(e.totalGrantedDays)} />
            <Stat label="사용" value={days(e.usedDays)} tone="text-emerald-600" />
            <Stat label="신청중" value={e.pendingDays ? days(e.pendingDays) : '—'} tone="text-amber-600" />
            <Stat label="잔여" value={days(e.remainingDays)} tone={e.remainingDays < 0 ? 'text-rose-500' : 'text-teal'} />
          </div>
          {e.advanceStatus.isAdvanceUsed && (
            <p className="text-[11px] font-semibold text-amber-600">
              선사용 {days(e.advanceStatus.offsetRemainingDays)} — 매월 개근으로 생기는 연차에서 차례로 상계
              {e.advanceStatus.estimatedFullOffsetDate ? ` (${e.advanceStatus.estimatedFullOffsetDate} 정상화 예상)` : ''}
            </p>
          )}
        </Section>

        <Section title="지난 연차 기간">
          {e.pastYears.length === 0 ? (
            <p className="text-[11.5px] text-ink3">지난 연차 기간이 없습니다.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full border-collapse">
                <thead className="bg-panel-alt/60">
                  <tr>
                    <th className={th}>기간</th>
                    <th className={`${th} text-right`}>부여</th>
                    <th className={`${th} text-right`}>사용</th>
                    <th className={`${th} text-right`}>소멸</th>
                    <th className={`${th} text-right`}>초과 사용</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {e.pastYears.map((p) => (
                    <tr key={p.start}>
                      <td className={td}>
                        {p.start} ~ {p.end}
                        {p.beforeRecords && (
                          <span className="ml-1.5 rounded border border-amber-500/30 px-1 py-0.5 text-[9.5px] font-bold text-amber-600" title="그룹웨어 휴가 기록이 시작되기 전 기간이 섞여 있어, 기록 밖 사용분은 빠져 있을 수 있습니다">
                            기록 이전 포함
                          </span>
                        )}
                      </td>
                      <td className={`${td} text-right`}>
                        {days(p.grantedDays)}
                        {p.adjustedDays !== 0 && <span className="ml-1 text-[10px] text-ink3">(조정 {signed(p.adjustedDays)})</span>}
                      </td>
                      <td className={`${td} text-right`}>{days(p.usedDays)}</td>
                      <td className={`${td} text-right font-bold ${p.expiredDays > 0 && !p.beforeRecords ? 'text-rose-500' : 'text-ink3'}`}>
                        {p.expiredDays > 0 ? (p.beforeRecords ? `최대 ${days(p.expiredDays)}` : days(p.expiredDays)) : '—'}
                      </td>
                      <td className={`${td} text-right ${p.overUsedDays > 0 ? 'text-amber-600 font-bold' : 'text-ink3'}`}>{p.overUsedDays > 0 ? days(p.overUsedDays) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <Section title={`휴가 사용 내역 (${e.leaveHistory.length})`}>
          {e.leaveHistory.length === 0 ? (
            <p className="text-[11.5px] text-ink3">사용 내역이 없습니다.</p>
          ) : (
            <div className="max-h-56 overflow-y-auto rounded-lg border border-border">
              <table className="w-full border-collapse">
                <tbody className="divide-y divide-border/60">
                  {e.leaveHistory.map((h) => {
                    const other = !inYear(h.startDate);
                    return (
                      <tr key={h.docId} className={other ? 'opacity-55' : ''}>
                        <td className={td}>{h.startDate === h.endDate ? h.startDate : `${h.startDate} ~ ${h.endDate}`}</td>
                        <td className={td}>
                          <span className="font-semibold">{h.leaveType}</span>
                          {other && <span className="ml-1.5 rounded border border-border px-1 py-0.5 text-[9.5px] font-bold text-ink3">다른 연차 기간</span>}
                        </td>
                        <td className={`${td} text-right font-bold`}>{days(h.daysCount)}</td>
                        <td className={`${td} text-right`}>
                          <span className={h.status === '완료' ? 'text-emerald-600' : 'text-amber-600'}>{h.status === '완료' ? '승인' : '결재 중'}</span>
                        </td>
                        <td className={`${td} text-right text-ink3`}>{h.docId}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <Section title={`수동 조정 내역 (${e.adjustmentHistory.length})`}>
          {e.adjustmentHistory.length === 0 ? (
            <p className="text-[11.5px] text-ink3">조정 내역이 없습니다.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full border-collapse">
                <tbody className="divide-y divide-border/60">
                  {e.adjustmentHistory.map((a) => (
                    <tr key={a.id} className={inYear(a.grantedAt) ? '' : 'opacity-55'}>
                      <td className={td}>{a.grantedAt}</td>
                      <td className={td}>{ADJUSTMENT_LABEL[a.type] ?? a.type}</td>
                      <td className={`${td} text-right font-bold ${a.deltaDays < 0 ? 'text-rose-500' : 'text-emerald-600'}`}>{signed(a.deltaDays)}</td>
                      <td className={`${td} text-ink2`}>{a.reason}</td>
                      <td className={`${td} text-right text-ink3`}>{a.grantedBy}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>
    </Modal>
  );
}
