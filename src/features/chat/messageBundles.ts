import type { ChatMessage } from '@/domain/chatMessage/schema';

/**
 * 메신저 말풍선 묶기 규칙 — 데스크톱·모바일 공용.
 * (예전에는 두 화면에 같은 코드가 따로 있었다.)
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
  type: 'message' | 'image-bundle';
  message: ChatMessage;
  bundleMessages?: ChatMessage[];
}

/** 사진 묶음으로 이어 붙일 수 있는 간격. 한 번에 여러 장을 올리면 업로드에 몇 초씩 걸려 분이 바뀔 수 있다. */
const IMAGE_BUNDLE_GAP_MS = 60_000;

const isBundlableImage = (m: ChatMessage) => m.type === 'image' && !m.text && Boolean(m.attachment);

/** 같은 사람이 이어서 보낸 글 없는 사진들을 한 묶음(카카오톡식 그리드)으로 모은다. */
export function processMessageBundles(msgs: ChatMessage[]): RenderMessageItem[] {
  const items: RenderMessageItem[] = [];
  let i = 0;
  while (i < msgs.length) {
    const cur = msgs[i];
    if (!isBundlableImage(cur)) {
      items.push({ type: 'message', message: cur });
      i++;
      continue;
    }

    const bundle: ChatMessage[] = [cur];
    let j = i + 1;
    while (j < msgs.length) {
      const next = msgs[j];
      const prev = bundle[bundle.length - 1];
      const gap = new Date(next.at).getTime() - new Date(prev.at).getTime();
      if (isBundlableImage(next) && next.senderId === cur.senderId && gap >= 0 && gap <= IMAGE_BUNDLE_GAP_MS) {
        bundle.push(next);
        j++;
      } else {
        break;
      }
    }

    if (bundle.length >= 2) {
      items.push({ type: 'image-bundle', message: cur, bundleMessages: bundle });
      i = j;
    } else {
      items.push({ type: 'message', message: cur });
      i++;
    }
  }
  return items;
}

/**
 * 사진 묶음 그리드의 줄별 장수 — 카카오톡처럼 3장씩 채우되,
 * 마지막 줄에 1장만 남으면 마지막 두 줄을 2·2로 나눠 외톨이 칸을 만들지 않는다.
 */
export function imageBundleRows(count: number): number[] {
  if (count <= 3) return [count];
  const full = Math.floor(count / 3);
  const rest = count % 3;
  if (rest === 0) return Array(full).fill(3);
  if (rest === 2) return [...Array(full).fill(3), 2];
  return [...Array(full - 1).fill(3), 2, 2];
}

/** 바로 앞 메시지와 붙여 보여도 되는가 — 같은 사람이 같은 분에 보낸 연속 메시지(시스템 메시지 제외). */
export function isGroupedWithPrevious(prev: ChatMessage | null, cur: ChatMessage): boolean {
  if (!prev) return false;
  if (prev.type === 'system' || cur.type === 'system') return false;
  return prev.senderId === cur.senderId && isSameMinute(prev.at, cur.at);
}
