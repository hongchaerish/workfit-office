/**
 * 메신저 서식 본문(rich) — 저장 형식과 규칙.
 *
 * 메시지 1건 = 서식 본문(body) + 첨부 목록(attachments). 본문 속 사진은 attachments[].id 를
 * 가리킨다(Teams 방식). 본문은 편집기(TipTap) 문서 JSON 의 **허용 목록 부분집합**이다 —
 * HTML 을 저장·주입하지 않으므로, 화면은 이 구조를 읽어 React 요소로만 그린다.
 *
 * - 저장 전·그리기 전에 모두 sanitizeRichDoc 를 거친다(모르는 노드·마크·위험한 링크 제거).
 * - 검색·알림·방 목록 미리보기·답장 인용은 plainTextOfRich 요약(메시지의 text)을 쓴다.
 */

export interface RichMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface RichNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: RichNode[];
  marks?: RichMark[];
  text?: string;
}

/** 본문에 둘 수 있는 블록·인라인 노드 */
export const RICH_NODE_TYPES = [
  'doc', 'paragraph', 'text', 'hardBreak', 'heading', 'bulletList', 'orderedList', 'listItem',
  'blockquote', 'codeBlock', 'horizontalRule', 'table', 'tableRow', 'tableHeader', 'tableCell', 'image', 'mention',
] as const;
/** 글자 꾸밈 */
export const RICH_MARK_TYPES = ['bold', 'italic', 'underline', 'strike', 'code', 'link'] as const;

/** 저장할 본문(JSON 문자열) 상한 — DB 속성 크기 안쪽 */
export const RICH_BODY_MAX_CHARS = 100_000;
/** 메시지 text(요약) 상한 — DB 속성 크기 */
export const RICH_SUMMARY_MAX_CHARS = 4000;

const NODE_SET = new Set<string>(RICH_NODE_TYPES);
const MARK_SET = new Set<string>(RICH_MARK_TYPES);
const MAX_DEPTH = 24;

/** 링크로 허용하는 주소 — javascript: 같은 실행형 주소는 막는다 */
export function isSafeHref(href: unknown): href is string {
  return typeof href === 'string' && /^(https?:\/\/|mailto:)/i.test(href.trim());
}

function sanitizeMarks(marks: RichMark[] | undefined): RichMark[] | undefined {
  if (!marks?.length) return undefined;
  const out: RichMark[] = [];
  for (const m of marks) {
    if (!MARK_SET.has(m.type)) continue;
    if (m.type === 'link') {
      if (!isSafeHref(m.attrs?.href)) continue;
      out.push({ type: 'link', attrs: { href: String(m.attrs!.href).trim() } });
    } else {
      out.push({ type: m.type });
    }
  }
  return out.length ? out : undefined;
}

