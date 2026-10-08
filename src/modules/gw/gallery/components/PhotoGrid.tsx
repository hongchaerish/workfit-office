import React from 'react';
import type { GalleryAlbum, GalleryItem, DateGroup } from '../types';
import { PhotoCard } from './PhotoCard';
import { EmptyState } from './EmptyState';

interface PhotoGridProps {
  activeTab: 'albums' | 'timeline';
  filteredItems: GalleryItem[];
  groupedByDate: DateGroup[];
  albums: GalleryAlbum[];
  isSelectionMode: boolean;
  selectedItemIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, item: GalleryItem) => void;
  onOpenEdit: (item: GalleryItem, e: React.MouseEvent) => void;
  onDelete: (id: string, e?: React.MouseEvent) => void;
  onClickItem: (item: GalleryItem) => void;
  canManageItem: (item: GalleryItem) => boolean;
  keyword: string;
  onUpload: () => void;
  canCreate: boolean;
}

export const PhotoGrid: React.FC<PhotoGridProps> = ({
  activeTab,
  filteredItems,
  groupedByDate,
  albums,
  isSelectionMode,
  selectedItemIds,
  onToggleSelect,
  onContextMenu,
  onOpenEdit,
  onDelete,
  onClickItem,
  canManageItem,
  keyword,
  onUpload,
  canCreate,
}) => {
  if (activeTab === 'timeline') {
    if (groupedByDate.length === 0) {
      return <EmptyState keyword={keyword} onUpload={onUpload} canCreate={canCreate} />;
    }

    return (
      <div className="space-y-6">
        {groupedByDate.map((group) => (
          <div key={group.dateKey} className="space-y-3">
            <div className="sticky top-[var(--shell-top)] z-20 flex items-center justify-between backdrop-blur-md bg-panel/90 py-1.5 px-1 border-b border-border/60">
              <div className="flex items-baseline gap-2">
                <h3 className="text-sm font-extrabold text-ink">{group.displayDate}</h3>
                <span className="text-[11px] font-mono text-ink3">
                  {group.items.length}개의 기록
                </span>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3.5">
              {group.items.map((item: GalleryItem) => (
                <PhotoCard
                  key={item.id}
                  item={item}
                  albumName={albums.find((a) => a.id === item.albumId)?.name}
                  canManage={canManageItem(item)}
                  isSelectionMode={isSelectionMode}
                  isSelected={selectedItemIds.has(item.id)}
                  onToggleSelect={() => onToggleSelect(item.id)}
                  onContextMenu={(e) => onContextMenu(e, item)}
                  onOpenEdit={(e) => onOpenEdit(item, e)}
                  onDelete={(e) => onDelete(item.id, e)}
                  onClick={() => onClickItem(item)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  // 앨범 내 사진 목록
  if (filteredItems.length === 0) {
    return <EmptyState keyword={keyword} onUpload={onUpload} canCreate={canCreate} />;
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3.5">
      {filteredItems.map((item) => (
        <PhotoCard
          key={item.id}
          item={item}
          albumName={albums.find((a) => a.id === item.albumId)?.name}
          canManage={canManageItem(item)}
          isSelectionMode={isSelectionMode}
          isSelected={selectedItemIds.has(item.id)}
          onToggleSelect={() => onToggleSelect(item.id)}
          onContextMenu={(e) => onContextMenu(e, item)}
          onOpenEdit={(e) => onOpenEdit(item, e)}
          onDelete={(e) => onDelete(item.id, e)}
          onClick={() => onClickItem(item)}
        />
      ))}
    </div>
  );
};
