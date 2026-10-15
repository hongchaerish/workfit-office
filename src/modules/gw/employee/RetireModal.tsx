import { useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal } from '@/shared/ui/Modal';
import { ActionButton } from '@/shared/ui/ActionBar';
import type { User } from '@/domain/user/schema';
import { useUsers } from '@/features/user/useUsers';
import { useBlockingApprovals, useRetireEmployee } from '@/features/employeeProfile/useRetirement';
import { ErrorNotice } from '@/shared/ui/ErrorNotice';

interface RetireModalProps {
  open: boolean;
  user: User | null;
  onClose: () => void;
  onDone?: (message: string) => void;
}

/**
 * 퇴직 처리 확인 창 — 인명관리 전용(사용자 관리는 계정만 다룬다, 2026-10-15).
 * 처리 내역(계정 비활성화 + 상급자 재연결 + 재직 상태 '퇴직')을 요약하고,
 * 퇴직 시 정체될 진행 중 결재를 미리 알린 뒤 확정한다.
 */
export default function RetireModal({ open, user, onClose, onDone }: RetireModalProps) {
  const { data: all = [] } = useUsers();
  const { data: blocking = [], isLoading: loadingBlocking } = useBlockingApprovals(user?.id);
  const resign = useRetireEmployee();
  const [error, setError] = useState('');

  const reports = useMemo(
    () => (user ? all.filter((u) => u.managerId === user.id && u.id !== user.id) : []),
    [all, user],
  );
  const manager = useMemo(
    () => (user?.managerId ? all.find((u) => u.id === user.managerId) ?? null : null),
    [all, user],
  );

  if (!user) return null;

  const handleConfirm = async () => {
    setError('');
    try {
      const res = await resign.mutateAsync(user.id);
      onDone?.(
        `${user.name} 님을 퇴직 처리했습니다.` +
          (res.reconnectedReports > 0 ? ` (상급자 재연결 ${res.reconnectedReports}명)` : ''),
      );
      onClose();
    } catch (e) {
      setError(`퇴직 처리에 실패했습니다: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="퇴직 처리"
      width={540}
      footer={
        <>
          <ActionButton icon="refresh" label="취소" onClick={onClose} disabled={resign.isPending} />
          <ActionButton
            icon="save"
            label={resign.isPending ? '처리 중…' : '퇴직 처리 확정'}
            variant="primary"
            onClick={handleConfirm}
            disabled={resign.isPending}
          />
        </>
      }
    >
      <div className="flex flex-col gap-3.5 text-[12.5px]">
        {/* 대상자 */}
        <div className="rounded-lg border border-border bg-panel-alt px-4 py-3">
          <div className="text-[14px] font-bold text-ink">
            {user.name} <span className="text-[12px] font-normal text-ink3">{user.position}</span>
          </div>
          <div className="mt-0.5 text-[11.5px] text-ink3">
            {user.dept} · 사번 {user.empNo} · {user.email}
          </div>
        </div>

        {/* 처리 내역 요약 */}
        <div>
          <div className="mb-1.5 font-bold text-ink">이 처리로 수행되는 작업</div>
          <ul className="flex flex-col gap-1.5 text-ink2">
            <li className="flex gap-2">
              <span className="text-ink3">1.</span>
              <span>
                계정 <b>비활성화</b> — 상태를 <b>미사용</b>으로 변경하여 로그인을 차단하고, 모바일
                푸시 토큰을 제거합니다. (퇴사일 기록) 인사 재직 상태는 <b>퇴직</b>으로 바뀝니다.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="text-ink3">2.</span>
              <span>
                <b>상급자 체인 재연결</b> —{' '}
                {reports.length > 0 ? (
                  <>
                    이 사용자를 상급자로 둔 <b>{reports.length}명</b>(
                    {reports.map((r) => r.name).join(', ')})의 상급자를{' '}
                    <b>{manager ? `${manager.name} ${manager.position}` : '없음(최상위)'}</b>(으)로
                    변경합니다.
                  </>
                ) : (
                  <span className="text-ink3">이 사용자를 상급자로 둔 직원이 없습니다.</span>
                )}
              </span>
            </li>
          </ul>
        </div>

        {/* 진행중 결재 정체 경고 */}
        <div>
          <div className="mb-1.5 font-bold text-ink">진행 중 결재 정체 확인</div>
          {loadingBlocking ? (
            <div className="text-ink3">확인 중…</div>
          ) : blocking.length === 0 ? (
            <div className="rounded-md bg-teal-soft px-3 py-2 text-[11.5px] text-navy">
              현재 이 사용자가 결재해야 할 진행 중 문서가 없습니다.
            </div>
          ) : (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5">
              <div className="text-[11.5px] font-bold text-amber-800 flex items-center gap-1.5">
                <AlertTriangle size={14} className="text-amber-600 shrink-0" />
                <span>이 사용자가 현재 결재자인 진행 중 문서 {blocking.length}건이 정체됩니다.</span>
              </div>
              <ul className="mt-1.5 flex flex-col gap-1">
                {blocking.map((d) => (
                  <li key={d.id} className="text-[11px] text-amber-900">
                    · <span className="font-mono">{d.docNo}</span> {d.title}
                  </li>
                ))}
              </ul>
              <div className="mt-2 text-[10.5px] text-amber-700">
                퇴직 처리 후 해당 문서는 <b>대결/전결자 지정</b> 또는 <b>결재선 교체</b>로 별도
                처리해야 합니다. (자동 대체는 다음 단계에서 지원)
              </div>
            </div>
          )}
        </div>
        {error && <ErrorNotice message={error} />}
      </div>
    </Modal>
  );
}
