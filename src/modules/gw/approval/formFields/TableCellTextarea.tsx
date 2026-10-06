import React, { useRef, useLayoutEffect } from 'react';
import { resizeTextareaToContent } from './autoResize';

interface TableCellTextareaProps {
  value: string;
  onChange: (val: string) => void;
  onFocus?: (e: React.FocusEvent<HTMLTextAreaElement>) => void;
  onBlur?: (e: React.FocusEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

/**
 * 전자결재 표 셀 전용 다중 줄 입력기
 * - 일반 Enter 키 입력 시 셀 내부에서 자연스럽게 줄바꿈(\n) 수행
 * - 엑셀 단축키인 Alt + Enter 및 Shift + Enter 완벽 지원
 * - 줄 수와 내용 길이에 맞추어 높이가 자동 조절(Auto-resize)됨
 */
export function TableCellTextarea({
  value,
  onChange,
  onFocus,
  onBlur,
  placeholder,
  className = '',
  disabled = false,
}: TableCellTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const resize = () => {
    if (textareaRef.current) resizeTextareaToContent(textareaRef.current, 26);
  };

  useLayoutEffect(() => {
    resize();
  }, [value]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 엑셀 단축키인 Alt + Enter 입력 시에도 확실하게 줄바꿈 지원
    if (e.altKey && e.key === 'Enter') {
      e.preventDefault();
      const target = e.currentTarget;
      const start = target.selectionStart;
      const end = target.selectionEnd;
      const nextVal = value.substring(0, start) + '\n' + value.substring(end);
      onChange(nextVal);
      requestAnimationFrame(() => {
        target.selectionStart = target.selectionEnd = start + 1;
        resize();
      });
    }
    // 일반 Enter 및 Shift + Enter는 textarea의 기본 동작으로 커서 위치에 \n이 자연스럽게 삽입됩니다.
  };

  return (
    <textarea
      ref={textareaRef}
      value={value}
      rows={1}
      disabled={disabled}
      onChange={(e) => {
        onChange(e.target.value);
      }}
      onFocus={onFocus}
      onBlur={onBlur}
      onKeyDown={handleKeyDown}
      placeholder={placeholder}
      className={`w-full block bg-transparent px-2 py-1.5 text-[11.5px] text-ink outline-none resize-none overflow-hidden transition-colors hover:bg-teal-soft/10 focus:bg-white focus:ring-1 focus:ring-teal/70 rounded-none leading-relaxed whitespace-pre-wrap break-words ${className}`}
    />
  );
}
