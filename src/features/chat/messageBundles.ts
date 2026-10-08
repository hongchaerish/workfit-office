import type { Attachment, ChatMessage } from '@/domain/chatMessage/schema';
import { isDeletedMessage } from '@/domain/chatMessage/deletion';

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

/** 예전 사진 묶음 규칙의 시간차 — 아래 시점 이전 메시지에만 쓴다. */
const BUNDLE_GAP_MS = 60_000;
/**
 * 이 시각 이전 메시지만 "60초 안에 이어 올라온 사진은 한 묶음" 규칙을 쓴다.
 * 그때까지는 여러 장을 보내도 사진마다 따로(다른 시각에) 저장돼, 이 규칙이 있어야 한 묶음으로 보였다.
 * 그 뒤로는 한 번에 보낸 것이 같은 배치로 저장되므로, 엔터를 따로 친 전송은 따로 보여야 한다.
 */
const LEGACY_BUNDLE_BEFORE = '2026-10-02T00:00:00';

/** 메시지 id `<방>-<일련번호>` 를 나눈다. 한 번에 보낸 묶음은 일련번호가 1씩 이어진다(buildAttachmentBatch). */
function idSequence(id: string): { prefix: string; n: number } | null {
  const m = /^(.*)-(\d+)$/.exec(id);
  return m ? { prefix: m[1], n: Number(m[2]) } : null;
}

/**
 * 같은 전송(엔터 한 번)에서 나온 연속 메시지인가.
 * 저장 시각은 초 단위라, 같은 초에 엔터를 두 번 쳐도 시각이 같다 — 그래서 id 일련번호가
 * 바로 이어지는지까지 본다. id 형식이 다르면 예전처럼 같은 시각이면 같은 전송으로 본다.
 */
export function isSameSendBatch(prev: ChatMessage, next: ChatMessage): boolean {
  if (prev.senderId !== next.senderId || prev.at !== next.at) return false;
  const a = idSequence(prev.id);
  const b = idSequence(next.id);
  if (a && b && a.prefix === b.prefix) return b.n === a.n + 1;
  return true;
}

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

    // 한 말풍선(같은 전송)을 통째로 지우면 메시지마다 '삭제된 메시지'가 남는다 — 한 줄로 보인다
    if (isDeletedMessage(cur)) {
      const group: ChatMessage[] = [cur];
      let j = i + 1;
      while (j < msgs.length && isDeletedMessage(msgs[j]) && isSameSendBatch(group[group.length - 1], msgs[j])) {
        group.push(msgs[j]);
        j++;
      }
      items.push({ type: 'message', message: cur, bundleMessages: group.length > 1 ? group : undefined });
      i = j;
      continue;
    }

    // 첨부파일(이미지 또는 일반파일)이 있는 메시지로부터 번들 탐색 시작
    // 또는 뒤따라오는 첨부들과 한 묶음인 경우
    const hasAtt = Boolean(cur.attachment);

    if (!hasAtt) {
      // 텍스트 단독 메시지인 경우, 바로 뒤에 같은 시각(같은 배치)의 첨부들이 없으면 단독 처리
      const next = msgs[i + 1];
      const isNextSameBatch = next && Boolean(next.attachment) && isSameSendBatch(cur, next);
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

      // 엔터 한 번에 보낸 것(같은 배치)만 합친다 — 같은 시각이라도 따로 보낸 사진·글은 별개 메시지다.
      // 예외: 배치 저장 이전의 옛 메시지는 사진마다 따로 저장됐으므로, 글 없는 사진이 60초 안에
      // 이어지면 예전처럼 한 묶음으로 보여 준다.
      const sameBatch = isSameSendBatch(prev, next);
      const isLegacy = prev.at < LEGACY_BUNDLE_BEFORE && next.at < LEGACY_BUNDLE_BEFORE;
      const followingAttachment = isLegacy && Boolean(next.attachment) && !next.text && Boolean(prev.attachment)
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

/** 이 메시지가 속한 말풍선의 모든 메시지 — 삭제처럼 말풍선 단위로 처리할 때 쓴다. */
export function bubbleMessagesOf(items: RenderMessageItem[], message: ChatMessage): ChatMessage[] {
  const item = items.find((it) => it.message.id === message.id || it.bundleMessages?.some((m) => m.id === message.id));
  return item?.bundleMessages?.length ? item.bundleMessages : [message];
}
