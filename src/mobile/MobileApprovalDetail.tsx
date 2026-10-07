import { useEffect, useRef, useState } from 'react';
import { Smartphone, ZoomIn, Paperclip, AlertTriangle, CheckCircle2, X, Info } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/app/auth/AuthProvider';
import { usePermission } from '@/features/auth/usePermission';
import { useUsers } from '@/features/user/useUsers';
import { useApprovalDoc, useDecideStep } from '@/features/gw/useApprovals';
import { useAutoMarkPostRead, useDocPostReads } from '@/features/gw/usePostReadShares';
import { useMarkApprovalReadOnOpen } from '@/features/gw/useApprovalUnread';
import { useApprovalForms } from '@/features/gw/useApprovalForms';
import { activeSteps, isActiveApprover } from '@/domain/approvalDoc/engine';
import type { ApprovalDoc, ApprovalStep } from '@/domain/approvalDoc/schema';
import type { ApprovalForm, FormField, FieldValue } from '@/domain/approvalForm/schema';
import { RESERVED_BODY_KEY } from '@/domain/approvalForm/schema';
import { fieldText, getCellMergeInfo, type CellMerge, type OrgLite } from '@/modules/gw/approval/formFields';
import { fmtDocDate, statusColor } from './MobileApprovalList';
import { ApprovalDocumentView } from '@/modules/gw/approval/ApprovalDocumentView';
import { downloadFile } from '@/shared/lib/download';
import { useDocumentNotificationRead } from '@/features/notification/useDocumentNotificationRead';

const FALLBACK_CLOSING: Record<string, string> = {
  기안: '위와 같이 기안하오니 재가하여 주시기 바랍니다.',
  품의: '위와 같이 품의하오니 재가하여 주시기 바랍니다.',
  지출결의: '위와 같이 지출을 청구하오니 재가하여 주시기 바랍니다.',
  휴가: '위와 같이 휴가를 신청하오니 재가하여 주시기 바랍니다.',
};

/**
 * 모바일 PWA 전자결재 상세 — 문서 열람 + 승인/반려(반려 시 의견 필수).
 * Flutter approval_detail_screen 과 동일 UX. 웹 useDecideStep/엔진 재사용.
 */
