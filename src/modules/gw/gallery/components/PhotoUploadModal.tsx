import React, { useState, useRef } from 'react';
import type { GalleryFolder } from '@/domain/gallery/schema';
import { Camera, X, Upload, Loader2 } from 'lucide-react';

interface PhotoUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  folders: GalleryFolder[];
  defaultFolderId: string | null;
  variant?: 'desktop' | 'mobile';
  onUpload: (params: {
    files: File[];
    folderId: string;
    commonTitle?: string;
    eventDate?: string;
  }) => Promise<any>;
}

export const PhotoUploadModal: React.FC<PhotoUploadModalProps> = ({
  isOpen,
  onClose,
  folders,
  defaultFolderId,
  onUpload,
  variant = 'desktop',
}) => {
  const mobile = variant === 'mobile';
  const [selectedFolderId, setSelectedFolderId] = useState<string>(() => {
    return defaultFolderId || (folders[0]?.id ?? '');
  });
  const [eventDate, setEventDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [commonTitle, setCommonTitle] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<{ name: string; size: string; url: string }[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [error, setError] = useState('');

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const sending = useRef(false);
  const initialized = useRef(false);
  const previewUrls = useRef(new Set<string>());

  React.useEffect(() => () => {
    previewUrls.current.forEach((url) => URL.revokeObjectURL(url));
    previewUrls.current.clear();
  }, []);

  // 모달 열릴 때 초기화
  React.useEffect(() => {
    if (!isOpen) {
      initialized.current = false;
      return;
    }
    // 모바일에서는 폴더 목록이 갱신되어도 작성 중인 입력을 초기화하지 않는다.
    if (mobile && initialized.current) return;
    initialized.current = true;
    if (isOpen) {
      if (mobile) {
        previewUrls.current.forEach((url) => URL.revokeObjectURL(url));
        previewUrls.current.clear();
      }
      setSelectedFolderId(defaultFolderId || (folders[0]?.id ?? ''));
      setEventDate(new Date().toISOString().split('T')[0]);
      setCommonTitle('');
      setSelectedFiles([]);
      setPreviews([]);
      setIsUploading(false);
      setError('');
    }
  }, [isOpen, defaultFolderId, folders, mobile]);

  if (!isOpen) return null;

  const handleFiles = (files: FileList | File[]) => {
    if (mobile && sending.current) return;
    const fileArr = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (fileArr.length === 0) return;

    if (selectedFiles.length + fileArr.length > 50) {
      if (mobile) setError('한 번에 최대 50장까지 등록할 수 있습니다.');
      else alert('한 번에 최대 50장까지 등록할 수 있습니다.');
      return;
    }

    const newPreviews = fileArr.map((f) => ({
      name: f.name,
      size: (f.size / (1024 * 1024)).toFixed(1) + 'MB',
      url: URL.createObjectURL(f),
    }));
    if (mobile) newPreviews.forEach((preview) => previewUrls.current.add(preview.url));

    setSelectedFiles((prev) => [...prev, ...fileArr]);
    setPreviews((prev) => [...prev, ...newPreviews]);
  };

  const handleRemoveFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
    setPreviews((prev) => {
      URL.revokeObjectURL(prev[index].url);
      previewUrls.current.delete(prev[index].url);
      return prev.filter((_, i) => i !== index);
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mobile && sending.current) return;
    if (selectedFiles.length === 0) {
      setError('업로드할 사진을 선택해주세요.');
      return;
    }
    if (!selectedFolderId) {
      setError('사진을 저장할 폴더를 선택해주세요. 폴더가 없다면 먼저 폴더를 생성해주세요.');
      return;
    }

    sending.current = true;
    setIsUploading(true);
    setError('');
    try {
      await onUpload({
        files: selectedFiles,
        folderId: selectedFolderId,
        commonTitle: commonTitle.trim() || undefined,
        eventDate,
      });
      onClose();
    } catch (err: any) {
      const message = err?.message || '사진 업로드 중 오류가 발생했습니다.';
      setError(mobile ? `${message} 일부 사진이 등록되었을 수 있으니 목록을 확인한 후 다시 시도해 주세요.` : message);
    } finally {
      sending.current = false;
      setIsUploading(false);
    }
  };

  return (
    <div className={`fixed inset-0 ${mobile ? 'z-[60] p-3' : 'z-50 p-4'} flex items-center justify-center bg-black/50 backdrop-blur-xs animate-in fade-in duration-150`}>
      <div
        role={mobile ? 'dialog' : undefined}
        aria-modal={mobile ? true : undefined}
        aria-label={mobile ? '사진 업로드' : undefined}
        onClick={(e) => e.stopPropagation()}
        className={`w-full ${mobile ? 'max-w-lg max-h-[92dvh] rounded-2xl' : 'max-w-2xl max-h-[calc(90vh/var(--font-scale,1))] rounded-3xl'} flex flex-col border border-border bg-panel shadow-2xl overflow-hidden`}
      >
        {/* 헤더 */}
        <div className={`flex items-center justify-between border-b border-border ${mobile ? 'px-4 py-3' : 'px-6 py-4'} bg-panel-alt shrink-0`}>
          <div className="flex items-center gap-2.5">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-teal/10 text-teal">
              <Camera size={18} />
            </div>
            <div>
              <h2 className="text-base font-extrabold text-ink">사진 업로드</h2>
              {!mobile && <p className="text-[11px] text-ink3">선택한 폴더로 사진을 안전하게 업로드하고 전사 직원과 공유합니다.</p>}
            </div>
          </div>
          <button
            type="button"
            aria-label="업로드 창 닫기"
            onClick={onClose}
            disabled={isUploading}
            className="rounded-lg p-1.5 text-ink3 hover:bg-panel hover:text-ink transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* 폼 본문 */}
        <form onSubmit={handleSubmit} className={`min-h-0 flex-1 overflow-y-auto ${mobile ? 'p-4' : 'p-6'} space-y-4`}>
          {error && (
            <div role="alert" className="rounded-xl bg-danger/10 p-3 text-[12.5px] font-medium text-danger">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {/* 대상 폴더 선택 */}
            <div>
              <label className="block text-[12px] font-bold text-ink mb-1.5">
                저장할 폴더 <span className="text-danger">*</span>
              </label>
              <select
                aria-label="저장할 폴더"
                disabled={mobile && isUploading}
                value={selectedFolderId}
                onChange={(e) => setSelectedFolderId(e.target.value)}
                className="h-10 w-full rounded-xl border border-border bg-panel px-3 text-[12.5px] text-ink outline-none focus:border-teal"
              >
                {folders.length === 0 ? (
                  <option value="">(생성된 폴더가 없습니다. 먼저 폴더를 생성하세요)</option>
                ) : (
                  folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.path || `/${f.name}`}
                    </option>
                  ))
                )}
              </select>
            </div>

            {/* 촬영 / 행사 일자 */}
            <div>
              <label className="block text-[12px] font-bold text-ink mb-1.5">
                촬영 / 행사 일자 <span className="text-danger">*</span>
              </label>
              <input
                type="date"
                aria-label="촬영 / 행사 일자"
                disabled={mobile && isUploading}
                value={eventDate}
                onChange={(e) => setEventDate(e.target.value)}
                className="h-10 w-full rounded-xl border border-border bg-panel px-3 text-[12.5px] text-ink outline-none focus:border-teal"
              />
            </div>
          </div>

          {/* 공통 제목 (옵셔널) */}
          <div>
            <div className={mobile ? 'mb-1.5 space-y-1' : 'flex items-center justify-between mb-1.5'}>
              <label className="text-[12px] font-bold text-ink">
                사진 제목 <span className="text-[11px] font-normal text-ink3">(선택 사항)</span>
              </label>
              <span className={`${mobile ? 'block' : ''} text-[10.5px] text-ink3`}>미입력 시 원본 파일명 자동 사용</span>
            </div>
            <input
              type="text"
              aria-label="사진 제목"
              disabled={mobile && isUploading}
              value={commonTitle}
              onChange={(e) => setCommonTitle(e.target.value)}
              placeholder="예: 춘계 워크숍 단체사진 (여러 장 등록 시 자동으로 번호가 붙습니다)"
              maxLength={50}
              className="h-10 w-full rounded-xl border border-border bg-panel px-3.5 text-[12.5px] text-ink outline-none focus:border-teal"
            />
          </div>

          {/* 드래그 앤 드롭 업로드 박스 */}
          <div>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragOver(true);
              }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragOver(false);
                if (e.dataTransfer.files) handleFiles(e.dataTransfer.files);
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`flex flex-col items-center justify-center ${mobile ? 'p-4' : 'p-6'} rounded-2xl border-2 border-dashed transition-all cursor-pointer select-none ${
                isDragOver
                  ? 'border-teal bg-teal/10 scale-[0.99]'
                  : 'border-border hover:border-teal hover:bg-panel-alt'
              }`}
            >
              <div className="grid h-12 w-12 place-items-center rounded-xl bg-teal/10 text-teal mb-2">
                <Upload size={22} />
              </div>
              <p className="text-[13px] font-bold text-ink">
                {mobile ? '눌러서 사진을 선택하세요' : '사진 파일을 이곳으로 끌어다 놓거나 클릭하여 선택하세요'}
              </p>
              <p className="text-[11px] text-ink3 mt-0.5">
                JPG, PNG, GIF, WEBP 지원 (최대 50장 동시 업로드 가능)
              </p>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*"
                aria-label="사진 파일 선택"
                disabled={mobile && isUploading}
                onChange={(e) => {
                  if (e.target.files) handleFiles(e.target.files);
                  if (mobile) e.target.value = '';
                }}
                className="hidden"
              />
            </div>
          </div>

          {/* 선택된 사진 썸네일 미리보기 리스트 */}
          {previews.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11.5px] font-bold text-ink2">
                  선택된 사진 ({previews.length}장)
                </span>
                <button
                  type="button"
                  disabled={mobile && isUploading}
                  onClick={() => {
                    previews.forEach((p) => URL.revokeObjectURL(p.url));
                    previewUrls.current.clear();
                    setSelectedFiles([]);
                    setPreviews([]);
                  }}
                  className="text-[11px] font-semibold text-danger hover:underline"
                >
                  전체 취소
                </button>
              </div>

              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2 max-h-48 overflow-y-auto p-1 border border-border rounded-xl bg-panel-alt/50">
                {previews.map((item, idx) => (
                  <div
                    key={idx}
                    className="group relative aspect-square rounded-lg overflow-hidden border border-border bg-panel shadow-xs"
                  >
                    <img src={item.url} alt={item.name} className="h-full w-full object-cover" />
                    <button
                      type="button"
                      aria-label={`${item.name} 선택 해제`}
                      disabled={mobile && isUploading}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveFile(idx);
                      }}
                      className={`absolute top-1 right-1 grid ${mobile ? 'h-7 w-7 opacity-100' : 'h-5 w-5 opacity-0 group-hover:opacity-100'} place-items-center rounded-full bg-black/70 text-white transition-opacity`}
                    >
                      <X size={12} />
                    </button>
                    <div className="absolute bottom-0 inset-x-0 bg-black/60 px-1 py-0.5 text-[9px] text-white truncate text-center">
                      {item.size}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 푸터 */}
          <div className={`flex items-center justify-end gap-2 pt-3 border-t border-border shrink-0 ${mobile ? 'sticky -bottom-4 bg-panel pb-4' : ''}`}>
            <button
              type="button"
              onClick={onClose}
              disabled={isUploading}
              className="rounded-xl border border-border px-4 py-2 text-[12.5px] font-semibold text-ink hover:bg-panel-alt transition-colors"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={isUploading || selectedFiles.length === 0 || !selectedFolderId}
              className="flex items-center gap-2 rounded-xl bg-teal px-6 py-2 text-[12.5px] font-bold text-white shadow-xs hover:bg-teal/90 disabled:opacity-50 transition-all"
            >
              {isUploading ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  <span>스토리지 업로드 중…</span>
                </>
              ) : (
                <span>사진 {selectedFiles.length}장 업로드</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
