/**
 * 업무계획(WorkPlan) 도메인 엔진
 * - 마크다운 체크리스트 파서 / 직렬화
 * - 진행률 계산
 * - 상태 태그 파싱 및 템플릿 정의
 */

export interface WorkPlanItem {
  id: string;
  raw: string;
  text: string;
  completed: boolean;
  isChecklist: boolean;
  tag?: string;
}

export interface WorkPlanProgress {
  total: number;
  completed: number;
  percent: number;
}

export interface WorkPlanTagMeta {
  tag: string;
  badgeClass: string;
  dotColor: string;
}

export const WORK_PLAN_TAGS: Record<string, WorkPlanTagMeta> = {
  '외근·출장': {
    tag: '외근·출장',
    badgeClass: 'bg-blue-500/10 text-blue-600 border border-blue-500/30 dark:text-blue-400',
    dotColor: 'bg-blue-500',
  },
  '외근': {
    tag: '외근·출장',
    badgeClass: 'bg-blue-500/10 text-blue-600 border border-blue-500/30 dark:text-blue-400',
    dotColor: 'bg-blue-500',
  },
  '출장': {
    tag: '외근·출장',
    badgeClass: 'bg-blue-500/10 text-blue-600 border border-blue-500/30 dark:text-blue-400',
    dotColor: 'bg-blue-500',
  },
  '회의': {
    tag: '회의',
    badgeClass: 'bg-purple-500/10 text-purple-600 border border-purple-500/30 dark:text-purple-400',
    dotColor: 'bg-purple-500',
  },
  '보고': {
    tag: '보고',
    badgeClass: 'bg-teal-500/10 text-teal-600 border border-teal-500/30 dark:text-teal-400',
    dotColor: 'bg-teal-500',
  },
  '집중': {
    tag: '집중',
    badgeClass: 'bg-amber-500/10 text-amber-600 border border-amber-500/30 dark:text-amber-400',
    dotColor: 'bg-amber-500',
  },
  '마감': {
    tag: '마감',
    badgeClass: 'bg-rose-500/10 text-rose-600 border border-rose-500/30 dark:text-rose-400',
    dotColor: 'bg-rose-500',
  },
  '교육': {
    tag: '교육',
    badgeClass: 'bg-indigo-500/10 text-indigo-600 border border-indigo-500/30 dark:text-indigo-400',
    dotColor: 'bg-indigo-500',
  },
};

/**
 * 태그명에 해당하는 메타데이터(뱃지 스타일, 점 색상)를 반환합니다.
 * 등록되지 않은 신규 태그인 경우에도 기본 스타일을 자동 적용합니다.
 */
