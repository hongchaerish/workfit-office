import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/app/auth/AuthProvider';
import {
  type WorkPlanTemplate,
  type WorkPlanTagMeta,
  WORK_PLAN_TEMPLATES,
  WORK_PLAN_TAGS,
} from '@/domain/workPlan/engine';

const BASE_TEMPLATES_KEY = 'workfit:workplan:templates';
const BASE_TAGS_KEY = 'workfit:workplan:tags';
const CONFIG_CHANGE_EVENT = 'workfit:workplan:config_change';

function getTemplatesKey(userId: string): string {
  return `${BASE_TEMPLATES_KEY}:${userId}`;
}

function getTagsKey(userId: string): string {
  return `${BASE_TAGS_KEY}:${userId}`;
}

export interface TagColorPreset {
  id: string;
  label: string;
  badgeClass: string;
  dotColor: string;
}

export const TAG_COLOR_PRESETS: TagColorPreset[] = [
  {
    id: 'blue',
    label: '블루',
    badgeClass: 'bg-blue-500/10 text-blue-600 border border-blue-500/30 dark:text-blue-400',
    dotColor: 'bg-blue-500',
  },
  {
    id: 'purple',
    label: '퍼플',
    badgeClass: 'bg-purple-500/10 text-purple-600 border border-purple-500/30 dark:text-purple-400',
    dotColor: 'bg-purple-500',
  },
  {
    id: 'teal',
    label: '틸/청록',
    badgeClass: 'bg-teal-500/10 text-teal-600 border border-teal-500/30 dark:text-teal-400',
    dotColor: 'bg-teal-500',
  },
  {
    id: 'amber',
    label: '오렌지/앰버',
    badgeClass: 'bg-amber-500/10 text-amber-600 border border-amber-500/30 dark:text-amber-400',
    dotColor: 'bg-amber-500',
  },
  {
    id: 'rose',
    label: '로즈/레드',
    badgeClass: 'bg-rose-500/10 text-rose-600 border border-rose-500/30 dark:text-rose-400',
    dotColor: 'bg-rose-500',
  },
  {
    id: 'emerald',
    label: '에메랄드/그린',
    badgeClass: 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/30 dark:text-emerald-400',
    dotColor: 'bg-emerald-500',
  },
  {
    id: 'indigo',
    label: '인디고',
    badgeClass: 'bg-indigo-500/10 text-indigo-600 border border-indigo-500/30 dark:text-indigo-400',
    dotColor: 'bg-indigo-500',
  },
  {
    id: 'pink',
    label: '핑크',
    badgeClass: 'bg-pink-500/10 text-pink-600 border border-pink-500/30 dark:text-pink-400',
    dotColor: 'bg-pink-500',
  },
  {
    id: 'slate',
    label: '그레이',
    badgeClass: 'bg-slate-500/10 text-slate-600 border border-slate-500/30 dark:text-slate-400',
    dotColor: 'bg-slate-500',
  },
];

export interface WorkPlanCustomTag {
  tag: string;
  colorId: string;
  badgeClass: string;
  dotColor: string;
}

const DEFAULT_CUSTOM_TAGS: WorkPlanCustomTag[] = [
  {
    tag: '미팅',
    colorId: 'blue',
    badgeClass: 'bg-blue-500/10 text-blue-600 border border-blue-500/30 dark:text-blue-400',
    dotColor: 'bg-blue-500',
  },
  {
    tag: '회의',
    colorId: 'purple',
    badgeClass: 'bg-purple-500/10 text-purple-600 border border-purple-500/30 dark:text-purple-400',
    dotColor: 'bg-purple-500',
  },
  {
    tag: '보고',
    colorId: 'teal',
    badgeClass: 'bg-teal-500/10 text-teal-600 border border-teal-500/30 dark:text-teal-400',
    dotColor: 'bg-teal-500',
  },
  {
    tag: '집중',
    colorId: 'amber',
    badgeClass: 'bg-amber-500/10 text-amber-600 border border-amber-500/30 dark:text-amber-400',
    dotColor: 'bg-amber-500',
  },
  {
    tag: '마감',
    colorId: 'rose',
    badgeClass: 'bg-rose-500/10 text-rose-600 border border-rose-500/30 dark:text-rose-400',
    dotColor: 'bg-rose-500',
  },
  {
    tag: '교육',
    colorId: 'indigo',
    badgeClass: 'bg-indigo-500/10 text-indigo-600 border border-indigo-500/30 dark:text-indigo-400',
    dotColor: 'bg-indigo-500',
  },
];

