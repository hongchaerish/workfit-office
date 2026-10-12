import assert from 'node:assert/strict';
import test from 'node:test';
import { BODY_BOX_FALLBACK_KEY, documentBodyKeyOf, type FormField } from './schema';

const field = (key: string, type: FormField['type']) => ({ key, type });

test('body 키 장문 필드가 있으면 그 필드가 문서 본문이다', () => {
  assert.equal(documentBodyKeyOf([field('body', '장문')]), 'body');
});

test('body 키를 쓰는 필드가 없으면 기본 본문 칸이 body 에 담긴다', () => {
  assert.equal(documentBodyKeyOf([field('items', '표')]), 'body');
  assert.equal(documentBodyKeyOf(undefined), 'body');
});

test('표 등 다른 종류가 body 키를 쓰면 일반 필드로 두고 기본 본문 칸은 별도 키를 쓴다', () => {
  assert.equal(documentBodyKeyOf([field('body', '표')]), BODY_BOX_FALLBACK_KEY);
  assert.equal(documentBodyKeyOf([field('body', '텍스트')]), BODY_BOX_FALLBACK_KEY);
});
