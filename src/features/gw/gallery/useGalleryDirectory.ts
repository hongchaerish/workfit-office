import { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/app/auth/AuthProvider';
import { galleryRepo } from '@/data/gallery/gallery.repo';
import type { GalleryFolder, GalleryPhoto } from '@/domain/gallery/schema';
import { fileStorage } from '@/shared/lib/storage';
import { buildFolderPath, collectFolderSubtree, folderDeletionOrder, planFolderRename } from '@/domain/gallery/folderRules';

/** 폴더 삭제 확인창에 보여줄 범위 */
export interface FolderDeletionScope {
  folder: GalleryFolder;
  subFolders: GalleryFolder[];
  photoCount: number;
}

export interface FolderTreeNode extends GalleryFolder {
  children: FolderTreeNode[];
  photoCount: number;
  totalPhotoCount: number;
}

export interface BreadcrumbItem {
  id: string | null;
  name: string;
}

const QUERY_KEY_FOLDERS = ['gw', 'gallery', 'folders'];
const QUERY_KEY_PHOTOS = ['gw', 'gallery', 'photos'];

export function useGalleryDirectory() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // ── 1. 서버 데이터 쿼리 ──
  const { data: folders = [], isLoading: isFoldersLoading } = useQuery({
    queryKey: QUERY_KEY_FOLDERS,
    queryFn: () => galleryRepo.listFolders(),
    staleTime: 1000 * 60 * 5, // 5분
  });

  const { data: photos = [], isLoading: isPhotosLoading } = useQuery({
    queryKey: QUERY_KEY_PHOTOS,
    queryFn: () => galleryRepo.listPhotos(),
    staleTime: 1000 * 60 * 5,
  });

  // ── 2. 현재 선택된 폴더 ID (null이면 전체/루트) ──
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);

  // ── 3. 검색 및 정렬 ──
  const [keyword, setKeyword] = useState('');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  // ── 4. 폴더별 직접 사진 개수 집계 맵 ──
  const photoCountMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of photos) {
      map[p.folderId] = (map[p.folderId] || 0) + 1;
    }
    return map;
  }, [photos]);

  // ── 5. 계층형 트리 빌더 (재귀) ──
  const folderTree = useMemo(() => {
    // 부모-자식 맵 구축
    const parentMap = new Map<string | null, GalleryFolder[]>();
    for (const f of folders) {
      const pid = f.parentId || null;
      if (!parentMap.has(pid)) parentMap.set(pid, []);
      parentMap.get(pid)!.push(f);
    }

    // 트리 생성 함수 (하위 사진 개수 포함)
    function buildNode(folder: GalleryFolder): FolderTreeNode {
      const childrenRaw = parentMap.get(folder.id) || [];
      // 정렬 순서 -> 이름 순
      childrenRaw.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
      const children = childrenRaw.map(buildNode);

      const directCount = photoCountMap[folder.id] || 0;
      const childTotal = children.reduce((sum, c) => sum + c.totalPhotoCount, 0);

      return {
        ...folder,
        children,
        photoCount: directCount,
        totalPhotoCount: directCount + childTotal,
      };
    }

    const roots = parentMap.get(null) || [];
    roots.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
    return roots.map(buildNode);
  }, [folders, photoCountMap]);

  // ── 6. 현재 선택된 폴더 객체 ──
  const currentFolder = useMemo((): GalleryFolder | null => {
    if (!currentFolderId) return null;
    return folders.find((f) => f.id === currentFolderId) || null;
  }, [folders, currentFolderId]);

  // ── 7. 브레드크럼(경로) 역추적 계산 ──
  const breadcrumbs = useMemo((): BreadcrumbItem[] => {
    const list: BreadcrumbItem[] = [{ id: null, name: '회사 갤러리' }];
    if (!currentFolderId) return list;

    const folderMap = new Map<string, GalleryFolder>(folders.map((f) => [f.id, f]));
    const chain: BreadcrumbItem[] = [];
    let cur: GalleryFolder | undefined = folderMap.get(currentFolderId);

    while (cur) {
      chain.unshift({ id: cur.id, name: cur.name });
      cur = cur.parentId ? folderMap.get(cur.parentId) : undefined;
    }

    return [...list, ...chain];
  }, [folders, currentFolderId]);

  // ── 8. 현재 폴더의 직속 하위 폴더들 ──
  const subFolders = useMemo(() => {
    return folders
      .filter((f) => (currentFolderId === null ? f.parentId === null : f.parentId === currentFolderId))
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  }, [folders, currentFolderId]);

  // ── 9. 현재 폴더에 소속된 사진들 (검색어 및 정렬 적용) ──
  const currentPhotos = useMemo(() => {
    let list = photos;

    if (currentFolderId !== null) {
      // 상위 폴더에서는 하위 폴더 사진까지 함께 보여준다 (트리의 '하위 포함' 장수와 일치)
      const ids = new Set(collectFolderSubtree(folders, currentFolderId).map((f) => f.id));
      ids.add(currentFolderId);
      list = list.filter((p) => ids.has(p.folderId));
    }

    const q = keyword.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          p.caption?.toLowerCase().includes(q) ||
          p.authorName.toLowerCase().includes(q) ||
          p.fileName.toLowerCase().includes(q) ||
          p.eventDate.includes(q),
      );
    }

    list.sort((a, b) => {
      const cmp = a.eventDate.localeCompare(b.eventDate) || a.createdAt.localeCompare(b.createdAt);
      return sortOrder === 'desc' ? -cmp : cmp;
    });

    return list;
  }, [photos, folders, currentFolderId, keyword, sortOrder]);

  // ── 10. 상위 폴더로 이동 헬퍼 ──
  const goUp = useCallback(() => {
    if (!currentFolderId) return;
    const parent = currentFolder?.parentId || null;
    setCurrentFolderId(parent);
  }, [currentFolderId, currentFolder]);

  // ── 11. 뮤테이션: 폴더 생성/수정/삭제 ──
  const createFolderMutation = useMutation({
    mutationFn: async (params: { name: string; parentId?: string | null; description?: string }) => {
      const now = new Date().toISOString().split('T')[0];
      const newId = `fld_${Date.now()}`;
      const parent = params.parentId ? folders.find((f) => f.id === params.parentId) : null;
      const depth = parent ? parent.depth + 1 : 0;
      const path = parent ? `${buildFolderPath(folders, parent.id)}/${params.name.trim()}` : `/${params.name.trim()}`;

      const newFolder: GalleryFolder = {
        id: newId,
        name: params.name.trim(),
        description: params.description?.trim() || '',
        parentId: params.parentId || null,
        path,
        depth,
        order: folders.length + 1,
        isSystem: false,
        createdBy: user?.id || 'guest',
        creatorName: user?.name || '직원',
        creatorDept: user?.dept || '전사',
        createdAt: now,
      };
      await galleryRepo.saveFolder(newFolder);
      return newFolder;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY_FOLDERS });
    },
  });

  const updateFolderMutation = useMutation({
    mutationFn: async (params: { id: string; name: string; description?: string }) => {
      const target = folders.find((f) => f.id === params.id);
      if (!target) throw new Error('폴더를 찾을 수 없습니다.');
      const name = params.name.trim();
      if (!name) throw new Error('폴더명을 입력해주세요.');
      // 빈 문자열은 '설명 지우기', undefined만 '기존 설명 유지'
      const description = params.description !== undefined ? params.description.trim() : target.description;
      // 이름이 바뀌면 하위 폴더의 표시 경로(path)도 함께 다시 저장한다.
      const plan = planFolderRename(folders, params.id, name, description);
      let saved = 0;
      try {
        for (const folder of plan) {
          await galleryRepo.saveFolder(folder);
          saved += 1;
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        throw new Error(
          saved === 0
            ? `폴더 정보를 저장하지 못했습니다. (${reason})`
            : `폴더 이름은 바뀌었지만 하위 폴더 경로 ${plan.length - 1}개 중 ${saved - 1}개만 반영됐습니다. 다시 저장해 주세요. (${reason})`,
        );
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY_FOLDERS });
    },
  });

  /** 삭제 확인창용: 함께 지워질 하위 폴더와 사진 수 (현재 불러온 목록 기준) */
  const getFolderDeletionScope = useCallback(
    (folderId: string): FolderDeletionScope | null => {
      const subtree = collectFolderSubtree(folders, folderId);
      if (subtree.length === 0) return null;
      const ids = new Set(subtree.map((f) => f.id));
      return {
        folder: subtree[0],
        subFolders: subtree.slice(1),
        photoCount: photos.filter((p) => ids.has(p.folderId)).length,
      };
    },
    [folders, photos],
  );

  const deleteFolderMutation = useMutation({
    mutationFn: async (folderId: string) => {
      // 다른 사람이 그사이 올린 사진까지 지우도록 최신 목록으로 범위를 다시 계산한다.
      const [latestFolders, latestPhotos] = await Promise.all([galleryRepo.listFolders(), galleryRepo.listPhotos()]);
      const target = latestFolders.find((f) => f.id === folderId);
      if (!target) throw new Error('폴더를 찾을 수 없습니다. 이미 삭제되었을 수 있습니다.');
      if (target.isSystem) throw new Error('기본 폴더는 삭제할 수 없습니다.');

      const folderIds = folderDeletionOrder(latestFolders, folderId);
      const idSet = new Set(folderIds);
      const photoIds = latestPhotos.filter((p) => idSet.has(p.folderId)).map((p) => p.id);

      // 사진 → 깊은 하위 폴더 → 선택한 폴더 순서로 지운다.
      // 중간에 실패해도 남은 사진·폴더는 화면에 그대로 보여 다시 지울 수 있다.
      let photosDone = 0;
      let foldersDone = 0;
      try {
        for (const id of photoIds) {
          await galleryRepo.removePhoto(id);
          photosDone += 1;
        }
        for (const id of folderIds) {
          await galleryRepo.removeFolder(id);
          foldersDone += 1;
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        throw new Error(
          `삭제 중 오류가 났습니다. 사진 ${photoIds.length}장 중 ${photosDone}장, 폴더 ${folderIds.length}개 중 ${foldersDone}개를 삭제했습니다. 목록을 확인하고 다시 시도해 주세요. (${reason})`,
        );
      } finally {
        const removed = new Set(folderIds.slice(0, foldersDone));
        setCurrentFolderId((cur) => (cur && removed.has(cur) ? null : cur));
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY_FOLDERS });
      queryClient.invalidateQueries({ queryKey: QUERY_KEY_PHOTOS });
    },
  });

  // ── 12. 뮤테이션: 사진 업로드/수정/삭제 ──
  const uploadPhotosMutation = useMutation({
    mutationFn: async (params: {
      files: File[];
      folderId: string;
      commonTitle?: string;
      eventDate?: string;
    }) => {
      const date = params.eventDate || new Date().toISOString().split('T')[0];
      const authorId = user?.id || 'guest';
      const authorName = user?.name ? `${user.name} ${user.position || ''}`.trim() : '직원';
      const authorDept = user?.dept || '전사';
      const now = new Date().toISOString();

      const uploadedList: GalleryPhoto[] = [];

      for (let i = 0; i < params.files.length; i++) {
        const file = params.files[i];
        const ext = file.name.split('.').pop() || 'jpg';
        const randomHex = Math.random().toString(36).substring(2, 8);
        const storagePath = `chat/gallery/${params.folderId}/${Date.now()}_${randomHex}.${ext}`;

        // Garage S3 / Appwrite Storage 업로드
        const fileUrl = await fileStorage.put(storagePath, file, {
          contentType: file.type,
          filename: file.name,
        });

        // 제목 옵셔널 처리: 공통 제목이 있으면 '제목 (1)', 없으면 원본 파일명(확장자 제외)
        let title = '';
        if (params.commonTitle?.trim()) {
          title = params.files.length > 1 ? `${params.commonTitle.trim()} (${i + 1})` : params.commonTitle.trim();
        } else {
          title = file.name.replace(/\.[^/.]+$/, '');
        }

        const newPhoto: GalleryPhoto = {
          id: `pht_${Date.now()}_${i}_${randomHex}`,
          folderId: params.folderId,
          title,
          caption: '',
          fileUrl,
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type || 'image/jpeg',
          eventDate: date,
          authorId,
          authorName,
          authorDept,
          createdAt: now,
        };

        await galleryRepo.savePhoto(newPhoto);
        uploadedList.push(newPhoto);
      }

      return uploadedList;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY_PHOTOS });
    },
  });

  const updatePhotoMutation = useMutation({
    mutationFn: async (params: { id: string; title: string; caption?: string; eventDate?: string; folderId?: string }) => {
      const target = photos.find((p) => p.id === params.id);
      if (!target) throw new Error('사진을 찾을 수 없습니다.');
      const updated: GalleryPhoto = {
        ...target,
        title: params.title.trim() || target.title,
        caption: params.caption !== undefined ? params.caption.trim() : target.caption,
        eventDate: params.eventDate || target.eventDate,
        folderId: params.folderId || target.folderId,
      };
      await galleryRepo.savePhoto(updated);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY_PHOTOS });
    },
  });

  const deletePhotoMutation = useMutation({
    mutationFn: async (photoId: string) => {
      await galleryRepo.removePhoto(photoId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY_PHOTOS });
    },
  });

  // ── 13. 일괄 작업 뮤테이션 ──
  const batchMoveMutation = useMutation({
    mutationFn: async (params: { photoIds: string[]; targetFolderId: string }) => {
      await galleryRepo.batchMovePhotos(params.photoIds, params.targetFolderId);
    },
    // 순차 처리 중 실패해도 이미 반영된 사진이 보이도록 항상 다시 불러온다
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY_PHOTOS });
    },
  });

  const batchCopyMutation = useMutation({
    mutationFn: async (params: { photoIds: string[]; targetFolderId: string }) => {
      await galleryRepo.batchCopyPhotos(params.photoIds, params.targetFolderId, {
        id: user?.id || 'guest',
        name: user?.name || '직원',
        dept: user?.dept || '전사',
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY_PHOTOS });
    },
  });

  const batchDeleteMutation = useMutation({
    mutationFn: async (photoIds: string[]) => {
      await galleryRepo.batchDeletePhotos(photoIds);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY_PHOTOS });
    },
  });

  return {
    folders,
    photos,
    isFoldersLoading,
    isPhotosLoading,
    currentFolderId,
    setCurrentFolderId,
    currentFolder,
    folderTree,
    breadcrumbs,
    subFolders,
    currentPhotos,
    photoCountMap,
    keyword,
    setKeyword,
    sortOrder,
    setSortOrder,
    viewMode,
    setViewMode,
    goUp,

    // Actions
    createFolder: createFolderMutation.mutateAsync,
    updateFolder: updateFolderMutation.mutateAsync,
    deleteFolder: deleteFolderMutation.mutateAsync,
    getFolderDeletionScope,
    isFolderMutating: createFolderMutation.isPending || updateFolderMutation.isPending || deleteFolderMutation.isPending,

    uploadPhotos: uploadPhotosMutation.mutateAsync,
    isUploading: uploadPhotosMutation.isPending,
    updatePhoto: updatePhotoMutation.mutateAsync,
    deletePhoto: deletePhotoMutation.mutateAsync,

    batchMove: batchMoveMutation.mutateAsync,
    batchCopy: batchCopyMutation.mutateAsync,
    batchDelete: batchDeleteMutation.mutateAsync,
  };
}