/**
 * 템플릿 본문에서 마크다운 체크박스(- [ ]) 및 대괄호 태그([태그])를 제거하여 순수 기본 텍스트로 정제합니다.
 */
export function stripMarkdownAndTags(content: string): string {
  if (!content) return '';
  return content
    .split('\n')
    .map((line) => {
      // 1. 체크박스 문법 제거: - [ ] / - [x] / [ ] / [x]
      let clean = line.replace(/^([-*]\s*)?\[[ xX]\]\s*/, '');
      // 2. 태그 문법 제거: [보고] / [회의] / [집중] / [마감] 등 (시간 패턴 예: (09:00~10:00)은 보존)
      clean = clean.replace(/^\[([^\]]+)\]\s*/, '');
      return clean;
    })
    .join('\n');
}

function readTemplates(userId: string): WorkPlanTemplate[] {
  try {
    const raw = localStorage.getItem(getTemplatesKey(userId)) ?? localStorage.getItem(BASE_TEMPLATES_KEY);
    const source = raw ? JSON.parse(raw) : WORK_PLAN_TEMPLATES;
    if (Array.isArray(source) && source.length > 0) {
      return source.map((tpl: WorkPlanTemplate) => ({
        ...tpl,
        content: stripMarkdownAndTags(tpl.content),
      }));
    }
    return WORK_PLAN_TEMPLATES;
  } catch {
    return WORK_PLAN_TEMPLATES;
  }
}

function writeTemplates(userId: string, templates: WorkPlanTemplate[]) {
  try {
    localStorage.setItem(getTemplatesKey(userId), JSON.stringify(templates));
    window.dispatchEvent(new CustomEvent(CONFIG_CHANGE_EVENT, { detail: { userId } }));
  } catch {
    // ignore
  }
}

function readTags(userId: string): WorkPlanCustomTag[] {
  try {
    const raw = localStorage.getItem(getTagsKey(userId)) ?? localStorage.getItem(BASE_TAGS_KEY);
    if (!raw) return DEFAULT_CUSTOM_TAGS;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    return DEFAULT_CUSTOM_TAGS;
  } catch {
    return DEFAULT_CUSTOM_TAGS;
  }
}

function writeTags(userId: string, tags: WorkPlanCustomTag[]) {
  try {
    localStorage.setItem(getTagsKey(userId), JSON.stringify(tags));
    window.dispatchEvent(new CustomEvent(CONFIG_CHANGE_EVENT, { detail: { userId } }));
  } catch {
    // ignore
  }
}

/**
 * 사용자별(User-specific) 루틴 템플릿 및 업무 태그 관리 훅
 * - 직무 및 개인별로 다른 루틴과 태그 세트를 가집니다.
 * - 로그인한 사용자(actor) 계정별로 완전 격리 저장됩니다.
 */
