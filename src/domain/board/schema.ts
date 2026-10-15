import { z } from 'zod';

export const boardSchema = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string(),
  desc: z.string(),
});

export type Board = z.infer<typeof boardSchema>;

export const postSchema = z.object({
  id: z.string(),
  boardId: z.string(),
  title: z.string(),
  content: z.string(),
  /** 화면 표시용 '이름 직급'. 본인 판별에는 authorId 를 쓴다(`rules.isPostAuthor`). */
  author: z.string(),
  /** 작성자 사용자 ID. 2026-10-15 이전 글에는 없다. */
  authorId: z.string().nullable().optional().default(null),
  /** 'YYYY-MM-DD'(한국 시간). 예전 모바일 글은 ISO 시각일 수 있어 표시는 `postDateLabel`. */
  date: z.string(),
  views: z.number().default(0),
  isPinned: z.boolean().optional().default(false),
  hasAttachment: z.boolean().optional().default(false),
  attachedFiles: z.preprocess(
    (val) => (val === null ? undefined : val),
    z.array(
      z.object({
        name: z.string(),
        size: z.string(),
        url: z.string().optional(),
        /** 저장소 경로 — 글 수정·삭제 때 파일도 지우는 데 쓴다. 2026-10-15 이전 첨부에는 없다. */
        path: z.string().optional(),
      })
    ).optional()
  ),
});

export type Post = z.infer<typeof postSchema>;
