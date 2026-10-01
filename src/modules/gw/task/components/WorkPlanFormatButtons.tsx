import { useEffect, useRef, useState } from 'react';
import { useEditorState, type Editor } from '@tiptap/react';
import { Bold, Underline, Strikethrough, Highlighter, Palette, ChevronDown } from 'lucide-react';
import { WORK_PLAN_COLORS, WORK_PLAN_COLOR_LABELS, type WorkPlanColor } from '@/domain/workPlan/richText';

const COLOR_NAMES = Object.keys(WORK_PLAN_COLORS) as WorkPlanColor[];

/**
 * 리본의 서식 버튼 묶음 — 굵게·밑줄·취소선·형광펜·글자색.
 * 칸 편집기(`WorkPlanRichEditor`)가 넘겨준 편집기에 명령을 보내고, 커서 위치의 서식을 눌린 상태로 보여 준다.
 * 글자색은 저장 표기(`{red}…{/}`)로 되돌릴 수 있는 정해진 색만 고르게 한다.
 */
export function WorkPlanFormatButtons({ editor }: { editor: Editor | null }) {
  const [showColors, setShowColors] = useState(false);
  const colorMenuRef = useRef<HTMLDivElement>(null);

  const state = useEditorState({
    editor,
    selector: ({ editor: ed }) => ({
      bold: ed?.isActive('bold') ?? false,
      underline: ed?.isActive('underline') ?? false,
      strike: ed?.isActive('strike') ?? false,
      highlight: ed?.isActive('highlight') ?? false,
      color: (ed?.getAttributes('textStyle').color as string | undefined) ?? null,
    }),
  });

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (colorMenuRef.current && !colorMenuRef.current.contains(e.target as Node)) setShowColors(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const disabled = !editor;
  const buttons = [
    { key: 'bold', label: '굵게 (Ctrl+B)', icon: Bold, active: state?.bold, run: () => editor?.chain().focus().toggleBold().run() },
    { key: 'underline', label: '밑줄 (Ctrl+U)', icon: Underline, active: state?.underline, run: () => editor?.chain().focus().toggleUnderline().run() },
    { key: 'strike', label: '취소선 (Ctrl+Shift+S)', icon: Strikethrough, active: state?.strike, run: () => editor?.chain().focus().toggleStrike().run() },
    { key: 'highlight', label: '형광펜 (Ctrl+Shift+H)', icon: Highlighter, active: state?.highlight, run: () => editor?.chain().focus().toggleHighlight().run() },
  ];

  const currentColor = COLOR_NAMES.find((name) => WORK_PLAN_COLORS[name] === state?.color?.toLowerCase());

  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-border bg-panel p-0.5 shadow-2xs">
      {buttons.map(({ key, label, icon: Icon, active, run }) => (
        <button
          key={key}
          type="button"
          disabled={disabled}
          onClick={run}
          title={label}
          aria-label={label}
          aria-pressed={Boolean(active)}
          className={`grid h-6 w-6 place-items-center rounded-md transition-colors disabled:opacity-40 ${
            active ? 'bg-teal text-white' : 'text-ink2 hover:bg-panel-alt'
          }`}
        >
          <Icon size={13} strokeWidth={2.4} />
        </button>
      ))}

      <div className="relative" ref={colorMenuRef}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setShowColors((prev) => !prev)}
          title="글자색"
          aria-label="글자색"
          className="flex h-6 items-center gap-0.5 rounded-md px-1 text-ink2 hover:bg-panel-alt disabled:opacity-40"
        >
          <Palette size={13} style={currentColor ? { color: WORK_PLAN_COLORS[currentColor] } : undefined} />
          <ChevronDown size={10} />
        </button>
        {showColors && (
          <div className="absolute left-0 top-7 z-40 flex items-center gap-1 rounded-lg border border-border bg-panel p-1.5 shadow-lg">
            {COLOR_NAMES.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => {
                  editor?.chain().focus().setColor(WORK_PLAN_COLORS[name]).run();
                  setShowColors(false);
                }}
                title={WORK_PLAN_COLOR_LABELS[name]}
                aria-label={WORK_PLAN_COLOR_LABELS[name]}
                className={`h-5 w-5 rounded-full border-2 ${currentColor === name ? 'border-ink' : 'border-transparent'}`}
                style={{ backgroundColor: WORK_PLAN_COLORS[name] }}
              />
            ))}
            <button
              type="button"
              onClick={() => {
                editor?.chain().focus().unsetColor().run();
                setShowColors(false);
              }}
              className="ml-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold text-ink2 hover:bg-panel-alt"
            >
              기본
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
