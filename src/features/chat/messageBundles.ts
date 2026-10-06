import type { Attachment, ChatMessage } from '@/domain/chatMessage/schema';

/**
 * 메신저 말풍선 묶기 규칙 — 데스크톱·모바일 공용.
 */

export function isSameMinute(dateStr1?: string | null, dateStr2?: string | null): boolean {
  if (!dateStr1 || !dateStr2) return false;
  const d1 = new Date(dateStr1);
  const d2 = new Date(dateStr2);
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate() &&
    d1.getHours() === d2.getHours() &&
    d1.getMinutes() === d2.getMinutes()
  );
}

export interface RenderMessageItem {
  type: 'message' | 'composite-bundle';
  message: ChatMessage;
  bundleMessages?: ChatMessage[];
  text?: string;
  images?: Attachment[];
  files?: Attachment[];
}

/** 사진/파일/텍스트 묶음으로 이어 붙일 수 있는 시간차(동일 전송 배치). */
const BUNDLE_GAP_MS = 60_000;

/**
 * 동일한 발신자가 함께 보낸 첨부파일(이미지, 일반 파일)과 본문 텍스트를
 * Teams/Slack 스타일의 하나의 단일 메시지 카드(composite-bundle)로 묶는다.
 */
export function processMessageBundles(msgs: ChatMessage[]): RenderMessageItem[] {
  const items: RenderMessageItem[] = [];
  let i = 0;

  while (i < msgs.length) {
    const cur = msgs[i];

    // 시스템 메시지나 결재 봇 카드는 묶지 않고 단독 렌더
    if (cur.type === 'system' || cur.type === 'approval_bot') {
      items.push({ type: 'message', message: cur });
      i++;
      continue;
    }

    // 첨부파일(이미지 또는 일반파일)이 있는 메시지로부터 번들 탐색 시작
    // 또는 뒤따라오는 첨부들과 한 묶음인 경우
    const hasAtt = Boolean(cur.attachment);

    if (!hasAtt) {
      // 텍스트 단독 메시지인 경우, 바로 뒤에 같은 시각(같은 배치)의 첨부들이 없으면 단독 처리
      const next = msgs[i + 1];
      const isNextSameBatch = next && next.senderId === cur.senderId && Boolean(next.attachment) && (next.at === cur.at);
      if (!isNextSameBatch) {
        items.push({ type: 'message', message: cur });
        i++;
        continue;
      }
    }

    // 번들 수집 시작
    const bundle: ChatMessage[] = [cur];
    let j = i + 1;

    while (j < msgs.length) {
      const next = msgs[j];
      if (next.type === 'system' || next.type === 'approval_bot') break;
      if (next.senderId !== cur.senderId) break;

      const prev = bundle[bundle.length - 1];
      const gap = new Date(next.at).getTime() - new Date(prev.at).getTime();

      // 한 번에 보낸 묶음은 모두 같은 시각으로 저장된다(buildAttachmentBatch) — 글은 이때만 합친다.
      // 따로 올린 글 없는 첨부가 60초 안에 이어지면 예전 사진 묶음처럼 합친다.
      // 그 밖의 글은 별개 메시지다(합치면 답장·삭제 대상이 사라진다).
      const sameBatch = next.at === cur.at;
      const followingAttachment = Boolean(next.attachment) && !next.text && Boolean(prev.attachment)
        && gap >= 0 && gap <= BUNDLE_GAP_MS;

      if (sameBatch || followingAttachment) {
        bundle.push(next);
        j++;
      } else {
        break;
      }
    }

    // 번들 내 이미지, 일반 파일, 텍스트 분류
    const images: Attachment[] = [];
    const files: Attachment[] = [];
    const texts: string[] = [];

    bundle.forEach((m) => {
      if (m.attachment) {
        if (m.type === 'image' || m.attachment.mime.startsWith('image/')) {
          images.push(m.attachment);
        } else {
          files.push(m.attachment);
        }
      }
      if (m.text && m.text.trim()) texts.push(m.text.trim());
    });
    const combinedText = texts.join('\n');

    const totalAttachments = images.length + files.length;

    // 첨부가 2개 이상이거나, [첨부 + 텍스트]가 함께 결합된 경우 복합 번들로 처리
    if (totalAttachments >= 2 || (totalAttachments >= 1 && combinedText) || (images.length >= 1 && files.length >= 1)) {
      items.push({
        type: 'composite-bundle',
        message: cur,
        bundleMessages: bundle,
        text: combinedText,
        images,
        files,
      });
      i = j;
    } else {
      // 단일 항목인 경우
      items.push({ type: 'message', message: cur });
      i++;
    }
  }

  return items;
}

/** 바로 앞 메시지와 붙여 보여도 되는가 — 같은 사람이 같은 분에 보낸 연속 메시지(시스템 메시지 제외). */
export function isGroupedWithPrevious(prev: ChatMessage | null, cur: ChatMessage): boolean {
  if (!prev) return false;
  if (prev.type === 'system' || cur.type === 'system') return false;
  return prev.senderId === cur.senderId && isSameMinute(prev.at, cur.at);
}

/** 사진 묶음 표시 시 줄별 사진 개수 계산 (카카오톡 스타일: 3장씩, 마지막 1장 남으면 2·2로 분할). */
export function imageBundleRows(count: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [1];
  if (count === 2) return [2];
  if (count === 3) return [3];
  if (count === 4) return [2, 2];

  const rows: number[] = [];
  let remain = count;
  while (remain > 0) {
    if (remain === 4) {
      rows.push(2, 2);
      break;
    }
    if (remain === 2) {
      rows.push(2);
      break;
    }
    if (remain === 1) {
      if (rows.length > 0 && rows[rows.length - 1] === 3) {
        rows[rows.length - 1] = 2;
        rows.push(2);
      } else {
        rows.push(1);
      }
      break;
    }
    rows.push(3);
    remain -= 3;
  }
  return rows;
}

