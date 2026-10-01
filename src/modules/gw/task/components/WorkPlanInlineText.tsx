import { useMemo, type CSSProperties } from 'react';
import { WORK_PLAN_COLORS, parseInlineMarks } from '@/domain/workPlan/richText';

/**
 * 업무계획 한 줄의 서식 표기(`**굵게**` 등)를 서식으로 그린다.
 * HTML 문자열을 끼워 넣지 않고 React 요소로만 만든다 — 남이 쓴 계획을 보는 화면이라 주입 위험을 두지 않는다.
 */
export function WorkPlanInlineText({ text }: { text: string }) {
  const segments = useMemo(() => parseInlineMarks(text), [text]);

  return (
    <>
      {segments.map(({ text: part, marks }, idx) => {
        if (!marks.bold && !marks.underline && !marks.strike && !marks.highlight && !marks.color) {
          return <span key={idx}>{part}</span>;
        }
        // 밑줄과 취소선은 같은 CSS 속성(text-decoration-line)이라 클래스로 나누면 하나가 지워진다.
        const decorations = [marks.underline && 'underline', marks.strike && 'line-through'].filter(Boolean).join(' ');
        const style: CSSProperties = {
          ...(decorations ? { textDecorationLine: decorations } : {}),
          ...(marks.color ? { color: WORK_PLAN_COLORS[marks.color] } : {}),
        };
        return (
          <span
            key={idx}
            style={style}
            className={`${marks.bold ? 'font-bold' : ''} ${marks.highlight ? 'rounded-sm bg-yellow-200/80 dark:bg-yellow-500/30' : ''}`}
          >
            {part}
          </span>
        );
      })}
    </>
  );
}
