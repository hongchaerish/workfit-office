import { useMemo, useRef } from 'react';
import { useEditRich } from '@/features/chat/useChatThread';
import { ChatRichEditor, type ChatRichEditorHandle } from '@/features/chat/rich/ChatRichEditor';
import { isEmptyRich, parseRichBody } from '@/domain/chatMessage/richBody';
import type { ChatMessage } from '@/domain/chatMessage/schema';

/** 서식 메시지 수정 — 말풍선 자리에서 편집기를 열고 저장(Ctrl+Enter)·취소. PC와 모바일이 같이 쓴다. */
export function RichEditBox({ message, onDone, variant = 'desktop' }: { message: ChatMessage; onDone: () => void; variant?: 'desktop' | 'mobile' }) {
  const editorRef = useRef<ChatRichEditorHandle>(null);
  const editRich = useEditRich(message.roomId);
  const initialDoc = useMemo(() => parseRichBody(message.body), [message.body]);
  const save = async () => {
    const draft = editorRef.current?.getDraft();
    if (!draft) return;
    if (isEmptyRich(draft.doc) && !(message.attachments ?? []).some((a) => !a.mime.startsWith('image/'))) {
      window.alert('내용을 입력해 주세요.');
      return;
    }
    try {
      await editRich.mutateAsync({ message, draft: { ...draft, files: [] }, actorName: message.senderName });
      onDone();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : '수정에 실패했습니다.');
    }
  };
  const mobile = variant === 'mobile';
  const btn = mobile ? 'rounded px-2.5 py-1 text-[12px]' : 'rounded px-1.5 py-0.5';
  return (
    <div className="flex w-[min(420px,100%)] flex-col gap-1 rounded-xl border border-[#bae0ff] bg-[#f8fbfe] px-2 py-1.5">
      <ChatRichEditor
        ref={editorRef}
        expanded
        initialDoc={initialDoc}
        initialAttachments={message.attachments}
        onSubmit={() => void save()}
        disabled={editRich.isPending}
        maxHeight={240}
      />
      <div className="flex items-center justify-between gap-1 text-[9.5px]">
        <span className="text-ink3">{mobile ? '' : 'Ctrl+Enter 저장 · 사진은 붙여넣어 추가'}</span>
        <span className="flex gap-1">
          <button onClick={onDone} className={`${btn} bg-[#bae0ff]/30 text-ink2 hover:bg-[#bae0ff]/50`}>취소</button>
          <button onClick={() => void save()} disabled={editRich.isPending} className={`${btn} bg-amber text-white hover:bg-amber-dark disabled:opacity-50`}>
            {editRich.isPending ? '...' : '저장'}
          </button>
        </span>
      </div>
    </div>
  );
}
