import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { EditorContent, Extension, useEditor, useEditorState, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extensions';
import Image from '@tiptap/extension-image';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import Mention from '@tiptap/extension-mention';
import type { SuggestionProps } from '@tiptap/suggestion';
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough, List, ListOrdered, Quote, Code, SquareCode,
  Link2, Table as TableIcon, Heading, Rows3, Columns3, Trash2,
} from 'lucide-react';
import type { Attachment } from '@/domain/chatMessage/schema';
import { isSafeHref, type RichNode } from '@/domain/chatMessage/richBody';

/** @멘션 후보 */
export interface MentionCandidate {
  id: string;
  name: string;
  position?: string;
  dept?: string;
}

export interface ChatRichEditorHandle {
  /** 커서 자리에 사진을 끼운다(아직 올리지 않은 파일) */
  insertImages: (files: File[]) => void;
  /** 보낼 문서와 아직 올리지 않은 사진들 */
  getDraft: () => { doc: RichNode; pendingImages: Map<string, File> };
  clear: () => void;
  focus: () => void;
  isEmpty: () => boolean;
}

interface ChatRichEditorProps {
  placeholder?: string;
  disabled?: boolean;
  /** 확장 편집기 모드 — 서식 도구 막대를 보이고 Enter 는 줄바꿈(전송은 Ctrl+Enter) */
  expanded?: boolean;
  members?: MentionCandidate[];
  /** 수정할 때의 처음 문서와 그 메시지의 첨부(본문 속 사진 주소를 찾는다) */
  initialDoc?: RichNode;
  initialAttachments?: Attachment[];
  onSubmit: () => void;
  /** 붙여넣거나 끌어놓은 것 중 사진이 아닌 파일 — 첨부 목록으로 */
  onFiles?: (files: File[]) => void;
  /** 내용이 바뀔 때(비었는지) */
  onEmptyChange?: (empty: boolean) => void;
  /** 편집 영역 최대 높이(px) */
  maxHeight?: number;
  /** 서식 도구 막대를 그릴 자리(입력창 위 한 줄). 없으면 편집 영역 바로 위에 그린다. */
  toolbarContainer?: HTMLElement | null;
}

/** 본문 속 사진 — 저장할 때는 attachmentId 로 첨부를 가리키고, 편집 중에는 src 로 미리 보여 준다 */
const ChatImage = Image.extend({
  inline: true,
  group: 'inline',
  draggable: false,
  addAttributes() {
    return {
      ...this.parent?.(),
      attachmentId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-attachment-id'),
        renderHTML: (attrs) => (attrs.attachmentId ? { 'data-attachment-id': attrs.attachmentId } : {}),
      },
    };
  },
});

const newImageId = () => `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** 화면 배율(body zoom) — 고정 위치 팝업 좌표를 맞추는 데 쓴다 */
const fontScale = () => {
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--font-scale'));
  return Number.isFinite(v) && v > 0 ? v : 1;
};

/** 편집 문서 → 저장 문서: 사진의 미리보기 주소(src)는 빼고 첨부 id 만 남긴다 */
function stripImageSrc(node: RichNode): RichNode {
  const out: RichNode = { ...node };
  if (node.type === 'image') out.attrs = { attachmentId: node.attrs?.attachmentId };
  if (node.content) out.content = node.content.map(stripImageSrc);
  return out;
}

/** 저장 문서 → 편집 문서: 사진에 첨부 주소를 붙인다 */
function withImageSrc(node: RichNode, urlOf: (id: string) => string | undefined): RichNode {
  const out: RichNode = { ...node };
  if (node.type === 'image') {
    const id = String(node.attrs?.attachmentId ?? '');
    out.attrs = { attachmentId: id, src: urlOf(id) ?? '' };
  }
  if (node.content) out.content = node.content.map((c) => withImageSrc(c, urlOf));
  return out;
}

interface MentionState {
  items: MentionCandidate[];
  index: number;
  rect: DOMRect | null;
  command: (attrs: { id: string; label: string }) => void;
}

/**
 * 메신저 서식 입력창 (Teams 방식) — TipTap.
 * - 서식: 굵게·기울임·밑줄·취소선, 제목, 목록, 인용, 코드·코드 블록, 링크, 표
 * - 마크다운 단축 입력: **굵게**, *기울임*, ~~취소선~~, `코드`, ``` 코드 블록, # 제목, > 인용, - 목록, 1. 목록
 * - 사진: 붙여넣기·끌어놓기·첨부 버튼 → 커서 자리에 들어간다(본문 속 사진)
 * - @멘션: 방 참여자 목록에서 고른다
 * - Enter 전송 / Shift+Enter 줄바꿈. 목록·코드 블록·표 안에서는 Enter 가 줄바꿈이다.
 *   확장 모드에서는 Enter 가 줄바꿈이고 Ctrl+Enter 로 보낸다.
 */
