import { useEffect, useRef } from 'react';
import { EditorContent, Extension, useEditor, type Editor } from '@tiptap/react';
import { TextSelection } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import Highlight from '@tiptap/extension-highlight';
import { Color, TextStyle } from '@tiptap/extension-text-style';
import { contentToEditorDoc, editorDocToContent } from '@/domain/workPlan/richText';

/**
 * 업무계획 칸 안 편집기 — 편집 중에도 굵게·취소선 등이 그대로 보인다(Tiptap).
 *
 * 값(value)은 저장 형식 그대로의 **줄 단위 텍스트**다. 편집기 문서와의 변환은
 * `domain/workPlan/richText`가 맡는다. 줄 하나가 문단 하나라 여러 줄 서식(제목·인용 등)과
 * 줄 안 줄바꿈(Shift+Enter)은 끈다 — 텍스트로 되돌릴 방법이 없어서다.
 */

/**
 * 할 일 항목.
 * - 체크박스는 리본 버튼·Ctrl+Shift+9로만 만든다. `- `·`[ ] ` 입력 자동 전환은 끈다 —
 *   '-'로 시작하는 메모 줄을 쓰려다 체크박스가 되는 일이 없게.
 * - 체크박스를 빼는 키는 "항목을 목록 밖 일반 줄로 꺼내기"로 통일한다. 기본 동작은 Backspace가
 *   윗 항목과 합쳐 버려서 체크박스 없이 들여쓰기만 남은 줄이 생겼다.
 */
const WorkPlanTaskItem = TaskItem.extend({
  addInputRules() {
    return [];
  },
  addKeyboardShortcuts() {
    const cursorAtItemStart = () => {
      const { empty, $from } = this.editor.state.selection;
      return empty && $from.parentOffset === 0 && $from.node(-1)?.type === this.type;
    };
    return {
      ...this.parent?.(),
      // 빈 할 일에서 Enter → 목록을 끝내고 일반 줄로. 내용이 있으면 다음 할 일을 이어 만든다.
      Enter: () => {
        if (cursorAtItemStart() && this.editor.state.selection.$from.parent.content.size === 0) {
          return this.editor.commands.liftListItem(this.name);
        }
        return this.editor.commands.splitListItem(this.name);
      },
      // 할 일 맨 앞에서 Backspace → 체크박스만 빼고 글자는 들여쓰기 없는 일반 줄로 남긴다.
      Backspace: () => (cursorAtItemStart() ? this.editor.commands.liftListItem(this.name) : false),
    };
  },
}).configure({ nested: false });

/**
 * 체크박스 목록 바로 아래 일반 줄 맨 앞에서 Backspace → 윗줄(마지막 할 일) 끝으로 합친다. 빈 줄이면 지우기만.
 * 기본 동작은 이 줄을 윗 목록에 다시 감싸 체크박스를 되살렸다.
 */
const BackspaceIntoTaskAbove = Extension.create({
  name: 'workPlanBackspaceIntoTaskAbove',
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      Backspace: ({ editor }) => {
        const { empty, $from } = editor.state.selection;
        if (!empty || $from.parentOffset !== 0 || $from.depth !== 1 || $from.parent.type.name !== 'paragraph') return false;
        const index = $from.index(0);
        if (index === 0 || editor.state.doc.child(index - 1).type.name !== 'taskList') return false;

        const paraStart = $from.before(1);
        // 목록 끝(paraStart) ← 할 일 끝 ← 문단 끝 ← 문단 내용 끝: 세 칸 앞이 마지막 할 일의 글 끝
        const joinPos = paraStart - 3;
        return editor
          .chain()
          .command(({ tr }) => {
            const para = tr.doc.nodeAt(paraStart);
            if (!para) return false;
            tr.delete(paraStart, paraStart + para.nodeSize);
            tr.insert(joinPos, para.content);
            tr.setSelection(TextSelection.create(tr.doc, joinPos));
            return true;
          })
          .run();
      },
    };
  },
});

const EXTENSIONS = [
  StarterKit.configure({
    heading: false,
    bulletList: false,
    orderedList: false,
    listItem: false,
    listKeymap: false,
    blockquote: false,
    codeBlock: false,
    code: false,
    horizontalRule: false,
    italic: false,
    link: false,
    hardBreak: false,
    trailingNode: false,
  }),
  TaskList,
  WorkPlanTaskItem,
  BackspaceIntoTaskAbove,
  Highlight,
  TextStyle,
  Color,
];

export function WorkPlanRichEditor({
  value,
  onChange,
  onBlur,
  onSave,
  onCancel,
  onEditorReady,
}: {
  value: string;
  onChange: (val: string) => void;
  onBlur: () => void;
  onSave: () => void;
  onCancel: () => void;
  /** 상단 리본이 서식 명령을 내릴 수 있게 편집기 인스턴스를 넘긴다. 언마운트 시 null. */
  onEditorReady?: (editor: Editor | null) => void;
}) {
  // 편집기 콜백은 생성 시점에 한 번 묶이므로 최신 함수를 ref로 읽는다.
  const handlers = useRef({ onChange, onBlur, onSave, onCancel });
  handlers.current = { onChange, onBlur, onSave, onCancel };
  /** 편집기가 마지막으로 내보낸 텍스트 — 리본(템플릿 삽입 등)이 바꾼 값만 편집기로 되돌려 넣는다. */
  const lastEmitted = useRef(value);
  /** Ctrl+Enter로 저장한 직후 이어지는 blur가 같은 저장을 한 번 더 부르지 않게 막는다. */
  const savedByKey = useRef(false);

  const editor = useEditor({
    extensions: EXTENSIONS,
    content: contentToEditorDoc(value),
    autofocus: 'end',
    editorProps: {
      attributes: {
        class: 'workplan-rich-editor w-full min-h-[65px] rounded border border-blue-400/50 p-0 text-[10px] leading-relaxed text-ink outline-none focus:border-blue-400',
      },
      handleKeyDown: (_view, event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
          event.preventDefault();
          savedByKey.current = true;
          handlers.current.onSave();
          return true;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          handlers.current.onCancel();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: ed }) => {
      const text = editorDocToContent(ed.getJSON());
      lastEmitted.current = text;
      handlers.current.onChange(text);
    },
    onBlur: ({ event }) => {
      // 상단 리본 메뉴를 조작 중이면 닫지 않는다.
      const next = (event as FocusEvent).relatedTarget as HTMLElement | null;
      if (next?.closest('[data-workplan-ribbon="true"]')) return;
      const active = document.activeElement as HTMLElement | null;
      if (active?.closest('[data-workplan-ribbon="true"]')) return;
      if (savedByKey.current) return;
      handlers.current.onBlur();
    },
  });

  // 리본의 템플릿 삽입·체크박스 추가처럼 바깥에서 값을 바꾼 경우에만 편집기 내용을 갈아 끼운다.
  useEffect(() => {
    if (!editor || value === lastEmitted.current) return;
    lastEmitted.current = value;
    editor.commands.setContent(contentToEditorDoc(value), { emitUpdate: false });
    editor.commands.focus('end');
  }, [editor, value]);

  useEffect(() => {
    onEditorReady?.(editor);
    return () => onEditorReady?.(null);
  }, [editor, onEditorReady]);

  return (
    <div className="w-full" onClick={(e) => e.stopPropagation()}>
      <EditorContent editor={editor} />
    </div>
  );
}
