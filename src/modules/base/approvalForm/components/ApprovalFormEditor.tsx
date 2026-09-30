import React, { useState, useEffect, useMemo } from 'react';
import type { ApprovalForm, FormField, FieldType, ApprovalFolder } from '@/domain/approvalForm/schema';
import { FIELD_TYPES } from '@/domain/approvalForm/schema';
import { useJobTitles } from '@/features/jobTitle/useJobTitles';
import { useUsers } from '@/features/user/useUsers';
import { useRouteRules } from '@/features/gw/useRouteRules';
import { blankField } from '../utils';
import { OptionsInput } from './OptionsInput';
import { FormPermissionSettings } from './FormPermissionSettings';
import { FormTargetSelector } from './FormTargetSelector';
import { ApprovalRouteRuleModal } from '../routeRules/ApprovalRouteRuleModal';
import { resolveRoute } from '@/domain/approvalRoute/engine';
import { ApprovalDraftDocumentSheet } from '@/modules/gw/approval/components/ApprovalDraftDocumentSheet';
import type { User } from '@/domain/user/schema';
import type { ApprovalStep } from '@/domain/approvalDoc/schema';
import type { FieldValue } from '@/domain/approvalForm/schema';
import { useAuth } from '@/app/auth/AuthProvider';
import {
  ArrowLeft,
  Save,
  Printer,
  Sparkles,
  Settings,
  Trash2,
  ChevronUp,
  ChevronDown,
  MousePointerClick,
  SlidersHorizontal,
} from 'lucide-react';

const inp = 'w-full rounded-lg border border-border-hi bg-panel px-2.5 py-1.5 text-[12px] text-ink outline-none focus:border-teal';

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[10.5px] font-semibold text-ink3">{label}</span>
      {children}
    </label>
  );
}

// 🧰 필드 컴포넌트 라이브러리 프리셋 (사용자 제안 아스키 아트 구조 100% 반영)
const COMPONENT_PALETTE = [
  {
    type: '텍스트' as FieldType,
    label: '단문 텍스트',
    icon: '🔤',
    desc: '한 줄 텍스트 입력',
    defaultWidth: 'half' as const,
    defaultLabel: '항목명',
  },
  {
    type: '장문' as FieldType,
    label: '본문 (장문)',
    icon: '📝',
    desc: '다단 줄바꿈 상세 본문',
    defaultWidth: 'full' as const,
    defaultLabel: '기안내용',
    key: 'body',
  },
  {
    type: '날짜' as FieldType,
    label: '날짜 선택',
    icon: '📅',
    desc: '단일 일자 선택기',
    defaultWidth: 'half' as const,
    defaultLabel: '일자',
  },
  {
    type: '기간' as FieldType,
    label: '기간 선택',
    icon: '🗓️',
    desc: '시작일 ~ 종료일 및 일수',
    defaultWidth: 'full' as const,
    defaultLabel: '신청기간',
  },
  {
    type: '부서' as FieldType,
    label: '부서 선택',
    icon: '🏢',
    desc: '조직도 부서 자동 완성',
    defaultWidth: 'half' as const,
    defaultLabel: '관련부서',
  },
  {
    type: '사용자' as FieldType,
    label: '사원/사용자',
    icon: '👤',
    desc: '조직도 임직원 피커',
    defaultWidth: 'half' as const,
    defaultLabel: '대상자',
  },
  {
    type: '표' as FieldType,
    label: '표 (테이블)',
    icon: '📊',
    desc: '행 추가형 동적 테이블',
    defaultWidth: 'full' as const,
    defaultLabel: '상세내역',
  },
  {
    type: '숫자' as FieldType,
    label: '금액 (결재연동)',
    icon: '💰',
    desc: '금액 단위 및 결재선 연동',
    defaultWidth: 'half' as const,
    defaultLabel: '청구금액',
    isAmountKey: true,
  },
  {
    type: '선택' as FieldType,
    label: '단일 선택',
    icon: '🔘',
    desc: '드롭다운 / 옵션 선택',
    defaultWidth: 'half' as const,
    defaultLabel: '구분',
    options: ['옵션1', '옵션2', '기타'],
  },
  {
    type: '숫자' as FieldType,
    label: '일반 숫자',
    icon: '🔢',
    desc: '수량 / 번호 / 단위',
    defaultWidth: 'half' as const,
    defaultLabel: '수량',
  },
];

