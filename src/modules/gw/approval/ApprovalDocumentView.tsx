import { useEffect, useMemo, useState } from 'react';
import { useOrgTree } from '@/features/gw/useOrgTree';
import { usePermission } from '@/features/auth/usePermission';
import { useApprovalForms } from '@/features/gw/useApprovalForms';
import type { ApprovalDoc, RelatedDoc } from '@/domain/approvalDoc/schema';
import { resolveSignatureSnapshot } from '@/domain/approvalDoc/signatureSnapshot';
import { getPredecessorsOf, getEffectiveRecipients } from '@/domain/approvalDoc/engine';
import { amountFieldOf, type ApprovalForm, type FormField } from '@/domain/approvalForm/schema';
import { fieldText, getCellMergeInfo, type CellMerge } from '@/modules/gw/approval/formFields';
import { ApprovalStampTable } from './components/ApprovalStampTable';
import { ApprovalDocMetaTable, MetaRow } from './components/ApprovalDocMetaTable';
import logoImg from '@/assets/logo.png';
import { useUsers } from '@/features/user/useUsers';
import { approvalDocRepo } from '@/data/approvalDoc/approvalDoc.repo';
import { RelatedDocDetailModal } from './RelatedDocDetailModal';
import { ShieldAlert, Lock, AlertTriangle, RotateCcw } from 'lucide-react';
import { downloadFile } from '@/shared/lib/download';

let cachedLogoDataUrl: string | null = null;

/**
 * 결재 문서 보기 — 전통 기안문서 양식(우상단 결재란 도장 grid + A4 레이아웃).
 * 격식(문서명·맺음말)과 상세 필드는 결재서식(approvalForms) 정의로 동적 생성한다.
 * 인쇄 시 `.approval-print` 만 노출(index.css). 테마 무관 백지·흑자 고정.
 */

/** 서식 미로드/미정의 시 기본 격식 폴백. */
const FALLBACK_TITLE: Record<string, string> = {
  기안: '기 안 서',
  품의: '품 의 서',
  지출결의: '지 출 결 의 서',
  휴가: '휴 가 원',
  취소신청: '취 소 신 청 서',
};
const FALLBACK_CLOSING: Record<string, string> = {
  기안: '위와 같이 기안하오니 재가하여 주시기 바랍니다.',
  품의: '위와 같이 품의하오니 재가하여 주시기 바랍니다.',
  지출결의: '위와 같이 지출을 청구하오니 재가하여 주시기 바랍니다.',
  휴가: '위와 같이 휴가를 신청하오니 재가하여 주시기 바랍니다.',
  취소신청: '위와 같이 결재 취소를 신청하오니 재가하여 주시기 바랍니다.',
};

function korDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}


