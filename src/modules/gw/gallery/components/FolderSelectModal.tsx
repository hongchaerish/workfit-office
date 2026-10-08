import { useState } from 'react';
import type { FolderTreeNode } from '@/features/gw/gallery/useGalleryDirectory';
import { X, Folder, ChevronRight, ChevronDown, Check } from 'lucide-react';

interface FolderSelectModalProps {
  isOpen: boolean;
  onClose: () => void;
  folderTree: FolderTreeNode[];
  title: string;
  count: number;
  onConfirm: (targetFolderId: string) => Promise<void>;
}

export function FolderSelectModal({
  isOpen,
  onClose,
  folderTree,
  title,
  count,
  onConfirm,
}: FolderSelectModalProps) {
  const [selectedFolderId, setSelectedFolderId] = useState<string>('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set(folderTree.map((f) => f.id)));
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const toggleExpand = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleConfirm = async () => {
    if (!selectedFolderId) return;
    setIsSubmitting(true);
    try {
      await onConfirm(selectedFolderId);
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-in fade-in duration-200"
      // 바깥(어두운 배경)을 누르면 닫는다 — 처리 중에는 닫지 않는다
      onMouseDown={(e) => { if (e.target === e.currentTarget && !isSubmitting) onClose(); }}
    >
      <div className="w-full max-w-md rounded-2xl border border-border bg-panel shadow-2xl overflow-hidden flex flex-col max-h-[calc(85vh/var(--font-scale,1))]">
        {/* 헤더 */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5 bg-panel-alt shrink-0">
          <div>
            <h3 className="text-[14px] font-bold text-ink">{title}</h3>
            <p className="text-[11px] text-ink3">선택된 사진 {count}장을 이동/복사할 대상 폴더를 선택하세요.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded-lg text-ink3 hover:bg-panel hover:text-ink"
          >
            <X size={16} />
          </button>
        </div>

        {/* 폴더 트리 목록 */}
        <div className="flex-1 overflow-y-auto p-4 space-y-1">
          {folderTree.map((node) => (
            <SelectNodeItem
              key={node.id}
              node={node}
              selectedFolderId={selectedFolderId}
              expandedIds={expandedIds}
              onToggleExpand={toggleExpand}
              onSelect={(id) => setSelectedFolderId(id)}
            />
          ))}
          {folderTree.length === 0 && (
            <div className="py-12 text-center text-[12px] text-ink3">
              선택 가능한 폴더가 없습니다. 먼저 폴더를 생성해주세요.
            </div>
          )}
        </div>

        {/* 푸터 */}
        <div className="flex items-center justify-end gap-2 p-4 border-t border-border bg-panel shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded-xl border border-border px-4 py-2 text-[12.5px] font-semibold text-ink hover:bg-panel-alt transition-colors"
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isSubmitting || !selectedFolderId}
            className="flex items-center gap-1.5 rounded-xl bg-teal px-5 py-2 text-[12.5px] font-bold text-white shadow-xs hover:bg-teal/90 disabled:opacity-50 transition-all"
          >
            {isSubmitting ? '처리 중…' : '선택 완료'}
          </button>
        </div>
      </div>
    </div>
  );
}

function SelectNodeItem({
  node,
  selectedFolderId,
  expandedIds,
  onToggleExpand,
  onSelect,
}: {
  node: FolderTreeNode;
  selectedFolderId: string;
  expandedIds: Set<string>;
  onToggleExpand: (id: string, e: React.MouseEvent) => void;
  onSelect: (id: string) => void;
}) {
  const isExpanded = expandedIds.has(node.id);
  const isSelected = selectedFolderId === node.id;
  const hasChildren = node.children.length > 0;

  return (
    <div>
      <div
        onClick={() => onSelect(node.id)}
        style={{ paddingLeft: `${node.depth * 14 + 6}px` }}
        className={`flex items-center justify-between pr-2.5 py-2 rounded-lg cursor-pointer text-[12.5px] transition-colors ${
          isSelected
            ? 'bg-teal text-white font-bold'
            : 'text-ink hover:bg-panel-alt'
        }`}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <button
            type="button"
            onClick={(e) => hasChildren && onToggleExpand(node.id, e)}
            className={`grid h-5 w-5 shrink-0 place-items-center rounded-md transition-colors ${
              hasChildren ? (isSelected ? 'text-white' : 'text-ink3 hover:bg-black/5') : 'opacity-0 pointer-events-none'
            }`}
          >
            {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>

          <Folder size={16} className={isSelected ? 'text-white' : 'text-amber-500'} />
          <span className="truncate">{node.name}</span>
        </div>

        {isSelected && <Check size={15} className="text-white shrink-0" />}
      </div>

      {isExpanded && hasChildren && (
        <div className="space-y-1">
          {node.children.map((child) => (
            <SelectNodeItem
              key={child.id}
              node={child}
              selectedFolderId={selectedFolderId}
              expandedIds={expandedIds}
              onToggleExpand={onToggleExpand}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}
