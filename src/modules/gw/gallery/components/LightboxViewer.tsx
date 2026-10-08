import React, { useEffect } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Image as ImageIcon,
  Pencil,
  Trash2,
  X,
} from 'lucide-react';
import { Button } from '../../../../shared/ui/Button';
import type { GalleryAlbum, GalleryItem } from '../types';

interface LightboxViewerProps {
  activeItem: GalleryItem | null;
  activeImageIndex: number;
  setActiveImageIndex: (index: number | ((prev: number) => number)) => void;
  onClose: () => void;
  onPrev: (e?: React.MouseEvent) => void;
  onNext: (e?: React.MouseEvent) => void;
  albums: GalleryAlbum[];
  currentActiveIndex: number;
  totalItemsCount: number;
  canManage: boolean;
  onSetCoverImage: (albumId: string, imageUrl: string) => void;
  onOpenEdit: (item: GalleryItem, e: React.MouseEvent) => void;
  onDelete: (id: string, e?: React.MouseEvent) => void;
  onCopyPhoto?: (item: GalleryItem) => void;
}

export const LightboxViewer: React.FC<LightboxViewerProps> = ({
  activeItem,
  activeImageIndex,
  setActiveImageIndex,
  onClose,
  onPrev,
  onNext,
  albums,
  currentActiveIndex,
  totalItemsCount,
  canManage,
  onSetCoverImage,
  onOpenEdit,
  onDelete,
  onCopyPhoto,
}) => {
  useEffect(() => {
    if (!activeItem) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        onPrev();
      } else if (e.key === 'ArrowRight') {
        onNext();
      } else if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeItem, onPrev, onNext, onClose]);

  if (!activeItem) return null;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-4 animate-in fade-in duration-200"
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-5 top-5 z-20 grid h-10 w-10 place-items-center rounded-full bg-white/15 text-white hover:bg-white/30 transition-all cursor-pointer"
        title="닫기 (ESC)"
      >
        <X className="h-5 w-5" />
      </button>

      {(totalItemsCount > 1 || activeItem.images.length > 1) && (
        <>
          <button
            type="button"
            onClick={onPrev}
            title="이전 사진 (좌측 화살표키)"
            className="absolute left-5 top-1/2 z-20 -translate-y-1/2 grid h-12 w-12 place-items-center rounded-full bg-white/15 text-white hover:bg-white/30 transition-all cursor-pointer"
          >
            <ChevronLeft className="h-7 w-7" />
          </button>
          <button
            type="button"
            onClick={onNext}
            title="다음 사진 (우측 화살표키)"
            className="absolute right-5 top-1/2 z-20 -translate-y-1/2 grid h-12 w-12 place-items-center rounded-full bg-white/15 text-white hover:bg-white/30 transition-all cursor-pointer"
          >
            <ChevronRight className="h-7 w-7" />
          </button>
        </>
      )}

      <div
        onClick={(e) => e.stopPropagation()}
        className="relative flex max-h-[calc(92vh/var(--font-scale,1))] max-w-5xl w-full flex-col overflow-hidden rounded-3xl bg-panel shadow-2xl animate-in zoom-in-95 duration-200"
      >
        <div className="relative flex max-h-[calc(65vh/var(--font-scale,1))] min-h-[350px] w-full items-center justify-center bg-black/95 overflow-hidden">
          <img
            src={activeItem.images[activeImageIndex] || activeItem.images[0]}
            alt={activeItem.caption || activeItem.description || '갤러리 사진'}
            className="max-h-[calc(65vh/var(--font-scale,1))] w-auto max-w-full object-contain select-none"
          />

          {/* 전체 목록 기준 사진 순번 배지 (예: 3 / 15) */}
          <div className="absolute top-3 left-3 rounded-md bg-black/60 px-2.5 py-1 text-[11px] font-mono font-bold text-white backdrop-blur-xs">
            {currentActiveIndex !== -1 && totalItemsCount > 1
              ? `${currentActiveIndex + 1} / ${totalItemsCount}`
              : activeItem.images.length > 1
              ? `${activeImageIndex + 1} / ${activeItem.images.length}`
              : '1 / 1'}
          </div>
        </div>

        {activeItem.images.length > 1 && (
          <div className="flex items-center gap-2 overflow-x-auto bg-panel-alt/50 px-4 py-2 border-t border-border/50">
            {activeItem.images.map((img, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => setActiveImageIndex(idx)}
                className={`relative h-12 w-16 shrink-0 overflow-hidden rounded-lg border-2 transition-all ${
                  activeImageIndex === idx
                    ? 'border-teal ring-2 ring-teal/30 scale-105'
                    : 'border-transparent opacity-60 hover:opacity-100'
                }`}
              >
                <img src={img} alt="썸네일" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        )}

        <div className="flex flex-col justify-between p-5 bg-panel border-t border-border">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="rounded-md bg-teal-soft px-2.5 py-1 text-xs font-bold text-teal">
                  {albums.find((a) => a.id === activeItem.albumId)?.name || '기본 앨범'}
                </span>
                <span className="text-xs font-mono text-ink3">{activeItem.date}</span>
                {activeItem.authorName && (
                  <span className="text-xs text-ink3 font-medium">· {activeItem.authorName}</span>
                )}
              </div>
              {activeItem.description ? (
                <p className="mt-2 text-sm text-ink font-semibold leading-relaxed whitespace-pre-wrap">
                  {activeItem.description}
                </p>
              ) : (
                <p className="mt-2 text-xs text-ink3 italic">등록된 캡션이 없습니다.</p>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {activeItem.albumId !== 'recent' && (
                <>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => onSetCoverImage(activeItem.albumId, activeItem.images[0])}
                  >
                    <ImageIcon className="h-3.5 w-3.5 mr-1" />
                    <span>대표이미지 지정</span>
                  </Button>
                  {onCopyPhoto && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => onCopyPhoto(activeItem)}
                    >
                      <Copy className="h-3.5 w-3.5 mr-1 text-teal" />
                      <span>앨범 복사</span>
                    </Button>
                  )}
                </>
              )}
              {canManage && (
                <>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={(e) => {
                      onOpenEdit(activeItem, e);
                      onClose();
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5 mr-1" />
                    <span>캡션 수정</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={(e) => onDelete(activeItem.id, e)}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1" />
                    <span>삭제</span>
                  </Button>
                </>
              )}
              <a
                href={activeItem.images[activeImageIndex] || activeItem.images[0]}
                download={`${activeItem.caption || activeItem.description || 'photo'}_${activeImageIndex + 1}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 rounded-xl border border-border bg-panel-alt px-3 py-1.5 text-[11px] font-bold text-ink hover:bg-teal-soft hover:text-teal transition-all"
              >
                <Download className="h-3.5 w-3.5 mr-1" />
                <span>다운로드</span>
              </a>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between border-t border-border/50 pt-2.5 text-[11px] text-ink3 font-medium">
            <div>
              <span>등록자: </span>
              <span className="font-bold text-ink2">{activeItem.authorName}</span>
              <span> ({activeItem.authorDept})</span>
            </div>
            <div className="font-mono">총 {activeItem.images.length}장의 사진</div>
          </div>
        </div>
      </div>
    </div>
  );
};