export function getWorkPlanTagMeta(tag: string, customTagMap?: Record<string, WorkPlanTagMeta>): WorkPlanTagMeta {
  if (customTagMap && customTagMap[tag]) return customTagMap[tag];
  if (WORK_PLAN_TAGS[tag]) return WORK_PLAN_TAGS[tag];

  return {
    tag,
    badgeClass: 'bg-teal-500/10 text-teal-600 border border-teal-500/30 dark:text-teal-400',
    dotColor: 'bg-teal-500',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 완료 상태 저장 방식:
// 일반 텍스트 줄의 완료 여부는 content 맨 마지막 줄에 아래 형태로 숨겨서 저장합니다.
//   __c__:0,2   (완료된 비어있지 않은 일반 텍스트 줄 번호를 콤마로 나열)
// 텍스트 본문은 절대 수정하지 않으며, `- [ ]`나 `~~` 같은 기호는 붙이지 않습니다.
// 기존 마크다운 체크리스트(- [ ] / - [x])는 그대로 지원합니다.
// ─────────────────────────────────────────────────────────────────────────────

const CHECKED_META_PREFIX = '__c__:';

/**
 * content에서 완료 인덱스 메타 줄을 분리합니다.
 */
function splitContentMeta(content: string): { body: string; checkedIdxs: Set<number> } {
  if (!content) return { body: '', checkedIdxs: new Set() };
  const lines = content.split('\n');
  const lastLine = lines[lines.length - 1]?.trim() ?? '';
  if (lastLine.startsWith(CHECKED_META_PREFIX)) {
    const body = lines.slice(0, -1).join('\n');
    const idxStr = lastLine.slice(CHECKED_META_PREFIX.length).trim();
    const checkedIdxs = new Set<number>(
      idxStr
        .split(',')
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !isNaN(n)),
    );
    return { body, checkedIdxs };
  }
  return { body: content, checkedIdxs: new Set() };
}

/**
 * 텍스트 내용을 항목별(To-Do 또는 일반 라인)로 파싱합니다.
 *
 * 완료 상태 저장 관례:
 * - 기존 마크다운 체크리스트(isChecklist=true): `- [x] 텍스트` 형식 그대로
 * - 일반 텍스트 줄: content 마지막에 `__c__:0,2` 메타로만 관리. 텍스트 본문 불변.
 */
export function parseWorkPlanItems(content: string): WorkPlanItem[] {
  if (!content || !content.trim()) return [];

  const { body, checkedIdxs } = splitContentMeta(content);
  const lines = body.split('\n');

  let checklistIdx = 0;

  return lines.map((line, lineIdx) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return {
        id: `item-${lineIdx}`,
        raw: line,
        text: '',
        completed: false,
        isChecklist: false,
      };
    }

    // 1. 명시적 마크다운 체크박스 문법 감지 (- [ ] / - [x] / [ ] / [x])
    const checkMatch = trimmed.match(/^([-*]\s*)?\[([ xX])\]\s*(.*)$/);
    if (checkMatch) {
      const completed = checkMatch[2].toLowerCase() === 'x';
      let rest = checkMatch[3].trim();
      let tag: string | undefined;
      const tagMatch = rest.match(/^\[([^\[\]]+)\]\s*(.*)$/);
      if (tagMatch) {
        const rawTag = tagMatch[1].trim();
        tag = WORK_PLAN_TAGS[rawTag]?.tag ?? rawTag;
        rest = tagMatch[2].trim();
      }
      return {
        id: `item-${lineIdx}`,
        raw: line,
        text: rest || (tag ? `[${tag}]` : ''),
        completed,
        isChecklist: true,
        tag,
      };
    }

    // 2. 앞에 '-' 또는 '*' 가 붙은 경우 -> 체크박스 할 일 항목으로 인정 (공백 유무 무관)
    const hyphenMatch = trimmed.match(/^[-*]\s*(.*)$/);
    if (hyphenMatch) {
      const myIdx = checklistIdx++;
      const isCompleted = checkedIdxs.has(myIdx);

      let rest = hyphenMatch[1].trim();
      let tag: string | undefined;
      const tagMatch = rest.match(/^\[([^\[\]]+)\]\s*(.*)$/);
      if (tagMatch) {
        const rawTag = tagMatch[1].trim();
        tag = WORK_PLAN_TAGS[rawTag]?.tag ?? rawTag;
        rest = tagMatch[2].trim();
      }

      return {
        id: `item-${lineIdx}`,
        raw: line,
        text: rest || (tag ? `[${tag}]` : ''),
        completed: isCompleted,
        isChecklist: true,
        tag,
      };
    }

    // 3. 앞에 '-' 가 없는 일반 텍스트 라인 -> 체크박스 없는 순수 텍스트(메모/개요/제목)
    let rest = trimmed;
    let tag: string | undefined;
    const tagMatch = rest.match(/^\[([^\[\]]+)\]\s*(.*)$/);
    if (tagMatch) {
      const rawTag = tagMatch[1].trim();
      tag = WORK_PLAN_TAGS[rawTag]?.tag ?? rawTag;
      rest = tagMatch[2].trim();
    }

    return {
      id: `item-${lineIdx}`,
      raw: line,
      text: rest,
      completed: false,
      isChecklist: false,
      tag,
    };
  });
}

/**
 * 아이템 배열을 다시 저장용 문자열로 직렬화합니다.
 * - isChecklist=true 항목: `- [ ] / - [x]` 형식 (앞에 - 유지)
 * - 일반 텍스트 항목: raw 원본 그대로 유지 (체크박스 없음)
 */
export function serializeWorkPlanItems(items: WorkPlanItem[]): string {
  const lines = items.map((item) => {
    if (item.isChecklist) {
      const tagPrefix = item.tag ? `[${item.tag}] ` : '';
      return `- [${item.completed ? 'x' : ' '}] ${tagPrefix}${item.text}`;
    }
    return item.raw || item.text;
  });

  return lines.join('\n');
}

/**
 * 특정 인덱스의 항목 완료 상태를 토글하여 새 content 문자열을 반환합니다.
 */
export function toggleWorkPlanItem(content: string, targetIdx: number): string {
  const items = parseWorkPlanItems(content);
  if (!items[targetIdx]) return content;

  const item = items[targetIdx];
  // 체크박스 항목인 경우에만 토글
  if (item.isChecklist) {
    items[targetIdx] = { ...item, completed: !item.completed };
  }

  return serializeWorkPlanItems(items);
}

