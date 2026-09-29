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

/**
 * 텍스트 내용을 항목별(To-Do 또는 일반 라인)로 파싱합니다.
 */
export function parseWorkPlanItems(content: string): WorkPlanItem[] {
  if (!content || !content.trim()) return [];

  const lines = content.split('\n');
  return lines.map((line, idx) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return {
        id: `item-${idx}`,
        raw: line,
        text: '',
        completed: false,
        isChecklist: false,
      };
    }

    // 체크박스 문법 감지 (- [ ] / - [x] / [ ] / [x])
    const checkMatch = trimmed.match(/^([-*]\s*)?\[([ xX])\]\s*(.*)$/);
    if (checkMatch) {
      const completed = checkMatch[2].toLowerCase() === 'x';
      let rest = checkMatch[3].trim();
      let tag: string | undefined;

      // 태그 감지 ([외근], [회의] 등)
      const tagMatch = rest.match(/^\[([^[\]]+)\]\s*(.*)$/);
      if (tagMatch) {
        const rawTag = tagMatch[1].trim();
        tag = WORK_PLAN_TAGS[rawTag]?.tag ?? rawTag;
        rest = tagMatch[2].trim();
      }

      return {
        id: `item-${idx}`,
        raw: line,
        text: rest || (tag ? `[${tag}]` : ''),
        completed,
        isChecklist: true,
        tag,
      };
    }

    // 일반 텍스트 라인
    let rest = trimmed;
    let tag: string | undefined;
    const tagMatch = rest.match(/^\[([^[\]]+)\]\s*(.*)$/);
    if (tagMatch) {
      const rawTag = tagMatch[1].trim();
      tag = WORK_PLAN_TAGS[rawTag]?.tag ?? rawTag;
      rest = tagMatch[2].trim();
    }

    return {
      id: `item-${idx}`,
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
 */
export function serializeWorkPlanItems(items: WorkPlanItem[]): string {
  return items
    .map((item) => {
      if (!item.text && !item.tag && !item.isChecklist) return item.raw;
      const tagPrefix = item.tag ? `[${item.tag}] ` : '';
      if (item.isChecklist) {
        return `- [${item.completed ? 'x' : ' '}] ${tagPrefix}${item.text}`;
      }
      return `${tagPrefix}${item.text}`;
    })
    .join('\n');
}

/**
 * 특정 인덱스의 체크리스트 항목을 토글하여 새 문자열을 반환합니다.
 */
export function toggleWorkPlanItem(content: string, targetIdx: number): string {
  const items = parseWorkPlanItems(content);
  if (!items[targetIdx]) return content;

  const item = items[targetIdx];
  if (item.isChecklist) {
    items[targetIdx] = { ...item, completed: !item.completed };
  } else {
    // 일반 텍스트를 체크리스트로 전환
    items[targetIdx] = { ...item, isChecklist: true, completed: true };
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
  const result = serializeWorkPlanItems(items).trim();
  return result;
}

/**
 * 새로운 업무 항목을 하나 추가하여 새 문자열을 반환합니다.
 */
export function addWorkPlanItem(content: string, text: string, tag?: string): string {
  const trimmed = content.trim();
  const tagPrefix = tag ? `[${tag}] ` : '';
  const newLine = `${tagPrefix}${text.trim()}`;
  return trimmed ? `${trimmed}\n${newLine}` : newLine;
}

/**
 * To-Do 체크리스트 진행률을 계산합니다 (모든 업무 항목 대상).
 */
export function calculatePlanProgress(content: string): WorkPlanProgress | null {
  const items = parseWorkPlanItems(content).filter((i) => i.text || i.tag);
  if (items.length === 0) return null;

  const total = items.length;
  const completed = items.filter((i) => i.completed).length;
  const percent = Math.round((completed / total) * 100);

  return { total, completed, percent };
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
