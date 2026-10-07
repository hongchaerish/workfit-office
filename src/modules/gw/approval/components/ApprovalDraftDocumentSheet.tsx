import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { User } from '@/domain/user/schema';
import type { ApprovalStep, ApprovalRecipient, RelatedDoc } from '@/domain/approvalDoc/schema';
import { amountFieldOf, type ApprovalForm, type FormField, type FieldValue } from '@/domain/approvalForm/schema';
import { ApprovalStampTable } from './ApprovalStampTable';
import { AutoResizeTextarea } from '../formFields/AutoResizeTextarea';
import { CalendarRangePicker } from '../formFields/CalendarRangePicker';
import { TableFieldEditor } from '../formFields/TableFieldEditor';
import { SelectFieldEditor } from '../formFields/SelectFieldEditor';
import { cascadeRecalculateAllTables } from '../formFields/formulaEngine';
import { SelectorDialog } from './DraftRecipientSection';
import {
  calculateLeaveDays,
  isAnnualLeaveDeduction,
  isPartDayLeave,
  getExcludedHolidaysInRange,
} from '@/domain/leave/policy';
import { useOrgTree } from '@/features/gw/useOrgTree';
import { useUsers } from '@/features/user/useUsers';
import logoImg from '@/assets/logo.png';
import {
  FileText,
  Paperclip,
  Upload,
  X,
  AlertTriangle,
  Building2,
  Calendar,
} from 'lucide-react';
import { won } from '../utils/approvalUtils';

let cachedLogoDataUrl: string | null = null;

const FALLBACK_TITLE: Record<string, string> = {
  기안: '기 안 서',
  품의: '품 의 서',
  지출결의: '지 출 결 의 서',
  휴가: '휴 가 원',
};

const FALLBACK_CLOSING: Record<string, string> = {
  기안: '위와 같이 기안하오니 재가하여 주시기 바랍니다.',
  품의: '위와 같이 품의하오니 재가하여 주시기 바랍니다.',
  지출결의: '위와 같이 지출을 청구하오니 재가하여 주시기 바랍니다.',
  휴가: '위와 같이 휴가를 신청하오니 재가하여 주시기 바랍니다.',
};

function korToday(): string {
  const d = new Date();
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}

interface LayoutBlock {
  type: 'table' | 'longtext' | 'table-field';
  section: string;
  fields: FormField[];
}

export interface ApprovalDraftDocumentSheetProps {
  form?: ApprovalForm;
  docCode: string;
  me: User;
  title: string;
  setTitle: (v: string) => void;
  values: Record<string, FieldValue>;
  setVals: (patch: Record<string, FieldValue>) => void;
  amount: string;
  setAmount: (v: string) => void;
  securityLevel: '일반' | '대외비' | '극비';
  setSecurityLevel: (v: '일반' | '대외비' | '극비') => void;
  visibility: '부서' | '비공개';
  setVisibility: (v: '부서' | '비공개') => void;
  preservationPeriod: string;
  setPreservationPeriod: (v: string) => void;
  isPostApproval: boolean;
  setIsPostApproval: (v: boolean) => void;
  isPostApprovalSystemEnabled: boolean;
  postApprovedAt?: string;
  setPostApprovedAt?: (v: string) => void;
  postApprovedBy: string;
  setPostApprovedBy: (v: string) => void;
  postApprovalActionTaken: string;
  setPostApprovalActionTaken: (v: string) => void;
  postApprovalNecessity: string;
  setPostApprovalNecessity: (v: string) => void;
  steps: ApprovalStep[];
  recipients: ApprovalRecipient[];
  attachments: Array<{ name: string; url: string; size?: number }>;
  setAttachments: React.Dispatch<React.SetStateAction<Array<{ name: string; url: string; size?: number }>>>;
  attachmentRetention: string;
  setAttachmentRetention: (v: string) => void;
  relatedDocs: RelatedDoc[];
  setRelatedDocs: React.Dispatch<React.SetStateAction<RelatedDoc[]>>;
  setShowRelatedModal: (v: boolean) => void;
  onFileUpload: (files: File[]) => Promise<void>;
  uploading: boolean;
  leaveBalance?: any;
  holidays?: Array<{ date: string; name?: string }> | Map<string, string>;
  editDocNo?: string;
  lastSavedAt?: number | null;
  isDesignMode?: boolean;
  selectedFieldKey?: string | null;
  onSelectFieldKey?: (key: string) => void;
  onUpdateDocTitle?: (v: string) => void;
  onUpdateClosing?: (v: string) => void;
  onStampTableClick?: () => void;
}