/**
 * 특정 인덱스의 개별 업무 항목을 삭제하여 새 문자열을 반환합니다.
 */
export function removeWorkPlanItem(content: string, targetIdx: number): string {
  const items = parseWorkPlanItems(content);
  if (!items[targetIdx]) return content;

  items.splice(targetIdx, 1);
  return serializeWorkPlanItems(items).trim();
}

/**
 * 새로운 업무 항목을 하나 추가하여 새 문자열을 반환합니다 (- 프리픽스 부착).
 */
export function addWorkPlanItem(content: string, text: string, tag?: string): string {
  const trimmed = content.trim();
  const tagPrefix = tag ? `[${tag}] ` : '';
  const clean = text.trim().replace(/^[-*]\s*/, '');
  const newLine = `- [ ] ${tagPrefix}${clean}`;
  return trimmed ? `${trimmed}\n${newLine}` : newLine;
}

/**
 * To-Do 체크리스트 진행률을 계산합니다 (앞에 - 가 붙은 체크박스 항목만 대상).
 */
export function calculatePlanProgress(content: string): WorkPlanProgress | null {
  const checklistItems = parseWorkPlanItems(content).filter(
    (i) => i.isChecklist && (i.text || i.tag)
  );
  if (checklistItems.length === 0) return null;

  const total = checklistItems.length;
  const completed = checklistItems.filter((i) => i.completed).length;
  const percent = Math.round((completed / total) * 100);

  return { total, completed, percent };
}

/**
 * 편집 textarea에 표시할 순수 본문 텍스트를 반환합니다 (완료 메타 줄 제거).
 */
export function getEditableContent(content: string): string {
  return splitContentMeta(content).body;
}

/**
 * 빠른 루틴 템플릿 목록
 */
export interface WorkPlanTemplate {
  id: string;
  name: string;
  desc: string;
  icon: string;
  content: string;
}

export const WORK_PLAN_TEMPLATES: WorkPlanTemplate[] = [
  {
    id: 'tpl-meeting-client',
    name: '고객사 미팅 및 협의',
    desc: '고객사 미팅 및 협의 사항 정리',
    icon: '🔵',
    content: '고객사 온·오프라인 미팅 및 요구사항 청취\n미팅 결과 정리 및 피드백 공유',
  },
  {
    id: 'tpl-meeting',
    name: '주간 정기 회의',
    desc: '부서 정기 미팅 및 안건 논의',
    icon: '🟣',
    content: '주간 부서 정기 미팅 참석\n금주 진행 현황 및 차주 계획 공유',
  },
  {
    id: 'tpl-focus',
    name: '프로젝트 집중 업무',
    desc: '집중 몰입 업무 및 태스크 완료',
    icon: '🟠',
    content: '핵심 모듈 개발 및 설계 검토\n단위 테스트 및 코드 리뷰 반영',
  },
  {
    id: 'tpl-closing',
    name: '월마감 및 정산',
    desc: '마감 실적 취합 및 결재',
    icon: '📋',
    content: '당월 실적 및 지표 데이터 취합\n결산 보고서 작성 및 전자결재 상신',
  },
];

/**
 * 편집된 순수 텍스트 본문(newBody)에 기존 content의 체크 메타를 병합합니다.
 * 편집으로 줄 수가 바뀌었다면 메타 인덱스는 초기화(완료 상태 리셋)됩니다.
 */
export function mergeCheckedMeta(newBody: string, oldContent: string): string {
  const { checkedIdxs } = splitContentMeta(oldContent);
  if (checkedIdxs.size === 0) return newBody;

  // 줄 수가 바뀌면 메타 인덱스를 그대로 쓰기 어려우므로 초기화
  const { body: oldBody } = splitContentMeta(oldContent);
  const oldPlainCount = oldBody.split('\n').filter((l) => {
    const t = l.trim();
    return t && !t.match(/^([-*]\s*)?\[([ xX])\]/);
  }).length;
  const newPlainCount = newBody.split('\n').filter((l) => {
    const t = l.trim();
    return t && !t.match(/^([-*]\s*)?\[([ xX])\]/);
  }).length;

  if (oldPlainCount !== newPlainCount) return newBody;

  // 줄 수가 같으면 기존 메타 재사용
  const validIdxs = Array.from(checkedIdxs).filter((i) => i < newPlainCount).sort((a, b) => a - b);
  if (validIdxs.length === 0) return newBody;
  return `${newBody}\n${CHECKED_META_PREFIX}${validIdxs.join(',')}`;
}
