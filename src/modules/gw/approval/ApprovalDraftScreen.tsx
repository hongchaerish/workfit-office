import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams, useParams } from 'react-router-dom';
import { useAuth } from '@/app/auth/AuthProvider';
import type { User } from '@/domain/user/schema';
import {
  type ApprovalDoc,
  type ApprovalStep,
  type LeaveForm,
  type LeaveType,
  type ApprovalRecipient,
  type RelatedDoc,
} from '@/domain/approvalDoc/schema';
import { RESERVED_BODY_KEY, amountFieldOf, type ApprovalForm, type FieldValue } from '@/domain/approvalForm/schema';
import { type ApprovalDraftInput } from '@/data/approvalDoc/approvalDoc.repo';
import { approvalProcessRepo } from '@/data/approvalProcess/approvalProcess.repo';
import { useCreateDraft, useSaveDraft, useSubmitApproval, useApprovalDoc } from '@/features/gw/useApprovals';
import { useActiveApprovalForms } from '@/features/gw/useApprovalForms';
import { useRouteEngine } from '@/features/gw/useRouteEngine';
import { useOrgTree } from '@/features/gw/useOrgTree';
import { useLeave } from '@/features/gw/useLeave';
import { ApprovalLineBuilder } from '@/modules/gw/approval/ApprovalLineBuilder';
import { RelatedDocSearchModal } from '@/modules/gw/approval/RelatedDocSearchModal';
import { DraftConfirmDialog } from './components/DraftConfirmDialog';
import { DraftFormSelectModal } from './components/DraftFormSelectModal';
import { FormChangeConfirmDialog } from './components/FormChangeConfirmDialog';
import { DraftRecipientSection } from './components/DraftRecipientSection';
import { ApprovalDraftDocumentSheet } from './components/ApprovalDraftDocumentSheet';
import { ApprovalDocumentView } from './ApprovalDocumentView';
import { usePermission } from '@/features/auth/usePermission';
import { fileStorage } from '@/shared/lib/storage';
import {
  getDefaultTimeWindow,
  calculateLeaveDays,
  isHalfDayLeave,
  isQuarterDayLeave,
} from '@/domain/leave/policy';
import { useHolidays } from '@/features/holiday/useHolidays';
import { X, AlertTriangle, GitFork, RefreshCw, Sparkles, History, FileText, CheckCircle2, ChevronRight, Eye, Trash2 } from 'lucide-react';
import { recalculateTableFormulas, type CellFormula } from './formFields/formulaEngine';
import type { CellMerge } from './formFields/utils';
import { TAB_HEARTBEAT_MS, draftAutosaveKeys, findOrphanNewDraft, getDraftTabId, markTabAlive, tabAliveKey } from './draftAutosaveKeys';

/**
 * 브라우저 보관 상태 표시.
 *
 * 배포·새로고침 사고로 작성 내용이 사라진 뒤 붙였다. 보관되고 있다는 사실이 보여야
 * 사용자가 안심한다. 서버 임시저장과 헷갈리지 않게 "보관"이라고 부른다 —
 * 이건 이 브라우저에만 있다.
 *
 * **마지막으로 보관된 시각을 그대로 붙박아 둔다.** 경과 초를 세면 숫자가 계속 움직여
 * 시선을 뺏고, "자동 보관 중"처럼 상태만 쓰면 지금 저장 중이라는 건지 끝났다는 건지
 * 알 수 없다. 시각은 저장될 때만 바뀌므로 조용하면서도 갱신이 눈에 띈다.
 */
function AutosaveIndicator({ at }: { at: number | null }) {
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (at === null) return;
    setFlash(true);
    const id = setTimeout(() => setFlash(false), 900);
    return () => clearTimeout(id);
  }, [at]);

  if (at === null) return null;

  const stamp = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(at);

  return (
    <span
      className="flex items-center gap-1.5 px-1 text-[11px] font-semibold tabular-nums text-ink3"
      title="작성 중인 내용이 이 브라우저에 보관됩니다. 새로고침하거나 탭을 닫아도 복구할 수 있습니다."
    >
      <span className={`h-1.5 w-1.5 rounded-full transition-colors duration-300 ${flash ? 'bg-ok' : 'bg-ink3/40'}`} />
      마지막 보관 {stamp}
    </span>
  );
}

export default function ApprovalDraftScreen() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { id: editDocId } = useParams<{ id?: string }>();

  // 수정할 문서가 있는 경우 전체 목록 훅을 통해 단일 문서 도출
  const fetchedDoc = useApprovalDoc(editDocId);
  const cancelTargetId = params.get('cancelTargetId') ?? undefined;
  const cancelTargetDoc = useApprovalDoc(cancelTargetId);

  if (!user) {
    return (
      <div className="flex h-full items-center justify-center py-20 text-[13px] text-ink3">
        로그인이 필요한 서비스입니다.
      </div>
    );
  }

  /**
   * **수정할 문서를 다 받은 뒤에 본문을 마운트한다.**
   *
   * 예전에는 `fetchedDoc` 이 아직 없을 때도 `editDoc={null}` 로 먼저 그렸다. 그러면
   * 복구 검사가 "새 기안"으로 판단해 헛돌고, 문서가 도착해 다시 돌 때는 이미 검사를
   * 마쳤다고 표시돼 **두 번째 기회가 없었다.** "임시저장 문서를 편집하다 탭을 닫으면
   * 아무것도 안 남는다"가 여기서 나왔다.
   *
   * `key` 로 대상을 고정해, 다른 문서로 옮겨갈 때 이전 상태가 섞이지 않게 한다.
   */
  if (editDocId && !fetchedDoc) {
    return (
      <div className="flex h-full items-center justify-center py-20 text-[13px] text-ink3">
        문서를 불러오는 중…
      </div>
    );
  }

  if (cancelTargetId && !cancelTargetDoc) {
    return (
      <div className="flex h-full items-center justify-center py-20 text-[13px] text-ink3">
        취소 대상 문서를 불러오는 중…
      </div>
    );
  }

  return (
    <ApprovalDraftInner
      key={editDocId ?? (cancelTargetId ? `cancel_${cancelTargetId}` : 'new')}
      me={user}
      editDoc={fetchedDoc ?? null}
      cancelTargetDoc={cancelTargetDoc ?? null}
      fixedType={params.get('type') ?? undefined}
      initialDate={params.get('date')}
      initialLeaveType={params.get('leaveType')}
      navigate={navigate}
    />
  );
}