export function useWorkPlanConfig(overrideUserId?: string) {
  const { user } = useAuth();
  const userId = overrideUserId || user?.id || 'common';

  const [templates, setTemplates] = useState<WorkPlanTemplate[]>(() => readTemplates(userId));
  const [tags, setTags] = useState<WorkPlanCustomTag[]>(() => readTags(userId));

  useEffect(() => {
    setTemplates(readTemplates(userId));
    setTags(readTags(userId));
  }, [userId]);

  useEffect(() => {
    const handleUpdate = (e: Event) => {
      const customEvt = e as CustomEvent<{ userId?: string }>;
      // 동일 사용자 이벤트이거나 브라우저 storage 이벤트인 경우 갱신
      if (!customEvt.detail?.userId || customEvt.detail.userId === userId) {
        setTemplates(readTemplates(userId));
        setTags(readTags(userId));
      }
    };

    window.addEventListener(CONFIG_CHANGE_EVENT, handleUpdate);
    window.addEventListener('storage', handleUpdate);
    return () => {
      window.removeEventListener(CONFIG_CHANGE_EVENT, handleUpdate);
      window.removeEventListener('storage', handleUpdate);
    };
  }, [userId]);

  // 태그 맵 변환 (tags 변경 시 실시간 재계산)
  const tagMap = useMemo(() => {
    const map: Record<string, WorkPlanTagMeta> = { ...WORK_PLAN_TAGS };
    tags.forEach((t) => {
      map[t.tag] = {
        tag: t.tag,
        badgeClass: t.badgeClass,
        dotColor: t.dotColor,
      };
    });
    return map;
  }, [tags]);

  // --- 템플릿 관리 액션 ---
  const addTemplate = useCallback((tpl: Omit<WorkPlanTemplate, 'id'>) => {
    const newTpl: WorkPlanTemplate = {
      ...tpl,
      id: `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    };
    const next = [...readTemplates(userId), newTpl];
    writeTemplates(userId, next);
    setTemplates(next);
  }, [userId]);

  const updateTemplate = useCallback((id: string, updates: Partial<Omit<WorkPlanTemplate, 'id'>>) => {
    const current = readTemplates(userId);
    const next = current.map((t) => (t.id === id ? { ...t, ...updates } : t));
    writeTemplates(userId, next);
    setTemplates(next);
  }, [userId]);

  const deleteTemplate = useCallback((id: string) => {
    const current = readTemplates(userId);
    const next = current.filter((t) => t.id !== id);
    writeTemplates(userId, next);
    setTemplates(next);
  }, [userId]);

  const resetTemplates = useCallback(() => {
    writeTemplates(userId, WORK_PLAN_TEMPLATES);
    setTemplates(WORK_PLAN_TEMPLATES);
  }, [userId]);

  // --- 태그 관리 액션 ---
  const addTag = useCallback((tagName: string, colorId: string) => {
    const cleanTag = tagName.trim();
    if (!cleanTag) return;
    const preset = TAG_COLOR_PRESETS.find((p) => p.id === colorId) || TAG_COLOR_PRESETS[0];
    const newTag: WorkPlanCustomTag = {
      tag: cleanTag,
      colorId: preset.id,
      badgeClass: preset.badgeClass,
      dotColor: preset.dotColor,
    };
    const current = readTags(userId);
    const next = [...current.filter((t) => t.tag !== cleanTag), newTag];
    writeTags(userId, next);
    setTags(next);
  }, [userId]);

  const updateTag = useCallback((oldTag: string, newTagName: string, colorId: string) => {
    const cleanTag = newTagName.trim();
    if (!cleanTag) return;
    const preset = TAG_COLOR_PRESETS.find((p) => p.id === colorId) || TAG_COLOR_PRESETS[0];
    const current = readTags(userId);
    const next = current.map((t) =>
      t.tag === oldTag
        ? {
            tag: cleanTag,
            colorId: preset.id,
            badgeClass: preset.badgeClass,
            dotColor: preset.dotColor,
          }
        : t
    );
    writeTags(userId, next);
    setTags(next);
  }, [userId]);

  const deleteTag = useCallback((tagName: string) => {
    const current = readTags(userId);
    const next = current.filter((t) => t.tag !== tagName);
    writeTags(userId, next);
    setTags(next);
  }, [userId]);

  const resetTags = useCallback(() => {
    writeTags(userId, DEFAULT_CUSTOM_TAGS);
    setTags(DEFAULT_CUSTOM_TAGS);
  }, [userId]);

  return {
    userId,
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
  };
}