function sanitizeAttrs(node: RichNode): Record<string, unknown> | undefined {
  const a = node.attrs ?? {};
  switch (node.type) {
    case 'heading': {
      const level = Number(a.level);
      return { level: level >= 1 && level <= 3 ? level : 2 };
    }
    case 'orderedList': {
      const start = Number(a.start);
      return { start: Number.isInteger(start) && start > 0 ? start : 1 };
    }
    case 'codeBlock':
      return typeof a.language === 'string' && /^[\w+#-]{1,20}$/.test(a.language) ? { language: a.language } : undefined;
    case 'image':
      return { attachmentId: String(a.attachmentId) };
    case 'mention':
      return { id: String(a.id ?? ''), label: String(a.label ?? '') };
    case 'tableCell':
    case 'tableHeader': {
      const colspan = Number(a.colspan);
      const rowspan = Number(a.rowspan);
      return {
        colspan: Number.isInteger(colspan) && colspan > 0 ? Math.min(colspan, 20) : 1,
        rowspan: Number.isInteger(rowspan) && rowspan > 0 ? Math.min(rowspan, 50) : 1,
      };
    }
    default:
      return undefined;
  }
}

function sanitizeNode(node: RichNode, depth: number): RichNode | null {
  if (!node || typeof node !== 'object' || !NODE_SET.has(node.type) || depth > MAX_DEPTH) return null;
  if (node.type === 'text') {
    if (typeof node.text !== 'string' || node.text === '') return null;
    const marks = sanitizeMarks(node.marks);
    return marks ? { type: 'text', text: node.text, marks } : { type: 'text', text: node.text };
  }
  // 사진은 이 메시지의 첨부를 가리킬 때만 — 외부 주소(src)는 저장하지 않는다
  if (node.type === 'image' && typeof node.attrs?.attachmentId !== 'string') return null;
  if (node.type === 'mention' && typeof node.attrs?.id !== 'string') return null;
  const out: RichNode = { type: node.type };
  const attrs = sanitizeAttrs(node);
  if (attrs) out.attrs = attrs;
  if (Array.isArray(node.content)) {
    const content = node.content.map((c) => sanitizeNode(c, depth + 1)).filter((c): c is RichNode => c !== null);
    if (content.length) out.content = content;
  }
  return out;
}

/** 허용 목록 밖의 노드·마크·위험한 링크를 걷어낸 문서. 문서가 아니면 빈 문서. */
export function sanitizeRichDoc(doc: unknown): RichNode {
  const clean = doc && typeof doc === 'object' ? sanitizeNode(doc as RichNode, 0) : null;
  return clean && clean.type === 'doc' ? clean : { type: 'doc', content: [] };
}

/** 저장된 본문 문자열 → 정리된 문서(깨진 JSON 이면 빈 문서) */
export function parseRichBody(body: string | null | undefined): RichNode {
  if (!body) return { type: 'doc', content: [] };
  try {
    return sanitizeRichDoc(JSON.parse(body));
  } catch {
    return { type: 'doc', content: [] };
  }
}

const BLOCKS = new Set(['paragraph', 'heading', 'listItem', 'codeBlock', 'blockquote', 'tableRow', 'horizontalRule']);

/** 본문 평문 요약 — 사진은 [사진], 멘션은 @이름, 표는 칸을 | 로 잇는다 */
export function plainTextOfRich(doc: RichNode): string {
  const lines: string[] = [];
  let cur = '';
  const newline = () => {
    lines.push(cur);
    cur = '';
  };
  const walk = (n: RichNode) => {
    switch (n.type) {
      case 'text':
        cur += n.text ?? '';
        return;
      case 'hardBreak':
        newline();
        return;
      case 'image':
        cur += '[사진]';
        return;
      case 'mention':
        cur += `@${String(n.attrs?.label ?? '')}`;
        return;
      case 'bulletList':
      case 'orderedList': {
        const start = Number(n.attrs?.start) || 1;
        (n.content ?? []).forEach((li, i) => {
          if (cur) newline();
          cur += n.type === 'bulletList' ? '• ' : `${start + i}. `;
          li.content?.forEach(walk);
          if (cur) newline();
        });
        return;
      }
      case 'tableRow':
        (n.content ?? []).forEach((cell, i) => {
          if (i > 0) cur += ' | ';
          (cell.content ?? []).forEach((c, j) => {
            if (j > 0) cur += ' ';
            c.content?.forEach(walk);
          });
        });
        newline();
        return;
      default:
        n.content?.forEach(walk);
        if (BLOCKS.has(n.type) && cur) newline();
    }
  };
  walk(doc);
  if (cur) newline();
  return lines.map((l) => l.trimEnd()).join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, RICH_SUMMARY_MAX_CHARS);
}

/** 본문이 가리키는 사진 첨부 id 들(본문 순서) */
export function imageIdsOfRich(doc: RichNode): string[] {
  const ids: string[] = [];
  const walk = (n: RichNode) => {
    if (n.type === 'image' && typeof n.attrs?.attachmentId === 'string') ids.push(n.attrs.attachmentId);
    n.content?.forEach(walk);
  };
  walk(doc);
  return ids;
}

/** 본문에서 @멘션한 사용자 id(중복 제거) */
export function mentionIdsOfRich(doc: RichNode): string[] {
  const ids = new Set<string>();
  const walk = (n: RichNode) => {
    if (n.type === 'mention' && typeof n.attrs?.id === 'string' && n.attrs.id) ids.add(n.attrs.id);
    n.content?.forEach(walk);
  };
  walk(doc);
  return [...ids];
}

/** 글자만 있는 본문인가 — 꾸밈·목록·표·사진·멘션이 하나도 없으면 예전처럼 평문 메시지로 보낸다 */
export function isPlainOnlyRich(doc: RichNode): boolean {
  return (doc.content ?? []).every(
    (block) =>
      block.type === 'paragraph' &&
      (block.content ?? []).every((n) => (n.type === 'text' && !n.marks?.length) || n.type === 'hardBreak'),
  );
}

/** 보낼 내용이 없는가(빈 문단만) */
export function isEmptyRich(doc: RichNode): boolean {
  return !plainTextOfRich(doc) && imageIdsOfRich(doc).length === 0;
}
