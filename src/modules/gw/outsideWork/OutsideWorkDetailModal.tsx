import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Calendar, Car, CheckCircle2, FileText, Link2, MapPin, Phone, Target, User as UserIcon, Users, StickyNote } from 'lucide-react';
import type { User } from '@/domain/user/schema';
import { OUTSIDE_WORK_CATEGORY_LABELS } from '@/domain/outsideWork/schema';
import type { OutsideScheduleView } from '@/domain/outsideWork/view';
import type { OutsideWorkActor } from '@/data/outsideWork/outsideWork.repo';
import { useLinkOutsideWork, useOutsideSchedulesOf, useRemoveOutsideWork } from '@/features/outsideWork/useOutsideWorks';
import { Modal } from '@/shared/ui/Modal';
import { Button } from '@/shared/ui/Button';

interface OutsideWorkDetailModalProps {
  view: OutsideScheduleView;
  /** 보는 사람 — 본인 직접 등록이면 수정·삭제, 연락처 공개 범위 판단에 쓴다 */
  viewer: OutsideWorkActor & { dept?: string | null };
  users: User[];
  onClose: () => void;
  /** 직접 등록 건 수정 — 등록 모달을 여는 쪽이 처리한다 */
  onEdit?: (view: OutsideScheduleView) => void;
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function dateWithDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return `${date} (${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]})`;
}

/** 가운데를 가린 연락처 — 010-1234-5678 → 010-****-5678 */
function maskContact(v: string): string {
  return v.replace(/(\d{2,4})([-\s]?)(\d{3,4})([-\s]?)(\d{4})/, (_m, a, s1, b, s2, c) => `${a}${s1}${'*'.repeat(b.length)}${s2}${c}`);
}

function Row({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 py-1.5">
      <span className="mt-0.5 shrink-0 text-ink3">{icon}</span>
      <div className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[12.5px] text-ink">{children}</div>
    </div>
  );
}

/**
 * 외근·출장 상세 — 결재 완료 건과 직접 등록 건 공용.
 * 결재 건은 결재 문서로 가는 길을, 본인 직접 등록 건은 수정·삭제를 준다.
 */
