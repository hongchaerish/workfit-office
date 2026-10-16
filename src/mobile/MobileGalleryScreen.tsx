import { useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Folder,
  FolderOpen,
  FolderPlus,
  Image as ImageIcon,
  Camera,
  Trash2,
  Search,
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  X,
} from 'lucide-react';
import { useGalleryDirectory } from '@/features/gw/gallery/useGalleryDirectory';
import { PhotoUploadModal } from '@/modules/gw/gallery/components/PhotoUploadModal';
import { FolderManageModal } from '@/modules/gw/gallery/components/FolderManageModal';
import type { GalleryPhoto } from '@/domain/gallery/schema';
import MobileCommonHeader from './MobileCommonHeader';

export default function MobileGalleryScreen() {
  const {
    folders,
    photos,
    isFoldersLoading,
    isPhotosLoading,
    currentFolderId,
    setCurrentFolderId,
    currentFolder,
    currentPhotos,
    keyword,
    setKeyword,
    sortOrder,
    setSortOrder,
    uploadPhotos,
    deletePhoto,
    batchDelete,
    createFolder,
    isFolderMutating,
  } = useGalleryDirectory();
  const queryClient = useQueryClient();

  const [activePhoto, setActivePhoto] = useState<GalleryPhoto | null>(null);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isFolderCreateOpen, setIsFolderCreateOpen] = useState(false);
  const [createParentId, setCreateParentId] = useState<string | null>(null);
  const createParent = folders.find((folder) => folder.id === createParentId) ?? null;
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectedPhotos = useMemo(() => currentPhotos.filter((photo) => selectedIds.has(photo.id)), [currentPhotos, selectedIds]);
  const [pendingDeletion, setPendingDeletion] = useState<{ kind: 'single' | 'batch'; photos: GalleryPhoto[] } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const deleting = useRef(false);

  const clearSelection = () => {
    setSelectedIds(new Set());
    setIsSelecting(false);
  };
  const changeFolder = (folderId: string | null) => {
    if (deleting.current) return;
    clearSelection();
    setCurrentFolderId(folderId);
  };
  const changeKeyword = (value: string) => {
    if (deleting.current) return;
    // 검색으로 숨겨진 사진이 선택 삭제 대상에 남지 않도록 한다.
    clearSelection();
    setKeyword(value);
  };
  const toggleSelection = (photoId: string) => {
    if (deleting.current) return;
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(photoId)) next.delete(photoId);
      else next.add(photoId);
      return next;
    });
  };
  const requestDeletion = (targets: GalleryPhoto[], kind: 'single' | 'batch') => {
    if (deleting.current || targets.length === 0) return;
    setNotice('');
    setActionError('');
    // 확인 중 목록이 갱신되어도 삭제 대상은 처음 선택한 사진으로 유지한다.
    setPendingDeletion({ kind, photos: targets.map((photo) => ({ ...photo })) });
  };
  const confirmDeletion = async () => {
    if (!pendingDeletion || deleting.current) return;
    const request = pendingDeletion;
    const ids = request.photos.map((photo) => photo.id);
    deleting.current = true;
    setIsDeleting(true);
    setActionError('');
    try {
      if (request.kind === 'single') await deletePhoto(ids[0]);
      else await batchDelete(ids);
      setActivePhoto((photo) => photo && ids.includes(photo.id) ? null : photo);
      setPendingDeletion(null);
      clearSelection();
      setNotice(`사진 ${ids.length}장을 삭제했습니다.`);
    } catch (caught) {
      setPendingDeletion(null);
      setActivePhoto(null);
      clearSelection();
      const message = caught instanceof Error ? caught.message : '사진을 삭제하지 못했습니다.';
      setActionError(`${message} 일부 사진이 삭제되었을 수 있으니 목록을 확인하고 다시 선택해 주세요.`);
      // 기존 일괄 삭제는 순차 처리라 중간 실패 시 완료된 삭제를 목록에 반영한다.
      await queryClient.invalidateQueries({ queryKey: ['gw', 'gallery', 'photos'] });
    } finally {
      deleting.current = false;
      setIsDeleting(false);
    }
  };

  return (
    <div className="flex h-full flex-col select-none overflow-hidden" style={{ background: '#f2f8fc' }}>
      <MobileCommonHeader
        title="회사 갤러리"
        subtitle={currentFolder ? currentFolder.name : `전체 사진 ${photos.length}장`}
      />

      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 bg-white px-3.5 py-2">
        <button type="button" disabled={isDeleting || currentPhotos.length === 0} onClick={() => { if (isSelecting) clearSelection(); else setIsSelecting(true); }} className="rounded-xl border border-border px-3 py-2 text-[12px] font-bold text-ink2 disabled:opacity-50">
          {isSelecting ? '선택 취소' : '사진 선택'}
        </button>
        <button type="button" disabled={isFoldersLoading || isDeleting || isFolderMutating} onClick={() => {
          clearSelection();
          setNotice('');
          setActionError('');
          setCreateParentId(currentFolderId && folders.some((folder) => folder.id === currentFolderId) ? currentFolderId : null);
          setIsFolderCreateOpen(true);
        }} className="flex items-center gap-1 rounded-xl border border-border px-2.5 py-2 text-[12px] font-bold text-ink2 disabled:opacity-50">
          <FolderPlus size={14} /> 폴더 추가
        </button>
        <button type="button" disabled={isFoldersLoading || isDeleting} onClick={() => { clearSelection(); setNotice(''); setActionError(''); setIsUploadOpen(true); }} className="flex items-center gap-1.5 rounded-xl bg-teal px-3 py-2 text-[12px] font-bold text-white disabled:opacity-50">
          <Camera size={15} /> 사진 업로드
        </button>
      </div>

      <div className="shrink-0 border-b border-border/50 bg-white px-3.5 py-2">
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink3" />
            <input type="text" aria-label="갤러리 사진 검색" placeholder="사진 검색" value={keyword} disabled={isDeleting} onChange={(event) => changeKeyword(event.target.value)} className="h-9 w-full rounded-xl border border-border bg-panel-alt pl-9 pr-9 text-[12px] text-ink outline-none focus:border-teal disabled:opacity-50" />
            {keyword && <button type="button" aria-label="검색어 지우기" disabled={isDeleting} onClick={() => changeKeyword('')} className="absolute right-1 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-lg text-ink3 hover:bg-panel disabled:opacity-50"><X size={15} /></button>}
          </div>
          <button type="button" disabled={isDeleting} onClick={() => setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc')} title={sortOrder === 'desc' ? '최신순 (클릭 시 오래된순)' : '오래된순 (클릭 시 최신순)'} className="flex h-9 shrink-0 items-center gap-1 rounded-xl border border-border px-2.5 text-[11px] font-bold text-ink2 disabled:opacity-50">
            {sortOrder === 'desc' ? <ArrowDownWideNarrow size={14} /> : <ArrowUpNarrowWide size={14} />}
            {sortOrder === 'desc' ? '최신순' : '오래된순'}
          </button>
        </div>
        <p className="mt-1.5 text-[10px] text-ink3">{keyword.trim() ? `검색 결과 ${currentPhotos.length}장` : '제목·설명·작성자·파일명·행사일 검색 · 행사일 기준 정렬'}</p>
      </div>

      {/* 1. 폴더 선택 칩 바 */}
      <div className="flex items-center gap-1.5 px-3.5 py-2 overflow-x-auto bg-white/70 border-b border-border/50 shrink-0 no-scrollbar">
        <button
          type="button"
          disabled={isDeleting}
          onClick={() => changeFolder(null)}
          className={`flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-[11px] font-bold transition-all ${
            currentFolderId === null
              ? 'bg-teal text-white shadow-xs'
              : 'bg-white text-ink3 hover:bg-panel-alt border border-border/80'
          }`}
        >
          <Folder size={13} />
          <span>전체 ({photos.length})</span>
        </button>

        {folders.map((f) => {
          const count = photos.filter((p) => p.folderId === f.id).length;
          return (
            <button
              key={f.id}
              type="button"
              disabled={isDeleting}
              onClick={() => changeFolder(f.id)}
              className={`flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-[11px] font-bold transition-all ${
                currentFolderId === f.id
                  ? 'bg-teal text-white shadow-xs'
                  : 'bg-white text-ink3 hover:bg-panel-alt border border-border/80'
              }`}
            >
              {currentFolderId === f.id ? <FolderOpen size={13} /> : <Folder size={13} />}
              <span>{f.name} ({count})</span>
            </button>
          );
        })}
      </div>

      {isSelecting && (
        <div role="region" aria-label="사진 선택 작업" className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 bg-white px-3.5 py-2 text-[12px]">
          <span className="font-semibold text-ink">{selectedPhotos.length}장 선택</span>
          <div className="flex items-center gap-2">
            <button type="button" disabled={isDeleting || currentPhotos.length === 0} onClick={() => setSelectedIds(selectedPhotos.length === currentPhotos.length ? new Set() : new Set(currentPhotos.map((photo) => photo.id)))} className="rounded-lg border border-border px-2.5 py-2 font-bold text-ink2 disabled:opacity-50">
              {selectedPhotos.length === currentPhotos.length && currentPhotos.length > 0 ? '전체 해제' : '전체 선택'}
            </button>
            <button type="button" disabled={isDeleting || selectedPhotos.length === 0} onClick={() => requestDeletion(selectedPhotos, 'batch')} className="flex items-center gap-1 rounded-lg bg-rose-600 px-2.5 py-2 font-bold text-white disabled:opacity-50">
              <Trash2 size={14} /> 선택 삭제
            </button>
          </div>
        </div>
      )}

      {/* 2. 사진 2열 그리드 */}
      <div className="flex-1 overflow-y-auto px-3.5 py-3">
        {notice && <p role="status" className="mb-3 rounded-xl border border-teal/20 bg-white p-3 text-[12px] font-semibold text-teal">{notice}</p>}
        {actionError && <p role="alert" className="mb-3 rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-[12px] text-rose-600">{actionError}</p>}
        {isPhotosLoading ? (
          <div className="py-16 text-center text-[12px] text-ink3">사진을 불러오는 중입니다…</div>
        ) : currentPhotos.length === 0 ? (
          <div className="py-16 text-center text-ink3 border border-dashed border-border/80 rounded-2xl bg-white/60">
            <ImageIcon size={28} className="mx-auto mb-1.5 text-ink3/40" />
            <p className="text-[12px] font-bold text-ink">{keyword.trim() ? '검색 결과가 없습니다.' : '등록된 사진이 없습니다.'}</p>
            <p className="text-[10.5px] text-ink3 mt-0.5">{keyword.trim() ? '다른 검색어를 입력하거나 검색어를 지워보세요.' : '사진 업로드 버튼으로 사내 행사 및 워크숍 사진을 등록해보세요.'}</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2.5">
            {currentPhotos.map((photo) => (
              <div
                key={photo.id}
                role={isSelecting ? undefined : 'button'}
                tabIndex={isSelecting ? undefined : 0}
                aria-label={isSelecting ? undefined : `${photo.title || photo.fileName} 사진 보기`}
                onClick={() => { if (deleting.current) return; if (isSelecting) toggleSelection(photo.id); else setActivePhoto(photo); }}
                onKeyDown={(event) => {
                  if (!isSelecting && event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
                    event.preventDefault();
                    if (!deleting.current) setActivePhoto(photo);
                  }
                }}
                className={`group relative flex flex-col overflow-hidden rounded-2xl border ${isSelecting && selectedIds.has(photo.id) ? 'border-teal ring-2 ring-teal' : 'border-border/80'} bg-white shadow-2xs hover:border-teal/50 transition-all cursor-pointer active:scale-97`}
              >
                <div className="relative aspect-square w-full bg-panel-alt overflow-hidden">
                  <img
                    src={photo.thumbnailUrl || photo.fileUrl}
                    alt={photo.title || photo.fileName}
                    className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-300"
                    loading="lazy"
                  />
                  {isSelecting && <input type="checkbox" aria-label={`${photo.title || photo.fileName} 선택`} checked={selectedIds.has(photo.id)} disabled={isDeleting} onClick={(event) => event.stopPropagation()} onChange={() => toggleSelection(photo.id)} className="absolute left-2 top-2 h-6 w-6 accent-teal" />}
                </div>

                <div className="p-2 space-y-0.5">
                  <h4 className="text-[11.5px] font-bold text-ink truncate">
                    {photo.title || photo.fileName}
                  </h4>
                  <span className="text-[10px] text-ink3 block font-mono">
                    {photo.createdAt.slice(0, 10)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 3. 풀스크린 사진 라이트박스 뷰어 */}
      {activePhoto && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/95 animate-in fade-in duration-200">
          <header className="flex items-center justify-between px-4 py-3 text-white">
            <span className="min-w-0 flex-1 text-[13px] font-bold truncate">
              {activePhoto.title || activePhoto.fileName}
            </span>
            <button type="button" disabled={isDeleting} onClick={() => requestDeletion([activePhoto], 'single')} className="ml-2 flex shrink-0 items-center gap-1 rounded-lg bg-white/10 px-2.5 py-2 text-[12px] font-bold text-white disabled:opacity-50">
              <Trash2 size={15} /> 사진 삭제
            </button>
            <button
              type="button"
              aria-label="사진 닫기"
              disabled={isDeleting}
              onClick={() => setActivePhoto(null)}
              className="grid h-8 w-8 place-items-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
            >
              <X size={18} />
            </button>
          </header>

          <div className="flex-1 flex items-center justify-center p-4">
            <img
              src={photoFileUrl(activePhoto)}
              alt={activePhoto.title || activePhoto.fileName}
              className="max-h-full max-w-full object-contain rounded-lg shadow-2xl"
            />
          </div>

          <footer className="px-4 py-3 bg-black/60 text-white/80 text-[11px] flex items-center justify-between">
            <span>촬영/등록: {activePhoto.createdAt.slice(0, 10)}</span>
            <span className="font-mono">{activePhoto.authorName || '사내 갤러리'}</span>
          </footer>
        </div>
      )}

      {isUploadOpen && <PhotoUploadModal
        isOpen
        variant="mobile"
        folders={folders}
        defaultFolderId={currentFolderId}
        onClose={() => setIsUploadOpen(false)}
        onUpload={async (params) => {
          if (!folders.some((folder) => folder.id === params.folderId)) {
            throw new Error('선택한 폴더를 찾을 수 없습니다. 폴더 목록을 확인해 주세요.');
          }
          const uploaded = await uploadPhotos(params);
          setCurrentFolderId(params.folderId);
          setNotice(`사진 ${uploaded.length}장을 등록했습니다.`);
          return uploaded;
        }}
      />}

      {isFolderCreateOpen && <FolderManageModal
        isOpen
        variant="mobile"
        editingFolder={null}
        parentFolder={createParent}
        onClose={() => setIsFolderCreateOpen(false)}
        locationPicker={<div>
          <label htmlFor="mobile-gallery-parent" className="mb-1.5 block text-[12px] font-bold text-ink">생성 위치</label>
          <select id="mobile-gallery-parent" value={createParentId ?? ''} disabled={isFolderMutating} onChange={(event) => setCreateParentId(event.target.value || null)} className="h-10 w-full rounded-xl border border-border bg-panel px-3 text-[12px] text-ink disabled:opacity-50">
            <option value="">최상위</option>
            {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.path || folder.name}</option>)}
          </select>
        </div>}
        onSubmit={async (name, description) => {
          if (createParentId && !folders.some((folder) => folder.id === createParentId)) {
            throw new Error('상위 폴더를 찾을 수 없습니다. 생성 위치를 다시 선택해 주세요.');
          }
          const created = await createFolder({ name, description, parentId: createParentId });
          setCurrentFolderId(created.id);
          setNotice(`'${created.name}' 폴더를 만들었습니다.`);
        }}
      />}

      {pendingDeletion && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-3">
          <section role="dialog" aria-modal="true" aria-labelledby="gallery-delete-title" aria-busy={isDeleting} className="max-h-[85dvh] w-full max-w-sm overflow-y-auto rounded-2xl border border-border bg-white p-4 shadow-xl">
            <h2 id="gallery-delete-title" className="text-[15px] font-bold text-ink">사진 삭제</h2>
            <p className="mt-3 text-[13px] text-ink2">사진 {pendingDeletion.photos.length}장을 갤러리에서 삭제할까요? 삭제 후에는 되돌릴 수 없습니다.</p>
            <ul className="mt-3 max-h-32 space-y-1 overflow-y-auto rounded-xl bg-panel-alt p-3 text-[12px] text-ink2">
              {pendingDeletion.photos.map((photo) => <li key={photo.id} className="break-all">{photo.title || photo.fileName}</li>)}
            </ul>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" disabled={isDeleting} onClick={() => { if (!deleting.current) setPendingDeletion(null); }} className="rounded-xl border border-border px-4 py-2.5 text-[12px] font-bold text-ink2 disabled:opacity-50">취소</button>
              <button type="button" disabled={isDeleting} onClick={() => void confirmDeletion()} className="rounded-xl bg-rose-600 px-4 py-2.5 text-[12px] font-bold text-white disabled:opacity-50">{isDeleting ? '삭제 중…' : '삭제'}</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function photoFileUrl(photo: GalleryPhoto): string {
  return photo.fileUrl || photo.thumbnailUrl || '';
}
