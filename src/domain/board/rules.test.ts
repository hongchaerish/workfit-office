import assert from 'node:assert/strict';
import test from 'node:test';
import type { Post } from './schema';
import { isPostAuthor, numberPosts, postDateLabel, postDateStamp } from './rules';

const post = (over: Partial<Post>): Post => ({
  id: 'P1', boardId: 'notice', title: 't', content: 'c', author: '모 란 대리', date: '2026-08-18',
  views: 0, isPinned: false, hasAttachment: false, attachedFiles: undefined, authorId: null, ...over,
});
const me = { id: 'U007', name: '모 란', position: '과장' };

test('작성자 ID가 있으면 ID로만 본인을 가린다', () => {
  assert.equal(isPostAuthor(post({ authorId: 'U007', author: '아무개 사원' }), me), true);
  assert.equal(isPostAuthor(post({ authorId: 'U099', author: '모 란 과장' }), me), false);
});

test('예전 글(ID 없음)은 이름이 같으면 직급이 바뀌어도 본인이다', () => {
  assert.equal(isPostAuthor(post({ author: '모 란 대리' }), me), true);
  assert.equal(isPostAuthor(post({ author: '모 란' }), me), true);
  assert.equal(isPostAuthor(post({ author: '모 란희 대리' }), me), false);
  assert.equal(isPostAuthor(post({ author: '홍채원 주임' }), me), false);
});

test('로그인 정보가 없으면 본인이 아니다', () => {
  assert.equal(isPostAuthor(post({ authorId: 'U007' }), null), false);
});

test('날짜는 형식이 섞여도 YYYY-MM-DD 로 보인다', () => {
  assert.equal(postDateLabel('2026-10-15'), '2026-10-15');
  assert.equal(postDateLabel('2026-10-15T03:12:45.123Z'), '2026-10-15');
  // KST 자정 직후(UTC 전날)도 KST 날짜로 저장한다
  assert.equal(postDateStamp(new Date('2026-10-14T15:30:00Z')), '2026-10-15');
});

test('목록 번호는 고정 글을 빼고 작성 순서로, 검색과 무관하게 매긴다', () => {
  const rows = [
    post({ id: 'a', date: '2026-10-01' }),
    post({ id: 'b', date: '2026-10-02', isPinned: true }),
    post({ id: 'c', date: '2026-10-03' }),
    post({ id: 'd', date: '2026-10-04', boardId: 'event' }),
  ];
  const numbers = numberPosts(rows, 'notice');
  assert.equal(numbers.get('a'), 1);
  assert.equal(numbers.get('c'), 2);
  assert.equal(numbers.has('b'), false);
  assert.equal(numbers.has('d'), false);
});
