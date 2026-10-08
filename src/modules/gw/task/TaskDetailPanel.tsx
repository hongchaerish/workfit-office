import { useMemo, useRef, useState } from 'react';
import type { ProjectAccessContext } from '@/domain/workProject/engine';
import type { RollupResult } from '@/domain/workProject/rollup';
import type { WorkProject } from '@/domain/workProject/schema';
import { WORK_TASK_STATUS_LABELS, type WorkTask } from '@/domain/workTask/schema';
import type { WorkTrack } from '@/domain/workTrack/schema';
import { formatFileSize } from '@/domain/workTaskNote/schema';
import type { User } from '@/domain/user/schema';
import {
  useAddComment,
  useRemoveComment,
  useRemoveFile,
  useTaskComments,
  useTaskFiles,
  useUploadFile,
} from '@/features/project/useProjectNotes';
import { Button } from '@/shared/ui/Button';
import { Pill, type Tone } from '@/shared/ui/Pill';

interface TaskDetailPanelProps {
  project: WorkProject;
  access: ProjectAccessContext;
  task: WorkTask;
  tracks: WorkTrack[];
  tasks: WorkTask[];
  users: User[];
  rolled: Map<string, RollupResult>;
  canEdit: boolean;
  /** 트리가 좁아지면 행의 관리 버튼이 사라진다 — 그 자리를 패널 머리가 대신한다. */
  canAddChild: boolean;
  canSetProgress: boolean;
  progressPending: boolean;
  onSelectTask: (task: WorkTask) => void;
  onClose: () => void;
  onEdit: () => void;
  onAddChild: () => void;
  onMove: () => void;
  onDelete: () => void;
  onChangeProgress: (next: number) => void;
}

const STATUS_TONES: Record<WorkTask['status'], Tone> = { TODO: 'mute', IN_PROGRESS: 'info', DONE: 'ok' };
const LEVEL_LABELS = ['대', '중', '소', '4단', '5단'];

function formatDate(iso: string | null): string {
  if (!iso) return '미정';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', year: '2-digit', month: '2-digit', day: '2-digit',
  }).format(new Date(iso));
}

function formatStamp(iso: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso));
}

/**
 * 과업 상세 — 트리 오른쪽에 붙는 패널.
 *
 * **팝업이 아니라 분할 뷰인 이유**: 과업을 훑으며 옮겨 다닐 때 모달은 매번 화면을 덮었다
 * 지웠다 한다. 왼쪽 트리에서 위치를 유지한 채 오른쪽만 갈아 끼우면 "지금 어디를 보는지"가
 * 사라지지 않는다.
 *
 * **트리와 같은 문법을 반복한다**: 상세는 `머리(어디에 있는가) → 하위 트리 → 논의` 순서다.
 * 대과업을 열면 하위가 보이고 거기서 한 단계 더 파고들 수 있어, 어느 단계를 열든 화면이
 * 같은 모양을 유지한다. 리프에는 하위 칸이 없어 자연히 논의가 주가 된다.
 */
