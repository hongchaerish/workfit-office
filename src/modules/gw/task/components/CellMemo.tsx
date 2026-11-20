import { useState } from 'react';
import { StickyNote } from 'lucide-react';
import { WORK_PLAN_MEMO_MAX, toggleMemoTask } from '@/domain/workPlan/memo';
import { WorkPlanMemoEditor } from './memo/WorkPlanMemoEditor';
import { WorkPlanMemoView } from './memo/WorkPlanMemoView';

/**
 * 칸 아래쪽 메모 칸 — 서식 없는 글. 기본 높이는 같고, 글이 길면 그만큼 늘어난다(칸·행도 같이). 점선 위는 일정, 아래는 메모.
 * `onSave`가 있으면(내 칸) 메모 칸을 눌러 그 자리에서 고친다. 칸 밖을 누르거나 Ctrl+Enter = 저장, Esc = 취소.
 */
export function CellMemo({
  text,
  label,
  onSave,
  look = { memo: 'text-[11.5px]', mark: 10 },
}: {
  text: string | null;
  label: string;
  onSave?: (text: string) => Promise<void>;
  look?: { memo: string; mark: number };
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const startEdit = () => {
    if (!onSave || draft !== null) return;
    setError('');
    setDraft(text ?? '');
  };

  const finish = async () => {
    if (draft === null || saving || !onSave) return;
    if (draft.trim() === (text ?? '').trim()) {
      setDraft(null);
      return;
    }
    if (draft.length > WORK_PLAN_MEMO_MAX) {
      setError(`메모는 ${WORK_PLAN_MEMO_MAX.toLocaleString()}자까지 쓸 수 있습니다(서식 포함).`);
      return;
    }
    setSaving(true);
    try {
      await onSave(draft);
      setDraft(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '메모를 저장하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  };

  // 칸에서 체크박스 누르기 — 고치기 창을 열지 않고 바로 저장
  const toggleTask = async (taskIndex: number) => {
    if (!onSave || !text || saving) return;
    setSaving(true);
    setError('');
    try {
      await onSave(toggleMemoTask(text, taskIndex));
    } catch (e) {
      setError(e instanceof Error ? e.message : '메모를 저장하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role={onSave && draft === null ? 'button' : undefined}
      tabIndex={onSave && draft === null ? 0 : undefined}
      aria-label={onSave && draft === null ? `${label} ${text ? '고치기' : '쓰기'}` : undefined}
      title={onSave && draft === null ? '눌러서 메모 쓰기' : undefined}
      // 내 칸 메모 칸 누르기는 메모 고치기 — 칸 누르기(새 일정 창)로 넘기지 않는다
      onClick={
        onSave
          ? (e) => {
              e.stopPropagation();
              startEdit();
            }
          : undefined
      }
      onKeyDown={
        onSave && draft === null
          ? (e) => {
              if (e.key === 'Enter') startEdit();
            }
          : undefined
      }
      // 기본 높이(두 줄)는 늘 같고 글이 길면 늘어난다 — 옆 칸 때문에 행이 늘 때는 위 일정 칸이 늘어난다(shrink-0)
      // 바탕 없이 위쪽 점선으로만 일정과 구분한다 — 바탕을 깔면 줄마다 같은 색이 되어 표의 얼룩무늬(줄 구분)가 흐려진다
      className={`-mx-1 mt-1.5 min-h-[2.5rem] shrink-0 rounded-b border-t border-dashed border-border px-1 pt-1 ${
        onSave && draft === null ? 'cursor-text hover:bg-panel-alt' : ''
      }`}
    >
      {draft !== null ? (
        <>
          {/* 서식 메모 편집기 — 위에 서식 버튼이 뜬다. 칸 밖을 누르거나 Ctrl+Enter = 저장, Esc = 취소 */}
          <WorkPlanMemoEditor
            label={label}
            value={draft}
            disabled={saving}
            onChange={setDraft}
            onBlur={() => void finish()}
            onSave={() => void finish()}
            onCancel={() => {
              setError('');
              setDraft(null);
            }}
            className={`min-h-[3.5rem] rounded border border-sky-300 bg-panel px-1.5 py-1 ${look.memo} leading-relaxed text-ink focus-within:border-sky-400 dark:border-sky-700`}
          />
          {error && <div role="alert" className="mt-0.5 text-[9px] font-semibold text-danger">{error}</div>}
        </>
      ) : text ? (
        <WorkPlanMemoView
          memo={text}
          onToggle={onSave ? (i) => void toggleTask(i) : undefined}
          className={`${look.memo} leading-relaxed text-ink2 ${saving ? 'opacity-60' : ''}`}
        />
      ) : (
        onSave && (
          // 비어 있는 내 메모 칸 — 흐린 '메모' 글자를 늘 보인다
          <span className={`flex items-center gap-1 ${look.memo} text-ink3/60`}>
            <StickyNote size={look.mark + 1} />
            메모
          </span>
        )
      )}
    </div>
  );
}