function ApprovalDraftInner({
  me,
  editDoc,
  cancelTargetDoc,
  fixedType,
  initialDate,
  initialLeaveType,
  navigate,
}: {
  me: User;
  editDoc?: ApprovalDoc | null;
  cancelTargetDoc?: ApprovalDoc | null;
  fixedType?: string;
  initialDate?: string | null;
  initialLeaveType?: string | null;
  navigate: (url: string) => void;
}) {
  const { canAction } = usePermission();
  const canCreate = canAction('S_GW_APPROVAL', 'create');

  const { data: forms = [] } = useActiveApprovalForms();
  const org = useOrgTree();
  const bal = useLeave(me.id);
  const userDeptId = useMemo(() => {
    return org.depts.find((d) => d.name === me.dept)?.id;
  }, [org.depts, me.dept]);

  const [code, setCode] = useState<string>(editDoc?.docType ?? (cancelTargetDoc ? '취소신청' : (fixedType ?? '기안')));
  const [title, setTitle] = useState(editDoc?.title ?? (cancelTargetDoc ? `[취소 신청] ${cancelTargetDoc.title}` : ''));
  const [securityLevel, setSecurityLevel] = useState<'일반' | '대외비' | '극비'>(editDoc?.securityLevel ?? cancelTargetDoc?.securityLevel ?? '일반');
  const [visibility, setVisibility] = useState<'부서' | '비공개'>(editDoc?.visibility === '비공개' || cancelTargetDoc?.visibility === '비공개' ? '비공개' : '부서');
  const [preservationPeriod, setPreservationPeriod] = useState<string>(editDoc?.preservationPeriod ?? cancelTargetDoc?.preservationPeriod ?? '5년');

  const [amount, setAmount] = useState<string>(editDoc?.amount != null ? String(editDoc.amount) : '');
  const [values, setValues] = useState<Record<string, FieldValue>>(() => {
    const initialVals = { ...(editDoc?.fieldValues ?? {}) };
    if (editDoc?.body && !initialVals[RESERVED_BODY_KEY]) {
      initialVals[RESERVED_BODY_KEY] = editDoc.body;
    }
    if (!editDoc && cancelTargetDoc) {
      initialVals['cancelTargetDocNo'] = cancelTargetDoc.docNo;
      initialVals['cancelTargetDocTitle'] = cancelTargetDoc.title;
      initialVals['cancelCategory'] = '전체 취소';
      initialVals['originalDrafter'] = cancelTargetDoc.drafterName || cancelTargetDoc.drafterId;
      initialVals[RESERVED_BODY_KEY] = `[취소 사유]\n- ${cancelTargetDoc.title} 건에 대한 결재 취소를 신청합니다.\n\n[취소 상세 내용]\n- `;
    }
    const targetDocForForm = editDoc ?? cancelTargetDoc;
    if (targetDocForForm?.docType === '휴가' && targetDocForForm.form) {
      if (!initialVals['leaveType']) initialVals['leaveType'] = targetDocForForm.form.leaveType;
      if (!initialVals['period']) initialVals['period'] = targetDocForForm.form.startDate;
      if (!initialVals['period__end']) initialVals['period__end'] = targetDocForForm.form.endDate;
      if (!initialVals['period__days']) initialVals['period__days'] = targetDocForForm.form.days;
      if (!initialVals['substituteId'] && targetDocForForm.form.substituteId) initialVals['substituteId'] = targetDocForForm.form.substituteId;
      if (!initialVals['emergencyContact'] && targetDocForForm.form.emergencyContact) initialVals['emergencyContact'] = targetDocForForm.form.emergencyContact;
      if (!initialVals[RESERVED_BODY_KEY] && (targetDocForForm.form as any).reason) initialVals[RESERVED_BODY_KEY] = (targetDocForForm.form as any).reason;
    }
    // URL 딥링크(근태/휴가 화면 등)에서 넘어온 날짜 및 유형 기본 바인딩
    if (!editDoc && !cancelTargetDoc && initialDate) {
      if (!initialVals['period']) initialVals['period'] = initialDate;
      if (!initialVals['period__end']) initialVals['period__end'] = initialDate;
      if (!initialVals['period__days']) initialVals['period__days'] = 1;
    }
    if (!editDoc && !cancelTargetDoc && initialLeaveType) {
      initialVals['leaveType'] = initialLeaveType;
      initialVals['period__days'] = calculateLeaveDays({
        leaveType: initialLeaveType,
        startDate: initialVals['period'] as string,
        endDate: initialVals['period__end'] as string,
      });
    }
    return initialVals;
  });

  // DB 공휴일 목록 — 휴가 일수 계산 시 자동 제외
  const { data: holidayList = [] } = useHolidays();

  const setVals = (patch: Record<string, FieldValue>) => setValues((prev) => ({ ...prev, ...patch }));
  const [steps, setSteps] = useState<ApprovalStep[]>(() => {
    if (editDoc?.steps && editDoc.steps.length > 0) return editDoc.steps;
    if (cancelTargetDoc && cancelTargetDoc.steps.length > 0) {
      // 원문서의 결재선 복제 (기안자 seq 1 제외, 결재 승인자들만 복제 후 seq 재정렬)
      const approvers = cancelTargetDoc.steps
        .filter((s) => s.seq > 1)
        .map((s, idx) => ({
          seq: idx + 2,
          parallelGroup: s.parallelGroup,
          executionType: s.executionType ?? ('sequential' as const),
          kind: s.kind,
          approverId: s.approverId,
          delegatedFromId: null,
          decision: '대기' as const,
          decidedAt: null,
          comment: '',
        }));
      if (approvers.length > 0) {
        return [
          {
            seq: 1,
            parallelGroup: null,
            executionType: 'sequential' as const,
            kind: '결재' as const,
            approverId: me.id,
            delegatedFromId: null,
            decision: '승인' as const,
            decidedAt: null,
            comment: '',
          },
          ...approvers,
        ];
      }
    }
    return [];
  });
  const [attachments, setAttachments] = useState<{ name: string; url: string }[]>(editDoc?.attachments ?? []);
  const [attachmentRetention, setAttachmentRetention] = useState<string>((editDoc as any)?.attachmentRetention ?? 'permanent');
  const [relatedDocs, setRelatedDocs] = useState<RelatedDoc[]>(() => {
    const list = [...(editDoc?.relatedDocs ?? [])];
    if (!editDoc && cancelTargetDoc && !list.some((r) => r.docId === cancelTargetDoc.id)) {
      list.push({
        docId: cancelTargetDoc.id,
        docNo: cancelTargetDoc.docNo,
        title: cancelTargetDoc.title,
        docType: cancelTargetDoc.docType,
        drafterName: cancelTargetDoc.drafterName || cancelTargetDoc.drafterId,
        drafterDept: cancelTargetDoc.drafterDept,
        completedAt: cancelTargetDoc.completedAt,
      });
    }
    return list;
  });

  const [showRelatedModal, setShowRelatedModal] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [recipients, setRecipients] = useState<ApprovalRecipient[]>(editDoc?.recipients ?? []);
  const [isWideScreen, setIsWideScreen] = useState(true);
  const [isAgreementEnabled, setIsAgreementEnabled] = useState(false);

  // 양식 선택 모달 및 양식 변경 확인 다이얼로그 상태
  const [showSelectModal, setShowSelectModal] = useState(false);
  const [showChangeConfirm, setShowChangeConfirm] = useState(false);
  const [isChangingFormSaving, setIsChangingFormSaving] = useState(false);

  // 후결(사후 승인) 옵션
  const [isPostApprovalSystemEnabled, setIsPostApprovalSystemEnabled] = useState(false);
  const [isPostApproval, setIsPostApproval] = useState<boolean>(editDoc?.isPostApproval ?? false);
  const [postApprovalReason] = useState<string>(editDoc?.postApprovalReason ?? '');
  const [postApprovalActionTaken, setPostApprovalActionTaken] = useState<string>(editDoc?.postApprovalActionTaken ?? '');
  const [postApprovalNecessity, setPostApprovalNecessity] = useState<string>(editDoc?.postApprovalNecessity ?? '');
  const [postApprovalCostDetails] = useState<string>(editDoc?.postApprovalCostDetails ?? '');
  const [postApprovalFollowup] = useState<string>(editDoc?.postApprovalFollowup ?? '');

  const defaultPostApprovedAt = useMemo(() => {
    if (editDoc?.postApprovedAt) return editDoc.postApprovedAt;
    const now = new Date();
    const tzOffset = now.getTimezoneOffset() * 60000;
    return new Date(now.getTime() - tzOffset).toISOString().slice(0, 16);
  }, [editDoc]);

  const [postApprovedAt, setPostApprovedAt] = useState<string>(defaultPostApprovedAt);
  const [postApprovedById, setPostApprovedById] = useState<string>(editDoc?.postApprovedById ?? me.id);

  useEffect(() => {
    approvalProcessRepo.isOptionEnabled('dept_agreement').then(setIsAgreementEnabled);
  }, []);

  useEffect(() => {
    const handleResize = () => {
      const w = window.innerWidth;
      setIsWideScreen(w >= 1200);
    };
    window.addEventListener('resize', handleResize);
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleFilesUpload = async (files: File[]) => {
    if (files.length === 0) return;
    setUploading(true);
    try {
      const uploaded = await Promise.all(
        files.map(async (f) => {
          const ext = f.name.split('.').pop() || '';
          const randomHex = Math.random().toString(36).substring(2, 8);
          const safePath = `chat/approval/${Date.now()}_${randomHex}.${ext}`;
          const url = await fileStorage.put(safePath, f, { contentType: f.type, filename: f.name });
          return { name: f.name, url };
        }),
      );
      setAttachments((prev) => [...prev, ...uploaded]);
    } catch (err) {
      setError('파일 업로드 실패: ' + String(err));
    } finally {
      setUploading(false);
    }
  };

  // 최초 마운트 및 양식 선택 시점의 디폴트 상태 스냅샷 Ref
  const initialStateRef = useRef<{
    code: string;
    title: string;
    values: Record<string, FieldValue>;
    amount: string;
    attachments: { name: string; url: string }[];
    relatedDocs: RelatedDoc[];
    steps: ApprovalStep[];
    recipients: ApprovalRecipient[];
    /** 셀렉트 박스 3종. 이게 비교 대상에서 빠져 있어 값을 바꿔도 "작성한 게 없다"로 봤다. */
    securityLevel: string;
    visibility: string;
    preservationPeriod: string;
  } | null>(null);

  const prevCodeRef = useRef<string>('');

  // 양식 설정 직후의 초기 세팅이 완벽히 끝난 상태를 150ms 딜레이 후 캡처
  useEffect(() => {
    if (forms.length === 0) return;

    // 이미 해당 code에 대한 스냅샷이 저장되어 있다면 갱신을 건너뛰어 스냅샷 오염 방지
    if (initialStateRef.current && initialStateRef.current.code === code) {
      return;
    }

    const timer = setTimeout(() => {
      initialStateRef.current = {
        code,
        title,
        values: JSON.parse(JSON.stringify(values)),
        amount,
        attachments: JSON.parse(JSON.stringify(attachments)),
        relatedDocs: JSON.parse(JSON.stringify(relatedDocs)),
        steps: JSON.parse(JSON.stringify(steps)),
        recipients: JSON.parse(JSON.stringify(recipients)),
        securityLevel,
        visibility,
        preservationPeriod,
      };
    }, 150);

    return () => clearTimeout(timer);
  }, [code, forms, editDoc]);

  const hasManuallyEnteredValues = (): boolean => {
    // 1. 사용자 입력(제목, 금액, 첨부, 관련문서)이 유의미하게 존재하는 경우 무조건 작성 중으로 판정
    if (title.trim().length > 0) return true;
    if (amount.trim().length > 0) return true;
    if (attachments.length > 0) return true;
    if (relatedDocs.length > 0) return true;

    // 2. values 내부 필드 검사 (표나 텍스트가 조금이라도 입력되었는지 직접 확인)
    const hasValues = Object.values(values).some((v) => {
      if (v === null || v === undefined || v === '') return false;
      if (typeof v === 'string') {
        if (v.trim() === '') return false;
        // 표 필드인 경우 기본 빈 행만 있는 게 아니라 실제 셀에 입력이 있는지 검사
        if (v.includes('"rows"')) {
          try {
            const p = JSON.parse(v);
            if (Array.isArray(p.rows)) {
              return p.rows.some((r: any) =>
                Object.values(r).some((cell) => cell !== null && cell !== undefined && String(cell).trim() !== '')
              );
            }
          } catch {}
        }
        return true;
      }
      return true;
    });
    if (hasValues) return true;

    if (!initialStateRef.current) return false;
    const initialState = initialStateRef.current;

    // 양식 코드 자체가 다르면 초기 상태 비교를 무시하고 false 처리
    if (code !== initialState.code) return false;

    // 각 핵심 상태의 최초 스냅샷 대비 변경 사항을 엄격히 감지
    const titleChanged = title.trim() !== initialState.title.trim();
    const amountChanged = amount.trim() !== initialState.amount.trim();
    const valuesChanged = JSON.stringify(values) !== JSON.stringify(initialState.values);
    const filesChanged = JSON.stringify(attachments) !== JSON.stringify(initialState.attachments);
    const relatedDocsChanged = JSON.stringify(relatedDocs) !== JSON.stringify(initialState.relatedDocs);
    const stepsChanged = JSON.stringify(steps) !== JSON.stringify(initialState.steps);
    const recipientsChanged = JSON.stringify(recipients) !== JSON.stringify(initialState.recipients);
    const securityChanged = securityLevel !== initialState.securityLevel;
    const visibilityChanged = visibility !== initialState.visibility;
    const preservationChanged = preservationPeriod !== initialState.preservationPeriod;

    return (
      titleChanged ||
      amountChanged ||
      valuesChanged ||
      filesChanged ||
      relatedDocsChanged ||
      stepsChanged ||
      recipientsChanged ||
      securityChanged ||
      visibilityChanged ||
      preservationChanged
    );
  };

  // URL 쿼리에 type이 없고 신규 기안으로 진입한 경우, 양식 선택 모달 자동 오픈 (취소신청 기안인 경우 모달 생략)
  useEffect(() => {
    if (!editDoc && !cancelTargetDoc && !fixedType && !initialDate && !initialLeaveType) {
      const urlParams = new URLSearchParams(window.location.search);
      if (!urlParams.get('type') && !urlParams.get('cancelTargetId')) {
        setShowSelectModal(true);
      }
    }
  }, [editDoc, cancelTargetDoc, fixedType, initialDate, initialLeaveType]);

  // 상단 [양식 변경] 버튼 클릭 핸들러
  const handleClickChangeForm = () => {
    if (cancelTargetDoc) return;
    if (hasManuallyEnteredValues()) {
      setShowChangeConfirm(true);
    } else {
      setShowSelectModal(true);
    }
  };

  // 작성 중인 내용 임시 저장 후 새 양식 선택
  const handleSaveAndChange = async () => {
    setIsChangingFormSaving(true);
    try {
      await persistDraft();
      clearAutosave();
      setShowChangeConfirm(false);
      setShowSelectModal(true);
    } catch (e) {
      setError('임시 저장에 실패하여 양식 변경이 중단되었습니다: ' + String(e));
    } finally {
      setIsChangingFormSaving(false);
    }
  };

  // 새 기안은 탭마다 따로 보관한다(탭 간 덮어쓰기 방지) — [[draftAutosaveKeys.ts]]
  const [draftTabId] = useState(() => getDraftTabId(sessionStorage));
  const { draftKey, activeKey } = draftAutosaveKeys(me.id, editDoc?.id ?? null, draftTabId);
  const HISTORY_KEY = `draft_history_${me.id}`;

  /**
   * 브라우저 다중 버전 롤링 백업 (최근 20개 스냅샷 보관소)
   * 1개 키 덮어쓰기나 예기치 않은 새로고침, 양식 변경 시에도 이전 버전을 보존한다.
   * 자동 보관 시 최소 1분(60초) 간격을 지키고, 내용 변경이 있을 때만 새 스냅샷을 남긴다.
   */
  const saveToRollingHistory = (snapshotData: any, tag?: string) => {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      let list: any[] = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(list)) list = [];

      const latest = list[0];
      const latestTimestamp = latest ? Number(latest.timestamp) || 0 : 0;
      const isSameContent =
        latest &&
        latest.code === snapshotData.code &&
        latest.title === snapshotData.title &&
        JSON.stringify(latest.values) === JSON.stringify(snapshotData.values);

      // 자동 보관인 경우:
      // 1) 내용이 이전 스냅샷과 완전히 같다면 중복 등록하지 않음
      // 2) 이전 스냅샷 등록 후 최소 1분(60,000ms)이 경과하지 않았다면 스냅샷 도배 방지를 위해 건너뜀
      if (!tag) {
        if (isSameContent) return;
        const MIN_HISTORY_INTERVAL_MS = 60 * 1000;
        if (Date.now() - latestTimestamp < MIN_HISTORY_INTERVAL_MS) return;
      }

      const entry = {
        id: `hist_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        docId: snapshotData.docId ?? null,
        code: snapshotData.code,
        title: snapshotData.title,
        timestamp: Date.now(),
        values: snapshotData.values,
        amount: snapshotData.amount,
        securityLevel: snapshotData.securityLevel,
        visibility: snapshotData.visibility,
        preservationPeriod: snapshotData.preservationPeriod,
        attachments: snapshotData.attachments,
        relatedDocs: snapshotData.relatedDocs,
        recipients: snapshotData.recipients,
        steps: snapshotData.steps,
        tag: tag || '자동 보관',
      };

      list.unshift(entry);
      if (list.length > 20) {
        list = list.slice(0, 20);
      }
      localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
    } catch {
      // LocalStorage Quota 초과 시 가장 오래된 항목 5개 삭제 후 복구 시도
      try {
        const raw = localStorage.getItem(HISTORY_KEY);
        let list: any[] = raw ? JSON.parse(raw) : [];
        if (list.length > 5) {
          list = list.slice(0, list.length - 5);
          localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
        }
      } catch {}
    }
  };

  // 작성 중인 내용 폐기 후 새 양식 선택
  const handleDiscardAndChange = () => {
    // 폐기 전 혹시 모를 실수를 대비하여 롤링 히스토리에 아카이빙
    saveToRollingHistory(
      {
        docId: editDoc?.id ?? null,
        code,
        title,
        values,
        amount,
        securityLevel,
        visibility,
        preservationPeriod,
        attachments,
        relatedDocs,
        recipients,
        steps,
      },
      '양식 변경 전 보관본'
    );
    clearAutosave();
    setValues({});
    setTitle('');
    setAmount('');
    setAttachments([]);
    setRelatedDocs([]);
    setShowChangeConfirm(false);
    setShowSelectModal(true);
  };

  // 모달에서 새 서식을 최종 선택했을 때
  const handleSelectNewForm = (newForm: ApprovalForm) => {
    setCode(newForm.code);
    setValues({});
    setTitle('');
    setAmount('');
    navigate(`/gw/approval/new?type=${encodeURIComponent(newForm.code)}`);
  };

  /** 마지막으로 브라우저에 보관한 시각. 화면에 "마지막 보관 HH:MM:SS"로 보여 준다. */
  const [autosavedAt, setAutosavedAt] = useState<number | null>(null);

  /** 마지막으로 실제 쓰기가 일어난 시각. 스로틀 간격 판정에 쓴다. */
  const lastSnapshotAtRef = useRef(0);

  /** 최신 작업 스냅샷 페이로드 (언마운트 및 이탈 보관용) */
  const latestPayloadRef = useRef<any>(null);

  /** 복구 제안할 보관본과 그 출처 키(자기 탭 것이거나, 닫힌 탭이 남긴 것). */
  const bootDraftRef = useRef<{ data: unknown; active: boolean; draftKey: string; activeKey: string } | null>(null);
  if (bootDraftRef.current === null) {
    let data: unknown = null;
    try {
      const raw = localStorage.getItem(draftKey);
      data = raw ? JSON.parse(raw) : null;
    } catch { /* 형식이 깨졌으면 없는 것으로 본다 */ }
    bootDraftRef.current = {
      data,
      active: localStorage.getItem(activeKey) === 'true',
      draftKey,
      activeKey,
    };
    // 새 기안인데 이 탭의 보관본이 없으면, 닫힌 탭이 남긴 보관본을 찾는다.
    if (!editDoc && !(bootDraftRef.current.active && data)) {
      const orphan = findOrphanNewDraft(localStorage, me.id, draftTabId, Date.now());
      if (orphan) bootDraftRef.current = { data: orphan.data, active: true, draftKey: orphan.draftKey, activeKey: orphan.activeKey };
    }
  }

  // 이 탭이 열려 있다는 표시 — 다른 탭이 이 탭의 보관본을 가져가지 않게 한다.
  useEffect(() => {
    const beat = () => markTabAlive(localStorage, draftTabId, Date.now());
    beat();
    const timer = setInterval(beat, TAB_HEARTBEAT_MS);
    const gone = () => localStorage.removeItem(tabAliveKey(draftTabId));
    const onVisible = () => { if (document.visibilityState === 'visible') beat(); };
    window.addEventListener('pagehide', gone);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener('pagehide', gone);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [draftTabId]);

  const isDiscardedOrSubmittedRef = useRef(false);

  const clearAutosave = () => {
    isDiscardedOrSubmittedRef.current = true;
    localStorage.removeItem(draftKey);
    localStorage.removeItem(activeKey);
    setAutosavedAt(null);
  };

  // 브라우저 새로고침 / 탭 닫기 이탈 방지
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasManuallyEnteredValues()) {
        e.preventDefault();
        e.returnValue = ''; // 브라우저 표준 경고창 표시 유도
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [code, title, values, amount, attachments, relatedDocs, steps, recipients]);

  // 실시간 자동저장 및 비었을 때의 클리너 연동 (1.5초 디바운스)
  useEffect(() => {
    // 최초 상태 스냅샷이 캡처되기 전에는 기존 자동저장을 삭제하거나 덮어쓰지 않도록 가드
    if (!initialStateRef.current) return;

    const hasContent = hasManuallyEnteredValues();

    // 변경 사항이 없다면 추가 로컬 보관은 건너뜀 (기존 보관본을 함부로 삭제하지 않음)
    if (!hasContent) {
      return;
    }

    /**
     * **디바운스가 아니라 스로틀이다.**
     *
     * 디바운스는 "입력이 멈춘 뒤" 저장한다. 그래서 긴 글을 쉬지 않고 쓰면 타이머가
     * 계속 밀려 **한 번도 저장되지 않는다** — 정확히 가장 많이 잃는 상황이다.
     * 스로틀은 쓰는 도중에도 최소 주기마다 반드시 한 번 저장한다.
     *
     * 포커스 아웃(blur) 기준도 같은 이유로 쓰지 않는다. 한 칸에 오래 머무르면
     * 그 칸을 벗어난 적이 없어 한 번도 보관되지 않는다.
     */
    const payload = {
      docId: editDoc?.id ?? null,
      code,
      title,
      values,
      amount,
      securityLevel,
      visibility,
      preservationPeriod,
      attachments,
      relatedDocs,
      recipients,
      steps,
      isPostApproval,
      postApprovalActionTaken,
      postApprovalNecessity,
      postApprovedAt,
      postApprovedById,
      cancelTargetDocId: editDoc?.cancelTargetDocId ?? cancelTargetDoc?.id ?? null,
      timestamp: Date.now(),
    };
    latestPayloadRef.current = payload;

    const snapshot = () => {
      try {
        localStorage.setItem(draftKey, JSON.stringify(payload));
        localStorage.setItem(activeKey, 'true');
        lastSnapshotAtRef.current = Date.now();
        setAutosavedAt(lastSnapshotAtRef.current);
        saveToRollingHistory(payload);
      } catch (e) {
        console.warn('로컬 스토리지 임시보관 실패:', e);
      }
    };

    /**
     * 첫 변경은 즉시 저장하고, 그 뒤로는 최소 `SAVE_INTERVAL_MS` 간격을 지킨다.
     * 브라우저 로컬 스토리지에 5초 주기로 스로틀 저장한다.
     */
    const SAVE_INTERVAL_MS = 5000;
    const sinceLast = Date.now() - lastSnapshotAtRef.current;
    let timer: ReturnType<typeof setTimeout> | null = null;
    if (sinceLast >= SAVE_INTERVAL_MS) {
      snapshot();
    } else {
      timer = setTimeout(snapshot, SAVE_INTERVAL_MS - sinceLast);
    }

    /**
     * 창을 떠나거나 탭을 닫을 때는 대기 없이 즉시 동기 보관
     */
    const flushIfHidden = () => { if (document.visibilityState === 'hidden') snapshot(); };
    window.addEventListener('blur', snapshot);
    window.addEventListener('pagehide', snapshot);
    window.addEventListener('beforeunload', snapshot);
    document.addEventListener('visibilitychange', flushIfHidden);

    return () => {
      // ⚠️ 주의: 리렌더링마다 도는 클린업에서는 대기 타이머만 해제해야 함!
      // 여기서 snapshot()을 동기 호출하면 키 입력할 때마다 저장이 발생함.
      if (timer) {
        clearTimeout(timer);
      }
      window.removeEventListener('blur', snapshot);
      window.removeEventListener('pagehide', snapshot);
      window.removeEventListener('beforeunload', snapshot);
      document.removeEventListener('visibilitychange', flushIfHidden);
    };
  }, [code, title, values, amount, securityLevel, visibility, preservationPeriod, attachments, relatedDocs, recipients, steps, isPostApproval, postApprovalActionTaken, postApprovalNecessity, postApprovedAt, postApprovedById, me.id, editDoc?.id]);

  // SPA 내부 라우팅 언마운트 시점에 대기 중이던 최신 변경사항 안전 저장
  useEffect(() => {
    return () => {
      if (isDiscardedOrSubmittedRef.current) return;
      if (!initialStateRef.current) return;
      if (!hasManuallyEnteredValues()) return;
      if (latestPayloadRef.current) {
        try {
          localStorage.setItem(draftKey, JSON.stringify(latestPayloadRef.current));
          localStorage.setItem(activeKey, 'true');
        } catch {}
      }
    };
  }, [draftKey, activeKey]);

  const hasCheckedAutosave = useRef(false);

  // 마운트 시 자동저장본 복구 제안
  useEffect(() => {
    if (hasCheckedAutosave.current) return;
    if (forms.length === 0) return; // 서식 정보가 로드될 때까지 대기

    // localStorage 를 다시 읽지 않는다 — 그 사이 clearAutosave() 가 지웠을 수 있다.
    const boot = bootDraftRef.current;
    let offered = false;
    if (boot?.active && boot.data) {
      {
        const data = boot.data as {
          docId?: string | null; code: string; timestamp: number;
        } & Record<string, unknown>;
        // 보관본이 지금 열고 있는 문서의 것일 때만 제안한다. 예전에는 editDoc 이 있으면
        // 검사 자체를 건너뛰어, **저장은 계속 하면서 꺼내지는 못하는** 상태였다.
        const sameTarget = (data?.docId ?? null) === (editDoc?.id ?? null);
        if (data && sameTarget && (Date.now() - data.timestamp < 24 * 60 * 60 * 1000)) {
          const formName = forms.find(f => f.code === data.code)?.name || data.code;
          setPendingAutosaveData(data);
          setAutosaveFormName(formName);
          setShowAutosaveRecoverModal(true);
          offered = true;
        }
      }
    }
    // 제안을 띄웠을 때만 플래그를 내린다. 예전에는 무조건 지워서, 이 화면에 잠깐
    // 들렀다 나가기만 해도 다음번 복구 제안이 사라졌다(내용은 남아 있는데도).
    if (offered && boot) localStorage.removeItem(boot.activeKey);
    hasCheckedAutosave.current = true;
  }, [me.id, forms, editDoc]);

  const [showConfirmClose, setShowConfirmClose] = useState(false);

  // 자동저장 복구 제안 모달 상태
  const [showAutosaveRecoverModal, setShowAutosaveRecoverModal] = useState(false);
  const [pendingAutosaveData, setPendingAutosaveData] = useState<any>(null);
  const [autosaveFormName, setAutosaveFormName] = useState('');

  // 로컬 임시 보관함 전체 조회/복구 모달 상태
  const [showBackupHistoryModal, setShowBackupHistoryModal] = useState(false);
  const [selectedBackupKey, setSelectedBackupKey] = useState<string | null>(null);
  const [backupHistoryVersion, setBackupHistoryVersion] = useState(0);

  const getAvailableBackups = (): Array<{
    key: string;
    docId: string | null;
    code: string;
    title: string;
    timestamp: number;
    tag?: string;
    data: any;
  }> => {
    const list: Array<{
      key: string;
      docId: string | null;
      code: string;
      title: string;
      timestamp: number;
      tag?: string;
      data: any;
    }> = [];
    const seenSignatures = new Set<string>();

    // 1. 활성 draftKey 검색
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        if (k.startsWith('draft_autosave_') && !k.includes('active')) {
          const raw = localStorage.getItem(k);
          if (!raw) continue;
          try {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
              const sig = `${parsed.code}_${parsed.title}_${parsed.timestamp}`;
              seenSignatures.add(sig);
              list.push({
                key: k,
                docId: parsed.docId ?? null,
                code: parsed.code || '기안',
                title: parsed.title || '(제목 없음)',
                timestamp: parsed.timestamp || 0,
                tag: '현재 작성중',
                data: parsed,
              });
            }
          } catch {}
        }
      }
    } catch {}

    // 2. 다중 버전 롤링 히스토리 검색
    try {
      const rawHist = localStorage.getItem(HISTORY_KEY);
      if (rawHist) {
        const histList = JSON.parse(rawHist);
        if (Array.isArray(histList)) {
          histList.forEach((h: any) => {
            const sig = `${h.code}_${h.title}_${h.timestamp}`;
            if (!seenSignatures.has(sig)) {
              seenSignatures.add(sig);
              list.push({
                key: h.id || `hist_${h.timestamp}`,
                docId: h.docId ?? null,
                code: h.code || '기안',
                title: h.title || '(제목 없음)',
                timestamp: h.timestamp || 0,
                tag: h.tag || '이전 보관본',
                data: h,
              });
            }
          });
        }
      }
    } catch {}

    return list.sort((a, b) => b.timestamp - a.timestamp);
  };

  const backups = useMemo(() => {
    if (!showBackupHistoryModal) return [];
    return getAvailableBackups();
  }, [showBackupHistoryModal, backupHistoryVersion]);

  const [drawerOpen, setDrawerOpen] = useState(false); // 해상도 작을 때 결재선 Drawer

  useEffect(() => {
    approvalProcessRepo.isOptionEnabled('post_approval').then((enabled) => {
      setIsPostApprovalSystemEnabled(enabled);
    });
  }, []);

  useEffect(() => {
    // 서식별 보안 설정 자동 매핑
    if (code === '채용' || code === '인사') {
      setSecurityLevel('극비');
      setVisibility('비공개');
    } else if (code === '지출결의') {
      setSecurityLevel('대외비');
      setVisibility('부서');
    } else {
      setSecurityLevel('일반');
      setVisibility('부서');
    }
  }, [code]);


  // 서식 변경에 따른 기본 수신처/시행처 매핑 자동 주입
  useEffect(() => {
    if (!code || forms.length === 0 || editDoc) return;
    
    // 사용자가 서식을 실제로 바꿨을 때만 기본값을 주입하고, 이후 사용자 추가/삭제 수정 내역 보호
    if (prevCodeRef.current === code) return;
    prevCodeRef.current = code;

    const currentForm = forms.find((f) => f.code === code);
    if (!currentForm) return;

    // 1. 수신처 빌드
    const autoRecipients: ApprovalRecipient[] = [];

    // (A) 기본 수신 사용자
    if (currentForm.recipientUserId) {
      const u = org.users.find((x: any) => x.id === currentForm.recipientUserId);
      if (u) {
        autoRecipients.push({
          id: u.id,
          name: `${u.name} · ${u.dept}`,
          type: 'user' as const
        });
      }
    }
    // (B) 기본 수신 부서
    if (currentForm.recipientDeptId) {
      const d = org.depts.find((x: any) => x.id === currentForm.recipientDeptId);
      if (d) {
        autoRecipients.push({
          id: d.id,
          name: d.name,
          type: 'dept' as const
        });
      }
    }

    setRecipients(autoRecipients);

  }, [code, forms, org.users, org.depts, me, editDoc]);


  /**
   * [중요: 외부 실시간 웹소켓 이벤트로 인한 작성 중 내용 덮어쓰기 방지]
   * ApprovalDraftInner는 상위 ApprovalDraftScreen에서 `key={editDocId ?? 'new'}`로 감싸져 있어,
   * 마운트 시점에 이미 useState 초기값으로 editDoc의 모든 필드가 완벽하게 주입됩니다.
   * 예전에는 여기에 `useEffect(..., [editDoc])`가 존재하여 사내 다른 결재 문서가
   * 상신/승인될 때마다 웹소켓 실시간 이벤트로 인해 사용자가 타이핑 중이던 모든 내용이
   * 서버의 과거 데이터로 강제 롤백(덮어쓰기)되는 치명적인 데이터 소실 버그가 있었습니다.
   * 따라서 마운트 이후 백그라운드 editDoc 참조 갱신으로 사용자 입력을 덮어쓰지 않습니다.
   */

  // 이미 등록/저장된 기존 문서 편집이거나 취소 기안 작성 중에는 임의 양식 변경 제한
  const canChangeForm = !editDoc && !cancelTargetDoc;



  const handleAttemptClose = () => {
    if (hasManuallyEnteredValues()) {
      setShowConfirmClose(true);
    } else {
      navigate('/gw/approval');
    }
  };

  const create = useCreateDraft();
  const save = useSaveDraft();
  const submitM = useSubmitApproval();
  const route = useRouteEngine();
  const busy = create.isPending || save.isPending || submitM.isPending || uploading;

  const form: ApprovalForm | undefined = useMemo(() => forms.find((x) => x.code === code), [forms, code]);
  const amountField = form ? amountFieldOf(form) : undefined;

  const amountNum = useMemo(() => {
    if (amountField && values[amountField.key] != null && values[amountField.key] !== '') {
      const n = Number(String(values[amountField.key]).replace(/,/g, ''));
      if (!isNaN(n)) return n;
    }
    const n = Number(amount.replace(/,/g, ''));
    return isNaN(n) || !amount ? null : n;
  }, [amount, amountField, values]);

  // 실시간 결재선 규칙 엔진 연동 + 서식 기본 참조자 연동
  const lastAutoSteps = useRef<string>('');
  useEffect(() => {
    if (route.isLoading || !code || editDoc) return;
    let line = route.build({ drafterId: me.id, docType: code, amount: amountNum, docData: values });

    // 서식 기본 참조자(사용자)가 지정되어 있다면 결재선에 병합 (중복/본인 제외)
    if (form?.referenceUserId && form.referenceUserId !== me.id) {
      const alreadyHasRef = line.some((s) => s.approverId === form.referenceUserId);
      if (!alreadyHasRef) {
        line = [
          ...line,
          {
            seq: line.length + 1,
            parallelGroup: null,
            executionType: 'sequential' as const,
            kind: '참조' as const,
            approverId: form.referenceUserId,
            delegatedFromId: null,
            decision: '대기' as const,
            decidedAt: null,
            comment: '',
          },
        ];
      }
    }

    const lineStr = JSON.stringify(line);
    const currentStr = JSON.stringify(steps);

    if (steps.length === 0 || currentStr === lastAutoSteps.current) {
      if (currentStr !== lineStr) {
        setSteps(line);
        lastAutoSteps.current = lineStr;
      }
    }
  }, [code, amountNum, values, route, me.id, steps, editDoc, form?.referenceUserId]);

  // 서식 기본 수신처/참조부서 초기값 연동
  useEffect(() => {
    if (editDoc || !form) return;
    if (recipients.length === 0) {
      const initialRecipients: ApprovalRecipient[] = [];
      if (form.recipientDeptId) {
        const dept = org.depts.find((d) => d.id === form.recipientDeptId);
        if (dept) initialRecipients.push({ id: dept.id, name: dept.name, type: 'dept' });
      }
      if (form.recipientUserId) {
        const u = org.userById(form.recipientUserId);
        if (u) initialRecipients.push({ id: u.id, name: u.name, type: 'user' });
      }
      if (form.referenceDeptId) {
        const dept = org.depts.find((d) => d.id === form.referenceDeptId);
        if (dept && !initialRecipients.some((r) => r.id === dept.id)) {
          initialRecipients.push({ id: dept.id, name: dept.name, type: 'dept' });
        }
      }
      if (initialRecipients.length > 0) {
        setRecipients(initialRecipients);
      }
    }
  }, [form, editDoc, org]);

  // 서식 마스터에 최신 업데이트(수식, 셀 병합, 열 구성 등)가 있는지 검사하여 일괄 반영 버튼 노출 여부 결정
  const hasFormMasterUpdates = useMemo(() => {
    if (!form || !form.fields) return false;

    for (const f of form.fields) {
      if (f.type !== '표' || !f.placeholder) continue;

      const currentRaw = values[f.key];
      if (!currentRaw || typeof currentRaw !== 'string') continue;

      let master: any = null;
      let current: any = null;
      try {
        master = JSON.parse(f.placeholder);
        current = JSON.parse(currentRaw);
      } catch {
        continue;
      }
      if (!master || !current) continue;

      // 1. 수식 비교
      const masterFormulas = master.cellFormulas || {};
      const currentFormulas = current.cellFormulas || {};
      if (JSON.stringify(masterFormulas) !== JSON.stringify(currentFormulas)) return true;

      // 2. 셀 병합 비교
      const masterMerges = master.merges || [];
      const currentMerges = current.merges || [];
      if (JSON.stringify(masterMerges) !== JSON.stringify(currentMerges)) return true;

      // 3. 열 목록 비교
      const masterCols = master.cols || [];
      const currentCols = current.cols || [];
      if (JSON.stringify(masterCols) !== JSON.stringify(currentCols)) return true;

      // 4. 열 머리글 비교
      const masterHeaders = master.headerValues || {};
      const currentHeaders = current.headerValues || {};
      if (JSON.stringify(masterHeaders) !== JSON.stringify(currentHeaders)) return true;

      // 5. 합계 셀 비교
      if (JSON.stringify(master.sumCell ?? null) !== JSON.stringify(current.sumCell ?? null)) return true;

      // 6. 기본 행 개수 비교
      const masterRows = (Array.isArray(master.rows) && master.rows.length > 0 ? master.rows : master.defaultRows) || [];
      const currentRows = (Array.isArray(current.rows) && current.rows.length > 0 ? current.rows : current.defaultRows) || [];
      if (masterRows.length > currentRows.length) return true;
    }

    return false;
  }, [form, values]);

  // 최신 서식 변경사항을 모든 표에 일괄 스마트 병합 적용
  const handleApplyAllMasterUpdates = () => {
    if (!form || !form.fields) return;

    if (
      !confirm(
        '서식 마스터의 최신 변경사항(자동 계산 수식, 셀 병합, 열 구조 등)을 전체 표에 일괄 적용하시겠습니까?\n\n※ 이미 작성하신 셀 내용 및 입력값은 안전하게 보존됩니다.'
      )
    ) {
      return;
    }

    const patch: Record<string, FieldValue> = {};

    for (const f of form.fields) {
      if (f.type !== '표' || !f.placeholder) continue;

      let master: any = null;
      try {
        master = JSON.parse(f.placeholder);
      } catch {
        continue;
      }
      if (!master) continue;

      const currentRaw = values[f.key];
      let current: any = null;
      if (currentRaw && typeof currentRaw === 'string') {
        try {
          current = JSON.parse(currentRaw);
        } catch {}
      }

      const masterCols: string[] =
        Array.isArray(master.cols) && master.cols.length > 0
          ? master.cols
          : current?.cols || ['구분', '항목', '내용'];
      const masterColWidths: Record<string, string> = master.colWidths || current?.colWidths || {};
      const masterMerges: CellMerge[] = Array.isArray(master.merges) ? master.merges : current?.merges || [];
      const masterHeaderValues: Record<string, string> = master.headerValues || current?.headerValues || {};
      const masterAmountCells: Array<{ rIdx: number; col: string }> = Array.isArray(master.amountCells)
        ? master.amountCells
        : master.amountCell
        ? [master.amountCell]
        : current?.amountCells || [];
      const masterSumCell: { rIdx: number; col: string } | null =
        master.sumCell !== undefined ? master.sumCell : current?.sumCell || null;
      const masterSecretCols: string[] = Array.isArray(master.secretCols)
        ? master.secretCols
        : current?.secretCols || [];
      const masterSecretCells: string[] = Array.isArray(master.secretCells)
        ? master.secretCells
        : current?.secretCells || [];
      const masterSecretRows: number[] = Array.isArray(master.secretRows)
        ? master.secretRows
        : current?.secretRows || [];
      const masterCellFormulas: Record<string, CellFormula> = master.cellFormulas || current?.cellFormulas || {};

      const masterDefaultRows: Array<Record<string, string>> =
        Array.isArray(master.rows) && master.rows.length > 0
          ? master.rows
          : Array.isArray(master.defaultRows) && master.defaultRows.length > 0
          ? master.defaultRows
          : [];

      const currentRows: Array<Record<string, string>> =
        Array.isArray(current?.rows) && current.rows.length > 0
          ? current.rows
          : Array.isArray(current?.defaultRows) && current.defaultRows.length > 0
          ? current.defaultRows
          : [];

      let nextRows: Array<Record<string, string>> = [];
      if (masterDefaultRows.length > 0) {
        const maxLen = Math.max(currentRows.length, masterDefaultRows.length);
        for (let i = 0; i < maxLen; i++) {
          const userRow = currentRows[i] || {};
          const mRow = masterDefaultRows[i] || {};
          const mergedRow: Record<string, string> = {};
          masterCols.forEach((c) => {
            const userVal = userRow[c];
            const mVal = mRow[c];
            if (userVal !== undefined && userVal !== '') {
              mergedRow[c] = String(userVal);
            } else if (mVal !== undefined) {
              mergedRow[c] = String(mVal);
            } else {
              mergedRow[c] = '';
            }
          });
          nextRows.push(mergedRow);
        }
      } else if (currentRows.length > 0) {
        nextRows = currentRows.map((r) => {
          const mergedRow: Record<string, string> = {};
          masterCols.forEach((c) => {
            mergedRow[c] = r[c] !== undefined ? String(r[c]) : '';
          });
          return mergedRow;
        });
      } else {
        nextRows = masterDefaultRows;
      }

      let recalculated = recalculateTableFormulas(
        masterCols,
        nextRows,
        masterCellFormulas,
        masterHeaderValues
      );
      if (masterSumCell) {
        let sum = 0;
        recalculated.forEach((r, idx) => {
          masterCols.forEach((c) => {
            if (masterSumCell.rIdx === idx && masterSumCell.col === c) return;
            if (c.includes('금액') || masterAmountCells.some((ac) => ac.rIdx === idx && ac.col === c)) {
              const num = Number(String(r[c] ?? '').replace(/[^0-9]/g, '')) || 0;
              sum += num;
            }
          });
        });
        if (recalculated[masterSumCell.rIdx]) {
          recalculated[masterSumCell.rIdx] = {
            ...recalculated[masterSumCell.rIdx],
            [masterSumCell.col]: sum > 0 ? String(sum) : '',
          };
        }
      }

      patch[f.key] = JSON.stringify({
        cols: masterCols,
        rows: recalculated,
        defaultRows: recalculated,
        tableWidth: '100%',
        colWidths: masterColWidths,
        merges: masterMerges,
        headerValues: masterHeaderValues,
        amountCells: masterAmountCells,
        sumCell: masterSumCell,
        secretCols: masterSecretCols,
        secretCells: masterSecretCells,
        secretRows: masterSecretRows,
        cellFormulas: masterCellFormulas,
      });
    }

    setVals(patch);
    alert('모든 표에 최신 서식 양식(수식, 병합 등)이 성공적으로 반영되었습니다.\n작성된 데이터는 안전하게 보존되었습니다.');
  };

  const isResubmit = !!editDoc && editDoc.status !== '임시저장';

  const buildInput = (): ApprovalDraftInput => {
    let leave: LeaveForm | null = null;
    if (code === '휴가') {
      const pStart = String(values['period'] || '');
      const lType = String(values['leaveType'] || '연차') as LeaveType;
      const isPart = isHalfDayLeave(lType) || isQuarterDayLeave(lType);
      const isQuarter = isQuarterDayLeave(lType);
      const pEnd = isPart ? pStart : String(values['period__end'] || pStart);

      const pDays = calculateLeaveDays({
        leaveType: lType,
        startDate: pStart,
        endDate: pEnd,
        rawDays: Number(values['period__days']) || undefined,
        title,
        holidays: holidayList,
      });

      const quarterSlot = isQuarter ? String(values['quarterSlot'] || 'PM2') : undefined;
      const timeWin = getDefaultTimeWindow(lType, quarterSlot);
      const startTime = String(values['startTime'] || timeWin.startTime);
      const endTime = String(values['endTime'] || timeWin.endTime);
      const reason = values[RESERVED_BODY_KEY] ? String(values[RESERVED_BODY_KEY]).trim() : undefined;
      const subId = values['substituteId'] ? String(values['substituteId']) : undefined;
      const subUser = subId ? org.userById(subId) : null;
      const emergencyContact = values['emergencyContact']
        ? String(values['emergencyContact'])
        : values['contactNumber']
        ? String(values['contactNumber'])
        : undefined;

      leave = {
        leaveType: lType,
        startDate: pStart,
        endDate: pEnd,
        startTime,
        endTime,
        days: pDays,
        reason,
        substituteId: subId,
        substituteName: subUser ? `${subUser.name} · ${subUser.dept}` : undefined,
        emergencyContact,
      };
    }

    const postApprovedUser = org.userById(postApprovedById);
    const combinedReason = [
      postApprovalActionTaken ? `[선조치 내용 및 결과]\n${postApprovalActionTaken.trim()}` : '',
      postApprovalNecessity ? `[긴급성 및 불가피성 소명]\n${postApprovalNecessity.trim()}` : '',
      postApprovalCostDetails ? `[소요 비용 및 내역]\n${postApprovalCostDetails.trim()}` : '',
      postApprovalFollowup ? `[후속 조치 및 재발 방지 대책]\n${postApprovalFollowup.trim()}` : '',
    ].filter(Boolean).join('\n\n') || postApprovalReason.trim();

    const myDeptObj = org.depts.find((d) => d.name === me.dept);
    const myDeptId = myDeptObj ? myDeptObj.id : '';

    return {
      docType: code,
      title: title.trim(),
      drafterId: me.id,
      drafterDept: me.dept,
      drafterDeptId: myDeptId,
      steps,
      amount: amountNum,
      body: values[RESERVED_BODY_KEY] ? String(values[RESERVED_BODY_KEY]).trim() : '',
      form: leave,
      fieldValues: values,
      attachments,
      recipients,
      relatedDocs,
      securityLevel,
      visibility,
      preservationPeriod,
      isPostApproval: isPostApprovalSystemEnabled ? isPostApproval : false,
      postApprovalReason: isPostApprovalSystemEnabled && isPostApproval ? combinedReason : null,
      postApprovalActionTaken: isPostApprovalSystemEnabled && isPostApproval ? postApprovalActionTaken.trim() : null,
      postApprovalNecessity: isPostApprovalSystemEnabled && isPostApproval ? postApprovalNecessity.trim() : null,
      postApprovalCostDetails: isPostApprovalSystemEnabled && isPostApproval ? postApprovalCostDetails.trim() : null,
      postApprovalFollowup: isPostApprovalSystemEnabled && isPostApproval ? postApprovalFollowup.trim() : null,
      postApprovedAt: isPostApprovalSystemEnabled && isPostApproval ? postApprovedAt : null,
      postApprovedById: isPostApprovalSystemEnabled && isPostApproval ? postApprovedById : null,
      postApprovedByName: isPostApprovalSystemEnabled && isPostApproval && postApprovedUser ? postApprovedUser.name : null,
      cancelTargetDocId: editDoc?.cancelTargetDocId ?? cancelTargetDoc?.id ?? null,
    };
  };

  const validate = (forSubmit: boolean): string | null => {
    if (!title.trim()) return '제목을 입력하세요.';

    if (isPostApprovalSystemEnabled && isPostApproval) {
      if (!postApprovalActionTaken.trim() && !postApprovalReason.trim()) {
        return '후결 사후 승인 요청 시 [1. 선조치(긴급 조치) 내용 및 결과] 항목을 입력해 주세요.';
      }
      if (!postApprovalNecessity.trim() && !postApprovalReason.trim()) {
        return '후결 사후 승인 요청 시 [2. 긴급성 및 불가피성 소명 (Why?)] 항목을 입력해 주세요.';
      }
      const totalLen = (postApprovalActionTaken + postApprovalNecessity + postApprovalCostDetails + postApprovalFollowup + postApprovalReason).trim().length;
      if (totalLen < 50) return '후결 사후 승인 소명 및 선조치 내역은 최소 50자 이상 상세히 작성해 주세요.';
      if (!postApprovedAt) return '선조치 일시를 입력해 주세요.';
      if (new Date(postApprovedAt).getTime() > Date.now()) return '선조치 일시는 현재 시간보다 이전으로 설정해야 합니다.';
      if (!postApprovedById) return '선조치 구두/임시 승인자를 선택해 주세요.';
    }

    if (code === '휴가' || form?.code === '휴가') {
      const pStart = values['period'];
      const pEnd = values['period__end'];
      const lType = String(values['leaveType'] || '연차').trim();
      const isPart = isHalfDayLeave(lType) || isQuarterDayLeave(lType);
      const isSubLeave = lType.includes('대체휴무') || lType === 'SUBSTITUTE';

      const effectiveDays = calculateLeaveDays({
        leaveType: lType,
        startDate: pStart as string,
        endDate: pEnd as string,
        rawDays: Number(values['period__days']) || undefined,
        title,
        holidays: holidayList,
      });

      // 대체휴무 잔여일수 검증: 선사용 불가 (휴일근무 실적 사전 존재 필수)
      if (isSubLeave) {
        const subRemaining = Number(bal?.substituteHoliday?.remaining ?? 0);
        if (subRemaining <= 0) {
          return '보유하신 대체휴무 잔여 일수가 없습니다. (잔여: 0일)\n대체휴무는 법률상 선사용이 불가하며, 휴일근무 발생 내역이 사전에 적립되어 있어야만 신청하실 수 있습니다.';
        }
        if (effectiveDays > subRemaining) {
          return `신청 가능한 잔여 대체휴무(${subRemaining}일)를 초과하였습니다. (잔여: ${subRemaining}일, 신청일수: ${effectiveDays}일)`;
        }
      }

      if (!pStart || (!isPart && !pEnd) || effectiveDays <= 0) {
        return '휴가 기간을 올바르게 입력하세요.';
      }

      // 연차 및 반차 잔여일수 검증: 선사용(Advance Leave) 정책에 따라 잔여 연차가 0이거나 부족하더라도 신청 허용
      // (초과 사용분은 향후 월별 발생 연차와 자동 상계 처리됨)
    }

    if (code === '외근') {
      const pStart = values['period'];
      const dest = values['destination'];
      if (!pStart) return '외근 일자/기간을 입력하세요.';
      if (!dest || !String(dest).trim()) return '외근지(방문처)를 입력하세요.';
    }

    if (code === '국내출장' || code === '해외출장') {
      const pStart = values['period'];
      const dest = values['destination'];
      if (!pStart) return '출장 기간을 입력하세요.';
      if (!dest || !String(dest).trim()) return '출장지를 입력하세요.';
    }

    if (forSubmit) {
      if (form) {
        const userRank = org.positions.find((p) => p.name === me.position)?.rank ?? 9;
        const userDeptNode = org.depts.find((d) => d.name === me.dept);
        const userDeptId = userDeptNode?.id ?? null;
        const userJobTitle = me.jobTitle || '';

        // 1순위: 개별 예외 사용자 지정 허용 검사
        const isUserExcepted = form.allowedUserIds && form.allowedUserIds.includes(me.id);

        // 2순위: 허용 지정 부서 프리패스 검사
        const isDeptExcepted = form.allowedDeptIds && form.allowedDeptIds.length > 0 && !!userDeptId && form.allowedDeptIds.includes(userDeptId);

        // 3순위: 일반 규칙 (직급 범위 및 직책 범위)
        const hasRankConstraint = form.allowedPositionFromRank != null || form.allowedPositionToRank != null;
        const hasJobConstraint = form.allowedJobTitles && form.allowedJobTitles.length > 0;

        const isRankAllowed = 
          (form.allowedPositionFromRank == null || userRank <= form.allowedPositionFromRank) &&
          (form.allowedPositionToRank == null || userRank >= form.allowedPositionToRank);

        const isJobAllowed = 
          !form.allowedJobTitles || 
          form.allowedJobTitles.length === 0 || 
          form.allowedJobTitles.includes(userJobTitle);

        let isGeneralRuleAllowed = true;
        if (hasRankConstraint && hasJobConstraint) {
          isGeneralRuleAllowed = isRankAllowed || isJobAllowed;
        } else if (hasRankConstraint) {
          isGeneralRuleAllowed = isRankAllowed;
        } else if (hasJobConstraint) {
          isGeneralRuleAllowed = isJobAllowed;
        }

        // 전체 판정: 예외 사원이거나, 부서 프리패스 통과거나, 일반 자격 조건 만족 시 허용
        const isDrafterAllowed = isUserExcepted || isDeptExcepted || isGeneralRuleAllowed;

        if (!isDrafterAllowed) {
          return '본 서식의 기안 권한이 없습니다. (허용 직급/직책/부서 예외 대상 아님)';
        }
      }

      if (!steps.some((s) => s.kind !== '참조')) return '상신하려면 결재자를 1명 이상 지정하세요.';
    }
    return null;
  };

  // 사용자의 직책 권한에 따라 비활성화할 서식(forms) 판정
  const disabledFormCodes = useMemo(() => {
    const userRank = org.positions.find((p) => p.name === me.position)?.rank ?? 9;
    const userDeptNode = org.depts.find((d) => d.name === me.dept);
    const userDeptId = userDeptNode?.id ?? null;
    const userJobTitle = me.jobTitle || '';
    const disabledCodes = new Set<string>();

    for (const f of forms) {
      if (f.code === '기안' || f.code === '전체') continue;

      // 1순위: 개별 예외 사용자 지정 허용 검사
      const isUserExcepted = f.allowedUserIds && f.allowedUserIds.includes(me.id);

      // 2순위: 허용 지정 부서 프리패스 검사
      const isDeptExcepted = f.allowedDeptIds && f.allowedDeptIds.length > 0 && !!userDeptId && f.allowedDeptIds.includes(userDeptId);

      // 3순위: 일반 규칙 (직급 범위 및 직책 범위)
      const hasRankConstraint = f.allowedPositionFromRank != null || f.allowedPositionToRank != null;
      const hasJobConstraint = f.allowedJobTitles && f.allowedJobTitles.length > 0;

      const isRankAllowed = 
        (f.allowedPositionFromRank == null || userRank <= f.allowedPositionFromRank) &&
        (f.allowedPositionToRank == null || userRank >= f.allowedPositionToRank);

      const isJobAllowed = 
        !f.allowedJobTitles || 
        f.allowedJobTitles.length === 0 || 
        f.allowedJobTitles.includes(userJobTitle);

      let isGeneralRuleAllowed = true;
      if (hasRankConstraint && hasJobConstraint) {
        isGeneralRuleAllowed = isRankAllowed || isJobAllowed;
      } else if (hasRankConstraint) {
        isGeneralRuleAllowed = isRankAllowed;
      } else if (hasJobConstraint) {
        isGeneralRuleAllowed = isJobAllowed;
      }

      // 전체 판정: 예외 사원이거나, 부서 프리패스 통과거나, 일반 자격 조건 만족 시 허용
      const isDrafterAllowed = isUserExcepted || isDeptExcepted || isGeneralRuleAllowed;

      if (!isDrafterAllowed) {
        disabledCodes.add(f.code);
      }
    }
    return disabledCodes;
  }, [forms, me.position, me.dept, me.jobTitle, me.id, org]);

  useEffect(() => {
    if (disabledFormCodes.has(code)) {
      const available = forms.find((f) => f.code !== '전체' && !disabledFormCodes.has(f.code));
      if (available) setCode(available.code);
    }
  }, [disabledFormCodes, code, forms]);



  const persistDraft = async (): Promise<string> => {
    const input = buildInput();
    if (editDoc && editDoc.status === '임시저장') {
      await save.mutateAsync({ id: editDoc.id, patch: input });
      return editDoc.id;
    }
    const created = await create.mutateAsync(input);
    return created.id;
  };

  // 기존 임시저장 문서를 편집 중일 때, 변경사항이 있으면 60초마다 서버(DB)에 백그라운드 자동 저장
  useEffect(() => {
    if (!editDoc || editDoc.status !== '임시저장') return;

    const interval = setInterval(async () => {
      if (hasManuallyEnteredValues() && title.trim() && !busy) {
        try {
          const input = buildInput();
          await save.mutateAsync({ id: editDoc.id, patch: input });
          if (initialStateRef.current) {
            initialStateRef.current = {
              code,
              title,
              values: JSON.parse(JSON.stringify(values)),
              amount,
              attachments: JSON.parse(JSON.stringify(attachments)),
              relatedDocs: JSON.parse(JSON.stringify(relatedDocs)),
              steps: JSON.parse(JSON.stringify(steps)),
              recipients: JSON.parse(JSON.stringify(recipients)),
              securityLevel,
              visibility,
              preservationPeriod,
            };
          }
        } catch {
          // 백그라운드 자동 저장은 실패하더라도 사용자 작업을 방해하지 않음
        }
      }
    }, 60000);

    return () => clearInterval(interval);
  }, [editDoc?.id, editDoc?.status, busy, title, values, amount, attachments, relatedDocs, steps, recipients, code, securityLevel, visibility, preservationPeriod]);

  const onSaveDraft = async () => {
    const err = validate(false);
    if (err) {
      alert(err);
      return setError(err);
    }
    setError('');
    try {
      await persistDraft();
      clearAutosave();
      navigate('/gw/approval?box=임시');
    } catch (e) {
      setError(String(e));
    }
  };

  const onSubmit = async () => {
    const err = validate(true);
    if (err) {
      alert(err);
      return setError(err);
    }
    setError('');
    try {
      const id = await persistDraft();
      await submitM.mutateAsync({ id, userId: me.id });
      clearAutosave();
      navigate('/gw/approval?box=상신');
    } catch (e) {
      setError(String(e));
    }
  };





  return (
    <div className="flex w-full flex-col bg-panel">
      {/* 상단 헤더 툴바 — body 스크롤 기준으로 sticky top-0 고정
           (/gw에서 main overflow 없음 → body가 스크롤 → 스크롤 내리면 Topbar가 사라지고 이 헤더가 스크린 상단에 고정됨) */}
      <header className="sticky top-0 z-30 h-[53px] flex shrink-0 items-center justify-between border-b border-border bg-panel/95 backdrop-blur-md px-6 shadow-xs">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleAttemptClose}
            className="grid h-8 w-8 place-items-center rounded-lg text-[16px] text-ink3 hover:bg-panel-alt transition-colors"
            title="목록으로 돌아가기"
          >
            ←
          </button>
          <div className="flex items-center gap-2.5">
            <h1 className="text-[15px] font-extrabold text-ink flex items-center gap-2">
              <span>{cancelTargetDoc ? '취소 결재(취소 기안) 작성' : isResubmit ? '반려 문서 수정·재상신' : editDoc ? '기안 문서 편집' : '기안 작성'}</span>
            </h1>
            {cancelTargetDoc && (
              <span className="flex items-center gap-1 rounded-lg bg-rose-500/10 px-2.5 py-1 text-[11px] font-extrabold text-rose-600 border border-rose-500/30">
                취소 대상: {cancelTargetDoc.docNo}
              </span>
            )}
            <div className="flex items-center gap-1.5 rounded-lg bg-teal-soft/80 px-2.5 py-1 text-[11.5px] font-extrabold text-teal border border-teal/20 shadow-2xs">
              <span>{form?.icon || '📄'}</span>
              <span>{form?.name || code}</span>
            </div>
            {canChangeForm && (
              <button
                type="button"
                onClick={handleClickChangeForm}
                className="flex items-center gap-1.5 rounded-lg border border-teal/40 bg-teal-soft/60 px-3 py-1.5 text-[11.5px] font-extrabold text-teal hover:bg-teal hover:text-white transition-all shadow-xs cursor-pointer ml-1"
                title="다른 결재 양식으로 변경합니다"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>양식 변경</span>
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!isWideScreen && (
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="flex items-center gap-1.5 rounded-lg border border-teal/40 bg-teal-soft/50 px-3 py-1.5 text-[12px] font-bold text-teal hover:bg-teal-soft transition-colors"
            >
              <span className="flex items-center gap-1.5">
                <GitFork size={13} />
                <span>결재선</span>
              </span>
              <span className="rounded-full bg-teal px-1.5 py-0.2 text-[10px] font-extrabold text-white">
                {steps.length}명
              </span>
            </button>
          )}

          <div className="flex items-center gap-1.5">
            <AutosaveIndicator at={autosavedAt} />
            <button
              type="button"
              onClick={() => setShowBackupHistoryModal(true)}
              className="flex items-center gap-1 rounded-lg border border-border bg-white px-2 py-1 text-[11px] font-bold text-ink hover:border-teal hover:text-teal transition-all shadow-2xs cursor-pointer"
              title="이 브라우저에 임시 보관된 기안 목록을 조회하고 복구합니다"
            >
              <History className="h-3 w-3 text-teal" />
              <span>보관함</span>
            </button>
          </div>
          {/* 대체휴무 잔여 0일 시 상단 경고 뱃지 */}
          {(() => {
            const currentLType = String(values['leaveType'] || '').trim();
            const isSub = (code === '휴가' || form?.code === '휴가') && (currentLType.includes('대체휴무') || currentLType === 'SUBSTITUTE');
            const subRem = Number(bal?.substituteHoliday?.remaining ?? 0);
            if (isSub && subRem <= 0) {
              return (
                <span className="rounded-lg bg-rose-50 px-2.5 py-1 text-[11px] font-bold text-rose-600 border border-rose-200 shadow-2xs animate-pulse">
                  잔여 대휴 0일 (상신 불가)
                </span>
              );
            }
            return null;
          })()}
          {hasFormMasterUpdates && (
            <button
              type="button"
              onClick={handleApplyAllMasterUpdates}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500 hover:text-white px-3.5 py-1.5 text-[12px] font-bold text-amber-700 dark:text-amber-400 transition-all shadow-2xs cursor-pointer animate-in fade-in"
              title="서식 마스터의 최신 변경사항(자동 계산 수식, 셀 병합, 열 구조 등)을 전체 표에 일괄 적용합니다. 이미 작성하신 내용은 안전하게 보존됩니다."
            >
              <Sparkles className="h-3.5 w-3.5 text-amber-500" />
              <span>최신 서식 반영</span>
            </button>
          )}
          {!isResubmit && (
            <button
              type="button"
              onClick={onSaveDraft}
              disabled={busy || !canCreate}
              className="rounded-lg border border-border px-3.5 py-1.5 text-[12px] font-bold text-ink2 hover:bg-panel-alt transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              임시저장
            </button>
          )}
          {(() => {
            const currentLType = String(values['leaveType'] || '').trim();
            const isSub = (code === '휴가' || form?.code === '휴가') && (currentLType.includes('대체휴무') || currentLType === 'SUBSTITUTE');
            const subRem = Number(bal?.substituteHoliday?.remaining ?? 0);
            const isBlockedBySub = isSub && subRem <= 0;

            return (
              <button
                type="button"
                onClick={onSubmit}
                disabled={busy || !canCreate || isBlockedBySub}
                title={isBlockedBySub ? '보유하신 잔여 대체휴무가 없어 상신할 수 없습니다.' : undefined}
                className={`rounded-lg px-4 py-1.5 text-[12.5px] font-bold text-white transition-colors shadow-xs ${
                  isBlockedBySub
                    ? 'bg-gray-400 cursor-not-allowed opacity-60'
                    : 'bg-teal hover:bg-teal-dark disabled:opacity-40 disabled:cursor-not-allowed'
                }`}
              >
                {busy ? '상신 중...' : isResubmit ? '재상신' : '상신 발송'}
              </button>
            );
          })()}
        </div>
      </header>

      {/* 에러 메시지 팝업 바 */}
      {error && (
        <div className="flex items-center justify-between bg-rose-500/10 border-b border-rose-500/30 px-6 py-2 text-[12px] font-bold text-rose-600">
          <span className="flex items-center gap-1.5">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </span>
          <button type="button" onClick={() => setError('')} className="text-rose-500 hover:text-rose-700">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      {/* 기안 워크스페이스 본문 메인 레이아웃 (세로 완전 분리: 좌측 #878d90 공문서 캔버스 + 우측 세로 고정 결재선 사이드바) */}
      <div className="flex flex-1 w-full bg-[#878d90] min-h-[calc(100vh-53px)]">
        {/* 중앙 A4 문서 캔버스 (배경색 #878d90으로 백색 A4 용지와 완벽한 대비 및 세로 스크롤) */}
        <div className="flex-1 min-w-0 px-4 sm:px-8 py-8 overflow-y-auto flex flex-col items-center bg-[#878d90] transition-colors">
          {cancelTargetDoc && (
            <div className="mx-auto mb-5 w-full max-w-[800px] rounded-xl border border-rose-500/40 bg-rose-50/95 dark:bg-zinc-900 p-4 text-[12px] text-rose-950 dark:text-rose-200 shadow-md backdrop-blur-xs flex items-center justify-between animate-fade-in">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
                <div>
                  <div className="font-extrabold text-[13px] text-rose-700 dark:text-rose-400">
                    [결재 취소 신청 모드] 대상 원문서: {cancelTargetDoc.title} ({cancelTargetDoc.docNo})
                  </div>
                  <div className="text-[11.5px] text-rose-800/90 dark:text-rose-300 mt-1 leading-relaxed">
                    본 문서는 기결재 완료된 원문서의 효력을 취소하기 위한 취소 기안입니다.
                    최종 결재 완료 시 원문서 상태는 <strong className="font-extrabold text-rose-600 underline">&apos;취소완료&apos;</strong>로 전이되며, 연동된 휴가 차감 일수 환원 및 캘린더 일정/휴가중 상태가 즉시 자동 취소됩니다.
                  </div>
                </div>
              </div>
            </div>
          )}
          <ApprovalDraftDocumentSheet
            form={form}
            docCode={code}
            me={me}
            title={title}
            setTitle={setTitle}
            values={values}
            setVals={setVals}
            amount={amount}
            setAmount={setAmount}
            securityLevel={securityLevel}
            setSecurityLevel={setSecurityLevel}
            visibility={visibility}
            setVisibility={setVisibility}
            preservationPeriod={preservationPeriod}
            setPreservationPeriod={setPreservationPeriod}
            isPostApproval={isPostApproval}
            setIsPostApproval={setIsPostApproval}
            isPostApprovalSystemEnabled={isPostApprovalSystemEnabled}
            postApprovedAt={postApprovedAt}
            setPostApprovedAt={setPostApprovedAt}
            postApprovedBy={postApprovedById}
            setPostApprovedBy={setPostApprovedById}
            postApprovalActionTaken={postApprovalActionTaken}
            setPostApprovalActionTaken={setPostApprovalActionTaken}
            postApprovalNecessity={postApprovalNecessity}
            setPostApprovalNecessity={setPostApprovalNecessity}
            steps={steps}
            recipients={recipients}
            attachments={attachments}
            setAttachments={setAttachments}
            attachmentRetention={attachmentRetention}
            setAttachmentRetention={setAttachmentRetention}
            relatedDocs={relatedDocs}
            setRelatedDocs={setRelatedDocs}
            setShowRelatedModal={setShowRelatedModal}
            onFileUpload={handleFilesUpload}
            uploading={uploading}
            leaveBalance={bal}
            holidays={holidayList}
            editDocNo={editDoc?.docNo}
            lastSavedAt={autosavedAt}
          />
        </div>

        {/* [3단] 우측 결재선 전용 고정 사이드바 — 공문서 공간과 세로 경계선으로 완벽 분리, 상단부터 바닥까지 100% 꽉 채움 */}
        {isWideScreen && (
          <aside
            className="w-[410px] xl:w-[430px] shrink-0 border-l border-slate-400/40 dark:border-slate-700 bg-panel sticky top-[53px] h-[calc(100vh-53px)] flex flex-col z-20 shadow-md"
          >
            {/* 패널 내부 헤더 — 패널 상단 고정 */}
            <div className="sticky top-0 z-10 flex shrink-0 items-center justify-between border-b border-border bg-panel-alt/95 backdrop-blur-sm px-4 py-3">
              <span className="text-[13px] font-extrabold text-ink flex items-center gap-1.5">
                <GitFork className="h-4 w-4 text-teal shrink-0" />
                <span>결재선 설정</span>
              </span>
              <span className="text-[11px] text-ink3 font-semibold">
                {steps.length}명 지정됨
              </span>
            </div>

            {/* 결재선 빌더 + 수신/시행 (bottomSlot) — 내부 독립 스크롤 */}
            <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-4 py-4">
              <ApprovalLineBuilder
                steps={steps}
                onChange={setSteps}
                drafterId={me.id}
                docType={code}
                amount={amountNum}
                docData={values}
                isAgreementEnabled={isAgreementEnabled}
                bottomSlot={
                  <DraftRecipientSection
                    recipients={recipients}
                    setRecipients={setRecipients}
                    org={org}
                  />
                }
              />
            </div>
          </aside>
        )}

      </div>

      {/* 해상도 작을 때 우측 결재선 Drawer (header z-[200]보다 높은 z-[300] 지정) */}
      {drawerOpen && (
        <div className="fixed inset-0 z-[300] flex justify-end bg-black/40 xl:hidden" onClick={() => setDrawerOpen(false)}>
          <div className="h-full w-full max-w-lg bg-panel p-4 shadow-2xl flex flex-col overflow-y-auto overflow-x-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-border pb-3 mb-4">
              <span className="text-[15px] font-bold text-ink flex items-center gap-1.5">
                <GitFork className="h-4 w-4 text-teal shrink-0" />
                <span>결재선 설정</span>
              </span>
              <button type="button" onClick={() => setDrawerOpen(false)} className="text-ink3 hover:text-ink">
                <X className="h-4 w-4" />
              </button>
            </div>
            <ApprovalLineBuilder
              steps={steps}
              onChange={setSteps}
              drafterId={me.id}
              docType={code}
              amount={amountNum}
              docData={values}
              isAgreementEnabled={isAgreementEnabled}
              bottomSlot={
                <DraftRecipientSection
                  recipients={recipients}
                  setRecipients={setRecipients}
                  org={org}
                />
              }
            />
          </div>
        </div>
      )}


      {/* 다이얼로그 모달 모음 */}
      {showConfirmClose && (
        <DraftConfirmDialog
          title="작성 취소 확인"
          description={<>입력한 내용이 있습니다.<br />작성 중인 내용을 저장하고 이동하시겠습니까?</>}
          confirmLabel="저장 후 이동"
          onConfirm={async () => {
            /**
             * **저장 조건을 먼저 확인한다.**
             *
             * 임시저장 버튼은 `validate(false)` 를 거쳐 "제목을 입력하세요"를 띄우는데,
             * 이 경로는 그걸 건너뛰고 곧장 저장을 시도했다. 제목이 없으면 저장이 실패하고
             * 아무 안내도 없이 화면만 그대로 있어 **"눌러도 아무 일이 없다"** 로 보였다.
             */
            const err = validate(false);
            if (err) {
              setShowConfirmClose(false);
              setError(err);
              return;
            }
            try {
              await persistDraft();
              clearAutosave();
              setShowConfirmClose(false);
              navigate('/gw/approval');
            } catch (e) {
              // 저장이 실패하면 이동하지 않는다. 원인을 화면에 남긴다.
              setShowConfirmClose(false);
              setError(e instanceof Error ? e.message : String(e));
            }
          }}
          onDiscard={() => {
            clearAutosave();
            navigate('/gw/approval');
          }}
          discardLabel="저장 없이 이동"
          onCancel={() => setShowConfirmClose(false)}
          disabled={busy}
        />
      )}


      {showAutosaveRecoverModal && (
        <DraftConfirmDialog
          title="작성 중이던 문서 복구"
          description={
            <>
              이전에 작성 중이던 임시 저장 문서가 존재합니다.<br />
              <strong>서식: {autosaveFormName}</strong><br /><br />
              작성 중이던 내용을 불러오시겠습니까?
            </>
          }
          confirmLabel="내용 불러오기"
          onConfirm={() => {
            if (pendingAutosaveData) {
              const data = pendingAutosaveData;
              if (!editDoc && data.code) setCode(data.code);
              setTitle(data.title || '');
              setValues(data.values || {});
              setAmount(data.amount || '');
              if (data.securityLevel) setSecurityLevel(data.securityLevel);
              if (data.visibility) setVisibility(data.visibility === '비공개' ? '비공개' : '부서');
              if (data.preservationPeriod) setPreservationPeriod(data.preservationPeriod);
              if (data.attachments) setAttachments(data.attachments);
              if (data.recipients) setRecipients(data.recipients);
              if (data.relatedDocs) setRelatedDocs(data.relatedDocs);
              if (data.steps) setSteps(data.steps);
              if (data.isPostApproval !== undefined) setIsPostApproval(Boolean(data.isPostApproval));
              if (data.postApprovalActionTaken !== undefined) setPostApprovalActionTaken(data.postApprovalActionTaken || '');
              if (data.postApprovalNecessity !== undefined) setPostApprovalNecessity(data.postApprovalNecessity || '');
              if (data.postApprovedAt !== undefined) setPostApprovedAt(data.postApprovedAt || '');
              if (data.postApprovedById !== undefined) setPostApprovedById(data.postApprovedById || '');
              // 닫힌 탭의 보관본을 불러왔으면 이 탭 키로 옮긴다 — 이후 자동보관이 이어지고, 보관함에 중복으로 남지 않는다.
              const source = bootDraftRef.current;
              if (source && source.draftKey !== draftKey) {
                try {
                  localStorage.setItem(draftKey, JSON.stringify(data));
                  localStorage.removeItem(source.draftKey);
                } catch { /* 옮기지 못해도 원본은 보관함에 남는다 */ }
              }
            }
            setShowAutosaveRecoverModal(false);
            setPendingAutosaveData(null);
          }}
          onCancel={() => {
            // 취소 클릭 시 데이터를 절대 삭제하지 않고 모달만 닫음 (우측 상단 [보관함]에 항상 보존)
            setShowAutosaveRecoverModal(false);
            setPendingAutosaveData(null);
          }}
        />
      )}

      {/* 로컬 임시 보관함 기록 조회 및 실시간 미리보기(Preview) 2열 모달 */}
      {showBackupHistoryModal && (() => {
        const activeKey = (selectedBackupKey && backups.some((b) => b.key === selectedBackupKey))
          ? selectedBackupKey
          : (backups[0]?.key ?? null);
        const selectedBackup = backups.find((b) => b.key === activeKey) ?? null;

        const handleDeleteBackup = (e: React.MouseEvent, key: string) => {
          e.stopPropagation();
          if (!window.confirm('이 보관 기록을 삭제하시겠습니까?')) return;
          if (key.startsWith('draft_autosave_')) {
            localStorage.removeItem(key);
            localStorage.removeItem(key.replace('draft_autosave_', 'draft_autosave_active_'));
          } else {
            try {
              const raw = localStorage.getItem(HISTORY_KEY);
              if (raw) {
                const arr = JSON.parse(raw);
                const filtered = arr.filter((x: any) => (x.id || `hist_${x.timestamp}`) !== key);
                localStorage.setItem(HISTORY_KEY, JSON.stringify(filtered));
              }
            } catch {}
          }
          if (selectedBackupKey === key) {
            setSelectedBackupKey(null);
          }
          setBackupHistoryVersion((v) => v + 1);
        };

        const selectedForm = forms.find((f) => f.code === selectedBackup?.code);

        const previewDoc: ApprovalDoc | null = selectedBackup?.data ? {
          id: selectedBackup.key,
          docNo: editDoc?.docNo || '(임시 보관본)',
          docType: selectedBackup.data.code || '기안',
          status: '임시저장',
          title: selectedBackup.data.title || '(제목 없음)',
          drafterId: me.id,
          drafterName: me.name,
          drafterSignType: me.signType,
          drafterSignUrl: me.signUrl,
          drafterSealUrl: me.sealUrl,
          drafterDept: me.dept || '',
          drafterPos: me.position || '',
          securityLevel: selectedBackup.data.securityLevel || '일반',
          visibility: selectedBackup.data.visibility === '비공개' ? '비공개' : '부서',
          preservationPeriod: selectedBackup.data.preservationPeriod || '5년',
          createdAt: new Date(selectedBackup.timestamp).toISOString(),
          updatedAt: new Date(selectedBackup.timestamp).toISOString(),
          steps: (selectedBackup.data.steps || []).map((s: any, idx: number) => ({
            seq: s.seq ?? idx + 1,
            kind: s.kind || s.type || '결재',
            approverId: s.approverId || s.userId || '',
            decision: s.decision || '대기',
            comment: s.comment || '',
            ...s,
          })),
          body: selectedBackup.data.values?.[RESERVED_BODY_KEY] || '',
          fieldValues: selectedBackup.data.values || {},
          form: (selectedBackup.data.code === '휴가' || selectedBackup.data.values?.leaveType) ? {
            leaveType: selectedBackup.data.values?.leaveType || '연차',
            startDate: selectedBackup.data.values?.period || '',
            endDate: selectedBackup.data.values?.period__end || '',
            days: Number(selectedBackup.data.values?.['period__days']) || 1,
            substituteId: selectedBackup.data.values?.substituteId || '',
            emergencyContact: selectedBackup.data.values?.emergencyContact || '',
            reason: selectedBackup.data.values?.[RESERVED_BODY_KEY] || '',
          } : undefined,
          amount: selectedBackup.data.amount ? Number(selectedBackup.data.amount) : undefined,
          attachments: selectedBackup.data.attachments || [],
          recipients: selectedBackup.data.recipients || [],
          relatedDocs: selectedBackup.data.relatedDocs || [],
          isPostApproval: selectedBackup.data.isPostApproval,
          postApprovalActionTaken: selectedBackup.data.postApprovalActionTaken,
          postApprovalNecessity: selectedBackup.data.postApprovalNecessity,
          postApprovedAt: selectedBackup.data.postApprovedAt,
          postApprovedById: selectedBackup.data.postApprovedById,
        } as unknown as ApprovalDoc : null;

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-2 sm:p-5 animate-in fade-in duration-150">
            <div className="w-full max-w-6xl rounded-2xl bg-white shadow-2xl border border-border flex flex-col h-[90vh] max-h-[900px] overflow-hidden">
              {/* Modal Header */}
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-panel shrink-0">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-soft text-teal">
                    <History className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-[15px] font-bold text-ink flex items-center gap-2">
                      로컬 임시 보관함
                      <span className="text-[11px] font-normal px-2 py-0.5 rounded-full bg-teal/10 text-teal">
                        총 {backups.length}개 기록
                      </span>
                    </h3>
                    <p className="text-[11.5px] text-ink3">저장된 작업 이력을 실제 결재 문서 양식으로 확인하고 원하는 버전을 복구합니다.</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowBackupHistoryModal(false)}
                  className="p-1.5 text-ink3 hover:bg-panel-alt rounded-lg cursor-pointer transition-colors"
                  title="닫기"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Modal Body: 2 Columns */}
              {backups.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center p-12 text-center text-ink3 bg-panel-alt/20">
                  <History className="h-12 w-12 text-ink3/40 mb-3" />
                  <p className="text-[14px] font-bold text-ink">저장된 로컬 보관 기록이 없습니다.</p>
                  <p className="text-[12px] text-ink3 mt-1">기안을 작성하시면 최소 1분 주기 및 변경 시점에 자동으로 안전하게 보관됩니다.</p>
                </div>
              ) : (
                <div className="flex-1 flex min-h-0 overflow-hidden divide-x divide-border">
                  {/* Left Column: Version History List (w-80) */}
                  <div className="w-72 sm:w-80 shrink-0 flex flex-col bg-panel/20 overflow-hidden">
                    <div className="p-3 border-b border-border/80 bg-panel/60 text-[11.5px] font-bold text-ink3 flex items-center justify-between">
                      <span>버전 타임라인</span>
                      <span>최근 20개</span>
                    </div>
                    <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
                      {backups.map((b) => {
                        const isSelected = b.key === activeKey;
                        const formTitle = forms.find((f) => f.code === b.code)?.name || b.code;
                        const stamp = b.timestamp
                          ? new Intl.DateTimeFormat('ko-KR', {
                              timeZone: 'Asia/Seoul',
                              month: '2-digit',
                              day: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit',
                              second: '2-digit',
                            }).format(b.timestamp)
                          : '알 수 없음';

                        return (
                          <div
                            key={b.key}
                            onClick={() => setSelectedBackupKey(b.key)}
                            className={`p-3 rounded-xl border transition-all cursor-pointer text-left relative group ${
                              isSelected
                                ? 'border-teal bg-teal/5 ring-1 ring-teal/30 shadow-xs'
                                : 'border-border bg-white hover:border-border-strong hover:bg-panel-alt/50'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-1 mb-1">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                                  isSelected ? 'bg-teal text-white' : 'bg-teal/10 text-teal'
                                }`}>
                                  {formTitle}
                                </span>
                                {b.tag && (
                                  <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${
                                    b.tag === '현재 작성중'
                                      ? 'bg-emerald-50 text-emerald-600 border border-emerald-200'
                                      : b.tag.includes('양식 변경')
                                      ? 'bg-amber-50 text-amber-600 border border-amber-200'
                                      : 'bg-gray-100 text-gray-600 border border-gray-200'
                                  }`}>
                                    {b.tag}
                                  </span>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={(e) => handleDeleteBackup(e, b.key)}
                                className="p-1 rounded-md text-ink3 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                                title="이 보관 기록 삭제"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                            <div className={`text-[12.5px] font-bold truncate mb-1 ${isSelected ? 'text-teal-dark' : 'text-ink'}`}>
                              {b.title || '(제목 없음)'}
                            </div>
                            <div className="flex items-center justify-between text-[11px] text-ink3 tabular-nums">
                              <span>{stamp}</span>
                              {isSelected && <ChevronRight className="h-3.5 w-3.5 text-teal" />}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Right Column: Exact Document View Canvas */}
                  {selectedBackup && previewDoc ? (
                    <div className="flex-1 flex flex-col min-w-0 bg-[#878d90] overflow-hidden">
                      {/* Top Action Header */}
                      <div className="px-5 py-3 border-b border-border bg-white flex items-center justify-between gap-3 shrink-0 shadow-xs z-10">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-soft text-teal shrink-0">
                            <Eye className="h-4 w-4" />
                          </span>
                          <div className="min-w-0">
                            <div className="text-[13.5px] font-bold text-ink flex items-center gap-2">
                              <span className="truncate">{selectedForm?.name || selectedBackup.code} 문서 미리보기</span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-teal/10 text-teal font-semibold shrink-0">실제 서식 원본</span>
                            </div>
                            <div className="text-[11px] text-ink3 tabular-nums">
                              보관 시점: {new Intl.DateTimeFormat('ko-KR', {
                                timeZone: 'Asia/Seoul',
                                year: 'numeric',
                                month: '2-digit',
                                day: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit',
                                second: '2-digit',
                              }).format(selectedBackup.timestamp)}
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            if (window.confirm('이 보관본의 내용을 현재 화면으로 불러오시겠습니까?\n(현재 화면의 입력값이 덮어써집니다)')) {
                              const data = selectedBackup.data;
                              if (data) {
                                if (!editDoc && data.code) setCode(data.code);
                                setTitle(data.title || '');
                                setValues(data.values || {});
                                setAmount(data.amount || '');
                                if (data.securityLevel) setSecurityLevel(data.securityLevel);
                                if (data.visibility) setVisibility(data.visibility === '비공개' ? '비공개' : '부서');
                                if (data.preservationPeriod) setPreservationPeriod(data.preservationPeriod);
                                if (data.attachments) setAttachments(data.attachments);
                                if (data.recipients) setRecipients(data.recipients);
                                if (data.relatedDocs) setRelatedDocs(data.relatedDocs);
                                if (data.steps) setSteps(data.steps);
                                if (data.isPostApproval !== undefined) setIsPostApproval(Boolean(data.isPostApproval));
                                if (data.postApprovalActionTaken !== undefined) setPostApprovalActionTaken(data.postApprovalActionTaken || '');
                                if (data.postApprovalNecessity !== undefined) setPostApprovalNecessity(data.postApprovalNecessity || '');
                                if (data.postApprovedAt !== undefined) setPostApprovedAt(data.postApprovedAt || '');
                                if (data.postApprovedById !== undefined) setPostApprovedById(data.postApprovedById || '');
                              }
                              setShowBackupHistoryModal(false);
                            }
                          }}
                          className="rounded-lg bg-teal hover:bg-teal-dark text-white px-4 py-2 text-[12px] font-bold shadow-sm transition-all flex items-center gap-1.5 cursor-pointer shrink-0"
                        >
                          <CheckCircle2 className="h-4 w-4" />
                          이 버전 불러오기
                        </button>
                      </div>

                      {/* Actual Document View Sheet inside Canvas */}
                      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 flex justify-center">
                        <div className="w-full max-w-[800px] shadow-xl rounded-sm overflow-hidden bg-white border border-black/10 self-start">
                          <ApprovalDocumentView
                            doc={previewDoc}
                            formOverride={selectedForm}
                            currentUser={{ id: me.id, dept: me.dept }}
                            isPreview={true}
                          />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-ink3 bg-panel-alt/30">
                      <FileText className="h-10 w-10 text-ink3/40 mb-2" />
                      <p className="text-[13px] font-medium">좌측 목록에서 보관 기록을 선택하세요.</p>
                      <p className="text-[11.5px] text-ink3/80 mt-0.5">실제 결재 문서와 100% 동일한 양식으로 미리 볼 수 있습니다.</p>
                    </div>
                  )}
                </div>
              )}

              {/* Modal Footer */}
              <div className="px-6 py-3 border-t border-border bg-panel flex items-center justify-between shrink-0">
                <p className="text-[11.5px] text-ink3 hidden sm:block">
                  ※ [이 버전 불러오기]를 누르면 현재 화면의 내용이 선택한 보관본으로 교체됩니다.
                </p>
                <button
                  type="button"
                  onClick={() => setShowBackupHistoryModal(false)}
                  className="rounded-lg border border-border px-4 py-1.5 text-[12px] font-bold text-ink hover:bg-panel-alt transition-colors cursor-pointer ml-auto"
                >
                  닫기
                </button>
              </div>
            </div>
          </div>
        );
      })()}


      {showRelatedModal && (
        <RelatedDocSearchModal
          userId={me.id}
          userDept={me.dept}
          userDeptId={userDeptId}
          selectedDocIds={relatedDocs.map((x) => x.docId)}
          onSelect={(selectedList) => {
            // 관련 기결재 문서 참조 링크 연동 (중복 저장 방지를 위해 첨부파일 복사는 수행하지 않음)
            setRelatedDocs((prev) => {
              const existingIds = new Set(prev.map((x) => x.docId));
              const newItems = selectedList.filter((x) => !existingIds.has(x.docId));
              return [...prev, ...newItems];
            });
            
            setShowRelatedModal(false);
          }}
          onClose={() => setShowRelatedModal(false)}
        />
      )}

      {/* 결재 양식 선택 모달 */}
      <DraftFormSelectModal
        open={showSelectModal && !cancelTargetDoc}
        onClose={() => setShowSelectModal(false)}
        onSelect={handleSelectNewForm}
        currentCode={code}
      />

      {/* 양식 변경 확인 다이얼로그 (작성 내용 보존 여부 선택) */}
      <FormChangeConfirmDialog
        open={showChangeConfirm}
        currentFormName={form?.name || code}
        onSaveAndChange={handleSaveAndChange}
        onDiscardAndChange={handleDiscardAndChange}
        onCancel={() => setShowChangeConfirm(false)}
        isSaving={isChangingFormSaving}
      />
    </div>
  );
}


