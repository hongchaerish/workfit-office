import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldSeedRecipients } from './recipientSeed';

const base = { editing: false, formCode: '지출결의', seededFor: null as string | null, orgReady: true, recipientCount: 0 };

test('서식을 처음 열었을 때 수신처가 비어 있으면 기본 수신처를 넣는다', () => {
  assert.equal(shouldSeedRecipients(base), true);
});

test('같은 서식에서 한 번 넣은 뒤에는 — 사용자가 수신처를 모두 지워도 — 조직 정보가 다시 와도 되살리지 않는다', () => {
  assert.equal(shouldSeedRecipients({ ...base, seededFor: '지출결의' }), false);
});

test('서식을 바꾸면 그 서식 기준으로 다시 판단한다', () => {
  assert.equal(shouldSeedRecipients({ ...base, seededFor: '기안', formCode: '지출결의' }), true);
});

test('조직 정보를 받기 전에는 기다린다(빈 목록으로 판단해 기회를 놓치지 않게)', () => {
  assert.equal(shouldSeedRecipients({ ...base, orgReady: false }), false);
});

test('기존 문서 편집 중이거나 이미 수신처가 있으면 넣지 않는다', () => {
  assert.equal(shouldSeedRecipients({ ...base, editing: true }), false);
  assert.equal(shouldSeedRecipients({ ...base, recipientCount: 2 }), false);
});