export default function TaskDetailPanel({
  project, access, task, tracks, tasks, users, rolled,
  canEdit, canAddChild, canSetProgress, progressPending,
  onSelectTask, onClose, onEdit, onAddChild, onMove, onDelete, onChangeProgress,
}: TaskDetailPanelProps) {
  const [tab, setTab] = useState<'comments' | 'files'>('comments');
  const [includeSubtree, setIncludeSubtree] = useState(false);
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const taskById = useMemo(() => new Map(tasks.map((row) => [row.id, row])), [tasks]);
  const children = useMemo(
    () => tasks.filter((row) => row.parentId === task.id).sort((a, b) => a.path.localeCompare(b.path)),
    [task.id, tasks],
  );
  const hasChildren = children.length > 0;

  const scope = { projectId: project.id, taskId: task.id, includeSubtree: hasChildren && includeSubtree };
  const commentsQuery = useTaskComments(access, scope, tab === 'comments');
  const filesQuery = useTaskFiles(access, scope, tab === 'files');
  const addComment = useAddComment();
  const removeComment = useRemoveComment();
  const uploadFile = useUploadFile();
  const removeFile = useRemoveFile();

  const userById = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);
  const view = rolled.get(task.id) ?? { progress: task.progress, status: task.status, isLeaf: true };
  const isMember = project.memberUserIds.includes(access.userId) || canEdit;

  /** 트랙 › 상위… › 나. 트리에서 어디를 보고 있는지 잃지 않게 한다. */
  const breadcrumb = useMemo(() => {
    const chain: string[] = [];
    for (let cursor: WorkTask | undefined = task; cursor?.parentId; ) {
      const parent = taskById.get(cursor.parentId);
      if (!parent) break;
      chain.unshift(parent.title);
      cursor = parent;
    }
    const trackName = tracks.find((track) => track.id === task.trackId)?.name;
    return [trackName, ...chain].filter(Boolean) as string[];
  }, [task, taskById, tracks]);

  const submitComment = async () => {
    const text = body.trim();
    if (!text) return;
    setError('');
    try {
      await addComment.mutateAsync({
        actor: access,
        draft: { projectId: project.id, taskId: task.id, parentId: null, body: text },
      });
      setBody('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '댓글을 남기지 못했습니다.');
    }
  };

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    try {
      await uploadFile.mutateAsync({ actor: access, scope: { projectId: project.id, taskId: task.id }, file });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '파일을 올리지 못했습니다.');
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  return (
    <aside className="detail-panel-in lg:sticky lg:top-[calc(var(--shell-top)+12px)] flex max-h-[calc(100vh/var(--font-scale,1)-2rem-var(--shell-top))] min-h-0 flex-col rounded-[10px] border border-border bg-panel shadow-[0_1px_2px_rgba(23,34,65,0.06)]">
      {/* ── 머리: 어디에 있는가 ── */}
      <header className="shrink-0 border-b border-border px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            {breadcrumb.length > 0 && (
              <div className="truncate text-[9px] font-semibold text-ink3">{breadcrumb.join(' › ')}</div>
            )}
            <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
              <span className="shrink-0 rounded bg-panel-alt px-1.5 py-0.5 text-[8.5px] font-extrabold text-ink3">
                {LEVEL_LABELS[task.level - 1] ?? task.level}
              </span>
              <h4 className="min-w-0 break-words text-[13px] font-extrabold text-ink">{task.title}</h4>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="상세 닫기" className="shrink-0 rounded px-1.5 py-0.5 text-[12px] font-bold text-ink3 hover:bg-panel-alt hover:text-ink">✕</button>
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[9.5px] font-semibold text-ink3">
          <span>{userById.get(task.assigneeUserId)?.name ?? task.assigneeUserId}</span>
          <span>{formatDate(task.startAt)} ~ {formatDate(task.dueAt)}</span>
          <Pill tone={STATUS_TONES[view.status]}>{WORK_TASK_STATUS_LABELS[view.status]}</Pill>
          {/* 진행률은 리프에서만 입력한다. 상위는 하위에서 접어 올린 값이라 고칠 수 없다. */}
          {view.isLeaf && canSetProgress ? (
            <select
              value={task.progress}
              disabled={progressPending}
              aria-label="진척률 변경"
              onChange={(event) => onChangeProgress(Number(event.target.value))}
              className="h-5 rounded border border-border bg-panel px-1 text-[9.5px] font-extrabold text-teal outline-none focus:border-teal disabled:cursor-wait disabled:opacity-50"
            >
              {Array.from(new Set([task.progress, 0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]))
                .sort((a, b) => a - b)
                .map((value) => <option key={value} value={value}>{value}%</option>)}
            </select>
          ) : (
            <span className="font-extrabold text-teal">{view.progress}%{view.isLeaf ? '' : ' 자동'}</span>
          )}
        </div>

        {/* 트리가 좁아지면 행의 관리 버튼이 사라지므로 여기서 전부 할 수 있어야 한다. */}
        {(canAddChild || canEdit) && (
          <div className="mt-2 flex flex-wrap gap-1">
            {canAddChild && <button type="button" onClick={onAddChild} className="rounded border border-border px-2 py-1 text-[9px] font-bold text-ink3 hover:bg-panel-alt">+ 하위 추가</button>}
            {canEdit && <button type="button" onClick={onMove} className="rounded border border-border px-2 py-1 text-[9px] font-bold text-ink3 hover:bg-panel-alt">옮기기</button>}
            {canEdit && <button type="button" onClick={onEdit} className="rounded border border-border px-2 py-1 text-[9px] font-bold text-ink3 hover:bg-panel-alt">수정</button>}
            {canEdit && <button type="button" onClick={onDelete} className="rounded border border-danger/20 px-2 py-1 text-[9px] font-bold text-danger hover:bg-danger/5">삭제</button>}
          </div>
        )}

        {task.description && (
          <p className="mt-2 whitespace-pre-wrap break-words border-t border-border pt-2 text-[10.5px] leading-6 text-ink2">{task.description}</p>
        )}
      </header>

      <div className="content-scroll min-h-0 flex-1 overflow-y-auto">
        {/* ── 하위 트리 — 트리와 같은 문법을 한 단계 더 반복한다 ── */}
        {hasChildren && (
          <div className="border-b border-border px-4 py-3">
            <div className="mb-1.5 text-[9px] font-extrabold text-ink3">하위 과업 {children.length}</div>
            <ul className="space-y-0.5">
              {children.map((child) => {
                const childView = rolled.get(child.id) ?? { progress: child.progress, status: child.status, isLeaf: true };
                return (
                  <li key={child.id}>
                    <button
                      type="button"
                      onClick={() => onSelectTask(child)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-panel-alt"
                    >
                      <span className="shrink-0 rounded bg-panel-alt px-1 py-px text-[8px] font-extrabold text-ink3">
                        {LEVEL_LABELS[child.level - 1] ?? child.level}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[10.5px] font-bold text-ink2">{child.title}</span>
                      <span className="h-1 w-12 shrink-0 overflow-hidden rounded-full bg-panel-alt">
                        <span className="block h-full rounded-full bg-teal" style={{ width: `${childView.progress}%` }} />
                      </span>
                      <span className="w-8 shrink-0 text-right text-[9px] font-bold text-ink3">{childView.progress}%</span>
                      <span className="shrink-0 text-[9px] text-ink3">›</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* ── 논의 ── */}
        <div className="px-4 py-3">
          <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 border-b border-border">
            <div className="flex gap-1">
              {(['comments', 'files'] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  className={`-mb-px border-b-2 px-2.5 py-1.5 text-[10.5px] font-extrabold ${tab === key ? 'border-teal text-teal' : 'border-transparent text-ink3 hover:text-ink2'}`}
                >
                  {key === 'comments' ? '댓글' : '파일'}
                </button>
              ))}
            </div>
            {/* 리프에는 하위가 없으니 토글을 감춘다 — 눌러도 결과가 같은 스위치는 혼란만 준다. */}
            {hasChildren && (
              <label className="flex items-center gap-1.5 pb-1 text-[9.5px] font-semibold text-ink3">
                <input type="checkbox" checked={includeSubtree} onChange={(event) => setIncludeSubtree(event.target.checked)} className="accent-teal" />
                하위 포함
              </label>
            )}
          </div>

          {error && <div role="alert" className="mb-2 rounded-md bg-danger/5 px-3 py-2 text-[10px] font-semibold text-danger">{error}</div>}

          {tab === 'comments' ? (
            <div className="space-y-2.5">
              {isMember && (
                <div className="space-y-1.5">
                  <textarea
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                    rows={2}
                    maxLength={2000}
                    placeholder="진행 상황이나 결정 사항을 남기세요"
                    aria-label="댓글 입력"
                    className="w-full resize-y rounded-md border border-border-hi bg-panel px-2.5 py-1.5 text-[11px] text-ink outline-none placeholder:text-ink3 focus:border-teal"
                  />
                  <div className="flex justify-end">
                    <Button size="sm" variant="primary" onClick={submitComment} disabled={!body.trim() || addComment.isPending}>
                      {addComment.isPending ? '남기는 중…' : '남기기'}
                    </Button>
                  </div>
                </div>
              )}
              {commentsQuery.isLoading && <div className="py-5 text-center text-[10px] text-ink3">불러오는 중…</div>}
              {!commentsQuery.isLoading && (commentsQuery.data ?? []).length === 0 && (
                <div className="py-5 text-center text-[10px] text-ink3">아직 댓글이 없습니다.</div>
              )}
              <ul className="space-y-1.5">
                {(commentsQuery.data ?? []).map((comment) => (
                  <li key={comment.id} className="rounded-lg border border-border px-2.5 py-2">
                    <div className="flex items-baseline justify-between gap-2">
                      <div className="min-w-0 text-[10px] font-extrabold text-ink">
                        {userById.get(comment.authorUserId)?.name ?? comment.authorUserId}
                        {/* 하위 포함으로 볼 때 어느 과업 글인지 안 보이면 맥락이 사라진다. */}
                        {comment.taskId !== task.id && comment.taskId && (
                          <span className="ml-1.5 font-semibold text-ink3">· {taskById.get(comment.taskId)?.title ?? comment.taskId}</span>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <span className="text-[8.5px] text-ink3">{formatStamp(comment.createdAt)}</span>
                        {comment.authorUserId === access.userId && (
                          <button type="button" onClick={() => removeComment.mutate({ actor: access, id: comment.id })} className="text-[8.5px] font-bold text-ink3 hover:text-danger">삭제</button>
                        )}
                      </div>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap break-words text-[10.5px] leading-6 text-ink2">{comment.body}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="space-y-2">
              {isMember && (
                <div>
                  <input ref={fileInput} type="file" onChange={(event) => pickFile(event.target.files?.[0])} className="hidden" aria-label="파일 선택" />
                  <Button size="sm" onClick={() => fileInput.current?.click()} disabled={uploadFile.isPending}>
                    {uploadFile.isPending ? '올리는 중…' : '+ 파일 올리기'}
                  </Button>
                </div>
              )}
              {filesQuery.isLoading && <div className="py-5 text-center text-[10px] text-ink3">불러오는 중…</div>}
              {!filesQuery.isLoading && (filesQuery.data ?? []).length === 0 && (
                <div className="py-5 text-center text-[10px] text-ink3">첨부된 파일이 없습니다.</div>
              )}
              <ul className="space-y-1">
                {(filesQuery.data ?? []).map((file) => (
                  <li key={file.id} className="flex items-center justify-between gap-2 rounded-lg border border-border px-2.5 py-1.5">
                    <a href={file.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-[10.5px] font-bold text-ink hover:text-teal hover:underline">{file.name}</a>
                    <span className="shrink-0 text-[8.5px] text-ink3">{formatFileSize(file.size)}</span>
                    {(file.uploadedBy === access.userId || project.ownerUserId === access.userId || canEdit) && (
                      <button type="button" onClick={() => removeFile.mutate({ actor: access, id: file.id })} className="shrink-0 text-[8.5px] font-bold text-ink3 hover:text-danger">삭제</button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
