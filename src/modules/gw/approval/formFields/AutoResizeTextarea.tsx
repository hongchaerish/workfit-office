import { useRef, useLayoutEffect } from 'react';
import { resizeTextareaToContent } from './autoResize';

interface AutoResizeTextareaProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  rows?: number;
}

export function AutoResizeTextarea({
  value,
  onChange,
  placeholder,
  className,
  rows = 4,
}: AutoResizeTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 페인트 전에 높이를 맞춰야 줄어든 프레임이 화면에 보이지 않는다.
  useLayoutEffect(() => {
    if (textareaRef.current) resizeTextareaToContent(textareaRef.current);
  }, [value]);

  return (
    <textarea
      ref={textareaRef}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={className}
      rows={rows}
      style={{ overflowY: 'hidden' }}
    />
  );
}