export const ChatRichEditor = forwardRef<ChatRichEditorHandle, ChatRichEditorProps>(function ChatRichEditor(
  { placeholder, disabled, expanded = false, members = [], initialDoc, initialAttachments, onSubmit, onFiles, onEmptyChange, maxHeight = 160, toolbarContainer },
  ref,
) {
  /** 아직 올리지 않은 사진: id → 파일 / 미리보기 주소 */
  const pendingRef = useRef(new Map<string, { file: File; url: string }>());
  const membersRef = useRef(members);
  membersRef.current = members;
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  const submitRef = useRef(onSubmit);
  submitRef.current = onSubmit;
  const onFilesRef = useRef(onFiles);
  onFilesRef.current = onFiles;
  const placeholderRef = useRef(placeholder);
  placeholderRef.current = placeholder;

  const [mention, setMention] = useState<MentionState | null>(null);
  const mentionRef = useRef<MentionState | null>(null);
  const setMentionState = (next: MentionState | null) => {
    mentionRef.current = next;
    setMention(next);
  };

  /** Enter 전송 규칙 */
  const SubmitKeys = Extension.create({
    name: 'chatSubmitKeys',
    priority: 1000,
    addKeyboardShortcuts() {
      return {
        'Mod-Enter': () => {
          submitRef.current();
          return true;
        },
        Enter: ({ editor }) => {
          if (expandedRef.current || mentionRef.current) return false;
          // 목록·코드 블록·표 안에서는 줄바꿈(기본 동작)
          if (editor.isActive('codeBlock') || editor.isActive('listItem') || editor.isActive('table')) return false;
          submitRef.current();
          return true;
        },
      };
    },
  });

  const insertImageFiles = (editor: Editor, files: File[]) => {
    const nodes = files.map((file) => {
      const id = newImageId();
      const url = URL.createObjectURL(file);
      pendingRef.current.set(id, { file, url });
      return { type: 'image', attrs: { src: url, alt: file.name, attachmentId: id } };
    });
    if (nodes.length) editor.chain().focus().insertContent(nodes).run();
  };

  /** 붙여넣기·끌어놓기 파일 → 사진은 본문, 나머지는 첨부 목록 */
  const routeFiles = (editor: Editor, files: File[]) => {
    const images = files.filter((f) => f.type.startsWith('image/'));
    const others = files.filter((f) => !f.type.startsWith('image/'));
    if (images.length) {
      insertImageFiles(
        editor,
        images.map((f, i) =>
          f.name && f.name !== 'image.png' ? f : new File([f], `capture_${Date.now()}_${i + 1}.${f.type.split('/')[1] || 'png'}`, { type: f.type }),
        ),
      );
    }
    if (others.length) onFilesRef.current?.(others);
  };

  const editor = useEditor({
    editable: !disabled,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false, autolink: true, defaultProtocol: 'https', HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } },
      }),
      Placeholder.configure({ placeholder: () => placeholderRef.current ?? '' }),
      ChatImage.configure({ inline: true, allowBase64: false }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Mention.configure({
        HTMLAttributes: { class: 'chat-mention' },
        suggestion: {
          char: '@',
          items: ({ query }) => {
            const q = query.trim().toLowerCase();
            return membersRef.current
              .filter((m) => !q || m.name.toLowerCase().includes(q) || (m.dept ?? '').toLowerCase().includes(q))
              .slice(0, 8);
          },
          render: () => {
            const toState = (props: SuggestionProps<MentionCandidate>, index = 0): MentionState => ({
              items: props.items,
              index: Math.min(index, Math.max(0, props.items.length - 1)),
              rect: props.clientRect?.() ?? null,
              command: (attrs) => props.command(attrs),
            });
            return {
              onStart: (props) => setMentionState(toState(props)),
              onUpdate: (props) => setMentionState(toState(props, mentionRef.current?.index ?? 0)),
              onKeyDown: ({ event }) => {
                const cur = mentionRef.current;
                if (!cur) return false;
                if (event.key === 'Escape') {
                  setMentionState(null);
                  return true;
                }
                if (!cur.items.length) return false;
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  const step = event.key === 'ArrowDown' ? 1 : -1;
                  setMentionState({ ...cur, index: (cur.index + step + cur.items.length) % cur.items.length });
                  return true;
                }
                if (event.key === 'Enter' || event.key === 'Tab') {
                  const pick = cur.items[cur.index];
                  if (pick) cur.command({ id: pick.id, label: pick.name });
                  return true;
                }
                return false;
              },
              onExit: () => setMentionState(null),
            };
          },
        },
      }),
      SubmitKeys,
    ],
    content: initialDoc ? withImageSrc(initialDoc, (id) => initialAttachments?.find((a) => a.id === id)?.url) : '',
    editorProps: {
      attributes: { class: 'chat-rich-input', 'aria-label': '메시지 입력', 'aria-multiline': 'true', role: 'textbox' },
      // 외부에서 붙여넣은 HTML 속 사진(외부 주소)은 넣지 않는다 — 사진은 파일로만
      transformPastedHTML: (html) => html.replace(/<img[^>]*>/gi, ''),
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []);
        if (!files.length) return false;
        event.preventDefault();
        routeFiles(editorRef.current!, files);
        return true;
      },
      handleDrop: (_view, event) => {
        const files = Array.from((event as DragEvent).dataTransfer?.files ?? []);
        if (!files.length) return false;
        event.preventDefault();
        routeFiles(editorRef.current!, files);
        return true;
      },
    },
    onUpdate: ({ editor: ed }) => onEmptyChange?.(ed.isEmpty),
  });
  const editorRef = useRef<Editor | null>(null);
  editorRef.current = editor;

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  // 안내 문구가 바뀌면(확장 모드 전환 등) 다시 그리게 한다
  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta('placeholderRefresh', true));
  }, [editor, placeholder]);

  useEffect(() => {
    const pending = pendingRef.current;
    return () => pending.forEach((v) => URL.revokeObjectURL(v.url));
  }, []);

  useImperativeHandle(ref, () => ({
    insertImages: (files) => editor && insertImageFiles(editor, files),
    getDraft: () => {
      const doc = stripImageSrc((editor?.getJSON() ?? { type: 'doc', content: [] }) as RichNode);
      const pendingImages = new Map<string, File>();
      pendingRef.current.forEach((v, id) => pendingImages.set(id, v.file));
      return { doc, pendingImages };
    },
    clear: () => {
      editor?.commands.clearContent(true);
      pendingRef.current.forEach((v) => URL.revokeObjectURL(v.url));
      pendingRef.current.clear();
    },
    focus: () => editor?.commands.focus('end'),
    isEmpty: () => !editor || editor.isEmpty,
  }));

  const scale = typeof window === 'undefined' ? 1 : fontScale();

  return (
    <div className="chat-rich min-w-0 flex-1">
      {expanded && editor && (toolbarContainer ? createPortal(<ChatFormatToolbar editor={editor} />, toolbarContainer) : <ChatFormatToolbar editor={editor} />)}
      <div className="menu-scroll overflow-y-auto py-1 text-ink" style={{ maxHeight }}>
        <EditorContent editor={editor} />
      </div>
      {mention && mention.rect && mention.items.length > 0 &&
        createPortal(
          <ul
            role="listbox"
            aria-label="멘션할 사람"
            style={{ left: mention.rect.left / scale, bottom: (window.innerHeight - mention.rect.top) / scale + 4 }}
            className="fixed z-[200] max-h-60 w-56 overflow-y-auto rounded-lg border border-border bg-panel py-1 shadow-xl"
          >
            {mention.items.map((m, i) => (
              <li key={m.id}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    mention.command({ id: m.id, label: m.name });
                  }}
                  className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11.5px] ${i === mention.index ? 'bg-teal-soft/50' : 'hover:bg-panel-alt'}`}
                >
                  <span className="font-bold text-ink">{m.name}</span>
                  <span className="truncate text-[10.5px] text-ink3">{[m.position, m.dept].filter(Boolean).join(' · ')}</span>
                </button>
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </div>
  );
});

/** 확장 모드의 서식 도구 막대 */
function ChatFormatToolbar({ editor }: { editor: Editor }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      heading: e.isActive('heading'),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      quote: e.isActive('blockquote'),
      code: e.isActive('code'),
      codeBlock: e.isActive('codeBlock'),
      link: e.isActive('link'),
      table: e.isActive('table'),
    }),
  });

  const btn = (active: boolean, label: string, onClick: () => void, icon: React.ReactNode) => (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`grid h-7 w-7 place-items-center rounded-md transition-colors ${active ? 'bg-teal-soft text-teal' : 'text-ink2 hover:bg-panel-alt'}`}
    >
      {icon}
    </button>
  );
  const sep = <span className="mx-0.5 h-4 w-px bg-border" />;
  const chain = () => editor.chain().focus();

  const setLink = () => {
    const prev = (editor.getAttributes('link').href as string | undefined) ?? '';
    const input = window.prompt('링크 주소 (비우면 링크 해제)', prev || 'https://');
    if (input === null) return;
    const value = input.trim();
    if (!value || value === 'https://') {
      chain().extendMarkRange('link').unsetLink().run();
      return;
    }
    const href = /^[a-z]+:/i.test(value) ? value : `https://${value}`;
    if (!isSafeHref(href)) {
      window.alert('http(s) 또는 mailto 주소만 링크로 걸 수 있습니다.');
      return;
    }
    if (editor.state.selection.empty && !s.link) {
      chain().insertContent({ type: 'text', text: value, marks: [{ type: 'link', attrs: { href } }] }).run();
    } else {
      chain().extendMarkRange('link').setLink({ href }).run();
    }
  };

  return (
    <div className="mb-1 flex flex-wrap items-center gap-0.5 border-b border-border pb-1">
      {btn(s.bold, '굵게 (Ctrl+B)', () => chain().toggleBold().run(), <Bold size={14} />)}
      {btn(s.italic, '기울임 (Ctrl+I)', () => chain().toggleItalic().run(), <Italic size={14} />)}
      {btn(s.underline, '밑줄 (Ctrl+U)', () => chain().toggleUnderline().run(), <UnderlineIcon size={14} />)}
      {btn(s.strike, '취소선', () => chain().toggleStrike().run(), <Strikethrough size={14} />)}
      {sep}
      {btn(s.heading, '제목', () => chain().toggleHeading({ level: 2 }).run(), <Heading size={14} />)}
      {btn(s.bullet, '글머리 목록', () => chain().toggleBulletList().run(), <List size={14} />)}
      {btn(s.ordered, '번호 목록', () => chain().toggleOrderedList().run(), <ListOrdered size={14} />)}
      {btn(s.quote, '인용', () => chain().toggleBlockquote().run(), <Quote size={14} />)}
      {sep}
      {btn(s.code, '코드', () => chain().toggleCode().run(), <Code size={14} />)}
      {btn(s.codeBlock, '코드 블록', () => chain().toggleCodeBlock().run(), <SquareCode size={14} />)}
      {btn(s.link, '링크', setLink, <Link2 size={14} />)}
      {sep}
      {btn(s.table, '표 넣기 (3×3)', () => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(), <TableIcon size={14} />)}
      {s.table && (
        <>
          {btn(false, '아래에 행 추가', () => chain().addRowAfter().run(), <Rows3 size={14} />)}
          {btn(false, '오른쪽에 열 추가', () => chain().addColumnAfter().run(), <Columns3 size={14} />)}
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => chain().deleteRow().run()} className="rounded-md px-1.5 py-1 text-[10.5px] font-semibold text-ink2 hover:bg-panel-alt">행 삭제</button>
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => chain().deleteColumn().run()} className="rounded-md px-1.5 py-1 text-[10.5px] font-semibold text-ink2 hover:bg-panel-alt">열 삭제</button>
          {btn(false, '표 삭제', () => chain().deleteTable().run(), <Trash2 size={14} />)}
        </>
      )}
    </div>
  );
}
