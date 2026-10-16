import { useState, useEffect, useRef, type ReactNode } from 'react';
import type { GalleryFolder } from '@/domain/gallery/schema';
import { X, Folder, FolderPlus } from 'lucide-react';

interface FolderManageModalProps {
  isOpen: boolean;
  onClose: () => void;
  parentFolder: GalleryFolder | null;
  editingFolder: GalleryFolder | null;
  onSubmit: (name: string, description?: string) => Promise<void>;
  variant?: 'desktop' | 'mobile';
  locationPicker?: ReactNode;
}

export function FolderManageModal({
  isOpen,
  onClose,
  parentFolder,
  editingFolder,
  onSubmit,
  variant = 'desktop',
  locationPicker,
}: FolderManageModalProps) {
  const mobile = variant === 'mobile';
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const sending = useRef(false);

  const isEdit = Boolean(editingFolder);

  useEffect(() => {
    if (isOpen) {
      if (editingFolder) {
        setName(editingFolder.name);
        setDescription(editingFolder.description || '');
      } else {
        setName('');
        setDescription('');
      }
      setError('');
      setIsSubmitting(false);
    }
  }, [isOpen, editingFolder]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mobile && sending.current) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError('폴더명을 입력해주세요.');
      return;
    }

    sending.current = true;
    setIsSubmitting(true);
    setError('');
    try {
      await onSubmit(trimmed, description.trim() || undefined);
      onClose();
    } catch (err: any) {
      setError(err?.message || '폴더 저장 중 오류가 발생했습니다.');
    } finally {
      sending.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <div className={`fixed inset-0 ${mobile ? 'z-[60] p-3' : 'z-50 p-4'} flex items-center justify-center bg-black/50 backdrop-blur-xs animate-in fade-in duration-200`}>
      <div role={mobile ? 'dialog' : undefined} aria-modal={mobile ? true : undefined} aria-label={mobile ? isEdit ? '폴더 정보 변경' : '폴더 생성' : undefined} className={`w-full max-w-md ${mobile ? 'max-h-[90dvh] flex flex-col' : ''} rounded-2xl border border-border bg-panel shadow-2xl overflow-hidden`}>
        {/* 헤더 */}
        <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-3.5 bg-panel-alt">
          <div className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-teal/10 text-teal">
              {isEdit ? <Folder size={18} /> : <FolderPlus size={18} />}
            </div>
            <div>
              <h3 className="text-[14px] font-bold text-ink">
                {isEdit ? '카테고리 정보 변경' : '새 카테고리 생성'}
              </h3>
              {!isEdit && (
                <p className="text-[11px] text-ink3">
                  {parentFolder ? `상위 분류: ${parentFolder.name}` : '위치: 1단계 최상위 분류'}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            aria-label="폴더 창 닫기"
            disabled={mobile && isSubmitting}
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded-lg text-ink3 hover:bg-panel hover:text-ink"
          >
            <X size={16} />
          </button>
        </div>

        {/* 폼 본문 */}
        <form onSubmit={handleSubmit} className={`${mobile ? 'min-h-0 overflow-y-auto p-4' : 'p-5'} space-y-4`}>
          {error && (
            <div role="alert" className="rounded-lg bg-danger/10 p-2.5 text-[12px] font-medium text-danger">
              {error}
            </div>
          )}

          {locationPicker}

          <div>
            <label className="block text-[12px] font-bold text-ink mb-1.5">
              카테고리명 <span className="text-danger">*</span>
            </label>
            <input
              type="text"
              aria-label="카테고리명"
              disabled={mobile && isSubmitting}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 사내 행사, 워크숍, 제품 촬영, 일상 등"
              maxLength={50}
              autoFocus
              className="w-full rounded-xl border border-border bg-panel px-3.5 py-2.5 text-[13px] text-ink outline-none focus:border-teal focus:ring-2 focus:ring-teal/10 transition-all"
            />
          </div>

          <div>
            <label className="block text-[12px] font-bold text-ink mb-1.5">
              카테고리 설명 <span className="text-[11px] font-normal text-ink3">(선택)</span>
            </label>
            <textarea
              aria-label="카테고리 설명"
              disabled={mobile && isSubmitting}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="이 카테고리에 등록될 사진에 대한 간단한 설명을 입력하세요."
              rows={2}
              maxLength={150}
              className="w-full resize-none rounded-xl border border-border bg-panel px-3.5 py-2 text-[12.5px] text-ink outline-none focus:border-teal focus:ring-2 focus:ring-teal/10 transition-all"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="rounded-xl border border-border px-4 py-2 text-[12.5px] font-semibold text-ink hover:bg-panel-alt transition-colors"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !name.trim()}
              className="rounded-xl bg-teal px-4 py-2 text-[12.5px] font-bold text-white shadow-xs hover:bg-teal/90 disabled:opacity-50 transition-all"
            >
              {isSubmitting ? '저장 중…' : isEdit ? '변경사항 저장' : '카테고리 생성'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
