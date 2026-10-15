import { postSchema, type Post } from '@/domain/board/schema';
import { BOARD_POSTS_SEED } from '@/data/seeds/board.seed';
import { createCrudBackend } from '@/data/_backend/crudBackend';
import { fileStorage } from '@/shared/lib/storage';

/**
 * 게시판 Repository — DB 접근을 캡슐화하는 유일한 계층.
 * 저장은 공유 CrudBackend(VITE_DB_DRIVER)로 위임.
 */
const backend = createCrudBackend<Post>({
  coll: 'posts',
  parse: (raw) => {
    const candidate = raw && typeof raw === 'object' ? {
      ...raw,
      attachedFiles: Array.isArray((raw as any).attachedFiles) ? (raw as any).attachedFiles : undefined,
    } : raw;
    const p = postSchema.safeParse(candidate);
    if (!p.success) {
      console.error('Failed to parse post:', p.error);
      return null;
    }
    return p.data;
  },
  idOf: (p) => String(p.id),
  seed: BOARD_POSTS_SEED.map((p) => postSchema.parse(p)),
  jsonFields: ['attachedFiles'],
});

type Attachment = NonNullable<Post['attachedFiles']>[number];

/** 저장소 경로가 있는 첨부만 지운다(2026-10-15 이전 첨부는 경로가 없어 남는다). 실패해도 글 처리는 계속한다. */
async function removeFiles(files: Attachment[]): Promise<void> {
  await Promise.all(files.filter((file) => file.path).map((file) => fileStorage.remove(file.path as string).catch(() => undefined)));
}

export const boardRepo = {
  /** 전체 조회 */
  async list(): Promise<Post[]> {
    return backend.loadAll();
  },

  /** 새 글. 같은 ID가 있으면 덮지 않고 실패한다(다시 누르기·중복 저장 방지). */
  async create(item: Post): Promise<void> {
    await backend.insert(postSchema.parse(item));
  },

  /** 글 수정. 이번 수정에서 빠진 첨부 파일은 저장소에서도 지운다. */
  async update(item: Post, previous?: Post): Promise<void> {
    const next = postSchema.parse(item);
    await backend.save(next);
    const kept = new Set((next.attachedFiles ?? []).map((file) => file.path ?? file.url));
    await removeFiles((previous?.attachedFiles ?? []).filter((file) => !kept.has(file.path ?? file.url)));
  },

  /** 조회수만 올린다 — 글 전체를 다시 쓰면 그 사이 작성자가 고친 내용을 되돌린다. */
  async setViews(id: string, views: number): Promise<void> {
    await backend.patch(id, { views });
  },

  /** 삭제 — 첨부 파일도 함께 지운다. */
  async remove(post: Post): Promise<void> {
    await backend.remove(String(post.id));
    await removeFiles(post.attachedFiles ?? []);
  },
};
