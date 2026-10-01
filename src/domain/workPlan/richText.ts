import { getEditableContent, parseWorkPlanItems } from './engine';

/**
 * 업무계획 서식(굵게·밑줄·취소선·형광펜·글자색) 표기 ↔ 편집기 문서 변환.
 *
 * 저장 형식은 **줄 단위 텍스트를 그대로 둔다.** 편집기(Tiptap)는 화면에서만 서식을 보여 주고,
 * 저장할 때 아래 표기로 되돌린다. 그래야 체크리스트 파서·진행률·체크 메타(`__c__`)·모바일이
 * 지금 모양 그대로 동작한다.
 *
 *   굵게 `**글**` · 밑줄 `++글++` · 취소선 `~~글~~` · 형광펜 `==글==` · 글자색 `{red}글{/}`
 *
 * 닫히지 않은 표기나 모르는 색 이름은 글자 그대로 둔다 — "2**3" 같은 평범한 글이 깨지지 않게.
 */

export const WORK_PLAN_COLORS = {
  red: '#dc2626',
  blue: '#2563eb',
  green: '#16a34a',
  orange: '#ea580c',
  gray: '#6b7280',
} as const;
export type WorkPlanColor = keyof typeof WORK_PLAN_COLORS;

export const WORK_PLAN_COLOR_LABELS: Record<WorkPlanColor, string> = {
  red: '빨강',
  blue: '파랑',
  green: '초록',
  orange: '주황',
  gray: '회색',
};

export interface InlineMarks {
  bold?: true;
  underline?: true;
  strike?: true;
  highlight?: true;
  color?: WorkPlanColor;
}

export interface InlineSegment {
  text: string;
  marks: InlineMarks;
}

type ToggleMark = 'bold' | 'underline' | 'strike' | 'highlight';

const TOGGLE_TOKENS: Array<[string, ToggleMark]> = [
  ['**', 'bold'],
  ['++', 'underline'],
  ['~~', 'strike'],
  ['==', 'highlight'],
];
const COLOR_OPEN = new RegExp(`^\\{(${Object.keys(WORK_PLAN_COLORS).join('|')})\\}`);
const COLOR_CLOSE = '{/}';

function sameMarks(a: InlineMarks, b: InlineMarks): boolean {
  return a.bold === b.bold && a.underline === b.underline && a.strike === b.strike
    && a.highlight === b.highlight && a.color === b.color;
}

function pushSegment(out: InlineSegment[], seg: InlineSegment): void {
  if (!seg.text) return;
  const last = out[out.length - 1];
  if (last && sameMarks(last.marks, seg.marks)) last.text += seg.text;
  else out.push({ text: seg.text, marks: { ...seg.marks } });
}

function parseInto(src: string, marks: InlineMarks, out: InlineSegment[]): void {
  let plain = '';
  let i = 0;
  const flush = () => {
    pushSegment(out, { text: plain, marks });
    plain = '';
  };

  while (i < src.length) {
    let matched = false;

    for (const [token, mark] of TOGGLE_TOKENS) {
      if (!src.startsWith(token, i)) continue;
      const close = src.indexOf(token, i + token.length);
      if (close <= i + token.length) continue; // 닫는 표기가 없거나 안이 비었다
      flush();
      parseInto(src.slice(i + token.length, close), { ...marks, [mark]: true }, out);
      i = close + token.length;
      matched = true;
      break;
    }
    if (matched) continue;

    const colorMatch = src.slice(i).match(COLOR_OPEN);
    if (colorMatch) {
      const start = i + colorMatch[0].length;
      const close = src.indexOf(COLOR_CLOSE, start);
      if (close > start) {
        flush();
        parseInto(src.slice(start, close), { ...marks, color: colorMatch[1] as WorkPlanColor }, out);
        i = close + COLOR_CLOSE.length;
        continue;
      }
    }

    plain += src[i];
    i++;
  }
  flush();
}

/** 한 줄의 표기를 서식 구간으로 나눈다. */
export function parseInlineMarks(text: string): InlineSegment[] {
  const out: InlineSegment[] = [];
  parseInto(text, {}, out);
  return out;
}

/** 서식 구간을 표기로 되돌린다. 바깥부터 글자색 → 형광펜 → 굵게 → 밑줄 → 취소선. */
export function serializeInlineSegments(segments: InlineSegment[]): string {
  return segments
    .map(({ text, marks }) => {
      let s = text;
      if (marks.strike) s = `~~${s}~~`;
      if (marks.underline) s = `++${s}++`;
      if (marks.bold) s = `**${s}**`;
      if (marks.highlight) s = `==${s}==`;
      if (marks.color) s = `{${marks.color}}${s}${COLOR_CLOSE}`;
      return s;
    })
    .join('');
}

