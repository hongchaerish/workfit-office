import { useState, useMemo, useEffect, useRef } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { Button } from '@/shared/ui/Button';
import {
  parseWorkPlanItems,
  calculatePlanProgress,
  toggleWorkPlanItem,
  getWorkPlanTagMeta,
} from '@/domain/workPlan/engine';
import { useWorkPlanConfig } from '@/features/workPlan/useWorkPlanConfig';
import { useAuth } from '@/app/auth/AuthProvider';
import { WorkPlanConfigModal } from './WorkPlanConfigModal';
import {
  CheckSquare,
  Sparkles,
  CheckCircle2,
  Plus,
  AlertCircle,
  AlertTriangle,
  Copy,
  ChevronDown,
  Settings,
  HelpCircle,
} from 'lucide-react';

interface WorkPlanEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  date?: string;
  dateTitle: string;
  initialContent: string;
  loadedUpdatedAt?: string;
  todayEvents?: any[];
  onSave: (content: string, shareToCalendar?: boolean, forceOverwrite?: boolean) => Promise<void>;
  onDelete?: () => Promise<void>;
}

export function WorkPlanEditorModal({
  isOpen,
  onClose,
  dateTitle,
  initialContent,
  onSave,
  onDelete,
}: WorkPlanEditorModalProps) {
  const { user } = useAuth();
  const [content, setContent] = useState(initialContent);
  const [isSaving, setIsSaving] = useState(false);
  const [configModalTab, setConfigModalTab] = useState<'templates' | 'tags' | null>(null);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);
  const [conflictError, setConflictError] = useState<string | null>(null);
  const [showTemplateMenu, setShowTemplateMenu] = useState(false);
  const templateMenuRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { templates, tagMap } = useWorkPlanConfig();

  // 모달 열릴 때 초기 내용 동기화
  useEffect(() => {
    setContent(initialContent);
  }, [initialContent, isOpen]);

  // 드롭다운 바깥 클릭 시 닫기
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (templateMenuRef.current && !templateMenuRef.current.contains(e.target as Node)) {
        setShowTemplateMenu(false);
      }
    };
    if (showTemplateMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showTemplateMenu]);

  // 알림 메시지 자동 소멸
  useEffect(() => {
    if (!noticeMessage) return;
    const timer = setTimeout(() => setNoticeMessage(null), 3500);
    return () => clearTimeout(timer);
  }, [noticeMessage]);

  const parsedItems = useMemo(() => parseWorkPlanItems(content), [content]);
  const progress = useMemo(() => calculatePlanProgress(content), [content]);

  // 체크박스 할 일 라인 추가 (- [ ] )
  const handleInsertTodoPrefix = () => {
    setContent((prev) => {
      const trimmed = prev.trimEnd();
      return trimmed ? `${trimmed}\n- ` : '- ';
    });
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
      }
    }, 50);
  };

  // 템플릿 적용
  const handleApplyTemplate = (tplContent: string) => {
    setContent((prev) => {
      const trimmed = prev.trim();
      return trimmed ? `${trimmed}\n${tplContent}` : tplContent;
    });
    setNoticeMessage('템플릿을 추가했습니다.');
  };

  // 개별 아이템 완료 토글 (미리보기 카드에서 클릭 지원)
  const handleToggle = (idx: number) => {
    setContent((prev) => toggleWorkPlanItem(prev, idx));
  };

  // 최종 저장
  const handleSave = async (forceOverwrite = false) => {
    setIsSaving(true);
    setConflictError(null);
    try {
      if (!content.trim()) {
        if (onDelete && initialContent) {
          await onDelete();
        } else {
          await onSave('', false, forceOverwrite);
        }
      } else {
        await onSave(content.trim(), false, forceOverwrite);
      }
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      if (
        msg.includes('먼저 수정') ||
        msg.includes('먼저 등록') ||
        (err as { code?: string })?.code === 'CONFLICT'
      ) {
        setConflictError(
          msg || '다른 사용자가 방금 이 계획을 먼저 수정했습니다. 작성 중인 내용을 안전하게 보존했습니다.',
        );
      } else {
        alert(msg || '저장 중 오류가 발생했습니다.');
      }
    } finally {
      setIsSaving(false);
    }
  };

  // 전체 삭제
  const handleDelete = async () => {
    if (!onDelete) return;
    if (!window.confirm('이 날짜의 업무계획을 삭제하시겠습니까?')) return;
    setIsSaving(true);
    try {
      await onDelete();
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <Modal
        open={isOpen}
        onClose={onClose}
        title={`${dateTitle} · 업무계획 작성`}
        width={680}
      >
        <div className="space-y-4">
          {/* 상단 툴바: 작성 도구 안내 + 할일 추가 버튼 + 루틴 템플릿 */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2.5">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleInsertTodoPrefix}
                className="flex items-center gap-1.5 rounded-lg border border-teal/40 bg-teal-soft/40 px-3 py-1.5 text-[11.5px] font-bold text-teal hover:bg-teal hover:text-white transition-all cursor-pointer shadow-2xs"
                title="줄 앞에 '-' 기호를 붙여 체크박스 할 일을 추가합니다."
              >
                <Plus size={13} />
                <span>체크박스 할 일 추가 (- )</span>
              </button>
            </div>

            {/* 우측: 루틴 템플릿 드롭다운 */}
            <div className="ml-auto flex items-center gap-2 relative" ref={templateMenuRef}>
              <button
                type="button"
                onClick={() => setShowTemplateMenu((prev) => !prev)}
                className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11.5px] font-bold transition-all cursor-pointer shadow-2xs ${
                  showTemplateMenu
                    ? 'border-amber-500 bg-amber-500 text-white shadow-xs'
                    : 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400 hover:bg-amber-500/20'
                }`}
                title="자주 쓰는 루틴 템플릿 목록"
              >
                <Sparkles size={12} className={showTemplateMenu ? 'text-white' : 'text-amber-500'} />
                <span>루틴 템플릿 ({templates.length})</span>
                <ChevronDown
                  size={12}
                  className={showTemplateMenu ? 'rotate-180 transition-transform' : 'transition-transform'}
                />
              </button>

              {showTemplateMenu && (
                <div className="absolute right-0 top-10 z-50 w-80 rounded-xl border border-amber-500/30 bg-panel p-3 shadow-xl space-y-2.5 animate-in fade-in slide-in-from-top-1 duration-200">
                  <div className="flex items-center justify-between border-b border-border pb-2">
                    <div>
                      <div className="text-[12px] font-bold text-ink flex items-center gap-1.5">
                        <Sparkles size={13} className="text-amber-500" />
                        <span>루틴 템플릿</span>
                      </div>
                      <div className="text-[10px] text-ink3 mt-0.5">
                        {user?.name || '사용자'}님 맞춤 루틴 ({templates.length}개)
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowTemplateMenu(false)}
                      className="text-ink3 hover:text-ink text-[12px] p-0.5 rounded hover:bg-panel-alt transition-colors cursor-pointer"
                    >
                      ✕
                    </button>
                  </div>

                  <div className="max-h-60 overflow-y-auto space-y-1.5 pr-0.5">
                    {templates.length === 0 ? (
                      <div className="py-4 text-center text-[11.5px] text-ink3 leading-relaxed border border-dashed border-border rounded-lg bg-panel-alt/40">
                        등록된 루틴 템플릿이 없습니다.
                      </div>
                    ) : (
                      templates.map((tpl) => (
                        <div
                          key={tpl.id}
                          className="group flex items-center justify-between rounded-lg border border-border bg-panel-alt/40 p-2 hover:border-amber-500/50 hover:bg-panel transition-all"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="text-[11.5px] font-bold text-ink group-hover:text-amber-600 dark:group-hover:text-amber-400 truncate flex items-center gap-1">
                              <span>{tpl.icon}</span>
                              <span className="truncate">{tpl.name}</span>
                            </div>
                            {tpl.desc && (
                              <div className="text-[10px] text-ink3 truncate mt-0.5">
                                {tpl.desc}
                              </div>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              handleApplyTemplate(tpl.content);
                              setShowTemplateMenu(false);
                            }}
                            className="rounded-md bg-amber-500/20 px-2 py-1 text-[10.5px] font-bold text-amber-700 dark:text-amber-400 hover:bg-amber-500 hover:text-white transition-colors cursor-pointer shrink-0 ml-1.5"
                          >
                            적용
                          </button>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="border-t border-border pt-2 flex items-center justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        setShowTemplateMenu(false);
                        setConfigModalTab('templates');
                      }}
                      className="flex items-center gap-1.5 text-[11px] font-bold text-ink2 hover:text-amber-600 transition-colors cursor-pointer"
                    >
                      <Settings size={12} className="text-amber-500" />
                      <span>루틴 템플릿 관리</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 작성 가이드 안내 배너 */}
          <div className="flex items-start gap-2 rounded-xl bg-teal-soft/20 border border-teal/20 px-3.5 py-2.5 text-[11px] text-ink2">
            <HelpCircle size={14} className="text-teal mt-0.5 shrink-0" />
            <div className="space-y-0.5 leading-relaxed">
              <p>
                <strong>체크박스 할 일:</strong> 줄 맨 앞에 <code className="bg-panel px-1 py-0.2 rounded font-bold text-teal border border-teal/30">-</code> 기호를 붙여주세요. (예: <code>- 결산 리포트 작성</code>)
              </p>
              <p className="text-ink3">
                기호가 없는 줄은 체크박스 없이 일반 줄글(제목, 메모, 참고사항)로 깔끔하게 표시됩니다. 줄바꿈(Enter)으로 자유롭게 간격을 띄울 수 있습니다.
              </p>
            </div>
          </div>

          {/* 동시 수정 충돌 경고 */}
          {conflictError && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 space-y-2.5">
              <div className="flex items-start gap-2.5 text-amber-900 dark:text-amber-200">
                <AlertTriangle size={17} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
                <div className="space-y-1 text-[11.5px] leading-relaxed">
                  <p className="font-extrabold text-[12px]">⚠️ 동시 수정 충돌 감지 (작성 데이터 보호됨)</p>
                  <p>{conflictError}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-1.5 border-t border-amber-500/20 text-[11px]">
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(content);
                    setNoticeMessage('내용을 클립보드에 복사했습니다.');
                  }}
                  className="flex items-center gap-1 rounded-lg border border-amber-500/40 bg-panel px-2.5 py-1 font-bold text-ink hover:bg-panel-alt transition-colors"
                >
                  <Copy size={11} />
                  <span>내용 복사</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSave(true)}
                  disabled={isSaving}
                  className="rounded-lg bg-amber-600 px-3 py-1 font-bold text-white hover:bg-amber-700 transition-colors"
                >
                  {isSaving ? '저장 중…' : '현재 작성본으로 강제 저장'}
                </button>
              </div>
            </div>
          )}

          {/* 알림 토스트 */}
          {noticeMessage && (
            <div className="flex items-center gap-2 rounded-lg bg-teal/10 px-3 py-2 text-[11px] font-semibold text-teal border border-teal/20">
              <AlertCircle size={13} />
              <span>{noticeMessage}</span>
            </div>
          )}

          {/* ────────────────── 본문 텍스트 에디터 (Textarea) ────────────────── */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11.5px] font-bold text-ink px-1">
              <span className="flex items-center gap-1.5">
                <CheckSquare size={13} className="text-teal" />
                <span>계획 및 할 일 작성</span>
              </span>
              {progress && (
                <span className="text-teal text-[11px]">
                  달성률: {progress.completed}/{progress.total} 완료 ({progress.percent}%)
                </span>
              )}
            </div>

            <textarea
              ref={textareaRef}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={8}
              placeholder={`오늘의 계획과 할 일을 자유롭게 작성하세요.\n\n예시:\n[오전 업무]\n- 주간 회의 참석\n- 결산 리포트 데이터 검증\n\n[오후 업무]\n- 고객사 미팅 준비\n참고: 오후 4시 이후 외부 회의 예정`}
              className="w-full rounded-xl border border-border bg-panel p-3 text-[12px] leading-relaxed text-ink outline-none focus:border-teal font-sans transition-colors resize-y min-h-[160px]"
            />
          </div>

          {/* ────────────────── 실시간 렌더링 미리보기 ────────────────── */}
          <div className="space-y-1.5">
            <div className="text-[11px] font-bold text-ink3 px-1">
              실시간 화면 표시 미리보기
            </div>
            <div className="max-h-[160px] overflow-y-auto space-y-1 rounded-xl border border-border bg-panel-alt/40 p-3">
              {parsedItems.length === 0 || !parsedItems.some(i => i.text) ? (
                <div className="py-3 text-center text-[11px] text-ink3">
                  위 에디터에 계획을 입력하면 화면에 표시될 형태가 여기에 나타납니다.
                </div>
              ) : (
                parsedItems.map((item, idx) => {
                  if (!item.text && !item.tag && !item.isChecklist) {
                    return <div key={idx} className="h-2" />;
                  }
                  const tagMeta = item.tag ? getWorkPlanTagMeta(item.tag, tagMap) : null;

                  return (
                    <div
                      key={idx}
                      className="flex items-start gap-1.5 rounded py-0.5 px-1 hover:bg-panel transition-colors"
                    >
                      {item.isChecklist && (
                        <button
                          type="button"
                          onClick={() => handleToggle(idx)}
                          className={`mt-0.5 grid h-3.5 w-3.5 shrink-0 place-items-center rounded border transition-colors cursor-pointer ${
                            item.completed
                              ? 'border-teal bg-teal text-white'
                              : 'border-border bg-panel hover:border-teal'
                          }`}
                        >
                          {item.completed && <CheckCircle2 size={11} />}
                        </button>
                      )}

                      <div className="min-w-0 flex-1 leading-snug">
                        {tagMeta && (
                          <span
                            className={`mr-1 inline-block rounded px-1 py-0.2 text-[9.5px] font-bold ${tagMeta.badgeClass}`}
                          >
                            {tagMeta.tag}
                          </span>
                        )}
                        <span
                          className={`text-[11.5px] break-words ${
                            item.completed ? 'line-through text-ink3' : 'text-ink font-medium'
                          }`}
                        >
                          {item.text}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* 모달 하단 액션 버튼군 */}
          <div className="flex items-center justify-between border-t border-border pt-3">
            <div>
              {onDelete && initialContent && (
                <Button
                  variant="danger"
                  size="sm"
                  onClick={handleDelete}
                  disabled={isSaving}
                >
                  전체 삭제
                </Button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={onClose}
                disabled={isSaving}
              >
                취소
              </Button>
              <Button
                size="sm"
                onClick={() => handleSave(false)}
                disabled={isSaving}
              >
                {isSaving ? '저장 중…' : '저장하기'}
              </Button>
            </div>
          </div>
        </div>
      </Modal>

      {/* 루틴 템플릿 / 태그 관리 모달 */}
      <WorkPlanConfigModal
        isOpen={configModalTab !== null}
        defaultTab={configModalTab ?? 'templates'}
        onClose={() => setConfigModalTab(null)}
      />
    </>
  );
}
