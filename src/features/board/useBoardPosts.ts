import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { boardRepo } from '@/data/board/board.repo';
import type { Post } from '@/domain/board/schema';

export const BOARD_POSTS_QUERY_KEY = ['board-posts'];

export function useBoardPosts() {
  return useQuery<Post[]>({
    queryKey: BOARD_POSTS_QUERY_KEY,
    queryFn: () => boardRepo.list(),
  });
}

function useBoardMutation<TInput>(mutationFn: (input: TInput) => Promise<void>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: BOARD_POSTS_QUERY_KEY }),
  });
}

export const useCreateBoardPost = () => useBoardMutation((post: Post) => boardRepo.create(post));

export const useUpdateBoardPost = () =>
  useBoardMutation(({ post, previous }: { post: Post; previous: Post }) => boardRepo.update(post, previous));

export const useDeleteBoardPost = () => useBoardMutation((post: Post) => boardRepo.remove(post));

/** 조회수 — 목록을 다시 불러오지 않고 캐시의 해당 글만 고친다. */
export function useCountBoardView() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (post: Post) => boardRepo.setViews(String(post.id), post.views + 1),
    onSuccess: (_, post) => {
      queryClient.setQueryData<Post[]>(BOARD_POSTS_QUERY_KEY, (rows) =>
        rows?.map((row) => (row.id === post.id ? { ...row, views: post.views + 1 } : row)));
    },
  });
}
