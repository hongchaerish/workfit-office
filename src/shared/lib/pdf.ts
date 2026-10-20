/**
 * 화면 요소 → A4 PDF 다운로드.
 *
 * 요소를 이미지로 떠서 A4 세로 페이지에 나눠 붙인다. 글꼴을 PDF에 심을 필요가 없어 한글이
 * 깨지지 않는다(대신 글자 선택은 안 된다). 라이브러리는 PDF를 만들 때만 불러온다.
 *
 * - html2canvas-pro: Tailwind v4 의 oklch 색을 읽는다(원본 html2canvas 는 oklch 에서 멈춘다).
 * - 인쇄 전용 숨김(`print:hidden`)은 화면 캡처에도 빼서 인쇄본과 같게 만든다.
 */
const A4_W = 210;
const A4_H = 297;
const MARGIN = 10;

/** 이미지가 다 그려질 때까지 기다린다 — 도장·서명이 빠진 PDF가 나오지 않게. */
async function waitForImages(el: HTMLElement): Promise<void> {
  const imgs = Array.from(el.querySelectorAll('img'));
  await Promise.all(
    imgs.map((img) =>
      img.complete
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            img.addEventListener('load', () => resolve(), { once: true });
            img.addEventListener('error', () => resolve(), { once: true });
          }),
    ),
  );
}

export async function exportElementToPdf(el: HTMLElement, fileName: string): Promise<void> {
  await document.fonts?.ready;
  await waitForImages(el);

  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas-pro'), import('jspdf')]);
  const canvas = await html2canvas(el, {
    scale: 2,
    useCORS: true,
    backgroundColor: '#ffffff',
    ignoreElements: (node) => node instanceof HTMLElement && node.classList.contains('print:hidden'),
  });

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const imgW = A4_W - MARGIN * 2;
  const pageContentH = A4_H - MARGIN * 2;
  /** 캔버스 px → mm 비율. 페이지 하나에 들어가는 캔버스 높이(px)를 구한다. */
  const pxPerMm = canvas.width / imgW;
  const slicePx = Math.floor(pageContentH * pxPerMm);

  for (let y = 0, page = 0; y < canvas.height; y += slicePx, page++) {
    const h = Math.min(slicePx, canvas.height - y);
    const slice = document.createElement('canvas');
    slice.width = canvas.width;
    slice.height = h;
    slice.getContext('2d')!.drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
    if (page > 0) pdf.addPage();
    pdf.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', MARGIN, MARGIN, imgW, h / pxPerMm);
  }

  // pdf.save() 는 환경에 따라 파일명을 잃는다 — Blob 을 받아 직접 내려준다.
  const url = URL.createObjectURL(pdf.output('blob'));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
