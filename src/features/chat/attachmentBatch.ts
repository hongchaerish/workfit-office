import type { Attachment, ChatMessage, ReplyPreview } from '@/domain/chatMessage/schema';

/**
 * 한 번에 보낸 첨부들 → 저장할 메시지 목록.
 *
 * 예전에는 파일마다 업로드가 끝난 시각을 따로 찍어 차례로 저장했다. 업로드에 몇 초씩 걸리면
 * 분이 바뀌어 사진 묶음이 깨졌고, 첫 사진에 붙은 글 때문에 첫 장만 따로 떨어졌다.
 * - 모두 **같은 시각**, 순서대로 **증가하는 id**(같은 시각일 때 정렬 기준)
 * - 여러 장이면 글은 사진 뒤 **별도 메시지**로(카카오톡과 같음). 답장 인용은 글이 있으면 글에, 없으면 첫 사진에.
 * - 한 장이면 지금처럼 글·답장을 그 메시지에 함께 담는다.
 */
export function buildAttachmentBatch(input: {
  roomId: string;
  senderId: string;
  senderName: string;
  attachments: Attachment[];
  text: string;
  replyTo: ReplyPreview | null;
  /** 저장 시각(nowLocalIso) — 묶음 전체 공통 */
  at: string;
  /** id 일련번호 시작값(Date.now()) */
  baseTime: number;
}): ChatMessage[] {
  const { roomId, senderId, senderName, attachments, text, replyTo, at, baseTime } = input;
  const single = attachments.length === 1;
  const caption = text.trim();

  const make = (i: number, fields: Pick<ChatMessage, 'type' | 'text' | 'attachment' | 'replyTo'>): ChatMessage => ({
    id: `${roomId}-${baseTime + i}`,
    roomId,
    senderId,
    senderName,
    approvalPayload: null,
    at,
    readBy: [senderId],
    isEdited: false,
    reactions: {},
    ...fields,
  });

  const messages = attachments.map((attachment, i) =>
    make(i, {
      type: attachment.mime.startsWith('image/') ? 'image' : 'file',
      attachment,
      text: single ? caption : '',
      replyTo: i === 0 && (single || !caption) ? replyTo : null,
    }),
  );

  if (!single && caption) {
    messages.push(make(attachments.length, { type: 'text', attachment: null, text: caption, replyTo }));
  }
  return messages;
}
