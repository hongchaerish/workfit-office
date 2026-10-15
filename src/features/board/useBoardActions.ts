import { useState } from 'react';
import { DocumentExistsError } from '@/data/_backend/crudBackend';
import type { Post } from '@/domain/board/schema';
import { postDateStamp } from '@/domain/board/rules';
import { fileStorage } from '@/shared/lib/storage';
import {
  useCountBoardView,
  useCreateBoardPost,
  useDeleteBoardPost,
  useUpdateBoardPost,
} from './useBoardPosts';

export type BoardAttachment = NonNullable<Post['attachedFiles']>[number];

/** 글을 쓰는 사람 — 작성자 표시('이름 직급')와 본인 판별(authorId)에 쓴다. */
export interface BoardAuthor {
  id: string;
  name: string;
  position?: string | null;
}

/** 쓰기·수정 창에서 넘기는 값 */
export interface BoardPostForm {
  boardId: string;
  title: string;
  content: string;
  isPinned: boolean;
}

export const attachmentSizeLabel = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1) + ' MB';

/** 첨부 업로드 — 저장소 경로를 함께 남겨 글 수정·삭제 때 파일도 지울 수 있게 한다. */
async function uploadAttachments(files: File[]): Promise<BoardAttachment[]> {
  return Promise.all(files.map(async (file) => {
    const path = `chat/board/${crypto.randomUUID()}_${file.name}`;
    const url = await fileStorage.put(path, file, { contentType: file.type, filename: file.name });
    if (!url.trim()) throw new Error('첨부파일 주소를 받지 못했습니다.');
    return { name: file.name, size: attachmentSizeLabel(file.size), url, path };
  }));
}

const withAttachments = (files: BoardAttachment[]) => ({
  hasAttachment: files.length > 0,
  attachedFiles: files.length > 0 ? files : undefined,
});

/**
 * 게시판 쓰기·수정·삭제·조회수 — PC·모바일 공용.
 * 작성자 형식·날짜·첨부 경로·중복 등록 방지 규칙을 여기 한곳에 둔다(두 화면이 따로 정하다 어긋났던 문제).
 */
export function useBoardActions() {
  const createMutation = useCreateBoardPost();
  const updateMutation = useUpdateBoardPost();
  const deleteMutation = useDeleteBoardPost();
  const countView = useCountBoardView();
  const [saving, setSaving] = useState(false);

  /** 저장 중 다시 누르면 무시한다(첨부 업로드 중 [등록] 두 번 → 같은 글 두 건). */
  const guard = async <T>(run: () => Promise<T>): Promise<T | undefined> => {
    if (saving) return undefined;
    setSaving(true);
    try {
      return await run();
    } finally {
      setSaving(false);
    }
  };

  return {
    saving,

    /** 새 글. 반환값은 만든 글. */
    create: (author: BoardAuthor, form: BoardPostForm, files: File[]) => guard(async () => {
      const attachments = await uploadAttachments(files);
      const post: Post = {
        id: Date.now().toString(),
        boardId: form.boardId,
        title: form.title.trim(),
        content: form.content.trim(),
        author: [author.name, author.position].filter(Boolean).join(' ') || '작성자',
        authorId: author.id,
        date: postDateStamp(),
        views: 0,
        isPinned: form.isPinned,
        ...withAttachments(attachments),
      };
      try {
        await createMutation.mutateAsync(post);
      } catch (err) {
        if (!(err instanceof DocumentExistsError)) throw err;
      }
      return post;
    }),

    /** 글 수정 — kept: 남겨 둘 기존 첨부, files: 새로 붙일 파일. 뺀 첨부는 저장소에서도 지운다. */
    update: (previous: Post, form: BoardPostForm, kept: BoardAttachment[], files: File[]) => guard(async () => {
      const added = await uploadAttachments(files);
      const post: Post = {
        ...previous,
        boardId: form.boardId,
        title: form.title.trim(),
        content: form.content.trim(),
        isPinned: form.isPinned,
        ...withAttachments([...kept, ...added]),
      };
      await updateMutation.mutateAsync({ post, previous });
      return post;
    }),

    /** 삭제 — 첨부 파일도 함께 지운다. */
    remove: (post: Post) => guard(() => deleteMutation.mutateAsync(post)),

    /** 조회수 — 같은 브라우저 세션에서 같은 글은 한 번만 센다. 실패해도 화면은 막지 않는다. */
    countView: (post: Post) => {
      const key = `read_post_${post.id}`;
      try {
        if (sessionStorage.getItem(key) === 'true') return;
        sessionStorage.setItem(key, 'true');
      } catch {
        /* 저장소를 못 쓰면 매번 센다 */
      }
      countView.mutate(post, { onError: (err) => console.error('Failed to update views:', err) });
    },
  };
}
