import test from 'node:test';
import assert from 'node:assert/strict';
import {
  imageIdsOfRich,
  isEmptyRich,
  isPlainOnlyRich,
  isSafeHref,
  mentionIdsOfRich,
  parseRichBody,
  plainTextOfRich,
  sanitizeRichDoc,
  type RichNode,
} from './richBody';

const p = (...content: RichNode[]): RichNode => ({ type: 'paragraph', content });
const t = (text: string, marks?: RichNode['marks']): RichNode => (marks ? { type: 'text', text, marks } : { type: 'text', text });
const doc = (...content: RichNode[]): RichNode => ({ type: 'doc', content });

test('모르는 노드·마크와 위험한 링크는 걷어낸다', () => {
  const clean = sanitizeRichDoc(
    doc(
      p(t('안전', [{ type: 'bold' }, { type: 'fontFamily' }]), t('링크', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }])),
      { type: 'iframe', attrs: { src: 'https://x' } },
      p({ type: 'image', attrs: { src: 'https://evil/x.png' } }),
    ),
  );
  // 외부 주소 사진은 빠지고, 남은 빈 문단은 끝이라 걷어낸다
  assert.deepEqual(clean, doc(p(t('안전', [{ type: 'bold' }]), t('링크'))));
});

test('안전한 링크·사진(첨부 id)·멘션은 남긴다', () => {
  const clean = sanitizeRichDoc(
    doc(p(t('홈', [{ type: 'link', attrs: { href: 'https://workfit.kr', target: '_top' } }]), { type: 'image', attrs: { attachmentId: 'a1', src: 'blob:x' } }, { type: 'mention', attrs: { id: 'U1', label: '홍길동' } })),
  );
  assert.deepEqual(clean.content?.[0].content?.[0].marks, [{ type: 'link', attrs: { href: 'https://workfit.kr' } }]);
  assert.deepEqual(clean.content?.[0].content?.[1].attrs, { attachmentId: 'a1' });
  assert.deepEqual(mentionIdsOfRich(clean), ['U1']);
  assert.deepEqual(imageIdsOfRich(clean), ['a1']);
  assert.equal(isSafeHref('mailto:a@b.c'), true);
});

test('깨진 본문 문자열은 빈 문서', () => {
  assert.deepEqual(parseRichBody('{oops'), doc());
  assert.deepEqual(parseRichBody(null), doc());
});

test('앞뒤 빈 문단은 걷어낸다(가운데 빈 줄은 둔다)', () => {
  const clean = sanitizeRichDoc(doc(p(), p(t('가')), p(), p(t('나')), p(), p({ type: 'hardBreak' })));
  assert.deepEqual(clean, doc(p(t('가')), { type: 'paragraph' }, p(t('나'))));
});

test('평문 요약: 줄·목록·사진·멘션·표', () => {
  const d = doc(
    p(t('안녕하세요 '), { type: 'mention', attrs: { id: 'U1', label: '홍길동' } }),
    { type: 'bulletList', content: [{ type: 'listItem', content: [p(t('하나'))] }, { type: 'listItem', content: [p(t('둘'))] }] },
    p({ type: 'image', attrs: { attachmentId: 'a1' } }),
    {
      type: 'table',
      content: [
        { type: 'tableRow', content: [{ type: 'tableHeader', content: [p(t('항목'))] }, { type: 'tableHeader', content: [p(t('값'))] }] },
        { type: 'tableRow', content: [{ type: 'tableCell', content: [p(t('A'))] }, { type: 'tableCell', content: [p(t('1'))] }] },
      ],
    },
  );
  assert.equal(plainTextOfRich(d), '안녕하세요 @홍길동\n• 하나\n• 둘\n[사진]\n항목 | 값\nA | 1');
});

test('글자만 있는 본문은 평문으로 보낼 수 있다, 꾸밈이 있으면 아니다', () => {
  assert.equal(isPlainOnlyRich(doc(p(t('그냥 글')), p(t('둘째 줄')))), true);
  assert.equal(isPlainOnlyRich(doc(p(t('굵게', [{ type: 'bold' }])))), false);
  assert.equal(isPlainOnlyRich(doc({ type: 'bulletList', content: [] })), false);
});

test('빈 본문 판정 — 사진만 있어도 보낼 수 있다', () => {
  assert.equal(isEmptyRich(doc(p())), true);
  assert.equal(isEmptyRich(doc(p({ type: 'image', attrs: { attachmentId: 'a1' } }))), false);
});
