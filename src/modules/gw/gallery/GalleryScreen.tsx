import React, { useState, useMemo } from 'react';
import {
  Camera,
  FolderPlus,
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  LayoutGrid,
  List,
  Search,
  Loader2,
  Folder,
  Images,
} from 'lucide-react';

import { useGalleryDirectory } from '@/features/gw/gallery/useGalleryDirectory';
import type { GalleryFolder } from '@/domain/gallery/schema';
import { toGalleryItem, type GalleryItem, type GalleryAlbum } from './types';
import { GalleryFolderTree } from './components/GalleryFolderTree';
import { GalleryBreadcrumb } from './components/GalleryBreadcrumb';
import { FolderManageModal } from './components/FolderManageModal';
import { FolderSelectModal } from './components/FolderSelectModal';
import { PhotoUploadModal } from './components/PhotoUploadModal';
import { PhotoGrid } from './components/PhotoGrid';
import { LightboxViewer } from './components/LightboxViewer';
import { SelectionFloatingBar } from './components/SelectionFloatingBar';
import { ContextMenu } from './components/ContextMenu';
import { useGallerySelection } from './hooks/useGallerySelection';
import { GwHead, GwSplit } from '@/modules/gw/_gw';
import { Button } from '@/shared/ui/Button';

export default function GalleryScreen() {
  // ── 디렉토리 훅 (중앙 DB / S3 연동) ──
  const {
    folders,
    photos,
    isFoldersLoading,
    isPhotosLoading,
    currentFolderId,
    setCurrentFolderId,
    currentFolder,
    folderTree,
    breadcrumbs,
    currentPhotos,
    keyword,
    setKeyword,
    sortOrder,
    setSortOrder,
    viewMode,
    setViewMode,
    goUp,
    createFolder,
    updateFolder,
    deleteFolder,
    getFolderDeletionScope,
    uploadPhotos,
    deletePhoto,
    batchMove,
    batchCopy,
    batchDelete,
  } = useGalleryDirectory();

  // 호환용 사진 아이템 변환
  const galleryItems = useMemo(() => {
    return currentPhotos.map(toGalleryItem);
  }, [currentPhotos]);

  // 호환용 앨범 목록 변환
  const galleryAlbums = useMemo((): GalleryAlbum[] => {
    return folders.map((f) => ({
      id: f.id,
      name: f.name,
      description: f.description,
      isSystem: f.isSystem,
      createdAt: f.createdAt,
    }));
  }, [folders]);

  // ── 다중 선택 훅 ──
  const {
    isSelectionMode,
    setIsSelectionMode,
    selectedItemIds,
    toggleSelectItem,
    handleSelectAll,
    handleCancelSelection,
  } = useGallerySelection(galleryItems);

  // ── 라이트박스 뷰어 상태 ──
  const [activeItem, setActiveItem] = useState<GalleryItem | null>(null);
  const [activeImageIndex, setActiveImageIndex] = useState<number>(0);

  const activeItemIndex = useMemo(() => {
    if (!activeItem) return -1;
    return galleryItems.findIndex((it) => it.id === activeItem.id);
  }, [activeItem, galleryItems]);

  // ── 업로드 모달 상태 ──
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);

  // ── 폴더 생성/수정 모달 상태 ──
  const [isFolderModalOpen, setIsFolderModalOpen] = useState(false);
  const [parentFolderForCreate, setParentFolderForCreate] = useState<GalleryFolder | null>(null);
  const [editingFolder, setEditingFolder] = useState<GalleryFolder | null>(null);

  // ── 일괄 이동/복사 대상 폴더 선택 모달 상태 ──
  const [selectFolderModalMode, setSelectFolderModalMode] = useState<'move' | 'copy' | null>(null);

  // ── 우클릭 컨텍스트 메뉴 상태 ──
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; item: GalleryItem } | null>(null);

  // 기존 로컬스토리지 갤러리 잔여 데이터 1회 초기화
  React.useEffect(() => {
    try {
      localStorage.removeItem('workfit_phone_gallery_albums_v3');
      localStorage.removeItem('workfit_phone_gallery_items_v3');
      localStorage.removeItem('workfit_gallery_posts_v2');
      localStorage.removeItem('workfit_gallery_albums');
    } catch {
      /* ignore */
    }
  }, []);

  // 컨텍스트 메뉴 전역 닫기
  React.useEffect(() => {
    const handleGlobalClick = () => setContextMenu(null);
    window.addEventListener('click', handleGlobalClick);
    return () => window.removeEventListener('click', handleGlobalClick);
  }, []);

  // ESC 키로 선택 해제
  React.useEffect(() => {
    if (!isSelectionMode || activeItem) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleCancelSelection();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSelectionMode, activeItem, handleCancelSelection]);

  // ── 핸들러들 ──
  const handleOpenCreateFolder = (parentFolderId: string | null) => {
    const parent = parentFolderId ? folders.find((f) => f.id === parentFolderId) || null : null;
    setParentFolderForCreate(parent);
    setEditingFolder(null);
    setIsFolderModalOpen(true);
  };

  const handleOpenEditFolder = (folder: GalleryFolder) => {
    setEditingFolder(folder);
    setParentFolderForCreate(null);
    setIsFolderModalOpen(true);
  };

  const handleDeleteFolder = async (folder: GalleryFolder) => {
    const scope = getFolderDeletionScope(folder.id);
    const detail = scope
      ? `\n\n함께 삭제: 하위 폴더 ${scope.subFolders.length}개, 사진 ${scope.photoCount}장\n삭제 후에는 되돌릴 수 없습니다.`
      : '';
    if (!confirm(`'${folder.name}' 카테고리를 삭제하시겠습니까?${detail}`)) return;
    try {
      await deleteFolder(folder.id);
    } catch (err) {
      alert(err instanceof Error ? err.message : '폴더를 삭제하지 못했습니다.');
    }
  };

  const handleFolderModalSubmit = async (name: string, description?: string) => {
    if (editingFolder) {
      await updateFolder({ id: editingFolder.id, name, description });
    } else {
      await createFolder({
        name,
        parentId: parentFolderForCreate ? parentFolderForCreate.id : currentFolderId,
        description,
      });
    }
  };

  // 일괄 이동 실행
  const handleConfirmMove = async (targetFolderId: string) => {
    await batchMove({
      photoIds: Array.from(selectedItemIds),
      targetFolderId,
    });
    handleCancelSelection();
  };

  // 일괄 복사 실행
  const handleConfirmCopy = async (targetFolderId: string) => {
    await batchCopy({
      photoIds: Array.from(selectedItemIds),
      targetFolderId,
    });
    handleCancelSelection();
  };

  // 일괄 삭제 실행
  const handleBatchDelete = async () => {
    if (confirm(`선택한 사진 ${selectedItemIds.size}장을 삭제하시겠습니까?`)) {
      await batchDelete(Array.from(selectedItemIds));
      handleCancelSelection();
    }
  };

  // 사진 삭제 단건
  const handleDeletePhoto = async (photoId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (confirm('이 사진을 갤러리에서 삭제하시겠습니까?')) {
      await deletePhoto(photoId);
      if (activeItem?.id === photoId) setActiveItem(null);
    }
  };

  const isLoading = isFoldersLoading || isPhotosLoading;

  return (
    <div className="mx-auto w-full max-w-[1500px] px-4 py-5 sm:px-6 sm:py-6">
      {/* ── 그룹웨어 표준 헤더 (GwHead) ── */}
      <GwHead
        icon="📷"
        name="회사 갤러리"
        desc="사내 행사, 워크숍, 활동 사진을 카테고리별로 분류하여 전사 임직원과 공유하는 갤러리입니다."
        right={
          <div className="flex items-center gap-2">
            <Button
              onClick={() => handleOpenCreateFolder(currentFolderId)}
              variant="secondary"
            >
              <FolderPlus size={14} className="text-amber-500" />
              <span>카테고리 추가</span>
            </Button>
            <Button
              onClick={() => setIsUploadModalOpen(true)}
              variant="primary"
            >
              <Camera size={14} />
              <span>사진 업로드</span>
            </Button>
          </div>
        }
      />

      {/* ── 그룹웨어 표준 2단 레이아웃 (GwSplit) ── */}
      <GwSplit
        nav={
          <aside className="flex flex-col gap-2 rounded-2xl border border-border bg-panel p-3.5 shadow-xs">
            <div className="px-1 pb-1">
              <h2 className="text-sm font-extrabold text-navy">카테고리</h2>
              <p className="mt-0.5 text-[11px] text-ink3">분류별로 사진을 모아보세요.</p>
            </div>
            <GalleryFolderTree
              folderTree={folderTree}
              currentFolderId={currentFolderId}
              totalPhotosCount={photos.length}
              onSelectFolder={(id) => setCurrentFolderId(id)}
              onCreateSubFolder={(parentId) => handleOpenCreateFolder(parentId)}
              onEditFolder={(folder) => handleOpenEditFolder(folder)}
              onDeleteFolder={(folder) => handleDeleteFolder(folder)}
            />
          </aside>
        }
      >
        {/* 우측 디렉토리 콘텐츠 영역: 오직 사진만 노출 */}
        <main className="flex flex-col min-w-0 rounded-2xl border border-border bg-panel shadow-xs overflow-hidden">
          {/* 상단 브레드크럼 & 툴바(검색/정렬/뷰 모드) */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-panel px-4 py-2.5">
            <div className="flex-1 min-w-0">
              <GalleryBreadcrumb
                breadcrumbs={breadcrumbs}
                currentFolder={currentFolder}
                onSelectFolder={(id) => setCurrentFolderId(id)}
                onGoUp={goUp}
              />
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {/* 검색 입력창 */}
              <div className="relative w-40 sm:w-52">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3" />
                <input
                  type="text"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="사진 검색"
                  className="h-8 w-full rounded-xl border border-border bg-panel-alt pl-8 pr-3 text-[11.5px] text-ink outline-none focus:border-teal"
                />
              </div>

              {/* 정렬 순서 토글 */}
              <button
                type="button"
                onClick={() => setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc')}
                title={sortOrder === 'desc' ? '최신순 (클릭 시 오래된순)' : '오래된순 (클릭 시 최신순)'}
                className="flex h-8 items-center gap-1.5 rounded-xl border border-border bg-panel px-2.5 text-[11.5px] font-semibold text-ink hover:bg-panel-alt transition-colors"
              >
                {sortOrder === 'desc' ? <ArrowDownWideNarrow size={13} /> : <ArrowUpNarrowWide size={13} />}
                <span className="hidden sm:inline">{sortOrder === 'desc' ? '최신순' : '오래된순'}</span>
              </button>

              {/* 뷰 모드 토글 */}
              <div className="hidden sm:flex items-center rounded-xl border border-border bg-panel p-0.5">
                <button
                  type="button"
                  onClick={() => setViewMode('grid')}
                  className={`grid h-7 w-7 place-items-center rounded-lg transition-colors ${
                    viewMode === 'grid' ? 'bg-teal text-white' : 'text-ink3 hover:text-ink'
                  }`}
                  title="그리드 뷰"
                >
                  <LayoutGrid size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('list')}
                  className={`grid h-7 w-7 place-items-center rounded-lg transition-colors ${
                    viewMode === 'list' ? 'bg-teal text-white' : 'text-ink3 hover:text-ink'
                  }`}
                  title="리스트 뷰"
                >
                  <List size={13} />
                </button>
              </div>
            </div>
          </div>

          {/* 메인 뷰포트 (오직 사진만 노출) */}
          <div className="p-5 sm:p-6 flex-1 flex flex-col">
            {isLoading ? (
              <div className="flex h-64 flex-col items-center justify-center gap-3 text-ink3 my-auto">
                <Loader2 size={24} className="animate-spin text-teal" />
                <span className="text-[13px] font-semibold">전사 갤러리 불러오는 중…</span>
              </div>
            ) : (
              <>
                {/* 사진 목록 헤더 및 다중 선택 모드 토글 */}
                <div className="flex items-center justify-between mb-4 pb-3 border-b border-border/60">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="grid h-8 w-8 place-items-center rounded-xl bg-teal/10 text-teal shrink-0">
                      {currentFolder ? <Folder size={17} className="text-amber-500" /> : <Images size={17} className="text-teal" />}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-bold text-ink truncate">
                          {currentFolder ? currentFolder.name : '전체 사진 (전사 공용)'}
                        </h3>
                        <span className="text-[11px] font-semibold text-ink3 px-2 py-0.5 rounded-full bg-panel-alt border border-border/50 tabular-nums">
                          {galleryItems.length}장
                        </span>
                      </div>
                      {currentFolder?.description && (
                        <p className="text-[11px] text-ink3 mt-0.5 truncate">
                          {currentFolder.description}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {galleryItems.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          if (isSelectionMode) handleCancelSelection();
                          else setIsSelectionMode(true);
                        }}
                        className={`text-[11.5px] font-bold px-3 py-1.5 rounded-xl border transition-all ${
                          isSelectionMode
                            ? 'bg-teal text-white border-teal shadow-xs'
                            : 'bg-panel border-border text-ink hover:bg-panel-alt'
                        }`}
                      >
                        {isSelectionMode ? '선택 취소' : '사진 선택'}
                      </button>
                    )}
                    <Button
                      onClick={() => setIsUploadModalOpen(true)}
                      size="sm"
                      variant="primary"
                    >
                      <Camera size={13} />
                      <span>사진 업로드</span>
                    </Button>
                  </div>
                </div>

                {/* 사진 그리드 또는 빈 상태 */}
                {galleryItems.length > 0 ? (
                  <PhotoGrid
                    activeTab="albums"
                    filteredItems={galleryItems}
                    groupedByDate={[]}
                    albums={galleryAlbums}
                    isSelectionMode={isSelectionMode}
                    selectedItemIds={selectedItemIds}
                    onToggleSelect={toggleSelectItem}
                    onContextMenu={(e, item) => {
                      e.preventDefault();
                      setContextMenu({ x: e.clientX, y: e.clientY, item });
                    }}
                    onOpenEdit={() => {}}
                    onDelete={(id, e) => handleDeletePhoto(id, e)}
                    onClickItem={(item) => {
                      setActiveItem(item);
                      setActiveImageIndex(0);
                    }}
                    canManageItem={() => true}
                    keyword={keyword}
                    onUpload={() => setIsUploadModalOpen(true)}
                    canCreate={true}
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center py-20 text-center border border-dashed border-border/80 rounded-3xl bg-panel-alt/20 my-auto">
                    <div className="grid h-14 w-14 place-items-center rounded-2xl bg-teal/10 text-teal mb-3.5">
                      <Camera size={26} className="stroke-[1.6]" />
                    </div>
                    <h3 className="text-[14.5px] font-bold text-ink">
                      {keyword
                        ? `'${keyword}' 검색 결과와 일치하는 사진이 없습니다.`
                        : currentFolder
                        ? `'${currentFolder.name}' 폴더에 등록된 사진이 없습니다.`
                        : '등록된 사진이 없습니다.'}
                    </h3>
                    <p className="text-[12px] text-ink3 mt-1.5 max-w-sm leading-relaxed">
                      {keyword
                        ? '다른 검색어로 다시 시도해보시거나 검색어를 초기화해보세요.'
                        : '행사, 워크숍, 활동 사진을 업로드하여 임직원들과 공유해보세요.'}
                    </p>
                    {!keyword && (
                      <div className="mt-5">
                        <Button
                          onClick={() => setIsUploadModalOpen(true)}
                          size="md"
                          variant="primary"
                        >
                          <Camera size={14} />
                          <span>사진 업로드하기</span>
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </main>
      </GwSplit>

      {/* ── 플로팅 다중 선택 액션 바 ── */}
      <SelectionFloatingBar
        selectedCount={selectedItemIds.size}
        totalCount={galleryItems.length}
        canCopy={true}
        canDelete={true}
        onSelectAll={handleSelectAll}
        onCancelSelection={handleCancelSelection}
        onOpenMoveModal={() => setSelectFolderModalMode('move')}
        onOpenCopyModal={() => setSelectFolderModalMode('copy')}
        onDeleteSelected={handleBatchDelete}
      />

      {/* ── 라이트박스 뷰어 ── */}
      {activeItem && (
        <LightboxViewer
          activeItem={activeItem}
          activeImageIndex={activeImageIndex}
          setActiveImageIndex={setActiveImageIndex}
          onClose={() => setActiveItem(null)}
          onPrev={() => {
            if (activeItemIndex > 0) {
              setActiveItem(galleryItems[activeItemIndex - 1]);
              setActiveImageIndex(0);
            }
          }}
          onNext={() => {
            if (activeItemIndex < galleryItems.length - 1) {
              setActiveItem(galleryItems[activeItemIndex + 1]);
              setActiveImageIndex(0);
            }
          }}
          albums={galleryAlbums}
          currentActiveIndex={activeItemIndex}
          totalItemsCount={galleryItems.length}
          canManage={true}
          onSetCoverImage={() => {}}
          onOpenEdit={() => {}}
          onDelete={(id) => handleDeletePhoto(id)}
        />
      )}

      {/* ── 컨텍스트 메뉴 (우클릭) ── */}
      {contextMenu && (
        <ContextMenu
          contextMenu={contextMenu}
          selectedAlbumId={currentFolderId || ''}
          onSetCoverImage={() => {}}
        />
      )}

      {/* ── 사진 업로드 모달 ── */}
      <PhotoUploadModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        folders={folders}
        defaultFolderId={currentFolderId}
        onUpload={uploadPhotos}
      />

      {/* ── 폴더 생성 / 수정 모달 ── */}
      <FolderManageModal
        isOpen={isFolderModalOpen}
        onClose={() => setIsFolderModalOpen(false)}
        parentFolder={parentFolderForCreate}
        editingFolder={editingFolder}
        onSubmit={handleFolderModalSubmit}
      />

      {/* ── 폴더 일괄 이동 / 복사 대상 선택 모달 ── */}
      {selectFolderModalMode && (
        <FolderSelectModal
          isOpen={true}
          onClose={() => setSelectFolderModalMode(null)}
          folderTree={folderTree}
          title={selectFolderModalMode === 'move' ? '사진 일괄 이동' : '사진 일괄 복사'}
          count={selectedItemIds.size}
          onConfirm={selectFolderModalMode === 'move' ? handleConfirmMove : handleConfirmCopy}
        />
      )}
    </div>
  );
}
