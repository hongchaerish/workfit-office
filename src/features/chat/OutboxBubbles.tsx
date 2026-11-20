import { useEffect, useRef, type MouseEvent } from 'react';
import { AlertCircle, Paperclip } from 'lucide-react';
import { chatOutbox, useChatOutbox } from '@/features/chat/chatOutbox';
import { useOutboxSender } from '@/features/chat/useOutboxSender';

/** 눌러도 입력창의 커서를 뺏지 않는다 — 휴대폰 키보드가 내려가지 않게 */
const keepFocus = (e: MouseEvent) => e.preventDefault();

/** [보내기]를 누른 지 이만큼 안 된 말풍선은 '방금 보낸 것'으로 본다 */
const JUST_SENT_MS = 15_000;

/**
 * 보내는 중·전송 실패 말풍선 — 대화 목록 맨 아래에 둔다(PC·모바일 공용).
 * 실패한 것은 [재전송]·[삭제]를 고른다.
 */
export function OutboxBubbles({ roomId, me }: { roomId: string; me: string }) {
  // 보내는 중인 글 메시지는 뺀다 — 대화창에 진짜 말풍선 모양으로 이미 붙어 있다(outboxRunner)
  const items = useChatOutbox(roomId, me).filter((x) => !(x.payload.kind === 'text' && x.status === 'sending'));
  const sender = useOutboxSender(roomId);
  const endRef = useRef<HTMLDivElement>(null);

  const count = items.length;
  const prevCount = useRef(0);
  useEffect(() => {
    // 방금 보낸 것만 따라 내린다(바로 실패한 것 포함) — 한참 뒤에 뜬 실패 말풍선 때문에 읽던 자리를 잃지 않게
    const last = items[count - 1];
    if (count > prevCount.current && Date.now() - last.createdAt < JUST_SENT_MS) endRef.current?.scrollIntoView({ block: 'end' });
    prevCount.current = count;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count]);

  if (count === 0) return null;
  return (
    <div className="mt-2 space-y-2">
      {items.map((item) => {
        const failed = item.status === 'failed';
        return (
          <div key={item.id} className="flex flex-col items-end gap-1">
            <div
              className={`max-w-[82%] min-w-0 rounded-2xl px-3 py-2 chat-text-[13px] ${failed ? '' : 'opacity-60'}`}
              style={{ background: '#bae0ff', color: '#1c2536' }}
            >
              {item.images.length > 0 && (
                <div className="mb-1 flex flex-wrap justify-end gap-1">
                  {item.images.map((img) => (
                    <img key={img.url} src={img.url} alt={img.name} className="h-20 w-20 rounded-lg object-cover" />
                  ))}
                </div>
              )}
              {item.text && <div className="whitespace-pre-wrap break-words [word-break:break-word]">{item.text}</div>}
              {item.fileNames.map((name, i) => (
                <div key={i} className="flex items-center gap-1 chat-text-[11.5px]">
                  <Paperclip size={11} className="shrink-0" />
                  <span className="truncate">{name}</span>
                </div>
              ))}
            </div>
            {failed ? (
              <div className="flex items-center gap-1.5 chat-text-[11px]">
                <span className="flex items-center gap-1 font-bold text-[#e5484d]">
                  <AlertCircle size={12} /> 전송 실패
                </span>
                <button type="button" onMouseDown={keepFocus} onClick={() => sender.retry(item)} className="rounded-full bg-amber px-2.5 py-1 font-bold text-white hover:bg-amber-dark">
                  재전송
                </button>
                <button
                  type="button"
                  onMouseDown={keepFocus}
                  onClick={() => chatOutbox.remove(roomId, item.id)}
                  className="rounded-full border border-border-hi bg-panel px-2.5 py-1 font-bold text-ink2 hover:bg-black/5"
                >
                  삭제
                </button>
              </div>
            ) : (
              <div className="chat-text-[10.5px] text-ink3">보내는 중…</div>
            )}
          </div>
        );
      })}
      <div ref={endRef} />
    </div>
  );
}
