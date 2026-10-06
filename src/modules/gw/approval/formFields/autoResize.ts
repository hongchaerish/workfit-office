/**
 * textarea 높이를 내용에 맞춘다 — 스크롤 위치를 건드리지 않고.
 *
 * 높이를 재려면 잠깐 `height: auto` 로 줄여야 하는데, 화면보다 긴 장문 칸이면 그 순간 문서가
 * 수백 px 짧아져 스크롤 컨테이너의 scrollTop 이 당겨진다. 그 뒤 브라우저가 커서를 보이게
 * 스크롤하므로 "중간을 클릭하고 타이핑하면 작성 위치가 화면 하단으로 튀는" 증상이 됐다.
 * 줄이기 전 조상 스크롤 위치를 기억했다가 되돌린다.
 */
export function resizeTextareaToContent(el: HTMLTextAreaElement, minHeight = 0): void {
  const saved: Array<[HTMLElement, number]> = [];
  for (let node = el.parentElement; node; node = node.parentElement) {
    if (node.scrollTop > 0) saved.push([node, node.scrollTop]);
  }
  const windowY = window.scrollY;

  el.style.height = 'auto';
  el.style.height = `${Math.max(minHeight, el.scrollHeight)}px`;

  for (const [node, top] of saved) {
    if (node.scrollTop !== top) node.scrollTop = top;
  }
  if (window.scrollY !== windowY) window.scrollTo({ top: windowY });
}