/** 표기 기호를 걷어 낸 순수 글자 — 알림·제목처럼 서식을 못 그리는 곳에서 쓴다. */
export function stripInlineMarks(text: string): string {
  return parseInlineMarks(text).map((s) => s.text).join('');
}

/* ------------------------------------------------------------------ 편집기 문서 */

/** Tiptap JSON 문서 노드(필요한 부분만). 도메인이 편집기 패키지에 의존하지 않도록 따로 정의한다. */
export interface EditorNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: EditorNode[];
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
}

function segmentsToNodes(segments: InlineSegment[]): EditorNode[] {
  return segments.map(({ text, marks }) => {
    const nodeMarks: NonNullable<EditorNode['marks']> = [];
    if (marks.bold) nodeMarks.push({ type: 'bold' });
    if (marks.underline) nodeMarks.push({ type: 'underline' });
    if (marks.strike) nodeMarks.push({ type: 'strike' });
    if (marks.highlight) nodeMarks.push({ type: 'highlight' });
    if (marks.color) nodeMarks.push({ type: 'textStyle', attrs: { color: WORK_PLAN_COLORS[marks.color] } });
    return nodeMarks.length > 0 ? { type: 'text', text, marks: nodeMarks } : { type: 'text', text };
  });
}

function paragraph(text: string): EditorNode {
  const nodes = segmentsToNodes(parseInlineMarks(text));
  return nodes.length > 0 ? { type: 'paragraph', content: nodes } : { type: 'paragraph' };
}

const CHECKBOX_LINE = /^([-*]\s*)?\[([ xX])\]\s*(.*)$/;
const HYPHEN_LINE = /^[-*]\s*(.*)$/;

/** 저장된 업무계획 본문 → 편집기 문서. 체크 상태는 `- [x]`와 체크 메타 양쪽에서 읽는다. */
export function contentToEditorDoc(content: string): EditorNode {
  const body = getEditableContent(content);
  if (!body.trim()) return { type: 'doc', content: [{ type: 'paragraph' }] };

  const items = parseWorkPlanItems(content);
  const lines = body.split('\n');
  const blocks: EditorNode[] = [];
  let taskList: EditorNode | null = null;

  lines.forEach((line, idx) => {
    const item = items[idx];
    if (item?.isChecklist) {
      const trimmed = line.trim();
      const rest = trimmed.match(CHECKBOX_LINE)?.[3] ?? trimmed.match(HYPHEN_LINE)?.[1] ?? trimmed;
      if (!taskList) {
        taskList = { type: 'taskList', content: [] };
        blocks.push(taskList);
      }
      taskList.content!.push({ type: 'taskItem', attrs: { checked: item.completed }, content: [paragraph(rest.trim())] });
      return;
    }
    taskList = null;
    blocks.push(paragraph(line));
  });

  return { type: 'doc', content: blocks };
}

function colorNameOf(value: unknown): WorkPlanColor | undefined {
  if (typeof value !== 'string') return undefined;
  const hex = value.trim().toLowerCase();
  return (Object.keys(WORK_PLAN_COLORS) as WorkPlanColor[]).find((name) => WORK_PLAN_COLORS[name] === hex);
}

function inlineText(node: EditorNode | undefined): string {
  if (!node?.content) return '';
  const segments: InlineSegment[] = [];
  for (const child of node.content) {
    if (child.type !== 'text' || !child.text) continue;
    const marks: InlineMarks = {};
    for (const mark of child.marks ?? []) {
      if (mark.type === 'bold') marks.bold = true;
      else if (mark.type === 'underline') marks.underline = true;
      else if (mark.type === 'strike') marks.strike = true;
      else if (mark.type === 'highlight') marks.highlight = true;
      else if (mark.type === 'textStyle') {
        const color = colorNameOf(mark.attrs?.color);
        if (color) marks.color = color;
      }
    }
    pushSegment(segments, { text: child.text, marks });
  }
  return serializeInlineSegments(segments);
}

/** 편집기 문서 → 저장용 업무계획 본문. 할 일은 항상 `- [ ]`/`- [x]`로 쓴다. */
export function editorDocToContent(doc: EditorNode): string {
  const lines: string[] = [];
  for (const block of doc.content ?? []) {
    if (block.type === 'taskList') {
      for (const item of block.content ?? []) {
        const text = (item.content ?? []).map(inlineText).filter(Boolean).join(' ');
        lines.push(`- [${item.attrs?.checked ? 'x' : ' '}]${text ? ` ${text}` : ''}`);
      }
    } else {
      lines.push(inlineText(block));
    }
  }
  return lines.join('\n');
}
