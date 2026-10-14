import assert from 'node:assert/strict';
import test from 'node:test';
import { SurveyError } from '@/domain/survey/engine';
import { parseSurveyResponse } from './survey.protocol';

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof SurveyError ? `${e.code}:${e.message}` : 'other';
  }
  return 'no-throw';
};

test('{ data } 는 data 를 돌려준다 — 빈 배열도 그대로', () => {
  assert.deepEqual(parseSurveyResponse('{"data":[]}', 200), []);
});

test('빈 응답은 빈 결과가 아니라 실패다 (콜드 스타트·런타임 오류를 "설문 없음"으로 오인하지 않게)', () => {
  assert.match(code(() => parseSurveyResponse('', 500)), /^INVALID_INPUT:/);
});

test('data 가 없는 응답은 실패다', () => {
  assert.match(code(() => parseSurveyResponse('{}', 200)), /^INVALID_INPUT:/);
});

test('401 은 다시 로그인 안내로 바꾼다 (권한 없음처럼 보이지 않게)', () => {
  const out = code(() => parseSurveyResponse('{"error":{"code":"UNAUTHENTICATED","message":"x"}}', 401));
  assert.match(out, /^FORBIDDEN:.*다시 로그인/);
});

test('업무 오류 코드는 그대로 전한다', () => {
  assert.equal(
    code(() => parseSurveyResponse('{"error":{"code":"ALREADY_RESPONDED","message":"이미 참여한 설문입니다."}}', 400)),
    'ALREADY_RESPONDED:이미 참여한 설문입니다.',
  );
});

test('모르는 오류 코드는 INVALID_INPUT 으로', () => {
  assert.match(code(() => parseSurveyResponse('{"error":{"code":"WEIRD","message":"m"}}', 400)), /^INVALID_INPUT:m$/);
});
