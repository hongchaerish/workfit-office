import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Paperclip, Type, X } from 'lucide-react';
import { useOutboxSender } from '@/features/chat/useOutboxSender';
import { ChatRichEditor, type ChatRichEditorHandle, type MentionCandidate } from '@/features/chat/rich/ChatRichEditor';
import { isEmptyRich, isPlainOnlyRich, isRichBodyTooLong, plainTextOfRich, type RichNode } from '@/domain/chatMessage/richBody';
import { clearChatDraft, readChatDraft, saveChatDraft } from '@/features/chat/chatDrafts';
import { MAX_ATTACHMENT_BYTES, type ReplyPreview } from '@/domain/chatMessage/schema';

export interface ChatComposerHandle {
  /** 끌어놓기·붙여넣기 등 입력창 밖에서 들어온 파일 — 사진은 본문 커서 자리, 그 밖은 첨부 목록 */
  attachFiles: (files: FileList | File[]) => void;
}

interface StagedFile {
  id: string;
  file: File;
  previewUrl?: string;
}

interface ChatComposerProps {
  roomId: string;
  senderId: string;
  senderName: string;
  /** @멘션 후보(나를 뺀 방 참여자) */
  members: MentionCandidate[];
  /** 답장 대상 미리보기 — 없으면 null */
  replyTo: ReplyPreview | null;
  onCancelReply: () => void;
  /** 모바일은 손가락으로 누르기 쉽게 버튼을 키우고 아래 안전 영역만큼 띄운다. 그 밖은 PC와 같다. */
  variant?: 'desktop' | 'mobile';
}

/**
 * 메신저 입력창 — PC와 모바일이 같이 쓴다.
 * 답장 표시줄 · 첨부 대기 목록 · 서식 편집기(Teams 방식) · 첨부/서식/보내기 버튼, 그리고 전송.
 * 꾸밈·사진·멘션·첨부가 하나도 없으면 평문 메시지, 아니면 서식 메시지(본문 + 첨부) 1건으로 보낸다.
 */