export default function MobileApprovalDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const me = user!.id;
  // 문서를 열면 읽음으로 기록(안읽음 표시 해제) — 알림으로 바로 들어온 경우 포함
  useMarkApprovalReadOnOpen(me, id);
  const doc = useApprovalDoc(id);
  useAutoMarkPostRead(doc?.id ?? '', me);
  // 후열(공람)로 전달받은 사람은 문서를 열람할 수 있다. 보안 필드는 그대로 가린다(웹 ApprovalDocumentView와 같은 규칙).
  const postReadQuery = useDocPostReads(doc?.id ?? '');
  const isPostReadRecipient = (postReadQuery.data ?? []).some((s) => s.toUserId === me);
  const { data: users = [] } = useUsers();
  const { data: forms = [] } = useApprovalForms();
  const form = forms.find((f) => f.code === doc?.docType);
  const decide = useDecideStep();
  const [modalDecision, setModalDecision] = useState<'승인' | '반려' | null>(null);
  const [modalComment, setModalComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [viewMode, setViewMode] = useState<'compact' | 'original'>('compact');
  const [zoomIn, setZoomIn] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(360);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width) {
          setContainerWidth(entry.contentRect.width);
        }
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [viewMode]);

  const back = () => nav('/m/approval');

  const nameOf = (approverId: string, snapshot?: string | null) =>
    snapshot || users.find((u) => u.id === approverId)?.name || approverId;

  const openDecisionModal = (decision: '승인' | '반려') => {
    setModalDecision(decision);
    setModalComment('');
  };

  const closeDecisionModal = () => {
    if (busy) return;
    setModalDecision(null);
    setModalComment('');
  };

  const confirmDecision = async () => {
    if (!doc || !modalDecision) return;
    const myStep = activeSteps(doc).find((s) => s.approverId === me);
    if (!myStep) return;
    if (modalDecision === '반려' && !modalComment.trim()) {
      window.alert('반려 사유(의견)를 입력하세요.');
      return;
    }
    setBusy(true);
    try {
      await decide.mutateAsync({
        id: doc.id,
        seq: myStep.seq,
        userId: me,
        decision: modalDecision,
        comment: modalComment.trim(),
      });
      setModalDecision(null);
      back();
    } catch (e) {
      window.alert(`처리 실패: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  };

  const myTurn = !!doc && isActiveApprover(doc, me);

  const { isAdmin, isExecutive: hasExecRole } = usePermission();
  const userObj = users.find((u) => u.id === me);
  const userPos = userObj?.position ?? '';
  const isExecutive =
    isAdmin ||
    hasExecRole ||
    ['대표이사', '상무', '상무이사', '전무', '부사장', '사장'].includes(userPos) ||
    userObj?.dept === '대표이사';

  const canAccessDocument = (() => {
    if (!doc) return true;
    const isDrafter = doc.drafterId === me;
    const isApprover = doc.steps.some((s) => s.approverId === me);
    const isRecipient = doc.recipients?.some((r) => r.id === me || r.id === userObj?.dept);
    const isExecutor = doc.executionDepts?.some((d) => d.id === userObj?.dept) || doc.executionsSnapshot?.some((s) => s.deptId === userObj?.dept || s.deptName === userObj?.dept);
    const isOfficialRelated = isDrafter || isApprover || !!isRecipient || !!isExecutor || isPostReadRecipient;

    if (isOfficialRelated || isExecutive) return true;

    const vis = doc.visibility ?? '부서';
    if (vis === '비공개') return false;

    const isSameDept = doc.drafterDept === userObj?.dept;
    if (vis === '부서' && !isSameDept) return false;

    const secLevel = doc.securityLevel ?? '일반';
    if (secLevel === '일반') return true;

    return false;
  })();

  const canViewSecret = (() => {
    if (!doc) return false;
    if (isExecutive) return true;
    if (doc.status === '완료' && doc.drafterId === me) return true;
    if (doc.steps.some((s) => s.approverId === me && s.kind !== '참조')) return true;
    return false;
  })();

  useDocumentNotificationRead(me, viewMode === 'compact' && canAccessDocument ? doc?.id : undefined);

  const isMaskingActive = !canViewSecret;

  const maskValue = (rawVal: string, isSecret?: boolean) => {
    if (!isSecret || !isMaskingActive) return rawVal;
    if (!rawVal || rawVal === '—') return '—';
    if (/^\d{6}[-s]?\d{7}$/.test(rawVal)) {
      return rawVal.replace(/^(\d{6})[-s]?\d{7}$/, '$1-*******');
    }
    if (!isNaN(Number(rawVal.replace(/[^0-9]/g, ''))) && rawVal.length > 2) {
      return '₩ ***,***,*** 원';
    }
    return '[보안 처리된 정보입니다]';
  };

  return (
    <div className="flex h-full flex-col" style={{ background: '#f0f4f8' }}>
      <header className="flex shrink-0 items-center justify-between px-3 py-3 text-white" style={{ background: '#101830' }}>
        <div className="flex items-center gap-2">
          <button onClick={back} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[18px] hover:bg-white/10">←</button>
          <span className="text-[15px] font-bold">전자결재 상세</span>
        </div>
        {doc && (
          <button
            onClick={() => setViewMode((m) => (m === 'compact' ? 'original' : 'compact'))}
            className="rounded-lg border border-white/20 bg-white/10 px-2.5 py-1 text-[11px] font-bold hover:bg-white/20 transition-all select-none active:scale-95"
          >
            {viewMode === 'compact' ? '📄 원본문서 보기' : '📱 컴팩트 보기'}
          </button>
        )}
      </header>

      {!doc ? (
        <div className="grid flex-1 place-items-center text-[12px] text-ink3">문서를 불러오는 중…</div>
      ) : !canAccessDocument && postReadQuery.isLoading ? (
        <div className="grid flex-1 place-items-center text-[12px] text-ink3">열람 권한 확인 중…</div>
      ) : !canAccessDocument ? (
        <div className="flex-1 p-6 flex flex-col items-center justify-center text-center space-y-3 bg-white m-4 rounded-xl border border-black/10">
          <div className="text-[32px]">🛡️</div>
          <div className="text-[14px] font-bold text-ink" style={{ color: '#101830' }}>열람할 수 없는 보안 문서입니다.</div>
          <div className="text-[11.5px] text-ink3 max-w-xs leading-relaxed">
            본 문서는 <span className="font-semibold text-danger">[{doc.securityLevel ?? '대외비'}]</span> 보안 등급 문서로 지정되어 모바일 PWA에서의 접근 권한이 제한되어 있습니다.
          </div>
          <button onClick={back} className="mt-2 rounded-lg bg-[#2563eb] px-4 py-2 text-[12.5px] font-semibold text-white">뒤로가기</button>
        </div>
      ) : (
        <>
          {viewMode === 'original' ? (
            <div ref={containerRef} className="min-h-0 flex-1 overflow-auto bg-white p-3 shadow-inner relative select-none">
              <div
                style={{
                  zoom: zoomIn ? 1 : Math.max(0.1, (containerWidth - 24) / 780),
                  width: '780px',
                  cursor: zoomIn ? 'zoom-out' : 'zoom-in',
                }}
                onClick={() => setZoomIn((z) => !z)}
                title={zoomIn ? "클릭 시 화면에 맞춤" : "클릭 시 100% 크기로 확대"}
              >
                <ApprovalDocumentView doc={doc} currentUser={{ id: me }} />
              </div>

              {/* 줌 제어 플로팅 버튼 */}
              <div className="absolute bottom-4 right-4 z-10">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setZoomIn((z) => !z); }}
                  className="rounded-full bg-[#2563eb] px-3 py-2 text-[10.5px] font-extrabold text-white shadow-xl active:scale-95 transition-all select-none border border-white/10 flex items-center gap-1"
                >
                  {zoomIn ? (
                    <>
                      <Smartphone size={13} /> 화면맞춤
                    </>
                  ) : (
                    <>
                      <ZoomIn size={13} /> 100% 확대
                    </>
                  )}
                </button>
              </div>
            </div>
          ) : (
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
              {/* 문서 헤더 카드 */}
              <Card>
                <div className="flex items-center gap-1.5">
                  <span className="rounded-md px-1.5 py-0.5 text-[10px] font-bold" style={{ background: '#dbeafe', color: '#1e40af' }}>{doc.docType}</span>
                  <span className="rounded-md px-1.5 py-0.5 text-[10px] font-bold" style={{ background: `${statusColor(doc.status)}1f`, color: statusColor(doc.status) }}>{doc.status}</span>
                  <span className="ml-auto text-[11px] tabular-nums text-ink3">{doc.docNo}</span>
                </div>
                <div className="mt-2.5 text-[17px] font-bold" style={{ color: '#101830' }}>{doc.title}</div>
                <div className="my-3 h-px bg-black/10" />
                <InfoRow label="기안자" value={`${doc.drafterName || nameOf(doc.drafterId)}${doc.drafterDept ? ` (${doc.drafterDept})` : ''}`} />
                <InfoRow label="기안일시" value={fmtDocDate(doc.submittedAt ?? doc.createdAt)} />
                {doc.amount != null && <InfoRow label="금액" value={`${fmtAmount(doc.amount)} 원`} />}
                {doc.docType === '휴가' && doc.form && (
                  <>
                    <InfoRow label="휴가종류" value={doc.form.leaveType} />
                    <InfoRow label="기간" value={`${doc.form.startDate} ~ ${doc.form.endDate}${doc.form.days ? ` (${doc.form.days}일)` : ''}`} />
                  </>
                )}
              </Card>

              {/* 선조치 결재(사후 감사 대상) 카드 */}
              {doc.isPostApproval && (
                <div className="rounded-xl border border-rose-200 bg-rose-50/30 p-4 space-y-2.5">
                  <div className="flex items-center gap-1.5 text-[13px] font-bold text-rose-800">
                    <span>🚨 사후 감사 대상 (선조치 결재)</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[11.5px] border-b border-rose-100 pb-2">
                    <div>
                      <span className="text-rose-700/80">선조치 일시: </span>
                      <span className="font-semibold text-rose-900">{doc.postApprovedAt ? fmtDocDate(doc.postApprovedAt) : '—'}</span>
                    </div>
                    <div>
                      <span className="text-rose-700/80">임시 승인자: </span>
                      <span className="font-semibold text-rose-900">{doc.postApprovedByName ?? '—'}</span>
                    </div>
                  </div>
                  {doc.postApprovalActionTaken && (
                    <div className="text-[11.5px]">
                      <div className="font-bold text-rose-800">1. 선조치 내용 및 결과</div>
                      <div className="mt-0.5 rounded bg-white p-2 border border-rose-100/70 whitespace-pre-wrap text-ink leading-relaxed">{doc.postApprovalActionTaken}</div>
                    </div>
                  )}
                  {doc.postApprovalNecessity && (
                    <div className="text-[11.5px]">
                      <div className="font-bold text-rose-800">2. 긴급성 및 불가피성 소명</div>
                      <div className="mt-0.5 rounded bg-white p-2 border border-rose-100/70 whitespace-pre-wrap text-ink leading-relaxed">{doc.postApprovalNecessity}</div>
                    </div>
                  )}
                </div>
              )}

              {/* 결재선 타임라인 */}
              <div>
                <div className="mb-2 text-[14px] font-bold" style={{ color: '#101830' }}>결재선</div>
                <Card>
                  <div className="flex flex-col gap-2">
                    {(() => {
                      interface StepGroup {
                        key: string;
                        parallelGroup: string | number | null;
                        steps: ApprovalStep[];
                      }
                      const groups: StepGroup[] = [];
                      doc.steps.forEach((s) => {
                        if (s.parallelGroup) {
                          const last = groups[groups.length - 1];
                          if (last && last.parallelGroup === s.parallelGroup) {
                            last.steps.push(s);
                          } else {
                            groups.push({ key: `p-${s.parallelGroup}`, parallelGroup: s.parallelGroup, steps: [s] });
                          }
                        } else {
                          groups.push({ key: `s-${s.seq}`, parallelGroup: null, steps: [s] });
                        }
                      });

                      return groups.map((g) => {
                        if (g.steps.length > 1) {
                          return (
                            <div key={g.key} className="flex items-start gap-2.5 py-0.5">
                              {/* 박스 바깥 좌측에 위치할 단일 대표 순번 원 */}
                              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white mt-3" style={{ background: '#8b5cf6' }}>
                                {g.steps[0].seq}
                              </span>
                              {/* 병렬 묶음 박스 */}
                              <div className="flex-1 min-w-0 rounded-2xl border border-[#d0e6f7] bg-[#f8fbfe]/60 p-3 space-y-1 shadow-[0_2px_8px_rgba(30,50,90,0.015)]">
                                {g.steps.map((s) => (
                                  <StepRow key={s.seq} doc={doc} step={s} name={nameOf(s.approverId, s.approverName)} hideSeq={true} users={users} />
                                ))}
                              </div>
                            </div>
                          );
                        }
                        const s = g.steps[0];
                        return <StepRow key={s.seq} doc={doc} step={s} name={nameOf(s.approverId, s.approverName)} users={users} />;
                      });
                    })()}
                  </div>
                </Card>
              </div>

              {/* 본문 */}
              <div>
                <div className="mb-2 text-[14px] font-bold" style={{ color: '#101830' }}>본문</div>
                <Card>
                  <ApprovalBody doc={doc} form={form} users={users} isMaskingActive={isMaskingActive} maskValue={maskValue} />
                  
                  {/* 맺음말 격식 보완 */}
                  <div className="mt-4 pt-3 border-t border-black/5 text-center">
                    <div className="text-[11.5px] italic text-ink3 leading-relaxed">
                      {form?.closing || FALLBACK_CLOSING[doc.docType] || '위와 같이 신청하오니 재가하여 주시기 바랍니다.'}
                    </div>
                    <div className="mt-3.5 text-[11px] font-bold text-ink2 tabular-nums">
                      {fmtDocDate(doc.submittedAt ?? doc.createdAt)}
                    </div>
                    <div className="mt-1 text-[12px] font-bold text-ink" style={{ color: '#101830' }}>
                      기안자: {doc.drafterName || nameOf(doc.drafterId)}
                    </div>
                  </div>
                </Card>
              </div>

              {/* 첨부파일 */}
              {doc.attachments && doc.attachments.length > 0 && (
                <div>
                  <div className="mb-2 text-[14px] font-bold" style={{ color: '#101830' }}>첨부파일</div>
                  <Card>
                    <div className="flex flex-col gap-2">
                      {doc.attachments.map((file, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => void downloadFile(file.url, file.name)}
                          className="flex items-center justify-between rounded-lg border border-black/5 bg-black/[0.02] px-3 py-2 text-[12.5px] hover:bg-black/[0.04] active:scale-[0.99] transition-all text-left w-full cursor-pointer"
                        >
                          <span className="font-semibold text-ink truncate mr-2 flex items-center gap-1">
                            <Paperclip size={12} className="shrink-0 text-ink3" /> {file.name}
                          </span>
                          <span className="shrink-0 text-[11px] font-bold text-amber-600 bg-amber-500/10 px-2 py-0.5 rounded">다운로드</span>
                        </button>
                      ))}
                    </div>
                  </Card>
                </div>
              )}
            </div>
          )}

          {/* 액션바 — 내 결재 차례일 때만 */}
          {myTurn && (
            <div className="shrink-0 border-t border-black/10 bg-white p-3 shadow-lg" style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}>
              <div className="flex gap-2.5">
                <button
                  type="button"
                  onClick={() => openDecisionModal('반려')}
                  disabled={busy}
                  className="flex-1 rounded-xl border border-[#e0483b]/40 bg-red-50/40 py-3 text-[15px] font-bold text-[#e0483b] active:scale-[0.98] transition-all disabled:opacity-50 shadow-xs"
                >
                  반려
                </button>
                <button
                  type="button"
                  onClick={() => openDecisionModal('승인')}
                  disabled={busy}
                  className="flex-1 rounded-xl py-3 text-[15px] font-bold text-white active:scale-[0.98] transition-all disabled:opacity-50 shadow-sm"
                  style={{ background: '#16a34a' }}
                >
                  승인
                </button>
              </div>
            </div>
          )}

          {/* 반려 문서인 경우 하단 안내바 */}
          {!myTurn && (doc.status === '반려' || doc.status === '긴급 조치 사후 검토 반려' || doc.status === '시행반송') && (
            <div className="shrink-0 border-t border-slate-200/80 bg-slate-50/90 p-3.5 text-center shadow-xs" style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}>
              <p className="text-[12px] text-slate-600 flex items-center justify-center gap-1.5 font-medium">
                <Info size={15} className="text-blue-500 shrink-0" strokeWidth={2.2} />
                <span>반려 문서의 <strong className="text-slate-800 font-bold">편집 및 재상신</strong>은 <strong className="text-blue-600 font-bold">PC 웹</strong>에서 진행해 주시기 바랍니다.</span>
              </p>
            </div>
          )}
        </>
      )}

      {/* 승인/반려 확인 및 의견 입력 모달 */}
      {modalDecision && doc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
          onClick={closeDecisionModal}
        >
          <div
            className="flex w-full max-w-sm flex-col overflow-hidden rounded-2xl bg-white shadow-2xl border border-slate-100"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 헤더 */}
            <div
              className={`flex items-center justify-between border-b px-5 py-3.5 ${
                modalDecision === '반려' ? 'border-red-100 bg-red-50/70' : 'border-emerald-100 bg-emerald-50/70'
              }`}
            >
              <div className="flex items-center gap-2">
                {modalDecision === '반려' ? (
                  <AlertTriangle size={18} className="text-[#e0483b]" />
                ) : (
                  <CheckCircle2 size={18} className="text-[#16a34a]" />
                )}
                <span
                  className="text-[15px] font-extrabold"
                  style={{ color: modalDecision === '반려' ? '#b91c1c' : '#15803d' }}
                >
                  {modalDecision === '반려'
                    ? (activeSteps(doc).find((s) => s.approverId === me)?.kind === '합의' ? '합의 반려 확인' : '결재 반려 확인')
                    : (activeSteps(doc).find((s) => s.approverId === me)?.kind === '합의' ? '합의 승인 확인' : '결재 승인 확인')}
                </span>
              </div>
              <button
                type="button"
                onClick={closeDecisionModal}
                disabled={busy}
                className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-black/5 active:scale-95"
              >
                <X size={18} />
              </button>
            </div>

            {/* 본문 */}
            <div className="p-5 space-y-3.5">
              <div className="rounded-xl bg-slate-50 p-3 border border-slate-100">
                <div className="text-[11px] font-semibold text-slate-500">문서 제목</div>
                <div className="text-[13px] font-bold text-[#101830] truncate mt-0.5">{doc.title}</div>
              </div>

              <p className="text-[12px] text-slate-600 leading-relaxed">
                {modalDecision === '반려'
                  ? '이 결재 문서를 반려하시겠습니까? 기안자가 확인할 수 있도록 사유를 반드시 입력해 주세요.'
                  : '이 결재 문서를 승인하시겠습니까? 필요한 경우 의견을 남기실 수 있습니다.'}
              </p>

              <div>
                <label className="block text-[11.5px] font-bold text-slate-700 mb-1.5 flex items-center justify-between">
                  <span>{modalDecision === '반려' ? '반려 사유' : '결재 의견'}</span>
                  <span
                    className={`text-[10.5px] font-medium ${
                      modalDecision === '반려' ? 'text-red-500 font-bold' : 'text-slate-400'
                    }`}
                  >
                    {modalDecision === '반려' ? '(필수 입력)' : '(선택 사항)'}
                  </span>
                </label>
                <textarea
                  value={modalComment}
                  onChange={(e) => setModalComment(e.target.value)}
                  placeholder={
                    modalDecision === '반려'
                      ? '반려 사유를 구체적으로 입력해 주세요 (필수)'
                      : '승인 의견이나 전달사항을 입력하세요 (선택)'
                  }
                  rows={3}
                  autoFocus
                  className={`w-full resize-none rounded-xl border p-3 text-[13px] text-[#101830] outline-none transition-all placeholder:text-slate-400 ${
                    modalDecision === '반려'
                      ? 'border-red-200 focus:border-red-500 focus:ring-2 focus:ring-red-100'
                      : 'border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100'
                  }`}
                />
              </div>
            </div>

            {/* 하단 버튼 */}
            <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/50 px-5 py-3">
              <button
                type="button"
                onClick={closeDecisionModal}
                disabled={busy}
                className="flex-1 rounded-xl bg-slate-200/80 py-2.5 text-[13.5px] font-bold text-slate-700 hover:bg-slate-300 active:scale-95 transition-all disabled:opacity-50"
              >
                취소
              </button>
              <button
                type="button"
                onClick={confirmDecision}
                disabled={busy || (modalDecision === '반려' && !modalComment.trim())}
                className={`flex-1 rounded-xl py-2.5 text-[13.5px] font-bold text-white active:scale-95 transition-all shadow-sm disabled:opacity-40 disabled:cursor-not-allowed ${
                  modalDecision === '반려'
                    ? 'bg-[#e0483b] hover:bg-red-600'
                    : 'bg-[#16a34a] hover:bg-green-700'
                }`}
              >
                {busy
                  ? '처리 중…'
                  : modalDecision === '반려'
                  ? '반려 확정'
                  : activeSteps(doc).find((s) => s.approverId === me)?.kind === '합의'
                  ? '합의 승인'
                  : '승인 확정'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-[0_4px_20px_rgba(30,50,90,0.03)]">{children}</div>;
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-2 py-0.5">
      <span className="w-16 shrink-0 text-[12.5px] text-ink3">{label}</span>
      <span className="flex-1 text-[12.5px] font-semibold text-ink">{value}</span>
    </div>
  );
}

function StepRow({ doc, step, name, hideSeq, users }: { doc: ApprovalDoc; step: ApprovalStep; name: string; hideSeq?: boolean; users?: any[] }) {
  const isApproved = step.decision === '승인';
  const isRejected = step.decision === '반려';
  const isPending = step.decision === '대기';
  const isHold = step.decision === '보류';
  const isActive = activeSteps(doc).some((s) => s.seq === step.seq);

  const position = step.approverPos || users?.find((u) => u.id === step.approverId)?.position || '';

  const color = (() => {
    if (isRejected) return '#e0483b'; // 반려 (레드)
    if (isApproved) return '#1890ff'; // 승인 (하늘색/연파랑)
    if (isHold) return '#e6960c';     // 보류 (오렌지/골드)
    
    // 합의 대기 또는 합의 요청 중일 때 보라색 적용
    if (step.kind === '합의' && isPending) {
      return '#8b5cf6'; // 보라색
    }
    
    // 일반 결재대기인 경우 주황색
    if (isActive && isPending && step.kind === '결재') {
      return '#e6960c'; // 주황색
    }
    
    if (isActive) return '#2563eb';   // 일반 진행중 (블루)
    return '#8a8f98';                 // 미지정/대기 (그레이)
  })();

  const badgeText = (() => {
    if (isApproved) return '승인';
    if (isRejected) return '반려';
    if (isHold) return '보류';
    if (step.kind === '합의') {
      if (isActive && isPending) return '합의대기';
      if (isPending) return '합의요청';
      return step.decision;
    }
    if (isActive && isPending) return '결재대기';
    return step.decision;
  })();

  return (
    <div className="flex items-center gap-2.5 py-1.5">
      {!hideSeq && (
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white transition-colors" style={{ background: color }}>
          {step.seq}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="shrink-0 text-[10px] font-bold text-ink3" style={{ color: step.kind === '합의' ? '#8b5cf6' : undefined }}>{step.kind}</span>
          <span className="truncate text-[12.5px] font-bold text-ink">
            {name}
            {position ? ` ${position}` : ''}
          </span>
        </div>
        {step.comment && <div className="mt-0.5 truncate text-[11px] italic text-ink3">“{step.comment}”</div>}
      </div>
      <span
        className="shrink-0 rounded-md px-2 py-0.5 text-[10.5px] font-bold transition-all"
        style={{ background: `${color}1a`, color: color }}
      >
        {badgeText}
      </span>
    </div>
  );
}

function fmtAmount(n: number): string {
  return n.toLocaleString('ko-KR');
}

/**
 * 본문 렌더 — 결재서식 동적 필드(fieldValues)를 라벨·순서·섹션·타입대로 표시.
 * 서식 미로드 시 freeform body 폴백, 전부 비면 '(본문 없음)'.
 * (데스크톱 ApprovalDocumentView 와 동일한 fieldText 규칙 및 마스킹/보안 정책 재사용)
 */
function ApprovalBody({
  doc,
  form,
  users,
  isMaskingActive,
  maskValue,
}: {
  doc: ApprovalDoc;
  form?: ApprovalForm;
  users: OrgLite['users'];
  isMaskingActive: boolean;
  maskValue: (rawVal: string, isSecret?: boolean) => string;
}) {
  const org: OrgLite = { users, depts: [] };
  const values: Record<string, FieldValue> = { ...doc.fieldValues };
  if (doc.body) values[RESERVED_BODY_KEY] = doc.body; // 컬럼 body 를 예약키 값으로 우선

  const rows: React.ReactNode[] = [];

  if (form && form.fields.length > 0) {
    let lastSection = '';
    const isVisible = (f: FormField) => {
      if (!f.visibleIf) return true;
      const parts = f.visibleIf.split(':');
      if (parts.length !== 2) return true;
      return String(values[parts[0]] ?? '') === parts[1];
    };
    for (const f of form.fields) {
      if (f.type === '안내문') continue;
      if (!isVisible(f)) continue;

      const pushSection = () => {
        if (f.section && f.section !== lastSection) {
          rows.push(
            <div key={`sec-${f.key}`} className="pb-1.5 pt-2.5 text-[12.5px] font-bold" style={{ color: '#101830' }}>
              {f.section}
            </div>,
          );
          lastSection = f.section;
        }
      };

      if (f.type === '표') {
        const tbl = renderTable(f, values, isMaskingActive, maskValue);
        if (!tbl) continue;
        pushSection();
        rows.push(
          <div key={f.key} className="py-1.5">
            {f.label && <div className="mb-1 text-[11.5px] text-ink3">{f.label}</div>}
            {tbl}
          </div>,
        );
        continue;
      }

      const rawText = fieldText(f, values, org);
      const text = maskValue(rawText, f.isSecret);
      const isBlurred = f.isSecret && isMaskingActive;
      if (!rawText || rawText === '—') continue;
      pushSection();

      if (f.type === '장문' || f.key === RESERVED_BODY_KEY) {
        rows.push(
          <div key={f.key} className="py-1.5">
            <div className="mb-1 text-[11.5px] text-ink3 flex items-center gap-1">
              {f.label}
              {isBlurred && <span className="text-[9px] font-bold text-amber-600 bg-amber-500/10 px-1 py-0.2 rounded">🔒 보안</span>}
            </div>
            <div className={`whitespace-pre-line break-words text-[13px] leading-relaxed text-ink ${isBlurred ? 'blur-xs select-none opacity-60' : ''}`} style={{ overflowWrap: 'anywhere' }}>
              {text}
            </div>
          </div>,
        );
      } else {
        rows.push(
          <div key={f.key} className="flex items-start gap-2 py-1">
            <span className="w-20 shrink-0 text-[12.5px] text-ink3">{f.label}</span>
            <span className={`min-w-0 flex-1 whitespace-pre-line break-words text-[12.5px] font-semibold text-ink ${isBlurred ? 'blur-xs select-none opacity-60' : ''}`} style={{ overflowWrap: 'anywhere' }}>
              {text}
            </span>
            {isBlurred && <span className="shrink-0 text-[9px] font-bold text-amber-600 bg-amber-500/10 px-1.5 py-0.5 rounded">🔒 보안</span>}
          </div>,
        );
      }
    }
  } else if (doc.body) {
    rows.push(
      <div key="body" className="whitespace-pre-line break-words text-[13px] leading-relaxed text-ink" style={{ overflowWrap: 'anywhere' }}>
        {doc.body}
      </div>,
    );
  }

  if (rows.length === 0) return <div className="text-[13px] text-ink">(본문 없음)</div>;
  return <div className="flex flex-col">{rows}</div>;
}

/** 표(表) 필드 렌더 — { cols, rows, headerValues } 구조. 병합 및 셀 단위 마스킹 처리 완벽 이식. */
function renderTable(
  f: FormField,
  values: Record<string, FieldValue>,
  isMaskingActive: boolean,
  maskValue: (rawVal: string, isSecret?: boolean) => string
): React.ReactNode | null {
  const raw = values[f.key];
  if (typeof raw !== 'string' || !raw) return null;

  let cols: string[] = ['구분', '항목', '내용'];
  let rows: Array<Record<string, string>> = [];
  let merges: CellMerge[] = [];
  let headerValues: Record<string, string> = {};
  let secretCols: string[] = [];
  let secretCells: string[] = [];
  let secretRows: number[] = [];

  if (f.placeholder) {
    try {
      const cfg = JSON.parse(f.placeholder);
      if (cfg && typeof cfg === 'object') {
        if (cfg.cols) cols = cfg.cols;
        if (Array.isArray(cfg.merges)) merges = cfg.merges;
        if (cfg.headerValues) headerValues = cfg.headerValues;
        if (Array.isArray(cfg.secretCols)) secretCols = cfg.secretCols;
        if (Array.isArray(cfg.secretCells)) secretCells = cfg.secretCells;
        if (Array.isArray(cfg.secretRows)) secretRows = cfg.secretRows;
      }
    } catch (e) { }
  }

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      if (Array.isArray(parsed.cols) && Array.isArray(parsed.rows)) {
        cols = parsed.cols;
        rows = parsed.rows;
        if (Array.isArray(parsed.merges)) merges = parsed.merges;
        if (parsed.headerValues) headerValues = parsed.headerValues;
        if (Array.isArray(parsed.secretCols)) secretCols = parsed.secretCols;
        if (Array.isArray(parsed.secretCells)) secretCells = parsed.secretCells;
        if (Array.isArray(parsed.secretRows)) secretRows = parsed.secretRows;
      }
    }
  } catch (e) { }

  if (cols.length === 0) return null;

  const isNum = (c: string) => /수량|단가|가격|금액|수|율/.test(c);
  const fmt = (c: string, v: string) => {
    if (v === '' || v == null) return '—';
    if (isNum(c)) {
      const n = Number(String(v).replace(/,/g, ''));
      if (!isNaN(n)) return n.toLocaleString('ko-KR');
    }
    return v;
  };

  return (
    <div className="overflow-x-auto my-1.5 rounded-lg border border-black/10">
      <table className="w-full border-collapse text-[11.5px] table-fixed min-w-[500px]">
        <tbody>
          <tr style={{ background: '#f9f9f9' }}>
            {cols.map((c, i) => {
              const { isMerged, isStart, rowSpan, colSpan } = getCellMergeInfo(-1, i, merges);
              if (isMerged && !isStart) return null;
              return (
                <th
                  key={i}
                  rowSpan={rowSpan > 1 ? rowSpan : undefined}
                  colSpan={colSpan > 1 ? colSpan : undefined}
                  className="border border-black/10 p-1.5 font-bold text-ink3 text-center"
                >
                  {headerValues[c] ?? c}
                </th>
              );
            })}
          </tr>
          {rows.map((r, ri) => (
            <tr key={ri} className="hover:bg-black/[0.01]">
              {cols.map((c, ci) => {
                const { isMerged, isStart, rowSpan, colSpan } = getCellMergeInfo(ri, ci, merges);
                if (isMerged && !isStart) return null;

                const isCellSecret =
                  f.isSecret ||
                  secretCols.includes(c) ||
                  secretRows.includes(ri) ||
                  secretCells.includes(`${ri}:${ci}`);

                let displayVal = fmt(c, String(r?.[c] ?? ''));
                if (isCellSecret && isMaskingActive) {
                  displayVal = maskValue(displayVal, true);
                }

                const isBlurred = isCellSecret && isMaskingActive;

                return (
                  <td
                    key={ci}
                    rowSpan={rowSpan > 1 ? rowSpan : undefined}
                    colSpan={colSpan > 1 ? colSpan : undefined}
                    className={`border border-black/10 p-1.5 text-ink ${isNum(c) ? 'text-right' : 'text-left'} ${isBlurred ? 'blur-xs select-none opacity-60' : ''}`}
                  >
                    {displayVal}
                  </td>
                );
              })}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={cols.length} className="p-2 text-center text-ink3">
                등록된 데이터가 없습니다.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
