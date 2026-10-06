import type { Attachment } from '@/domain/chatMessage/schema';
import { AutoLinkText } from '@/shared/ui/AutoLinkText';
import { ImageBundleGrid } from './ImageBundleGrid';
import { fmtSize, downloadAttachment } from '@/mobile/chatUtils';
import { FileText, Download, FileArchive, FileSpreadsheet, FileCode } from 'lucide-react';

interface CompositeMessageCardProps {
  text?: string;
  images?: Attachment[];
  files?: Attachment[];
  mine: boolean;
  onOpenImage?: (att: Attachment, list: Attachment[]) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  searchQuery?: string;
  isSearchActive?: boolean;
}

function getFileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return <FileSpreadsheet size={18} className="text-emerald-500 shrink-0" />;
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return <FileArchive size={18} className="text-amber-500 shrink-0" />;
  if (['js', 'ts', 'tsx', 'jsx', 'json', 'html', 'css', 'py', 'java', 'c', 'cpp'].includes(ext)) return <FileCode size={18} className="text-indigo-500 shrink-0" />;
  return <FileText size={18} className="text-[#1890ff] shrink-0" />;
}

/**
 * Microsoft Teams 스타일의 복합 단일 메시지 카드
 * [본문 텍스트 + 사진 묶음(그리드) + 첨부파일 목록]을 단 하나의 말풍선으로 정갈하게 통합 렌더링합니다.
 */
export function CompositeMessageCard({
  text,
  images = [],
  files = [],
  mine,
  onOpenImage,
  onContextMenu,
}: CompositeMessageCardProps) {
  const hasText = Boolean(text && text.trim());
  const hasImages = images.length > 0;
  const hasFiles = files.length > 0;

  return (
    <div
      onContextMenu={onContextMenu}
      className={`rounded-2xl border p-2.5 space-y-2.5 min-w-[240px] max-w-[420px] shadow-[0_1px_3px_rgba(16,24,48,0.06)] select-text ${
        mine
          ? 'bg-[#bae0ff] border-[#91caff]/60 text-[#1c2536]'
          : 'bg-white border-black/10 text-ink'
      }`}
    >
      {/* 1. 상단 본문 텍스트 */}
      {hasText && (
        <div className="text-[12.5px] leading-relaxed break-words [word-break:break-word] whitespace-pre-wrap px-0.5 pt-0.5">
          <AutoLinkText text={text} />
        </div>
      )}

      {/* 2. 사진 묶음 (그리드 / 단일 이미지) */}
      {hasImages && (
        <div className="rounded-xl overflow-hidden border border-black/5 bg-black/[0.02]">
          {images.length === 1 ? (
            <button
              type="button"
              onClick={() => onOpenImage?.(images[0], images)}
              title="크게 보기"
              className="block w-full cursor-zoom-in overflow-hidden max-h-60"
            >
              <img
                src={images[0].url}
                alt={images[0].name}
                className="w-full max-h-60 object-cover hover:scale-[1.02] transition-transform duration-200"
              />
            </button>
          ) : (
            <ImageBundleGrid attachments={images} onOpen={(att) => onOpenImage?.(att, images)} />
          )}
        </div>
      )}

      {/* 3. 일반 첨부파일 목록 (Teams 스타일 카드) */}
      {hasFiles && (
        <div className="space-y-1 pt-0.5">
          <div className="text-[11px] font-bold opacity-75 px-1 flex items-center gap-1">
            <span>📎</span>
            <span>첨부파일 ({files.length}개)</span>
          </div>

          <div className="space-y-1">
            {files.map((att, idx) => (
              <div
                key={idx}
                className={`flex items-center justify-between gap-2 p-2 rounded-xl transition-all ${
                  mine
                    ? 'bg-white/80 hover:bg-white border border-[#91caff]/60'
                    : 'bg-black/[0.03] hover:bg-black/[0.06] border border-black/5'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  {getFileIcon(att.name)}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] font-semibold text-ink leading-tight" title={att.name}>
                      {att.name}
                    </div>
                    <div className="text-[10px] text-ink3 font-medium mt-0.5">
                      {fmtSize(att.size)}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => downloadAttachment(att)}
                  title={`${att.name} 다운로드`}
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-black/5 hover:bg-black/10 text-ink2 active:scale-95 transition-transform"
                >
                  <Download size={13} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
