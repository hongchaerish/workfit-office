import type { Attachment } from '@/domain/chatMessage/schema';
import { imageBundleRows } from './messageBundles';

/**
 * 사진 묶음 그리드 — 카카오톡처럼 한 말풍선 안에 여러 장을 모두 정사각형 칸으로 보여 준다.
 * 줄당 장수는 `imageBundleRows`(3장씩, 마지막 1장 남으면 2·2). 데스크톱·모바일 공용.
 */
export function ImageBundleGrid({
  attachments,
  onOpen,
  className = 'border-border',
}: {
  attachments: Attachment[];
  onOpen: (att: Attachment, list: Attachment[]) => void;
  /** 테두리 색 등 화면별 추가 클래스 */
  className?: string;
}) {
  const rows = imageBundleRows(attachments.length);
  let cursor = 0;

  return (
    <div className={`flex w-60 flex-col gap-1 overflow-hidden rounded-xl border ${className}`}>
      {rows.map((count, rowIdx) => {
        const rowItems = attachments.slice(cursor, cursor + count);
        cursor += count;
        return (
          <div key={rowIdx} className="flex gap-1">
            {rowItems.map((att, i) => (
              <button
                key={`${rowIdx}-${i}`}
                type="button"
                onClick={() => onOpen(att, attachments)}
                title={`${att.name} 크게 보기`}
                className="block aspect-square min-w-0 flex-1 cursor-zoom-in overflow-hidden bg-black/5"
              >
                <img src={att.url} alt={att.name} loading="lazy" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}