export function ApprovalDraftDocumentSheet({
  form,
  docCode,
  me,
  title,
  setTitle,
  values,
  setVals,
  amount,
  setAmount,
  visibility,
  setVisibility,
  preservationPeriod,
  setPreservationPeriod,
  isPostApproval,
  setIsPostApproval,
  isPostApprovalSystemEnabled,
  postApprovedAt,
  setPostApprovedAt,
  postApprovedBy,
  setPostApprovedBy,
  postApprovalActionTaken,
  setPostApprovalActionTaken,
  postApprovalNecessity,
  setPostApprovalNecessity,
  steps,
  recipients,
  attachments,
  setAttachments,
  attachmentRetention,
  relatedDocs,
  setRelatedDocs,
  setShowRelatedModal,
  onFileUpload,
  uploading,
  leaveBalance,
  holidays,
  editDocNo,
  lastSavedAt,
  isDesignMode = false,
  selectedFieldKey,
  onSelectFieldKey,
  onUpdateDocTitle,
  onUpdateClosing,
  onStampTableClick,
}: ApprovalDraftDocumentSheetProps) {
  const org = useOrgTree();
  const { data: users = [] } = useUsers();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragActive, setIsDragActive] = useState(false);

  // 로고 처리 (ApprovalDocumentView와 동일)
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
  const sealOf = (id: string) => {
    const u = org.userById(id) || users.find((x) => x.id === id);
    if (!u) return '';
    return u.signType === 'signature' ? (u.signUrl ?? '') : (u.sealUrl ?? '');
  };
  const isSignatureOf = (id: string) => {
    const u = org.userById(id) || users.find((x) => x.id === id);
    return u?.signType === 'signature';
  };

  // 타이틀 및 맺음말
  const docTitle = form?.docTitle || form?.name || FALLBACK_TITLE[docCode] || docCode;
  const closing =
    form?.closing !== undefined && form?.closing !== null
      ? form.closing
      : FALLBACK_CLOSING[docCode] || '위와 같이 상신하오니 재가하여 주시기 바랍니다.';

  const amountField = form ? amountFieldOf(form) : undefined;
  const amountLabel = amountField?.label ?? '금 액';

  // 정렬된 결재 단계 (직인용)
  const stampSteps = useMemo(() => {
    return [...steps]
      .filter((s) => s.kind !== '참조')
      .sort((a, b) => a.seq - b.seq);
  }, [steps]);

  // 서식 레이아웃 블록 계산 (ApprovalDocumentView와 100% 동일 로직)
  const { blocks, isAmountInDetails, effectiveFieldProps, longTextFields } = useMemo(() => {
    const act = (form?.fields ?? []).filter((f) => {
      if (f.type === '안내문' || f.key.endsWith('__days')) return false;
      if (f.visibleIf) {
        const parts = f.visibleIf.split(':');
        if (parts.length === 2) {
          const [condKey, condVal] = parts;
          if (String(values[condKey] ?? '') !== condVal) {
            return false;
          }
        }
      }
      return true;
    });

    const isAmtIn = amountField ? act.some((f) => f.key === amountField.key) : false;
    const longTexts = act.filter((f) => f.type === '장문');

    const tabSelectorField = form?.fields.find((f) => f.type === '선택' && f.isTabSelector);
    const currentTabValue = tabSelectorField ? String(values[tabSelectorField.key] ?? '') : '';
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
          const val = values[f.key];
          return (
            typeof val === 'string' &&
            val.trim().startsWith('{') &&
            val.includes('"cols"') &&
            val.includes('"rows"')
          );
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
  }, [form, values, amountField]);

  // 파일 드래그앤드롭 핸들러
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setIsDragActive(true);
    } else if (e.type === 'dragleave') {
      setIsDragActive(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await onFileUpload(Array.from(e.dataTransfer.files));
    }
  };

  // 사용자 선택 모달 상태 (인라인 사용자 필드용)
  const [activeUserField, setActiveUserField] = useState<FormField | null>(null);

  // 휴가 구분 관련
  const selectedLeaveType = String(values['leaveType'] || '연차');
  const periodStart = String(values['period'] || '');
  const periodEnd = String(values['period__end'] || periodStart);

  // 선택된 기간 내 평일 공휴일 자동 제외 목록 (UI 안내용)
  const excludedHolidays = useMemo(() => {
    if (docCode !== '휴가' || !periodStart || !holidays) return [];
    const isPart = isPartDayLeave(selectedLeaveType);
    const end = isPart ? periodStart : periodEnd;
    return getExcludedHolidaysInRange(periodStart, end, holidays);
  }, [docCode, periodStart, periodEnd, holidays, selectedLeaveType]);

  let lastRenderedSection = '';

  return (
    <div className="mx-auto bg-white px-5 sm:px-8 py-7 text-[#1a1a1a] w-full max-w-[800px] min-w-0 shadow-2xl border border-black/15 rounded-xs box-border transition-all ring-1 ring-black/5">
      {/* 1. 상단 워크핏 로고 및 문서번호 바 */}
      <div className="mb-2 flex h-10 items-center justify-between border-b border-[#eee] pb-2">
        <div className="flex items-center gap-2 h-full">
          <img src={processedLogo} alt="WorkFit Logo" className="h-6 w-auto object-contain" />
          <span className="text-[11px] font-semibold tracking-wide text-[#888] self-center">
            workfit 그룹웨어 · 전자결재
          </span>
        </div>
        <div className="text-[11px] font-medium text-[#888] flex items-center gap-2 self-center">
          {editDocNo ? (
            <span className="font-mono text-teal">{editDocNo}</span>
          ) : (
            <span className="rounded bg-[#f0f0f0] px-2 py-0.5 text-[10px] text-[#666]">
              [기안 상신 시 자동 채번]
            </span>
          )}
          {lastSavedAt && (
            <span className="text-[10px] text-[#aaa]">
              (자동보관: {new Date(lastSavedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})
            </span>
          )}
        </div>
      </div>

      {/* 2. 대형 문서 타이틀 & 우측 상단 실시간 결재 직인란 */}
      <div className="relative mb-5 flex items-start justify-between gap-4">
        <h1
          onClick={() => {
            if (isDesignMode && onUpdateDocTitle) {
              const next = prompt('격식 문서명(인쇄 타이틀)을 입력하세요:', docTitle);
              if (next !== null && next.trim()) onUpdateDocTitle(next.trim());
            }
          }}
          className={`mt-6 flex-1 text-center text-[26px] font-extrabold tracking-[0.15em] text-[#111] ${isDesignMode ? 'hover:bg-teal-soft/40 hover:text-teal rounded cursor-pointer transition-colors p-1' : ''
            }`}
          title={isDesignMode ? '클릭하여 격식 문서명(인쇄) 수정' : undefined}
        >
          {docTitle}
          {isDesignMode && (
            <span className="block text-[10px] tracking-normal font-normal text-teal opacity-70 mt-0.5">
              (클릭하여 격식 문서명 수정)
            </span>
          )}
        </h1>
        {/* 실시간 연동 결재 직인 테이블 (디자인 모드 시 클릭하여 결재선 규칙 모달 호출) */}
        <div
          onClick={isDesignMode ? onStampTableClick : undefined}
          className={`relative group ${isDesignMode
            ? 'cursor-pointer ring-2 ring-transparent hover:ring-teal hover:bg-teal-soft/20 transition-all rounded p-1'
            : ''
            }`}
          title={isDesignMode ? '클릭하여 결재선(전결) 규칙 설정' : undefined}
        >
          {isDesignMode && (
            <div className="absolute -top-3 right-0 -translate-y-full opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap bg-panel text-teal font-bold text-[10.5px] px-2 py-0.5 rounded shadow-md border border-teal/40 pointer-events-none z-20 flex items-center gap-1">
              <span>⚙️ 클릭하여 결재선 규칙 설정</span>
            </div>
          )}
          <ApprovalStampTable
            steps={stampSteps}
            nameOf={nameOf}
            posOf={posOf}
            sealOf={sealOf}
            isSignatureOf={isSignatureOf}
            allowCurrentSignature
            isPostApproval={isPostApproval}
          />
        </div>
      </div>

      {/* 3. 긴급 후결(선조치 사후승인) 안내 및 입력 인포 박스 */}
      {isPostApproval && (
        <div className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/5 p-4 text-[12px]">
          <div className="flex items-center justify-between border-b border-rose-500/20 pb-2 mb-2.5">
            <span className="font-extrabold text-rose-700 flex items-center gap-1.5 text-[12.5px]">
              <AlertTriangle size={14} className="shrink-0 text-rose-700" />
              <span>긴급 선조치 내용 (후결 사후 승인 문서)</span>
            </span>
            <span className="px-2 py-0.5 rounded text-[10.5px] font-extrabold bg-rose-500/15 text-rose-700">
              사후 감사 대상
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2.5 text-[11.5px] mb-2.5">
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-[#555] shrink-0">선조치 일시:</span>
              {setPostApprovedAt ? (
                <input
                  type="datetime-local"
                  value={postApprovedAt || ''}
                  onChange={(e) => setPostApprovedAt(e.target.value)}
                  className="rounded border border-rose-300 bg-white px-2 py-0.5 text-[11px] font-bold text-ink outline-none"
                />
              ) : (
                <span className="font-semibold text-rose-700">{korToday()} (기안 시점)</span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-[#555] shrink-0">구두/임시 승인자:</span>
              <select
                value={postApprovedBy}
                onChange={(e) => setPostApprovedBy(e.target.value)}
                className="rounded border border-rose-300 bg-white px-2 py-0.5 text-[11px] font-bold text-ink outline-none"
              >
                <option value="">승인자 선택</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.dept} · {u.position})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-2 border-t border-rose-500/15 pt-2 text-[11.5px]">
            <div className="flex flex-col gap-0.5">
              <span className="font-bold text-rose-800 text-[11px]">1. 선조치(긴급 조치) 내용 및 결과 *:</span>
              <textarea
                value={postApprovalActionTaken}
                onChange={(e) => setPostApprovalActionTaken(e.target.value)}
                rows={2}
                placeholder="긴급 조치한 업무 내용 및 현재 처리 결과를 기술하세요."
                className="w-full whitespace-pre-wrap rounded bg-white p-2 border border-rose-500/20 text-[11.5px] leading-relaxed text-[#222] outline-none focus:border-rose-500 resize-none"
              />
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="font-bold text-rose-800 text-[11px]">2. 긴급성 및 불가피성 소명 (Why?) *:</span>
              <textarea
                value={postApprovalNecessity}
                onChange={(e) => setPostApprovalNecessity(e.target.value)}
                rows={2}
                placeholder="사전 결재를 진행하지 못하고 선조치해야만 했던 소명 사유를 기술하세요."
                className="w-full whitespace-pre-wrap rounded bg-white p-2 border border-rose-500/20 text-[11.5px] leading-relaxed text-[#222] outline-none focus:border-rose-500 resize-none"
              />
            </div>
          </div>
        </div>
      )}

      {/* 4. 문서 메타 정보 표 (좌측 상단 ApprovalDocMetaTable 규격과 100% 일치 + 인라인 편집) */}
      <table className="w-full border-collapse text-[11.5px] sm:text-[12px] table-fixed">
        <tbody>
          <tr>
            <th className="w-[80px] shrink-0 border border-[#bbb] bg-[#f2f2f2] px-2 py-1.5 text-left align-middle text-[11px] font-bold text-[#444]">
              문서번호
            </th>
            <td className="border border-[#bbb] px-2.5 py-1.5 text-left align-middle text-[#666] text-[11.5px]">
              {editDocNo || '(작성 완료 시 자동 발번)'}
            </td>
            <th className="w-[80px] shrink-0 border border-[#bbb] bg-[#f2f2f2] px-2 py-1.5 text-left align-middle text-[11px] font-bold text-[#444]">
              기안부서
            </th>
            <td className="border border-[#bbb] px-2.5 py-1.5 text-left align-middle text-[#222] text-[11.5px] font-medium">
              {me.dept || '—'}
            </td>
          </tr>
          <tr>
            <th className="w-[80px] shrink-0 border border-[#bbb] bg-[#f2f2f2] px-2 py-1.5 text-left align-middle text-[11px] font-bold text-[#444]">
              기 안 자
            </th>
            <td className="border border-[#bbb] px-2.5 py-1.5 text-left align-middle text-[#222] text-[11.5px] font-medium">
              {me.position ? `${me.name} ${me.position}` : me.name}
            </td>
            <th className="w-[80px] shrink-0 border border-[#bbb] bg-[#f2f2f2] px-2 py-1.5 text-left align-middle text-[11px] font-bold text-[#444]">
              기 안 일
            </th>
            <td className="border border-[#bbb] px-2.5 py-1.5 text-left align-middle text-[#222] text-[11.5px]">
              {korToday()}
            </td>
          </tr>
          <tr>
            <th className="w-[80px] shrink-0 border border-[#bbb] bg-[#f2f2f2] px-2 py-1.5 text-left align-middle text-[11px] font-bold text-[#444]">
              보존연한
            </th>
            <td className="border border-[#bbb] px-2 py-1 text-left align-middle text-[#222] text-[11.5px]">
              <select
                value={preservationPeriod}
                onChange={(e) => setPreservationPeriod(e.target.value)}
                className="w-full bg-transparent text-[11.5px] text-[#222] outline-none cursor-pointer"
              >
                <option value="1년">1년</option>
                <option value="3년">3년</option>
                <option value="5년">5년</option>
                <option value="10년">10년</option>
                <option value="영구">영구</option>
              </select>
            </td>
            <th className="w-[80px] shrink-0 border border-[#bbb] bg-[#f2f2f2] px-2 py-1.5 text-left align-middle text-[11px] font-bold text-[#444]">
              공개범위
            </th>
            <td className="border border-[#bbb] px-2 py-1 text-left align-middle text-[#222] text-[11.5px]">
              <div className="flex items-center justify-between">
                <select
                  value={visibility}
                  onChange={(e) => setVisibility(e.target.value as any)}
                  className="bg-transparent text-[11.5px] text-[#222] outline-none cursor-pointer flex-1"
                  disabled={docCode === '채용' || docCode === '인사'}
                >
                  <option value="부서">부서 공개</option>
                  <option value="비공개">비공개</option>
                </select>
                {/* 긴급 후결 토글 */}
                {isPostApprovalSystemEnabled && (
                  <button
                    type="button"
                    onClick={() => setIsPostApproval(!isPostApproval)}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition-colors ml-2 shrink-0 ${isPostApproval
                      ? 'bg-rose-500 text-white'
                      : 'bg-[#eee] text-[#666] hover:bg-[#e0e0e0]'
                      }`}
                    title="사전 결재 없이 긴급 선조치한 후 사후 승인을 요청합니다"
                  >
                    {isPostApproval ? '긴급후결 ✓' : '후결신청'}
                  </button>
                )}
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      {/* 5. 문서 제목 및 금액 표 (ApprovalDocMetaTable과 100% 일치 + 인라인 인풋) */}
      <table className="mt-2 w-full border-collapse text-[11.5px] sm:text-[12px] table-fixed">
        <tbody>
          <tr>
            <th className="w-[80px] shrink-0 border border-[#bbb] bg-[#f2f2f2] px-2 py-2 text-left align-middle text-[11px] font-bold text-[#444]">
              제 목 <span className="text-rose-500">*</span>
            </th>
            <td colSpan={3} className="border border-[#bbb] px-2.5 py-1 text-left align-middle">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="문서 제목을 입력하세요"
                className="w-full bg-transparent px-1 py-1 text-[13px] font-bold text-[#111] placeholder:font-normal placeholder:text-[#aaa] outline-none focus:bg-teal/5 transition-colors rounded"
              />
            </td>
          </tr>
          {/* 금액 필드가 서식에 지정되어 있고 동적 상세에 포함되지 않은 경우 */}
          {amountField && !isAmountInDetails && (
            <tr>
              <th className="w-[80px] shrink-0 border border-[#bbb] bg-[#f2f2f2] px-2 py-1.5 text-left align-middle text-[11px] font-bold text-[#444]">
                {amountLabel}
              </th>
              <td colSpan={3} className="border border-[#bbb] px-2.5 py-1 text-left align-middle text-[#222]">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-[#444]">₩</span>
                  <input
                    value={amount}
                    onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))}
                    inputMode="numeric"
                    placeholder="0"
                    className="w-48 bg-transparent px-1 py-0.5 text-[12px] font-bold text-[#111] outline-none focus:bg-teal/5 rounded"
                  />
                  <span className="text-[11px] text-[#666]">
                    ({amount ? `${won(Number(amount))} (부가세 포함)` : '부가세 포함'})
                  </span>
                </div>
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* 6. 휴가원 전용: 연차 잔여 현황 배너 & 빠른 휴가 구분 버튼 (연차/반차/반반차 전용) */}
      {docCode === '휴가' && isAnnualLeaveDeduction(selectedLeaveType) && (
        <div className="mt-3 rounded-lg border border-teal/30 bg-[#f4f9f9] p-3 text-[11.5px]">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-teal/15 pb-2">
            <div className="flex items-center gap-1.5 flex-wrap">
              <Calendar size={13} className="text-teal" />
              <span className="font-bold text-[#222]">{me.name} 님의 연차 현황:</span>
              <span className="text-[#666]">총 발생 <strong>{leaveBalance?.grant ?? 15}일</strong></span>
              <span className="text-[#888]">·</span>
              <span className="text-[#666]">사용 <strong>{leaveBalance?.used ?? 0}일</strong></span>
              {leaveBalance?.pending > 0 && (
                <>
                  <span className="text-[#888]">·</span>
                  <span className="text-amber-700 font-medium">진행중 {leaveBalance.pending}일</span>
                </>
              )}
              <span className="text-[#888]">·</span>
              <span className="font-extrabold text-teal">
                잔여 {leaveBalance?.remaining ?? 15}일
              </span>
            </div>
            {/* 선사용 안내 또는 잔여 소진 시 알림 */}
            {leaveBalance?.advanceOffset?.isAdvanceUsed ? (
              <span className="text-[10.5px] text-amber-800 font-semibold">
                (선사용 상계 잔여: {leaveBalance.advanceOffset.offsetRemainingDays}일)
              </span>
            ) : (leaveBalance?.remaining ?? 0) <= 0 ? (
              <span className="text-[10.5px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 font-semibold border border-amber-200">
                연차 선사용 가능
              </span>
            ) : null}
          </div>

          {/* 휴가 구분 인라인 칩 버튼 */}
          <div className="mt-2 flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] font-bold text-[#555] mr-1">휴가 구분:</span>
            {[
              { type: '연차', label: '종일 연차 (1.0일)' },
              { type: '오전반차', label: '오전 반차 (0.5일)' },
              { type: '오후반차', label: '오후 반차 (0.5일)' },
              { type: '반반차', label: '반반차 (0.25일)' },
            ].map((item) => {
              const isSel = selectedLeaveType === item.type;
              return (
                <button
                  key={item.type}
                  type="button"
                  onClick={() => {
                    const isPart = isPartDayLeave(item.type);
                    const curStart = (values['period'] as string) || '';
                    const curEnd = isPart ? curStart : (values['period__end'] as string);
                    const nextDays = calculateLeaveDays({
                      leaveType: item.type,
                      startDate: curStart,
                      endDate: curEnd,
                      holidays,
                    });
                    setVals({
                      leaveType: item.type,
                      ...(isPart && curStart ? { period__end: curStart } : {}),
                      period__days: nextDays,
                    });
                  }}
                  className={`px-2.5 py-1 rounded text-[11px] font-bold transition-all cursor-pointer ${isSel
                    ? 'bg-teal text-white shadow-2xs'
                    : 'bg-white text-[#555] border border-[#ddd] hover:bg-[#f0f0f0]'
                    }`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>

          {/* 공휴일 자동 제외 안내 배너 */}
          {excludedHolidays.length > 0 && (
            <div className="mt-2.5 rounded-md bg-teal/10 border border-teal/30 px-3 py-2 text-[11px] text-[#222]">
              <div className="flex items-center gap-1.5 font-bold text-teal">
                <Calendar size={13} className="shrink-0" />
                <span>공휴일 자동 제외 안내 (신청 일수에서 차감 제외):</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-2 text-[10.5px] text-[#444]">
                {excludedHolidays.map((h) => (
                  <span key={h.date} className="inline-flex items-center gap-1 rounded bg-white px-1.5 py-0.5 border border-teal/20 font-medium">
                    <span className="font-semibold text-teal">{h.date.slice(5)} ({h.dayOfWeek})</span>
                    <span>{h.name}</span>
                  </span>
                ))}
              </div>
              <div className="mt-1 text-[10px] text-[#666]">
                ※ 법정 공휴일은 유급휴일이므로 연차 일수에서 자동으로 제외되어 차감되지 않습니다.
              </div>
            </div>
          )}
        </div>
      )}

      {/* 6-1. 휴가원 전용: 대체휴무 현황 배너 & 대휴 구분 버튼 */}
      {docCode === '휴가' && (selectedLeaveType === '대체휴무' || selectedLeaveType === 'SUBSTITUTE') && (() => {
        const subRemaining = Number(leaveBalance?.substituteHoliday?.remaining ?? 0);
        const isNoSubRemaining = subRemaining <= 0;

        return (
          <div className={`mt-3 rounded-lg border p-3 text-[11.5px] transition-colors ${isNoSubRemaining
            ? 'border-rose-300 bg-rose-50/40'
            : 'border-sky-300 bg-[#f0f7fc]'
            }`}>
            <div className={`flex flex-wrap items-center justify-between gap-2 border-b pb-2 ${isNoSubRemaining ? 'border-rose-200/70' : 'border-sky-200/60'
              }`}>
              <div className="flex items-center gap-1.5 flex-wrap">
                <Calendar size={13} className={isNoSubRemaining ? 'text-rose-600' : 'text-sky-600'} />
                <span className="font-bold text-[#222]">{me.name} 님의 대체휴무 현황:</span>
                <span className="text-[#666]">
                  총 발생 <strong>{leaveBalance?.substituteHoliday?.total ?? 0}일</strong>
                </span>
                <span className="text-[#888]">·</span>
                <span className="text-[#666]">
                  사용 <strong>{leaveBalance?.substituteHoliday?.used ?? 0}일</strong>
                </span>
                {(leaveBalance?.substituteHoliday?.pending ?? 0) > 0 && (
                  <>
                    <span className="text-[#888]">·</span>
                    <span className="text-amber-700 font-medium">
                      진행중 {leaveBalance.substituteHoliday.pending}일
                    </span>
                  </>
                )}
                <span className="text-[#888]">·</span>
                <span className={`font-extrabold ${subRemaining > 0 ? 'text-sky-700' : 'text-rose-600'}`}>
                  잔여 {subRemaining}일
                </span>
              </div>
              {/* 만료 임박 또는 잔여 0일 알림 */}
              {(leaveBalance?.substituteHoliday?.expiringSoonCount ?? 0) > 0 ? (
                <span className="text-[10.5px] px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 font-semibold border border-rose-200">
                  30일 이내 만료 예정: {leaveBalance.substituteHoliday.expiringSoonCount}건
                </span>
              ) : isNoSubRemaining ? (
                <span className="text-[10.5px] px-2 py-0.5 rounded bg-rose-100 text-rose-700 font-bold border border-rose-300 animate-pulse">
                  잔여 대체휴무 없음 (신청 불가)
                </span>
              ) : null}
            </div>

            {/* 잔여 대체휴무 0일 시 신청 불가 강력 안내 */}
            {isNoSubRemaining && (
              <div className="mt-2 rounded bg-rose-100/70 border border-rose-200 px-2.5 py-1.5 text-[11px] text-rose-800 font-medium flex items-center gap-1.5">
                <AlertTriangle size={13} className="text-rose-600 shrink-0" />
                <span>
                  <strong>잔여 대체휴무가 없습니다.</strong> 대체휴무는 법률상 선사용이 불가하며, 휴일근무(특근) 발생 내역이 사전에 적립되어 있어야만 기안이 가능합니다.
                </span>
              </div>
            )}

            {/* 대체휴무 구분 인라인 칩 버튼 & 안내 문구 */}
            <div className="mt-2 flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-bold text-[#555] mr-1">대휴 구분:</span>
                {[
                  { days: 1.0, label: '종일 대휴 (1.0일)' },
                  { days: 0.5, label: '반일 대휴 (0.5일)' },
                ].map((item) => {
                  const currentDays = Number(values['period__days'] ?? 1.0);
                  const isSel = currentDays === item.days;
                  return (
                    <button
                      key={item.label}
                      type="button"
                      disabled={isNoSubRemaining}
                      onClick={() => {
                        if (isNoSubRemaining) return;
                        const isPart = item.days < 1.0;
                        const curStart = (values['period'] as string) || '';
                        setVals({
                          leaveType: '대체휴무',
                          ...(isPart && curStart ? { period__end: curStart } : {}),
                          period__days: item.days,
                        });
                      }}
                      className={`px-2.5 py-1 rounded text-[11px] font-bold transition-all ${isNoSubRemaining
                        ? 'bg-gray-100 text-gray-400 border border-gray-200 cursor-not-allowed'
                        : isSel
                          ? 'bg-sky-600 text-white shadow-2xs cursor-pointer'
                          : 'bg-white text-[#555] border border-[#ddd] hover:bg-[#f0f0f0] cursor-pointer'
                        }`}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}

      {/* 7. 서식 동적 상세 블록 렌더링 (ApprovalDocumentView 규격과 100% 일치 + 인라인 편집) */}
      {blocks.length > 0 && (
        <div className="space-y-3.5 mt-3">
          {blocks.map((block, blockIdx) => {
            const showSectionHeader = block.section && block.section !== lastRenderedSection;
            if (block.section) {
              lastRenderedSection = block.section;
            }

            // A. 장문 블록 (longtext)
            if (block.type === 'longtext') {
              const f = block.fields[0];
              const val = String(values[f.key] ?? '');
              const isSelected = isDesignMode && selectedFieldKey === f.key;
              return (
                <div
                  key={blockIdx}
                  onClick={() => { if (isDesignMode) onSelectFieldKey?.(f.key); }}
                  className={`space-y-1 transition-all rounded p-1.5 ${isDesignMode ? 'cursor-pointer ' + (isSelected ? 'ring-2 ring-teal bg-teal-soft/20 shadow-xs' : 'hover:ring-1 hover:ring-teal/40') : ''
                    }`}
                >
                  {showSectionHeader && (
                    <div className="text-[11px] font-bold text-teal mt-2.5">
                      {block.section}
                    </div>
                  )}
                  <div className="text-[11px] font-semibold text-[#444] mb-0.5 flex items-center justify-between">
                    <span className="flex items-center gap-1">
                      {f.label}
                      {f.required && <span className="text-rose-500">*</span>}
                    </span>
                    {isSelected && (
                      <span className="rounded bg-teal px-1.5 py-0.2 text-[9px] font-bold text-white">
                        선택됨 (좌측에서 편집)
                      </span>
                    )}
                  </div>
                  <AutoResizeTextarea
                    value={val}
                    onChange={(newVal) => setVals({ [f.key]: newVal })}
                    placeholder={f.placeholder || `${f.label} 내용을 입력하세요`}
                    className="w-full min-h-[140px] border border-[#bbb] px-4 py-3 text-[12.5px] leading-[1.9] text-[#222] bg-white outline-none focus:border-teal rounded-none resize-y"
                  />
                </div>
              );
            }

            // B. 동적 행 그리드 블록 (table-field)
            if (block.type === 'table-field') {
              const isHalf = effectiveFieldProps(block.fields[0]).width === 'half';

              const renderTableFieldItem = (f: FormField) => {
                const v = values[f.key];
                const isSelected = isDesignMode && selectedFieldKey === f.key;
                const hasLabel = !!(f.label && f.label.trim());

                return (
                  <div
                    key={f.key}
                    onClick={() => {
                      if (isDesignMode) onSelectFieldKey?.(f.key);
                    }}
                    className={`flex flex-col rounded-lg border border-[#bbb] bg-white overflow-hidden transition-all min-w-0 ${
                      isDesignMode
                        ? 'cursor-pointer ' +
                          (isSelected
                            ? 'ring-2 ring-teal shadow-md'
                            : 'hover:ring-1 hover:ring-teal/40')
                        : ''
                    }`}
                  >
                    {hasLabel && (
                      <div
                        className={`text-[11.5px] font-bold py-1.5 px-3 border-b border-[#bbb] flex items-center justify-between transition-colors ${
                          isSelected
                            ? 'bg-teal text-white'
                            : 'bg-[#f5f5f5] text-[#222]'
                        }`}
                      >
                        <span className="flex items-center gap-1 font-bold">
                          {f.label}
                          {f.required && (
                            <span className={isSelected ? 'text-rose-200' : 'text-rose-500'}>*</span>
                          )}
                        </span>
                        {isSelected && (
                          <span className="rounded bg-white/20 px-1.5 py-0.2 text-[9px] font-bold text-white">
                            선택됨 (좌측에서 편집)
                          </span>
                        )}
                      </div>
                    )}
                    <div className="bg-white flex-1 overflow-x-auto">
                      <TableFieldEditor
                        field={f}
                        v={v}
                        isDesignMode={isDesignMode}
                        isHalf={isHalf}
                        allFormValues={values}
                        formFields={form?.fields}
                        set={(patch) => {
                          const tableFields = (form?.fields ?? []).filter((item) => item.type === '표');
                          const cascadedPatch = cascadeRecalculateAllTables(tableFields, values, patch);
                          setVals(cascadedPatch);
                          // 표 내 금액 합계가 있으면 메인 amount에도 연동
                          const updatedVal = cascadedPatch[f.key] || patch[f.key];
                          if (typeof updatedVal === 'string' && updatedVal.includes('"rows"')) {
                            try {
                              const parsed = JSON.parse(updatedVal);
                              const amtCol = parsed.cols?.find(
                                (c: string) => c.includes('금액') || c.includes('비용')
                              );
                              if (amtCol && Array.isArray(parsed.rows)) {
                                const sum = parsed.rows.reduce((acc: number, r: any) => {
                                  const num = Number(String(r[amtCol] || '').replace(/[^0-9]/g, ''));
                                  return acc + (isNaN(num) ? 0 : num);
                                }, 0);
                                if (sum > 0 && (!amount || amount === '0')) {
                                  setAmount(String(sum));
                                }
                              }
                            } catch (e) {}
                          }
                        }}
                      />
                    </div>
                  </div>
                );
              };

              return (
                <div key={blockIdx} className="space-y-1">
                  {showSectionHeader && (
                    <div className="text-[11px] font-bold text-teal mt-2.5">
                      {block.section}
                    </div>
                  )}
                  {isHalf ? (
                    <div className="grid grid-cols-2 gap-2.5 min-w-0">
                      {block.fields.map((f) => renderTableFieldItem(f))}
                      {block.fields.length === 1 && <div />}
                    </div>
                  ) : (
                    renderTableFieldItem(block.fields[0])
                  )}
                </div>
              );
            }

            // C. 일반 테이블 블록 (table: 2열 또는 4열 정규 테이블)
            const tableRows: React.ReactNode[] = [];
            const fields = block.fields;

            for (let i = 0; i < fields.length; i++) {
              const f = fields[i];
              const { width: fw } = effectiveFieldProps(f);
              const isSelected = isDesignMode && selectedFieldKey === f.key;

              if (fw === 'half') {
                const next = fields[i + 1];
                const { width: nw } = next ? effectiveFieldProps(next) : { width: 'full' as const };
                if (next && nw === 'half') {
                  const isNextSelected = isDesignMode && selectedFieldKey === next.key;
                  tableRows.push(
                    <tr key={f.key}>
                      <th
                        onClick={() => { if (isDesignMode) onSelectFieldKey?.(f.key); }}
                        className={`w-[80px] shrink-0 border border-[#bbb] px-2 py-1.5 text-left align-middle text-[11px] font-bold ${isDesignMode
                          ? 'cursor-pointer ' + (isSelected ? 'bg-teal-soft text-teal font-extrabold ring-2 ring-teal' : 'bg-[#f2f2f2] text-[#444] hover:bg-teal-soft/30')
                          : 'bg-[#f2f2f2] text-[#444]'
                          }`}
                      >
                        {f.label} {f.required && <span className="text-rose-500">*</span>}
                      </th>
                      <td
                        onClick={() => { if (isDesignMode) onSelectFieldKey?.(f.key); }}
                        className={`border border-[#bbb] px-2.5 py-1 text-left align-middle text-[#222] ${isDesignMode && isSelected ? 'bg-teal-soft/10' : ''
                          }`}
                      >
                        <InlineFieldEditor
                          field={f}
                          values={values}
                          setVals={setVals}
                          org={org}
                          onOpenUserPicker={setActiveUserField}
                          holidays={holidays}
                        />
                      </td>
                      <th
                        onClick={() => { if (isDesignMode) onSelectFieldKey?.(next.key); }}
                        className={`w-[80px] shrink-0 border border-[#bbb] px-2 py-1.5 text-left align-middle text-[11px] font-bold ${isDesignMode
                          ? 'cursor-pointer ' + (isNextSelected ? 'bg-teal-soft text-teal font-extrabold ring-2 ring-teal' : 'bg-[#f2f2f2] text-[#444] hover:bg-teal-soft/30')
                          : 'bg-[#f2f2f2] text-[#444]'
                          }`}
                      >
                        {next.label} {next.required && <span className="text-rose-500">*</span>}
                      </th>
                      <td
                        onClick={() => { if (isDesignMode) onSelectFieldKey?.(next.key); }}
                        className={`border border-[#bbb] px-2.5 py-1 text-left align-middle text-[#222] ${isDesignMode && isNextSelected ? 'bg-teal-soft/10' : ''
                          }`}
                      >
                        <InlineFieldEditor
                          field={next}
                          values={values}
                          setVals={setVals}
                          org={org}
                          onOpenUserPicker={setActiveUserField}
                          holidays={holidays}
                        />
                      </td>
                    </tr>
                  );
                  i++;
                } else {
                  tableRows.push(
                    <tr key={f.key}>
                      <th
                        onClick={() => { if (isDesignMode) onSelectFieldKey?.(f.key); }}
                        className={`w-[80px] shrink-0 border border-[#bbb] px-2 py-1.5 text-left align-middle text-[11px] font-bold ${isDesignMode
                          ? 'cursor-pointer ' + (isSelected ? 'bg-teal-soft text-teal font-extrabold ring-2 ring-teal' : 'bg-[#f2f2f2] text-[#444] hover:bg-teal-soft/30')
                          : 'bg-[#f2f2f2] text-[#444]'
                          }`}
                      >
                        {f.label} {f.required && <span className="text-rose-500">*</span>}
                      </th>
                      <td
                        onClick={() => { if (isDesignMode) onSelectFieldKey?.(f.key); }}
                        className={`border border-[#bbb] px-2.5 py-1 text-left align-middle text-[#222] ${isDesignMode && isSelected ? 'bg-teal-soft/10' : ''
                          }`}
                      >
                        <InlineFieldEditor
                          field={f}
                          values={values}
                          setVals={setVals}
                          org={org}
                          onOpenUserPicker={setActiveUserField}
                          holidays={holidays}
                        />
                      </td>
                      <th className="w-[80px] shrink-0 border border-[#bbb] bg-[#f2f2f2] px-2 py-1.5 text-left align-middle text-[11px] font-bold text-[#444]"></th>
                      <td className="border border-[#bbb] px-2.5 py-1 text-left align-middle text-[#222]"></td>
                    </tr>
                  );
                }
              } else {
                tableRows.push(
                  <tr key={f.key}>
                    <th
                      onClick={() => { if (isDesignMode) onSelectFieldKey?.(f.key); }}
                      className={`w-[80px] shrink-0 border border-[#bbb] px-2 py-1.5 text-left align-middle text-[11px] font-bold ${isDesignMode
                        ? 'cursor-pointer ' + (isSelected ? 'bg-teal-soft text-teal font-extrabold ring-2 ring-teal' : 'bg-[#f2f2f2] text-[#444] hover:bg-teal-soft/30')
                        : 'bg-[#f2f2f2] text-[#444]'
                        }`}
                    >
                      {f.label} {f.required && <span className="text-rose-500">*</span>}
                    </th>
                    <td
                      colSpan={3}
                      onClick={() => { if (isDesignMode) onSelectFieldKey?.(f.key); }}
                      className={`border border-[#bbb] px-2.5 py-1 text-left align-middle text-[#222] ${isDesignMode && isSelected ? 'bg-teal-soft/10' : ''
                        }`}
                    >
                      <InlineFieldEditor
                        field={f}
                        values={values}
                        setVals={setVals}
                        org={org}
                        onOpenUserPicker={setActiveUserField}
                        holidays={holidays}
                      />
                    </td>
                  </tr>
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
                <table className="w-full border-collapse text-[12px] table-fixed">
                  <tbody>{tableRows}</tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}

      {/* 8. 본문 (장문 필드가 전혀 없는 서식의 경우 기본 본문 박스 제공) */}
      {longTextFields.length === 0 && (
        <div className="mt-3">
          <div className="text-[11px] font-semibold text-[#444] mb-1">상세 내용</div>
          <AutoResizeTextarea
            value={String(values['body'] ?? '')}
            onChange={(val) => setVals({ body: val })}
            placeholder="상세 내용을 입력하세요"
            className="w-full min-h-[140px] border border-[#bbb] px-4 py-3 text-[12.5px] leading-[1.9] text-[#222] bg-white outline-none focus:border-teal rounded-none resize-y"
          />
        </div>
      )}

      {/* 9. 첨부파일 영역 (ApprovalDocumentView와 100% 일치 표 규격 + 드래그앤드롭 업로더) */}
      <table className="mt-4 w-full border-collapse text-[12px] table-fixed">
        <tbody>
          <tr>
            <th className="w-[80px] shrink-0 border border-[#bbb] bg-[#f2f2f2] px-2 py-1.5 text-left align-middle text-[11px] font-bold text-[#444]">
              첨부파일
            </th>
            <td className="border border-[#bbb] px-2.5 py-2 text-left align-middle text-[#222]">
              {/* 드래그앤드롭 영역 */}
              <div
                onDragEnter={handleDrag}
                onDragOver={handleDrag}
                onDragLeave={handleDrag}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`flex items-center justify-between border border-dashed rounded px-3 py-2 cursor-pointer transition-colors ${isDragActive
                  ? 'border-teal bg-teal/5'
                  : 'border-[#ccc] bg-[#fafafa] hover:bg-[#f0f0f0]'
                  }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  onChange={async (e) => {
                    const files = Array.from(e.target.files ?? []);
                    await onFileUpload(files);
                    if (fileInputRef.current) fileInputRef.current.value = '';
                  }}
                  className="hidden"
                />
                <div className="flex items-center gap-2 text-[11.5px] text-[#555]">
                  <Upload size={14} className="text-[#888]" />
                  <span>
                    {uploading
                      ? '파일을 업로드하는 중...'
                      : '여기에 파일을 드래그하거나 클릭하여 추가'}
                  </span>
                </div>
                <span className="text-[10.5px] text-[#888]">
                  보존기한: {attachmentRetention === 'permanent' ? '영구' : attachmentRetention}
                </span>
              </div>

              {/* 첨부파일 리스트 */}
              {attachments.length > 0 && (
                <div className="mt-2 space-y-1">
                  {attachments.map((file, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between text-[11.5px] bg-[#f7f7f7] px-2.5 py-1 rounded border border-[#eee]"
                    >
                      <div className="flex items-center gap-1.5 truncate">
                        <Paperclip size={12} className="text-[#888] shrink-0" />
                        <span className="truncate font-medium text-[#222]">{file.name}</span>
                        {file.size && (
                          <span className="text-[10.5px] text-[#888]">
                            ({(file.size / 1024).toFixed(1)} KB)
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setAttachments((prev) => prev.filter((_, i) => i !== idx))
                        }
                        className="text-rose-500 hover:text-rose-700 p-0.5 ml-2 shrink-0 cursor-pointer"
                        title="파일 삭제"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </td>
          </tr>
        </tbody>
      </table>

      {/* 10. 수신처 영역 (선택된 수신처가 있을 경우 공문서 표로 표시) */}
      {recipients.length > 0 && (
        <table className="mt-2 w-full border-collapse text-[12px] table-fixed">
          <tbody>
            <tr>
              <th className="w-[80px] shrink-0 border border-[#bbb] bg-[#f2f2f2] px-2 py-1.5 text-left align-middle text-[11px] font-bold text-[#444]">
                수 신 처
              </th>
              <td className="border border-[#bbb] px-2.5 py-1.5 text-left align-middle text-[#222]">
                <div className="flex flex-wrap gap-x-2 gap-y-1 text-[11.5px]">
                  {recipients.map((r, idx) => (
                    <span key={r.id} className="font-semibold text-[#333]">
                      {r.name}
                      {idx < recipients.length - 1 ? ',' : ''}
                    </span>
                  ))}
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      )}

      {/* 11. 관련 문서 영역 */}
      <table className="mt-2 w-full border-collapse text-[12px] table-fixed">
        <tbody>
          <tr>
            <th className="w-[80px] shrink-0 border border-[#bbb] bg-[#f2f2f2] px-2 py-1.5 text-left align-middle text-[11px] font-bold text-[#444]">
              관련 문서
            </th>
            <td className="border border-[#bbb] px-2.5 py-1.5 text-left align-middle text-[#222]">
              <div className="flex items-center justify-between mb-1">
                <button
                  type="button"
                  onClick={() => setShowRelatedModal(true)}
                  className="rounded border border-dashed border-[#bbb] bg-white px-2 py-0.5 text-[11px] font-semibold text-teal hover:border-teal cursor-pointer transition-colors"
                >
                  + 관련 결재 문서 연결
                </button>
                <span className="text-[10.5px] text-[#888]">
                  {relatedDocs.length}건 연결됨
                </span>
              </div>
              {relatedDocs.length > 0 && (
                <div className="space-y-1 mt-1.5">
                  {relatedDocs.map((rd, i) => (
                    <div
                      key={rd.docId}
                      className="flex items-center justify-between text-[11.5px] bg-[#f7f7f7] px-2 py-0.5 rounded"
                    >
                      <span className="truncate flex items-center gap-1.5">
                        <FileText size={12} className="text-[#888] shrink-0" />
                        <span className="font-mono text-[11px] text-teal">[{rd.docNo}]</span>
                        <span className="font-semibold text-[#222] truncate">{rd.title}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => setRelatedDocs((prev) => prev.filter((_, idx) => idx !== i))}
                        className="text-[10.5px] text-rose-500 hover:underline ml-2 shrink-0 cursor-pointer"
                      >
                        연결 해제
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </td>
          </tr>
        </tbody>
      </table>

      {/* 12. 공문서 하단 격식 맺음말 및 기안자 서명/직인란 (ApprovalDocumentView와 100% 일치) */}
      <div className="mt-8 text-center text-[12.5px] leading-loose text-[#222]">
        {closing.trim() && (
          <div
            onClick={() => {
              if (isDesignMode && onUpdateClosing) {
                const next = prompt('공문서 맺음말을 입력하세요:', closing);
                if (next !== null && next.trim()) onUpdateClosing(next.trim());
              }
            }}
            className={
              isDesignMode
                ? 'hover:bg-teal-soft/40 hover:text-teal rounded cursor-pointer transition-colors p-1 inline-block'
                : ''
            }
            title={isDesignMode ? '클릭하여 맺음말 수정' : undefined}
          >
            {closing}
            {isDesignMode && (
              <span className="block text-[10px] tracking-normal font-normal text-teal opacity-70">
                (클릭하여 맺음말 수정)
              </span>
            )}
          </div>
        )}
        <div className="mt-4 font-semibold tracking-wide">{korToday()}</div>
        <div className="mt-1 flex items-center justify-center gap-1">
          기안자{' '}
          <span className="mx-1 text-[14px] font-bold tracking-[0.2em]">{me.name}</span>
          {/* 본인 직인/서명 렌더링 */}
          {me.signType === 'signature' ? (
            me.signUrl ? (
              <span className="relative inline-flex h-9 w-9 items-center justify-center select-none bg-white">
                <span className="text-[12.5px] font-bold text-[#c0392b] z-30 select-none">(인)</span>
                <img
                  src={me.signUrl}
                  alt="서명"
                  className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-full w-[80px] max-w-none object-contain opacity-90 z-20 pointer-events-none mix-blend-multiply scale-125"
                />
              </span>
            ) : (
              <span className="relative inline-flex h-7 w-[60px] items-center justify-center rounded border border-dashed border-danger/40 text-[9.5px] font-bold text-danger/80 select-none">
                서명미등록
              </span>
            )
          ) : me.sealUrl ? (
            <span className="relative inline-flex h-[44px] w-[44px] items-center justify-center select-none bg-white">
              <span className="text-[12.5px] font-bold text-[#c0392b]/35 z-10 select-none">(인)</span>
              <img src={me.sealUrl} alt="인감" className="absolute inset-0 h-full w-full object-contain z-20 pointer-events-none" />
            </span>
          ) : (
            <span className="grid h-[32px] w-[32px] place-items-center rounded-full border-[1.5px] border-[#c0392b] text-[9.5px] font-bold text-[#c0392b] select-none">
              (인)
            </span>
          )}
        </div>
      </div>

      {/* 조직도 선택 모달 (인라인 사용자 필드 클릭 시) */}
      {activeUserField && (
        <SelectorDialog
          title={`${activeUserField.label || '사용자'} 선택`}
          org={org}
          singleSelect={true}
          deptOnly={false}
          onConfirm={(items) => {
            if (items[0]) {
              setVals({ [activeUserField.key]: items[0].id });
            }
            setActiveUserField(null);
          }}
          onClose={() => setActiveUserField(null)}
        />
      )}
    </div>
  );
}

/** 셀 안에서 자연스럽게 동작하는 인라인 필드 에디터 */
function InlineFieldEditor({
  field,
  values,
  setVals,
  org,
  onOpenUserPicker,
  holidays,
}: {
  field: FormField;
  values: Record<string, FieldValue>;
  setVals: (patch: Record<string, FieldValue>) => void;
  org: any;
  onOpenUserPicker: (f: FormField) => void;
  holidays?: Array<{ date: string; name?: string }> | Map<string, string>;
}) {
  const v = values[field.key];
  const sv = typeof v === 'string' ? v : v == null ? '' : String(v);

  switch (field.type) {
    case '안내문':
      return <span className="text-[11px] text-[#777]">{field.placeholder || field.label}</span>;

    case '숫자':
    case '금액':
      return (
        <div className="flex items-center gap-1 w-full">
          {field.type === '금액' && <span className="text-[11px] font-semibold text-[#666]">₩</span>}
          <input
            value={sv}
            onChange={(e) => setVals({ [field.key]: e.target.value.replace(/[^0-9]/g, '') })}
            inputMode="numeric"
            placeholder={field.placeholder || (field.type === '금액' ? '0' : '')}
            className="w-full bg-transparent px-1 py-0.5 text-[12px] text-[#222] outline-none focus:bg-teal/5 rounded"
          />
          {field.type === '금액' && sv && (
            <span className="text-[10.5px] text-[#888] shrink-0">
              ({Number(sv).toLocaleString()}원)
            </span>
          )}
        </div>
      );

    case '날짜':
      return (
        <input
          type="date"
          value={sv}
          onChange={(e) => setVals({ [field.key]: e.target.value })}
          className="bg-transparent px-1 py-0.5 text-[12px] text-[#222] outline-none focus:bg-teal/5 rounded cursor-pointer"
        />
      );

    case '기간': {
      const start = sv;
      const end = (values[field.key + '__end'] as string) ?? '';
      const currentLeaveType = String(values['leaveType'] || '').trim();
      const currentDays = Number(values['period__days'] ?? 1.0);
      const isPart = isPartDayLeave(currentLeaveType) || (currentLeaveType === '대체휴무' && currentDays < 1.0);

      return (
        <CalendarRangePicker
          start={start}
          end={isPart ? start : end}
          singleDateOnly={isPart}
          onChange={(newStart, newEnd) => {
            const actualEnd = isPart ? newStart : newEnd;
            const days = newStart && actualEnd
              ? calculateLeaveDays({
                leaveType: currentLeaveType,
                startDate: newStart,
                endDate: actualEnd,
                rawDays: isPart ? currentDays : undefined,
                holidays,
              })
              : 0;
            setVals({
              [field.key]: newStart,
              [field.key + '__end']: actualEnd,
              [field.key + '__days']: days,
            });
          }}
        />
      );
    }

    case '선택':
      return (
        <SelectFieldEditor
          field={field}
          sv={sv}
          set={setVals}
          inp="w-full bg-transparent px-1 py-0.5 text-[12px] text-[#222] outline-none focus:bg-teal/5 rounded cursor-pointer border border-transparent focus:border-teal hover:border-[#ddd]"
          onCustomChange={(nextVal) => {
            if (field.key === 'leaveType') {
              const isPart = isPartDayLeave(nextVal);
              const curStart = (values['period'] as string) || '';
              const curEnd = isPart ? curStart : (values['period__end'] as string);
              const patch: Record<string, FieldValue> = {};
              if (isPart && curStart) {
                patch['period__end'] = curStart;
              }
              const nextDays = calculateLeaveDays({
                leaveType: nextVal,
                startDate: curStart,
                endDate: curEnd,
                holidays,
              });
              patch['period__days'] = nextDays;
              setVals(patch);
            }
          }}
        />
      );

    case '다중선택': {
      const picked = new Set(sv ? sv.split(',').filter(Boolean) : []);
      const toggle = (o: string) => {
        picked.has(o) ? picked.delete(o) : picked.add(o);
        setVals({ [field.key]: [...picked].join(',') });
      };
      return (
        <div className="flex flex-wrap gap-1">
          {field.options?.map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => toggle(o)}
              className={`rounded px-1.5 py-0.5 text-[10.5px] font-medium transition-colors cursor-pointer ${picked.has(o)
                ? 'bg-teal text-white'
                : 'bg-[#eee] text-[#444] hover:bg-[#e2e2e2]'
                }`}
            >
              {o}
            </button>
          ))}
        </div>
      );
    }

    case '체크':
      return (
        <label className="flex items-center gap-1.5 text-[12px] text-[#222] cursor-pointer">
          <input
            type="checkbox"
            checked={v === true}
            onChange={(e) => setVals({ [field.key]: e.target.checked })}
          />
          <span>{field.placeholder || '예'}</span>
        </label>
      );

    case '사용자': {
      const targetUser = org.users?.find((u: any) => u.id === sv);
      return (
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onOpenUserPicker(field)}
            className="flex items-center gap-1 rounded bg-[#f0f4f4] px-2 py-0.5 text-[11.5px] font-semibold text-teal hover:bg-[#e0ecec] cursor-pointer"
          >
            <Building2 size={12} />
            <span>{targetUser ? `${targetUser.name} (${targetUser.dept})` : '임직원 검색'}</span>
          </button>
          {targetUser && (
            <button
              type="button"
              onClick={() => setVals({ [field.key]: '' })}
              className="text-[#999] hover:text-rose-500 cursor-pointer"
              title="삭제"
            >
              <X size={12} />
            </button>
          )}
        </div>
      );
    }

    case '부서':
      return (
        <select
          value={sv}
          onChange={(e) => setVals({ [field.key]: e.target.value })}
          className="w-full bg-transparent px-1 py-0.5 text-[12px] text-[#222] outline-none focus:bg-teal/5 rounded cursor-pointer"
        >
          <option value="">부서 선택</option>
          {(org?.depts ?? []).map((d: any) => (
            <option key={d.id} value={d.name}>
              {d.name}
            </option>
          ))}
        </select>
      );

    case '텍스트':
    default:
      // Enter 로 줄을 바꾸면 칸이 아래로 늘어난다(인쇄·상세는 whitespace-pre-wrap 으로 줄바꿈 유지).
      return (
        <AutoResizeTextarea
          value={sv}
          onChange={(val) => setVals({ [field.key]: val })}
          placeholder={field.placeholder || ''}
          rows={1}
          className="block w-full resize-none bg-transparent px-1 py-0.5 text-[12px] leading-relaxed text-[#222] outline-none focus:bg-teal/5 rounded"
        />
      );
  }
}