interface ApprovalFormEditorProps {
  form: ApprovalForm;
  folders: ApprovalFolder[];
  org: any;
  onChange: (f: ApprovalForm) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
  saving: boolean;
  msg: string;
}

export function ApprovalFormEditor({
  form,
  folders,
  org,
  onChange,
  onSave,
  onCancel,
  onDelete,
  onDuplicate,
  saving,
  msg,
}: ApprovalFormEditorProps) {
  const { user } = useAuth();
  const { depts = [] } = org;
  const { data: jobTitles = [] } = useJobTitles();
  const { data: users = [] } = useUsers();
  const { data: rules = [] } = useRouteRules();

  // 상단 주 탭: 'design' (도구함 & 필드 속성) vs 'config' (서식 메타/보안/결재규칙)
  const [activeMainTab, setActiveMainTab] = useState<'design' | 'config'>('design');

  // 결재선 규칙(전결규정) 모달 표시 상태 (A4 직인란 클릭 또는 환경설정에서 오픈)
  const [showRouteRuleModal, setShowRouteRuleModal] = useState(false);

  // 현재 선택된 필드 인덱스 (기본값은 0번째 필드)
  const [selectedFieldKey, setSelectedFieldKey] = useState<string | null>(() => {
    return form.fields[0]?.key || null;
  });

  // 서식 필드가 변경되었을 때 선택된 필드 유효성 유지
  useEffect(() => {
    if (form.fields.length > 0) {
      const exists = form.fields.some((f) => f.key === selectedFieldKey);
      if (!exists) {
        setSelectedFieldKey(form.fields[0].key);
      }
    } else {
      setSelectedFieldKey(null);
    }
  }, [form.fields, selectedFieldKey]);

  const selectedFieldIdx = useMemo(() => {
    return form.fields.findIndex((f) => f.key === selectedFieldKey);
  }, [form.fields, selectedFieldKey]);

  const selectedField = selectedFieldIdx !== -1 ? form.fields[selectedFieldIdx] : null;

  // 디자이너 A4 캔버스용 더미 사용자 및 결재단계
  const dummyMe: User = useMemo(() => {
    if (user) return user;
    return {
      id: 'designer_dummy_user',
      empNo: 'WF-001',
      name: '홍길동',
      email: 'hong@workfit.local',
      dept: '기획운영팀',
      position: '대리',
      jobTitle: '기안담당',
      status: '사용',
      lastLogin: new Date().toISOString(),
      managerId: null,
      password: '',
      sealUrl: '',
      signUrl: '',
      signType: 'stamp',
      photoUrl: '',
      resignedAt: '',
      fcmToken: '',
    };
  }, [user]);

  const dummySteps: ApprovalStep[] = useMemo(
    () => [
      {
        seq: 1,
        approverId: dummyMe.id,
        kind: '결재',
        decision: '승인',
        parallelGroup: null,
        executionType: 'sequential',
        delegatedFromId: null,
        decidedAt: new Date().toISOString(),
        comment: '',
      },
      {
        seq: 2,
        approverId: 'dummy_team_lead',
        kind: '결재',
        decision: '대기',
        parallelGroup: null,
        executionType: 'sequential',
        delegatedFromId: null,
        decidedAt: null,
        comment: '',
      },
      {
        seq: 3,
        approverId: 'dummy_exec',
        kind: '전결',
        decision: '대기',
        parallelGroup: null,
        executionType: 'sequential',
        delegatedFromId: null,
        decidedAt: null,
        comment: '',
      },
    ],
    [dummyMe.id]
  );

  // 현재 서식 및 규칙에 따른 실시간 결재선 시뮬레이션 계산 (규칙 추가/수정 시 직인란 즉각 반영)
  const previewSteps: ApprovalStep[] = useMemo(() => {
    try {
      const res = resolveRoute({
        drafter: dummyMe,
        docType: form.code,
        amount: 3000000,
        users,
        depts,
        positions: org.positions || [],
        rules,
      });
      if (res.steps && res.steps.length > 0) {
        return res.steps;
      }
    } catch {
      // 규칙 매칭 오류 시 기본 폴백
    }
    return dummySteps;
  }, [dummyMe, form.code, users, depts, org.positions, rules, dummySteps]);

  const [previewValues, setPreviewValues] = useState<Record<string, FieldValue>>(() => {
    const initial: Record<string, FieldValue> = {};
    form.fields.forEach((f) => {
      if (f.type === '표' && f.placeholder) {
        initial[f.key] = f.placeholder;
      }
    });
    return initial;
  });

  // form.fields가 바뀌면(필드 추가/삭제, placeholder 갱신 등) 표 초기 데이터를 다시 동기화
  // 이렇게 해야 서식 편집 화면에서도 기안 작성 시와 동일한 표 구조가 표시됨
  const fieldsFingerprint = useMemo(
    () => form.fields.map((f) => `${f.key}:${f.type}:${f.placeholder || ''}`).join('|'),
    [form.fields]
  );

  useEffect(() => {
    const initial: Record<string, FieldValue> = {};
    form.fields.forEach((f) => {
      if (f.type === '표' && f.placeholder) {
        initial[f.key] = f.placeholder;
      }
    });
    // 표 필드는 항상 최신 placeholder로 덮어쓰되, 나머지 사용자 입력은 유지
    setPreviewValues((prev) => {
      const next = { ...prev };
      for (const [key, val] of Object.entries(initial)) {
        next[key] = val;
      }
      return next;
    });
  }, [form.id, fieldsFingerprint]);

  const setPreviewVals = (patch: Record<string, FieldValue>) => {
    setPreviewValues((prev) => ({ ...prev, ...patch }));
    // 표(Table) 필드의 경우 위지윅에서 디자인한 테이블 구조, 행, 열, 수식(cellFormulas)을
    // f.placeholder에 실시간 동기화하여 [서식 저장] 시 안전하게 영구 저장되도록 보장
    let fieldsChanged = false;
    const nextFields = form.fields.map((f) => {
      if (f.type === '표' && patch[f.key] !== undefined) {
        fieldsChanged = true;
        return { ...f, placeholder: String(patch[f.key]) };
      }
      return f;
    });
    if (fieldsChanged) {
      onChange({ ...form, fields: nextFields });
    }
  };

  const formRulesCount = useMemo(() => {
    return rules.filter(
      (r) => r.formId === form.id || (r.formId === null && r.docType === form.code)
    ).length;
  }, [rules, form.id, form.code]);

  const set = (patch: Partial<ApprovalForm>) => onChange({ ...form, ...patch });

  const setField = (i: number, patch: Partial<FormField>) => {
    let nextFields = form.fields.map((f, idx) => (idx === i ? { ...f, ...patch } : f));
    if (patch.isTabSelector) {
      nextFields = nextFields.map((f, idx) => (idx === i ? f : { ...f, isTabSelector: false }));
    }
    set({ fields: nextFields });
  };

  // 컴포넌트 팔레트에서 클릭하여 새 필드 추가
  const handleAddPaletteField = (item: (typeof COMPONENT_PALETTE)[0]) => {
    const newKey = item.key || `field_${Date.now().toString(36).slice(-4)}`;
    const newField: FormField = {
      ...blankField(),
      key: newKey,
      label: item.defaultLabel,
      type: item.type,
      width: item.defaultWidth,
      isAmountKey: item.isAmountKey ?? false,
      options: item.options ? [...item.options] : [],
    };

    set({ fields: [...form.fields, newField] });
    setSelectedFieldKey(newKey);
  };

  const delField = (i: number) => {
    const nextFields = form.fields.filter((_, idx) => idx !== i);
    set({ fields: nextFields });
    if (nextFields.length > 0) {
      const nextIdx = Math.min(i, nextFields.length - 1);
      setSelectedFieldKey(nextFields[nextIdx].key);
    } else {
      setSelectedFieldKey(null);
    }
  };

  const moveField = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= form.fields.length) return;
    const next = [...form.fields];
    [next[i], next[j]] = [next[j], next[i]];
    set({ fields: next });
  };

  return (
    <div className="space-y-3">
      {/* 1. 상단 네비게이션 헤더 바 */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-panel px-4 py-2.5 shadow-xs">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-panel-alt px-3 py-1.5 text-[12px] font-bold text-ink2 hover:bg-border/30 hover:text-ink transition-colors cursor-pointer"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>서식 목록</span>
          </button>

          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-panel-alt text-[18px] border border-border/50 shadow-xs">
              {form.icon || '📄'}
            </span>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-[14px] font-bold text-ink">
                  {form.id ? `${form.name}` : '새 결재서식 디자인'}
                </span>
                <span className="rounded bg-teal-soft px-1.5 py-0.2 font-mono text-[10px] font-bold text-teal">
                  {form.code || '신규'}
                </span>
                {form.system && (
                  <span className="rounded bg-ink3/10 px-1.5 py-0.2 text-[9px] font-extrabold text-ink3">
                    시스템 기본
                  </span>
                )}
              </div>
              <span className="text-[10.5px] text-ink3">
                서식 편집 · 실시간 WYSIWYG A4 공문서 캔버스
              </span>
            </div>
          </div>
        </div>

        {/* 상단 우측 제어 액션 버튼군 */}
        <div className="flex items-center gap-2.5">
          {onDuplicate && form.id && (
            <button
              type="button"
              onClick={onDuplicate}
              className="rounded-lg border border-border bg-panel-alt px-3 py-1.5 text-[11.5px] font-semibold text-ink2 hover:bg-border/30 transition-colors cursor-pointer"
            >
              서식 복사
            </button>
          )}

          <label className="flex items-center gap-1.5 text-[11.5px] font-semibold text-ink2 cursor-pointer mr-1">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => set({ active: e.target.checked })}
              className="text-teal focus:ring-teal h-3.5 w-3.5 rounded"
            />
            <span>사용</span>
          </label>

          {onDelete && form.id && !form.system && (
            <button
              type="button"
              onClick={onDelete}
              className="rounded-lg border border-red-500/20 px-3 py-1.5 text-[11.5px] font-semibold text-red-500 hover:bg-red-500/5 transition-colors cursor-pointer"
            >
              삭제
            </button>
          )}

          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-border bg-panel px-3.5 py-1.5 text-[12px] font-semibold text-ink2 hover:bg-panel-alt cursor-pointer"
          >
            취소
          </button>

          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-lg bg-teal px-4 py-1.5 text-[12px] font-bold text-white shadow-xs hover:opacity-90 disabled:opacity-50 cursor-pointer"
          >
            <Save className="h-3.5 w-3.5" />
            <span>{saving ? '저장 중...' : '서식 저장'}</span>
          </button>
        </div>
      </div>

      {msg && (
        <div
          className={`rounded-lg px-4 py-2.5 text-[12px] font-bold border transition-all ${
            msg.includes('오류') || msg.includes('실패')
              ? 'bg-red-500/10 border-red-500/30 text-red-600 dark:text-red-400'
              : 'bg-teal-soft/70 border-teal/30 text-teal'
          }`}
        >
          {msg}
        </div>
      )}

      {/* 2. 본문 2-패널 스플릿 뷰 (좌측 도구함/속성 370px + 우측 A4 캔버스) */}
      <div className="grid grid-cols-1 xl:grid-cols-[370px_1fr] gap-3.5 items-start">
        {/* 좌측 패널: [도구함 & 필드 속성] */}
        <div className="flex flex-col rounded-xl border border-border bg-panel p-3.5 space-y-3.5">
          {/* 패널 상단 모드 전환 탭 (디자인 모드 vs 서식 환경설정) */}
          <div className="flex rounded-lg border border-border bg-panel-alt p-0.5 text-[11.5px]">
            <button
              type="button"
              onClick={() => setActiveMainTab('design')}
              className={`flex-1 py-1.5 font-bold rounded-md transition-all flex items-center justify-center gap-1.5 ${
                activeMainTab === 'design'
                  ? 'bg-panel text-teal shadow-xs'
                  : 'text-ink3 hover:text-ink'
              }`}
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>도구함 & 필드 속성</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveMainTab('config')}
              className={`flex-1 py-1.5 font-bold rounded-md transition-all flex items-center justify-center gap-1.5 ${
                activeMainTab === 'config'
                  ? 'bg-panel text-teal shadow-xs'
                  : 'text-ink3 hover:text-ink'
              }`}
            >
              <Settings className="h-3.5 w-3.5" />
              <span>서식 환경설정 ({formRulesCount})</span>
            </button>
          </div>

          {/* 1. 디자인 모드: [필드 컴포넌트 라이브러리] + [선택된 필드 속성] */}
          {activeMainTab === 'design' && (
            <div className="space-y-3">
              {/* 1-1. ┌ 필드 컴포넌트 라이브러리 ┐ */}
              <div className="rounded-xl border border-border bg-panel-alt/40 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11.5px] font-bold text-ink flex items-center gap-1.5">
                    <span>┌ 필드 컴포넌트 라이브러리 ┐</span>
                  </span>
                  <span className="text-[10px] text-teal font-semibold">클릭 시 즉시 추가</span>
                </div>

                <div className="grid grid-cols-2 gap-1.5">
                  {COMPONENT_PALETTE.map((comp) => (
                    <button
                      key={comp.label}
                      type="button"
                      onClick={() => handleAddPaletteField(comp)}
                      className="flex items-center gap-2 rounded-lg border border-border/80 bg-panel px-2.5 py-1.5 text-left hover:border-teal hover:bg-teal-soft/30 hover:text-teal transition-all group cursor-pointer shadow-2xs"
                    >
                      <span className="text-[15px] shrink-0">{comp.icon}</span>
                      <div className="min-w-0">
                        <div className="text-[11px] font-bold text-ink group-hover:text-teal truncate">
                          {comp.label}
                        </div>
                        <div className="text-[9.5px] text-ink3 truncate">{comp.desc}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* 1-2. 현재 서식 필드 선택 칩 네비게이션 */}
              <div className="rounded-xl border border-border bg-panel p-2.5 space-y-1.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-bold text-ink">
                    서식 필드 목록 ({form.fields.length}개)
                  </span>
                  <span className="text-[9.5px] text-ink3">A4 캔버스에서 클릭해도 선택됨</span>
                </div>

                {form.fields.length === 0 ? (
                  <div className="py-2 text-center text-[10.5px] text-ink3">
                    위 도구함에서 컴포넌트를 클릭하여 필드를 추가하세요.
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1 max-h-[80px] overflow-y-auto p-0.5">
                    {form.fields.map((f, i) => {
                      const isSel = selectedFieldKey === f.key;
                      return (
                        <button
                          key={f.key || i}
                          type="button"
                          onClick={() => setSelectedFieldKey(f.key)}
                          className={`flex items-center gap-1 rounded-md px-2 py-1 text-[10.5px] font-semibold transition-all border cursor-pointer ${
                            isSel
                              ? 'bg-teal-soft border-teal text-teal font-extrabold shadow-2xs'
                              : 'bg-panel-alt border-border/70 text-ink2 hover:bg-border/30'
                          }`}
                        >
                          <span className="font-mono text-[9px] text-ink3">#{i + 1}</span>
                          <span className="truncate max-w-[80px]">{f.label || f.key}</span>
                          {f.required && <span className="text-red-500 font-bold">*</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* 1-3. ┌ 선택된 필드 속성 ┐ (Field Property Inspector) */}
              {selectedField ? (
                <div className="rounded-xl border-2 border-teal/40 bg-panel p-3 space-y-2.5 shadow-xs">
                  <div className="flex items-center justify-between border-b border-border/80 pb-2">
                    <div className="flex items-center gap-1.5">
                      <span className="flex h-5 w-5 items-center justify-center rounded bg-teal text-white text-[10px] font-bold">
                        #{selectedFieldIdx + 1}
                      </span>
                      <span className="text-[12px] font-bold text-ink">
                        ┌ 선택된 필드 속성 ┐
                      </span>
                    </div>

                    {/* 필드 순서 이동 및 삭제 액션 */}
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => moveField(selectedFieldIdx, -1)}
                        className="rounded p-1 text-ink3 hover:bg-panel-alt hover:text-ink cursor-pointer"
                        title="위로 이동"
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveField(selectedFieldIdx, 1)}
                        className="rounded p-1 text-ink3 hover:bg-panel-alt hover:text-ink cursor-pointer"
                        title="아래로 이동"
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => delField(selectedFieldIdx)}
                        className="rounded p-1 text-ink3 hover:bg-red-500/10 hover:text-red-500 cursor-pointer ml-1"
                        title="필드 삭제"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2 text-[11.5px]">
                    <div className="grid grid-cols-2 gap-2">
                      <F label="라벨명 (한글 표기)">
                        <input
                          value={selectedField.label}
                          onChange={(e) =>
                            setField(selectedFieldIdx, { label: e.target.value })
                          }
                          placeholder="예: 기안내용"
                          className={inp}
                        />
                      </F>
                      <F label="필드 키 (영문 Key)">
                        <input
                          value={selectedField.key}
                          onChange={(e) => {
                            const newKey = e.target.value;
                            setField(selectedFieldIdx, { key: newKey });
                            setSelectedFieldKey(newKey);
                          }}
                          onBlur={(e) => {
                            if (!e.target.value.trim()) {
                              const fallbackKey = `field_${selectedFieldIdx + 1}_${Date.now().toString(36).slice(-4)}`;
                              setField(selectedFieldIdx, { key: fallbackKey });
                              setSelectedFieldKey(fallbackKey);
                            }
                          }}
                          placeholder="예: body"
                          className={`${inp} font-mono`}
                        />
                      </F>
                    </div>

                    <div className="grid grid-cols-2 gap-2 items-center">
                      <F label="너비 (A4 배치)">
                        <div className="flex rounded-md border border-border bg-panel-alt p-0.5">
                          <button
                            type="button"
                            onClick={() =>
                              setField(selectedFieldIdx, { width: 'full' })
                            }
                            className={`flex-1 py-1 text-[10.5px] font-semibold rounded ${
                              selectedField.width === 'full'
                                ? 'bg-panel font-bold text-teal shadow-2xs'
                                : 'text-ink3'
                            }`}
                          >
                            100% (전체)
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setField(selectedFieldIdx, { width: 'half' })
                            }
                            className={`flex-1 py-1 text-[10.5px] font-semibold rounded ${
                              selectedField.width === 'half'
                                ? 'bg-panel font-bold text-teal shadow-2xs'
                                : 'text-ink3'
                            }`}
                          >
                            50% (절반)
                          </button>
                        </div>
                      </F>

                      <F label="입력 유형">
                        <select
                          value={selectedField.type}
                          onChange={(e) =>
                            setField(selectedFieldIdx, {
                              type: e.target.value as FieldType,
                            })
                          }
                          className={inp}
                        >
                          {FIELD_TYPES.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                      </F>
                    </div>

                    <F label="안내 문구 (Placeholder)">
                      <input
                        value={selectedField.placeholder || ''}
                        onChange={(e) =>
                          setField(selectedFieldIdx, { placeholder: e.target.value })
                        }
                        placeholder="입력 힌트 문구"
                        className={inp}
                      />
                    </F>

                    {/* 체크박스 옵션 행 */}
                    <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-border/60">
                      <label className="flex items-center gap-1.5 cursor-pointer text-ink font-semibold">
                        <input
                          type="checkbox"
                          checked={selectedField.required}
                          onChange={(e) =>
                            setField(selectedFieldIdx, { required: e.target.checked })
                          }
                          className="text-teal focus:ring-teal h-3.5 w-3.5 rounded"
                        />
                        <span>필수 입력</span>
                      </label>

                      <label
                        className="flex items-center gap-1.5 cursor-pointer text-ink3 hover:text-ink"
                        title="금액 조건 결재선 자동 규칙 매칭에 사용"
                      >
                        <input
                          type="checkbox"
                          checked={selectedField.isAmountKey ?? false}
                          onChange={(e) =>
                            setField(selectedFieldIdx, {
                              isAmountKey: e.target.checked,
                            })
                          }
                          className="text-teal focus:ring-teal h-3.5 w-3.5 rounded"
                        />
                        <span>금액키</span>
                      </label>

                      <label
                        className="flex items-center gap-1.5 cursor-pointer text-ink3 hover:text-ink"
                        title="열람 권한에 따라 텍스트 마스킹 처리"
                      >
                        <input
                          type="checkbox"
                          checked={selectedField.isSecret ?? false}
                          onChange={(e) =>
                            setField(selectedFieldIdx, {
                              isSecret: e.target.checked,
                            })
                          }
                          className="text-teal focus:ring-teal h-3.5 w-3.5 rounded"
                        />
                        <span>보안 필드</span>
                      </label>
                    </div>

                    {/* '선택' 타입일 때 세부 옵션 */}
                    {selectedField.type === '선택' && (
                      <div className="pt-1.5 border-t border-border/60">
                        <span className="block text-[10.5px] font-semibold text-ink3 mb-1">
                          선택지 목록 (콤마로 구분)
                        </span>
                        <OptionsInput
                          value={selectedField.options || []}
                          onChange={(opts) =>
                            setField(selectedFieldIdx, { options: opts })
                          }
                        />
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-border bg-panel-alt/30 p-6 text-center text-[11.5px] text-ink3 space-y-1">
                  <MousePointerClick className="mx-auto h-6 w-6 text-teal opacity-60 mb-1" />
                  <p className="font-bold text-ink2">선택된 필드가 없습니다.</p>
                  <p>
                    상단 도구함에서 컴포넌트를 클릭하거나,
                    <br />
                    우측 A4 캔버스에서 편집할 필드를 클릭하세요.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* 2. 서식 환경설정 탭 (기본 메타, 보안, 결재규칙) */}
          {activeMainTab === 'config' && (
            <div className="space-y-3.5 overflow-y-auto max-h-[calc(100vh-210px)] pr-1 text-[11.5px]">
              <div className="rounded-lg border border-border bg-panel-alt/40 p-3 space-y-2.5">
                <div className="font-bold text-ink text-[12px]">서식 기본 정보</div>
                <div className="grid grid-cols-2 gap-2">
                  <F label="서식 아이콘">
                    <input
                      value={form.icon}
                      onChange={(e) => set({ icon: e.target.value })}
                      className={inp}
                      placeholder="📄"
                    />
                  </F>
                  <F label="서식명">
                    <input
                      value={form.name}
                      onChange={(e) => set({ name: e.target.value })}
                      className={inp}
                      placeholder="출장신청서"
                    />
                  </F>
                  <F label="문서유형 코드">
                    <input
                      value={form.code}
                      onChange={(e) => set({ code: e.target.value })}
                      className={inp}
                      placeholder="출장"
                    />
                  </F>
                  <F label="소속 폴더">
                    <select
                      value={form.folderId || ''}
                      onChange={(e) => set({ folderId: e.target.value || null })}
                      className={inp}
                    >
                      <option value="">루트 (미지정)</option>
                      {folders.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                  </F>
                  <F label="정렬 순서">
                    <input
                      type="number"
                      value={form.order}
                      onChange={(e) => set({ order: Number(e.target.value) })}
                      className={inp}
                    />
                  </F>
                  <F label="보존연한">
                    <select
                      value={form.preservationPeriod || '5년'}
                      onChange={(e) =>
                        set({ preservationPeriod: e.target.value })
                      }
                      className={inp}
                    >
                      <option value="1년">1년</option>
                      <option value="3년">3년</option>
                      <option value="5년">5년</option>
                      <option value="10년">10년</option>
                      <option value="영구">영구</option>
                    </select>
                  </F>
                </div>
              </div>

              {/* 격식명 및 맺음말 설정 */}
              <div className="rounded-lg border border-border bg-panel-alt/40 p-3 space-y-2">
                <div className="font-bold text-ink text-[12px]">인쇄 및 격식 문구</div>
                <F label="격식 문서명 (A4 상단 대형 타이틀)">
                  <input
                    value={form.docTitle}
                    onChange={(e) => set({ docTitle: e.target.value })}
                    placeholder="출 장 신 청 서"
                    className={inp}
                  />
                </F>
                <F label="맺음말 (A4 하단 격식 문구)">
                  <input
                    value={form.closing}
                    onChange={(e) => set({ closing: e.target.value })}
                    placeholder="위와 같이 신청하오니 재가하여 주시기 바랍니다."
                    className={inp}
                  />
                </F>
              </div>

              {/* 기안 권한 및 보안 설정 */}
              <FormPermissionSettings
                form={form}
                org={org}
                users={users}
                jobTitles={jobTitles}
                onChange={set}
              />

              {/* 기본 수신/참조 대상 */}
              <FormTargetSelector
                title="기본 수신 대상"
                desc="결재 완료 후 본 문서가 기본 수신되는 부서/사용자"
                deptId={form.recipientDeptId}
                userId={form.recipientUserId}
                depts={depts}
                users={users}
                org={org}
                onChange={(patch) =>
                  set({
                    recipientDeptId: patch.deptId ?? null,
                    recipientUserId: patch.userId ?? null,
                  })
                }
              />

              <FormTargetSelector
                title="기본 참조 대상"
                desc="기안 상신 즉시 실시간으로 참조 열람할 부서/사용자"
                deptId={form.referenceDeptId}
                userId={form.referenceUserId}
                depts={depts}
                users={users}
                org={org}
                onChange={(patch) =>
                  set({
                    referenceDeptId: patch.deptId ?? null,
                    referenceUserId: patch.userId ?? null,
                  })
                }
              />

              {/* 결재선 규칙 모달 바로가기 카드 (스크롤 제로 달성) */}
              {form.id && (
                <div className="rounded-xl border border-border bg-panel p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-[12.5px] font-bold text-ink">결재선(전결) 규칙 설정</div>
                      <div className="text-[10.5px] text-ink3 mt-0.5">
                        등록된 서식 전용 규칙: <span className="text-teal font-bold">{formRulesCount}개</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowRouteRuleModal(true)}
                      className="flex items-center gap-1.5 rounded-lg bg-teal-soft px-3 py-1.5 text-[11.5px] font-bold text-teal hover:bg-teal hover:text-white transition-colors cursor-pointer"
                    >
                      <SlidersHorizontal className="h-3.5 w-3.5" />
                      <span>규칙 설정 모달 열기</span>
                    </button>
                  </div>
                  <p className="text-[11px] text-ink3 leading-relaxed">
                    A4 캔버스 상단의 결재 직인란을 클릭하거나 위 버튼을 눌러 결재선 규칙을 편집할 수 있습니다.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 우측 패널: [실시간 A4 공문서 캔버스] (기안 화면과 100% 동일한 #878d90 작업대 배경) */}
        <div className="flex flex-col rounded-xl border border-border/80 bg-[#878d90] dark:bg-[#878d90] p-3.5 overflow-hidden shadow-sm">
          {/* 캔버스 상단 툴바 */}
          <div className="mb-2.5 flex items-center justify-between border-b border-white/10 pb-2 px-2">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-teal text-white text-[11px] font-bold">
                A4
              </span>
              <span className="text-[12px] font-bold text-white">
                A4 공문서 캔버스
              </span>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-slate-300">
              <button
                type="button"
                onClick={() => window.print()}
                className="flex items-center gap-1 rounded border border-white/20 bg-panel/80 px-2.5 py-1 text-[11px] font-semibold text-ink hover:bg-panel transition-colors cursor-pointer"
              >
                <Printer className="h-3 w-3" />
                인쇄 규격
              </button>
            </div>
          </div>

          {/* A4 용지 작업대 (회색 배경 위 백색 시트) */}
          <div className="overflow-y-auto max-h-[calc(100vh-200px)] flex justify-center py-4 px-2">
            <div className="w-full max-w-[820px] shrink-0 bg-white dark:bg-panel shadow-xl rounded-sm border border-border/80 p-8 min-h-[1100px]">
              <ApprovalDraftDocumentSheet
                form={form}
                docCode={form.code || '기안'}
                me={dummyMe}
                title={form.name ? `${form.name} 기안 예시` : '문서 제목'}
                setTitle={() => {}}
                values={previewValues}
                setVals={setPreviewVals}
                amount="3,000,000"
                setAmount={() => {}}
                securityLevel={form.securityLevel || '일반'}
                setSecurityLevel={(v) => set({ securityLevel: v })}
                visibility={form.visibility === '비공개' ? '비공개' : '부서'}
                setVisibility={(v) => set({ visibility: v })}
                preservationPeriod={form.preservationPeriod || '5년'}
                setPreservationPeriod={(v) => set({ preservationPeriod: v })}
                isPostApproval={false}
                setIsPostApproval={() => {}}
                isPostApprovalSystemEnabled={false}
                postApprovedBy=""
                setPostApprovedBy={() => {}}
                postApprovalActionTaken=""
                setPostApprovalActionTaken={() => {}}
                postApprovalNecessity=""
                setPostApprovalNecessity={() => {}}
                steps={previewSteps}
                recipients={[]}
                attachments={[]}
                setAttachments={() => {}}
                attachmentRetention="5년"
                setAttachmentRetention={() => {}}
                relatedDocs={[]}
                setRelatedDocs={() => {}}
                setShowRelatedModal={() => {}}
                onFileUpload={async () => {}}
                uploading={false}
                editDocNo="AP-PREVIEW-001"
                isDesignMode={true}
                selectedFieldKey={selectedFieldKey}
                onSelectFieldKey={(key) => {
                  setSelectedFieldKey(key);
                  setActiveMainTab('design');
                }}
                onUpdateDocTitle={(newTitle) => set({ docTitle: newTitle })}
                onUpdateClosing={(newClosing) => set({ closing: newClosing })}
                onStampTableClick={() => setShowRouteRuleModal(true)}
              />
            </div>
          </div>
        </div>
      </div>

      {/* 결재선 규칙 팝업 모달 */}
      <ApprovalRouteRuleModal
        isOpen={showRouteRuleModal}
        onClose={() => setShowRouteRuleModal(false)}
        form={form}
        org={org}
      />
    </div>
  );
}