export function OutsideWorkDetailModal({ view, viewer, users, onClose, onEdit }: OutsideWorkDetailModalProps) {
  const nav = useNavigate();
  const remove = useRemoveOutsideWork();
  const link = useLinkOutsideWork();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState('');

  const owner = users.find((u) => u.id === view.ownerUserId);
  const ownerLabel = [owner?.name ?? view.ownerName ?? '', owner?.position ?? ''].filter(Boolean).join(' ');
  const isMine = view.ownerUserId === viewer.userId;
  const canEdit = view.source === 'SELF' && isMine && viewer.active;
  const sameDept = Boolean(owner?.dept && viewer.dept && owner.dept === viewer.dept);
  const contact = view.contact ? (isMine || sameDept ? view.contact : maskContact(view.contact)) : '';

  const period = view.startDate === view.endDate ? dateWithDay(view.startDate) : `${dateWithDay(view.startDate)} ~ ${dateWithDay(view.endDate)}`;
  const time = view.startTime && view.endTime ? `${view.startTime} ~ ${view.endTime}` : '종일';
  const mapUrl = view.destination ? `https://map.naver.com/p/search/${encodeURIComponent(view.destination)}` : '';

  // [결재 건과 연결] 후보 — 기간이 겹치는 내 결재 완료 외근·출장
  const mySchedules = useOutsideSchedulesOf(viewer.userId, users.find((u) => u.id === viewer.userId)?.name ?? '');
  const linkCandidates = canEdit
    ? mySchedules.filter((v) => v.source === 'APPROVAL' && v.approval && v.startDate <= view.endDate && v.endDate >= view.startDate)
    : [];

  const doLink = async (approvalDocId: string) => {
    if (!view.self) return;
    setError('');
    try {
      await link.mutateAsync({ actor: viewer, id: view.self.id, approvalDocId });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '연결하지 못했습니다.');
    }
  };

  const doRemove = async () => {
    if (!view.self) return;
    setError('');
    try {
      await remove.mutateAsync({ actor: viewer, id: view.self.id });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '삭제하지 못했습니다.');
    }
  };

  // 결재 완료 건만 제목 옆에 작고 옅은 표시 — 직접 등록 건과 거의 같아 보이게 한다
  const sourceBadge = view.source === 'APPROVAL' ? (
    <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-ink3">
      <CheckCircle2 size={10} /> 결재 완료
    </span>
  ) : null;

  return (
    <Modal
      open
      onClose={onClose}
      width={460}
      title={(
        <span className="flex items-center gap-2">
          <span>[{OUTSIDE_WORK_CATEGORY_LABELS[view.category]}] {view.subType}</span>
          {sourceBadge}
        </span>
      )}
      footer={(
        <>
          {view.approval && (
            <Button variant="accent" onClick={() => { onClose(); nav(`/gw/approval?doc=${view.approval!.docNo || view.approval!.docId}`); }}>
              <FileText size={13} /> 결재 문서 보기
            </Button>
          )}
          {canEdit && !confirmDelete && (
            <>
              <Button
                onClick={() => setLinking((v) => !v)}
                disabled={linkCandidates.length === 0}
                title={linkCandidates.length === 0 ? '기간이 겹치는 결재 완료 외근·출장이 없습니다' : '같은 일정의 결재 문서와 연결하면 이 등록은 숨겨지고 결재 건만 보입니다'}
              >
                <Link2 size={13} /> 결재 건과 연결
              </Button>
              <Button variant="danger" onClick={() => setConfirmDelete(true)}>삭제</Button>
              <Button variant="primary" onClick={() => { onClose(); onEdit?.(view); }}>수정</Button>
            </>
          )}
          {canEdit && confirmDelete && (
            <>
              <Button onClick={() => setConfirmDelete(false)} disabled={remove.isPending}>취소</Button>
              <Button variant="dangerSolid" onClick={() => void doRemove()} disabled={remove.isPending}>
                {remove.isPending ? '삭제 중…' : '삭제 확인'}
              </Button>
            </>
          )}
          {!canEdit && <Button onClick={onClose}>닫기</Button>}
        </>
      )}
    >
      <div className="divide-y divide-border/50">
        <Row icon={<UserIcon size={14} />}>
          {ownerLabel || '—'}
          {owner?.dept && <span className="ml-1.5 text-[11px] text-ink3">· {owner.dept}</span>}
        </Row>
        <Row icon={<Calendar size={14} />}>
          {period}
          <span className="ml-2 font-semibold text-teal">{time}</span>
        </Row>
        <Row icon={<MapPin size={14} />}>
          <span className="flex items-start justify-between gap-2">
            <span>{view.destination || '—'}</span>
            {mapUrl && (
              <a href={mapUrl} target="_blank" rel="noreferrer" className="shrink-0 text-[10.5px] font-bold text-blue hover:underline">
                지도에서 보기
              </a>
            )}
          </span>
        </Row>
        {view.purpose && <Row icon={<Target size={14} />}>{view.purpose}</Row>}
        {view.companions && <Row icon={<Users size={14} />}>동행: {view.companions}</Row>}
        {(view.transportation || contact) && (
          <Row icon={<Car size={14} />}>
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {view.transportation && <span>{view.transportation}</span>}
              {contact && (
                <span className="inline-flex items-center gap-1"><Phone size={12} className="text-ink3" />{contact}</span>
              )}
            </span>
          </Row>
        )}
        {view.memo && <Row icon={<StickyNote size={14} />}>{view.memo}</Row>}
        {view.approval && (
          <Row icon={<FileText size={14} />}>
            <span className="text-[11.5px] text-ink2">{view.approval.docTitle}</span>
            {view.approval.docNo && <span className="ml-1.5 text-[10.5px] text-ink3">{view.approval.docNo}</span>}
          </Row>
        )}
      </div>
      {linking && canEdit && (
        <div className="mt-3 space-y-1.5 rounded-lg border border-border bg-panel-alt/40 p-2.5">
          <p className="text-[11px] text-ink2">연결할 결재 문서를 고르세요. 연결하면 이 등록은 업무계획·캘린더·근태에서 빠지고 결재 건만 보입니다.</p>
          {linkCandidates.map((c) => (
            <button
              key={c.key}
              type="button"
              disabled={link.isPending}
              onClick={() => void doLink(c.approval!.docId)}
              className="flex w-full items-center justify-between gap-2 rounded-md border border-border bg-panel px-2.5 py-1.5 text-left text-[11.5px] hover:border-teal disabled:opacity-50"
            >
              <span className="min-w-0 truncate font-semibold text-ink">{c.approval!.docTitle}</span>
              <span className="shrink-0 text-[10.5px] text-ink3">{c.startDate.slice(5)}~{c.endDate.slice(5)} · {c.approval!.docNo}</span>
            </button>
          ))}
        </div>
      )}
      {error && <p className="mt-2 text-[11px] font-semibold text-danger">{error}</p>}
    </Modal>
  );
}
