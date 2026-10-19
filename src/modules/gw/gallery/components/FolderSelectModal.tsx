import { useRef, useState } from 'react';
import type { FolderTreeNode } from '@/features/gw/gallery/useGalleryDirectory';
import { X, Folder, ChevronRight, ChevronDown, Check } from 'lucide-react';

interface FolderSelectModalProps {
  isOpen: boolean;
  onClose: () => void;
  folderTree: FolderTreeNode[];
  title: string;
  count: number;
  onConfirm: (targetFolderId: string) => Promise<void>;
  variant?: 'desktop' | 'mobile';
}

export function FolderSelectModal({
  isOpen,
  onClose,
  folderTree,
  title,
  count,
  onConfirm,
  variant = 'desktop',
}: FolderSelectModalProps) {
  const [selectedFolderId, setSelectedFolderId] = useState<string>('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set(folderTree.map((f) => f.id)));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const sending = useRef(false);
  const mobile = variant === 'mobile';

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
    if (!selectedFolderId || sending.current) return;
    sending.current = true;
    setIsSubmitting(true);
    setError('');
    try {
      await onConfirm(selectedFolderId);
      onClose();
    } catch (err) {
      // 실패 시 창을 닫지 않고 이유를 보여준다 (일괄 처리는 순차라 일부만 반영됐을 수 있음)
      const reason = err instanceof Error ? err.message : '';
      setError(`처리 중 오류가 났습니다. 일부 사진만 처리됐을 수 있으니 목록을 확인해 주세요.${reason ? ` (${reason})` : ''}`);
    } finally {
      sending.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className={`fixed inset-0 ${mobile ? 'z-[60] p-3' : 'z-50 p-4'} flex items-center justify-center bg-black/50 backdrop-blur-xs animate-in fade-in duration-200`}
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
            aria-label="폴더 선택 창 닫기"
            onClick={onClose}
            disabled={isSubmitting}
            className="grid h-7 w-7 place-items-center rounded-lg text-ink3 hover:bg-panel hover:text-ink"
          >
            <X size={16} />
          </button>
        </div>

        {error && (
          <div role="alert" className="mx-4 mt-3 shrink-0 rounded-lg bg-danger/10 p-2.5 text-[12px] font-medium text-danger">
            {error}
          </div>
        )}

        {/* 폴더 트리 목록 */}
        <div className={`flex-1 overflow-y-auto p-4 space-y-1 ${isSubmitting ? 'pointer-events-none opacity-60' : ''}`}>
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