export const ChatComposer = forwardRef<ChatComposerHandle, ChatComposerProps>(function ChatComposer(
  { roomId, senderId, senderName, members, replyTo, onCancelReply, variant = 'desktop' },
  ref,
) {
  const mobile = variant === 'mobile';
  const outbox = useOutboxSender(roomId);
  const composerRef = useRef<ChatRichEditorHandle>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  /** 확장 편집기 모드 — 서식 도구 막대 */
  const [formatMode, setFormatMode] = useState(false);

  // 작성 중인 글 — 방을 다시 열면 입력창에 되살리고, 쓰는 동안 잠깐 뒤에 보관, 입력창이 닫힐 때 마지막 내용 보관
  const [initialDraft] = useState(() => readChatDraft(senderId, roomId)?.doc);
  const latestDocRef = useRef<RichNode | null>(null);
  const saveTimerRef = useRef<number | undefined>(undefined);
  const flushDraft = () => {
    window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = undefined;
    if (latestDocRef.current) saveChatDraft(senderId, roomId, latestDocRef.current);
  };
  const onDocChange = (doc: RichNode) => {
    latestDocRef.current = doc;
    window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(flushDraft, 400);
  };
  const flushRef = useRef(flushDraft);
  flushRef.current = flushDraft;
  useEffect(() => {
    const onHide = () => flushRef.current();
    window.addEventListener('pagehide', onHide); // 브라우저·창을 닫을 때
    return () => {
      window.removeEventListener('pagehide', onHide);
      flushRef.current(); // 다른 방으로 옮기거나 메신저를 닫을 때
    };
  }, []);
  /** 확장 모드의 서식 도구 막대 자리 — 입력창 위 한 줄 전체 */
  const [toolbarEl, setToolbarEl] = useState<HTMLDivElement | null>(null);
  const [attachedFiles, setAttachedFiles] = useState<StagedFile[]>([]);

  // 미리보기 주소는 입력창이 사라질 때만 정리한다(목록이 바뀔 때마다 지우면 남은 미리보기가 깨진다)
  const attachedRef = useRef(attachedFiles);
  attachedRef.current = attachedFiles;
  useEffect(
    () => () => attachedRef.current.forEach((f) => f.previewUrl && URL.revokeObjectURL(f.previewUrl)),
    [],
  );

  /** 첨부 — 사진은 입력창의 커서 자리(본문 속 사진)에, 그 밖의 파일은 아래 첨부 목록에 올린다. */
  const attachFiles = (files: FileList | File[]) => {
    const staged: StagedFile[] = [];
    const inlineImages: File[] = [];
    for (const file of Array.from(files)) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        window.alert(`파일 [${file.name}]이 너무 큽니다. 최대 ${Math.floor(MAX_ATTACHMENT_BYTES / 1024 / 1024)}MB까지 전송할 수 있습니다.`);
        continue;
      }
      if (file.type.startsWith('image/') && composerRef.current) {
        inlineImages.push(file);
        continue;
      }
      staged.push({
        id: `${file.name}-${Date.now()}-${Math.random()}`,
        file,
        previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
      });
    }
    if (staged.length > 0) setAttachedFiles((prev) => [...prev, ...staged]);
    if (inlineImages.length > 0) composerRef.current?.insertImages(inlineImages);
  };

  useImperativeHandle(ref, () => ({ attachFiles }));

  const removeAttachedFile = (id: string) => {
    setAttachedFiles((prev) => {
      const target = prev.find((f) => f.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((f) => f.id !== id);
    });
  };

  const onPickFile = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) attachFiles(e.target.files);
    e.target.value = '';
  };

  /**
   * 전송 — 메시지 1건. 누르자마자 입력창을 비우고, 올리는 일은 뒤에서 한다(useOutboxSender).
   * 입력창을 잠그지 않으므로 휴대폰 키보드가 내려가지 않고, 실패하면 대화창에 '전송 실패' 말풍선이 남는다.
   */
  const submit = () => {
    const draft = composerRef.current?.getDraft();
    if (!draft) return;
    const files = attachedFiles.map((f) => f.file);
    if (isEmptyRich(draft.doc) && files.length === 0) return;
    if (isRichBodyTooLong(draft.doc)) {
      window.alert('메시지가 너무 깁니다. 나누어 보내 주세요.');
      return;
    }

    const who = { senderId, senderName, replyTo };
    if (files.length === 0 && isPlainOnlyRich(draft.doc)) outbox.sendText(plainTextOfRich(draft.doc), who);
    else outbox.sendRich({ doc: draft.doc, pendingImages: draft.pendingImages, files }, who);

    attachedFiles.forEach((f) => f.previewUrl && URL.revokeObjectURL(f.previewUrl));
    setAttachedFiles([]);
    composerRef.current?.clear();
    latestDocRef.current = null;
    window.clearTimeout(saveTimerRef.current);
    clearChatDraft(senderId, roomId);
    onCancelReply();
  };

  const btnSize = mobile ? 'h-9 w-9' : 'h-[30px] w-[30px]';
  const iconSize = mobile ? 18 : 16;
  const sendLabel = mobile ? '보내기' : '보내기 (Ctrl+Enter)';
  const placeholder = mobile ? '메시지 입력 (↑ 버튼으로 전송)' : '메시지 입력 (Ctrl+Enter 전송, @멘션, 사진 붙여넣기)';

  return (
    <div
      className="shrink-0 border-t border-border bg-panel p-3"
      style={mobile ? { paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' } : undefined}
    >
      {replyTo && (
        <div className="mb-1.5 flex items-center gap-2 rounded-lg border-l-[3px] border-amber bg-panel-alt px-2.5 py-1.5">
          <div className="min-w-0 flex-1">
            <div className="chat-text-[10.5px] font-bold text-amber">{replyTo.senderName || '메시지'}에게 답장</div>
            <div className="truncate chat-text-[11px] text-ink3">{replyTo.text}</div>
          </div>
          <button onClick={onCancelReply} title="답장 취소" className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-ink3 hover:bg-black/5">
            <X size={13} />
          </button>
        </div>
      )}
      {attachedFiles.length > 0 && (
        <div className="mb-2 space-y-1.5 border-b border-border pb-2 px-1">
          <div className="flex items-center gap-1 text-[10px] font-bold text-ink2">
            <Paperclip size={11} className="shrink-0 text-ink3" /> 첨부 {attachedFiles.length}개
          </div>
          <div className="flex flex-wrap gap-2 max-h-36 overflow-y-auto py-0.5">
            {attachedFiles.map((item) => (
              <div key={item.id} className="relative w-14 h-14 rounded-lg border border-border-hi bg-panel-alt overflow-hidden flex items-center justify-center shrink-0 shadow-3xs">
                {item.previewUrl ? (
                  <img src={item.previewUrl} alt="preview" className="w-full h-full object-cover" />
                ) : (
                  <div className="flex flex-col items-center justify-center p-1 text-center w-full h-full">
                    <span className="text-[16px] leading-none">📄</span>
                    <span className="text-[8px] font-semibold truncate w-full mt-0.5 px-0.5 text-ink leading-tight" title={item.file.name}>
                      {item.file.name}
                    </span>
                  </div>
                )}
                <button
                  onClick={() => removeAttachedFile(item.id)}
                  title="첨부 취소"
                  className="absolute top-0.5 right-0.5 bg-black/60 hover:bg-black/80 text-white rounded-full w-4 h-4 grid place-items-center transition-colors"
                >
                  <X size={9} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/*
        입력창 — 글은 맨 왼쪽부터, 첨부·서식·보내기 버튼은 오른쪽에 모은다.
        [서식]을 누르면 입력창이 위로 넓어지고 맨 위에 서식 도구 막대가 생긴다(Teams 방식).
      */}
      <div className={`rounded-2xl border bg-panel py-1 pl-3 pr-1.5 transition-shadow duration-200 ${formatMode ? 'border-teal/50 shadow-[0_4px_16px_rgba(16,24,48,0.10)]' : 'border-border-hi'}`}>
        {formatMode && <div ref={setToolbarEl} className="pt-0.5" />}
        <div className={`flex gap-1.5 ${formatMode ? 'flex-col' : 'items-end'}`}>
          <ChatRichEditor
            ref={composerRef}
            expanded={formatMode}
            members={members}
            onSubmit={submit}
            onFiles={attachFiles}
            initialDoc={initialDraft}
            onChange={onDocChange}
            minHeight={formatMode ? 120 : 0}
            maxHeight={formatMode ? 300 : 160}
            toolbarContainer={formatMode ? toolbarEl : null}
            placeholder={placeholder}
          />
          <div className="mb-0.5 flex shrink-0 items-center gap-0.5 self-end">
            <input ref={fileRef} type="file" multiple className="hidden" onChange={onPickFile} />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              title={`파일·사진 첨부 (최대 ${Math.floor(MAX_ATTACHMENT_BYTES / 1024 / 1024)}MB)`}
              aria-label="파일·사진 첨부"
              className={`grid ${btnSize} shrink-0 place-items-center rounded-full text-ink3 hover:bg-panel-alt disabled:opacity-40 select-none`}
            >
              <Paperclip size={iconSize} />
            </button>
            <button
              type="button"
              onClick={() => {
                setFormatMode((v) => !v);
                requestAnimationFrame(() => composerRef.current?.focus());
              }}
              title={formatMode ? '서식 도구 닫기' : '서식 편집 (굵게·목록·코드…)'}
              aria-label={formatMode ? '서식 도구 닫기' : '서식 편집'}
              aria-pressed={formatMode}
              className={`grid ${btnSize} shrink-0 place-items-center rounded-full select-none ${formatMode ? 'bg-teal-soft text-teal' : 'text-ink3 hover:bg-panel-alt'}`}
            >
              <Type size={iconSize} />
            </button>
            <button
              type="button"
              // 누를 때 입력창의 커서를 뺏지 않는다 — 휴대폰에서 보낸 뒤에도 키보드가 내려가지 않고 이어서 쓸 수 있다
              onMouseDown={(e) => e.preventDefault()}
              onClick={submit}
              title={sendLabel}
              aria-label="보내기"
              className={`grid ${btnSize} shrink-0 place-items-center rounded-full bg-amber disabled:opacity-50 ${mobile ? 'text-[15px]' : 'text-[14px]'} text-white select-none hover:bg-amber-dark transition-colors`}
            >
              ↑
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});
