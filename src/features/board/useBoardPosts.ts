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

export function useSaveBoardPost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (post: Post) => boardRepo.save(post),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: BOARD_POSTS_QUERY_KEY });
    },
  });
}

export function useDeleteBoardPost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => boardRepo.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: BOARD_POSTS_QUERY_KEY });
    },
  });
}
