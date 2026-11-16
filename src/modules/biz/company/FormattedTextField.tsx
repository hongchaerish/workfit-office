import { useLayoutEffect, useRef, type ChangeEvent, type ComponentProps } from 'react';
import { TextField } from '@/shared/ui/form/TextField';
import { caretAfter } from '@/domain/company/inputFormat';

const digitsIn = (s: string) => (s.match(/\d/g) ?? []).length;

/**
 * 치는 동안 모양을 맞추는 입력칸(사업자등록번호·전화·계좌번호). 커서는 맞춘 뒤에도 치던 자리에 둔다.
 * 하이픈만 지우려 하면(백스페이스·Delete) 모양이 다시 붙어 지워지지 않으므로, 그 옆 숫자를 지운다.
 */
export function FormattedTextField({
  value,
  format,
  onValue,
  ...rest
}: Omit<ComponentProps<typeof TextField>, 'value' | 'onChange'> & {
  value: string;
  format: (raw: string) => string;
  onValue: (next: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);

  const placeCaret = () => {
    const el = ref.current;
    if (caret.current === null || !el || document.activeElement !== el) return;
    el.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  };
  useLayoutEffect(placeCaret);

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    let raw = e.target.value;
    let pos = e.target.selectionStart ?? raw.length;
    let next = format(raw);
    const inputType = (e.nativeEvent as InputEvent).inputType ?? '';
    if (next === value && raw.length < value.length && inputType.startsWith('delete')) {
      // 하이픈만 지운 경우 — 뒤로 지우기는 앞 숫자, 앞으로 지우기는 뒤 숫자를 지운다
      if (inputType === 'deleteContentForward') raw = raw.slice(0, pos) + raw.slice(pos + 1);
      else if (pos > 0) { raw = raw.slice(0, pos - 1) + raw.slice(pos); pos -= 1; }
      next = format(raw);
    }
    if (next !== raw) caret.current = caretAfter(next, digitsIn(raw.slice(0, pos)));
    if (next === value) requestAnimationFrame(placeCaret); // 값이 그대로면 다시 그리지 않으므로 직접 옮긴다
    onValue(next);
  };

  return <TextField ref={ref} value={value} onChange={onChange} {...rest} />;
}
