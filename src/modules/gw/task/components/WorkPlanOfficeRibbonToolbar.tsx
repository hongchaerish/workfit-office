import { useState, useEffect, useRef } from 'react';
import type { CalendarEvent } from '@/domain/calendarEvent/schema';
import type { User } from '@/domain/user/schema';
import { useWorkPlanConfig, stripMarkdownAndTags } from '@/features/workPlan/useWorkPlanConfig';
import { WorkPlanConfigModal } from './WorkPlanConfigModal';
import {
  CheckSquare,
  Sparkles,
  Trash2,
  ChevronDown,
  Settings,
  Save,
  X,
  FileSpreadsheet,
  AlertTriangle,
  Copy,
} from 'lucide-react';

export interface WorkPlanOfficeRibbonToolbarProps {
  dateTitle: string;
  targetUser?: User;
  actor: User;
  content: string;
  onContentChange: (next: string | ((prev: string) => string)) => void;
  shareToCalendar?: boolean;
  onShareToCalendarChange?: (next: boolean) => void;
  todayEvents?: CalendarEvent[];
  isSaving: boolean;
  conflictError: string | null;
  onSave: (forceOverwrite?: boolean) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
}

export function WorkPlanOfficeRibbonToolbar({
  dateTitle,
  targetUser,
  actor,
  content,
  onContentChange,
  isSaving,
  conflictError,
  onSave,
  onDelete,
  onClose,
}: WorkPlanOfficeRibbonToolbarProps) {
  const [configModalTab, setConfigModalTab] = useState<'templates' | 'tags' | null>(null);
  const [showTemplateMenu, setShowTemplateMenu] = useState(false);

  const templateMenuRef = useRef<HTMLDivElement>(null);

  const { templates } = useWorkPlanConfig();

  // 바깥 클릭 시 메뉴 닫기
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (templateMenuRef.current && !templateMenuRef.current.contains(e.target as Node)) {
        setShowTemplateMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // [📋 - 체크박스 할 일 추가]
  const handleAddTodoItem = () => {
    onContentChange((prev) => {
      const trimmed = prev.trimEnd();
      const newLine = '- ';
      return trimmed ? `${trimmed}\n${newLine}` : newLine;
    });
  };

  // [✨ 루틴 템플릿 적용]
  const handleApplyTemplate = (tplContent: string) => {
    const cleanContent = stripMarkdownAndTags(tplContent);

    onContentChange((prev) => {
      const trimmed = prev.trimEnd();
      return trimmed ? `${trimmed}\n${cleanContent}` : cleanContent;
    });
    setShowTemplateMenu(false);
  };

  const isOtherUser = targetUser && targetUser.id !== actor.id;

  return (
    <div
      data-workplan-ribbon="true"
      onMouseDown={(e) => {
        // 상단 메뉴나 버튼 클릭 시 셀 내의 텍스트창 포커스가 풀려 닫히는 현상 방지
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT') return;
        e.preventDefault();
      }}
      className="sticky top-0 z-30 mb-2 rounded-xl border border-teal/40 bg-panel shadow-md overflow-visible animate-in slide-in-from-top-2 duration-150"
    >
      {/* ── 오피스 엑셀/한글 스타일 리본 메뉴 바 ── */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 border-b border-border bg-slate-50/90 dark:bg-panel-alt/80">
        <div className="flex flex-wrap items-center gap-1.5">
          {/* 선택된 칸 안내 배지 */}
          <div className="flex items-center gap-1.5 rounded-lg border border-teal/30 bg-teal-soft/20 px-2.5 py-1 text-[11px] font-extrabold text-teal mr-1 shadow-2xs">
            <FileSpreadsheet size={13} />
            <span>{dateTitle}</span>
            {isOtherUser && (
              <span className="rounded bg-amber-500/20 px-1 py-0.2 text-[9px] font-bold text-amber-700 dark:text-amber-300">
                {targetUser.name} 대리작성
              </span>
            )}
          </div>

          <div className="h-4 w-px bg-border mx-0.5" />

          {/* 1) 📋 - 체크박스 할 일 삽입 버튼 */}
          <button
            type="button"
            onClick={handleAddTodoItem}
            className="flex items-center gap-1.5 rounded-lg border border-teal/40 bg-panel px-2.5 py-1 text-[11px] font-bold text-teal hover:bg-teal-soft/30 transition-all cursor-pointer shadow-2xs"
            title="칸 안에 '- 체크박스 할 일' 항목을 삽입합니다."
          >
            <CheckSquare size={12} className="text-teal" />
            <span>- 체크박스 할 일 추가</span>
          </button>

          {/* 2) ✨ 자주 쓰는 루틴 템플릿 드롭다운 */}
          <div className="relative" ref={templateMenuRef}>
            <button
              type="button"
              onClick={() => setShowTemplateMenu((prev) => !prev)}
              className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-bold transition-all cursor-pointer shadow-2xs ${
                showTemplateMenu
                  ? 'border-amber-500 bg-amber-500 text-white'
                  : 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400 hover:bg-amber-500/20'
              }`}
              title="자주 쓰는 업무 루틴 템플릿 삽입"
            >
              <Sparkles size={12} className={showTemplateMenu ? 'text-white' : 'text-amber-500'} />
              <span>루틴 템플릿</span>
              <ChevronDown size={11} className={showTemplateMenu ? 'rotate-180 transition-transform' : 'transition-transform'} />
            </button>

            {showTemplateMenu && (
              <div className="absolute left-0 top-8 z-50 w-72 rounded-xl border border-amber-500/30 bg-panel p-2.5 shadow-xl space-y-2 animate-in fade-in slide-in-from-top-1 duration-150">
                <div className="flex items-center justify-between border-b border-border pb-1.5">
                  <div className="text-[11.5px] font-bold text-ink flex items-center gap-1">
                    <Sparkles size={12} className="text-amber-500" />
                    <span>루틴 템플릿 선택</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowTemplateMenu(false);
                      setConfigModalTab('templates');
                    }}
                    className="flex items-center gap-1 text-[10px] font-semibold text-amber-600 hover:underline cursor-pointer"
                  >
                    <Settings size={11} />
                    <span>관리</span>
                  </button>
                </div>
                <div className="max-h-48 overflow-y-auto space-y-1">
                  {templates.length === 0 ? (
                    <div className="py-3 text-center text-[10.5px] text-ink3">
                      등록된 템플릿이 없습니다.
                    </div>
                  ) : (
                    templates.map((tpl) => (
                      <button
                        key={tpl.id}
                        type="button"
                        onClick={() => handleApplyTemplate(tpl.content)}
                        className="w-full text-left flex items-center justify-between rounded-lg p-1.5 hover:bg-amber-500/10 transition-colors group cursor-pointer"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-[11px] font-bold text-ink truncate group-hover:text-amber-600">
                            {tpl.icon} {tpl.name}
                          </div>
                          {tpl.desc && (
                            <div className="text-[9.5px] text-ink3 truncate">{tpl.desc}</div>
                          )}
                        </div>
                        <span className="shrink-0 text-[10px] font-bold text-amber-600 ml-1">삽입</span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 우측 액션: 삭제 및 닫기 */}
        <div className="flex items-center gap-1.5 ml-auto">
          {onDelete && content && (
            <button
              type="button"
              onClick={onDelete}
              disabled={isSaving}
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-rose-500 hover:bg-rose-500/10 transition-colors cursor-pointer disabled:opacity-50"
              title="이 날의 계획 전체 삭제"
            >
              <Trash2 size={12} />
              <span>삭제</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => onSave(false)}
            disabled={isSaving}
            className="rounded-lg bg-teal px-2.5 py-1 text-[11px] font-bold text-white hover:bg-teal-dark transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1 shadow-2xs"
            title="저장"
          >
            <Save size={12} />
            <span>{isSaving ? '저장 중…' : '저장'}</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            className="grid h-6 w-6 place-items-center rounded-lg text-ink3 hover:text-ink hover:bg-panel-alt transition-colors cursor-pointer ml-0.5"
            title="닫기"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* 동시 수정 충돌(OCC) 경고 배너 */}
      {conflictError && (
        <div className="border-b border-amber-500/30 bg-amber-500/10 px-3.5 py-2 space-y-1.5 animate-in fade-in">
          <div className="flex items-start gap-2 text-amber-900 dark:text-amber-200">
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="space-y-0.5 text-[11px] leading-relaxed">
              <p className="font-extrabold text-[11.5px]">⚠️ 동시 수정 충돌 감지 (작성 데이터 보호됨)</p>
              <p>{conflictError}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-[10.5px]">
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(content);
                alert('내용이 클립보드에 복사되었습니다.');
              }}
              className="flex items-center gap-1 rounded border border-amber-500/40 bg-panel px-2 py-0.5 font-bold text-amber-700 dark:text-amber-300 hover:bg-amber-500/10 transition-colors cursor-pointer"
            >
              <Copy size={10} />
              <span>내용 복사</span>
            </button>
            <button
              type="button"
              onClick={() => onSave(true)}
              disabled={isSaving}
              className="rounded bg-amber-600 px-2.5 py-0.5 font-bold text-white hover:bg-amber-700 transition-colors cursor-pointer disabled:opacity-50"
            >
              {isSaving ? '저장 중…' : '현재 작성본으로 저장 진행'}
            </button>
          </div>
        </div>
      )}

      <WorkPlanConfigModal
        isOpen={Boolean(configModalTab)}
        onClose={() => setConfigModalTab(null)}
        defaultTab={configModalTab ?? 'templates'}
      />
    </div>
  );
}
