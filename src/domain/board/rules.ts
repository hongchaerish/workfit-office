import type { Post } from './schema';

/**
 * 게시판 공용 규칙 — PC·모바일이 같이 쓴다.
 * (두 화면이 작성자·날짜 형식을 따로 정하다 어긋났던 문제를 한곳으로 모은다. 2026-10-15)
 */

/** 본인 판별에 쓰는 로그인 사용자 정보. */
export interface PostActor {
  id: string;
  name: string;
}

/**
 * 이 글의 작성자인가.
 * 작성자 ID가 있는 글은 ID로만 가린다. ID가 없는 예전 글은 작성자 문자열('이름 직급')의
 * 이름 부분이 같으면 본인으로 본다 — 승진 뒤에도 예전 글을 고칠 수 있게.
 */
export function isPostAuthor(post: Post, actor: PostActor | null | undefined): boolean {
  if (!actor) return false;
  if (post.authorId) return post.authorId === actor.id;
  const author = post.author.trim();
  const name = actor.name.trim();
  return name.length > 0 && (author === name || author.startsWith(`${name} `));
}

/** 화면 표시용 날짜 — 'YYYY-MM-DD' 와 ISO 시각이 섞여 있어도 날짜만. */
export function postDateLabel(date: string): string {
  return date.slice(0, 10);
}

/** 저장용 날짜 — 한국 시간 기준 'YYYY-MM-DD'. */
export function postDateStamp(now = new Date()): string {
  return new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

/** 작성 순서 — 날짜, 같은 날이면 ID(작성 시각 기반) 순. */
const byWritten = (a: Post, b: Post) => a.date.localeCompare(b.date) || String(a.id).localeCompare(String(b.id));

/**
 * 게시판 목록 번호 — 그 게시판의 고정 글이 아닌 글에 작성 순서대로 1부터.
 * 검색으로 목록이 줄어도 번호는 바뀌지 않는다.
 */
export function numberPosts(posts: Post[], boardId: string): Map<string, number> {
  const rows = posts.filter((post) => post.boardId === boardId && !post.isPinned).sort(byWritten);
  return new Map(rows.map((post, index) => [String(post.id), index + 1]));
}

/** 목록 정렬 — 고정 글 먼저, 그다음 최신 글 먼저. */
export function sortPostsForList(posts: Post[]): Post[] {
  return [...posts].sort((a, b) => {
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
    return byWritten(b, a);
  });
}

/** 글 수정·삭제 가능 — 작성자 본인이면서 권한그룹의 게시판 수정(또는 삭제) 권한이 있을 때. */
export function canModifyPost(post: Post, actor: PostActor | null | undefined, hasPermission: boolean): boolean {
  return hasPermission && isPostAuthor(post, actor);
}
