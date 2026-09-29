import { useState, useMemo } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { Button } from '@/shared/ui/Button';
import {
  useWorkPlanConfig,
  stripMarkdownAndTags,
  TAG_COLOR_PRESETS,
  type WorkPlanCustomTag,
} from '@/features/workPlan/useWorkPlanConfig';
import {
  type WorkPlanTemplate,
  parseWorkPlanItems,
  getWorkPlanTagMeta,
} from '@/domain/workPlan/engine';
import {
  Sparkles,
  Tag,
  Plus,
  Edit2,
  Trash2,
  RotateCcw,
  Check,
  CheckSquare,
  Code,
  ArrowLeft,
} from 'lucide-react';

const COMMON_EMOJIS = ['🔵', '🟣', '🟠', '📋', '🚀', '💡', '🛠️', '⚡', '☕', '💼', '📈', '🎯', '✨', '📝'];

interface WorkPlanConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultTab?: 'templates' | 'tags';
}

export function WorkPlanConfigModal({
  isOpen,
  onClose,
  defaultTab = 'templates',
}: WorkPlanConfigModalProps) {
  const [activeTab, setActiveTab] = useState<'templates' | 'tags'>(defaultTab);

  const {
    templates,
    tags,
    tagMap,
    addTemplate,
    updateTemplate,
    deleteTemplate,
    resetTemplates,
    addTag,
    updateTag,
    deleteTag,
    resetTags,
  } = useWorkPlanConfig();

  // --- 템플릿 편집 상태 ---
  const [editingTplId, setEditingTplId] = useState<string | null>(null);
  const [isAddingTpl, setIsAddingTpl] = useState(false);
  const [tplName, setTplName] = useState('');
  const [tplDesc, setTplDesc] = useState('');
  const [tplIcon, setTplIcon] = useState('📋');
  const [tplContent, setTplContent] = useState('');

  // 대화형 To-Do 아이템 등록 상태 (현재 업무계획 화면과 동일한 UX)
  const [newTodoText, setNewTodoText] = useState('');
  const [newTodoTag, setNewTodoTag] = useState('');
  const [isRawTextMode, setIsRawTextMode] = useState(false);

  const parsedTplItems = useMemo(() => parseWorkPlanItems(tplContent), [tplContent]);

  // --- 태그 편집 상태 ---
  const [editingTagOriginal, setEditingTagOriginal] = useState<string | null>(null);
  const [isAddingTag, setIsAddingTag] = useState(false);
  const [tagName, setTagName] = useState('');
  const [tagColorId, setTagColorId] = useState('teal');

  // 템플릿 등록/수정 시작
  const startEditTemplate = (tpl: WorkPlanTemplate) => {
    setEditingTplId(tpl.id);
    setIsAddingTpl(false);
    setTplName(tpl.name);
    setTplDesc(tpl.desc);
    setTplIcon(tpl.icon);
    setTplContent(tpl.content);
    setNewTodoText('');
    setNewTodoTag('');
    setIsRawTextMode(false);
  };

  const startAddTemplate = () => {
    setEditingTplId(null);
    setIsAddingTpl(true);
    setTplName('');
    setTplDesc('');
    setTplIcon('📋');
    setTplContent('');
    setNewTodoText('');
    setNewTodoTag('');
    setIsRawTextMode(false);
  };

  const handleAddTodoItem = () => {
    if (!newTodoText.trim()) return;
    const newLine = newTodoText.trim();
    setTplContent((prev) => (prev.trim() ? `${prev.trim()}\n${newLine}` : newLine));
    setNewTodoText('');
  };

  const handleRemoveTodoItem = (indexToRemove: number) => {
    const lines = tplContent.split('\n').filter((_, idx) => idx !== indexToRemove);
    setTplContent(lines.join('\n'));
  };

  const cancelTplForm = () => {
    setEditingTplId(null);
    setIsAddingTpl(false);
    setNewTodoText('');
    setNewTodoTag('');
  };

  const saveTemplateForm = () => {
    if (!tplName.trim() || !tplContent.trim()) return;
    const cleanContent = stripMarkdownAndTags(tplContent.trim());
    if (editingTplId) {
      updateTemplate(editingTplId, {
        name: tplName.trim(),
        desc: tplDesc.trim(),
        icon: tplIcon,
        content: cleanContent,
      });
    } else {
      addTemplate({
        name: tplName.trim(),
        desc: tplDesc.trim(),
        icon: tplIcon,
        content: cleanContent,
      });
    }
    cancelTplForm();
  };

  // 태그 등록/수정 시작
  const startEditTag = (t: WorkPlanCustomTag) => {
    setEditingTagOriginal(t.tag);
    setIsAddingTag(false);
    setTagName(t.tag);
    setTagColorId(t.colorId);
  };

  const startAddTag = () => {
    setEditingTagOriginal(null);
    setIsAddingTag(true);
    setTagName('');
    setTagColorId('teal');
  };

  const cancelTagForm = () => {
    setEditingTagOriginal(null);
    setIsAddingTag(false);
  };

  const saveTagForm = () => {
    const clean = tagName.trim();
    if (!clean) return;
    if (editingTagOriginal) {
      updateTag(editingTagOriginal, clean, tagColorId);
    } else {
      addTag(clean, tagColorId);
    }
    cancelTagForm();
  };

  const isEditingTemplate = Boolean(isAddingTpl || editingTplId);
  const isEditingTag = Boolean(isAddingTag || editingTagOriginal);

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title="업무계획 루틴 템플릿 및 태그 관리"
      width={680}
    >
      <div className="space-y-4">
        {/* 상단 네비게이션: 편집 모드 시 뒤로가기 버튼 vs 일반 모드 시 탭 전환 */}
        {isEditingTemplate ? (
          <div className="flex items-center justify-between border-b border-border pb-2.5">
            <button
              type="button"
              onClick={cancelTplForm}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-panel px-3 py-1.5 text-[12px] font-bold text-ink2 hover:border-teal hover:text-teal hover:bg-panel-alt transition-all cursor-pointer shadow-2xs"
            >
              <ArrowLeft size={14} />
              <span>템플릿 목록으로 돌아가기</span>
            </button>
            <div className="flex items-center gap-1.5 text-[12.5px] font-extrabold text-ink">
              <Sparkles size={14} className="text-amber-500" />
              <span>{editingTplId ? '루틴 템플릿 수정' : '새 루틴 템플릿 추가'}</span>
            </div>
          </div>
        ) : isEditingTag ? (
          <div className="flex items-center justify-between border-b border-border pb-2.5">
            <button
              type="button"
              onClick={cancelTagForm}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-panel px-3 py-1.5 text-[12px] font-bold text-ink2 hover:border-teal hover:text-teal hover:bg-panel-alt transition-all cursor-pointer shadow-2xs"
            >
              <ArrowLeft size={14} />
              <span>태그 목록으로 돌아가기</span>
            </button>
            <div className="flex items-center gap-1.5 text-[12.5px] font-extrabold text-ink">
              <Tag size={14} className="text-teal" />
              <span>{editingTagOriginal ? `'${editingTagOriginal}' 태그 수정` : '새 업무 태그 추가'}</span>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between border-b border-border pb-2.5">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setActiveTab('templates');
                  cancelTplForm();
                  cancelTagForm();
                }}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-bold transition-all cursor-pointer ${
                  activeTab === 'templates'
                    ? 'bg-teal-soft/30 text-teal border border-teal/40 shadow-2xs'
                    : 'text-ink3 hover:bg-panel-alt hover:text-ink'
                }`}
              >
                <Sparkles size={14} className={activeTab === 'templates' ? 'text-amber-500' : ''} />
                <span>루틴 템플릿 ({templates.length})</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveTab('tags');
                  cancelTplForm();
                  cancelTagForm();
                }}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-bold transition-all cursor-pointer ${
                  activeTab === 'tags'
                    ? 'bg-teal-soft/30 text-teal border border-teal/40 shadow-2xs'
                    : 'text-ink3 hover:bg-panel-alt hover:text-ink'
                }`}
              >
                <Tag size={14} />
                <span>업무 태그 ({tags.length})</span>
              </button>
            </div>

            <div>
              {activeTab === 'templates' && (
                <button
                  type="button"
                  onClick={startAddTemplate}
                  className="flex items-center gap-1 rounded-lg bg-teal px-2.5 py-1 text-[11.5px] font-bold text-white hover:opacity-90 transition-opacity shadow-2xs cursor-pointer"
                >
                  <Plus size={13} />
                  <span>새 템플릿</span>
                </button>
              )}

              {activeTab === 'tags' && (
                <button
                  type="button"
                  onClick={startAddTag}
                  className="flex items-center gap-1 rounded-lg bg-teal px-2.5 py-1 text-[11.5px] font-bold text-white hover:opacity-90 transition-opacity shadow-2xs cursor-pointer"
                >
                  <Plus size={13} />
                  <span>새 태그</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* ============================================================
            TAB 1: 루틴 템플릿 관리 (편집 뷰 vs 목록 뷰 단독 전환)
           ============================================================ */}
        {activeTab === 'templates' && (
          isEditingTemplate ? (
            /* 1-A) 템플릿 단독 편집/추가 폼 (한 화면에 한 템플릿만 집중) */
            <div className="rounded-xl border border-teal/40 bg-teal-soft/10 p-4 space-y-3.5 shadow-xs animate-in fade-in duration-150">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[11px] font-bold text-ink3">템플릿 이름 *</label>
                  <input
                    type="text"
                    value={tplName}
                    onChange={(e) => setTplName(e.target.value)}
                    placeholder="예: 개발 데일리 스크럼"
                    className="h-8.5 w-full rounded-lg border border-border bg-panel px-3 text-[12px] text-ink outline-none focus:border-teal"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-bold text-ink3">한 줄 설명</label>
                  <input
                    type="text"
                    value={tplDesc}
                    onChange={(e) => setTplDesc(e.target.value)}
                    placeholder="예: 어제 한 일, 오늘 할 일 공유"
                    className="h-8.5 w-full rounded-lg border border-border bg-panel px-3 text-[12px] text-ink outline-none focus:border-teal"
                  />
                </div>
              </div>

              {/* 아이콘 선택 */}
              <div>
                <label className="mb-1.5 block text-[11px] font-bold text-ink3">아이콘 선택</label>
                <div className="flex flex-wrap gap-1.5">
                  {COMMON_EMOJIS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => setTplIcon(emoji)}
                      className={`h-7.5 w-7.5 rounded-lg border text-[13px] flex items-center justify-center transition-all cursor-pointer ${
                        tplIcon === emoji
                          ? 'border-teal bg-teal/20 scale-110 shadow-2xs font-bold'
                          : 'border-border bg-panel hover:bg-panel-alt'
                      }`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>

              {/* 템플릿 To-Do 구성 (현재 업무계획 화면과 동일한 대화형 스마트 UX) */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[11.5px] font-bold text-ink flex items-center gap-1.5">
                    <CheckSquare size={14} className="text-teal" />
                    <span>템플릿 To-Do 구성 ({parsedTplItems.length}건) *</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setIsRawTextMode((prev) => !prev)}
                    className="text-[10.5px] font-semibold text-ink3 hover:text-teal underline flex items-center gap-1 cursor-pointer"
                  >
                    <Code size={12} />
                    <span>{isRawTextMode ? '대화형 목록으로 전환' : '마크다운 직접 편집'}</span>
                  </button>
                </div>

                {isRawTextMode ? (
                  <textarea
                    rows={6}
                    value={tplContent}
                    onChange={(e) => setTplContent(e.target.value)}
                    placeholder="- [ ] [회의] 아침 일일 스크럼 참석&#10;- [ ] [집중] 기능 개발 진행"
                    className="w-full rounded-lg border border-border bg-panel p-3 text-[12px] font-mono text-ink outline-none focus:border-teal"
                  />
                ) : (
                  <div className="space-y-2.5">
                    {/* 항목 추가 컨트롤 바 */}
                    <div className="rounded-xl border border-teal/30 bg-panel p-3 space-y-2 shadow-2xs">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-teal">새 할 일 추가</span>
                        <div className="flex items-center gap-1">
                          {['회의', '미팅', '보고', '집중', '마감'].map((tag) => (
                            <button
                              key={tag}
                              type="button"
                              onClick={() => setNewTodoTag(newTodoTag === tag ? '' : tag)}
                              className={`rounded px-1.5 py-0.5 text-[10.5px] font-medium transition-all cursor-pointer ${
                                newTodoTag === tag
                                  ? 'bg-teal text-white shadow-2xs'
                                  : 'bg-panel-alt border border-border text-ink3 hover:border-teal hover:text-teal'
                              }`}
                            >
                              +{tag}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={newTodoText}
                          onChange={(e) => setNewTodoText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleAddTodoItem();
                            }
                          }}
                          placeholder="루틴 할 일 내용 입력 후 Enter 또는 [추가] (예: 일일 스크럼 참석)"
                          className="flex-1 rounded-lg border border-border bg-panel px-3 py-1.5 text-[12px] text-ink outline-none focus:border-teal"
                        />
                        <Button
                          size="sm"
                          type="button"
                          onClick={handleAddTodoItem}
                          disabled={!newTodoText.trim()}
                        >
                          <Plus size={13} />
                          <span>추가</span>
                        </Button>
                      </div>
                    </div>

                    {/* 추가된 항목 리스트 */}
                    {parsedTplItems.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-border/70 py-6 text-center text-[11.5px] text-ink3 bg-panel/50">
                        등록된 할 일이 없습니다. 위에서 태그를 선택하고 할 일을 추가해주세요.
                      </div>
                    ) : (
                      <div className="space-y-1.5 max-h-56 overflow-y-auto rounded-lg border border-border/60 bg-panel p-2.5">
                        {parsedTplItems.map((item, idx) => {
                          const tagMeta = item.tag ? getWorkPlanTagMeta(item.tag, tagMap) : null;
                          return (
                            <div
                              key={idx}
                              className="group flex items-center justify-between gap-2 rounded-lg p-2 hover:bg-panel-alt transition-colors text-[12px]"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="text-ink3 font-mono text-[10.5px] w-5">#{idx + 1}</span>
                                {tagMeta && (
                                  <span className={`inline-flex items-center rounded px-1.5 py-0.2 text-[10px] font-bold ${tagMeta.badgeClass}`}>
                                    {item.tag}
                                  </span>
                                )}
                                <span className="truncate text-ink font-medium">{item.text}</span>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleRemoveTodoItem(idx)}
                                className="rounded p-1 text-ink3 opacity-50 group-hover:opacity-100 hover:bg-rose-500/10 hover:text-rose-500 transition-all cursor-pointer"
                                title="항목 삭제"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* 하단 저장/취소 버튼 */}
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-teal/20">
                <button
                  type="button"
                  onClick={cancelTplForm}
                  className="rounded-lg border border-border bg-panel px-3.5 py-1.5 text-[11.5px] font-semibold text-ink2 hover:bg-panel-alt cursor-pointer"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={saveTemplateForm}
                  disabled={!tplName.trim() || !tplContent.trim()}
                  className="flex items-center gap-1.5 rounded-lg bg-teal px-4 py-1.5 text-[11.5px] font-bold text-white hover:opacity-90 disabled:opacity-40 cursor-pointer shadow-2xs"
                >
                  <Check size={14} />
                  <span>{editingTplId ? '변경사항 저장' : '등록'}</span>
                </button>
              </div>
            </div>
          ) : (
            /* 1-B) 템플릿 목록 뷰 (현재 업무계획 양식과 동일한 To-Do 카드 미리보기) */
            <div className="space-y-3">
              <div className="max-h-[420px] space-y-3 overflow-y-auto pr-1">
                {templates.length === 0 ? (
                  <div className="py-12 text-center text-[12px] text-ink3 border border-dashed border-border rounded-xl">
                    등록된 루틴 템플릿이 없습니다. 상단의 '+ 새 템플릿'을 눌러 나만의 루틴을 추가해보세요.
                  </div>
                ) : (
                  templates.map((tpl) => {
                    const items = parseWorkPlanItems(tpl.content);
                    return (
                      <div
                        key={tpl.id}
                        className="group rounded-xl border border-border bg-panel p-3.5 hover:border-border-hi transition-all shadow-2xs space-y-2.5"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2.5">
                            <span className="text-[20px] flex items-center justify-center h-8 w-8 rounded-lg bg-panel-alt border border-border/60">
                              {tpl.icon}
                            </span>
                            <div>
                              <h4 className="text-[13px] font-bold text-ink flex items-center gap-1.5">
                                <span>{tpl.name}</span>
                                <span className="text-[10.5px] font-normal text-ink3">({items.length}건)</span>
                              </h4>
                              {tpl.desc && <p className="text-[11px] text-ink3 mt-0.5">{tpl.desc}</p>}
                            </div>
                          </div>

                          <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                            <button
                              type="button"
                              onClick={() => startEditTemplate(tpl)}
                              className="flex items-center gap-1 rounded-lg border border-border bg-panel px-2.5 py-1 text-[11px] font-semibold text-ink2 hover:border-teal hover:text-teal hover:bg-panel-alt transition-all cursor-pointer shadow-2xs"
                              title="템플릿 수정"
                            >
                              <Edit2 size={12} />
                              <span>편집</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                if (window.confirm(`'${tpl.name}' 템플릿을 삭제하시겠습니까?`)) {
                                  deleteTemplate(tpl.id);
                                }
                              }}
                              className="rounded-lg p-1.5 text-ink3 hover:bg-rose-500/10 hover:text-rose-500 transition-colors cursor-pointer"
                              title="템플릿 삭제"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>

                        {/* 현재 업무계획 양식과 동일한 To-Do 목록 미리보기 */}
                        <div className="space-y-1.5 rounded-lg border border-border/60 bg-panel-alt/40 p-2.5">
                          {items.length === 0 ? (
                            <span className="text-[11px] text-ink3 italic">등록된 할 일이 없습니다.</span>
                          ) : (
                            items.map((item, idx) => {
                              const tagMeta = item.tag ? getWorkPlanTagMeta(item.tag, tagMap) : null;
                              return (
                                <div key={idx} className="flex items-center gap-2 text-[11.5px]">
                                  <div className="h-3.5 w-3.5 rounded border border-border-hi bg-panel shrink-0" />
                                  {tagMeta && (
                                    <span className={`inline-flex items-center rounded px-1.5 py-0.2 text-[9.5px] font-bold shrink-0 ${tagMeta.badgeClass}`}>
                                      {item.tag}
                                    </span>
                                  )}
                                  <span className="text-ink font-medium truncate">{item.text}</span>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* 기본값 초기화 */}
              <div className="flex items-center justify-between pt-2 border-t border-border">
                <span className="text-[10.5px] text-ink3">
                  자주 사용하는 업무 패턴을 등록해두면 계획 작성 시 한 번의 클릭으로 자동 입력됩니다.
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm('루틴 템플릿을 기본 추천 목록으로 초기화하시겠습니까?')) {
                      resetTemplates();
                      cancelTplForm();
                    }
                  }}
                  className="flex items-center gap-1 text-[10.5px] font-semibold text-ink3 hover:text-rose-500 transition-colors shrink-0 cursor-pointer"
                >
                  <RotateCcw size={11} />
                  <span>기본값으로 복원</span>
                </button>
              </div>
            </div>
          )
        )}

        {/* ============================================================
            TAB 2: 업무 태그 관리 (편집 뷰 vs 목록 뷰 단독 전환)
           ============================================================ */}
        {activeTab === 'tags' && (
          isEditingTag ? (
            /* 2-A) 태그 단독 편집/추가 폼 */
            <div className="rounded-xl border border-teal/40 bg-teal-soft/10 p-4 space-y-3.5 shadow-xs animate-in fade-in duration-150">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[11px] font-bold text-ink3">태그 이름 *</label>
                  <input
                    type="text"
                    value={tagName}
                    onChange={(e) => setTagName(e.target.value)}
                    placeholder="예: 기획, 디자인, 검수, CS"
                    className="h-8.5 w-full rounded-lg border border-border bg-panel px-3 text-[12px] text-ink outline-none focus:border-teal"
                    autoFocus
                  />
                </div>

                <div>
                  <label className="mb-1 block text-[11px] font-bold text-ink3">미리보기</label>
                  <div className="flex h-8.5 items-center">
                    {tagName.trim() ? (
                      <span
                        className={`rounded px-2 py-0.5 text-[11px] font-bold ${
                          TAG_COLOR_PRESETS.find((p) => p.id === tagColorId)?.badgeClass || ''
                        }`}
                      >
                        {tagName.trim()}
                      </span>
                    ) : (
                      <span className="text-[11px] text-ink3 italic">태그명을 입력하세요</span>
                    )}
                  </div>
                </div>
              </div>

              {/* 색상 프리셋 선택 */}
              <div>
                <label className="mb-1.5 block text-[11px] font-bold text-ink3">색상 테마 선택</label>
                <div className="flex flex-wrap gap-1.5">
                  {TAG_COLOR_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => setTagColorId(preset.id)}
                      className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-all cursor-pointer ${
                        tagColorId === preset.id
                          ? 'border-teal ring-2 ring-teal/30 bg-panel text-ink'
                          : 'border-border bg-panel text-ink2 hover:bg-panel-alt'
                      }`}
                    >
                      <span className={`h-2.5 w-2.5 rounded-full ${preset.dotColor}`} />
                      <span>{preset.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-teal/20">
                <button
                  type="button"
                  onClick={cancelTagForm}
                  className="rounded-lg border border-border bg-panel px-3.5 py-1.5 text-[11.5px] font-semibold text-ink2 hover:bg-panel-alt cursor-pointer"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={saveTagForm}
                  disabled={!tagName.trim()}
                  className="flex items-center gap-1.5 rounded-lg bg-teal px-4 py-1.5 text-[11.5px] font-bold text-white hover:opacity-90 disabled:opacity-40 cursor-pointer shadow-2xs"
                >
                  <Check size={14} />
                  <span>{editingTagOriginal ? '변경사항 저장' : '태그 등록'}</span>
                </button>
              </div>
            </div>
          ) : (
            /* 2-B) 태그 목록 그리드 뷰 */
            <div className="space-y-3">
              <div className="max-h-[420px] space-y-1.5 overflow-y-auto pr-1">
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  {tags.map((t) => (
                    <div
                      key={t.tag}
                      className="group flex items-center justify-between rounded-xl border border-border bg-panel p-2.5 hover:border-border-hi transition-all shadow-2xs"
                    >
                      <div className="flex items-center gap-2">
                        <span className={`h-2.5 w-2.5 rounded-full ${t.dotColor}`} />
                        <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${t.badgeClass}`}>
                          {t.tag}
                        </span>
                      </div>

                      <div className="flex items-center gap-1 opacity-70 group-hover:opacity-100 transition-opacity">
                        <button
                          type="button"
                          onClick={() => startEditTag(t)}
                          className="rounded p-1 text-ink3 hover:bg-panel-alt hover:text-teal transition-colors cursor-pointer"
                          title="태그 수정"
                        >
                          <Edit2 size={12} />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (window.confirm(`'${t.tag}' 태그를 삭제하시겠습니까?`)) {
                              deleteTag(t.tag);
                            }
                          }}
                          className="rounded p-1 text-ink3 hover:bg-rose-500/10 hover:text-rose-500 transition-colors cursor-pointer"
                          title="태그 삭제"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* 기본값 초기화 */}
              <div className="flex items-center justify-between pt-2 border-t border-border">
                <span className="text-[10.5px] text-ink3">
                  등록된 태그는 업무 계획 작성 시 원클릭 삽입 버튼과 인라인 태그 셀렉터에 즉시 반영됩니다.
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm('업무 태그를 기본 권장 목록으로 초기화하시겠습니까?')) {
                      resetTags();
                      cancelTagForm();
                    }
                  }}
                  className="flex items-center gap-1 text-[10.5px] font-semibold text-ink3 hover:text-rose-500 transition-colors shrink-0 cursor-pointer"
                >
                  <RotateCcw size={11} />
                  <span>기본 태그 복원</span>
                </button>
              </div>
            </div>
          )
        )}

        {/* 하단 닫기 버튼: 편집 중이 아닐 때만 노출하여 집중도 향상 */}
        {!isEditingTemplate && !isEditingTag && (
          <div className="flex justify-end pt-2 border-t border-border">
            <Button size="sm" variant="secondary" onClick={onClose}>
              닫기
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