export function ApprovalDocumentView({
  doc,
  formOverride,
  currentUser,
  isPreview = false,
}: {
  doc: ApprovalDoc;
  formOverride?: ApprovalForm;
  currentUser?: { id: string; dept?: string };
  isPreview?: boolean;
}) {
  const org = useOrgTree();
  const { data: users = [] } = useUsers();
  const { data: forms = [] } = useApprovalForms();
  const [accessibleRelatedDocs, setAccessibleRelatedDocs] = useState<RelatedDoc[]>([]);
  const [activeRelatedDocId, setActiveRelatedDocId] = useState<string | null>(null);

  useEffect(() => {
    if (!doc.relatedDocs || doc.relatedDocs.length === 0) {
      setAccessibleRelatedDocs([]);
      return;
    }
    let active = true;
    const checkPermissions = async () => {
      const results = await Promise.allSettled(
        doc.relatedDocs.map(async (rd) => {
          // B 문서를 get 해봄으로써 실제 열람 권한이 있는지 체크 (에러 시 rejected)
          await approvalDocRepo.get(rd.docId);
          return rd;
        })
      );
      if (!active) return;
      const filtered = results
        .filter((r): r is PromiseFulfilledResult<RelatedDoc> => r.status === 'fulfilled')
        .map((r) => r.value);
      setAccessibleRelatedDocs(filtered);
    };
    checkPermissions();
    return () => {
      active = false;
    };
  }, [doc.relatedDocs]);

  const [processedLogo, setProcessedLogo] = useState<string>(logoImg);

  useEffect(() => {
    if (cachedLogoDataUrl) {
      setProcessedLogo(cachedLogoDataUrl);
      return;
    }
    const img = new Image();
    img.src = logoImg;
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imgData.data;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];
        if (r > 200 && g > 200 && b > 200 && a > 10) {
          data[i] = 0;
          data[i + 1] = 0;
          data[i + 2] = 0;
        }
      }
      ctx.putImageData(imgData, 0, 0);
      const dataUrl = canvas.toDataURL();
      cachedLogoDataUrl = dataUrl;
      setProcessedLogo(dataUrl);
    };
  }, []);

  const nameOf = (id: string) => {
    const u = org.userById(id) || users.find((x) => x.id === id);
    if (!u) return id;
    return u.status === '미사용' ? `${u.name}(퇴사)` : u.name;
  };
  const posOf = (id: string) => {
    const u = org.userById(id) || users.find((x) => x.id === id);
    return u?.position ?? '';
  };



  const { isAdmin, isExecutive: hasExecRole } = usePermission();
  // 사용자 정보 조회
  const userObj = currentUser?.id ? org.userById(currentUser.id) : null;
  const userPos = userObj?.position ?? '';
  const isExecutive =
    isAdmin ||
    hasExecRole ||
    ['대표이사', '상무', '상무이사', '전무', '부사장', '사장'].includes(userPos) ||
    userObj?.dept === '대표이사';

  // 1단계: 문서 자체의 보안 등급(securityLevel) 및 공개 범위(visibility)에 따른 물리적 접근 차단 판별
  const canAccessDocument = (() => {
    if (isPreview) return true; // 미리보기 시에는 통과
    if (!currentUser?.id) return true; // 미리보기 등 유저 미지정 시 허용

    // 1. 문서 공식 관계자 여부 판별 (최우선순위)
    const isDrafter = doc.drafterId === currentUser.id;
    const isApprover = doc.steps.some((s) => s.approverId === currentUser.id);

    // 수신 부서 ID 혹은 부서명 교차 비교 지원
    const effectiveRecipients = getEffectiveRecipients(doc);
    const isRecipient = effectiveRecipients.some((r) => {
      if (r.id === currentUser.id) return true;
      if (r.id === userObj?.dept) return true;
      const userDeptObj = org.depts.find(d => d.name === userObj?.dept);
      if (userDeptObj && (r.id === userDeptObj.id || r.name === userDeptObj.name)) return true;
      return false;
    });

    // 후임자 승계 대상자 판별
    const preds = getPredecessorsOf(currentUser.id);
    const isPredecessorRelated = preds.includes(doc.drafterId) || doc.steps.some(s => preds.includes(s.approverId));

    // 시행 담당 부서 및 시행 부서원 여부 판별
    const isExecutor = doc.executionDepts?.some((d) => {
      if (d.id === userObj?.dept) return true;
      const userDeptObj = org.depts.find(dept => dept.name === userObj?.dept);
      if (userDeptObj && d.id === userDeptObj.id) return true;
      return false;
    }) || doc.executionsSnapshot?.some((s) => {
      if (s.deptId === userObj?.dept || s.deptName === userObj?.dept) return true;
      const userDeptObj = org.depts.find(dept => dept.name === userObj?.dept);
      if (userDeptObj && s.deptId === userDeptObj.id) return true;
      return false;
    });

    const isOfficialRelated = isDrafter || isApprover || !!isRecipient || isPredecessorRelated || !!isExecutor;

    // 공식 관계자 및 후임자 승계자인 경우 등급/공개범위 무관 무조건 열람 가능 (제1순위)
    if (isOfficialRelated) return true;

    // 대표이사/상무이사 등 마스터 권한 소지 임원 (제2순위)
    if (isExecutive) return true;

    // 공개 범위 판별
    const vis = doc.visibility ?? '부서';
    // 비공개 문서인 경우 관계자/임원이 아니면 열람 불가 (제3순위)
    if (vis === '비공개') return false;

    // 부서공개 문서인 경우 소속 부서가 다르면 열람 불가 (제4순위)
    const myDeptObj = org.depts.find((d) => d.name === userObj?.dept);
    const myDeptId = myDeptObj?.id ?? '';
    const myDeptName = userObj?.dept ?? '';
    const drafterUser = org.userById(doc.drafterId);
    const drafterCurrentDeptName = drafterUser?.dept ?? '';
    const drafterCurrentDeptObj = org.depts.find((dept) => dept.name === drafterCurrentDeptName);
    const drafterCurrentDeptId = drafterCurrentDeptObj?.id ?? '';
    const docDeptId = doc.drafterDeptId || drafterCurrentDeptId;

    const isSameDept = docDeptId
      ? docDeptId === myDeptId
      : doc.drafterDept === myDeptName;
    if (!isSameDept) return false;

    // 물리적 보안등급 체크 (제5순위): 동일 부서원 중 일반 등급 문서만 열람 가능
    const secLevel = doc.securityLevel ?? '일반';
    if (secLevel === '일반') return true;

    return false; // 그 외 대외비/극비 문서는 관계자/임원이 아니므로 열람 불가
  })();



  // 2단계: 필드 단위 보안 마스킹 권한 판별 (canViewSecret)
  const [forceMaskMode, setForceMaskMode] = useState<boolean>(false);
  const canViewSecret = (() => {
    if (isPreview) return false; // 미리보기 모드에서는 기안자도 블러/마스킹된 모습 확인 가능하도록 false 반환
    if (!currentUser?.id) return true; // 권한 미전달 시 디폴트 노출 (미리보기 등)
    if (isExecutive) return true; // 대표이사/상무이사 100% 마스킹 해제 허용
    if (doc.status === '완료' && doc.drafterId === currentUser.id) return true; // 기안자 본인은 완료함 등 완결 상태일 때만 해제
    if (doc.steps.some((s) => s.approverId === currentUser.id && s.kind !== '참조')) return true; // 단순 참조 제외 승인 결재자
    return false;
  })();

  const isMaskingActive = !canViewSecret || forceMaskMode;


  const maskValue = (rawVal: string, isSecret?: boolean) => {
    if (!isSecret || !isMaskingActive) return rawVal;

    if (!rawVal || rawVal === '—') return '—';
    // 주민번호 패턴
    if (/^\d{6}[-s]?\d{7}$/.test(rawVal)) {
      return rawVal.replace(/^(\d{6})[-s]?\d{7}$/, '$1-*******');
    }
    // 금액/숫자 패턴
    if (!isNaN(Number(rawVal.replace(/[^0-9]/g, ''))) && rawVal.length > 2) {
      return '₩ ***,***,*** 원';
    }
    return '[보안 처리된 정보입니다]';
  };

  // 기안자 스냅샷 우선 조회 정의
  const drafterName = doc.drafterName || org.userById(doc.drafterId)?.name || doc.drafterId;
  const drafterPos = doc.drafterPos || org.userById(doc.drafterId)?.position || '';
  const drafterSignature = resolveSignatureSnapshot({
    signType: doc.drafterSignType,
    signUrl: doc.drafterSignUrl,
    sealUrl: doc.drafterSealUrl,
  });
  const drafterSeal = () => drafterSignature.url;
  const isDrafterSignature = () => drafterSignature.isSignature;




  const handlePreview = async (e: any, fileUrl: string, originalFileName: string) => {
    e.preventDefault();
    try {
      const lowercaseUrl = fileUrl.toLowerCase();
      const isPdfOrImage = lowercaseUrl.endsWith('.pdf') ||
        lowercaseUrl.endsWith('.png') ||
        lowercaseUrl.endsWith('.jpg') ||
        lowercaseUrl.endsWith('.jpeg') ||
        lowercaseUrl.endsWith('.gif');

      if (isPdfOrImage) {
        // PDF 또는 이미지의 경우 브라우저 렌더링(미리보기)을 위해 Blob fetch 방식을 활용해 우회
        const response = await fetch(fileUrl);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

        const blob = await response.blob();
        let mimeType = blob.type;
        if (lowercaseUrl.endsWith('.pdf')) {
          mimeType = 'application/pdf';
        }

        const previewBlob = new Blob([blob], { type: mimeType });
        const previewUrl = window.URL.createObjectURL(previewBlob);
        window.open(previewUrl, '_blank');
      } else {
        // 엑셀 등 브라우저가 화면에 바로 열지 못하는 파일은 한글명 유지를 위해 다운로드 로직으로 우회연동
        await handleDownload(e, fileUrl, originalFileName);
      }
    } catch (err) {
      console.error('Failed to preview file via Blob fetch:', err);
      // 에러 발생 시 기존 window.open 폴백 처리
      window.open(fileUrl, '_blank');
    }
  };

  const handleDownload = async (e: any, fileUrl: string, originalFileName: string) => {
    e.preventDefault();
    await downloadFile(fileUrl, originalFileName);
  };



  const form = formOverride ?? forms.find((f) => f.code === doc.docType);
  const docTitle = form?.docTitle || form?.name || FALLBACK_TITLE[doc.docType] || doc.docType;
  const closing = (form?.closing !== undefined && form?.closing !== null)
    ? form.closing
    : (FALLBACK_CLOSING[doc.docType] || '위와 같이 상신하오니 재가하여 주시기 바랍니다.');
  const amountField = form ? amountFieldOf(form) : undefined;
  const amountLabel = amountField?.label ?? '금 액';
  const steps = useMemo(() =>
    [...(doc.steps || [])]
      .filter((s) => s.kind !== '참조')
      .sort((a, b) => a.seq - b.seq),
    [doc.steps]
  );

  interface LayoutBlock {
    type: 'table' | 'longtext' | 'table-field';
    section: string;
    fields: FormField[];
  }

  const { blocks, isAmountInDetails, effectiveFieldProps, longTextFields } = useMemo(() => {
    const act = (form?.fields ?? []).filter((f) => {
      if (f.type === '안내문' || f.key.endsWith('__days')) return false;
      if (f.visibleIf) {
        const parts = f.visibleIf.split(':');
        if (parts.length === 2) {
          const [condKey, condVal] = parts;
          if (String(doc.fieldValues[condKey] ?? '') !== condVal) {
            return false;
          }
        }
      }
      return true;
    });

    const isAmtIn = amountField ? act.some((f) => f.key === amountField.key) : false;
    const longTexts = act.filter((f) => f.type === '장문');

    const tabSelectorField = form?.fields.find((f) => f.type === '선택' && f.isTabSelector);
    const currentTabValue = tabSelectorField ? String(doc.fieldValues[tabSelectorField.key] ?? '') : '';
    const getEffectiveProps = (f: FormField) => {
      const isCommon = !f.visibleIf;
      const override: { width?: 'full' | 'half'; section?: string } =
        (isCommon && currentTabValue && f.tabOverrides?.[currentTabValue]) || {};
      return {
        width: (override.width ?? f.width) as 'full' | 'half',
        section: override.section ?? f.section,
      };
    };

    const blks: LayoutBlock[] = [];
    act.forEach((f) => {
      const { section: secName, width: fw } = getEffectiveProps(f);
      if (f.type === '장문') {
        blks.push({
          type: 'longtext',
          section: secName,
          fields: [f],
        });
      } else if (
        f.type === '표' ||
        (() => {
          const val = doc.fieldValues[f.key];
          return typeof val === 'string' && val.trim().startsWith('{') && val.includes('"cols"') && val.includes('"rows"');
        })()
      ) {
        const lastBlock = blks[blks.length - 1];
        if (
          lastBlock &&
          lastBlock.type === 'table-field' &&
          lastBlock.section === secName &&
          getEffectiveProps(lastBlock.fields[0]).width === 'half' &&
          fw === 'half' &&
          lastBlock.fields.length < 2
        ) {
          lastBlock.fields.push(f);
        } else {
          blks.push({
            type: 'table-field',
            section: secName,
            fields: [f],
          });
        }
      } else {
        const lastBlock = blks[blks.length - 1];
        if (lastBlock && lastBlock.type === 'table' && lastBlock.section === secName) {
          lastBlock.fields.push(f);
        } else {
          blks.push({
            type: 'table',
            section: secName,
            fields: [f],
          });
        }
      }
    });

    return {
      activeFields: act,
      blocks: blks,
      isAmountInDetails: isAmtIn,
      effectiveFieldProps: getEffectiveProps,
      longTextFields: longTexts,
    };
  }, [form, doc.fieldValues, amountField]);

  if (!canAccessDocument) {
    return (
      <div className="py-12 px-6 text-center space-y-3 bg-panel-alt/30 rounded-xl border border-dashed border-border-hi">
        <ShieldAlert size={36} className="mx-auto text-danger/80" />
        <div className="text-[14px] font-bold text-ink">열람할 수 없는 보안 문서입니다.</div>
        <div className="text-[12px] text-ink3 max-w-sm mx-auto leading-relaxed">
          본 문서는 <span className="font-semibold text-danger">[{doc.securityLevel ?? '대외비'}]</span> 보안 등급 문서로 지정되어 접근 권한이 제한되어 있습니다.
        </div>
      </div>
    );
  }

  let lastRenderedSection = '';

  const hasSecretFields = form?.fields.some(f => f.isSecret);

  return (
    <>
      {/* 보안 필드 안내 및 마스킹 토글 배너 (화면 전용, 인쇄 시 숨김) */}
      {hasSecretFields && (
        <div className="mx-auto mb-4 p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl max-w-[800px] flex items-center justify-between text-[11.5px] font-bold text-amber-800 print:hidden shadow-2xs">
          <div className="flex items-center gap-2">
            <Lock size={13} className="shrink-0 text-amber-700" />
            <span>
              {canViewSecret
                ? '귀하는 본 보안 문서의 공식 권한자(기안자/결재자)입니다.'
                : '본 문서에는 보안 규정에 의해 블러 처리된 항목이 포함되어 있습니다.'}
            </span>
          </div>
          {canViewSecret ? (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-amber-700">타인에게 보이는 화면 비교:</span>
              <button
                type="button"
                onClick={() => setForceMaskMode(!forceMaskMode)}
                className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${forceMaskMode ? 'bg-amber-600' : 'bg-gray-300'
                  }`}
              >
                <span
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${forceMaskMode ? 'translate-x-4' : 'translate-x-0'
                    }`}
                />
              </button>
              <span className="text-[10px] text-amber-800">{forceMaskMode ? '마스킹 켜짐' : '마스킹 꺼짐'}</span>
            </div>
          ) : (
            <span className="text-[10px] text-amber-600 bg-white px-2 py-0.5 rounded border border-amber-500/20">열람 권한 없음</span>
          )}
        </div>
      )}

      <div className="approval-print mx-auto bg-white px-5 sm:px-8 py-7 text-[#1a1a1a] w-full max-w-[800px] min-w-[620px] shadow-xs box-border">

        <div className="mb-2 flex h-10 items-center justify-between border-b border-[#eee] pb-2">
          <div className="flex items-center gap-2 h-full">
            <img src={processedLogo} alt="WorkFit Logo" className="h-6 w-auto object-contain" />
            <span className="text-[11px] font-semibold tracking-wide text-[#888] self-center">workfit 그룹웨어 · 전자결재</span>
          </div>
          <div className="text-[11px] text-[#888] self-center">{doc.docNo || ''}</div>
        </div>

        {/* 취소 기안 문서 안내 배너 */}
        {doc.cancelTargetDocId && (
          <div className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/5 p-3.5 text-[12px] text-rose-900 print:border-rose-300 print:text-black">
            <div className="flex items-center gap-2 font-bold text-rose-700 mb-1">
              <AlertTriangle size={15} className="shrink-0" />
              <span>[결재 취소 신청 문서]</span>
            </div>
            <div className="text-[11.5px] leading-relaxed text-[#444]">
              ※ 본 문서는 기결재 완료된 원문서(문서번호: <strong className="font-semibold text-rose-700">{doc.cancelTargetDocId}</strong>)의 결재 취소를 요청하는 취소 기안입니다.
              최종 결재 승인 시 원문서의 효력 및 연동(휴가 차감 일수 환원, 캘린더 일정 삭제, 메신저 상태 등)이 자동으로 취소 처리됩니다.
            </div>
          </div>
        )}

        {/* 취소 완료된 원문서 안내 배너 */}
        {doc.status === '취소완료' && (
          <div className="mb-4 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3.5 text-[12px] text-rose-900 print:border-rose-300 print:text-black">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-bold text-rose-700">
                <AlertTriangle size={15} className="shrink-0" />
                <span>[취소 완료된 결재 문서]</span>
              </div>
              <span className="text-[11px] font-semibold text-rose-600">
                취소 승인 일시: {korDate(doc.cancelledAt)}
              </span>
            </div>
            <div className="text-[11.5px] leading-relaxed text-[#444] mt-1">
              본 문서는 취소 결재({doc.cancelledByDocId ? `문서번호: ${doc.cancelledByDocId}` : '취소 승인'})를 통해 공식적으로 취소 처리 완료되었습니다.
              연동된 일정 및 휴가 차감 내역은 자동으로 환원/삭제되었습니다.
            </div>
          </div>
        )}

        {/* 회수된 문서 안내 배너 */}
        {doc.status === '회수' && (
          <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3.5 text-[12px] text-amber-900 print:border-amber-300 print:text-black">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-bold text-amber-700">
                <RotateCcw size={15} className="shrink-0" />
                <span>[회수된 결재 문서]</span>
              </div>
              {doc.recalledAt && (
                <span className="text-[11px] font-semibold text-amber-600">
                  회수 일시: {korDate(doc.recalledAt)}
                </span>
              )}
            </div>
            <div className="text-[11.5px] leading-relaxed text-[#444] mt-1">
              본 문서는 기안자에 의해 회수되었습니다. 내용 수정 후 [편집] 및 [재상신]이 가능합니다.
              {doc.recallReason && (
                <div className="mt-1 font-semibold text-amber-800">
                  • 회수 사유: {doc.recallReason}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="relative mb-5 flex items-start justify-between gap-4">
          <h1 className="mt-6 flex-1 text-center text-[26px] font-extrabold tracking-[0.15em] text-[#111]">{docTitle}</h1>
          {(doc.status === '완료' || doc.status === '시행대기' || doc.status === '취소완료') && (
            <div className="relative">
              <ApprovalStampTable steps={steps} nameOf={nameOf} posOf={posOf} isPostApproval={doc.isPostApproval} />
              {doc.status === '취소완료' && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="border-4 border-dashed border-red-600/80 text-red-600/90 font-black text-[20px] tracking-[0.2em] px-4 py-1 rounded-xl rotate-[-12deg] bg-white/80 backdrop-blur-2xs shadow-sm">
                    취소완료
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 긴급 선조치 사후 승인 (후결) 정보 카드 */}
        {doc.isPostApproval && (
          <div className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/5 p-4 text-[12px] print-avoid-break">
            <div className="flex items-center justify-between border-b border-rose-500/20 pb-2 mb-2.5">
              <span className="font-extrabold text-rose-700 dark:text-rose-400 flex items-center gap-1.5 text-[12.5px]">
                <AlertTriangle size={14} className="shrink-0 text-rose-700" />
                <span>긴급 선조치 내용 (후결 사후 승인 문서)</span>
              </span>
              <span className={`px-2 py-0.5 rounded text-[10.5px] font-extrabold ${doc.status === '긴급 조치 사후 검토 반려'
                  ? 'bg-rose-600 text-white'
                  : 'bg-rose-500/15 text-rose-700'
                }`}>
                {doc.status === '긴급 조치 사후 검토 반려' ? '사후 검토 반려됨 (감사 영구 보존)' : '사후 감사 대상'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2.5 text-[11.5px] mb-2.5">
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-[#555] shrink-0">선조치 일시:</span>
                <span className="font-semibold text-rose-700">{doc.postApprovedAt ? korDate(doc.postApprovedAt) + ' ' + new Date(doc.postApprovedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-[#555] shrink-0">구두/임시 승인자:</span>
                <span className="font-semibold text-ink">{doc.postApprovedByName ?? '—'}</span>
              </div>
            </div>

            <div className="flex flex-col gap-2 border-t border-rose-500/15 pt-2 text.11.5px]">
              {doc.postApprovalActionTaken && (
                <div className="flex flex-col gap-0.5">
                  <span className="font-bold text-rose-800 text-[11px]">1. 선조치(긴급 조치) 내용 및 결과:</span>
                  <div className="whitespace-pre-wrap rounded bg-white p-2 border border-rose-500/20 text-[11.5px] leading-relaxed text-[#222]">
                    {doc.postApprovalActionTaken}
                  </div>
                </div>
              )}
              {doc.postApprovalNecessity && (
                <div className="flex flex-col gap-0.5">
                  <span className="font-bold text-rose-800 text-[11px]">2. 긴급성 및 불가피성 소명 (Why?):</span>
                  <div className="whitespace-pre-wrap rounded bg-white p-2 border border-rose-500/20 text-[11.5px] leading-relaxed text-[#222]">
                    {doc.postApprovalNecessity}
                  </div>
                </div>
              )}
              {(doc.postApprovalCostDetails || doc.postApprovalFollowup) && (
                <div className="grid grid-cols-2 gap-2">
                  {doc.postApprovalCostDetails && (
                    <div className="flex flex-col gap-0.5">
                      <span className="font-bold text-[#555] text-[11px]">3. 소요 비용 및 집행 내역:</span>
                      <div className="whitespace-pre-wrap rounded bg-white p-2 border border-rose-500/20 text-[11.5px] leading-relaxed text-[#222]">
                        {doc.postApprovalCostDetails}
                      </div>
                    </div>
                  )}
                  {doc.postApprovalFollowup && (
                    <div className="flex flex-col gap-0.5">
                      <span className="font-bold text-[#555] text-[11px]">4. 후속 조치 및 재발 방지 대책:</span>
                      <div className="whitespace-pre-wrap rounded bg-white p-2 border border-rose-500/20 text-[11.5px] leading-relaxed text-[#222]">
                        {doc.postApprovalFollowup}
                      </div>
                    </div>
                  )}
                </div>
              )}
              {!doc.postApprovalActionTaken && !doc.postApprovalNecessity && doc.postApprovalReason && (
                <div className="flex flex-col gap-0.5">
                  <span className="font-bold text-[#555] text-[11px]">긴급 사유 및 소명 내역:</span>
                  <div className="whitespace-pre-wrap rounded bg-white p-2.5 border border-rose-500/20 text-[11.5px] leading-relaxed text-[#222]">
                    {doc.postApprovalReason}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        <ApprovalDocMetaTable
          doc={doc}
          form={form}
          drafterName={drafterName}
          drafterPos={drafterPos}
          isAmountInDetails={isAmountInDetails}
          amountLabel={amountLabel}
        />

        {/* 서식 동적 상세 블록 렌더링 (순서 보존 및 섹션별 테이블/독립 장문박스 배치) */}
        {blocks.length > 0 && (
          <div className="space-y-3.5 mt-2">
            {blocks.map((block, blockIdx) => {
              const showSectionHeader = block.section && block.section !== lastRenderedSection;
              if (block.section) {
                lastRenderedSection = block.section;
              }

              if (block.type === 'longtext') {
                const f = block.fields[0];
                const rawVal = fieldText(f, doc.fieldValues, org);
                const val = maskValue(rawVal, f.isSecret);
                const isBlurred = f.isSecret && isMaskingActive;
                return (
                  <div key={blockIdx} className="space-y-1">
                    {showSectionHeader && (
                      <div className="text-[11px] font-bold text-teal mt-2.5">
                        {block.section}
                      </div>
                    )}
                    <div className="text-[11px] font-semibold text-ink2 mb-0.5 flex items-center gap-1">
                      {f.label}
                      {isBlurred && (
                        <span className="inline-flex items-center gap-0.5 text-[9px] font-bold text-amber-600 bg-amber-500/10 px-1 py-0.5 rounded">
                          <Lock size={9} />
                          <span>보안</span>
                        </span>
                      )}
                    </div>
                    <div
                      title={isBlurred ? "보안 필드입니다. 열람 권한이 없습니다." : undefined}
                      className={`min-h-[120px] whitespace-pre-wrap border border-[#bbb] px-4 py-3 text-[12.5px] leading-[1.9] text-[#222] ${isBlurred ? 'blur-sm select-none opacity-70 cursor-help' : ''}`.trim()}
                    >
                      {val || ' '}
                    </div>
                  </div>

                );
              }

              if (block.type === 'table-field') {
                const isHalf = effectiveFieldProps(block.fields[0]).width === 'half';

                const renderTableOnly = (f: FormField) => {
                  const val = doc.fieldValues[f.key];
                  const defaultCols = ['구분', '항목', '내용'];
                  const defaultRows: Array<Record<string, string>> = [
                    { '구분': '', '항목': '', '내용': '' },
                    { '구분': '', '항목': '', '내용': '' },
                    { '구분': '', '항목': '', '내용': '' }
                  ];
                  let cols: string[] = [...defaultCols];
                  let rows: Array<Record<string, string>> = [...defaultRows];
                  let colWidths: Record<string, string> = {};
                  let merges: CellMerge[] = [];
                  let headerValues: Record<string, string> = {};
                  let secretCols: string[] = [];
                  let secretCells: string[] = [];
                  let secretRows: number[] = [];

                  if (f.placeholder) {
                    try {
                      const cfg = JSON.parse(f.placeholder);
                      if (cfg && typeof cfg === 'object') {
                        if (cfg.colWidths) colWidths = cfg.colWidths;
                        if (cfg.cols) cols = cfg.cols;
                        if (Array.isArray(cfg.rows)) rows = cfg.rows;
                        else if (Array.isArray(cfg.defaultRows)) rows = cfg.defaultRows;
                        if (Array.isArray(cfg.merges)) merges = cfg.merges;
                        if (cfg.headerValues) headerValues = cfg.headerValues;
                        if (Array.isArray(cfg.secretCols)) secretCols = cfg.secretCols;
                        if (Array.isArray(cfg.secretCells)) secretCells = cfg.secretCells;
                        if (Array.isArray(cfg.secretRows)) secretRows = cfg.secretRows;
                      }
                    } catch (e) { }
                  }

                  try {
                    if (typeof val === 'string' && val) {
                      const parsed = JSON.parse(val);
                      if (parsed && typeof parsed === 'object') {
                        if (Array.isArray(parsed.cols) && Array.isArray(parsed.rows)) {
                          cols = parsed.cols;
                          rows = parsed.rows;
                          colWidths = (parsed.colWidths && Object.keys(parsed.colWidths).length > 0) ? parsed.colWidths : colWidths;
                          if (Array.isArray(parsed.merges)) merges = parsed.merges;
                          if (parsed.headerValues) headerValues = parsed.headerValues;
                          if (Array.isArray(parsed.secretCols)) secretCols = parsed.secretCols;
                          if (Array.isArray(parsed.secretCells)) secretCells = parsed.secretCells;
                          if (Array.isArray(parsed.secretRows)) secretRows = parsed.secretRows;
                        }
                      }
                    }
                  } catch (e) { }

                  return (
                    <table className="table-fixed border-collapse text-left text-[11.5px] border-none" style={{ width: '100%', minWidth: isHalf ? 'auto' : '500px' }}>
                      <colgroup>
                        {cols.map((col, cIdx) => (
                          <col key={cIdx} style={{ width: colWidths[col] || 'auto' }} />
                        ))}
                      </colgroup>
                      <tbody>
                        {/* 헤더 행 — tbody 첫 번째 tr (rowSpan이 데이터 행까지 정상 확장됨) */}
                        <tr className="border-b border-[#bbb] bg-[#f9f9f9]">
                          {cols.map((col, cIdx) => {
                            const { isMerged, isStart, rowSpan, colSpan } = getCellMergeInfo(-1, cIdx, merges);
                            if (isMerged && !isStart) return null;
                            return (
                              <th
                                key={col}
                                rowSpan={rowSpan > 1 ? rowSpan : undefined}
                                colSpan={colSpan > 1 ? colSpan : undefined}
                                className="p-2 border border-[#eee] font-bold text-[#555]"
                              >
                                {headerValues[col] !== undefined ? headerValues[col] : col}
                              </th>
                            );
                          })}
                        </tr>
                        {rows.map((row, rIdx) => (
                          <tr key={rIdx} className="border-b border-[#eee] hover:bg-[#fafafa]">
                            {cols.map((col, cIdx) => {
                              const isCellSecret =
                                f.isSecret ||
                                secretCols.includes(col) ||
                                secretRows.includes(rIdx) ||
                                secretCells.includes(`${rIdx}:${cIdx}`);

                              const cellVal = row[col] ?? '';
                              const isPercent = typeof cellVal === 'string' && cellVal.endsWith('%');
                              const isNumLike = col.includes('수량') || col.includes('단가') || col.includes('가격') || col.includes('금액') || col.includes('수') || col.includes('율') || col.includes('비중') || isPercent;
                              let displayVal = isNumLike && !isPercent && !isNaN(Number(cellVal.replace(/,/g, ''))) && cellVal !== ''
                                ? Number(cellVal.replace(/,/g, '')).toLocaleString()
                                : cellVal;

                              if (isCellSecret && isMaskingActive) {
                                displayVal = maskValue(displayVal, true);
                              }

                              const { isMerged, isStart, rowSpan, colSpan } = getCellMergeInfo(rIdx, cIdx, merges);

                              if (isMerged && !isStart) return null;

                              const isCellBlurred = isCellSecret && isMaskingActive;

                              return (
                                <td
                                  key={col}
                                  rowSpan={rowSpan > 1 ? rowSpan : undefined}
                                  colSpan={colSpan > 1 ? colSpan : undefined}
                                  title={isCellBlurred ? "보안 필드입니다. 열람 권한이 없습니다." : undefined}
                                  className={`p-2 border border-[#eee] text-[#222] whitespace-pre-wrap break-words leading-relaxed ${isNumLike ? 'text-right' : 'text-left'} ${isCellBlurred ? 'blur-sm select-none opacity-70 cursor-help' : ''
                                    }`}
                                >

                                  {displayVal || '—'}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                        {rows.length === 0 && (
                          <tr>
                            <td colSpan={cols.length} className="py-4 text-center text-[#999] text-[11px]">
                              등록된 데이터가 없습니다.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  );
                };

                return (
                  <div key={blockIdx} className={`space-y-1 ${isHalf ? 'print-avoid-break' : ''}`}>
                    {showSectionHeader && (
                      <div className="text-[11px] font-bold text-teal mt-2.5">
                        {block.section}
                      </div>
                    )}
                    {isHalf ? (
                      <div className="border border-[#bbb] bg-white rounded-lg overflow-hidden grid grid-cols-2 gap-0 divide-x divide-[#bbb] print-avoid-break">
                        {block.fields.map((f) => {
                          const hasLabel = !!(f.label && f.label.trim());
                          return (
                            <div key={f.key} className="flex flex-col">
                              {hasLabel && (
                                <div className="text-[11px] font-bold text-black bg-[#f5f5f5] py-1.5 px-3 border-b border-[#bbb] text-center">
                                  {f.label}
                                </div>
                              )}
                              <div className="overflow-x-auto">
                                {renderTableOnly(f)}
                              </div>
                            </div>
                          );
                        })}
                        {block.fields.length === 1 && <div />}
                      </div>
                    ) : (
                      <div className="border border-[#bbb] bg-white rounded-lg overflow-hidden">
                        {(() => {
                          const hasLabel = !!(block.fields[0].label && block.fields[0].label.trim());
                          return (
                            <>
                              {hasLabel && (
                                <div className="text-[11px] font-bold text-black bg-[#f5f5f5] py-1.5 px-3 border-b border-[#bbb]">
                                  {block.fields[0].label}
                                </div>
                              )}
                            </>
                          );
                        })()}
                        <div className="overflow-x-auto">
                          {renderTableOnly(block.fields[0])}
                        </div>
                      </div>
                    )}
                  </div>
                );
              }

              // table 타입 블록 렌더링
              const tableRows: React.ReactNode[] = [];
              const fields = block.fields;

              for (let i = 0; i < fields.length; i++) {
                const f = fields[i];
                const rawVal = fieldText(f, doc.fieldValues, org);
                const val = maskValue(rawVal, f.isSecret);
                const { width: fw } = effectiveFieldProps(f);

                if (fw === 'half') {
                  const next = fields[i + 1];
                  const { width: nw } = next ? effectiveFieldProps(next) : { width: 'full' as const };
                  if (next && nw === 'half') {
                    const rawNextVal = fieldText(next, doc.fieldValues, org);
                    const nextVal = maskValue(rawNextVal, next.isSecret);
                    tableRows.push(
                      <MetaRow
                        key={f.key}
                        cells={[
                          [f.label, val, f.isSecret && isMaskingActive],
                          [next.label, nextVal, next.isSecret && isMaskingActive]
                        ]}
                      />
                    );
                    i++;
                  } else {
                    tableRows.push(
                      <MetaRow
                        key={f.key}
                        cells={[[f.label, val, f.isSecret && isMaskingActive], ['', '']]}
                      />
                    );
                  }
                } else {
                  tableRows.push(
                    <MetaRow
                      key={f.key}
                      cells={[[f.label, val, f.isSecret && isMaskingActive]]}
                      full
                    />
                  );
                }

              }

              return (
                <div key={blockIdx} className="space-y-1">
                  {showSectionHeader && (
                    <div className="text-[11px] font-bold text-teal mt-2.5">
                      {block.section}
                    </div>
                  )}
                  <table className="w-full border-collapse text-[12px]">
                    <tbody>{tableRows}</tbody>
                  </table>
                </div>
              );
            })}
          </div>
        )}

        {/* 본문 (양식에 정의된 장문 필드가 하나도 없고, 본문 내용이 채워져 있는 경우에만 노출) */}
        {longTextFields.length === 0 && doc.body && doc.body.trim() !== '' && doc.body !== '(본문 미리보기)' && (
          <div className="mt-3 min-h-[120px] whitespace-pre-wrap border border-[#bbb] px-4 py-3 text-[12.5px] leading-[1.9] text-[#222]">
            {doc.body}
          </div>
        )}

        {/* 첨부파일 영역 */}
        {doc.attachments && doc.attachments.length > 0 && (
          <table className="mt-4 w-full border-collapse text-[12px]">
            <tbody>
              <tr>
                <th className="w-[80px] border border-[#bbb] bg-[#f2f2f2] px-2 py-1.5 text-left align-middle text-[11px] font-bold text-[#444]">
                  첨부파일
                </th>
                <td className="border border-[#bbb] px-2.5 py-1.5 text-left align-middle text-[#222]">
                  <div className="space-y-1">
                    {doc.attachments.map((file, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <a
                          onClick={(e) => handlePreview(e, file.url, file.name)}
                          className="font-semibold hover:underline text-[#222] cursor-pointer"
                        >
                          {file.name}
                        </a>
                        <button
                          onClick={(e) => handleDownload(e, file.url, file.name)}
                          className="text-[10px] text-[#666] hover:text-teal underline cursor-pointer print:hidden bg-transparent border-none p-0 inline"
                        >
                          (다운로드)
                        </button>
                      </div>
                    ))}
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        )}

        {/* 수신처 영역 */}
        {(() => {
          const effectiveRecipients = getEffectiveRecipients(doc);
          if (effectiveRecipients.length === 0) return null;
          return (
            <table className="mt-2 w-full border-collapse text-[12px]">
              <tbody>
                <tr>
                  <th className="w-[80px] border border-[#bbb] bg-[#f2f2f2] px-2 py-1.5 text-left align-middle text-[11px] font-bold text-[#444]">
                    수 신 처
                  </th>
                  <td className="border border-[#bbb] px-2.5 py-1.5 text-left align-middle text-[#222]">
                    <div className="flex flex-wrap gap-x-2 gap-y-1">
                      {effectiveRecipients.map((r, idx) => {
                        let displayName = r.name;
                        if (r.type === 'user') {
                          const u = org.users.find((x) => x.id === r.id);
                          if (u && u.position) {
                            if (r.name.includes(' · ')) {
                              const parts = r.name.split(' · ');
                              const namePart = parts[0];
                              const deptPart = parts.slice(1).join(' · ');
                              displayName = `${namePart} ${u.position} · ${deptPart}`;
                            } else {
                              displayName = `${r.name} ${u.position}`;
                            }
                          }
                        }
                        return (
                          <span key={r.id} className="font-semibold">
                            {displayName}{idx < effectiveRecipients.length - 1 ? ',' : ''}
                          </span>
                        );
                      })}
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          );
        })()}



        {/* 관련 문서 연동 영역 */}
        {accessibleRelatedDocs && accessibleRelatedDocs.length > 0 && (
          <table className="mt-2 w-full border-collapse text-[12px]">
            <tbody>
              <tr>
                <th className="w-[80px] border border-[#bbb] bg-[#f2f2f2] px-2 py-1.5 text-left align-middle text-[11px] font-bold text-[#444]">
                  관련 문서
                </th>
                <td className="border border-[#bbb] px-2.5 py-1.5 text-left align-middle text-[#222]">
                  <div className="space-y-1">
                    {accessibleRelatedDocs.map((rd) => (
                      <div key={rd.docId} className="flex items-center gap-2">
                        <span className="font-mono text-[11px] font-semibold text-[#008080]">[{rd.docNo}]</span>
                        <button
                          type="button"
                          onClick={() => !isPreview && setActiveRelatedDocId(rd.docId)}
                          className={`font-semibold text-ink2 text-left transition-colors ${isPreview
                              ? 'cursor-default'
                              : 'cursor-pointer text-[#008080] hover:underline hover:text-[#4ea8de]'
                            }`}
                        >
                          {rd.title}
                        </button>
                        <span className="text-[11px] text-[#666]">({rd.docType} | {rd.drafterName})</span>
                      </div>
                    ))}
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        )}

        <div className="mt-8 text-center text-[12.5px] leading-loose text-[#222]">
          {closing.trim() && <div>{closing}</div>}
          <div className="mt-4 font-semibold tracking-wide">{korDate(doc.submittedAt ?? doc.createdAt)}</div>
          <div className="mt-1 flex items-center justify-center gap-1">
            기안자 <span className="mx-1 text-[14px] font-bold tracking-[0.2em]">{drafterName}</span>
            {isDrafterSignature() ? (
              // 서명 모드
              drafterSeal() ? (
                // (1) 서명 이미지가 있는 경우: 붉은 원형 테두리 없이 글씨 "(인)"만 배치하여 그 위에 서명 이미지를 정중앙 오버레이
                <span className="relative inline-flex h-9 w-9 items-center justify-center select-none bg-white">
                  <span className="text-[12.5px] font-bold text-[#c0392b] z-30 select-none">(인)</span>
                  <img
                    src={drafterSeal()}
                    alt="서명"
                    className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-full w-[80px] max-w-none object-contain opacity-90 z-20 pointer-events-none mix-blend-multiply scale-125"
                  />
                </span>
              ) : (
                // (2) 서명 이미지가 없는 경우 (폴백): 붉은 원 없이 '서명미등록' 가이드 표시
                <span className="relative inline-flex h-9 w-[60px] items-center justify-center rounded border border-dashed border-danger/40 text-[10px] font-bold text-danger/80 select-none">
                  서명미등록
                </span>
              )
            ) : (
              // 도장 모드
              drafterSeal() ? (
                // (3) 도장 이미지가 있는 경우: (인) 표기 위에 등록 도장만 표시
                <span className="relative inline-flex h-[44px] w-[44px] items-center justify-center select-none bg-white">
                  <span className="text-[12.5px] font-bold text-[#c0392b]/35 z-10 select-none">(인)</span>
                  <img
                    src={drafterSeal()}
                    alt="인감"
                    className="absolute inset-0 h-full w-full object-contain z-20 pointer-events-none"
                  />
                </span>
              ) : (
                // (4) 도장 이미지가 없는 경우 (폴백): 붉은 원형 링 + 희미한 (인) 글씨 위에 이름을 비스듬히 겹쳐 출력
                <span className="relative inline-flex h-9 w-9 items-center justify-center rounded-full border border-[#c0392b] select-none bg-white">
                  <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-[11px] font-bold text-[#c0392b]/35 z-10 select-none">(인)</span>
                  <span className="absolute inset-0 flex items-center justify-center text-[8px] font-bold text-danger/80 z-20 pointer-events-none rotate-[-15deg] select-none scale-105 bg-transparent">
                    {drafterName}
                  </span>
                </span>
              )
            )}
          </div>
        </div>
        {activeRelatedDocId && (
          <RelatedDocDetailModal docId={activeRelatedDocId} onClose={() => setActiveRelatedDocId(null)} />
        )}
      </div>
    </>
  );
}



